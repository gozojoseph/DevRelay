import { and, desc, eq, inArray, lte, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, type DbTransaction } from '../db/client.js';
import { accounts, domainOrders, domains } from '../db/schema.js';
import { ApiError, assert } from '../lib/http.js';
import { transfer } from './ledger.js';
import { enqueue } from './jobs.js';
import { domainReseller, domainResellerReady } from '../providers/domain-reseller.js';
import { ProviderFailure } from '../providers/types.js';

// In-platform domain reselling (docs/domains.md): customers buy and renew
// domains from DevRelay; DevRelay registers them through a reseller API.
// Money rules mirror hosting: the wallet is charged BEFORE anything is
// ordered, so an unfunded account cannot create a domain (402 + zero rows).
// Domains differ from apps in one honest way: they cannot be "paused" — an
// unrenewed domain expires and can be LOST, so the sweep warns early
// (30/14/7/1 days) and records expiry truthfully instead of quietly sliding.

/**
 * TLD catalog. `priceMinor` is the DevRelay customer price in GHS pesewas —
 * PLACEHOLDER pending two things: the ResellerClub sandbox probe (live cost
 * prices per TLD come back in the availability response's `cost` array) and
 * the user's final FX + margin decision. `supplierUsdCents` is the OLD
 * HostAfrica wholesale figure — kept only as a rough sizing reference, NOT a
 * real cost basis; ResellerClub's actual pricing replaces it at go-live.
 * NOTE: no .gh TLDs exist in the ResellerClub catalog either; Ghanaian
 * .com.gh etc. need a separate local registrar flow later.
 */
export const DOMAIN_TLDS = {
  'com': { tld: 'com', priceMinor: 26_000, supplierUsdCents: 1_508 },
  'org': { tld: 'org', priceMinor: 18_000, supplierUsdCents: 999 },
  'net': { tld: 'net', priceMinor: 25_000, supplierUsdCents: 1_463 },
  'africa': { tld: 'africa', priceMinor: 13_000, supplierUsdCents: 619 },
  'com.ng': { tld: 'com.ng', priceMinor: 11_000, supplierUsdCents: 500 },
  'co.ke': { tld: 'co.ke', priceMinor: 20_000, supplierUsdCents: 1_100 },
} as const;

export type DomainTld = (typeof DOMAIN_TLDS)[keyof typeof DOMAIN_TLDS];

/** Years are approximated as 365-day periods; the registrar date stays authoritative. */
export const DOMAIN_YEAR_DAYS = 365;
/** Days past expiry before a domain is considered lost (registrar grace). */
export const DOMAIN_GRACE_DAYS = 30;

const DOMAIN_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function getTld(tld: string): DomainTld {
  const entry = (DOMAIN_TLDS as Record<string, DomainTld | undefined>)[tld];
  assert(entry, 400, 'UNSUPPORTED_TLD',
    `Unsupported TLD. Available: ${Object.keys(DOMAIN_TLDS).join(', ')}.`);
  return entry;
}

/** Validates and normalizes a domain name; must end in a catalog TLD. */
export function parseDomainName(input: string): { name: string; tld: string } {
  const name = input.trim().toLowerCase();
  assert(name.length >= 4 && name.length <= 253, 400, 'INVALID_DOMAIN', 'Enter a valid domain name.');
  const labels = name.split('.');
  assert(labels.length >= 2, 400, 'INVALID_DOMAIN', 'Enter a full domain like example.com.');
  const tld = labels.slice(1).join('.');
  getTld(tld); // 400 with the available list when unsupported
  const sld = labels[0]!;
  assert(DOMAIN_LABEL.test(sld), 400, 'INVALID_DOMAIN',
    'The part before the dot may use letters, numbers and hyphens only.');
  return { name, tld };
}

