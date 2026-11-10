import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { consentRecords, conversations, messages, providerWebhookEvents, suppressions,
  whatsappConnections, whatsappNumbers, whatsappTemplates } from '../db/schema.js';
import { encrypt, sha256 } from '../lib/security.js';
import { applyProviderStatus } from './status.js';
import { emitMessageEvent } from './webhooks.js';
import { enqueue } from './jobs.js';

export async function recordProviderEvent(input: { provider: string; fingerprint: string; rawPayload: string;
  jobKind: string; payload: Record<string, unknown>; accountId?: string; projectId?: string }) {
  return db.transaction(async tx => {
    const [event] = await tx.insert(providerWebhookEvents).values({ provider: input.provider, fingerprint: input.fingerprint,
      rawPayload: input.rawPayload }).onConflictDoNothing().returning();
    if (!event) return { duplicate: true };
    await enqueue(tx, { kind: input.jobKind, dedupKey: `${input.jobKind}:${event.id}`, accountId: input.accountId,
      projectId: input.projectId, payload: { ...input.payload, eventId: event.id } });
    return { duplicate: false, eventId: event.id };
  });
}

const metaPayloadSchema = z.object({ object: z.string().optional(), entry: z.array(z.object({
  id: z.string(), time: z.number().optional(), changes: z.array(z.object({
    field: z.string(), value: z.record(z.string(), z.unknown()),
  })).default([]),
})).default([]) });

const inboundSchema = z.object({
  messaging_product: z.string().optional(), metadata: z.object({ display_phone_number: z.string().optional(), phone_number_id: z.string() }).optional(),
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().optional() }).optional() })).optional(),
  messages: z.array(z.object({ from: z.string(), id: z.string(), timestamp: z.string().optional(), type: z.string().optional(),
    text: z.object({ body: z.string() }).optional(), button: z.object({ text: z.string().optional() }).optional(),
    interactive: z.object({ button_reply: z.object({ title: z.string().optional() }).optional(),
      list_reply: z.object({ title: z.string().optional() }).optional() }).optional() })).optional(),
  statuses: z.array(z.object({ id: z.string(), status: z.string(), timestamp: z.string().optional(),
    recipient_id: z.string().optional(), errors: z.array(z.object({ code: z.number().optional(), title: z.string().optional() })).optional(),
    pricing: z.object({ billable: z.boolean().optional(), pricing_model: z.string().optional(), type: z.string().optional(),
      category: z.string().optional() }).optional() })).optional(),
  event: z.string().optional(), message_template_name: z.string().optional(), message_template_language: z.string().optional(),
  message_template_id: z.string().optional(), reason: z.union([z.string(), z.object({}).passthrough()]).optional(),
}).passthrough();

type InboundMessage = z.infer<typeof inboundSchema>['messages'] extends (infer T)[] | undefined ? T : never;

function inboundText(message: InboundMessage) {
  return message.text?.body ?? message.button?.text ?? message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title ?? null;
}

function metaTimestamp(value: string | undefined) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

