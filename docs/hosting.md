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
| H2 | Deploy pipeline end-to-end against the real agent | ✅ **agent live on the box (2026-11-11)** — core + entrypoint pinned by 38 contract tests; deployed to the VPS (Node 22, `devrelay-agent.service`, python ask disabled, Caddy repointed to the agent-managed Caddyfile); **live e2e passed end to end**: node-builder deploy from a Git repo → `live` in ~27 s → `https://e2e-demo.apps.devrelay.africa` 200 from the box AND from outside, container inspected (`read-only` rootfs, 256 MB cap, pids 256, loopback-only publish, restart=unless-stopped), idempotent re-POST, honest negatives on the real agent (no-start-script → definite failed, immutable slug 409, start-without-container 409, file:// refused 400 both with the flag on-but-unset and off, ask gate fail-closed), stop/start/logs/delete round-trip, state.json 0600 with `repoToken` never persisted. Two real bugs caught by the e2e and fixed: the queue loop orphaned work arriving between passes (hangs callers — fixed + gate-tested), and `docker start` alone reported live (now probes first; 409 + `failed` on silence). Remaining for H2 closure: Render env wiring (`HOST_AGENT_URL`/`HOST_AGENT_TOKEN`) and the DevRelay-side deploy job proof against the live agent |
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

## Host agent operations (H2)

The agent is **plain ESM JavaScript with zero runtime dependencies** so it
runs on the 1 GB box with no build step: `git pull && systemctl restart
devrelay-agent` is the entire update procedure. Two files:

- `agent/core.mjs` — the whole state machine (validation, idempotent
  deployments, single-slot queue, build pipeline with rollback, ask
  endpoint, Caddyfile generator, boot reconcile). Every side effect goes
  through injected `exec` / `fs` / `probe`, which is what makes it
  contract-testable without Docker.
- `agent/index.mjs` — the real wiring: `child_process.spawn` exec with
  SIGKILL timeout, HTTP probe with retry-until-deadline, the API and ask
  HTTP servers, env parsing (refuses to start without a ≥24-char token),
  graceful SIGTERM.

**On the box:** the repo is cloned to `/home/devrelay/DevRelay` (the agent
runs from that checkout; `git pull` there is the update), state and build
dirs live under `/home/devrelay/devrelay-agent/` (the `DEVRELAY_AGENT_DATA_DIR`
default) — state persists to
`/home/devrelay/devrelay-agent/state.json` (0600; `repoToken` is never
written to disk — redacted at persist time; an interrupted `building`
deployment is honestly failed at boot with "agent restarted while this
deployment was building"). The Caddyfile the agent regenerates lives at
`/var/lib/devrelay/Caddyfile` (dir owned by `devrelay`; the caddy systemd
unit's ExecStart is repointed there from `/etc/caddy/Caddyfile`).

**Config** via `/etc/devrelay/agent.env` (root-owned, 0600), loaded by the
systemd unit; `DOCKER_HOST=unix:///run/user/1000/docker.sock` targets the
rootless daemon. Keys (all optional except the token — see
`agent/index.mjs`): `DEVRELAY_AGENT_TOKEN` (required, ≥24 chars),
`DEVRELAY_AGENT_API_PORT` 8787, `DEVRELAY_AGENT_ASK_PORT` 5577,
`DEVRELAY_AGENT_BASE_DOMAIN` apps.devrelay.africa,
`DEVRELAY_AGENT_AGENT_HOST` agent.apps.devrelay.africa,
`DEVRELAY_AGENT_STATIC_ROUTES` `hello.apps.devrelay.africa=127.0.0.1:8080`,
`DEVRELAY_AGENT_CAPACITY_MEMORY_MB` 768,
`DEVRELAY_AGENT_CADDY_CONFIG` /var/lib/devrelay/Caddyfile,
`DEVRELAY_AGENT_ALLOW_FILE_CLONES` (off by default — `file://` clone URLs
are refused unless explicitly enabled for local proof runs).

**The unit as deployed** (`/etc/systemd/system/devrelay-agent.service`,
summary): `User=devrelay`, `EnvironmentFile=/etc/devrelay/agent.env`,
`Environment=DOCKER_CONFIG=/home/devrelay/devrelay-agent/.docker`
(**gotcha the live e2e caught**: `ProtectHome=read-only` makes `~/.docker`
unwritable and the docker CLI dies with "mkdir
/home/devrelay/.docker/buildx: read-only file system" — pointing
`DOCKER_CONFIG` into the writable data dir fixes it without weakening the
sandbox), `ExecStartPre` waits for the rootless docker.sock,
`ProtectSystem=full`, `ProtectHome=read-only`,
`ReadWritePaths=-/home/devrelay/devrelay-agent`, `NoNewPrivileges`,
`PrivateTmp`, `Restart=always`.

**Ports:** the API listens on 127.0.0.1:8787 and is exposed as
`https://agent.apps.devrelay.africa` through Caddy; the ask endpoint stays
loopback-only on 127.0.0.1:5577 (Caddy calls it locally); customer app
containers publish to 127.0.0.1:10000–10999 only. Nothing but Caddy
listens on a public interface. Note: once the agent host has a
certificate, internet scanners find it via CT logs within minutes — every
sensitive route answers 401 without the bearer token (observed live).

**Ports:** the API listens on 127.0.0.1:8787 and is exposed as
`https://agent.apps.devrelay.africa` through Caddy; the ask endpoint stays
loopback-only on 127.0.0.1:5577 (Caddy calls it locally); customer app
containers publish to 127.0.0.1:10000–10999 only. Nothing but Caddy
listens on a public interface.

**Before first start:** the python `devrelay-ask.service` must be disabled
(`systemctl disable --now devrelay-ask`) or the agent's ask server cannot
bind 5577 and the unit will crash-loop. The python file-based allow-list is
obsolete — the agent answers from its own state.

**Render side:** `HOST_AGENT_URL=https://agent.apps.devrelay.africa` and
`HOST_AGENT_TOKEN=<the agent token>` on both the API and worker services.
The token is generated on the box (`openssl rand -hex 32`), written to the
env file, and handed to Render out-of-band — never through chat.
