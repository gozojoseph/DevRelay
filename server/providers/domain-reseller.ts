import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { ProviderFailure } from './types.js';

// Domain reseller adapter (docs/domains.md): DevRelay registers and renews
// customer domains through ResellerClub (supplier chosen 2026-11-10, replacing
// the un-purchased HostAfrica reseller package).
//
// CONTRACT — vendor-documented only (developer.resellerclub.com + the OpenAPI
// spec served by it, fetched 2026-11-10). Nothing here is guessed:
//
//   Auth (both headers on EVERY request):
//     Authorization: ApiKey <api key>
//     X-User-Id:     <reseller user id>
//   Environments (DOMAIN_RESELLER_URL selects one):
//     sandbox https://api.sandbox.resellerclub.com/v2
//     live    https://api.resellerclub.com/v2
//
//   GET  /domains/available?domainName=<sld>&tlds=<tld>
//        -> { domains: [{ domainName, classkey, status, cost[], error }] }
//   POST /customers  -> { customerId, status }
//   POST /contacts   -> { contactId }   (one contact is reused for all four
//        roles, as the vendor quickstart instructs)
//   POST /domains    { domainName, years, customerId, regContactId,
//        adminContactId, techContactId, billingContactId, invoiceOption,
//        autoRenew }  -> { orderId, status: Success|PendingDomainVerification }
//        (`ns` is NOT in the schema's required list — omitting it lets the
//        registrar default apply; nameserver management is a later phase)
//   GET  /actions/search-current?orderId=<id>&size=10&page=1
//        -> { actions: [{ orderId, actionType, actionStatus, actionStatusDesc }] }
//        actionStatus typical values (vendor quickstart): Added | Being
//        Processed | Completed | Failed. The OpenAPI spec does not enumerate
//        them, so anything unknown is treated as still processing.
//   POST /domains/{orderId}/renew { years, expDate (epoch SECONDS),
//        invoiceOption, autoRenew }  -> order response
//        (expDate makes a stale retry reject at the registrar instead of
//        double-renewing — the vendor's own idempotency guard)
//   GET  /domains/by-name/{domainName} -> order details (404 when the domain
//        is not registered under this reseller account)
//
// HONEST-MONEY CHOICES PINNED HERE:
// - invoiceOption 'PayInvoice' everywhere: the reseller wallet must be able to
//   pay or the order pends at the registrar — never a silent unpaid execution.
// - autoRenew false at the registrar: DevRelay's own sweep renews from the
//   CUSTOMER wallet; registrar-side auto-renew would bill the reseller wallet
//   for money the customer never owed.
// - Registration/renewal is asynchronous. Every paid call either reaches a
//   terminal answer (Completed / Failed) inside one attempt, or returns
//   completed:false with the provider order id so the service persists it and
//   the next attempt RESUMES polling — a paid operation is NEVER re-submitted.

export interface DomainRegistrant {
  firstName: string; lastName: string; email: string; phone: string;
  country: string; // ISO 3166-1 alpha-2, e.g. GH
  city: string; postalCode: string; addressLine: string;
  organisation?: string;
}

export interface DomainRegisterInput {
  domain: string; periodYears: number; registrant: DomainRegistrant;
  /** Provider order id persisted from an earlier attempt — resume, never re-post. */
  existingReference?: string;
}

export interface DomainRenewInput {
  domain: string; providerReference?: string;
  currentExpiry: Date; periodYears: number;
}

export interface DomainActionResult {
  providerReference: string;
  /** false = submitted and in flight; the caller must persist providerReference and retry. */
  completed: boolean;
}

export interface DomainResellerAdapter {
  /** Registry availability. Ambiguous answers surface as ProviderFailure, never a guessed boolean. */
  lookup(domain: string): Promise<{ available: boolean }>;
  register(input: DomainRegisterInput): Promise<DomainActionResult>;
  renew(input: DomainRenewInput): Promise<DomainActionResult>;
}

export class ProviderNotConfiguredError extends ProviderFailure {
  constructor() { super('rejected', 'DOMAIN_RESELLER_NOT_CONFIGURED'); }
}

/**
 * Availability vocabulary. The spec types `status` as a free string without
 * enumerating values, so until the sandbox probe (go-live checklist step 1 in
 * docs/domains.md) only exact matches are trusted and anything else is
 * ambiguous. KNOWN_TAKEN is filled ONLY from live-verified answers.
 */
