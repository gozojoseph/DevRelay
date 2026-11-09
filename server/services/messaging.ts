import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { availability } from '../config.js';
import { db, type DbTransaction } from '../db/client.js';
import { accounts, consentRecords, conversations, idempotencyRecords, messages,
  messageReservations, projects, rateCounters, senderRequests, suppressions,
  whatsappConnections, whatsappNumbers, whatsappTemplates } from '../db/schema.js';
import { ApiError, assert } from '../lib/http.js';
import { encrypt, sha256 } from '../lib/security.js';
import { currentPrice, normalizePhone, quoteMinor, smsSegments } from './pricing.js';
import { enqueue } from './jobs.js';
import { incrementUsage, transfer } from './ledger.js';

export const SMS_BODY_LIMIT = 1600;
export const sendSmsSchema = z.object({ to: z.string().min(8).max(24), senderId: z.string().min(3).max(11),
  body: z.string().min(1).max(SMS_BODY_LIMIT) }).strict();
export const sendWhatsappSchema = z.object({ to: z.string().min(8).max(24), phoneNumberId: z.uuid().optional(),
  text: z.string().min(1).max(4096).optional(), template: z.object({ name: z.string().min(1).max(180),
    language: z.string().min(2).max(18), variables: z.array(z.string().max(1024)).max(20).default([]) }).optional(),
}).strict().refine(value => Boolean(value.text) !== Boolean(value.template), { message: 'Provide exactly one of text or template.' });

export type SmsInput = z.infer<typeof sendSmsSchema>;
export type WhatsappInput = z.infer<typeof sendWhatsappSchema>;

export async function apiRateLimit(keyId: string, limit: number) {
  const minute = new Date(Math.floor(Date.now() / 60000) * 60000);
  const [row] = await db.insert(rateCounters).values({ key: `api:${keyId}`, minute, count: 1 })
    .onConflictDoUpdate({ target: [rateCounters.key, rateCounters.minute], set: { count: sql`${rateCounters.count} + 1` } }).returning();
  const count = row?.count ?? 1;
  return { limit, remaining: Math.max(0, limit - count), reset: Math.floor((minute.getTime() + 60000) / 1000), exceeded: count > limit };
}

async function getContext(tx: DbTransaction, accountId: string, projectId: string) {
  const [row] = await tx.select({ account: accounts, project: projects })
    .from(projects).innerJoin(accounts, eq(accounts.id, projects.accountId))
    .where(and(eq(projects.id, projectId), eq(projects.accountId, accountId)));
  assert(row, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  return row;
}

async function assertSendable(tx: DbTransaction, accountId: string, channel: 'sms' | 'whatsapp', recipient: string) {
  const [suppressed] = await tx.select().from(suppressions).where(and(eq(suppressions.accountId, accountId),
    eq(suppressions.channel, channel), eq(suppressions.recipient, recipient)));
  if (suppressed) throw new ApiError(409, 'RECIPIENT_SUPPRESSED', 'Recipient is on the suppression list.');
  const [consent] = await tx.select().from(consentRecords).where(and(eq(consentRecords.accountId, accountId),
    eq(consentRecords.channel, channel), eq(consentRecords.recipient, recipient)));
  if (!consent || consent.revokedAt) throw new ApiError(409, 'CONSENT_REQUIRED', 'Record recipient consent in the dashboard before sending.');
}

function idempotencyResult(existing: typeof idempotencyRecords.$inferSelect, bodyHash: string) {
  if (existing.bodyHash !== bodyHash) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'This Idempotency-Key was used with a different request body.');
  return existing.response;
}

function acceptedBody(message: typeof messages.$inferSelect) {
  return { id: message.id, status: 'queued', channel: message.channel, recipient: message.recipient,
    segments: message.segments, estimatedChargeMinor: message.quotedMinor, currency: 'GHS',
    acceptedAt: message.acceptedAt?.toISOString() ?? new Date().toISOString(), note: 'Accepted means queued, not delivered.' };
}

/**
 * Idempotency is claimed inside the send transaction before any credits move.
 * A competing request blocks on the unique key; it then reads the winner after
 * commit instead of reserving credits a second time.
 */
