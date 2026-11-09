import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { closeTestDb, ensureTestDb, getTestDb, resetTestDb, type TestDb } from './helpers/db.js';
import {
  seedAccount, seedDailyUsage, seedLedgerWallets, seedMessage, seedProject,
  seedReservation, seedUser, seedWebhookEndpoint,
} from './helpers/seed.js';

vi.mock('../server/db/client.js', async () => {
  const harness = await import('./helpers/db.js');
  return { pool: {}, closeDb: async () => {}, db: harness.getTestDb() };
});

import { applyProviderStatus, markAccepted, markPendingReconciliation, markRetryable, resolveReservation } from '../server/services/status.js';
import {
  auditEvents, deliveryEvents, jobs, ledgerAccounts, messages,
} from '../server/db/schema.js';

beforeAll(ensureTestDb, 120_000);
beforeEach(() => resetTestDb());
afterAll(closeTestDb);

const fingerprint = () => `fp-${randomUUID()}`;

async function deliveredScenario(
  db: TestDb,
  overrides: Partial<typeof messages.$inferInsert> = {},
  options: { endpoint?: boolean } = {},
) {
  const account = await seedAccount(db);
  const project = await seedProject(db, account.id);
  await seedLedgerWallets(db, account.id, 5000, 400);
  const message = await seedMessage(db, account.id, project.id, overrides);
  await seedReservation(db, message, 400);
  if (options.endpoint) await seedWebhookEndpoint(db, account.id, project.id);
  return { db, account, project, message };
}

async function wxStatus(
  message: typeof messages.$inferSelect,
  status: string,
  pricing?: { type: string; category: string },
  overrideFingerprint?: string,
) {
  return {
    accountId: message.accountId,
    provider: 'whatsapp' as const,
    providerMessageId: message.providerMessageId!,
    status,
    fingerprint: overrideFingerprint ?? fingerprint(),
    details: { timestamp: Date.now() } as Record<string, unknown>,
    ...(pricing ? { pricing } : {}),
  };
}

async function kindBalance(db: TestDb, accountId: string | null, kind: string): Promise<number> {
  const rows = await db.select().from(ledgerAccounts);
  return rows.find(row => row.kind === kind && row.accountId === accountId)?.balanceMinor ?? 0;
}

describe('applyProviderStatus — SMS billing semantics', () => {
  it('settles the reservation when the SMS reports delivered', async () => {
    const { db, message } = await deliveredScenario(getTestDb());
    const result = await applyProviderStatus({
      accountId: message.accountId, provider: 'sms', providerMessageId: message.providerMessageId!,
      status: 'delivered', fingerprint: fingerprint(), details: { timestamp: Date.now() },
    });

    expect(result).toMatchObject({ duplicate: false, messageFound: true, status: 'delivered' });
    expect(await kindBalance(db, message.accountId, 'customer_available')).toBe(5000);
    expect(await kindBalance(db, message.accountId, 'customer_reserved')).toBe(0);
    expect(await kindBalance(db, null, 'platform_revenue')).toBe(400);

    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.chargedMinor).toBe(400);
    expect(updated?.reservationStatus).toBe('settled');
  });

  it('keeps the reservation reserved and audits reconciliation on SMS failure', async () => {
    const { db, message } = await deliveredScenario(getTestDb());
    await applyProviderStatus({
      accountId: message.accountId, provider: 'sms', providerMessageId: message.providerMessageId!,
      status: 'failed', fingerprint: fingerprint(), details: { errorCode: 'E2001' },
    });

    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.status).toBe('failed');
    expect(updated?.errorCode).toBe('E2001');
    expect(updated?.reservationStatus).toBe('reserved');
    expect(await kindBalance(db, message.accountId, 'customer_reserved')).toBe(400);
    expect(await kindBalance(db, null, 'platform_revenue')).toBe(0);

    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'message.reconciliation_required'));
    expect(audit?.details).toMatchObject({ reason: 'sms_failed_charge_uncertain' });
  });

  it('moves sending -> delivered through intermediate ranks without regressing', async () => {
    const { db, message } = await deliveredScenario(getTestDb(), { status: 'sending', reservationStatus: 'reserved' });

    await applyProviderStatus({
      accountId: message.accountId, provider: 'sms', providerMessageId: message.providerMessageId!,
      status: 'sent', fingerprint: fingerprint(), details: {},
    });
    let [current] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(current?.status).toBe('sent');
    expect(current?.reservationStatus).toBe('reserved');

    await applyProviderStatus({
      accountId: message.accountId, provider: 'sms', providerMessageId: message.providerMessageId!,
      status: 'delivered', fingerprint: fingerprint(), details: {},
    });
    [current] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(current?.status).toBe('delivered');
    expect(current?.chargedMinor).toBe(400);

    // A late inferior event must not regress the terminal delivered state.
    const result = await applyProviderStatus({
      accountId: message.accountId, provider: 'sms', providerMessageId: message.providerMessageId!,
      status: 'sent', fingerprint: fingerprint(), details: {},
    });
    expect(result).toMatchObject({ messageFound: true, status: 'delivered' });
    [current] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(current?.status).toBe('delivered');
  });
});

