import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, auditEvents, deliveryEvents, messages, projects } from '../db/schema.js';
import { sha256 } from '../lib/security.js';
import { settleReservation } from './ledger.js';
import { emitMessageEvent } from './webhooks.js';

const rank: Record<string, number> = { queued: 0, sending: 1, accepted: 2, sent: 3, delivered: 4, read: 5, failed: 6,
  pending_reconciliation: -1, reconciled: 8, incoming: 9 };
const terminal = new Set(['delivered', 'read', 'reconciled']);

export type PricingInfo = { type?: string; category?: string; billable?: boolean };

export async function applyProviderStatus(input: {
  accountId: string; provider: 'sms' | 'whatsapp'; providerMessageId: string; status: string;
  occurredAt?: Date; fingerprint: string; details: Record<string, unknown>; pricing?: PricingInfo;
}) {
  return db.transaction(async tx => {
    const [existingEvent] = await tx.select().from(deliveryEvents).where(and(eq(deliveryEvents.provider, input.provider),
      eq(deliveryEvents.fingerprint, input.fingerprint))).limit(1);
    if (existingEvent) return { duplicate: true };
    const [message] = await tx.select().from(messages).where(and(eq(messages.channel, input.provider),
      eq(messages.providerMessageId, input.providerMessageId), eq(messages.accountId, input.accountId))).for('update');
    if (!message) {
      await tx.insert(deliveryEvents).values({ accountId: input.accountId, provider: input.provider,
        providerMessageId: input.providerMessageId, fingerprint: input.fingerprint, status: input.status,
        occurredAt: input.occurredAt, details: input.details });
      return { messageFound: false };
    }
    const priorStatus = message.status;
    const currentRank = rank[priorStatus] ?? -1;
    const incomingRank = rank[input.status] ?? -1;
    const shouldAdvance = !terminal.has(priorStatus) && incomingRank >= currentRank && priorStatus !== 'failed';
    await tx.insert(deliveryEvents).values({ accountId: input.accountId, messageId: message.id, provider: input.provider,
      providerMessageId: input.providerMessageId, fingerprint: input.fingerprint, status: input.status,
      occurredAt: input.occurredAt, details: { ...input.details, ...(input.pricing ? { pricing: input.pricing } : {}) } });

    const pricingType = input.pricing?.type ?? message.providerPricingType ?? undefined;
    const pricingCategory = input.pricing?.category ?? message.providerPricingCategory ?? undefined;
    let nextStatus = message.status;
    let errorCode = message.errorCode;
    if (shouldAdvance) {
      nextStatus = input.status as typeof message.status;
      if (input.status === 'failed') errorCode = typeof input.details.errorCode === 'string' ? input.details.errorCode.slice(0, 60) : 'PROVIDER_FAILED';
    }

    // SMS: final success settles. Final or ambiguous failure intentionally keeps
    // the reservation for manual reconciliation because upstream may still bill.
    if (input.provider === 'sms' && input.status === 'delivered' && message.reservationStatus === 'reserved') {
      await settleReservation(tx, message, true);
    }
    if (input.provider === 'whatsapp' && input.status === 'delivered') {
      const free = pricingType === 'free_entry_point' || pricingType === 'free_customer_service';
      if (free) await settleReservation(tx, message, false);
      else if (pricingType === 'regular') await settleReservation(tx, message, true);
      else {
        errorCode = 'PRICING_EVENT_MISSING';
        await tx.insert(auditEvents).values({ accountId: input.accountId, action: 'message.reconciliation_required',
          targetType: 'message', targetId: message.id, details: { reason: 'delivered_without_pricing' } });
      }
    }
    if (input.provider === 'whatsapp' && input.status === 'failed' && shouldAdvance &&
      message.reservationStatus === 'reserved') {
      // Official Meta pricing states only delivered messages are billable. This
      // explicit provider failure is therefore released, unlike an SMS failure.
      // A late failure after a delivered status must not undo delivery billing.
      await settleReservation(tx, message, false);
    }
    if (input.provider === 'sms' && input.status === 'failed' && message.reservationStatus === 'reserved') {
      await tx.insert(auditEvents).values({ accountId: input.accountId, action: 'message.reconciliation_required',
        targetType: 'message', targetId: message.id, details: { reason: 'sms_failed_charge_uncertain' } });
    }
    const [updated] = await tx.update(messages).set({ status: nextStatus, errorCode,
      providerPricingType: pricingType ?? null, providerPricingCategory: pricingCategory ?? null,
      lastProviderAt: input.occurredAt ?? new Date(), updatedAt: new Date() }).where(eq(messages.id, message.id)).returning();
    if (updated && updated.status !== priorStatus) {
      const type = updated.status === 'failed' ? 'message.failed' : updated.status === 'delivered' ? 'message.delivered'
        : updated.status === 'read' ? 'message.read' : updated.status === 'sent' ? 'message.sent' : 'message.updated';
      await emitMessageEvent(tx, updated, type);
    }
    return { messageFound: true, status: updated?.status, duplicate: false };
  });
}