async function claim(tx: DbTransaction, projectId: string, key: string, bodyHash: string) {
  const [record] = await tx.insert(idempotencyRecords).values({ projectId, key, bodyHash, response: { pending: true } })
    .onConflictDoNothing().returning();
  if (record) return { record, existing: null };
  const [existing] = await tx.select().from(idempotencyRecords).where(and(
    eq(idempotencyRecords.projectId, projectId), eq(idempotencyRecords.key, key)));
  assert(existing, 500, 'IDEMPOTENCY_ERROR', 'Idempotency result unavailable.');
  return { record: null, existing };
}

export async function sendSms(input: { accountId: string; projectId: string; idempotencyKey: string; body: SmsInput }) {
  if (!availability().sms) throw new ApiError(503, 'SMS_UNAVAILABLE', 'SMS sending is not configured. Contact support.');
  const normalized = normalizePhone(input.body.to, true);
  const segments = smsSegments(input.body.body);
  const bodyHash = sha256(JSON.stringify(input.body));
  return db.transaction(async tx => {
    const { record, existing } = await claim(tx, input.projectId, input.idempotencyKey, bodyHash);
    if (existing) return idempotencyResult(existing, bodyHash);
    const { account, project } = await getContext(tx, input.accountId, input.projectId);
    assert(account.status === 'active', 403, 'ACCOUNT_NOT_ACTIVE', 'Account approval is required before sending.');
    assert(account.country === 'GH', 403, 'UNSUPPORTED_COUNTRY', 'SMS billing currently supports Ghana accounts only.');
    const [sender] = await tx.select().from(senderRequests).where(and(eq(senderRequests.accountId, input.accountId),
      eq(senderRequests.senderId, input.body.senderId), eq(senderRequests.status, 'approved')));
    if (!sender) throw new ApiError(403, 'SENDER_NOT_APPROVED', 'Use an approved SMS sender ID.');
    await assertSendable(tx, input.accountId, 'sms', normalized.e164);
    const price = await currentPrice({ channel: 'sms', country: 'GH', route: 'ghana_standard', category: 'transactional' }, tx);
    const quotedMinor = quoteMinor(price.customerUnitMinor, segments.count);
    await incrementUsage(tx, account, project, quotedMinor);
    await transfer(tx, { accountId: input.accountId, from: 'customer_available', to: 'customer_reserved',
      value: quotedMinor, kind: 'message_reservation', reference: `reserve:${record!.id}` });
    const [message] = await tx.insert(messages).values({ accountId: input.accountId, projectId: input.projectId,
      channel: 'sms', recipient: normalized.e164, sender: input.body.senderId,
      bodyEncrypted: encrypt(input.body.body, `message:${input.accountId}`), segments: segments.count,
      pricingId: price.id, quotedMinor, reservationStatus: 'reserved', status: 'queued', acceptedAt: new Date() }).returning();
    assert(message, 500, 'MESSAGE_ERROR', 'Could not record message.');
    await tx.insert(messageReservations).values({ messageId: message.id, accountId: input.accountId, amountMinor: quotedMinor });
    await enqueue(tx, { kind: 'sms.send', dedupKey: `sms:${message.id}`, accountId: input.accountId,
      projectId: input.projectId, payload: { messageId: message.id } });
    const response = acceptedBody(message);
    await tx.update(idempotencyRecords).set({ response, messageId: message.id }).where(eq(idempotencyRecords.id, record!.id));
    return response;
  });
}

