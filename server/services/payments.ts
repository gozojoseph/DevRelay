import { and, eq, isNull, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../db/client.js';
import { paymentAttempts, paymentEvents, platformSettings, users } from '../db/schema.js';
import { availability, config } from '../config.js';
import { ApiError, assert } from '../lib/http.js';
import { sha256 } from '../lib/security.js';
import { matchesPayment, initializePayment, verifyPayment } from '../providers/paystack.js';
import { transfer } from './ledger.js';
import { enqueue } from './jobs.js';

export async function startFunding(accountId: string, userId: string, amountMinor: number) {
  if (!availability().paystack) throw new ApiError(503, 'PAYMENT_UNAVAILABLE', 'Paystack is not configured.');
  const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1));
  if (!settings?.minimumFundingMinor) throw new ApiError(503, 'FUNDING_UNAVAILABLE', 'Minimum funding amount has not been configured.');
  if (!Number.isSafeInteger(amountMinor) || amountMinor < settings.minimumFundingMinor || amountMinor > 10_000_000) {
    throw new ApiError(400, 'INVALID_AMOUNT', `Enter at least ${settings.minimumFundingMinor} pesewas and at most 10000000 pesewas.`);
  }
  const [user] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.accountId, accountId)));
  assert(user, 403, 'FORBIDDEN', 'Account access denied.');
  const reference = `dr_${randomUUID().replaceAll('-', '')}`;
  const [attempt] = await db.insert(paymentAttempts).values({ accountId, userId, reference, amountMinor, status: 'initializing' }).returning();
  assert(attempt, 500, 'PAYMENT_ERROR', 'Could not create payment attempt.');
  try {
    const authorizationUrl = await initializePayment({ amountMinor, reference, accountId, email: user.email,
      callbackUrl: `${config().APP_ORIGIN}/app/wallet?reference=${reference}` });
    await db.update(paymentAttempts).set({ status: 'pending', updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
    return { reference, authorizationUrl };
  } catch (error) {
    // An HTTP timeout could mean Paystack initialized the reference. Keep it for reconciliation.
    await db.update(paymentAttempts).set({ status: 'reconciliation_required', updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
    throw error;
  }
}

export async function reconcilePayment(reference: string) {
  const [attempt] = await db.select().from(paymentAttempts).where(eq(paymentAttempts.reference, reference));
  if (!attempt) return null;
  const verified = await verifyPayment(reference);
  return db.transaction(async tx => {
    const [locked] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, attempt.id)).for('update');
    assert(locked, 404, 'PAYMENT_NOT_FOUND', 'Payment reference not found.');
    if (locked.creditedAt) return { status: 'credited' as const, reference };
    if (verified.status !== 'success') {
      await tx.update(paymentAttempts).set({ status: ['failed', 'abandoned', 'reversed'].includes(verified.status) ? verified.status : 'pending',
        lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(paymentAttempts.id, attempt.id));
      return { status: verified.status, reference };
    }
    const [user] = await tx.select().from(users).where(and(eq(users.id, locked.userId), eq(users.accountId, locked.accountId)));
    if (!user || !matchesPayment(verified, { reference, amountMinor: locked.amountMinor, currency: locked.currency,
      email: user.email, accountId: locked.accountId })) {
      await tx.update(paymentAttempts).set({ status: 'mismatch', lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(paymentAttempts.id, locked.id));
      return { status: 'mismatch', reference };
    }
    await transfer(tx, { accountId: locked.accountId, from: 'platform_funding', to: 'customer_available',
      value: locked.amountMinor, kind: 'funding', reference: `payment:${reference}` });
    await tx.update(paymentAttempts).set({ status: 'credited', providerTransactionId: String(verified.id ?? ''),
      creditedAt: new Date(), lastCheckedAt: new Date(), updatedAt: new Date() }).where(eq(paymentAttempts.id, locked.id));
    return { status: 'credited' as const, reference };
  });
}

export async function recordPaystackEvent(raw: Buffer, event: { event?: string; data?: { reference?: string } }) {
  const hash = sha256(raw);
  const reference = event.data?.reference;
  const [stored] = await db.insert(paymentEvents).values({ eventHash: hash, kind: event.event || 'unknown', reference })
    .onConflictDoNothing().returning();
  if (!stored || event.event !== 'charge.success' || !reference) return { duplicate: !stored };
  const [attempt] = await db.select({ id: paymentAttempts.id, accountId: paymentAttempts.accountId })
    .from(paymentAttempts).where(eq(paymentAttempts.reference, reference));
  if (!attempt) return { duplicate: false, paymentFound: false };
  await db.update(paymentEvents).set({ attemptId: attempt.id }).where(eq(paymentEvents.eventHash, hash));
  await db.transaction(async tx => {
    await enqueue(tx, { kind: 'payment.reconcile', dedupKey: `payment-webhook:${hash}`,
      accountId: attempt.accountId, payload: { reference } });
  });
  return { duplicate: false, paymentFound: true };
}

export async function reconcileOldPayments(limit = 20) {
  if (!availability().paystack) return;
  const pending = await db.select({ reference: paymentAttempts.reference }).from(paymentAttempts)
    .where(and(isNull(paymentAttempts.creditedAt), lt(paymentAttempts.createdAt, new Date(Date.now() - 120_000))))
    .orderBy(paymentAttempts.createdAt).limit(limit);
  for (const item of pending) { try { await reconcilePayment(item.reference); } catch { /* Retried next scan; no unsafe credits. */ } }
}