const KNOWN_AVAILABLE = new Set(['available']);
const KNOWN_TAKEN = new Set<string>();

const POLL_INTERVAL_MS = 2_000;
const POLL_BUDGET_MS = 45_000;
/** Hard cap on poll rounds: even a broken/degenerate sleep cannot hammer the API. */
const POLL_MAX_ATTEMPTS = 25;
const REQUEST_TIMEOUT_MS = 30_000;

/** ITU country dial codes for the registrant countries we accept at launch. */
const DIAL_CODES: Record<string, string> = {
  GH: '233', NG: '234', KE: '254', TZ: '255', UG: '256', RW: '250', BI: '257',
  ET: '251', DJ: '253', SO: '252', ZA: '27', LS: '266', BW: '267', NA: '264',
  ZM: '260', ZW: '263', MW: '265', MZ: '258', AO: '244', CD: '243', CG: '242',
  GA: '241', CM: '237', CF: '236', TD: '235', NE: '227', BJ: '229', TG: '228',
  BF: '226', CI: '225', LR: '231', SL: '232', GN: '224', GM: '220', SN: '221',
  ML: '223', MR: '222', EG: '20', MA: '212', TN: '216', DZ: '213', US: '1',
  CA: '1', GB: '44', IN: '91', DE: '49', FR: '33', NL: '31', ES: '34', IT: '39',
  AE: '971', SA: '966',
};

interface ResellerEnv { url?: string; username?: string; apiKey?: string }