export async function sendWhatsapp(input: { accountId: string; projectId: string; idempotencyKey: string; body: WhatsappInput }) {
  if (!availability().whatsappTest && !availability().whatsappLive) {
    throw new ApiError(503, 'WHATSAPP_UNAVAILABLE', 'WhatsApp sending is not configured. Contact support.');
  }
  const normalized = normalizePhone(input.body.to, false);
  const bodyHash = sha256(JSON.stringify(input.body));
  return db.transaction(async tx => {
    const { record, existing } = await claim(tx, input.projectId, input.idempotencyKey, bodyHash);
    if (existing) return idempotencyResult(existing, bodyHash);
    const { account, project } = await getContext(tx, input.accountId, input.projectId);
    assert(account.status === 'active', 403, 'ACCOUNT_NOT_ACTIVE', 'Account approval is required before sending.');

    const numberConditions = [eq(whatsappNumbers.accountId, input.accountId), eq(whatsappNumbers.status, 'active'),
      eq(whatsappConnections.status, 'active'), eq(whatsappConnections.accountId, input.accountId)];
    if (input.body.phoneNumberId) numberConditions.push(eq(whatsappNumbers.id, input.body.phoneNumberId));
    const [selection] = await tx.select({ connection: whatsappConnections, number: whatsappNumbers })
      .from(whatsappNumbers).innerJoin(whatsappConnections, eq(whatsappConnections.id, whatsappNumbers.connectionId))
      .where(and(...numberConditions)).orderBy(desc(whatsappNumbers.createdAt)).limit(1);
    assert(selection, 503, 'WHATSAPP_NUMBER_UNAVAILABLE', 'No active WhatsApp sender number was found.');
    const { connection, number } = selection;

    await assertSendable(tx, input.accountId, 'whatsapp', normalized.e164);
    let category: string; let templateName: string | null = null; let templateLanguage: string | null = null;
    let variables: string[] = [];

    if (input.body.template) {
      const [template] = await tx.select().from(whatsappTemplates).where(and(eq(whatsappTemplates.connectionId, connection.id),
        eq(whatsappTemplates.name, input.body.template.name), eq(whatsappTemplates.language, input.body.template.language)));
      if (!template) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'WhatsApp template not found for this connection.');
      if (template.status !== 'APPROVED') throw new ApiError(409, 'TEMPLATE_NOT_APPROVED', 'Only Meta-approved templates can be sent.');
      if (template.variableCount !== input.body.template.variables.length) {
        throw new ApiError(400, 'TEMPLATE_VARIABLES', `This template requires ${template.variableCount} variables.`);
      }
      templateName = template.name; templateLanguage = template.language;
      category = template.category.toLowerCase(); variables = input.body.template.variables;
    } else {
      const [conversation] = await tx.select().from(conversations).where(and(eq(conversations.phoneId, number.id),
        eq(conversations.recipient, normalized.e164)));
      if (!conversation?.lastInboundAt || conversation.lastInboundAt.getTime() + 86400000 <= Date.now()) {
        throw new ApiError(409, 'SERVICE_WINDOW_CLOSED', 'The 24-hour customer service window is closed. Use an approved template.');
      }
      category = 'service';
    }
    const price = await currentPrice({ channel: 'whatsapp', country: normalized.country, route: 'meta_cloud', category }, tx);
    const quotedMinor = quoteMinor(price.customerUnitMinor, 1);
    const pricingId = price.id;
    await incrementUsage(tx, account, project, quotedMinor);
    await transfer(tx, { accountId: input.accountId, from: 'customer_available', to: 'customer_reserved',
      value: quotedMinor, kind: 'message_reservation', reference: `reserve:${record!.id}` });
    const [message] = await tx.insert(messages).values({ accountId: input.accountId, projectId: input.projectId,
      channel: 'whatsapp', recipient: normalized.e164, sender: number.metaPhoneId, whatsappPhoneId: number.id,
      bodyEncrypted: input.body.text ? encrypt(input.body.text, `message:${input.accountId}`) : null,
      templateName, templateLanguage, variablesEncrypted: variables.length ? encrypt(JSON.stringify(variables), `message:${input.accountId}`) : null,
      segments: 1, pricingId, quotedMinor, reservationStatus: 'reserved', status: 'queued', acceptedAt: new Date() }).returning();
    assert(message, 500, 'MESSAGE_ERROR', 'Could not record message.');
    await tx.insert(messageReservations).values({ messageId: message.id, accountId: input.accountId, amountMinor: quotedMinor });
    await enqueue(tx, { kind: 'whatsapp.send', dedupKey: `whatsapp:${message.id}`, accountId: input.accountId,
      projectId: input.projectId, payload: { messageId: message.id } });
    const response = acceptedBody(message);
    await tx.update(idempotencyRecords).set({ response, messageId: message.id }).where(eq(idempotencyRecords.id, record!.id));
    return response;
  });
}
