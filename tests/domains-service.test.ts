import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { closeTestDb, ensureTestDb, getTestDb, resetTestDb, type TestDb } from './helpers/db.js';
import { seedAccount, seedLedgerWallets, seedProject } from './helpers/seed.js';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  register: vi.fn(),
  renew: vi.fn(),
  ready: vi.fn((): boolean => true),
}));

vi.mock('../server/providers/domain-reseller.js', () => ({
  domainReseller: { lookup: mocks.lookup, register: mocks.register, renew: mocks.renew },
  domainResellerReady: mocks.ready,
}));

vi.mock('../server/db/client.js', async () => {
  const harness = await import('./helpers/db.js');
  return { pool: {}, closeDb: async () => {}, db: harness.getTestDb() };
});

import { domainOrders, domains, jobs, ledgerAccounts } from '../server/db/schema.js';
import { ProviderFailure } from '../server/providers/types.js';
import {
  DOMAIN_TLDS, createDomainOrder, parseDomainName, processDomainRegister, processDomainRenew,
  renewDueDomains, setDomainAutoRenew, renewDomainNow,
} from '../server/services/domains.js';

beforeAll(ensureTestDb, 120_000);
beforeEach(() => resetTestDb());
afterAll(closeTestDb);

const registrant = {
  firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.test', phone: '+233244000000',
  country: 'GH', city: 'Accra', postalCode: 'GA-184', addressLine: '12 Test Street',
};

const YEAR_MS = 365 * 86_400_000;

async function seedWorld(db: TestDb, options: { availableMinor?: number } = {}) {
  const account = await seedAccount(db);
  await seedLedgerWallets(db, account.id, options.availableMinor ?? 100_000);
  const project = await seedProject(db, account.id);
  return { account, project };
}

async function wallet(db: TestDb, accountId: string, kind = 'customer_available') {
  const rows = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.accountId, accountId));
  return rows.find(r => r.kind === kind)?.balanceMinor ?? 0;
}

async function seedDomainRow(db: TestDb, params: {
  accountId: string; projectId: string; expiresWithinDays?: number; status?: 'active' | 'expired';
  autoRenew?: boolean; name?: string;
}) {
  const expiresAt = params.expiresWithinDays === undefined ? null
    : new Date(Date.now() + params.expiresWithinDays * 86_400_000);
  const [row] = await db.insert(domains).values({
    accountId: params.accountId, projectId: params.projectId,
    name: params.name ?? `sweep-${Math.random().toString(36).slice(2, 8)}.com`,
    tld: 'com', status: params.status ?? 'active', autoRenew: params.autoRenew ?? true,
    registrant, expiresAt,
  }).returning();
  return row!;
}

describe('parseDomainName', () => {
  it('normalizes case and whitespace and accepts multi-part catalog TLDs', () => {
    expect(parseDomainName('  MyShop.COM ')).toEqual({ name: 'myshop.com', tld: 'com' });
    expect(parseDomainName('brand.co.ke').tld).toBe('co.ke');
    expect(parseDomainName('shop.com.ng').tld).toBe('com.ng');
  });

  it('rejects unsupported TLDs and malformed labels', () => {
    expect(() => parseDomainName('example.io')).toThrow(/unsupported tld/i);
    expect(() => parseDomainName('-bad.com')).toThrow(/letters, numbers and hyphens/i);
    expect(() => parseDomainName('bad-.com')).toThrow(/letters, numbers and hyphens/i);
    expect(() => parseDomainName('nodot')).toThrow(/full domain/i);
  });
});