export const domainRegistrantSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  organisation: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(120),
  phone: z.string().trim().min(6).max(24),
  country: z.string().trim().length(2).transform(v => v.toUpperCase()),
  city: z.string().trim().min(1).max(80),
  // ResellerClub requires state + zipcode on customers and contacts (both
  // live-verified 2026-11-10: "state: must not be blank").
  state: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().min(3).max(10),
  addressLine: z.string().trim().min(1).max(200),
});

export type DomainRegistrant = z.infer<typeof domainRegistrantSchema>;

async function chargeDomain(tx: DbTransaction, params: {
  accountId: string; orderId: string; amountMinor: number; action: 'register' | 'renew';
  description: string;
}) {
  const kind = params.action === 'register' ? 'domain_purchase' : 'domain_renewal';
  try {
    await transfer(tx, { accountId: params.accountId, from: 'customer_available', to: 'platform_revenue',
      value: params.amountMinor, kind, reference: `domain:${params.action}:${params.orderId}`,
      description: params.description });
  } catch (error) {
    // A never-funded account has no wallet rows at all — same honest answer.
    if (error instanceof ApiError && error.code === 'WALLET_MISSING') {
      throw new ApiError(402, 'INSUFFICIENT_CREDITS', 'Not enough messaging credits for this domain. Add funds first.');
    }
    throw error;
  }
}

/** Refunds a charged order after a DEFINITE registrar rejection. */
async function refundOrder(tx: DbTransaction, params: {
  accountId: string; orderId: string; amountMinor: number;
}) {
  await transfer(tx, { accountId: params.accountId, from: 'platform_revenue', to: 'customer_available',
    value: params.amountMinor, kind: 'domain_refund', reference: `domain:refund:${params.orderId}`,
    description: 'Domain action failed; full refund' });
}

function nextExpiry(currentExpiry: Date | null, periodYears: number) {
  const base = currentExpiry && currentExpiry.getTime() > Date.now() ? currentExpiry.getTime() : Date.now();
  return new Date(base + periodYears * DOMAIN_YEAR_DAYS * 86_400_000);
}

/**
 * Charges the wallet and creates the domain + register order + job in ONE
 * transaction: if the wallet cannot cover it, nothing exists afterwards.
 */
