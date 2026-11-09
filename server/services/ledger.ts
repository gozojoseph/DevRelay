import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type DbTransaction } from '../db/client.js';
import { accounts, dailyUsage, ledgerAccounts, ledgerEntries, ledgerTransactions, messageReservations, messages, projects } from '../db/schema.js';
import { ApiError, assert } from '../lib/http.js';

export type LedgerKind = 'customer_available' | 'customer_reserved' | 'platform_funding' | 'platform_revenue';
function positive(value: number) { assert(Number.isSafeInteger(value) && value > 0, 400, 'INVALID_AMOUNT', 'Amount must be a positive integer in GHS pesewas.'); }

export async function createWallet(tx: DbTransaction, accountId: string) {
  await tx.insert(ledgerAccounts).values([
    { accountId, kind: 'customer_available' }, { accountId, kind: 'customer_reserved' },
  ]).onConflictDoNothing();
}

async function getLedgerAccount(tx: DbTransaction, accountId: string | null, kind: LedgerKind) {
  if (accountId === null) await tx.insert(ledgerAccounts).values({ accountId: null, kind }).onConflictDoNothing();
  const [row] = await tx.select().from(ledgerAccounts).where(and(
    accountId === null ? sql`${ledgerAccounts.accountId} IS NULL` : eq(ledgerAccounts.accountId, accountId),
    eq(ledgerAccounts.kind, kind),
  ));
  assert(row, 500, 'WALLET_MISSING', 'Credit account is unavailable. Contact support.');
  return row;
}

export async function transfer(tx: DbTransaction, params: {
  accountId: string; from: LedgerKind; to: LedgerKind; value: number; kind: string; reference: string; description?: string;
}) {
  positive(params.value);
  const source = await getLedgerAccount(tx, params.from.startsWith('platform_') ? null : params.accountId, params.from);
  const destination = await getLedgerAccount(tx, params.to.startsWith('platform_') ? null : params.accountId, params.to);
  const locked = await tx.select().from(ledgerAccounts).where(inArray(ledgerAccounts.id, [source.id, destination.id]))
    .orderBy(ledgerAccounts.id).for('update');
  const current = locked.find(row => row.id === source.id);
  assert(current, 500, 'WALLET_MISSING', 'Credit account is unavailable.');
  if (current.accountId && current.balanceMinor < params.value) throw new ApiError(402, 'INSUFFICIENT_CREDITS', 'Not enough messaging credits. Add funds or lower your message length.');
  const [transaction] = await tx.insert(ledgerTransactions).values({
    accountId: params.accountId, kind: params.kind, reference: params.reference, description: params.description,
  }).returning({ id: ledgerTransactions.id });
  assert(transaction, 500, 'LEDGER_ERROR', 'Unable to record ledger transaction.');
  await tx.insert(ledgerEntries).values([
    { transactionId: transaction.id, ledgerAccountId: source.id, amountMinor: -params.value },
    { transactionId: transaction.id, ledgerAccountId: destination.id, amountMinor: params.value },
  ]);
  await tx.update(ledgerAccounts).set({ balanceMinor: sql`${ledgerAccounts.balanceMinor} - ${params.value}` }).where(eq(ledgerAccounts.id, source.id));
  await tx.update(ledgerAccounts).set({ balanceMinor: sql`${ledgerAccounts.balanceMinor} + ${params.value}` }).where(eq(ledgerAccounts.id, destination.id));
  return transaction.id;
}

export async function balance(accountId: string) {
  const rows = await db.select({ kind: ledgerAccounts.kind, balanceMinor: ledgerAccounts.balanceMinor })
    .from(ledgerAccounts).where(eq(ledgerAccounts.accountId, accountId));
  return { currency: 'GHS', availableMinor: rows.find(r => r.kind === 'customer_available')?.balanceMinor ?? 0,
    reservedMinor: rows.find(r => r.kind === 'customer_reserved')?.balanceMinor ?? 0 };
}

export async function incrementUsage(tx: DbTransaction, account: typeof accounts.$inferSelect, project: typeof projects.$inferSelect, quotedMinor: number) {
  const day = new Date().toISOString().slice(0, 10);
  for (const [entityKey, spendLimit, volumeLimit] of [
    [`account:${account.id}`, account.dailySpendLimitMinor, account.dailyVolumeLimit],
    [`project:${project.id}`, Math.min(project.dailySpendLimitMinor, account.dailySpendLimitMinor), Math.min(project.dailyVolumeLimit, account.dailyVolumeLimit)],
  ] as [string, number, number][]) {
    const result = await tx.insert(dailyUsage).values({ entityKey, day, volume: 1, spendMinor: quotedMinor }).onConflictDoUpdate({
      target: [dailyUsage.entityKey, dailyUsage.day],
      set: { volume: sql`${dailyUsage.volume} + 1`, spendMinor: sql`${dailyUsage.spendMinor} + ${quotedMinor}` },
      setWhere: sql`${dailyUsage.volume} + 1 <= ${volumeLimit} AND ${dailyUsage.spendMinor} + ${quotedMinor} <= ${spendLimit}`,
    }).returning({ id: dailyUsage.id });
    if (!result.length) throw new ApiError(429, 'DAILY_LIMIT', 'Daily spend or message limit reached. Contact support to review your limits.');
    // Insertion must also respect the cap (the conflict clause only checks updates).
    if (quotedMinor > spendLimit || volumeLimit < 1) throw new ApiError(429, 'DAILY_LIMIT', 'Daily spend or message limit reached.');
  }
}

async function releaseUsage(tx: DbTransaction, message: typeof messages.$inferSelect) {
  if (!message.projectId) return;
  const day = message.createdAt.toISOString().slice(0, 10);
  for (const key of [`account:${message.accountId}`, `project:${message.projectId}`]) {
    await tx.update(dailyUsage).set({ spendMinor: sql`GREATEST(0, ${dailyUsage.spendMinor} - ${message.quotedMinor})` })
      .where(and(eq(dailyUsage.entityKey, key), eq(dailyUsage.day, day)));
  }
}

// Must be called under a message row lock. A reservation is never released on an
// ambiguous SMS outcome: provider rejection after acceptance may still be billable.
export async function settleReservation(tx: DbTransaction, message: typeof messages.$inferSelect, charge: boolean) {
  const [reservation] = await tx.select().from(messageReservations).where(eq(messageReservations.messageId, message.id)).for('update');
  if (!reservation || reservation.state !== 'reserved') return false;
  if (charge) {
    await transfer(tx, { accountId: message.accountId, from: 'customer_reserved', to: 'platform_revenue',
      value: reservation.amountMinor, kind: 'message_charge', reference: `settle:${message.id}` });
  } else {
    await transfer(tx, { accountId: message.accountId, from: 'customer_reserved', to: 'customer_available',
      value: reservation.amountMinor, kind: 'message_release', reference: `release:${message.id}` });
    await releaseUsage(tx, message);
  }
  await tx.update(messageReservations).set({ state: charge ? 'settled' : 'released', settledAt: new Date() }).where(eq(messageReservations.id, reservation.id));
  await tx.update(messages).set({ reservationStatus: charge ? 'settled' : 'released', chargedMinor: charge ? reservation.amountMinor : 0, updatedAt: new Date() }).where(eq(messages.id, message.id));
  return true;
}