describe('createDomainOrder', () => {
  it('charges the wallet in advance and queues the register job', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const { domain, orderId } = await createDomainOrder({
      accountId: account.id, projectId: project.id, domain: 'MyShop.Com', registrant,
    });
    expect(domain.status).toBe('pending_register');
    expect(domain.name).toBe('myshop.com');
    expect(domain.expiresAt).toBeNull(); // set only after a real registration
    // 100.00 GHS − 260.00 GHS .com placeholder price
    expect(await wallet(db, account.id)).toBe(74_000);
    const [order] = await db.select().from(domainOrders).where(eq(domainOrders.id, orderId));
    expect(order).toMatchObject({ action: 'register', amountMinor: DOMAIN_TLDS.com.priceMinor, status: 'pending' });
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupKey, `domain.register:${orderId}`));
    expect(job?.kind).toBe('domain.register');
  });

  it('refuses with 402 and creates nothing when the wallet cannot cover it', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db, { availableMinor: 100 });
    await expect(createDomainOrder({ accountId: account.id, projectId: project.id,
      domain: 'neverfunded.com', registrant }))
      .rejects.toMatchObject({ status: 402, code: 'INSUFFICIENT_CREDITS' });
    expect((await db.select().from(domains)).length).toBe(0);
    expect((await db.select().from(domainOrders)).length).toBe(0);
    expect((await db.select().from(jobs)).length).toBe(0);
  });

  it('refuses a duplicate active domain but allows re-buying a failed one by resetting the same row', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    await createDomainOrder({ accountId: account.id, projectId: project.id, domain: 'twice.com', registrant });
    await expect(createDomainOrder({ accountId: account.id, projectId: project.id, domain: 'TWICE.com', registrant }))
      .rejects.toMatchObject({ status: 409, code: 'DOMAIN_TAKEN' });
    await db.update(domains).set({ status: 'failed', providerReference: 'RC-OLD', lastError: 'DOMAIN_PREMIUM_NAME' })
      .where(eq(domains.name, 'twice.com'));
    const again = await createDomainOrder({ accountId: account.id, projectId: project.id, domain: 'twice.com', registrant });
    const rows = await db.select().from(domains).where(eq(domains.name, 'twice.com'));
    expect(rows.length).toBe(1); // one row per domain name, ever
    expect(again.domain.id).toBe(rows[0]!.id);
    expect(again.domain).toMatchObject({ status: 'pending_register', providerReference: null, lastError: null });
  });

  it('refuses when the reseller integration is not ready', async () => {
    const db = getTestDb();
    mocks.ready.mockReturnValueOnce(false);
    const { account, project } = await seedWorld(db);
    await expect(createDomainOrder({ accountId: account.id, projectId: project.id, domain: 'x.com', registrant }))
      .rejects.toMatchObject({ status: 503, code: 'DOMAIN_RESELLER_NOT_CONFIGURED' });
  });
});

describe('processDomainRegister', () => {
  async function orderDomain(db: TestDb) {
    const { account, project } = await seedWorld(db);
    const { domain, orderId } = await createDomainOrder({
      accountId: account.id, projectId: project.id, domain: 'register-me.com', registrant,
    });
    return { account, domain, orderId };
  }

  it('activates the domain with a real expiry when the registrar accepts', async () => {
    const db = getTestDb();
    const { domain, orderId } = await orderDomain(db);
    mocks.register.mockResolvedValue({ providerReference: 'RC-12345', completed: true });
    await expect(processDomainRegister(orderId)).resolves.toEqual({ done: true });
    const [after] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(after?.status).toBe('active');
    expect(after?.providerReference).toBe('RC-12345');
    expect(after!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + YEAR_MS - 86_400_000);
    const [order] = await db.select().from(domainOrders).where(eq(domainOrders.id, orderId));
    expect(order?.status).toBe('done');
  });

  it('persists the in-flight reference and resumes without re-posting the paid operation', async () => {
    const db = getTestDb();
    const { domain, orderId } = await orderDomain(db);
    mocks.register
      .mockResolvedValueOnce({ providerReference: 'RC-555', completed: false }) // registrar has it, still processing
      .mockResolvedValueOnce({ providerReference: 'RC-555', completed: true }); // poll finished on the retry
    await expect(processDomainRegister(orderId))
      .resolves.toEqual({ done: false, retry: true, code: 'DOMAIN_REGISTER_PROCESSING' });
    const [inFlight] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(inFlight?.status).toBe('pending_register'); // honest in-flight, never "active"
    expect(inFlight?.providerReference).toBe('RC-555');
    const [inFlightOrder] = await db.select().from(domainOrders).where(eq(domainOrders.id, orderId));
    expect(inFlightOrder).toMatchObject({ status: 'pending', providerReference: 'RC-555' });
    // The retry must carry the persisted reference so the adapter resumes
    // polling that exact registrar order instead of paying a second time.
    await expect(processDomainRegister(orderId)).resolves.toEqual({ done: true });
    expect(mocks.register).toHaveBeenLastCalledWith(expect.objectContaining({
      domain: 'register-me.com', existingReference: 'RC-555',
    }));
    const [after] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(after?.status).toBe('active');
    const [doneOrder] = await db.select().from(domainOrders).where(eq(domainOrders.id, orderId));
    expect(doneOrder?.status).toBe('done');
  });

  it('refunds in full when the registrar definitively rejects', async () => {
    const db = getTestDb();
    const { account, domain, orderId } = await orderDomain(db);
    const charged = await wallet(db, account.id);
    mocks.register.mockRejectedValue(new ProviderFailure('rejected', 'DOMAIN_PREMIUM_NAME'));
    await processDomainRegister(orderId);
    expect(await wallet(db, account.id)).toBe(charged + DOMAIN_TLDS.com.priceMinor);
    const [order] = await db.select().from(domainOrders).where(eq(domainOrders.id, orderId));
    expect(order).toMatchObject({ status: 'refunded', error: 'DOMAIN_PREMIUM_NAME' });
    const [after] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(after?.status).toBe('failed');
  });

  it('retries without inventing a state when the registrar answer is ambiguous', async () => {
    const db = getTestDb();
    const { account, domain, orderId } = await orderDomain(db);
    const charged = await wallet(db, account.id);
    mocks.register.mockRejectedValue(new ProviderFailure('ambiguous', 'REGISTRAR_TIMEOUT'));
    await expect(processDomainRegister(orderId)).resolves.toMatchObject({ done: false, retry: true });
    expect(await wallet(db, account.id)).toBe(charged); // money stays held, honestly
    const [after] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(after?.status).toBe('pending_register');
  });
});

