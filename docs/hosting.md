# DevRelay Cloud — hosted apps (PaaS, v1 in build)

DevRelay's second product line: customers deploy a backend app (Node or
Dockerfile) from a Git repo and get an HTTPS URL, logs, env vars, and
restart/pause controls — billed as a **monthly plan charged in advance from
the same GHS wallet** as messaging. One account, one wallet, one API key
scheme. Decided 2026-11-10 (user choice: full PaaS, Git-based Node +
Dockerfile deploys, monthly GHS plans; pricing numbers TBD — the plan catalog
in `server/services/hosting.ts` holds clearly-marked placeholders).

## v1 scope

- Git sources: public `https://` repo URLs, or private repos via a per-app
  deploy token (stored encrypted, `app-repo:<appId>` context).
- Builders: `dockerfile` (repo has a Dockerfile) or `node` (auto-detected
  Node app built by the agent's builder).
- One container per app on the host agent; brief stop-start deploys (no
  zero-downtime promise in v1).
- Plans: `starter` (256 MB / 0.25 vCPU) and `standard` (512 MB / 0.5 vCPU),
  30-day periods, charged in advance. Deploys are free in v1.
- Honest lifecycle, mirroring the messaging rails:
  `pending → building → live → paused_manual | paused_no_funds | failed |
  deleted`. A wallet that cannot cover renewal pauses the app
  (`paused_no_funds`) — never a silent outage; renewal success resumes it
  automatically. A **failed redeploy never stops the previously live
  container**.

Out of v1 (documented, not forgotten): custom domains, databases inside apps
(BYO via env vars), autoscaling, multi-region, cron, GitHub App OAuth,
per-CPU-second metering (can't be measured honestly yet, so it isn't billed).

## Architecture

```
DevRelay API  POST /api/apps, /api/apps/:id/deploy ...  (scopes hosting:read/write)
   └─ worker jobs: app.deploy | app.stop | app.start | app.delete (+ renew sweep)
        └─ host agent (HTTPS, bearer token) — the ONLY executor of customer code
             └─ Docker (rootless; gVisor when the kernel allows) + Caddy TLS
```

The DevRelay side is substrate-agnostic: `server/providers/host-agent.ts` is
the adapter seam. H0's decision — Coolify/Dokploy as substrate vs a custom
agent — replaces only that module.

## Host agent API (the contract H0b/H0c must implement)

Base: `HOST_AGENT_URL`; auth: `Authorization: Bearer <HOST_AGENT_TOKEN>`.
All responses JSON. Status codes map honestly: 4xx → definite rejection,
429 → retryable, 5xx/timeout → ambiguous (the operation may have happened).

| Method & path | Body | Response |
|---|---|---|
| `POST /deployments` | `{deploymentId, appId, slug, name, repoUrl, repoToken?, branch, builder, plan, memoryMb, cpuMilli}` | `{status: 'building'\|'live'\|'failed', url?, containerRef?, error?, logTail?}` |
| `GET /deployments/:deploymentId` | — | same shape |
| `POST /apps/:appId/stop` · `/start` | — | `200` |
| `DELETE /apps/:appId` | — | `200` |
| `GET /apps/:appId/logs` | — | `{tail}` (last ~500 lines, ≤20k chars) |

`POST /deployments` is **idempotent by `deploymentId`**: re-POSTing returns
the deployment's current state. That is what makes deploy-job retries honest —
after an ambiguous timeout the worker re-POSTs and reads reality instead of
guessing. Builds run with resource caps (concurrency 1, memory-limited) so one
customer's build cannot starve other apps.

## Billing semantics

- Charge: `transfer(customer_available → platform_revenue, kind
  'hosting_subscription', reference 'hosting:<appId>:<YYYY-MM-DD of new
  expiry>')` — one reference per app per period makes every charge idempotent.
- Creation charges month 1 immediately; insufficient balance → `402
  INSUFFICIENT_CREDITS` and **nothing is created** (no unfunded apps exist).
- Renewal sweep (worker, every 5 min): apps expiring within 3 days are
  charged for the next period. Failure on a `live` app → `paused_no_funds` +
  agent stop; success on a `paused_no_funds` app → resume + agent start.
  `paused_manual` apps renew but are never auto-started.

## Security & abuse posture (H3 hardening, non-negotiable)

1. Rootless containers, no privileged mode, cgroup CPU/RAM/pids caps, read-only
   root filesystem; gVisor (runsc) when the VPS kernel supports it — if not,
   the fallback (hardened rootless Docker only) is recorded as a decision, not
   silently skipped.
2. Hosting customers pass the existing manual account-approval gate; no
   anonymous deploys.
3. Outbound port 25 blocked (no spam); egress bandwidth cap per app.
4. ToS addendum: prohibited content + takedown process; Ghana Data Protection
   Act processor clause.
5. The agent is the only thing exposed on the VPS; any substrate admin panel
   (Coolify/Dokploy) is firewalled to localhost/VPN — its API equals root.

## Phases

| Phase | Deliverable | Status |
|---|---|---|
| H0a | User orders HostAfrica Ghana VPS (C4, 2 vCPU/4GB, ~GHS 120 first month via Flutterwave/MoMo) + claims the free `.cloud` domain | pending user |
| H0b | Provision: Ubuntu hardening, rootless Docker, Caddy + wildcard DNS `*.apps.<domain>` + on-demand TLS, gVisor check; hello-world serves HTTPS | pending H0a |
| H0c | Substrate decision (Coolify/Dokploy API vs custom agent) | pending H0b |
| H1 | Schema, API, plans, billing, jobs, renewal sweep — **this commit** (136 tests) | ✅ done |
| H2 | Deploy pipeline end-to-end against the real agent | next |
| H3 | Hardening + 1–2 vetted beta customers | after H2 |
