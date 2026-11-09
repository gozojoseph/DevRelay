# Progress checklist

- [x] Repository audit (empty) and architecture; official provider documentation reviewed.
- [x] Database schema, versioned migration and environment validation (`drizzle/` migrations; `npm run db:check` green).
- [x] Responsive frontend and accessible light/dark themes (Vite + React + Tailwind, route-level code splitting).
- [x] Authentication, approval, projects and API keys (cookie sessions, CSRF, email verification, TOTP MFA for admins).
- [x] Balanced ledger, Paystack, pricing, queue and SMS (integer-pesewas double-entry ledger, reservation → settle/release, Paystack signature-verified webhooks).
- [x] Callbacks, signed webhooks, WhatsApp onboarding and messages (Meta signature verification + Embedded Signup flow, AT secret-path callbacks, signed customer webhooks with SSRF-pinned delivery).
- [x] Admin, abuse controls, documentation, tests and deployment preparation:
  - [x] Admin console: accounts, senders, pricing, messages, reconciliation, WhatsApp, support, audit, settings.
  - [x] Documentation: `README.md`, `web/public/openapi.yaml`, `docs/providers.md`, `docs/deployment.md`, `docs/backup.md`, `docs/launch-checklist.md`.
  - [x] Tests: 76 Vitest tests (unit + PGlite integration) — `npm test` green in ~20 s.
  - [x] All quality gates green: `typecheck`, `lint`, `build`, `db:check`, `test`.

Current quality gates (verified 2026-11-08):

| Gate | Script | Status |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | ✅ |
| Lint | `npm run lint` | ✅ |
| Build (API + web) | `npm run build` | ✅ (~260 kB main chunk + per-route chunks) |
| Migration check | `npm run db:check` | ✅ |
| Tests | `npm test` (7 files / 76 tests) | ✅ |

Test coverage highlights (`tests/`):

- `security.test.ts` — AES-256-GCM context binding, password hashing/salts, TOTP ±1 step window, CSRF token determinism.
- `pricing.test.ts` / `pricing-db.test.ts` — phone normalization (Ghana-only SMS), segment counting bands (GSM-7/UCS-2), quoting, current-price lookup windows.
- `webhooks-signature.test.ts` — customer webhook `sha256=HMAC(timestamp.body)` format, constant-time compare, HTTPS-only + SSRF blocked-range validation.
- `ledger.test.ts` — balanced double-entry entries, insufficient-credit rollback, reservation settle/release (with daily-usage refund), daily spend/volume limits, whole-ledger account↔entry consistency.
- `messaging.test.ts` — full `sendSms`/`sendWhatsapp` transactions: idempotency claim-before-credits, 409 key conflict, consent/suppression precedence, sender + account activation guards, pricing/limit/insufficient failures rolling back cleanly, 24h service window, connection/state guards.
- `status.test.ts` — provider status machine: SMS delivered settles / SMS failure stays reserved + audit; WhatsApp free vs regular pricing settle/release, missing pricing flags `PRICING_EVENT_MISSING`, terminal states never regress, duplicate fingerprints are no-ops, admin `resolveReservation` charge/release with audit trail.

Not yet done / intentionally blocked (see `docs/launch-checklist.md`):

- [ ] CI pipeline running the five gates on push.
- [ ] Live provider verification: no real Paystack charge, Africa's Talking send, or Meta message has ever been executed — requires live credentials and the external approvals listed in the checklist (Paystack business verification, AT live access + sender approval, Meta Tech Provider verification + app review, Ghana DPC registration).
- [ ] Production deployment (Neon + TLS host + worker) once credentials exist.

No live provider sends or real charges are authorized by this checklist.