describe('applyProviderStatus — WhatsApp billing semantics', () => {
  it('charges the conversation price on delivered events typed regular', async () => {
    const { db, message } = await deliveredScenario(getTestDb(), { channel: 'whatsapp', sender: 'phoneabc' });
    const result = await applyProviderStatus(await wxStatus(message, 'delivered', { type: 'regular', category: 'marketing' }));
    expect(result).toMatchObject({ status: 'delivered' });
    expect(await kindBalance(db, null, 'platform_revenue')).toBe(400);
    expect(await kindBalance(db, message.accountId, 'customer_reserved')).toBe(0);
  });

  it('releases the reservation for free entry points and customer-service delivery', async () => {
    const { db, message } = await deliveredScenario(getTestDb(), { channel: 'whatsapp', sender: 'phoneabc' });
    await applyProviderStatus(await wxStatus(message, 'delivered', { type: 'free_entry_point', category: 'marketing' }));

    expect(await kindBalance(db, message.accountId, 'customer_available')).toBe(5400);
    expect(await kindBalance(db, message.accountId, 'customer_reserved')).toBe(0);
    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.reservationStatus).toBe('released');
    expect(updated?.chargedMinor).toBe(0);
  });

  it('flags missing pricing for admin reconciliation instead of guessing a charge', async () => {
    const { db, message } = await deliveredScenario(getTestDb(), { channel: 'whatsapp', sender: 'phoneabc' });
    await applyProviderStatus(await wxStatus(message, 'delivered'));

    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.status).toBe('delivered');
    expect(updated?.errorCode).toBe('PRICING_EVENT_MISSING');
    expect(updated?.reservationStatus).toBe('reserved');
    expect(await kindBalance(db, null, 'platform_revenue')).toBe(0);
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'message.reconciliation_required'));
    expect(audit?.details).toMatchObject({ reason: 'delivered_without_pricing' });
  });

  it('releases on WhatsApp failure because only delivered messages are billable', async () => {
    const { db, message } = await deliveredScenario(getTestDb(), { channel: 'whatsapp', sender: 'phoneabc' });
    await applyProviderStatus(await wxStatus(message, 'failed'));

    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.status).toBe('failed');
    expect(updated?.reservationStatus).toBe('released');
    expect(updated?.chargedMinor).toBe(0);
    expect(await kindBalance(db, message.accountId, 'customer_available')).toBe(5400);
    expect(await kindBalance(db, message.accountId, 'customer_reserved')).toBe(0);
  });

  it('never re-bills or un-bills a delivered message on late events', async () => {
    const { db, message } = await deliveredScenario(getTestDb(), { channel: 'whatsapp', sender: 'phoneabc' });
    await applyProviderStatus(await wxStatus(message, 'delivered', { type: 'regular', category: 'marketing' }));
    const revenue = await kindBalance(db, null, 'platform_revenue');
    expect(revenue).toBe(400);

    // Late failure after delivery must not undo settled billing.
    await applyProviderStatus(await wxStatus(message, 'failed', undefined, fingerprint()));
    expect(await kindBalance(db, null, 'platform_revenue')).toBe(400);
    const [still] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(still?.status).toBe('delivered');
    expect(still?.chargedMinor).toBe(400);
  });

  it('emits customer webhook events and jobs when endpoints are configured', async () => {
    const { db, message } = await deliveredScenario(getTestDb(),
      { channel: 'whatsapp', sender: 'phoneabc' }, { endpoint: true });
    await applyProviderStatus(await wxStatus(message, 'delivered', { type: 'regular', category: 'marketing' }));

    const [event] = await db.select().from(jobs).where(and(eq(jobs.kind, 'webhook.deliver'), eq(jobs.accountId, message.accountId)));
    expect(event).toBeTruthy();
  });
});

