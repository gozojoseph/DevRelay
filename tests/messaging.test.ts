import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { closeTestDb, ensureTestDb, getTestDb, resetTestDb, type TestDb } from './helpers/db.js';
import {
  RECIPIENT, WA_RECIPIENT, seedAccount, seedConsent, seedConversation, seedLedgerWallets,
  seedProject, seedRevokedConsent, seedSender, seedSmsPrice, seedSuppression, seedTemplate,
  seedWhatsappPrice, seedWhatsappSender,
} from './helpers/seed.js';

vi.mock('../server/db/client.js', async () => {
  const harness = await import('./helpers/db.js');
  return { pool: {}, closeDb: async () => {}, db: harness.getTestDb() };
});

import { decrypt } from '../server/lib/security.js';
import { sendSms, sendWhatsapp } from '../server/services/messaging.js';
import {
  consentRecords, idempotencyRecords, jobs, ledgerAccounts, messages, messageReservations,
} from '../server/db/schema.js';

beforeAll(ensureTestDb, 120_000);
beforeEach(() => resetTestDb());
afterAll(closeTestDb);

const key = () => `key-${randomUUID()}`;

async function smsScenario(db: TestDb, options: { noPrice?: boolean } = {}) {
  const account = await seedAccount(db);
  const project = await seedProject(db, account.id);
  if (!options.noPrice) await seedSmsPrice(db, 20);
  await seedSender(db, account.id, 'DEVRELAY');
  await seedConsent(db, account.id, 'sms', RECIPIENT);
  await seedLedgerWallets(db, account.id, 100_000);
  return {
    db, account, project,
    input: {
      accountId: account.id, projectId: project.id, idempotencyKey: key(),
      body: { to: '0244000000', senderId: 'DEVRELAY', body: 'Hello from DevRelay!' },
    },
  };
}

