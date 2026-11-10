import { describe, expect, it, vi } from 'vitest';

// ResellerClub adapter tests. The contract is vendor-documented
// (developer.resellerclub.com + its OpenAPI spec, fetched 2026-11-10 — pinned
// in docs/domains.md). The stub tests pin the honest default: without real
// credentials every method refuses definitely. The factory tests drive the
// real adapter through a fake fetch and pin the vendor contract plus the
// money rules: PayInvoice only, registrar-side autoRenew off, exactly ONE
// paid POST per operation, and resume-after-payment instead of re-posting.

const { createDomainReseller, domainReseller, domainResellerReady, splitPhone } =
  await import('../server/providers/domain-reseller.js');

describe('domain reseller stub', () => {
  it('is not ready while no credentials are configured', () => {
    expect(domainResellerReady()).toBe(false);
  });

  it('refuses lookups, registrations and renewals with a definite not-configured failure', async () => {
    const registrant = {
      firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.test', phone: '+233244000000',
      country: 'GH', city: 'Accra', postalCode: 'GA-184', addressLine: '12 Test Street',
    };
    await expect(domainReseller.lookup('example.com'))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_RESELLER_NOT_CONFIGURED' });
    await expect(domainReseller.register({ domain: 'example.com', periodYears: 1, registrant }))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_RESELLER_NOT_CONFIGURED' });
    await expect(domainReseller.renew({ domain: 'example.com', currentExpiry: new Date(), periodYears: 1 }))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_RESELLER_NOT_CONFIGURED' });
  });
});

const BASE = 'https://api.sandbox.resellerclub.com/v2';
// Trailing slash on purpose: the adapter must normalize it away.
const ENV = { url: `${BASE}/`, username: 'user-1', apiKey: 'key-1' };

const registrant = {
  firstName: 'Ama', lastName: 'Mensah', email: 'ama@example.test', phone: '+233244000000',
  country: 'GH', city: 'Accra', postalCode: 'GA-184', addressLine: '12 Test Street',
};

interface FakeCall { url: string; method: string; headers: Record<string, string>; body?: unknown }

/** Scripted fake: responses are popped in call order; `fallback` answers anything extra. */
function fakeFetch(script: Array<{ status: number; body?: unknown }>,
  fallback?: () => { status: number; body?: unknown }) {
  const calls: FakeCall[] = [];
  const queue = [...script];
  const fetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), method: init?.method ?? 'GET', headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    const next = queue.shift() ?? fallback?.();
    if (!next) throw new Error(`unexpected extra fetch to ${url}`);
    return new Response(next.body === undefined ? null : JSON.stringify(next.body),
      { status: next.status, headers: { 'content-type': 'application/json' } });
  });
  return { fetch: fetch as unknown as typeof fetch, calls };
}

function client(fetch: typeof fetch) {
  return createDomainReseller({ env: ENV, fetch, sleep: async () => {} });
}

function posts(calls: FakeCall[], pathIncludes: string) {
  return calls.filter(c => c.method === 'POST' && c.url.includes(pathIncludes));
}

const actions = (status: string) => ({
  status: 200,
  body: { actions: [{ orderId: 789, actionType: 'AddDomain', actionStatus: status, actionStatusDesc: '' }] },
});

describe('domain reseller lookup', () => {
  it('trusts only the verified available status and sends both auth headers', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: {
      domains: [{ domainName: 'example.com', classkey: 'domc', status: 'available', cost: [] }] } }]);
    await expect(client(fetch).lookup('Example.COM')).resolves.toEqual({ available: true });
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toBe(`${BASE}/domains/available?domainName=example&tlds=com`);
    expect(calls[0]!.headers.Authorization).toBe('ApiKey key-1');
    expect(calls[0]!.headers['X-User-Id']).toBe('user-1');
  });

  it('answers ambiguous on unverified status vocabulary — never a guessed boolean', async () => {
    const { fetch } = fakeFetch([{ status: 200, body: {
      domains: [{ domainName: 'taken.com', classkey: 'domc', status: 'regthroughus' }] } }]);
    await expect(client(fetch).lookup('taken.com'))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'DOMAIN_LOOKUP_AMBIGUOUS' });
  });

  it('rejects definitely when the registry returns an entry error', async () => {
    const { fetch } = fakeFetch([{ status: 200, body: {
      domains: [{ domainName: 'x.com', status: 'error', error: 'invalid domain' }] } }]);
    await expect(client(fetch).lookup('x.com'))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_LOOKUP_REJECTED' });
  });

  it('answers ambiguous on provider outages instead of guessing', async () => {
    const { fetch } = fakeFetch([{ status: 503, body: { message: 'down' } }]);
    await expect(client(fetch).lookup('x.com'))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'DOMAIN_LOOKUP_UNAVAILABLE' });
  });
});