export async function markAccepted(input: { messageId: string; providerMessageId: string; supplierCostMinor?: number; supplierCurrency?: string }) {
  return db.transaction(async tx => {
    const [message] = await tx.select().from(messages).where(eq(messages.id, input.messageId)).for('update');
    if (!message) return;
    // A fast delivery callback can arrive before the send call returns. Never
    // regress a message that has already moved past accepted.
    const [updated] = await tx.update(messages).set({ status: 'accepted', providerMessageId: input.providerMessageId,
      supplierCostMinor: input.supplierCostMinor ?? null, supplierCurrency: input.supplierCurrency ?? null,
      lastProviderAt: new Date(), updatedAt: new Date() })
      .where(and(eq(messages.id, input.messageId), inArray(messages.status, ['queued', 'sending']))).returning();
    if (updated) {
      await tx.insert(deliveryEvents).values({ accountId: updated.accountId, messageId: updated.id, provider: updated.channel,
        providerMessageId: input.providerMessageId, fingerprint: sha256(`accepted:${updated.channel}:${input.providerMessageId}`),
        status: 'accepted', occurredAt: new Date(), details: {} }).onConflictDoNothing();
      await emitMessageEvent(tx, updated, 'message.accepted');
    }
  });
}

export async function markRetryable(messageId: string) {
  return db.transaction(async tx => {
    const [message] = await tx.select().from(messages).where(eq(messages.id, messageId)).for('update');
    if (!message || message.status !== 'sending') return;
    await tx.update(messages).set({ status: 'queued', updatedAt: new Date() }).where(eq(messages.id, messageId));
  });
}

export async function resolveReservation(input: { messageId: string; charge: boolean; actorUserId: string; reason: string }) {
  return db.transaction(async tx => {
    const [message] = await tx.select().from(messages).where(eq(messages.id, input.messageId)).for('update');
    if (!message) return null;
    if (message.reservationStatus !== 'reserved') return { changed: false, status: message.status };
    await settleReservation(tx, message, input.charge);
    const [updated] = await tx.update(messages).set({ status: 'reconciled',
      errorCode: input.charge ? 'ADMIN_CHARGED' : 'ADMIN_RELEASED', updatedAt: new Date() })
      .where(eq(messages.id, message.id)).returning();
    await tx.insert(auditEvents).values({ actorUserId: input.actorUserId, accountId: message.accountId,
      action: input.charge ? 'message.admin_charged' : 'message.admin_released', targetType: 'message',
      targetId: message.id, details: { reason: input.reason.slice(0, 500) } });
    if (updated && updated.projectId) await emitMessageEvent(tx, updated, 'message.reconciled');
    return { changed: true, status: updated?.status };
  });
}

export async function markFailedWithoutCharge(messageId: string, code: string) {
  return db.transaction(async tx => {
    const [message] = await tx.select().from(messages).where(eq(messages.id, messageId)).for('update');
    if (!message || message.reservationStatus !== 'reserved') return;
    await settleReservation(tx, message, false);
    const [updated] = await tx.update(messages).set({ status: 'failed', errorCode: code, updatedAt: new Date() }).where(eq(messages.id, messageId)).returning();
    if (updated) await emitMessageEvent(tx, updated, 'message.failed');
  });
}

export async function markPendingReconciliation(messageId: string, code: string) {
  return db.transaction(async tx => {
    const [message] = await tx.select().from(messages).where(eq(messages.id, messageId)).for('update');
    if (!message || message.reservationStatus !== 'reserved') return;
    await tx.update(messages).set({ status: 'pending_reconciliation', errorCode: code, updatedAt: new Date() }).where(eq(messages.id, messageId));
    await tx.insert(auditEvents).values({ accountId: message.accountId, action: 'message.reconciliation_required',
      targetType: 'message', targetId: message.id, details: { reason: code } });
  });
}

export async function releaseUnsent(messageId: string, code: string) {
  return markFailedWithoutCharge(messageId, code);
}

export async function messageForAccount(accountId: string, messageId: string) {
  const [row] = await db.select({ message: messages, project: projects }).from(messages)
    .leftJoin(projects, eq(projects.id, messages.projectId)).where(and(eq(messages.id, messageId), eq(messages.accountId, accountId)));
  return row;
}

export async function accountCanSend(accountId: string) {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId));
  return account?.status === 'active';
}
