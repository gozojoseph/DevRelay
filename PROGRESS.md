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
| Tests | `npm test` (16 files / 179 tests, 2026-11-10) | ✅ |
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
| CI pipeline | ✅ `.github/workflows/ci.yml` — gate order: typecheck → lint → build → db:check → tests+coverage artifact → npm-audit (prod & full, high+) → gitleaks; Node 22 + 24 matrix; concurrency-throttled. **First green run done** (2026-11-09, repo public at github.com/gozojoseph/DevRelay); gitleaks baseline: 5 placeholder findings pinned in `.gitleaksignore`, `GITHUB_TOKEN` wired for PR scans. |
| Dependabot | ✅ `.github/dependabot.yml` — weekly npm + GitHub Actions; minor/patch grouped, majors reviewed individually. **First wave handled (2026-11-09):** merged actions bumps #1–#4 (upload-artifact 4→7, checkout 4→7, gitleaks-action 2→3, setup-node 4→7) + pglite minor group #5 (0.3.16→0.5.15) — all CI-green, squash-merged. Held open: #7 eslint 9→10 (green, awaiting review), #8 @types/node 24→26 (green, awaiting review), #6 plugin-react 5→6 + #9 vite 7→8 (red; real breakage at install/build). |
| Coverage | ✅ `npm run test:coverage` (report-only, no thresholds yet) — service layer `ledger`/`messaging`/`pricing` 92–100%, HTTP/route + provider adapters 0% (no HTTP-level tests yet). |
| Git | ✅ repo live at `github.com/gozojoseph/DevRelay` (public), `main` branch, CI green; history includes baseline `c89f099` → Neon integration `76f88f9` → CI fixes + Dependabot merges. |
| Deferred | Error monitoring (needs vendor DSN — Phase 5), Playwright E2E (Phase 2, needs full stack), load tests (staging-only). |

Upgrades were verified gate-by-gate (typecheck, lint, build, db:check, 76 tests after each major); `db:generate` re-ran to prove drizzle-kit still works under the esbuild override ("No schema changes").

## Production deployment artifacts (2026-11-09)

| Artifact | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage build → slim runtime (prod deps only, `USER node`, `HEALTHCHECK /healthz`); four entrypoints: API, worker, migrate, admin bootstrap |
| `fly.toml` / `fly.worker.toml` | Two Fly apps (API + worker); `release_command` applies migrations before API machines boot |
| `render.yaml` | Render blueprint (`envVarGroups` shared secrets, API web service `preDeployCommand` migrates). Updated 2026-11-10 for the Neon-backed deploy: added `APP_ORIGIN`/`PUBLIC_API_URL` (production boot gate), web plan `free`, worker intentionally commented out (free compute has no background workers; enable with `plan: starter` when providers go live). Runbook §2.4 has the full click-path. |
| `.dockerignore` | Excludes `.env`/secrets, docs, tests, node_modules from the build context |
| `docs/production-runbook.md` | Complete go-live guide: production boot gates, env vars, provider connections, deploy procedures per platform, go-live verification, operations/rollback |
| `npm run start:migrate` | Compiled migration entrypoint (`node dist/server/db/migrate.js`) — runs with prod deps only |

Honest status: the compiled runtime paths work (typecheck + build green; servers boot from `dist/server`), but the **image has never been built** — no Docker on this machine. First `docker build` happens on the deploy host or CI; if anything surfaces there, treat it as a bug to fix before launch.

Not yet done / intentionally blocked (see `docs/launch-checklist.md`):

