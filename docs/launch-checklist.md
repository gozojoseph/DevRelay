# Launch checklist

Ordered, honest gate list. "Done" means the code path exists **and** is claimed
in production with real accounts — not simulated.

## A. Code + infrastructure gates (repo-complete)

- [x] Typecheck (`npm run typecheck`) — green
- [x] Lint (`npm run lint`) — green
- [x] Build (`npm run build`) — green, code-split web bundle
- [x] Migration check (`npm run db:check`) — green on PGlite
- [x] Automated tests (`npm test`, 76 tests) — green; ledger invariants,
      idempotency, status transitions, crypto/TOTP, webhook signatures all covered
- [~] CI pipeline running the five gates on every push — workflow added
      (`.github/workflows/ci.yml`: typecheck, lint, build, db:check, tests +
      coverage artifact, npm-audit highs, gitleaks; Node 22 + 24 matrix).
      Becomes ✅ at the first green run on GitHub.
- [~] Dependency security — `npm audit` currently returns **zero** findings
      (production and dev) after upgrading nodemailer 7→10, drizzle-orm
      0.44→0.45, vitest 3→5 and targeted transitive overrides; maintained by
      Dependabot (weekly) and the CI audit steps above.
- [ ] Error/uptime alerting wired to an operator channel
- [ ] `retention:run` scheduled (data retention window to be confirmed with counsel)

## B. Accounts & registrations (external, blocking)

- [ ] **Ghana Data Protection registration** — register as a data controller under
      the Data Protection Act (Act 843) before processing personal data in production.
- [ ] **Africa's Talking account + Ghana live access** — API keys issued
      (`AT_USERNAME`, `AT_API_KEY`), reseller/partner terms accepted, live mode enabled.
- [ ] **Africa's Talking sender IDs** — per-business approved sender IDs once
      customers sign up; pipeline exists end-to-end in-app.
- [ ] **Paystack** — live `sk_live_` keys after business verification; Mobile Money
      channel enabled; webhook URL registered and reachable over HTTPS.
- [ ] **Meta Tech Provider verification + app review** — permissions
      `whatsapp_business_messaging`, `whatsapp_business_management`, Embedded Signup
      config id (`META_CONFIG_ID`) approved; production traffic requires
      `META_PRODUCTION_APPROVED=true`.
- [ ] **Corporate + banking / Mobile Money float** — to match the self-reserved
      revenue account and settle provider costs weekly.

## C. Data & compliance

- [ ] Terms of service, privacy policy and acceptable-use versions reviewed by counsel
      (links exist in the app: `/terms`, `/privacy`, `/acceptable-use`; terms version
      string is recorded per account).
- [ ] Pricing table published and reviewed (admin console creates
      `pricing_versions` rows; without them sends fail closed with `PRICE_UNAVAILABLE`).
- [ ] Data retention windows entered into `scripts/retention.ts` config.
- [ ] Backup drill executed per [backup.md](backup.md) (target: RPO ≤ 5 min, RTO ≤ 30 min).

## D. Operational readiness

- [ ] `admin:bootstrap` executed; two admins enrolled with TOTP (avoid lockout).
- [ ] Staging environment runs with sandbox provider credentials and a Neon branch;
      the production config refuses sandbox keys by design.
- [ ] Audit log reviewed after first production sends; reconciliation queue empty
      (or a runbook exists for `pending_reconciliation` messages).
- [ ] Support inbox (`SUPPORT_EMAIL`) monitored; postmaster monitoring for provider bounces.
- [ ] On-call runbook for: Paystack webhook gaps, AT callback outages,
      Meta token expiry, and Neon failover.

## E. Go-live

- [ ] Load DB migrations during a brief API downtime (transactional, versioned).
- [ ] Rotate `SESSION_SECRET` + `ENCRYPTION_KEY` before traffic (fresh installs only).
- [ ] Flip `AT_MODE=live` and remove sandbox guardrails in production config.
- [ ] First wallet funding made through **real** Paystack; verify money lands in the
      ledger (available balance equal and the funding entry visible in the wallet history).
- [ ] First live SMS + first live WhatsApp message tracked end-to-end:
      job `done`, delivery event stored, reservation settled with the exact provider
      pricing payload.
- [ ] Cancel/keep this checklist with a launch postmortem note.

## Known non-goals / follow-ups after launch

- Usage-based MFA recovery codes (currently TOTP only).
- Bulk send/import UI (schema + limits already support batching via API keys).
- Per-message supplier cost capture from Africa's Talking callbacks
  (`supplier_cost_minor` exists on messages but AT does not send it today).