describe('domain reseller register', () => {
  const byName404 = { status: 404, body: { message: 'not found' } };

  it('follows the documented journey: one customers POST, one contacts POST, ONE domains POST', async () => {
    const { fetch, calls } = fakeFetch([
      byName404,
      { status: 200, body: { customerId: 123, status: 'Success' } },
      { status: 200, body: { contactId: 456 } },
      { status: 200, body: { orderId: 789, status: 'Success' } },
      actions('Completed'),
    ]);
    const result = await client(fetch).register({ domain: 'Example.COM', periodYears: 1, registrant });
    expect(result).toEqual({ providerReference: '789', completed: true });
    const paths = calls.filter(c => c.method === 'POST').map(c => new URL(c.url).pathname);
    expect(paths).toEqual(['/v2/customers', '/v2/contacts', '/v2/domains']);
    const [customer, contact, register] = calls.filter(c => c.method === 'POST');
    // Phone split and required zipcode reach the vendor in ITS field shape.
    expect(customer!.body).toMatchObject({ phoneCountryCode: '233', phone: '244000000', zipcode: 'GA-184', country: 'GH' });
    expect(contact!.body).toMatchObject({ customerId: '123', email: 'ama@example.test', zipcode: 'GA-184' });
    // Paid operation pinned: PayInvoice, registrar autoRenew OFF, one contact
    // in all four roles, no guessed nameservers.
    expect(register!.body).toEqual({
      domainName: 'example.com', years: 1, customerId: '123',
      regContactId: '456', adminContactId: '456', techContactId: '456', billingContactId: '456',
      invoiceOption: 'PayInvoice', autoRenew: false,
    });
  });

  it('returns completed:false while the action is still processing (money committed, not done)', async () => {
    const { fetch } = fakeFetch([
      byName404,
      { status: 200, body: { customerId: 123 } },
      { status: 200, body: { contactId: 456 } },
      { status: 200, body: { orderId: 555 } },
    ], () => actions('Being Processed'));
    await expect(client(fetch).register({ domain: 'pending.com', periodYears: 1, registrant }))
      .resolves.toEqual({ providerReference: '555', completed: false });
  });

  it('resumes an existing reference by polling only — never re-posts the paid operation', async () => {
    const { fetch, calls } = fakeFetch([actions('Completed')]);
    const result = await client(fetch)
      .register({ domain: 'pending.com', periodYears: 1, registrant, existingReference: '555' });
    expect(result).toEqual({ providerReference: '555', completed: true });
    expect(calls.length).toBe(1);
    expect(calls[0]!.method).toBe('GET');
    expect(calls[0]!.url).toContain('/actions/search-current?orderId=555');
    expect(calls.every(c => c.method !== 'POST')).toBe(true);
  });

  it('confirms a vanished action through the by-name order proof when it exists', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 200, body: { actions: [] } },
      { status: 200, body: { orderId: 555, status: 'Active' } },
    ]);
    await expect(client(fetch)
      .register({ domain: 'pending.com', periodYears: 1, registrant, existingReference: '555' }))
      .resolves.toEqual({ providerReference: '555', completed: true });
    expect(calls[1]!.url).toContain('/domains/by-name/pending.com');
  });

  it('answers unresolved (money held) when a vanished action has no order to show', async () => {
    const { fetch } = fakeFetch([
      { status: 200, body: { actions: [] } },
      { status: 404, body: {} },
    ]);
    await expect(client(fetch)
      .register({ domain: 'pending.com', periodYears: 1, registrant, existingReference: '555' }))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'DOMAIN_REGISTER_UNRESOLVED' });
  });

  it('claims an already-registered name instead of paying twice', async () => {
    const { fetch, calls } = fakeFetch([{ status: 200, body: { orderId: 321, status: 'Active' } }]);
    await expect(client(fetch).register({ domain: 'already-ours.com', periodYears: 1, registrant }))
      .resolves.toEqual({ providerReference: '321', completed: true });
    expect(calls.every(c => c.method !== 'POST')).toBe(true); // zero paid calls
  });

  it('rejects definitively when the registrar fails the action', async () => {
    const { fetch } = fakeFetch([
      byName404,
      { status: 200, body: { customerId: 123 } },
      { status: 200, body: { contactId: 456 } },
      { status: 200, body: { orderId: 777 } },
      actions('Failed'),
    ]);
    await expect(client(fetch).register({ domain: 'doomed.com', periodYears: 1, registrant }))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_REGISTER_FAILED' });
  });

  it('rejects definitively when the registrar rejects the order itself', async () => {
    const { fetch } = fakeFetch([
      byName404,
      { status: 200, body: { customerId: 123 } },
      { status: 200, body: { contactId: 456 } },
      { status: 422, body: { message: 'premium name' } },
    ]);
    await expect(client(fetch).register({ domain: 'premium.com', periodYears: 1, registrant }))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_REGISTER_REJECTED' });
  });

  it('answers ambiguous when pre-POST steps fail transiently (orphan customers cost nothing)', async () => {
    const { fetch } = fakeFetch([
      byName404,
      { status: 500, body: { message: 'boom' } },
    ]);
    await expect(client(fetch).register({ domain: 'flaky.com', periodYears: 1, registrant }))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'DOMAIN_RESELLER_UNAVAILABLE' });
  });
});

