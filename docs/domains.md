# In-platform domain reselling (v1 in build)

Customers buy and renew domains from DevRelay with the same GHS wallet as
messaging and hosting — one account, one wallet, one API key scheme. DevRelay
acts as a domain reseller through a reseller API. Supplier decision
(2026-11-10, revised same day): **ResellerClub** — public REST API with a free
sandbox, replacing the HostAfrica reseller program whose package was never
purchased (order left pending after payment). The HostAfrica Ghana VPS stays
for DevRelay Cloud hosting; only the domain supply changed.

## Supplier contract (vendor-documented, fetched 2026-11-10)

Everything below is from ResellerClub's own developer portal
(developer.resellerclub.com guides + the OpenAPI spec it serves) and the
vendor quickstart — nothing is guessed. Pinned in
`server/providers/domain-reseller.ts`.

**Auth — both headers on EVERY request:**

- `Authorization: ApiKey <api key>`
- `X-User-Id: <reseller user id>`

**Environments** (selected by `DOMAIN_RESELLER_URL`):

- sandbox: `https://api.sandbox.resellerclub.com/v2`
- live: `https://api.resellerclub.com/v2`

**Endpoints used:**

| Call | Contract |
|---|---|
| `GET /domains/available?domainName=<sld>&tlds=<tld>` | → `{domains:[{domainName, classkey, status, cost[], error}]}`. `status` is a free string in the spec — only `available` is trusted (`KNOWN_AVAILABLE`); anything unrecognized is AMBIGUOUS (502), never a guessed boolean. `cost[]` carries per-TLD pricing → the sandbox probe pins real costs. |
| `POST /customers` | → `{customerId}`; random username + password generated per registrant (orphan customers cost nothing) |
| `POST /contacts` | → `{contactId}`; ONE contact is reused for all four roles, as the vendor quickstart instructs |
| `POST /domains` | register. Required: `domainName, years, customerId, regContactId, adminContactId, techContactId, billingContactId, invoiceOption, autoRenew`. `ns` is NOT required — omitted, nameserver management is a later phase. Response `status`: `Success` or `PendingDomainVerification`; both mean submitted. |
| `GET /actions/search-current?orderId=<id>&size=10&page=1` | → `{actions:[{orderId, actionType, actionStatus, actionStatusDesc}]}`. Quickstart `actionStatus` values: `Added · Being Processed · Completed · Failed` (not enumerated in the spec → unknown values are treated as still processing). |
| `POST /domains/{orderId}/renew` | `{years, expDate, invoiceOption, autoRenew}` where `expDate` is the domain's current expiry as epoch SECONDS — the vendor's own idempotency guard: a stale retry is rejected at the registrar instead of double-renewing. |
| `GET /domains/by-name/{name}` | order details; **404 = the domain is not under this reseller account** (a clean answer, not an error) |

**Honest-money choices pinned in the adapter:**

- `invoiceOption: 'PayInvoice'` everywhere — the reseller wallet must be able
  to pay, or the order pends at the registrar; never a silent unpaid execution.
- Registrar-side `autoRenew: false` — DevRelay's own sweep renews from the
  CUSTOMER wallet; registrar auto-renew would bill the reseller wallet for
  money the customer never owed.
- Registration/renewal is asynchronous. Every paid call either reaches a
  terminal answer inside one attempt or returns
  `{providerReference, completed: false}`; the service persists the reference
  (`domains.provider_reference`, `domain_orders.provider_reference`) and the
  next attempt RESUMES polling that exact order — a paid operation is never
  re-submitted. Pinned by tests on both sides of the seam.
- Registration is race-guarded: if the name is already an order under this
  account (e.g. after a DB reset), it is claimed, not paid for twice.
- Renewal is double-guarded: the `expDate` field plus a defensive scan of the
  registrar's own expiry — if the registrar expiry already passed the basis,
  the renewal already landed.

**Phone & address mapping:** ResellerClub wants separate country code +
number and a zipcode. `splitPhone()` splits with an ITU dial-code map and
rejects unsplittable input definitely (`DOMAIN_PHONE_*`); the registrant
schema carries a required `postalCode`.

**No `.gh` TLDs** in the ResellerClub catalog either; Ghanaian `.com.gh`
etc. need a separate local registrar flow later.

## Go-live checklist (in order)

1. **Sandbox probe (blocks availability + renewal pinning)** — create the
   free sandbox account (resellerclub.com/sandbox-signup), paste
   `X-User-Id` + API key, then live-probe `/domains/available` with an
   available and a taken name to pin the exact `status` vocabulary into
   `KNOWN_AVAILABLE` / `KNOWN_TAKEN`, and verify the `expDate` epoch format
   on a sandbox renewal.
2. **Funding question (blocks live sales)** — ask ResellerClub 24/7 chat
   whether the reseller wallet can be funded with Flutterwave/Ghana MoMo.
   If card/PayPal only, the supplier decision must be revisited before a
   single domain is sold.
