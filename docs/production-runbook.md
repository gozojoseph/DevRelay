# Production runbook

End-to-end guide for taking DevRelay from this repository to a live,
production deployment. The code is complete and all quality gates are green;
what remains before go-live is infrastructure, configuration and **four
external approvals that no code change can substitute** (Paystack live
verification, Africa's Talking live access, Meta Tech Provider review, Ghana
DPC registration — see [launch-checklist.md](launch-checklist.md)).

The application refuses to fake anything: until a provider is connected the
related feature answers with an honest `503`.

---

## 0. What `NODE_ENV=production` enforces

From `server/config.ts` — boot **fails** unless:

| Gate | Rule |
| --- | --- |
| Origins | `APP_ORIGIN` and `PUBLIC_API_URL` both start with `https://` |
| Email | `EMAIL_MODE=smtp` with `SMTP_HOST` and `EMAIL_FROM` |
| SMS | `AT_MODE=sandbox` cannot be combined with an `AT_API_KEY` |
| Cookies | Session cookies are `Secure` (automatic) |
| Proxy | `trust proxy` is enabled — run the API behind your TLS terminator and firewall the direct app port |

Feature availability is config-derived (`availability()`): missing
`PAYSTACK_SECRET_KEY` disables funding; AT needs `AT_USERNAME`, `AT_API_KEY`,
`AT_CALLBACK_TOKEN` **and** `AT_MODE=live` in production; WhatsApp live
additionally requires `META_PRODUCTION_APPROVED=true` **and**
`NODE_ENV=production`.

---

## 1. Accounts & registrations (start these first — longest lead time)

| Item | Notes |
| --- | --- |
| Domain + TLS | e.g. `app.devrelay.com`; single origin serves API and SPA |
| **Ghana DPC registration** (Act 843) | Data-controller registration before processing personal data |
| Legal review | `/terms`, `/privacy`, `/acceptable-use`; terms version recorded per account |
| Paystack business verification | Live keys, Mobile Money + card channels, settlement account |
| Africa's Talking live access | Ghana live account, partner terms, approved sender IDs |
| Meta Tech Provider verification + app review | `whatsapp_business_messaging`, `whatsapp_business_management`, Embedded Signup config id, WABA payment method |
| Transactional email provider | Resend/Postmark/SES/Mailgun; verify domain; SPF + DKIM + DMARC |
| Neon production project | See below |

---

## 2. Infrastructure

### 2.1 Neon (PostgreSQL)

1. Create the production project (region near Ghana/Europe, e.g. `eu-west-1`/`eu-central-1`). Copy the **pooled** connection string (`…-pooler…neon.tech/neondb?sslmode=require`).
2. Enable point-in-time recovery with ≥ 7 days history.
3. Create a **separate branch** for staging (sandbox providers, test payments) — never rehearse against production data.
4. Connection sizing: the API pool caps at 10 connections per process; the pooled endpoint handles fan-out. Keep `DATABASE_URL` secret.

Note: the API/worker never apply migrations at runtime (by design — one place applies them, at release time).

### 2.2 Deployment artifacts in this repository

| File | Purpose |
| --- | --- |
| `Dockerfile` | Multi-stage: build (compile server, bundle web) → runtime (prod deps only, `USER node`, image `HEALTHCHECK` on `/healthz`) |
| `fly.toml` | Fly **API** app; `[deploy] release_command` applies migrations before machines boot |
| `fly.worker.toml` | Fly **worker** app (same image, worker entrypoint, no HTTP service) |
| `render.yaml` | Render blueprint: `envVarGroups` + API (web, `preDeployCommand` migrates) + worker |

Runtime entrypoints (all from one image, no dev dependencies needed at runtime):

```
API:      node dist/server/index.js
Worker:   node dist/server/worker/index.js
Migrate:  node dist/server/db/migrate.js        (npm run start:migrate)
Admin:    node dist/server/scripts/bootstrap-admin.js
```

### 2.3 Fly.io quickstart

```bash
fly apps create devrelay-api
fly secrets set -a devrelay-api \
  DATABASE_URL="postgresql://…-pooler…neon.tech/neondb?sslmode=require" \
  SESSION_SECRET="…" ENCRYPTION_KEY="…" \
  SMTP_HOST="…" SMTP_USER="…" SMTP_PASSWORD="…" EMAIL_FROM="…" SUPPORT_EMAIL="…"
fly deploy -a devrelay-api          # release_command migrates first

fly apps create devrelay-worker
fly secrets import -a devrelay-worker < same env values >
fly deploy -a devrelay-worker -c fly.worker.toml
```

DNS: point `app.yourdomain.com` at the Fly IP/`_redirects`; Fly terminates TLS
per config. Worker scaling: more machines on the worker app; jobs are claimed
with `FOR UPDATE SKIP LOCKED` + leases, so extra workers are safe.

