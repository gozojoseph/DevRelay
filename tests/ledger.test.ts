import { beforeEach, afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { closeTestDb, ensureTestDb, getTestDb, resetTestDb, type TestDb } from './helpers/db.js';
import { seedAccount, seedDailyUsage, seedMessage, seedLedgerWallets, seedProject, seedReservation } from './helpers/seed.js';

vi.mock('../server/db/client.js', async () => {
  const harness = await import('./helpers/db.js');
  return { pool: {}, closeDb: async () => {}, db: harness.getTestDb() };
});

import { balance, createWallet, incrementUsage, settleReservation, transfer } from '../server/services/ledger.js';
import {
  dailyUsage, ledgerAccounts, ledgerEntries, ledgerTransactions, messageReservations, messages,
} from '../server/db/schema.js';

beforeAll(ensureTestDb, 120_000);
beforeEach(() => resetTestDb());
afterAll(closeTestDb);

async function kindBalance(db: TestDb, accountId: string | null, kind: string): Promise<number> {
  const rows = await db.select().from(ledgerAccounts);
  const match = rows.find(row => row.kind === kind && (row.accountId === accountId));
  return match?.balanceMinor ?? 0;
}

describe('ledger transfers', () => {
  it('creates a balanced double-entry transfer with correct balances', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);

    await db.transaction(async tx => {
      await createWallet(tx, account.id);
      const transactionId = await transfer(tx, {
        accountId: account.id, from: 'platform_funding', to: 'customer_available',
        value: 2500, kind: 'funding', reference: `fund:${randomUUID()}`,
      });
      const entries = await tx.select().from(ledgerEntries).where(eq(ledgerEntries.transactionId, transactionId));
      expect(entries).toHaveLength(2);
      expect(entries.reduce((sum, entry) => sum + entry.amountMinor, 0)).toBe(0);
    });

    expect(await balance(account.id)).toEqual({ currency: 'GHS', availableMinor: 2500, reservedMinor: 0 });
    expect(await kindBalance(db, null, 'platform_funding')).toBe(-2500);
  });

  it('rejects transferring more than the customer balance moves nothing', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);
    await seedLedgerWallets(db, account.id, 1000);

    await expect(transfer(db as unknown as Parameters<typeof transfer>[0], {
      accountId: account.id, from: 'customer_available', to: 'customer_reserved',
      value: 2000, kind: 'message_reservation', reference: `reserve:${randomUUID()}`,
    })).rejects.toMatchObject({ status: 402, code: 'INSUFFICIENT_CREDITS' });

    const transactions = await db.select().from(ledgerTransactions);
    expect(transactions).toHaveLength(0);
    expect(await kindBalance(db, account.id, 'customer_available')).toBe(1000);
  });
});

describe('settleReservation', () => {
  it('charges on delivery: reserved pesewas move to platform revenue', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);
    await seedLedgerWallets(db, account.id, 5000, 400);
    const message = await seedMessage(db, account.id, project.id, { quotedMinor: 400, status: 'sent' });
    await seedReservation(db, message, 400);

    const settled = await db.transaction(async tx => settleReservation(tx, message, true));
    expect(settled).toBe(true);

    expect(await kindBalance(db, account.id, 'customer_available')).toBe(5000);
    expect(await kindBalance(db, account.id, 'customer_reserved')).toBe(0);
    expect(await kindBalance(db, null, 'platform_revenue')).toBe(400);

    const [reservation] = await db.select().from(messageReservations).where(eq(messageReservations.messageId, message.id));
    expect(reservation?.state).toBe('settled');
    const [updated] = await db.select().from(messages).where(eq(messages.id, message.id));
    expect(updated?.reservationStatus).toBe('settled');
    expect(updated?.chargedMinor).toBe(400);
  });

  it('releases on free delivery and refunds the daily usage counters', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);
    await seedLedgerWallets(db, account.id, 5000, 400);
    await seedDailyUsage(db, `account:${account.id}`, 1, 400);
    await seedDailyUsage(db, `project:${project.id}`, 1, 400);
    const message = await seedMessage(db, account.id, project.id, { quotedMinor: 400, status: 'delivered' });
    await seedReservation(db, message, 400);

    await db.transaction(async tx => { await settleReservation(tx, message, false); });

    expect(await kindBalance(db, account.id, 'customer_available')).toBe(5400);
    expect(await kindBalance(db, account.id, 'customer_reserved')).toBe(0);
    const usage = await db.select().from(dailyUsage).where(eq(dailyUsage.entityKey, `account:${account.id}`));
    expect(usage.map(row => row.spendMinor)).toStrictEqual([0]);
  });

  it('leaves an already-settled reservation untouched', async () => {
    const db = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);
    await seedLedgerWallets(db, account.id, 5000, 400);
    const message = await seedMessage(db, account.id, project.id, {
      quotedMinor: 400, status: 'delivered', reservationStatus: 'settled', chargedMinor: 400,
    });
    const reservation = await seedReservation(db, message, 400);
    await db.update(messageReservations).set({ state: 'settled', settledAt: new Date() })
      .where(eq(messageReservations.id, reservation.id));

    const result = await db.transaction(async tx => settleReservation(tx, message, true));
    expect(result).toBe(false);
    expect(await kindBalance(db, null, 'platform_revenue')).toBe(0);
    expect(await kindBalance(db, account.id, 'customer_reserved')).toBe(400);
  });
});

