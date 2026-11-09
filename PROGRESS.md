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

Current quality gates (verified 2026-11-09):

| Gate | Script | Status |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | ✅ |
| Lint | `npm run lint` | ✅ |
| Build (API + web) | `npm run build` | ✅ (~260 kB main chunk + per-route chunks) |
| Migration check | `npm run db:check` | ✅ |
| Tests | `npm test` (7 files / 76 tests) | ✅ |
| Dependency audit | `npm audit --audit-level=high` | ✅ 0 findings |

Test coverage highlights (`tests/`):

- `security.test.ts` — AES-256-GCM context binding, password hashing/salts, TOTP ±1 step window, CSRF token determinism.
- `pricing.test.ts` / `pricing-db.test.ts` — phone normalization (Ghana-only SMS), segment counting bands (GSM-7/UCS-2), quoting, current-price lookup windows.
- `webhooks-signature.test.ts` — customer webhook `sha256=HMAC(timestamp.body)` format, constant-time compare, HTTPS-only + SSRF blocked-range validation.
- `ledger.test.ts` — balanced double-entry entries, insufficient-credit rollback, reservation settle/release (with daily-usage refund), daily spend/volume limits, whole-ledger account↔entry consistency.
- `messaging.test.ts` — full `sendSms`/`sendWhatsapp` transactions: idempotency claim-before-credits, 409 key conflict, consent/suppression precedence, sender + account activation guards, pricing/limit/insufficient failures rolling back cleanly, 24h service window, connection/state guards.
- `status.test.ts` — provider status machine: SMS delivered settles / SMS failure stays reserved + audit; WhatsApp free vs regular pricing settle/release, missing pricing flags `PRICING_EVENT_MISSING`, terminal states never regress, duplicate fingerprints are no-ops, admin `resolveReservation` charge/release with audit trail.

## Phase 3 — CI & security hardening (2026-11-09)

| Item | State |
| --- | --- |
| Dependency security | ✅ `npm audit` **zero findings** (full tree + production-only): `nodemailer` 7.0.6→10.4.0 (2 high), `drizzle-orm` 0.44.6→0.45.4 (high, identifier-escaping), `vitest` 3.2.4→5.1.0 (2 critical in tinypool/@vitest/mocker); targeted `overrides` bumped `esbuild` (inside drizzle-kit's `@esbuild-kit` chain) and `minimatch` (under `typescript-estree`) past remaining moderates; unused `supertest`/`@types/supertest` removed. |
| CI pipeline | ✅ `.github/workflows/ci.yml` — gate order: typecheck → lint → build → db:check → tests+coverage artifact → npm-audit (prod & full, high+) → gitleaks; Node 22 + 24 matrix; concurrency-throttled. First green run pending first push to GitHub. |
| Dependabot | ✅ `.github/dependabot.yml` — weekly npm + GitHub Actions; minor/patch grouped, majors reviewed individually. |
| Coverage | ✅ `npm run test:coverage` (report-only, no thresholds yet) — service layer `ledger`/`messaging`/`pricing` 92–100%, HTTP/route + provider adapters 0% (no HTTP-level tests yet). |
| Git | ✅ repo initialized with baseline commit `c89f099`; GitHub remote still to be added (manual step — no `gh` CLI on this machine). |
| Deferred | Error monitoring (needs vendor DSN — Phase 5), Playwright E2E (Phase 2, needs full stack), load tests (staging-only). |

Upgrades were verified gate-by-gate (typecheck, lint, build, db:check, 76 tests after each major); `db:generate` re-ran to prove drizzle-kit still works under the esbuild override ("No schema changes").

## Production deployment artifacts (2026-11-09)

| Artifact | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build → slim runtime (prod deps only, `USER node`, `HEALTHCHECK /healthz`); four entrypoints: API, worker, migrate, admin bootstrap |
| `fly.toml` / `fly.worker.toml` | Two Fly apps (API + worker); `release_command` applies migrations before API machines boot |
| `render.yaml` | Render blueprint (`envVarGroups`, API `preDeployCommand` migrates, worker as `type: worker`) |
| `.dockerignore` | Excludes `.env`/secrets, docs, tests, node_modules from the build context |
| `docs/production-runbook.md` | Complete go-live guide: production boot gates, env vars, provider connections, deploy procedures per platform, go-live verification, operations/rollback |
| `npm run start:migrate` | Compiled migration entrypoint (`node dist/server/db/migrate.js`) — runs with prod deps only |

Honest status: the compiled runtime paths work (typecheck + build green; servers boot from `dist/server`), but the **image has never been built** — no Docker on this machine. First `docker build` happens on the deploy host or CI; if anything surfaces there, treat it as a bug to fix before launch.

Not yet done / intentionally blocked (see `docs/launch-checklist.md`):

- [ ] First green CI run on GitHub (repo remote to be added manually).
- [ ] Live provider verification: no real Paystack charge, Africa's Talking send, or Meta message has ever been executed — requires live credentials and the external approvals listed in the checklist (Paystack business verification, AT live access + sender approval, Meta Tech Provider verification + app review, Ghana DPC registration).
- [ ] Production deployment (Neon + TLS host + worker) once credentials exist.

No live provider sends or real charges are authorized by this checklist.