- [x] First green CI run on GitHub — done 2026-11-09 (repo public; run #28 after Dependabot merges).
- [ ] Live provider verification: no real Paystack charge, Africa's Talking send, or Meta message has ever been executed — requires live credentials and the external approvals listed in the checklist (Paystack business verification, AT live access + sender approval, Meta Tech Provider verification + app review, Ghana DPC registration).

No live provider sends or real charges are authorized by this checklist.

## Neon platform integration (2026-11-09)

Project **DevRelay** (`blue-bird-71632066`, org `org-icy-fog-43699121`), branch **production** (`br-lingering-cell-bdevndeh`, region `aws-us-east-2` — supports all services), managed by `neon.ts` infra-as-code (auth, aiGateway, `functions.hello`, preview realtime; non-default branches expire after 7d).

| Service | Status | Proof |
| --- | --- | --- |
| Postgres | ✅ live, schema applied | `npm run db:migrate` → 34 public tables on `neondb` (Postgres 18.6); login + `/api/auth/me` round-trip against Neon proven |
| Functions | ✅ live | `GET https://br-lingering-cell-bdevndeh-hello.compute.c-8.us-east-2.aws.neon.tech/` → 200 `Hello from Neon Functions` |
| Realtime | ✅ live | `neon realtime subscribe "SELECT email, role FROM users LIMIT 5"` → WebSocket connect, initial snapshot `1 row: admin` — real data |
| AI Gateway | ⛔ **billing gate** | Catalog `63 models, 0 enabled`; `POST /v1/chat/completions` → 403 `credits_required` with recovery URL (no credits purchased yet) |
| Neon Auth | ✅ provisioned, **not integrated by decision** | JWKS serves (`200`, 1 key). DevRelay keeps its own tested auth (cookie sessions + TOTP); swapping identity providers was never requested |

App wiring: `server/config.ts` gained ten optional `NEON_*`/`DATABASE_URL_UNPOOLED` fields plus `neonAvailability()` and `neonFunctionUrl()`; `GET /api/public/status` now reports them as booleans (`neon: { postgres, neonAuth, functions, aiGateway, realtime }` — all true when env is present, secrets never leave the server). `tests/config.test.ts` covers both configured and unconfigured cases. Driver decision: **pooled** `DATABASE_URL` + `pg`/node-postgres — correct for this long-running Express host (`@neondatabase/serverless` is for serverless runtimes only).

Production bring-up performed:

```text
npm run db:migrate          # applied all migrations to the Neon production branch
node dist/server/scripts/bootstrap-admin.js   # ADMIN_EMAIL from env → role=admin row created (verified: admin + audit event)
# API + worker booted from dist/ against Neon; /healthz 200; worker connected;
# login → 200, /api/auth/me → 200 (admin). Admin APIs correctly return MFA_REQUIRED
# until TOTP is enrolled from the dashboard — by design; no MFA enrollment was forged.
```

Remaining after this phase: buy AI Gateway credits (`https://console.neon.tech/app/org-icy-fog-43699121/billing#ai_gateway_credits`) to unlock the 63-model catalog; enroll TOTP by first login; review the four held Dependabot majors (#6/#9 currently red, #7/#8 green-awaiting-review).

## Live on Render + honest email rail (2026-11-10)

| Item | State |
| --- | --- |
| Render deploy | ✅ live at `https://devrelay-0edn.onrender.com` — free web plan, single origin (API serves the SPA), Docker build clean; `/healthz` 200 runs a real Neon `SELECT 1`; SPA deep links + API JSON-404 contract verified; pooled `DATABASE_URL` proven |
| First-deploy incident | ✅ documented (runbook §2.4 incident note): empty Blueprint "unresolved properties" form → empty env group → boot zod crash; fix = set values on the **service** Environment tab |
| Admin login / MFA | ✅ idempotent TOTP setup fix (`d290f0c`) proven live — admin MFA enrolled (`mfa_pending` cleared); password-only unattended login honestly 401s (factor correctly refused); temp password rotation still pending |
| Provider channels | ✅ honestly `false` — no Paystack/AT/Meta credentials exist; SMS/WhatsApp/funding report unavailable until real rails are verified (§6); worker deploys only at go-live (`plan: starter`) |
| SMTP rail retired | ❌→superseded: Gmail answered real `535-5.7.8 Username and Password not accepted` — the chat-shared "app password" string is **not** a valid app password (proved independently of the app via `smtp.gmail.com` verify); Explains register/reset 500s (mail step fails after account commit) |
| Mailtrap rail | ✅ implemented: `mailtrap` SDK 6.2.0; `server/lib/mail.ts` extracted from `routes/auth.ts` (console + SMTP branches byte-identical, shared 503 `EMAIL_UNAVAILABLE`); `EMAIL_MODE=mailtrap` uses the official client (`category: 'DevRelay transactional'`); production boot gate now demands **one real rail** (SMTP *or* Mailtrap) and refuses Mailtrap sandbox in production (mirrors AT gate) |
| Gate coverage | ✅ 85/85 tests (+6 config-gate tests: SMTP/Mailtrap acceptance, missing-rail refusal ×4, sandbox-refusal, sandbox-outside-prod, AT-gate regression guard); typecheck/lint/build/db:check green; `npm audit` 0 findings incl. new `axios`/`qs` deps |
| Deploy artifacts | ✅ `render.yaml` env group extended (`EMAIL_MODE`, `MAILTRAP_*`, sandbox pair); `.env.example`/.env updated; `.env.render` regenerated for the real subdomain with `EMAIL_MODE=mailtrap` + 2 clearly-marked placeholders; runbook §0/§2.4/§3/§4.4 rewritten for both rails |
| Next user actions | ✅ **email rail proven live (2026-11-10):** real Gmail app password set directly on Render (never touched chat) → `resend-verification` answered 200 → fresh token issued → "Verify your DevRelay email" delivered to the test inbox → link clicked → account honestly auto-advanced `pending_verification` → `pending_approval` with an `email.verified` audit row. Admin approval is the only remaining step for that developer. Mailtrap cutover stays available later (token + verified domain, 2 env-var edits, no code changes). Remaining secrets work: rotate the admin temp password; rotate the Neon DB password |
| Rail choice | `EMAIL_MODE=smtp` via Gmail app password is the current production rail; low transactional volume makes it an honest starting choice. The Mailtrap Email API rail remains fully wired for when a custom sending domain exists |
| Production gate live-fire | ✅ proven in the field (2026-11-10 ~03:32 UTC): an attempt to deploy with AT **sandbox** credentials onto the production Render service was refused at boot (`AT sandbox credentials cannot send from production` — the `readConfig` gate), the service recovered after rollback (`/healthz` 200, channels honestly false). Lesson recorded: sandbox/provider test keys live **only** in the local dev `.env`; production waits for AT live access + the starter-plan worker |
| AIGH second SMS rail + API reference | ✅ AIGH (aigh.dev) adopted as an **alternative provider** behind `SMS_PROVIDER=aigh` + `AIGH_API_KEY` (`server/providers/aigh.ts`; success only on the documented `{success:true,data}` envelope, provisional `/sms/send` contract until the vendor publishes its full reference; delivery callbacks blocked without their webhook spec — AIGH sends honestly stop at `sent`). Direction 2 of the doc review: DevRelay's `dr_live_`/`dr_test_` key design with production refusal already beat AIGH's channel prefixes, so the deliverable became `docs/api-reference.md` — the customer-facing v1 one-pager (auth, envelope, rate limits, idempotency, endpoints, statuses, error codes) |
| First sends + sandbox sender lesson | ✅ the first two rehearsal sends were refused by the AT sandbox (`InvalidSenderId` — custom sender IDs are **live-only**); the adapter originally parked them in `pending_reconciliation` with 150p reserved each. Fix shipped in `africastalking.ts`: sandbox omits `from`, and an empty-`Recipients` 201 answer is now a definite rejection (`SMS_PROVIDER_INVALID_SENDER_ID` / `SMS_PROVIDER_REJECTED`) whose reservation is released via admin reconciliation. Live-proven: a sandbox call without `from` returned `statusCode 101` + a real messageId |
| SMS rehearsal proven end-to-end | ✅ (2026-11-10): sends to sandbox-registered numbers are **accepted by AT with real `ATXid_` provider ids** and arrive on the AT sandbox emulator/device. The two parked messages were admin-released (`ADMIN_RELEASED`, credits returned). Dashboard status honestly rests at `accepted` locally — `sent`/`delivered` require AT's delivery callback, which cannot reach `localhost`; a tunnel + callback registration is the optional path to full status progression. Note: sandbox shows AT's default sender, not the approved sender ID (custom sender IDs are live-only) |
| SIM-gateway third SMS rail | ✅ (2026-11-10): third SMS rail behind `SMS_PROVIDER=sim-gateway` — a spare Android phone running the open-source android-sms-gateway app (`server/providers/sim-gateway.ts`). Documented contract: POST `{textMessage,phoneNumbers,withDeliveryReport:true}` + Basic auth to the app's Local Server; **no sender field is ever sent** (the device SIM number is the sender); 2xx without an id → `SMS_RESPONSE_UNCERTAIN`, 429 → retryable, 5xx/timeout → ambiguous, other non-OK → rejected. Delivery callbacks wired at `POST /api/webhooks/sms-gateway` (HMAC `X-Signature` = HMAC-SHA256(rawBody + `X-Timestamp`), ±5-min window; only `sms:sent/delivered/failed/cancelled` forwarded, inbound `sms:received` ignored). Position: dev rail / micro-volume, **not** the primary production rail (docs/providers.md §SIM gateway) |
| Arkesel fourth SMS rail chosen | ✅ (2026-11-10): user selected Arkesel (arkesel.com) as the SMS supplier on verified vendor pricing (~GHS 0.022–0.031/SMS wholesale vs the 5p customer price — instant margin). `server/providers/arkesel.ts` implements the send contract: `POST {ARKESEL_BASE_URL}/sms/send` with the `api-key` header and `{sender,message,recipients}`. **Live-probed the same day** (real key, sender `Affordable` accepted, 1 credit consumed): the real API answers `{status:'success', data:[{id,recipient}], main_balance, sms_balance}` — an array of per-recipient results, unlike the object in the vendor's own samples; the adapter accepts both shapes and matches the echoed recipient. Honest mapping (success-without-id → ambiguous, failure envelope/non-OK → rejected, 429 retryable, 5xx/timeout ambiguous); balances never become ledger money. Delivery webhooks deferred until the vendor publishes a machine-readable callback spec (developers.arkesel.com is a JS portal) — sends honestly rest at `accepted` |
| Arkesel product-path send proven | ✅ (2026-11-10): first real send through DevRelay's own product path (Send page → queued → worker → Arkesel API): message `0f16188b` to +233247646650 accepted with provider id `0a248025-…` (UUID format matching Arkesel's live ids), 5p quoted and reservation held, confirmed on the vendor's own dashboard. Arkesel holds such messages **PENDING APPROVAL** until the sender ID (`Affordable`) is registered/approved on their platform (Ghana NCA regulation) — nothing reaches handsets until then; DevRelay correctly rests at `accepted` with the reservation held, no simulated delivery. User action: register the sender ID, fund credits (9 left) |
| DevRelay Cloud (PaaS) greenlit + H1 built | ✅ (2026-11-10): user chose full app hosting as the next product (build now, Git-based Node/Dockerfile deploys, monthly GHS plans — pricing TBD). H1 shipped: `hosted_apps` + `app_deployments` schema (migration `0001_hosting_apps`), plan catalog with PLACEHOLDER prices (starter 256MB GHS 50 / standard 512MB GHS 90 — user to set finals), `POST /api/apps` charging month 1 in advance (402 + nothing created when unfunded), deploy/stop/start/delete jobs, honest lifecycle (`building/live/paused_no_funds/paused_manual/failed/deleted` — failed redeploys never stop a live container), idempotent renewal sweep (ledger reference per app per period; pause on empty wallet, auto-resume on success). Host agent is the adapter seam (`server/providers/host-agent.ts`, HTTP contract documented in docs/hosting.md) so the H0 substrate decision (Coolify/Dokploy vs custom agent on a HostAfrica Ghana C4 VPS) replaces only that module. 21 new tests, 136 total. VPS + free .cloud domain purchase pending user; Arkesel `DevRelay` sender registration paused with SMS work |
| Domain reselling D1 built (seam-first) | ✅ (2026-11-10): user directive "build domain" — customers buy/renew domains from DevRelay via a reseller API (HostAfrica reseller program verified as supplier: $19.44 setup, pre-paid wallet, wholesale USD pricing, NO .gh TLDs). D1 shipped: `domains` + `domain_orders` schema (migration `0002_domains`), TLD catalog with PLACEHOLDER GHS prices + documented supplier costs (`server/services/domains.ts`), wallet charged BEFORE any registrar action (402 + zero rows when unfunded), register/renew jobs with full refund on definite rejection and honest retry on ambiguity, renewal sweep with lapse-risk warnings at 30/14/7/1 days and truthful expiry states (`active → expired → lapsed` — domains can be LOST, unlike pausable apps), re-buy of failed/lapsed domains resets the same row (one row per name, ever), API routes under new `domains:read`/`domains:write` scopes, `domainsAvailable` is ADAPTER-driven not env-driven (stub adapter is never ready — pinned by tests). `providers/domain-reseller.ts` is the seam stub; D2 needs the user to buy the reseller package and paste the API Docs tab (endpoint + hourly token formula + Calls/Models). 21 new tests, 157 total. docs/domains.md written |
| Dashboard UI: Hosting + Domains pages shipped | ✅ (2026-11-10): user report "hosting UI not available" — H1/D1 were backend-only. Added session-based dashboard routes in `server/routes/dashboard.ts` (GET /app/hosting, /app/domains with plans/pricing/availability; CSRF-gated create/deploy/stop/start/delete/logs for apps; lookup/buy/detail/autoRenew/renew for domains, all ownership-checked + audit-logged) and two dashboard pages: `web/src/pages/app/HostingPage.tsx` (plan cards, app list with honest status badges incl. paused_no_funds, create modal charging month 1 in advance, deploy/stop/start, logs modal, delete confirm) and `web/src/pages/app/DomainsPage.tsx` (availability lookup, pricing table, buy modal with registrant + autoRenew, renewal warnings at 30/14/7/1 days, domain detail with order history). Nav group "DevRelay Cloud"; statusTone extended (live/building/paused_*/expired/lapsed/pending_register); routes in App.tsx. Unavailable features show an honest "not switched on yet" callout instead of hidden pages. 157 tests, typecheck + lint clean |
| Domain reseller D2: real ResellerClub adapter | ✅ (2026-11-10): supplier switched from the never-purchased HostAfrica reseller package to **ResellerClub** (public REST API + free sandbox; HostAfrica's API docs sit behind the reseller login). Adapter rebuilt from the vendor-documented contract only (developer.resellerclub.com guides + its OpenAPI spec): `Authorization: ApiKey <key>` + `X-User-Id` headers on every request, sandbox/live base URLs via `DOMAIN_RESELLER_URL`; `GET /domains/available` trusts only `status: available` — unknown vocabulary answers ambiguous 502 until the sandbox probe pins `KNOWN_TAKEN`; `POST /customers` + `POST /contacts` (one contact reused for all four roles per the vendor quickstart, random username/password, ITU dial-code `splitPhone` with definite `DOMAIN_PHONE_*` rejections); `POST /domains` register pinned to `invoiceOption: PayInvoice` + registrar-side `autoRenew: false`, no guessed `ns`; `GET /actions/search-current` polling (`Completed`/`Failed` terminal, `Added`/`Being Processed`/unknown keep polling, budget + hard attempt cap); `POST /domains/{orderId}/renew` with epoch-SECONDS `expDate` (the vendor's own double-renew guard) plus a defensive registrar-expiry scan; `GET /domains/by-name` (404 = not ours). Async ops return `{providerReference, completed:false}` → the service persists the reference and the retry RESUMES polling that exact order — a paid operation is NEVER re-posted (test-pinned on both sides of the seam). Registrant schema + dashboard buy modal gained the registrar-required `postalCode`. 22 adapter tests + 2 service resume tests, **179 total**; typecheck + lint clean. `docs/domains.md` rewritten with the full contract + ordered go-live checklist. **Blocked on user:** (1) free sandbox signup → live-probe the availability status vocabulary + verify expDate on a sandbox renewal; (2) ask ResellerClub 24/7 chat whether the reseller wallet can be funded with Flutterwave/Ghana MoMo — card/PayPal-only ⇒ supplier decision revisited before live sales; (3) then production credentials onto Render |
