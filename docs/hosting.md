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
| H0a | User orders HostAfrica Ghana VPS + claims the free `.cloud` domain | ✅ 2026-11-10: VPS = "Cloud Server - Ghana" service 208213, **1 vCPU / 1 GB / 20 GB, Debian 12**, IP 102.68.83.113 — smaller than the planned C4 2c/4 GB, recorded honestly; capacity ≈ 2–3 small apps; bigger plans are orderable via `vps/create-order` when customers arrive. First month GHS 25.20 (50% promo), then GHS 50.40/mo via Flutterwave — MoMo billing on HostAfrica proven. A duplicate order (vm881emmz, invoice 1883694 GHS 50.40 Unpaid) awaits cancellation — never pay it. The free `.cloud` domain was never claimed; the wildcard uses **devrelay.africa** (registered 2026-11-10, GHS 99) |
| H0b | Provision: hardening, rootless Docker, Caddy + wildcard DNS + on-demand TLS, gVisor check; hello-world serves HTTPS | ✅ 2026-11-11 — done on Debian 12, see "The box" below; `https://hello.apps.devrelay.africa` serves HTTPS live from the box and from outside |
| H0c | Substrate decision (Coolify/Dokploy API vs custom agent) | ✅ **custom agent** — decided on box facts: 1 GB RAM cannot spare Coolify/Dokploy's overhead, and the agent contract (`Host agent API` above) is already test-pinned; the agent is the only exposed service, exactly as the security posture demands |
| H1 | Schema, API, plans, billing, jobs, renewal sweep — **this commit** (136 tests) | ✅ done |
| H2 | Deploy pipeline end-to-end against the real agent | next |
| H3 | Hardening + 1–2 vetted beta customers | after H2 |

## The box (H0b, provisioned 2026-11-11)

Host: HostAfrica "Cloud Server - Ghana", service id 208213, IP
102.68.83.113, Debian 12 (bookworm), kernel 6.1, 1 vCPU / 947 MB usable
RAM / 20 GB disk, 200 Mbit. Not the Ubuntu C4 2c/4 GB we originally
specced — the user's real order was 1c/1GB; recorded, not hidden.

**Access (never a password in chat or logs):** root SSH is key-only.
The HostAfrica API is the credential path: `vps/get-encrypted-password`
takes a **4096-bit RSA PEM public key** and returns the root password
**RSA-OAEP-SHA256-encrypted** to it (the response's `encryption` field
says so; the key size is validated server-side), and it also delivers an
ed25519 private key for the VM — fetched over SFTP, never printed.
Effective sshd: `PasswordAuthentication no`,
`PermitRootLogin prohibit-password` via
`/etc/ssh/sshd_config.d/00-devrelay-hardening.conf`. Gotcha recorded:
the template ships `50-cloud-init.conf` granting root password login, and
sshd keeps the FIRST value it reads — hence the `00-` prefix (99- loses).
Host key pinned at first contact:
`SHA256:iTWcKtNxSPbUybU55UbV3IWp21aSqXtqCCD8zzzn4uc=`.

**Hardening done:** ufw active (in: 22/80/443; out: **25 denied** — spam
posture), unattended-upgrades enabled, 947 MB swap present (template
default), rootless Docker 29.9.3 under user `devrelay` (subuid
100000:65536, linger on, cgroup delegation via
`user@.service.d/delegation.conf`), rootful daemon disabled.
**gVisor: NOT installed — decision recorded**: the upstream apt repo has
no Release file and all release binary URLs 404; hardened rootless Docker
(runc) is the fallback per the security posture above. Revisit when
upstream restores releases.

**TLS edge:** Caddy 2.10.2, tarball install, dedicated `caddy` user with
`AmbientCapabilities=CAP_NET_BIND_SERVICE` (gotcha recorded:
`NoNewPrivileges=true` strips file-based setcap — ambient capabilities
are the fix). Wildcard DNS `*.apps.devrelay.africa → 102.68.83.113` was
created through the HostAfrica DNS API (`dns/add-record`; gotchas: the
record is a NESTED object `{record: {name, type, content, ttl}}` and
`domain_id` is a numeric STRING `"351955"`). Certificates are per-hostname
on-demand (HTTP-01), gated by an ask endpoint.

**Ask endpoint contract (live-verified from Caddy 2.10.2 source):** Caddy
calls `GET <ask-url>/?domain=<name>` — the domain is a **QUERY PARAMETER,
not a path segment**. The ask server (`devrelay-ask.service`, python3)
answers 200 only if `/var/lib/devrelay/allowed-domains/<name>` exists;
everything else → 404 → Caddy refuses to issue. A path-based file server
here silently returned its directory listing (200) for every domain,
issuing certs for arbitrary names — caught by testing a NEGATIVE case,
fixed, and the stray certs revoked. Honest lesson: an allow-list is only
real if its denial path is actually exercised. H2's host agent will own
this allow-list, answering from the `hosted_apps` table.

**Hello-world proof:** `traefik/whoami` running rootless, published to
127.0.0.1:8080, Caddy reverse-proxying — `https://hello.apps.devrelay.africa`
returns 200 from the box AND from an outside network; unapproved names
fail at the TLS handshake (fail-closed).