export async function processMetaEvent(eventId: string) {
  const [event] = await db.select().from(providerWebhookEvents).where(and(eq(providerWebhookEvents.id, eventId),
    eq(providerWebhookEvents.provider, 'meta'))).limit(1);
  if (!event || event.processedAt) return { done: true };
  try {
    const parsed = metaPayloadSchema.safeParse(JSON.parse(event.rawPayload));
    if (!parsed.success) throw new Error('Invalid Meta webhook payload');
    for (const entry of parsed.data.entry) {
      const [connection] = await db.select().from(whatsappConnections).where(eq(whatsappConnections.wabaId, entry.id));
      if (!connection) continue;
      for (const change of entry.changes) {
        const changeValue = inboundSchema.safeParse(change.value);
        if (!changeValue.success) continue;
        const value = changeValue.data;
        if (change.field === 'messages') {
          const metaPhoneId = value.metadata?.phone_number_id;
          if (!metaPhoneId) continue;
          const [phone] = await db.select().from(whatsappNumbers).where(and(eq(whatsappNumbers.connectionId, connection.id),
            eq(whatsappNumbers.metaPhoneId, metaPhoneId)));
          if (!phone) continue;
          for (const incoming of value.messages ?? []) {
            const occurredAt = metaTimestamp(incoming.timestamp);
            const recipient = `+${incoming.from.replace(/\D/g, '')}`;
            await db.insert(conversations).values({ accountId: connection.accountId,
              phoneId: phone.id, recipient, lastInboundAt: occurredAt })
              .onConflictDoUpdate({ target: [conversations.phoneId, conversations.recipient],
                set: { lastInboundAt: sql`GREATEST(${conversations.lastInboundAt}, ${occurredAt})`, updatedAt: new Date() } });
            const text = inboundText(incoming);
            await db.transaction(async tx => {
              const [created] = await tx.insert(messages).values({ accountId: connection.accountId, channel: 'whatsapp',
                direction: 'incoming', recipient, sender: value.metadata?.display_phone_number ?? phone.displayPhone ?? phone.metaPhoneId,
                bodyEncrypted: text ? encrypt(text, `message:${connection.accountId}`) : null,
                status: 'incoming', reservationStatus: 'none', providerMessageId: incoming.id,
                whatsappPhoneId: phone.id, acceptedAt: occurredAt }).onConflictDoNothing().returning();
              if (created) await emitMessageEvent(tx, created, 'message.incoming');
            });
            if (text && /^(STOP|UNSUBSCRIBE|OPTOUT|OPT OUT|CANCEL|END|QUIT)$/i.test(text.trim())) {
              await db.transaction(async tx => {
                await tx.insert(suppressions).values({ accountId: connection.accountId, channel: 'whatsapp',
                  recipient, reason: 'recipient_opt_out' }).onConflictDoNothing();
                await tx.update(consentRecords).set({ revokedAt: new Date() }).where(and(eq(consentRecords.accountId, connection.accountId),
                  eq(consentRecords.channel, 'whatsapp'), eq(consentRecords.recipient, recipient)));
              });
            }
          }
          for (const status of value.statuses ?? []) {
            const map: Record<string, string> = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' };
            const mapped = map[status.status];
            if (!mapped) continue;
            const error = status.errors?.[0];
            const occurredAt = metaTimestamp(status.timestamp);
            const fingerprint = sha256(JSON.stringify({ id: status.id, status: status.status, timestamp: status.timestamp,
              error: error?.code, pricing: status.pricing }));
            await applyProviderStatus({ accountId: connection.accountId, provider: 'whatsapp', providerMessageId: status.id,
              status: mapped, occurredAt, fingerprint, pricing: status.pricing,
              details: { ...(error ? { errorCode: String(error.code ?? 'META_FAILED'), errorTitle: error.title?.slice(0, 120) } : {}),
                ...(status.pricing ? { pricing: status.pricing } : {}) } });
          }
        }
        if (change.field === 'message_template_status_update') {
          const name = value.message_template_name;
          const language = value.message_template_language;
          if (name && language) await processTemplateStatus({ connectionId: connection.id, wabaId: connection.wabaId, name, language,
            event: String(value.event ?? ''), reason: typeof value.reason === 'string' ? value.reason : undefined });
        }
      }
    }
    await db.update(providerWebhookEvents).set({ processedAt: new Date() }).where(eq(providerWebhookEvents.id, event.id));
    return { done: true };
  } catch (error) {
    await db.update(providerWebhookEvents).set({ lastError: (error instanceof Error ? error.message : 'Processing failed').slice(0, 240) })
      .where(eq(providerWebhookEvents.id, event.id));
    throw error;
  }
}

export async function processTemplateStatus(input: { connectionId: string; wabaId: string; name: string; language: string; event: string; reason?: string }) {
  const map: Record<string, string> = { APPROVED: 'APPROVED', REJECTED: 'REJECTED', PENDING: 'PENDING',
    PAUSED: 'PAUSED', DISABLED: 'DISABLED', FLAGGED: 'REJECTED' };
  const status = map[input.event] ?? input.event;
  await db.update(whatsappTemplates).set({ status, rejectionReason: input.reason?.slice(0, 500) ?? null, syncedAt: new Date(),
    updatedAt: new Date() }).where(and(eq(whatsappTemplates.connectionId, input.connectionId), eq(whatsappTemplates.name, input.name),
      eq(whatsappTemplates.language, input.language)));
  return { done: true };
}

const gatewayCallbackSchema = z.object({ event: z.string(), payload: z.object({
  messageId: z.string().min(1), recipient: z.string().optional(), sender: z.string().nullable().optional(),
  partsCount: z.number().int().optional(), reason: z.string().optional(),
  sentAt: z.string().optional(), deliveredAt: z.string().optional(), failedAt: z.string().optional(),
  cancelledAt: z.string().optional(),
}).passthrough() }).passthrough();