describe('processDomainRenew', () => {
  it('extends expiry from the current expiry when the registrar accepts', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const domain = await seedDomainRow(db, { accountId: account.id, projectId: project.id, expiresWithinDays: 10 });
    const currentExpiry = domain.expiresAt!;
    const [order] = await db.insert(domainOrders).values({
      domainId: domain.id, accountId: account.id, action: 'renew', periodYears: 1,
      amountMinor: DOMAIN_TLDS.com.priceMinor,
    }).returning();
    mocks.renew.mockResolvedValue({ providerReference: 'RC-REN-1', completed: true });
    await processDomainRenew(order!.id);
    const [after] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(after!.expiresAt!.getTime()).toBeCloseTo(currentExpiry.getTime() + YEAR_MS, -4);
    expect(after?.lastWarningLevel).toBe(0);
    const [done] = await db.select().from(domainOrders).where(eq(domainOrders.id, order!.id));
    expect(done?.status).toBe('done');
  });

  it('keeps the order pending and retries while the renewal is in flight at the registrar', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const domain = await seedDomainRow(db, { accountId: account.id, projectId: project.id,
      expiresWithinDays: 10, name: 'renew-inflight.com' });
    const [order] = await db.insert(domainOrders).values({
      domainId: domain.id, accountId: account.id, action: 'renew', periodYears: 1,
      amountMinor: DOMAIN_TLDS.com.priceMinor,
    }).returning();
    mocks.renew.mockResolvedValue({ providerReference: domain.providerReference ?? 'RC-INFLIGHT', completed: false });
    await expect(processDomainRenew(order!.id))
      .resolves.toEqual({ done: false, retry: true, code: 'DOMAIN_RENEW_PROCESSING' });
    const [after] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(after?.status).toBe('active'); // expiry only moves when it truly completed
    expect(after!.expiresAt).toEqual(domain.expiresAt);
    const [pending] = await db.select().from(domainOrders).where(eq(domainOrders.id, order!.id));
    expect(pending?.status).toBe('pending');
  });

  it('refunds a definite rejection and leaves the domain on its real expiry', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const domain = await seedDomainRow(db, { accountId: account.id, projectId: project.id, expiresWithinDays: 10 });
    const expiryBefore = domain.expiresAt;
    const [order] = await db.insert(domainOrders).values({
      domainId: domain.id, accountId: account.id, action: 'renew', periodYears: 1,
      amountMinor: DOMAIN_TLDS.com.priceMinor,
    }).returning();
    mocks.renew.mockRejectedValue(new ProviderFailure('rejected', 'REGISTRAR_RENEWAL_DENIED'));
    await processDomainRenew(order!.id);
    const [after] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(after!.expiresAt).toEqual(expiryBefore);
    expect(after?.status).toBe('active');
    const [done] = await db.select().from(domainOrders).where(eq(domainOrders.id, order!.id));
    expect(done?.status).toBe('refunded');
  });
});

