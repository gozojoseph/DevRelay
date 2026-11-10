# In-platform domain reselling (v1 in build)

Customers buy and renew domains from DevRelay with the same GHS wallet as
messaging and hosting — one account, one wallet, one API key scheme. DevRelay
acts as a domain reseller through a reseller API. Supplier decision
(2026-11-10, revised same day): **ResellerClub** — public REST API with a free
sandbox, replacing the HostAfrica reseller program whose package was never
purchased (order left pending after payment). The HostAfrica Ghana VPS stays
for DevRelay Cloud hosting; only the domain supply changed.

## Supplier contract (live-verified + vendor-documented, 2026-11-10)

Everything below is from ResellerClub's own developer portal
(developer.resellerclub.com guides + the OpenAPI spec it serves) AND a
**live sandbox probe with the real API** (2026-11-10, marked LIVE-VERIFIED
below — the probe corrected the spec twice). Pinned in
`server/providers/domain-reseller.ts`.

**Auth — both headers on EVERY request (LIVE-VERIFIED):**

- `Authorization: ApiKey <api key>`
- `X-User-Id: <reseller user id>`

Wrong credentials answer 401; a real key on a transient-failing backend can
answer 503 "API service transport failure" (observed, resolved on retry —
the adapter maps it to ambiguous/retry, which is exactly right).

**Environments** (selected by `DOMAIN_RESELLER_URL`):

- sandbox: `https://api.sandbox.resellerclub.com/v2`
- live: `https://api.resellerclub.com/v2`

**Endpoints used:**

| Call | Contract |
|---|---|
| `GET /domains/available?domainName=<sld>&tlds=<tld>` | → `{domains:[{domainName, classkey?, status, cost[], error?}]}`. **LIVE-VERIFIED vocabulary**: free `.com` → `status:"available"`; taken → `status:"regthroughothers"` (`classkey:"domcno"`); **`"unknown"` is a REAL value meaning "not evaluated"** (sandbox ccTLD lookups) — the adapter answers ambiguous 502 for it, never a guessed boolean. Sandbox `cost[]` comes back EMPTY; real wholesale prices only appear on the live account (Gate 4). |
| `POST /customers` | → `{customerId}`. **LIVE-VERIFIED required fields beyond the spec**: `email`, `state` ("state: must not be blank"), `languagePreference` ("must not be blank"), and the **username must be email-shaped** ("username: Emailaddr is invalid") — the adapter derives `<local>.rc<hex>@<their domain>`, unique per attempt. Also sent: name, company, addressLine1, city, country, zipcode, phoneCountryCode, phone. |
| `POST /contacts` | → `{contactId}` (LIVE-VERIFIED key name). ONE contact is reused for all four roles, as the vendor quickstart instructs. Same field shape as customers (incl. `state`). |
| `POST /domains` | register. **LIVE-VERIFIED: `ns` is REQUIRED as a JSON array** — the spec's required list omits it, the 400 error text says "nameservers", but the parser only accepts `ns` (a string fails with a Jackson ArrayList type error). The adapter sends the registrar default parking pair `ns1/ns2.resellerclub.com`; nameserver management is a later phase. Rest of the required set: `domainName, years, customerId, regContactId, adminContactId, techContactId, billingContactId, invoiceOption, autoRenew`. **LIVE-VERIFIED response**: `{status:"Success", orderId, entityId, invoiceId, actionTypeDesc, actionStatusDesc, sellingAmount, sellingCurrencySymbol}` — a `Success` means the order + invoice EXIST (money committed), not that the domain is active yet. |
| `GET /actions/search-current?orderId=<id>&size=10&page=1` | → `{totalItems, itemsOnPage, actions:[{orderId, actionType, actionStatus, actionStatusDesc, actionAdded, actionStarted, actionCompleted}]}`. **LIVE-VERIFIED `actionStatus`: `PendingExecution`** (sandbox queue; order stays `InActive` until it runs). Quickstart also names `Added · Being Processed · Completed · Failed`. The spec enumerates none — anything unknown keeps polling. |
| `POST /domains/{orderId}/renew` | `{years, expDate, invoiceOption, autoRenew}` where `expDate` is the domain's current expiry as epoch SECONDS — the vendor's own idempotency guard: a stale retry is rejected at the registrar instead of double-renewing. (Live execution pending: the probe order was still in the sandbox queue; shape cross-checked against the spec. Re-probe when the order goes Active.) |
| `GET /domains/by-name/{name}?options=All` | **LIVE-VERIFIED: `options=All` is REQUIRED (400 without it)**; response nests under a `domain` key; **404 "Website doesn't exist for <name>"** when the domain is not under this reseller account (a clean "not ours", not an error). `GET /domains/{orderId}?options=All` behaves the same way. While a registration action is still queued, the order answers with `currentStatus:"InActive"` and **no expiry field** — so expiry scanning honestly finds nothing until the registrar actually activates it. |

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
number, a zipcode AND a state (all three live-verified as hard-required).
`splitPhone()` splits with an ITU dial-code map and rejects unsplittable
input definitely (`DOMAIN_PHONE_*`); the registrant schema carries required
`state` and `postalCode`.

**Sandbox probe record (2026-11-10):** availability vocabulary pinned
(`available` / `regthroughothers` / `unknown`); customer + contact creation
proven (real `customerId` 35148032, `contactId` 136381340); registration
proven to the point of a real sandbox order (`orderId` 127600485,
`status:"Success"`, invoice created) with the action left `PendingExecution`
in the sandbox queue. **Remaining live checks:** the renew `expDate` round
(re-runnable once the probe order goes Active — `GET
/actions/search-current?orderId=127600485`) and real `cost[]` pricing on the
live account.

**No `.gh` TLDs** in the ResellerClub catalog either; Ghanaian `.com.gh`
etc. need a separate local registrar flow later.

## Go-live checklist (in order)

> Boot guard: a **sandbox URL is refused at production boot** (test-pinned in
> `tests/config.test.ts`, same pattern as the AT/Mailtrap gates) — a sandbox
> "registers" nothing real, so it must never serve live customers. Sandbox
> credentials live in local `.env` only.

1. **Sandbox probe — availability pinning: DONE** (2026-11-10). Vocabulary
   `available` / `regthroughothers` / `unknown` pinned in the adapter with
   fixture tests. Remaining from the probe: re-run the renew `expDate`
   round-trip once sandbox order 127600485 leaves the queue.
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
(ISO alpha-2), city, **state** and **postalCode** (both registrar-required,
live-verified), addressLine — validated by `domainRegistrantSchema` and
mapped to ResellerClub's customer/contact fields by the adapter.

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
