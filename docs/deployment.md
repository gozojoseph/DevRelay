# Deployment

DevRelay consists of three processes (or two if the worker runs next to the
API deployment with a shared database):

- `API` — `node dist/server/index.js` (npm script `start:api`), serves both
  `/api/*` and the built dashboard (`dist/web`).
- `Worker` — `node dist/server/worker/index.js` (npm script `start:worker`),
  processes jobs (sends, webhook deliveries, provider polling). It is safe to
  run several workers; jobs are claimed with `FOR UPDATE SKIP LOCKED`.
- `PostgreSQL` — Neon (recommended) or any Postgres 15+ reachable over TLS.

## 1. Provision the database

1. Create a Neon project (or your own Postgres) and copy the connection string
   into `DATABASE_URL`.
2. Apply migrations once before the first deploy:
   ```powershell
   DATABASE_URL="postgres://…" npm run db:migrate
   ```
   Migrations are versioned in `drizzle/` and tracked in
   `drizzle.__drizzle_migrations`; never edit an applied file, always generate
   a new one via `npm run db:generate` after schema changes.
3. Sanity-check migrations with `npm run db:check` (applies to a throwaway
   PGlite instance).

## 2. Configure environment

Copy `.env.example` and set at minimum:

- `NODE_ENV=production`
- `DATABASE_URL` — Neon/postgres URL
- `APP_ORIGIN` and `PUBLIC_API_URL` — **HTTPS** origins (config refuses
  HTTP origins in production)
- `SESSION_SECRET`, `ENCRYPTION_KEY` — generated secrets
  (`openssl rand -base64 48`, `openssl rand -hex 32`)
- `EMAIL_MODE` — either `mailtrap` (with `MAILTRAP_API_TOKEN`,
  `MAILTRAP_FROM_EMAIL`, optional `MAILTRAP_FROM_NAME`) or `smtp` (with
  `SMTP_HOST/PORT/USER/PASSWORD` and `EMAIL_FROM`); a real rail is required in
  production, and `SUPPORT_EMAIL` must be set
- Provider credentials per `docs/providers.md`; sandbox credentials are
  rejected in production configs (`AT_MODE=sandbox` + `AT_API_KEY` refuses to
  start).

## 3. Build and run

```powershell
npm ci
npm run build          # emits dist/server + dist/web
npm run admin:bootstrap   # first admin account (verify email flow uses SMTP)
```

Run the API behind a TLS terminator (e.g. Nginx, Fly edge, Cloudflare):
certificate termination is fine; the app must itself be reachable from
Paystack, Meta and Africa's Talking webhooks over public HTTPS.

Health check: `GET /healthz` (no auth).

Recommended process manager: PM2, systemd units or a container platform, one
instance minimum for the API and at least one worker. Set
`WORKER_POLL_MS` (default 1500 ms) to tune worker polling.

## 4. Post-deploy checks

- Smoke list (manual until a CI job exists):
  1. `GET /healthz` → 200.
  2. Register a developer account (email lands in SMTP inbox).
  3. Fund wallet with `sk_test_…` in a staging deployment against Paystack test mode.
  4. Send a sandbox SMS with a sandbox `AT_MODE`; watch `jobs` transition to
     `done`, message status `sent`, ledger settles.
  5. Register a webhook endpoint and confirm test events deliver (200) with a valid signature.
- Review rate limits in production: API keys are limited to 20 writes / 120 reads per minute.

## 5. Logs and observability (current state)

- Request IDs attach to every response (`X-Request-Id`) and error envelopes;
  request bodies, tokens and provider secrets are never logged.
- Admins audit console records account approval, reconciliation, pricing
  changes and settings.
- Missing: external APM/log drain — pick a vendor and use a container log sink;
  error envelopes include a `requestId` for correlation.

## 6. Scaling notes

- PGlite migrations must only run in one place (deploy step), not concurrently.
- Ledger transactions take deterministic locks (sorted by ledger-account id) so
  concurrent sends for the same account serialize instead of deadlocking.
- Workers are horizontally scalable; jobs are claimed through a lease
  (`lockedBy`/`leaseUntil`) and retried up to `maxAttempts`.