export async function createDomainOrder(input: {
  accountId: string; projectId: string; domain: string;
  registrant: DomainRegistrant; autoRenew?: boolean;
}) {
  if (!domainResellerReady()) {
    throw new ApiError(503, 'DOMAIN_RESELLER_NOT_CONFIGURED', 'Domain purchases are not available yet. Contact support.');
  }
  const { name, tld } = parseDomainName(input.domain);
  const entry = getTld(tld);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
  assert(account, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
  assert(account.status === 'active', 403, 'ACCOUNT_NOT_ACTIVE', 'Account must be active to buy domains.');
  // One row per domain name, ever. A failed or lapsed (lost) domain can be
  // legitimately re-bought: the SAME row is reset and the new order carries
  // the audit trail. Any other status means it is actively owned → 409.
  const [existing] = await db.select().from(domains).where(eq(domains.name, name));
  if (existing) {
    assert(existing.status === 'failed' || existing.status === 'lapsed', 409, 'DOMAIN_TAKEN',
      'That domain is already in a DevRelay account.');
  }
  const domainId = existing?.id ?? randomUUID();
  return db.transaction(async tx => {
    const [domain] = existing
      ? await tx.update(domains).set({
          status: 'pending_register', autoRenew: input.autoRenew ?? true, periodYears: 1,
          registrant: input.registrant, providerReference: null, registeredAt: null, expiresAt: null,
          lastWarningLevel: 0, lastError: null, updatedAt: new Date(),
        }).where(eq(domains.id, existing.id)).returning()
      : await tx.insert(domains).values({
          id: domainId, accountId: input.accountId, projectId: input.projectId,
          name, tld, registrant: input.registrant, autoRenew: input.autoRenew ?? true, periodYears: 1,
        }).returning();
    assert(domain, 500, 'DOMAIN_CREATE_FAILED', 'Could not create the domain order.');
    const [order] = await tx.insert(domainOrders).values({
      domainId: domain.id, accountId: input.accountId, action: 'register',
      periodYears: 1, amountMinor: entry.priceMinor,
    }).returning();
    assert(order, 500, 'DOMAIN_CREATE_FAILED', 'Could not create the domain order.');
    await chargeDomain(tx, { accountId: input.accountId, orderId: order.id, amountMinor: entry.priceMinor,
      action: 'register', description: `Domain registration: ${name} (1 year)` });
    await enqueue(tx, { kind: 'domain.register', dedupKey: `domain.register:${order.id}`,
      payload: { orderId: order.id }, accountId: input.accountId, projectId: input.projectId,
      maxAttempts: 40 });
    return { domain: domain!, orderId: order.id };
  });
}

async function loadPendingOrder(orderId: string) {
  const [order] = await db.select().from(domainOrders).where(eq(domainOrders.id, orderId));
  if (!order || order.status !== 'pending') return undefined;
  const [domain] = await db.select().from(domains).where(eq(domains.id, order.domainId));
  if (!domain) return undefined;
  return { order, domain };
}

async function failWithRefund(orderId: string, error: string) {
  await db.transaction(async tx => {
    const [order] = await tx.select().from(domainOrders).where(eq(domainOrders.id, orderId)).for('update');
    if (!order || order.status !== 'pending') return;
    await refundOrder(tx, { accountId: order.accountId, orderId: order.id, amountMinor: order.amountMinor });
    await tx.update(domainOrders).set({ status: 'refunded', error: error.slice(0, 240), updatedAt: new Date() })
      .where(eq(domainOrders.id, order.id));
  });
}

/** Registers the domain at the reseller. Definite rejection → full refund. */
export async function processDomainRegister(orderId: string) {
  const loaded = await loadPendingOrder(orderId);
  if (!loaded) return { done: true };
  const { order, domain } = loaded;
  if (domain.status !== 'pending_register') return { done: true };
  try {
    const result = await domainReseller.register({
      domain: domain.name, periodYears: order.periodYears, registrant: domain.registrant as DomainRegistrant,
      // Resume protocol: an earlier attempt that reached the registrar left
      // its order id on the row — poll it to completion, never re-post.
      existingReference: domain.providerReference ?? undefined,
    });
    if (!result.completed) {
      // The money is committed at the registrar and the order is in flight.
      // Persist the reference so the next attempt resumes polling; the order
      // stays pending and the job retries — honest in-flight, not "done".
      await db.transaction(async tx => {
        const [current] = await tx.select().from(domainOrders).where(eq(domainOrders.id, orderId)).for('update');
        if (!current || current.status !== 'pending') return;
        const now = new Date();
        await tx.update(domainOrders).set({ providerReference: result.providerReference, updatedAt: now })
          .where(eq(domainOrders.id, orderId));
        await tx.update(domains).set({ providerReference: result.providerReference, updatedAt: now })
          .where(eq(domains.id, domain.id));
      });
      return { done: false, retry: true, code: 'DOMAIN_REGISTER_PROCESSING' };
    }
    await db.transaction(async tx => {
      const [current] = await tx.select().from(domainOrders).where(eq(domainOrders.id, orderId)).for('update');
      if (!current || current.status !== 'pending') return;
      const now = new Date();
      await tx.update(domainOrders).set({ status: 'done', providerReference: result.providerReference,
        updatedAt: now }).where(eq(domainOrders.id, orderId));
      await tx.update(domains).set({ status: 'active', providerReference: result.providerReference,
        registeredAt: now, expiresAt: nextExpiry(null, order.periodYears), lastError: null, updatedAt: now })
        .where(eq(domains.id, domain.id));
    });
    return { done: true };
  } catch (error) {
    if (error instanceof ProviderFailure) {
      if (error.kind === 'rejected') {
        await failWithRefund(orderId, error.publicCode);
        await db.update(domains).set({ status: 'failed', lastError: error.publicCode.slice(0, 240), updatedAt: new Date() })
          .where(eq(domains.id, domain.id));
        return { done: true };
      }
      return { done: false, retry: true, code: error.publicCode };
    }
    return { done: false, retry: true, code: 'DOMAIN_REGISTER_ERROR' };
  }
}

/** Renews one charged period at the reseller. Definite rejection → full refund. */
export async function processDomainRenew(orderId: string) {
  const loaded = await loadPendingOrder(orderId);
  if (!loaded) return { done: true };
  const { order, domain } = loaded;
  if (domain.status === 'lapsed' || domain.status === 'failed') return { done: true };
  try {
    const result = await domainReseller.renew({
      domain: domain.name, providerReference: domain.providerReference ?? undefined,
      currentExpiry: domain.expiresAt ?? new Date(), periodYears: order.periodYears,
    });
    if (!result.completed) {
      // Renewal submitted and in flight at the registrar; the expDate guard
      // makes any future re-submission safe. Keep the order pending and retry.
      await db.transaction(async tx => {
        const [current] = await tx.select().from(domainOrders).where(eq(domainOrders.id, orderId)).for('update');
        if (!current || current.status !== 'pending') return;
        await tx.update(domainOrders).set({ providerReference: result.providerReference, updatedAt: new Date() })
          .where(eq(domainOrders.id, orderId));
      });
      return { done: false, retry: true, code: 'DOMAIN_RENEW_PROCESSING' };
    }
    await db.transaction(async tx => {
      const [current] = await tx.select().from(domainOrders).where(eq(domainOrders.id, orderId)).for('update');
      if (!current || current.status !== 'pending') return;
      const [currentDomain] = await tx.select().from(domains).where(eq(domains.id, domain.id)).for('update');
      const now = new Date();
      await tx.update(domainOrders).set({ status: 'done', providerReference: result.providerReference,
        updatedAt: now }).where(eq(domainOrders.id, orderId));
      await tx.update(domains).set({
        status: 'active', expiresAt: nextExpiry(currentDomain?.expiresAt ?? null, order.periodYears),
        lastWarningLevel: 0, lastError: null, updatedAt: now,
      }).where(eq(domains.id, domain.id));
    });
    return { done: true };
  } catch (error) {
    if (error instanceof ProviderFailure) {
      if (error.kind === 'rejected') {
        // The domain stays active until its real expiry — renewal simply did
        // not happen; the money goes back and lapse warnings keep running.
        await failWithRefund(orderId, error.publicCode);
        return { done: true };
      }
      return { done: false, retry: true, code: error.publicCode };
    }
    return { done: false, retry: true, code: 'DOMAIN_RENEW_ERROR' };
  }
}

export async function setDomainAutoRenew(params: {
  accountId: string; projectId: string; domainId: string; autoRenew: boolean;
}) {
  const [domain] = await db.select({ id: domains.id }).from(domains).where(and(
    eq(domains.id, params.domainId), eq(domains.accountId, params.accountId),
    eq(domains.projectId, params.projectId),
    inArray(domains.status, ['pending_register', 'active', 'expired'])));
  assert(domain, 404, 'DOMAIN_NOT_FOUND', 'Domain not found.');
  await db.update(domains).set({ autoRenew: params.autoRenew, updatedAt: new Date() })
    .where(eq(domains.id, params.domainId));
}

/** Manual renewal: charge + renew job for one more period, same as the sweep. */
export async function renewDomainNow(params: {
  accountId: string; projectId: string; domainId: string;
}) {
  if (!domainResellerReady()) {
    throw new ApiError(503, 'DOMAIN_RESELLER_NOT_CONFIGURED', 'Domain renewals are not available yet. Contact support.');
  }
  const [domain] = await db.select().from(domains).where(and(
    eq(domains.id, params.domainId), eq(domains.accountId, params.accountId),
    eq(domains.projectId, params.projectId),
    inArray(domains.status, ['active', 'expired'])));
  assert(domain, 404, 'DOMAIN_NOT_FOUND', 'Domain not found.');
  const entry = getTld(domain.tld);
  return db.transaction(async tx => {
    const [pending] = await tx.select({ id: domainOrders.id }).from(domainOrders).where(and(
      eq(domainOrders.domainId, domain.id), eq(domainOrders.action, 'renew'), eq(domainOrders.status, 'pending')));
    assert(!pending, 409, 'RENEWAL_IN_PROGRESS', 'A renewal for this domain is already processing.');
    const [order] = await tx.insert(domainOrders).values({
      domainId: domain.id, accountId: params.accountId, action: 'renew',
      periodYears: domain.periodYears, amountMinor: entry.priceMinor,
    }).returning();
    assert(order, 500, 'DOMAIN_RENEW_FAILED', 'Could not create the renewal order.');
    await chargeDomain(tx, { accountId: params.accountId, orderId: order.id, amountMinor: entry.priceMinor,
      action: 'renew', description: `Domain renewal: ${domain.name} (${domain.periodYears} year(s))` });
    await enqueue(tx, { kind: 'domain.renew', dedupKey: `domain.renew:${order.id}`,
      payload: { orderId: order.id }, accountId: params.accountId, projectId: params.projectId,
      maxAttempts: 40 });
    return { orderId: order.id! };
  });
}

const WARNING_THRESHOLDS: [days: number, level: number][] = [[30, 1], [14, 2], [7, 3], [1, 4]];

function warningLevelFor(expiresAt: Date) {
  const daysLeft = (expiresAt.getTime() - Date.now()) / 86_400_000;
  let level = 0;
  for (const [days, value] of WARNING_THRESHOLDS) if (daysLeft <= days) level = Math.max(level, value);
  return level;
}

/**
 * Renewal + honesty sweep (worker, every 5 min):
 *  1. Expired honesty — active domains past expiry become `expired`; expired
 *     ones past the registrar grace window become `lapsed` (lost).
 *  2. Lapse-risk warnings — 30/14/7/1 day thresholds recorded on the row
 *     (dashboard surfaces them; domains cannot pause like apps can).
 *  3. Auto-renewal — charged a period ahead (30d window), one pending order
 *     at a time, idempotent under a row lock. Insufficient wallet → visible
 *     lastError, retried every sweep.
 */
export async function renewDueDomains() {
  const now = Date.now();
  await db.update(domains).set({ status: 'expired', updatedAt: new Date() }).where(and(
    eq(domains.status, 'active'), lte(domains.expiresAt, new Date(now))));
  await db.update(domains).set({ status: 'lapsed', updatedAt: new Date() }).where(and(
    eq(domains.status, 'expired'), lte(domains.expiresAt, new Date(now - DOMAIN_GRACE_DAYS * 86_400_000))));

  const atRisk = await db.select().from(domains).where(and(
    inArray(domains.status, ['active', 'expired']), lte(domains.expiresAt, new Date(now + 30 * 86_400_000))));
  let renewed = 0, warned = 0;
  for (const domain of atRisk) {
    const level = warningLevelFor(domain.expiresAt ?? new Date(now));
    if (level !== domain.lastWarningLevel) {
      await db.update(domains).set({ lastWarningLevel: level, updatedAt: new Date() })
        .where(eq(domains.id, domain.id));
      warned += 1;
    }
    if (!domain.autoRenew) continue;
    const horizon = new Date(now + 30 * 86_400_000);
    try {
      await db.transaction(async tx => {
        const [current] = await tx.select().from(domains).where(eq(domains.id, domain.id)).for('update');
        if (!current || !current.autoRenew || current.status === 'lapsed' || current.status === 'failed') return;
        if (current.expiresAt && current.expiresAt.getTime() > horizon.getTime()) return; // already renewed
        const [pending] = await tx.select({ id: domainOrders.id }).from(domainOrders).where(and(
          eq(domainOrders.domainId, current.id), eq(domainOrders.action, 'renew'), eq(domainOrders.status, 'pending')));
        if (pending) return; // one renewal order at a time
        const entry = getTld(current.tld);
        const [order] = await tx.insert(domainOrders).values({
          domainId: current.id, accountId: current.accountId, action: 'renew',
          periodYears: current.periodYears, amountMinor: entry.priceMinor,
        }).returning();
        await chargeDomain(tx, { accountId: current.accountId, orderId: order!.id, amountMinor: entry.priceMinor,
          action: 'renew', description: `Domain renewal: ${current.name} (${current.periodYears} year(s))` });
        await enqueue(tx, { kind: 'domain.renew', dedupKey: `domain.renew:${order!.id}`,
          payload: { orderId: order!.id }, accountId: current.accountId, maxAttempts: 40 });
      });
      renewed += 1;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_CREDITS') {
        await db.update(domains).set({ lastError: 'DOMAIN_RENEWAL_INSUFFICIENT_CREDITS', updatedAt: new Date() })
          .where(eq(domains.id, domain.id));
        continue;
      }
      throw error;
    }
  }
  return { renewed, warned };
}