describe('renewDueDomains', () => {
  it('records expiry honestly: active → expired → lapsed after the grace window', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const expired = await seedDomainRow(db, { accountId: account.id, projectId: project.id,
      expiresWithinDays: -2, autoRenew: false, name: 'expired-honestly.com' });
    const lapsed = await seedDomainRow(db, { accountId: account.id, projectId: project.id,
      expiresWithinDays: -45, autoRenew: false, status: 'expired', name: 'lapsed-lost.com' });
    await renewDueDomains();
    const [afterExpired] = await db.select().from(domains).where(eq(domains.id, expired.id));
    expect(afterExpired?.status).toBe('expired');
    const [afterLapsed] = await db.select().from(domains).where(eq(domains.id, lapsed.id));
    expect(afterLapsed?.status).toBe('lapsed'); // lost — recorded, never hidden
  });

  it('charges auto-renewals in the 30-day window and queues the renew job', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const before = await wallet(db, account.id);
    const domain = await seedDomainRow(db, { accountId: account.id, projectId: project.id, expiresWithinDays: 20 });
    await renewDueDomains();
    const [order] = await db.select().from(domainOrders).where(eq(domainOrders.domainId, domain.id));
    expect(order).toMatchObject({ action: 'renew', status: 'pending', amountMinor: DOMAIN_TLDS.com.priceMinor });
    expect(await wallet(db, account.id)).toBe(before - DOMAIN_TLDS.com.priceMinor);
    const [job] = await db.select().from(jobs).where(eq(jobs.kind, 'domain.renew'));
    expect(job?.payload).toMatchObject({ orderId: order!.id });
    // Renewal completes only through the job (mirrors the register flow).
    mocks.renew.mockResolvedValue({ providerReference: 'RC-REN-2', completed: true });
    await processDomainRenew(order!.id);
    const [after] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(after!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + YEAR_MS - 86_400_000);
  });

  it('warns by threshold and never charges when auto-renew is off', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const before = await wallet(db, account.id);
    await seedDomainRow(db, { accountId: account.id, projectId: project.id, expiresWithinDays: 10, autoRenew: false });
    await renewDueDomains();
    const [row] = await db.select().from(domains).where(eq(domains.lastWarningLevel, 2));
    expect(row).toBeTruthy(); // 10 days left → level 2 (14-day threshold)
    expect(await wallet(db, account.id)).toBe(before);
    expect((await db.select().from(domainOrders)).length).toBe(0);
  });

  it('records insufficient funds visibly and retries on the next sweep', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db, { availableMinor: 500 });
    const domain = await seedDomainRow(db, { accountId: account.id, projectId: project.id, expiresWithinDays: 5 });
    await renewDueDomains();
    const [after] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(after?.lastError).toBe('DOMAIN_RENEWAL_INSUFFICIENT_CREDITS');
    expect(after?.status).toBe('active'); // still active until real expiry
    expect((await db.select().from(domainOrders)).length).toBe(0);
  });

  it('never creates a second renewal order while one is pending', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const domain = await seedDomainRow(db, { accountId: account.id, projectId: project.id, expiresWithinDays: 15 });
    await renewDueDomains();
    await renewDueDomains();
    const orders = await db.select().from(domainOrders).where(eq(domainOrders.domainId, domain.id));
    expect(orders.length).toBe(1);
  });
});

describe('renewDomainNow + setDomainAutoRenew', () => {
  it('charges and queues a manual renewal for an active domain', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const domain = await seedDomainRow(db, { accountId: account.id, projectId: project.id, expiresWithinDays: 200 });
    const before = await wallet(db, account.id);
    const { orderId } = await renewDomainNow({ accountId: account.id, projectId: project.id, domainId: domain.id });
    expect(await wallet(db, account.id)).toBe(before - DOMAIN_TLDS.com.priceMinor);
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupKey, `domain.renew:${orderId}`));
    expect(job?.kind).toBe('domain.renew');
  });

  it('toggles auto-renew on an owned domain and 404s on someone else\'s', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const domain = await seedDomainRow(db, { accountId: account.id, projectId: project.id, expiresWithinDays: 100 });
    await setDomainAutoRenew({ accountId: account.id, projectId: project.id, domainId: domain.id, autoRenew: false });
    const [after] = await db.select().from(domains).where(eq(domains.id, domain.id));
    expect(after?.autoRenew).toBe(false);
    const { account: other } = await seedWorld(db);
    await expect(setDomainAutoRenew({ accountId: other.id, projectId: project.id, domainId: domain.id, autoRenew: true }))
      .rejects.toMatchObject({ status: 404, code: 'DOMAIN_NOT_FOUND' });
  });
});