3. **Production credentials** — signup, fund the wallet, set Render env:
   `DOMAIN_RESELLER_URL=https://api.resellerclub.com/v2`,
   `DOMAIN_RESELLER_USERNAME`, `DOMAIN_RESELLER_API_KEY`.

## Honest lifecycle

`pending_register → active → expired → lapsed` (plus `failed`), with
`autoRenew` and lapse-risk warnings. The one behavior domains can NOT share
with hosting apps: **an app pauses safely when out of money; a domain lapses
and can be lost.** So the sweep is aggressive about honesty:

| State | Meaning |
|---|---|
| `pending_register` | paid, registration job queued/in flight at the registrar |
| `active` | registered; `expiresAt` is the authoritative expiry |
| `expired` | past expiry, inside the registrar grace window — still recoverable |
| `lapsed` | grace window passed; domain lost (recorded, never hidden) |
| `failed` | registration definitively rejected; customer refunded in full |

Warning levels are stamped on the row at **30 / 14 / 7 / 1 days** before
expiry (`lastWarningLevel` 1–4) so the dashboard can surface lapse risk.

## Money flow (mirrors hosting)

1. **Charge first, create second** — `POST /api/domains` charges the wallet
   and creates the domain + order + `domain.register` job in ONE transaction;
   an unfunded account gets `402 INSUFFICIENT_CREDITS` and **zero rows** (no
   unfunded domains exist).
2. **Definite registrar rejection → full refund** — ledger
   `platform_revenue → customer_available` (kind `domain_refund`, reference
   `domain:refund:<orderId>`), order marked `refunded`, domain `failed`.
3. **Ambiguous answers and in-flight operations are never guessed** — the job
   retries with the money still held; while the registrar is still processing,
   the provider order id is persisted and the retry resumes polling instead of
   re-posting (test-pinned end to end).
4. **Renewals are charged ~30 days ahead** (30-day window, one pending
   renewal order at a time, row-locked), same refund-on-rejection rules.
   Ledger kinds: `domain_purchase`, `domain_renewal`, `domain_refund`;
   references `domain:<action>:<orderId>`.
5. Prices are **PLACEHOLDERS** in `server/services/domains.ts`
   (`DOMAIN_TLDS`: customer GHS pesewas; the old `supplierUsdCents` figures
   are stale HostAfrica reference numbers, NOT a cost basis) pending the
   sandbox probe's real ResellerClub costs and the FX + margin decision.
   One year = a 365-day period; the registrar date stays authoritative.

## API (developer API, scopes `domains:read` / `domains:write`)

| Method & path | Notes |
|---|---|
| `GET /api/domains/pricing` | catalog + period/grace facts |
| `POST /api/domains/lookup` | `{domain}` → availability + price (registrar lookup) |
| `POST /api/domains` | buy: `{domain, registrant, autoRenew}` → 202, charged in advance |
| `GET /api/domains` · `GET /api/domains/:id` | list / detail with order history |
| `PATCH /api/domains/:id` | `{autoRenew}` toggle |
| `POST /api/domains/:id/renew` | manual renewal (same charge-first flow) |

Registrant (required at purchase, stored on the domain row): firstName,
lastName, organisation?, email, phone (international format), country
(ISO alpha-2), city, **postalCode** (registrar-required), addressLine —
validated by `domainRegistrantSchema` and mapped to ResellerClub's
customer/contact fields by the adapter.

## Worker

- `domain.register` / `domain.renew` — paired one-to-one with a charged
  `domain_orders` row; retries either complete the operation (resuming from
  the persisted provider reference) or refund after a DEFINITE rejection.
- `domains.sweep` (every 5 min beside the hosting sweep): expiry honesty
  (`active → expired → lapsed`), warning levels, auto-renewal charges
  (visible `DOMAIN_RENEWAL_INSUFFICIENT_CREDITS` when the wallet is short).

## Phases

| Phase | Deliverable | Status |
|---|---|---|
| D0 | Supplier decision + program facts verified (this document) | ✅ done (ResellerClub) |
| D1 | Schema, catalog, wallet-charged orders, refund rules, renewal sweep, API, honest flag | ✅ done |
| D2 | Real ResellerClub adapter from the vendor-documented contract: resume-after-payment protocol, PayInvoice/autoRenew pinning, phone split, expDate guard | ✅ built (179 tests); vendor behavior still to be confirmed live |
| D3 | Go-live: sandbox probe pins availability vocabulary + expDate format; funding-method answer; fund wallet; set Render env; final prices | blocked on user (checklist above) |

`domainsAvailable` in the public config is **adapter-driven, not env-driven**:
the adapter refuses when credentials are missing, so setting
`DOMAIN_RESELLER_*` env vars cannot advertise domain sales before the real
integration is live. That gate is pinned by tests.
