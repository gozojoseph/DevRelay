# DevRelay

Prepaid SMS + WhatsApp messaging platform for Ghana-first builders. Developers fund
a wallet in Ghana cedis pesewas through Paystack, and every send reserves credits,
records the provider outcome, and settles or releases the reservation in an
immutable double-entry ledger. Nothing ships on simulated balances: sends are
refused unless providers and pricing are actually configured.

> **Status: implementation complete, not production-deployed.** All code paths are
> implemented and covered by an automated test suite (76 tests, green). No live
> Paystack, Africa's Talking or Meta transaction has ever been executed, because
> no live credentials or provider approvals exist yet. See
> [`docs/launch-checklist.md`](docs/launch-checklist.md) for the external
> prerequisites that gate go-live.

## Stack

| Layer     | Choice                                                              |
|-----------|---------------------------------------------------------------------|
| Backend   | Node 22, TypeScript (NodeNext), Express                              |
| Database  | PostgreSQL (Neon-compatible) via drizzle-orm; migrations in `drizzle/` |
| Frontend  | React 19 + Vite + TypeScript + Tailwind CSS (light/dark)             |
| Sessions  | Cookie sessions, HTTP-only, CSRF-tokenPOSTs, MFA (TOTP) for admins   |
| Payments  | Paystack (HMAC-SHA512-signed webhooks)                               |
| SMS       | Africa's Talking (sandbox/live modes)                                |
| WhatsApp  | Meta Cloud API v27.0 + Embedded Signup for number onboarding         |
| Tests     | Vitest over PGlite (embedded Postgres) with real migrations          |

## Repository layout

```
drizzle/            versioned SQL migrations + journal
server/
  app.ts            express app (security headers, CORS, static SPA, routes)
  config.ts         zod-validated environment → config(); availability() gates
  routes/           auth, dashboard, api (public v1), admin, webhooks, public
  services/         messaging, ledger, pricing, status, webhooks, payments, jobs…
  providers/        africastalking, meta, paystack adapters
  worker/           job worker (message sends, webhook delivery, polling)
  db/               schema.ts, client.ts, migrate.ts, check-migrations.ts
web/                Vite + React dashboard & public site (code-split per route)
tests/              Vitest suite (unit + PGlite integration)
docs/               provider setup, deployment, backup, launch checklist
```

## Getting started

```powershell
npm install
copy .env.example .env        # fill in the values (see docs/providers.md)
npm run db:migrate            # apply migrations
npm run admin:bootstrap       # create the first admin (prompts interactively)
npm run dev:api               # API on :4000
npm run dev:worker            # background worker
npm run dev:web               # dashboard on :5173 (proxies /api → :4000)
```

Database `DATABASE_URL` can be a local Postgres or a Neon connection string.

## Quality gates

```powershell
npm run typecheck   # tsc for server + web
npm run lint        # eslint (server, web, tests)
npm run build       # tsc emit + vite build (dist/web served by the API)
npm run db:check    # applies migrations to a throwaway PGlite instance
npm test            # Vitest suite (unit + integration); no live providers touched
```

All five gates are currently green. Tests use an in-memory PGlite Postgres with
the real migrations; provider credentials are stub values, and the suite never
calls a network provider.

## Security posture (implemented)

- Tenant isolation everywhere: every query filters by `accountId`; API keys are per-project with scoped permissions.
- Balanced integer ledger in pesewas; transfers lock ledger accounts ordered by id; per-message reservations guarantee no double charging.
- Transactional idempotency: keys are claimed inside the send transaction **before** credits move; conflicting bodies are rejected with 409.
- Provider webhooks: Paystack HMAC-SHA512 signature checks, Meta `X-Hub-Signature-256` verification, Africa's Talking secret-path token.
- Customer webhooks: HTTPS-only validated deliver URLs with SSRF resolution pinning; signed payloads (`sha256=HMAC(timestamp.body)`).
- Message bodies and secrets are AES-256-GCM encrypted at rest with context-bound AAD.
- Admin console behind TOTP MFA enrollment; audit events for approval, reconciliation and settings changes.

## Honest billing rules enforced by the code

- SMS failure after acceptance still requires possible upstream billing → reservation stays reserved and an audit event marks the message for admin reconciliation.
- WhatsApp failure releases the reservation (Meta bills only delivered messages); `free_*` pricing categories release; a delivered message without a pricing event is flagged `PRICING_EVENT_MISSING` for manual settlement, never guessed.

## Documentation

- [Provider setup (Paystack, Africa's Talking, Meta)](docs/providers.md)
- [Deployment](docs/deployment.md)
- [Backups & recovery](docs/backup.md)
- [Launch checklist (external blockers)](docs/launch-checklist.md)
- API surface: `web/public/openapi.yaml` (served with the built site)