interface ResellerDeps {
  env: ResellerEnv;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

function envReady(env: ResellerEnv): boolean {
  return Boolean(env.url && env.username && env.apiKey);
}

function requireEnv(env: ResellerEnv): { url: string; username: string; apiKey: string } {
  if (!envReady(env)) throw new ProviderNotConfiguredError();
  return { url: env.url!.replace(/\/+$/, ''), username: env.username!, apiKey: env.apiKey! };
}

function ambiguous(publicCode: string): ProviderFailure {
  return new ProviderFailure('ambiguous', publicCode);
}

/** Reseller credentials missing → definite not-configured refusal. */
function missing(env: ResellerEnv): boolean { return !envReady(env); }

/**
 * Splits an international phone into ResellerClub's separate country code and
 * number fields. Requires either +-international form or a plain national
 * number disambiguated by the registrant's ISO country — anything else is a
 * definite rejection, never a guessed split.
 */
export function splitPhone(raw: string, country: string): { code: string; number: string } {
  const dial = DIAL_CODES[country.toUpperCase()];
  const cleaned = raw.replace(/[\s\-().]/g, '');
  const digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (!/^\d+$/.test(digits) || digits.length < 7) throw new ProviderFailure('rejected', 'DOMAIN_PHONE_INVALID');
  if (!dial) throw new ProviderFailure('rejected', 'DOMAIN_PHONE_COUNTRY_UNSUPPORTED');
  let rest = digits;
  if (rest.startsWith(dial) && rest.length > dial.length) rest = rest.slice(dial.length);
  // The trunk prefix (leading 0) is never dialed internationally — drop it
  // whether it followed the country code or the bare national number.
  rest = rest.replace(/^0+/, '');
  if (!/^\d+$/.test(rest) || rest.length < 6) throw new ProviderFailure('rejected', 'DOMAIN_PHONE_INVALID');
  return { code: dial, number: rest };
}

/** One authenticated HTTP call; returns status + parsed JSON (when JSON). */
async function call(deps: ResellerDeps, path: string, init: {
  method: 'GET' | 'POST'; body?: string;
}): Promise<{ status: number; body: unknown }> {
  const { url, username, apiKey } = requireEnv(deps.env);
  let response: Response;
  try {
    response = await deps.fetch(`${url}${path}`, {
      method: init.method,
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `ApiKey ${apiKey}`,
        'X-User-Id': username,
      },
      ...(init.body ? { body: init.body } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw ambiguous('DOMAIN_RESELLER_UNREACHABLE');
  }
  const text = await response.text();
  let body: unknown;
  try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
  return { status: response.status, body };
}

function isTransient(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

// Vendor payloads are untrusted — narrowed through these, never trusted blind.
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function str(value: unknown): string | undefined {
  return value == null || value === '' ? undefined : String(value);
}

/**
 * Looks up whether a domain name is already an order under THIS reseller
 * account. 404 is a clean "not ours" answer, not an error.
 */
async function findOwnOrderId(deps: ResellerDeps, name: string): Promise<string | undefined> {
  const { status, body } = await call(deps, `/domains/by-name/${encodeURIComponent(name)}`, { method: 'GET' });
  if (status === 404) return undefined;
  if (isTransient(status)) throw ambiguous('DOMAIN_RESELLER_UNAVAILABLE');
  if (status !== 200) throw new ProviderFailure('rejected', 'DOMAIN_LOOKUP_REJECTED');
  const record = asRecord(body);
  const id = str(record?.orderId ?? record?.order_id);
  if (!id) throw ambiguous('DOMAIN_RESELLER_UNRESOLVED');
  return id;
}

async function ensureCustomer(deps: ResellerDeps, registrant: DomainRegistrant): Promise<string> {
  const localPart = registrant.email.split('@')[0]!.replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'devrelay';
  const username = `${localPart}.${randomBytes(4).toString('hex')}`;
  const password = randomBytes(12).toString('base64url');
  const { code, number } = splitPhone(registrant.phone, registrant.country);
  const { status, body } = await call(deps, '/customers', {
    method: 'POST',
    body: JSON.stringify({
      username, password,
      name: `${registrant.firstName} ${registrant.lastName}`.trim(),
      company: registrant.organisation || `${registrant.firstName} ${registrant.lastName}`.trim(),
      addressLine1: registrant.addressLine,
      city: registrant.city,
      country: registrant.country.toUpperCase(),
      zipcode: registrant.postalCode,
      phoneCountryCode: code,
      phone: number,
    }),
  });
  if (isTransient(status)) throw ambiguous('DOMAIN_RESELLER_UNAVAILABLE');
  if (status !== 200) throw new ProviderFailure('rejected', 'DOMAIN_CUSTOMER_REJECTED');
  const customerId = str(asRecord(body)?.customerId);
  if (!customerId) throw ambiguous('DOMAIN_RESELLER_UNRESOLVED');
  return customerId;
}

async function ensureContact(deps: ResellerDeps, customerId: string, registrant: DomainRegistrant): Promise<string> {
  const { code, number } = splitPhone(registrant.phone, registrant.country);
  const { status, body } = await call(deps, '/contacts', {
    method: 'POST',
    body: JSON.stringify({
      customerId, type: 'Contact',
      name: `${registrant.firstName} ${registrant.lastName}`.trim(),
      email: registrant.email,
      addressLine1: registrant.addressLine,
      city: registrant.city,
      country: registrant.country.toUpperCase(),
      zipcode: registrant.postalCode,
      phoneCountryCode: code,
      phone: number,
    }),
  });
  if (isTransient(status)) throw ambiguous('DOMAIN_RESELLER_UNAVAILABLE');
  if (status !== 200) throw new ProviderFailure('rejected', 'DOMAIN_CONTACT_REJECTED');
  const contactId = str(asRecord(body)?.contactId ?? asRecord(body)?.value); // quickstart: "copy contactId (or value)"
  if (!contactId) throw ambiguous('DOMAIN_RESELLER_UNRESOLVED');
  return contactId;
}

type PollOutcome =
  | { outcome: 'completed' }
  | { outcome: 'processing' }
  | { outcome: 'failed' };

/**
 * Polls /actions/search-current until a terminal answer, the budget ends
 * ('processing'), or — for registrations — the action vanishes from the
 * current list, in which case the vendor quickstart says to confirm via the
 * order itself: found → completed; not found → unresolved (money stays held).
 */
async function pollActions(deps: ResellerDeps, params: {
  orderId: string; prefix: string;
  /** Renew actions complete invisibly (order already exists); register needs the by-name proof. */
  existenceProof: string | undefined;
}): Promise<PollOutcome> {
  const deadline = Date.now() + POLL_BUDGET_MS;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const { status, body } = await call(deps,
      `/actions/search-current?orderId=${encodeURIComponent(params.orderId)}&size=10&page=1`, { method: 'GET' });
    if (status === 200) {
      const actions = asArray(asRecord(body)?.actions).map(a => asRecord(a))
        .filter((a): a is Record<string, unknown> => a !== undefined);
      const action = actions.find(a => str(a.orderId) === params.orderId) ?? actions[0];
      if (action) {
        const actionStatus = str(action.actionStatus);
        if (actionStatus === 'Completed') return { outcome: 'completed' };
        if (actionStatus === 'Failed') return { outcome: 'failed' };
        // Added / Being Processed / unknown vocabulary → keep polling
      } else if (params.existenceProof !== undefined) {
        const own = await findOwnOrderId(deps, params.existenceProof);
        if (own) return { outcome: 'completed' };
        throw ambiguous(`${params.prefix}_UNRESOLVED`);
      } else {
        // Renew: a successful POST with no in-flight action has finished.
        return { outcome: 'completed' };
      }
    }
    if (Date.now() >= deadline) return { outcome: 'processing' };
    await deps.sleep(POLL_INTERVAL_MS);
  }
  return { outcome: 'processing' };
}

/** Defensive expiry scan of order details: keys like expiry/endtime, seconds or ms epoch. */
function scanExpiryEpoch(node: unknown, depth = 0): number | undefined {
  if (depth > 4) return undefined;
  const record = asRecord(node);
  if (!record) return undefined;
  let best: number | undefined;
  for (const [key, value] of Object.entries(record)) {
    if (/expir|endtime|end_time|expiration/i.test(key) && (typeof value === 'number' || typeof value === 'string')) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 100_000_000) {
        const seconds = numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
        best = best === undefined ? seconds : Math.max(best, seconds);
      }
    } else if (typeof value === 'object') {
      const nested = scanExpiryEpoch(value, depth + 1);
      if (nested !== undefined && (best === undefined || nested > best)) best = nested;
    }
  }
  return best;
}

async function registrarExpiry(deps: ResellerDeps, orderId: string): Promise<number | undefined> {
  const { status, body } = await call(deps, `/domains/${encodeURIComponent(orderId)}`, { method: 'GET' });
  if (status !== 200) return undefined; // cannot tell — the expDate guard still protects the renewal
  return scanExpiryEpoch(body);
}

export function createDomainReseller(deps: ResellerDeps): DomainResellerAdapter {
  return {
    async lookup(domain) {
      const name = domain.trim().toLowerCase();
      const dot = name.indexOf('.');
      if (dot <= 0) throw new ProviderFailure('rejected', 'DOMAIN_LOOKUP_REJECTED');
      const sld = name.slice(0, dot);
      const tld = name.slice(dot + 1);
      const { status, body } = await call(deps,
        `/domains/available?domainName=${encodeURIComponent(sld)}&tlds=${encodeURIComponent(tld)}`, { method: 'GET' });
      if (isTransient(status)) throw ambiguous('DOMAIN_LOOKUP_UNAVAILABLE');
      if (status !== 200) throw new ProviderFailure('rejected', 'DOMAIN_LOOKUP_REJECTED');
      const entries = asArray(asRecord(body)?.domains).map(e => asRecord(e))
        .filter((e): e is Record<string, unknown> => e !== undefined);
      const entry = entries.find(e => str(e.domainName) === name || str(e.domainName) === sld) ?? entries[0];
      if (!entry) throw ambiguous('DOMAIN_LOOKUP_AMBIGUOUS');
      if (str(entry.error)) throw new ProviderFailure('rejected', 'DOMAIN_LOOKUP_REJECTED');
      const entryStatus = str(entry.status);
      if (entryStatus && KNOWN_AVAILABLE.has(entryStatus)) return { available: true };
      if (entryStatus && KNOWN_TAKEN.has(entryStatus)) return { available: false };
      // Unverified status vocabulary → ambiguous, never a guessed boolean.
      throw ambiguous('DOMAIN_LOOKUP_AMBIGUOUS');
    },

    async register(input) {
      if (missing(deps.env)) throw new ProviderNotConfiguredError();
      const name = input.domain.trim().toLowerCase();

      // Resume: an earlier attempt already submitted the paid operation.
      if (input.existingReference) {
        const poll = await pollActions(deps, { orderId: input.existingReference, prefix: 'DOMAIN_REGISTER',
          existenceProof: name });
        if (poll.outcome === 'completed') return { providerReference: input.existingReference, completed: true };
        if (poll.outcome === 'failed') throw new ProviderFailure('rejected', 'DOMAIN_REGISTER_FAILED');
        return { providerReference: input.existingReference, completed: false };
      }

      // Race guard: already registered under this account (e.g. after a DB
      // reset) → claim it instead of paying twice.
      const own = await findOwnOrderId(deps, name);
      if (own) return { providerReference: own, completed: true };

      const customerId = await ensureCustomer(deps, input.registrant);
      const contactId = await ensureContact(deps, customerId, input.registrant);
      const { status, body } = await call(deps, '/domains', {
        method: 'POST',
        body: JSON.stringify({
          domainName: name,
          years: input.periodYears,
          customerId,
          regContactId: contactId, adminContactId: contactId,
          techContactId: contactId, billingContactId: contactId,
          invoiceOption: 'PayInvoice',
          autoRenew: false,
        }),
      });
      if (isTransient(status)) throw ambiguous('DOMAIN_REGISTER_UNAVAILABLE');
      if (status !== 200) throw new ProviderFailure('rejected', 'DOMAIN_REGISTER_REJECTED');
      const orderId = str(asRecord(body)?.orderId);
      if (!orderId) throw ambiguous('DOMAIN_REGISTER_UNRESOLVED');
      const poll = await pollActions(deps, { orderId, prefix: 'DOMAIN_REGISTER', existenceProof: name });
      if (poll.outcome === 'completed') return { providerReference: orderId, completed: true };
      if (poll.outcome === 'failed') throw new ProviderFailure('rejected', 'DOMAIN_REGISTER_FAILED');
      // Still processing: the money is already committed at the registrar —
      // hand the order id back so the service persists it and the next
      // attempt resumes polling instead of paying twice.
      return { providerReference: orderId, completed: false };
    },

    async renew(input) {
      if (missing(deps.env)) throw new ProviderNotConfiguredError();
      const orderId = input.providerReference?.trim();
      if (!orderId) throw new ProviderFailure('rejected', 'DOMAIN_RENEW_NO_REFERENCE');
      const name = input.domain.trim().toLowerCase();

      // Already-applied guard: if the registrar's expiry is already beyond the
      // expiry this renewal is based on, a previous attempt landed — never
      // renew (and never charge the reseller wallet) twice.
      const expirySeconds = Math.floor(input.currentExpiry.getTime() / 1000);
      const registrarExpirySeconds = await registrarExpiry(deps, orderId);
      if (registrarExpirySeconds !== undefined && registrarExpirySeconds > expirySeconds + 86_400) {
        return { providerReference: orderId, completed: true };
      }

      const { status, body } = await call(deps, `/domains/${encodeURIComponent(orderId)}/renew`, {
        method: 'POST',
        body: JSON.stringify({
          years: input.periodYears,
          expDate: expirySeconds,
          invoiceOption: 'PayInvoice',
          autoRenew: false,
        }),
      });
      if (status === 404) throw new ProviderFailure('rejected', 'DOMAIN_RENEW_ORDER_MISSING');
      if (isTransient(status)) throw ambiguous('DOMAIN_RENEW_UNAVAILABLE');
      if (status !== 200) throw new ProviderFailure('rejected', 'DOMAIN_RENEW_REJECTED');
      void body;
      const poll = await pollActions(deps, { orderId, prefix: 'DOMAIN_RENEW', existenceProof: name });
      if (poll.outcome === 'completed') return { providerReference: orderId, completed: true };
      if (poll.outcome === 'failed') throw new ProviderFailure('rejected', 'DOMAIN_RENEW_FAILED');
      return { providerReference: orderId, completed: false };
    },
  };
}

/** Readiness consumed by config availability(): real credentials, honestly set. */
export function domainResellerReady(): boolean {
  return envReady(configEnv());
}

function configEnv(): ResellerEnv {
  return {
    url: config().DOMAIN_RESELLER_URL,
    username: config().DOMAIN_RESELLER_USERNAME,
    apiKey: config().DOMAIN_RESELLER_API_KEY,
  };
}

/** Refusing methods: every call throws the definite not-configured failure. */
const refusing = async (): Promise<never> => { throw new ProviderNotConfiguredError(); };

const refusingAdapter: DomainResellerAdapter = { lookup: refusing, register: refusing, renew: refusing };

// The singleton resolves LAZILY on first use: config.ts imports this module
// (for availability()), so calling config() at module load would be a
// circular-import TDZ crash. First real call happens long after boot.
let resolved: DomainResellerAdapter | undefined;
function resolve(): DomainResellerAdapter {
  if (!resolved) {
    resolved = missing(configEnv()) ? refusingAdapter
      : createDomainReseller({ env: configEnv(), fetch: (...args) => fetch(...args),
        sleep: ms => new Promise(r => setTimeout(r, ms)) });
  }
  return resolved;
}

/** Real adapter when credentials exist; the refusing stub keeps domains honest otherwise. */
export const domainReseller: DomainResellerAdapter = {
  lookup: domain => resolve().lookup(domain),
  register: input => resolve().register(input),
  renew: input => resolve().renew(input),
};