### 2.4 Render.com quickstart

Blueprint → connect the GitHub repo → Render generates the API + worker, then
fill the `sync: false` values. `preDeployCommand` on the API applies
migrations before the new release serves traffic; the worker has none so two
processes never migrate concurrently.

### 2.5 VPS (alternative)

systemd units (`devrelay-api.service`, `devrelay-worker.service`) running the
compiled entrypoints, Caddy in front for automatic TLS, and a firewall that
allows only Caddy → app port. Run `node dist/server/db/migrate.js` manually
before switching traffic.

---

## 3. Production environment

```ini
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://…-pooler…neon.tech/neondb?sslmode=require
APP_ORIGIN=https://app.yourdomain.com
PUBLIC_API_URL=https://app.yourdomain.com
SESSION_SECRET=<48 random bytes, base64url>
ENCRYPTION_KEY=<64 hex>
EMAIL_MODE=smtp
SMTP_HOST=…  SMTP_PORT=587  SMTP_USER=…  SMTP_PASSWORD=…
EMAIL_FROM=DevRelay <no-reply@yourdomain.com>
SUPPORT_EMAIL=support@yourdomain.com
PAYSTACK_SECRET_KEY=sk_live_…          # empty until Phase 4.1 done
PAYSTACK_WEBHOOK_SECRET=…
AT_USERNAME=…  AT_API_KEY=…  AT_MODE=live  AT_CALLBACK_TOKEN=…
META_APP_ID=…  META_APP_SECRET=…  META_CONFIG_ID=…  META_VERIFY_TOKEN=…  META_GRAPH_VERSION=v27.0
META_PRODUCTION_APPROVED=false         # true only after Meta review approval
WORKER_POLL_MS=1500
```

Generate secrets:

```bash
node -e "const c=require('node:crypto');console.log('SESSION_SECRET='+c.randomBytes(48).toString('base64url'));console.log('ENCRYPTION_KEY='+c.randomBytes(32).toString('hex'));console.log('AT_CALLBACK_TOKEN='+c.randomBytes(24).toString('hex'));console.log('META_VERIFY_TOKEN='+c.randomBytes(24).toString('hex'))"
```

Rules:
- Secrets live in the platform secret manager, **never** in a committed `.env`
  (gitleaks in CI guards against this).
- Back up `ENCRYPTION_KEY` in a separate vault. It decrypts message bodies,
  tokens, webhook secrets and MFA seeds; losing it is unrecoverable, rotating
  it without a re-encryption plan corrupts data.
- Rotating `SESSION_SECRET` invalidates all sessions/CSRF tokens (safe to do
  at install; do deliberately later).

---

## 4. Provider connections (dashboard ↔ app)

Details per provider: [providers.md](providers.md).

### 4.1 Paystack (funding)
- Business verification → `sk_live_…`; enable Mobile Money (MTN/Telecel/AT) + cards for Ghana.
- Webhook: `https://app.yourdomain.com/api/webhooks/paystack` with signing secret in `PAYSTACK_WEBHOOK_SECRET`; use `PAYSTACK_WEBHOOK_SECRETS` (comma list) for zero-downtime rotation.
- Signature: `x-paystack-signature` HMAC-SHA512 over the raw body; newest timestamped header variant supported; event-hash dedupe blocks replays.

### 4.2 Africa's Talking (SMS)
- Live Ghana mode: `AT_MODE=live`, `AT_USERNAME`, `AT_API_KEY`.
- Callback: `https://app.yourdomain.com/api/webhooks/africastalking/<AT_CALLBACK_TOKEN>` — AT sends no signature, so the secret path **is** the credential; never expose it.
- Sender IDs: customer requests in-app → admin approval → provider approval; only approved senders may be used.
- Create SMS pricing rows first; without one, sends fail closed (`PRICE_UNAVAILABLE`).

### 4.3 Meta WhatsApp Cloud API
- Business app → WhatsApp product → **Tech Provider** flow for Embedded Signup.
- Pass business verification + app review (messaging + management permissions); then, and only then, `META_PRODUCTION_APPROVED=true`.
- Webhook: `https://app.yourdomain.com/api/webhooks/meta`, verify token `META_VERIFY_TOKEN`, subscribe to `messages` (payloads verified via `X-Hub-Signature-256`).
- Attach the WABA payment method; per-message pricing.
- Pricing rows must cover categories you sell (`marketing`, `utility`, `authentication`, `service`, free entry points).

### 4.4 SMTP
- Domain-verified sender, SPF/DKIM/DMARC green (mail-tester), support inbox monitored.
- Verification/password-reset emails use this path; port 465 ⇒ implicit TLS, 587 ⇒ STARTTLS (both handled).

---

## 5. Deployment procedure (ordered)