describe('sendSms', () => {
  it('quotes, reserves credits, queues a worker job and stores the idempotency response', async () => {
    const { db, account, input } = await smsScenario(getTestDb());

    const response = await sendSms(input);
    expect(response.status).toBe('queued');
    expect(response.channel).toBe('sms');
    expect(response.recipient).toBe('+233244000000');
    expect(response.segments).toBe(1);
    expect(response.estimatedChargeMinor).toBe(20);
    expect(response.note).toContain('queued, not delivered');

    const [message] = await db.select().from(messages).where(eq(messages.id, response.id));
    expect(message?.reservationStatus).toBe('reserved');
    expect(message?.chargedMinor).toBe(0);
    expect(message?.pricingId).not.toBeNull();
    expect(decrypt(message!.bodyEncrypted!, `message:${account.id}`)).toBe('Hello from DevRelay!');

    const [reservation] = await db.select().from(messageReservations).where(eq(messageReservations.messageId, message!.id));
    expect(reservation?.amountMinor).toBe(20);
    expect(reservation?.state).toBe('reserved');

    const [job] = await db.select().from(jobs).where(eq(jobs.dedupKey, `sms:${message!.id}`));
    expect(job?.kind).toBe('sms.send');
    expect(job?.payload).toMatchObject({ messageId: message!.id });

    const [record] = await db.select().from(idempotencyRecords).where(eq(idempotencyRecords.key, input.idempotencyKey));
    expect(record?.response).toMatchObject({ id: message!.id });

    const wallets = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.accountId, account.id));
    const available = wallets.find(row => row.kind === 'customer_available');
    const reserved = wallets.find(row => row.kind === 'customer_reserved');
    expect(available?.balanceMinor).toBe(99_980);
    expect(reserved?.balanceMinor).toBe(20);
  });

  it('is idempotent: a repeated request returns the first response without charging again', async () => {
    const { db, input } = await smsScenario(getTestDb());

    const first = await sendSms(input);
    const second = await sendSms(input);
    expect(second).toEqual(first);

    expect(await db.select().from(messages)).toHaveLength(1);
    expect(await db.select().from(jobs)).toHaveLength(1);
    expect(await db.select().from(messageReservations)).toHaveLength(1);
  });

  it('rejects a reused idempotency key with a different body (409)', async () => {
    const { input } = await smsScenario(getTestDb());
    await sendSms(input);
    await expect(sendSms({ ...input, body: { ...input.body, body: 'Different message text' } }))
      .rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('requires an active account (403)', async () => {
    const db = getTestDb();
    const account = await seedAccount(db, { status: 'pending_approval' });
    const project = await seedProject(db, account.id);
    await seedSender(db, account.id, 'DEVRELAY');
    await seedSmsPrice(db);
    await seedConsent(db, account.id, 'sms', RECIPIENT);
    await seedLedgerWallets(db, account.id);

    await expect(sendSms({
      accountId: account.id, projectId: project.id, idempotencyKey: key(),
      body: { to: '0244000000', senderId: 'DEVRELAY', body: 'Hi' },
    })).rejects.toMatchObject({ status: 403, code: 'ACCOUNT_NOT_ACTIVE' });
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it('requires an approved sender (403)', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);
    await seedSender(db, account.id, 'DEVRELAY', 'pending');
    await seedSmsPrice(db);
    await seedConsent(db, account.id, 'sms', RECIPIENT);
    await seedLedgerWallets(db, account.id);

    await expect(sendSms({
      accountId: account.id, projectId: project.id, idempotencyKey: key(),
      body: { to: '0244000000', senderId: 'DEVRELAY', body: 'Hi' },
    })).rejects.toMatchObject({ status: 403, code: 'SENDER_NOT_APPROVED' });
  });

  it('blocks suppressed recipients even with stored consent, before checking money (409)', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);
    await seedSender(db, account.id);
    await seedSmsPrice(db);
    await seedConsent(db, account.id, 'sms', RECIPIENT);
    await seedSuppression(db, account.id, 'sms', RECIPIENT);
    await seedLedgerWallets(db, account.id);

    await expect(sendSms({
      accountId: account.id, projectId: project.id, idempotencyKey: key(),
      body: { to: '0244000000', senderId: 'DEVRELAY', body: 'Hi' },
    })).rejects.toMatchObject({ status: 409, code: 'RECIPIENT_SUPPRESSED' });
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it('requires living consent (409), then succeeds once consent exists', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);
    await seedSender(db, account.id);
    await seedSmsPrice(db);
    await seedLedgerWallets(db, account.id);
    const base = {
      accountId: account.id, projectId: project.id, idempotencyKey: key(),
      body: { to: '0244000000', senderId: 'DEVRELAY', body: 'Hi' },
    };

    await expect(sendSms(base)).rejects.toMatchObject({ status: 409, code: 'CONSENT_REQUIRED' });

    await seedRevokedConsent(db, account.id, 'sms', RECIPIENT);
    await expect(sendSms({ ...base, idempotencyKey: key() }))
      .rejects.toMatchObject({ status: 409, code: 'CONSENT_REQUIRED' });

    await db.update(consentRecords).set({ revokedAt: null, consentedAt: new Date() }).where(
      and(eq(consentRecords.accountId, account.id), eq(consentRecords.recipient, RECIPIENT)),
    );
    const response = await sendSms({ ...base, idempotencyKey: key() });
    expect(response.status).toBe('queued');
  });

  it('fails with PRICE_UNAVAILABLE (503) before any credit reservation', async () => {
    const { db, input } = await smsScenario(getTestDb(), { noPrice: true });

    await expect(sendSms(input)).rejects.toMatchObject({ status: 503, code: 'PRICE_UNAVAILABLE' });
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(messageReservations)).toHaveLength(0);
    expect(await db.select().from(idempotencyRecords)).toHaveLength(0);
  });

  it('fails with INSUFFICIENT_CREDITS (402) and rolls the send back entirely', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);
    await seedSmsPrice(db, 20);
    await seedSender(db, account.id);
    await seedConsent(db, account.id, 'sms', RECIPIENT);
    await seedLedgerWallets(db, account.id, 10);

    await expect(sendSms({
      accountId: account.id, projectId: project.id, idempotencyKey: key(),
      body: { to: '0244000000', senderId: 'DEVRELAY', body: 'Hi' },
    })).rejects.toMatchObject({ status: 402, code: 'INSUFFICIENT_CREDITS' });

    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(messageReservations)).toHaveLength(0);
    expect(await db.select().from(idempotencyRecords)).toHaveLength(0);
    const [wallet] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.accountId, account.id));
    expect(wallet?.balanceMinor).toBe(10);
  });
});