export async function lookupDomainAvailability(input: string) {
  if (!domainResellerReady()) {
    throw new ApiError(503, 'DOMAIN_RESELLER_NOT_CONFIGURED', 'Domain lookups are not available yet. Contact support.');
  }
  const { name, tld } = parseDomainName(input);
  const entry = getTld(tld);
  try {
    const { available } = await domainReseller.lookup(name);
    return { domain: name, tld, available, priceMinor: entry.priceMinor, currency: 'GHS' };
  } catch (error) {
    if (error instanceof ProviderFailure) {
      if (error.publicCode === 'DOMAIN_RESELLER_NOT_CONFIGURED') throw new ApiError(503, 'DOMAIN_RESELLER_NOT_CONFIGURED', 'Domain lookups are not available yet. Contact support.');
      if (error.kind === 'rejected') throw new ApiError(400, 'DOMAIN_LOOKUP_REJECTED', 'The registrar rejected this lookup. Check the domain spelling.');
      throw new ApiError(error.kind === 'retryable' ? 503 : 502, 'DOMAIN_LOOKUP_UNAVAILABLE', 'The registrar could not answer right now. Try again shortly.');
    }
    throw error;
  }
}

export async function listDomainsForActor(accountId: string, projectId: string) {
  return db.select({
    id: domains.id, name: domains.name, tld: domains.tld, status: domains.status,
    autoRenew: domains.autoRenew, expiresAt: domains.expiresAt, nameservers: domains.nameservers,
    lastWarningLevel: domains.lastWarningLevel, lastError: domains.lastError, createdAt: domains.createdAt,
  }).from(domains).where(and(eq(domains.accountId, accountId), eq(domains.projectId, projectId),
    ne(domains.status, 'failed'))).orderBy(desc(domains.createdAt)).limit(100);
}

export async function getDomainForActor(accountId: string, projectId: string, domainId: string) {
  const [domain] = await db.select().from(domains).where(and(
    eq(domains.id, domainId), eq(domains.accountId, accountId), eq(domains.projectId, projectId)));
  assert(domain, 404, 'DOMAIN_NOT_FOUND', 'Domain not found.');
  const orders = await db.select({ id: domainOrders.id, action: domainOrders.action,
    amountMinor: domainOrders.amountMinor, status: domainOrders.status, error: domainOrders.error,
    createdAt: domainOrders.createdAt }).from(domainOrders)
    .where(eq(domainOrders.domainId, domainId)).orderBy(desc(domainOrders.createdAt)).limit(10);
  return { ...domain, orders };
}