```bash
# 0. Prerequisite: CI green on the commit you deploy (push repo to GitHub first).
# 1. Build happens in CI / on the host (Dockerfile multi-stage).
# 2. Migrations run automatically BEFORE traffic switches:
#      Fly   : release_command    (fly.toml)
#      Render: preDeployCommand   (render.yaml)
#      VPS   : run manually before restart:
              node dist/server/db/migrate.js
# 3. Boot API + worker, verify /healthz.
```

Post-deploy, first-boot checklist:
1. Register your admin email → verification email arrives → login.
2. `ADMIN_EMAIL`/`ADMIN_PASSWORD` on a reachable environment — create the
   admin **once** (`node dist/server/scripts/bootstrap-admin.js`); ≥ 16-char
   password or a generated one printed to console once.
3. Log in as admin → **enroll TOTP MFA immediately** → create a second admin.
4. Publish pricing rows (SMS Ghana + WhatsApp categories).
5. Publish pricing rows (SMS Ghana + WhatsApp categories).
6. Confirm job flow only through the §6 verification transactions — builds
   and rehearsing always belong in the staging branch, never production.

---

## 6. Controlled go-live verification (real rails, tiny amounts)

Run these in order with your own phone and **GHS 1** funding:

| Step | Expected result |
| --- | --- |
| Fund wallet via live Paystack (GHS 1) | Payment events show paid; available balance +100 pesewas exactly once |
| Send live SMS to your own number | Job `done`; message `sent/delivered`; reservation settles to platform revenue |
| Send live WhatsApp template to your own number | Delivered; reservation settled with per-message category; `free_*` categories release |
| Trigger a customer webhook endpoint | Delivered with header `X-…` and body signed `sha256=HMAC(timestamp.body)`; invalid signature rejected |
| Force a failure case | Correct failure status; no silent charge |
| Admin → Reconciliation | Empty, or entries with written explanation |
| Admin → Audit | Bootstrap / approvals / pricing changes present |

Go-live is **not complete** until: DPC registration done, policies published,
two TOTP admins, backups tested by restore drill, monitoring/alerts wired,
support inbox monitored, and at least one real transaction per channel
reconciled in the ledger.

---

## 7. Operations

**Backups**
- Neon PITR ≥ 7 days **and** nightly logical dump to encrypted object storage (30/90-day retention). Drill quarterly into a Neon branch (targets: RPO ≤ 5 min, RTO ≤ 30 min).
- `ENCRYPTION_KEY` backed up separately (vault), never with the database.

**Monitoring & alerting**
- Uptime check on `GET /healthz` (30–60 s).
- Alert on: 5xx error rate, worker backlog/failures, webhook delivery failures, `pending_reconciliation` > 0, admin-audit anomalies.
- Log drain with `requestId` correlation; wire Sentry (or similar) before launch.

**Scheduled work**
- `npm run retention:run` daily (after counsel confirms retention windows).
- Dependabot PRs weekly; keep CI green before merging.

**Incidents & rollback**
- App: redeploy previous image tag. Migrations are forward-only — snapshot Neon before every release.
- Channel kill-switch: remove that provider's key from secrets and restart → feature returns honest 503.
- DB restore: `docs/backup.md` (snapshot/PITR → verify ledger sums → re-mark stale `running` jobs `pending`).
- Rotations: Paystack via `PAYSTACK_WEBHOOK_SECRETS` overlap; AT callback token (update AT dashboard immediately); Meta per-connection re-consent through Embedded Signup.

**Security baseline**
- Secrets only in the platform manager; raw app port firewalled; TLS only.
- Admin = admin role + TOTP only; keep the admin list short.
- API keys limited to 20 writes / 120 reads per minute per project.

---

## 8. Final go-live checklist

```
[ ] GitHub repo pushed; CI green on the deployed commit
[ ] Domain + TLS live; /healthz green
[ ] Neon prod: PITR enabled, first dump taken, restore drill scheduled
[ ] SMTP domain verified (SPF/DKIM/DMARC), test email received
[ ] Paystack live keys + webhook + MoMo/card channels
[ ] AT live mode + callback token + approved sender IDs
[ ] Meta review approved + Embedded Signup config + WABA billing + META_PRODUCTION_APPROVED=true
[ ] Ghana DPC registration complete; terms/privacy/AUP published
[ ] Production secrets in platform manager; boot gates pass
[ ] Migrations applied via release/preDeploy; API + worker running
[ ] Admin bootstrapped, TOTP enrolled, second admin created
[ ] Pricing rows published; sender IDs approved
[ ] GHS 1 live Paystack funding reconciled in the ledger
[ ] First live SMS reconciled; first live WhatsApp reconciled
[ ] Uptime + error alerting wired; reconciliation queue empty
[ ] retention:run scheduled
```