describe('domain reseller renew', () => {
  const expiry = new Date(Date.now() + 10 * 86_400_000);
  const renewInput = { domain: 'renew-me.com', providerReference: '789', currentExpiry: expiry, periodYears: 1 };

  it('sends expDate as epoch SECONDS with PayInvoice and autoRenew off', async () => {
    const { fetch, calls } = fakeFetch([
      { status: 404, body: {} }, // no order details readable → expDate guard carries the safety
      { status: 200, body: { status: 'Success' } },
      { status: 200, body: { actions: [{ orderId: 789, actionStatus: 'Completed' }] } },
    ]);
    await expect(client(fetch).renew(renewInput))
      .resolves.toEqual({ providerReference: '789', completed: true });
    const renew = posts(calls, '/renew');
    expect(renew.length).toBe(1);
    expect(renew[0]!.body).toEqual({
      years: 1, expDate: Math.floor(expiry.getTime() / 1000),
      invoiceOption: 'PayInvoice', autoRenew: false,
    });
  });

  it('skips the paid call when the registrar expiry is already beyond the renew basis', async () => {
    const farFuture = Math.floor((Date.now() + 400 * 86_400_000) / 1000);
    const { fetch, calls } = fakeFetch([{ status: 200, body: { orderId: 789, endtime: farFuture } }]);
    await expect(client(fetch).renew(renewInput))
      .resolves.toEqual({ providerReference: '789', completed: true });
    expect(calls.every(c => c.method !== 'POST')).toBe(true);
  });

  it('answers ambiguous while the renewal action is still processing', async () => {
    const { fetch } = fakeFetch([
      { status: 404, body: {} },
      { status: 200, body: { status: 'Success' } },
    ], () => ({ status: 200, body: { actions: [{ orderId: 789, actionStatus: 'Added' }] } }));
    await expect(client(fetch).renew(renewInput))
      .resolves.toEqual({ providerReference: '789', completed: false });
  });

  it('rejects definitively when the order is not found at the registrar', async () => {
    // Both the details probe and the renew POST itself answer 404.
    const { fetch } = fakeFetch([{ status: 404, body: {} }, { status: 404, body: {} }]);
    await expect(client(fetch).renew(renewInput))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_RENEW_ORDER_MISSING' });
  });

  it('refuses without a provider reference instead of guessing one', async () => {
    const { fetch, calls } = fakeFetch([]);
    await expect(client(fetch).renew({ ...renewInput, providerReference: undefined }))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'DOMAIN_RENEW_NO_REFERENCE' });
    expect(calls.length).toBe(0);
  });
});

describe('splitPhone', () => {
  it('splits +international, 0-prefixed national and bare national numbers by the ISO country', () => {
    expect(splitPhone('+233244000000', 'GH')).toEqual({ code: '233', number: '244000000' });
    expect(splitPhone('0244000000', 'GH')).toEqual({ code: '233', number: '244000000' });
    expect(splitPhone('+233 (0) 244-000-000', 'GH')).toEqual({ code: '233', number: '244000000' });
    expect(splitPhone('+1 202 555 0123', 'US')).toEqual({ code: '1', number: '2025550123' });
    expect(splitPhone('02025550123', 'GB')).toEqual({ code: '44', number: '2025550123' });
  });

  it('rejects unsplittable input definitely — never a guessed country code', () => {
    expect(() => splitPhone('02025550123', 'ZZ')).toThrow('DOMAIN_PHONE_COUNTRY_UNSUPPORTED');
    expect(() => splitPhone('not-a-number', 'GH')).toThrow('DOMAIN_PHONE_INVALID');
    expect(() => splitPhone('+23324', 'GH')).toThrow('DOMAIN_PHONE_INVALID');
    expect(() => splitPhone('', 'GH')).toThrow('DOMAIN_PHONE_INVALID');
  });
});