describe('duplicate delivery events', () => {
  it('treats a replayed fingerprint as a no-op', async () => {
    const { db, message } = await deliveredScenario(getTestDb());
    const shared = fingerprint();
    const first = await applyProviderStatus({
      accountId: message.accountId, provider: 'sms', providerMessageId: message.providerMessageId!,
      status: 'delivered', fingerprint: shared, details: {},
    });
    const second = await applyProviderStatus({
      accountId: message.accountId, provider: 'sms', providerMessageId: message.providerMessageId!,
      status: 'delivered', fingerprint: shared, details: {},
    });

    expect(first).toMatchObject({ duplicate: false });
    expect(second).toMatchObject({ duplicate: true });
    expect(await db.select().from(deliveryEvents)).toHaveLength(1);
    expect(await kindBalance(db, null, 'platform_revenue')).toBe(400);
  });
});

describe('resolveReservation (admin console)', () => {
  it('charges a pending reconciliation with an audit trail', async () => {
    const { db, message } = await deliveredScenario(getTestDb());
    await markPendingReconciliation(message.id, 'sms_no_final_status');
    const admin = await seedUser(db, null, { role: 'admin' });

    const outcome = await resolveReservation({
      messageId: message.id, charge: true, actorUserId: admin.id, reason: 'Provider confirmed upstream billing.',
    });
    expect(outcome).toMatchObject({ changed: true, status: 'reconciled' });
    expect(await kindBalance(db, null, 'platform_revenue')).toBe(400);
    expect(await kindBalance(db, message.accountId, 'customer_reserved')).toBe(0);
    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.errorCode).toBe('ADMIN_CHARGED');
    const [audit] = await db.select().from(auditEvents).where(eq(auditEvents.action, 'message.admin_charged'));
    expect(audit?.actorUserId).toBe(admin.id);
  });

  it('releases a pending reconciliation and restores daily usage headroom', async () => {
    const { db, project, message } = await deliveredScenario(getTestDb());
    await markPendingReconciliation(message.id, 'sms_unreachable');
    await seedDailyUsage(db, `account:${message.accountId}`, 1, 400);
    await seedDailyUsage(db, `project:${project.id}`, 1, 400);
    const admin = await seedUser(db, null, { role: 'admin' });

    const outcome = await resolveReservation({
      messageId: message.id, charge: false, actorUserId: admin.id, reason: 'Provider never billed the message.',
    });
    expect(outcome).toMatchObject({ changed: true, status: 'reconciled' });
    expect(await kindBalance(db, message.accountId, 'customer_available')).toBe(5400);
    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.errorCode).toBe('ADMIN_RELEASED');
  });

  it('is a no-op when the reservation already settled', async () => {
    const { db, message } = await deliveredScenario(getTestDb(), { status: 'delivered', reservationStatus: 'settled', chargedMinor: 400 });
    const admin = await seedUser(db, null, { role: 'admin' });
    const outcome = await resolveReservation({
      messageId: message.id, charge: true, actorUserId: admin.id, reason: 'Late duplicate request.',
    });
    expect(outcome).toEqual({ changed: false, status: 'delivered' });
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, 'message.admin_charged'))).toHaveLength(0);
  });
});

describe('worker-friendly helpers', () => {
  it('markAccepted records the provider message id and an accepted delivery event', async () => {
    const { db, message } = await deliveredScenario(getTestDb(), { status: 'queued' });
    await markAccepted({ messageId: message.id, providerMessageId: 'atp-100', supplierCostMinor: 8, supplierCurrency: 'GHS' });

    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.status).toBe('accepted');
    expect(updated?.providerMessageId).toBe('atp-100');
    expect(updated?.supplierCostMinor).toBe(8);
    const [event] = await db.select().from(deliveryEvents).where(eq(deliveryEvents.messageId, message.id));
    expect(event?.status).toBe('accepted');
  });

  it('markAccepted does not clobber a message that already progressed', async () => {
    const { db, message } = await deliveredScenario(getTestDb(), { status: 'delivered', reservationStatus: 'settled', chargedMinor: 400 });
    await markAccepted({ messageId: message.id, providerMessageId: 'atp-101' });
    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.status).toBe('delivered');
  });

  it('markRetryable returns a sending message to the queue', async () => {
    const { db, message } = await deliveredScenario(getTestDb(), { status: 'sending', reservationStatus: 'reserved' });
    await markRetryable(message.id);
    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.status).toBe('queued');
  });
});