describe('incrementUsage daily limits', () => {
  it('accumulates spend and volume per account and project', async () => {
    const db: TestDb = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id);

    await db.transaction(async tx => { await incrementUsage(tx, account, project, 100); });

    const rows = await db.select().from(dailyUsage);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.volume).toBe(1);
      expect(row.spendMinor).toBe(100);
    }
  });

  it('surfaces a DAILY_LIMIT error once the volume cap is hit', async () => {
    const db: TestDb = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id, { dailyVolumeLimit: 1 });

    await db.transaction(tx => incrementUsage(tx, account, project, 100));
    await expect(db.transaction(tx => incrementUsage(tx, account, project, 100)))
      .rejects.toMatchObject({ status: 429, code: 'DAILY_LIMIT' });
    const rows = await db.select().from(dailyUsage);
    expect(rows).toHaveLength(2); // first call persisted; the second rolled back
  });

  it('surfaces a DAILY_LIMIT error when a single quote exceeds the spend cap', async () => {
    const db: TestDb = getTestDb();
    const account = await seedAccount(db);
    const project = await seedProject(db, account.id, { dailySpendLimitMinor: 150 });

    await expect(db.transaction(tx => incrementUsage(tx, account, project, 200)))
      .rejects.toMatchObject({ status: 429, code: 'DAILY_LIMIT' });
    expect(await db.select().from(dailyUsage)).toHaveLength(0);
  });
});

describe('integer ledger invariants', () => {
  it('keeps every ledger account consistent with its entries and the books net zero', async () => {
    const db = getTestDb();
    const first = await seedAccount(db);
    const second = await seedAccount(db);
    for (const account of [first, second]) {
      await db.transaction(async tx => { await createWallet(tx, account.id); });
    }
    await db.transaction(async tx => {
      await transfer(tx, { accountId: first.id, from: 'platform_funding', to: 'customer_available',
        value: 8000, kind: 'funding', reference: `fund:${randomUUID()}` });
      await transfer(tx, { accountId: second.id, from: 'platform_funding', to: 'customer_available',
        value: 8000, kind: 'funding', reference: `fund:${randomUUID()}` });
      await transfer(tx, { accountId: first.id, from: 'customer_available', to: 'customer_reserved',
        value: 300, kind: 'message_reservation', reference: `reserve:${randomUUID()}` });
      await transfer(tx, { accountId: first.id, from: 'customer_available', to: 'customer_reserved',
        value: 700, kind: 'message_reservation', reference: `reserve:${randomUUID()}` });
      await transfer(tx, { accountId: second.id, from: 'customer_available', to: 'customer_reserved',
        value: 450, kind: 'message_reservation', reference: `reserve:${randomUUID()}` });
      await transfer(tx, { accountId: first.id, from: 'customer_reserved', to: 'platform_revenue',
        value: 300, kind: 'message_charge', reference: `settle:${randomUUID()}` });
      await transfer(tx, { accountId: second.id, from: 'customer_reserved', to: 'customer_available',
        value: 450, kind: 'message_release', reference: `release:${randomUUID()}` });
    });

    const ledgers = await db.select().from(ledgerAccounts);
    expect(ledgers.length).toBeGreaterThan(0);
    for (const ledger of ledgers) {
      const [sums] = await db.select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)` })
        .from(ledgerEntries).where(eq(ledgerEntries.ledgerAccountId, ledger.id));
      expect(Number(sums?.total)).toBe(ledger.balanceMinor);
    }
    const [net] = await db.select({ total: sql<string>`coalesce(sum(${ledgerEntries.amountMinor}), 0)` }).from(ledgerEntries);
    expect(Number(net?.total)).toBe(0);
  });
});
