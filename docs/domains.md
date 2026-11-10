# In-platform domain reselling (v1 in build)

Customers buy and renew domains from DevRelay with the same GHS wallet as
messaging and hosting — one account, one wallet, one API key scheme. DevRelay
acts as a domain reseller through a reseller API. Supplier decision
(2026-11-10): **HostAfrica domain reseller program** — same provider as the
DevRelay Cloud VPS, local (Flutterwave/MoMo) top-ups, wholesale pricing,
no minimum.

## What is verified vs. what is pending

Verified from HostAfrica's public pages (2026-11):

- Reseller model: wholesale prices, pre-paid reseller wallet, **$19.44
  one-time setup fee**.
- Auth: headers `username` (reseller email) + `token` **derived per request**
  from the API key + email + the **current UTC hour** (`y-m-d H`), base64 —
  the exact formula is documented only behind the reseller login.
- Single base endpoint, path actions: lookup, register, transfer, renew,
  pricing, DNS zones, nameservers.
- **IP whitelist** on the API; Render's per-region egress IPs get whitelisted
  at go-live.
- Wholesale costs (USD/yr): .com 15.08 · .org 9.99 · .net 14.63 ·
  .africa 6.19 · .com.ng 5.00 · .co.ke 11.00.
- **No `.gh` TLDs** in the catalog; Ghanaian `.com.gh` etc. need a separate
  local registrar flow later.

Pending (blocks the real adapter, D2): the reseller area's **API Docs tab** —
Information tab (endpoint URL + token-generation code example), Calls list,
Models for contacts + nameservers. House rule: the adapter is implemented
only from that documentation or live probes, never from guesses.

## Honest lifecycle

`pending_register → active → expired → lapsed` (plus `failed`), with
`autoRenew` and lapse-risk warnings. The one behavior domains can NOT share
with hosting apps: **an app pauses safely when out of money; a domain lapses
and can be lost.** So the sweep is aggressive about honesty:

| State | Meaning |
|---|---|
| `pending_register` | paid, registration job queued/in flight |
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
3. **Ambiguous registrar answers are never guessed** — the job retries with
   the money still held; the real adapter must be idempotent (or
   lookup-then-register) so retries cannot double-register.
4. **Renewals are charged ~30 days ahead** (30-day window, one pending
   renewal order at a time, row-locked), same refund-on-rejection rules.
   Ledger kinds: `domain_purchase`, `domain_renewal`, `domain_refund`;
   references `domain:<action>:<orderId>`.
5. Prices are **PLACEHOLDERS** in `server/services/domains.ts`
   (`DOMAIN_TLDS`: customer GHS pesewas + documented supplier USD cents)
   pending the final FX + margin decision. One year = a 365-day period; the
   registrar date stays authoritative.

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
lastName, organisation?, email, phone, country (ISO alpha-2), city,
addressLine — the shape registrars demand; the real adapter maps it to the
reseller's contact Models during D2.

## Worker

- `domain.register` / `domain.renew` — paired one-to-one with a charged
  `domain_orders` row; retries re-call the adapter until a definite answer.
- `domains.sweep` (every 5 min beside the hosting sweep): expiry honesty
  (`active → expired → lapsed`), warning levels, auto-renewal charges
  (visible `DOMAIN_RENEWAL_INSUFFICIENT_CREDITS` when the wallet is short).

## Phases

| Phase | Deliverable | Status |
|---|---|---|
| D0 | Supplier decision + program facts verified (this document) | ✅ done |
| D1 | Schema, catalog, wallet-charged orders, refund rules, renewal sweep, API, honest flag — **this commit** (157 tests) | ✅ done |
| D2 | Real adapter from the pasted API Docs (hourly token derivation exactly per their code example), live-probed lookup/register/renew | blocked on user paste |
| D3 | Go-live: fund reseller wallet, whitelist Render egress IPs, flip readiness in the adapter, set final prices | after D2 |

`domainsAvailable` in the public config is **adapter-driven, not env-driven**:
the stub adapter is never ready, so setting `DOMAIN_RESELLER_*` env vars
cannot advertise domain sales before D2 exists. That gate is pinned by tests.