// Maps the Android SMS Gateway's outbound state webhooks (sms:sent/delivered/
// failed/cancelled) onto DevRelay's delivery pipeline. The webhook route only
// forwards those four event types; provider ids that match no DevRelay
// message (e.g. texts sent from the phone's own app) are ignored.
export async function processGatewayCallback(eventId: string) {
  const [event] = await db.select().from(providerWebhookEvents).where(and(eq(providerWebhookEvents.id, eventId),
    eq(providerWebhookEvents.provider, 'sms-gateway'))).limit(1);
  if (!event || event.processedAt) return { done: true };
  try {
    const payload = gatewayCallbackSchema.safeParse(JSON.parse(event.rawPayload));
    if (!payload.success) throw new Error('Invalid SMS gateway callback');
    const value = payload.data;
    const mapped = { 'sms:sent': 'sent', 'sms:delivered': 'delivered', 'sms:failed': 'failed',
      'sms:cancelled': 'failed' }[value.event];
    if (mapped) {
      const rawAt = value.payload.deliveredAt ?? value.payload.sentAt ?? value.payload.failedAt ?? value.payload.cancelledAt;
      const parsedAt = rawAt ? new Date(rawAt) : new Date();
      const occurredAt = Number.isNaN(parsedAt.getTime()) ? new Date() : parsedAt;
      const fingerprint = sha256(JSON.stringify({ id: value.payload.messageId, event: value.event,
        recipient: value.payload.recipient, at: rawAt }));
      const [message] = await db.select({ accountId: messages.accountId }).from(messages)
        .where(and(eq(messages.channel, 'sms'), eq(messages.providerMessageId, value.payload.messageId)));
      if (message) {
        await applyProviderStatus({ accountId: message.accountId, provider: 'sms',
          providerMessageId: value.payload.messageId, status: mapped, occurredAt, fingerprint,
          details: { ...(mapped === 'failed' ? { errorCode: value.event === 'sms:cancelled' ? 'GATEWAY_CANCELLED' : 'GATEWAY_FAILED' } : {}),
            ...(value.payload.reason ? { failureReason: value.payload.reason.slice(0, 120) } : {}),
            ...(value.payload.partsCount ? { partsCount: value.payload.partsCount } : {}) } });
      }
    }
    await db.update(providerWebhookEvents).set({ processedAt: new Date() }).where(eq(providerWebhookEvents.id, event.id));
    return { done: true };
  } catch (error) {
    await db.update(providerWebhookEvents).set({ lastError: (error instanceof Error ? error.message : 'Processing failed').slice(0, 240) })
      .where(eq(providerWebhookEvents.id, event.id));
    throw error;
  }
}

const atCallbackSchema = z.object({ id: z.string(), status: z.string(), phoneNumber: z.string().optional(),
  networkCode: z.string().optional(), failureReason: z.string().optional(), retryCount: z.string().optional() });

export async function processAtCallback(eventId: string) {
  const [event] = await db.select().from(providerWebhookEvents).where(and(eq(providerWebhookEvents.id, eventId),
    eq(providerWebhookEvents.provider, 'africastalking'))).limit(1);
  if (!event || event.processedAt) return { done: true };
  try {
    const payload = atCallbackSchema.safeParse(JSON.parse(event.rawPayload));
    if (!payload.success) throw new Error('Invalid Africa\'s Talking callback');
    const value = payload.data;
    const mapped = value.status === 'Success' ? 'delivered' : ['Failed', 'Rejected', 'Expired', 'AbsentSubscriber'].includes(value.status) ? 'failed'
      : ['Sent', 'Submitted', 'Buffered'].includes(value.status) ? 'sent' : null;
    if (mapped) {
      const fingerprint = sha256(JSON.stringify({ id: value.id, status: value.status, phone: value.phoneNumber,
        network: value.networkCode, failure: value.failureReason, retryCount: value.retryCount }));
      const [message] = await db.select({ accountId: messages.accountId }).from(messages)
        .where(and(eq(messages.channel, 'sms'), eq(messages.providerMessageId, value.id)));
      if (message) await applyProviderStatus({ accountId: message.accountId, provider: 'sms', providerMessageId: value.id,
        status: mapped, occurredAt: new Date(), fingerprint,
        details: { failureReason: value.failureReason?.slice(0, 120), networkCode: value.networkCode?.slice(0, 20) } });
    }
    await db.update(providerWebhookEvents).set({ processedAt: new Date() }).where(eq(providerWebhookEvents.id, event.id));
    return { done: true };
  } catch (error) {
    await db.update(providerWebhookEvents).set({ lastError: (error instanceof Error ? error.message : 'Processing failed').slice(0, 240) })
      .where(eq(providerWebhookEvents.id, event.id));
    throw error;
  }
}