describe('sendWhatsapp', () => {
  async function whatsappScenario(
    db: TestDb,
    templateOverrides: Partial<Record<string, unknown>> = {},
  ) {
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);
    await seedWhatsappPrice(db, 'marketing', 150);
    await seedWhatsappPrice(db, 'service', 60);
    const { connection, number } = await seedWhatsappSender(db, account.id);
    const template = await seedTemplate(db, account.id, connection.id, templateOverrides);
    await seedConsent(db, account.id, 'whatsapp', WA_RECIPIENT);
    await seedLedgerWallets(db, account.id, 100_000);
    return {
      db, account, project, connection, number, template,
      input: {
        accountId: account.id, projectId: project.id, idempotencyKey: key(),
        body: { to: '0201234567', template: { name: 'delivery_update', language: 'en', variables: [] } },
      },
    };
  }

  it('sends an approved template and reserves its category price', async () => {
    const { db, number, input } = await whatsappScenario(getTestDb());

    const response = await sendWhatsapp(input);
    expect(response.status).toBe('queued');
    expect(response.recipient).toBe(WA_RECIPIENT);
    expect(response.estimatedChargeMinor).toBe(150);

    const [message] = await db.select().from(messages).where(eq(messages.id, response.id));
    expect(message?.channel).toBe('whatsapp');
    expect(message?.templateName).toBe('delivery_update');
    expect(message?.whatsappPhoneId).toBe(number.id);
    expect(message?.sender).toBe(number.metaPhoneId);

    const [job] = await db.select().from(jobs).where(eq(jobs.dedupKey, `whatsapp:${message!.id}`));
    expect(job?.kind).toBe('whatsapp.send');
  });

  it('reuses the first response on an identical repeated request', async () => {
    const { db, input } = await whatsappScenario(getTestDb());
    const first = await sendWhatsapp(input);
    const second = await sendWhatsapp(input);
    expect(second).toEqual(first);
    expect(await db.select().from(messages)).toHaveLength(1);
  });

  it('sends free-form text only while the 24-hour service window is open (409 otherwise)', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);
    await seedWhatsappPrice(db, 'service', 60);
    const { number } = await seedWhatsappSender(db, account.id);
    await seedConsent(db, account.id, 'whatsapp', WA_RECIPIENT);
    await seedLedgerWallets(db, account.id);
    const input = {
      accountId: account.id, projectId: project.id, idempotencyKey: key(),
      body: { to: '0201234567', text: 'Hi from DevRelay' },
    };

    await expect(sendWhatsapp(input)).rejects.toMatchObject({ status: 409, code: 'SERVICE_WINDOW_CLOSED' });

    await seedConversation(db, account.id, number.id);
    const response = await sendWhatsapp({ ...input, idempotencyKey: key() });
    expect(response.estimatedChargeMinor).toBe(60);
    const [message] = await db.select().from(messages).where(eq(messages.id, response.id));
    expect(message?.templateName).toBeNull();

    await seedConversation(db, account.id, number.id, { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) });
    await expect(sendWhatsapp({ ...input, idempotencyKey: key() }))
      .rejects.toMatchObject({ status: 409, code: 'SERVICE_WINDOW_CLOSED' });
  });

  it('requires an active number connected to an active WhatsApp connection (503)', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);
    await seedWhatsappPrice(db);
    await seedWhatsappSender(db, account.id, { connectionStatus: 'pending_registration' });
    await seedConsent(db, account.id, 'whatsapp', WA_RECIPIENT);
    await seedLedgerWallets(db, account.id);

    await expect(sendWhatsapp({
      accountId: account.id, projectId: project.id, idempotencyKey: key(),
      body: { to: '0201234567', text: 'Hi' },
    })).rejects.toMatchObject({ status: 503, code: 'WHATSAPP_NUMBER_UNAVAILABLE' });
  });

  it('rejects pending, missing and variable-mismatched templates', async () => {
    const pending = await whatsappScenario(getTestDb(), { status: 'PENDING' });
    await expect(sendWhatsapp(pending.input)).rejects.toMatchObject({ status: 409, code: 'TEMPLATE_NOT_APPROVED' });

    const missing = await whatsappScenario(getTestDb(), { name: 'renamed_template' });
    await expect(sendWhatsapp(missing.input)).rejects.toMatchObject({ status: 404, code: 'TEMPLATE_NOT_FOUND' });

    const mismatch = await whatsappScenario(getTestDb(), { variableCount: 2 });
    await expect(sendWhatsapp(mismatch.input)).rejects.toMatchObject({ status: 400, code: 'TEMPLATE_VARIABLES' });
  });
});
