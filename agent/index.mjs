#!/usr/bin/env node
// DevRelay Cloud host agent — entrypoint (real I/O wiring).
//
// Runs on the hosting VPS as user `devrelay` (systemd unit devrelay-agent.service):
//  - API server on 127.0.0.1:8787 — bearer-token contract from docs/hosting.md,
//    reached from the internet only through Caddy (agent.apps.devrelay.africa).
//  - Ask server on 127.0.0.1:5577 — Caddy's on-demand-TLS permission endpoint
//    (GET /?domain=<name> -> 200 iff the name is a domain this agent hosts).
//    This replaces the earlier python devrelay-ask.service.
//
// Zero runtime dependencies; Node >= 20.

import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createAgent, clip } from './core.mjs';

function die(message) {
  console.error(`devrelay-agent: ${message}`);
  process.exit(1);
}

// ---------- environment ----------

const bool = (v) => /^(1|true|yes)$/i.test(String(v ?? ''));
const int = (v, fallback) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
};

const staticRoutes = String(process.env.DEVRELAY_AGENT_STATIC_ROUTES ?? 'hello.apps.devrelay.africa=127.0.0.1:8080')
  .split(',').map(s => s.trim()).filter(Boolean)
  .map(pair => {
    const [host, upstream] = pair.split('=');
    if (!host || !upstream) die(`bad DEVRELAY_AGENT_STATIC_ROUTES entry: ${pair}`);
    return { host, upstream };
  });

const token = process.env.DEVRELAY_AGENT_TOKEN ?? '';
if (!token || token.length < 24) die('DEVRELAY_AGENT_TOKEN is missing or too short — refusing to start');

const dataDir = process.env.DEVRELAY_AGENT_DATA_DIR ?? '/home/devrelay/devrelay-agent';
const env = {
  token,
  apiPort: int(process.env.DEVRELAY_AGENT_API_PORT, 8787),
  askPort: int(process.env.DEVRELAY_AGENT_ASK_PORT, 5577),
  baseDomain: process.env.DEVRELAY_AGENT_BASE_DOMAIN ?? 'apps.devrelay.africa',
  agentHost: process.env.DEVRELAY_AGENT_AGENT_HOST ?? 'agent.apps.devrelay.africa',
  staticRoutes,
  dataDir,
  statePath: `${dataDir}/state.json`,
  caddyConfigPath: process.env.DEVRELAY_AGENT_CADDY_CONFIG ?? '/var/lib/devrelay/Caddyfile',
  capacityMemoryMb: int(process.env.DEVRELAY_AGENT_CAPACITY_MEMORY_MB, 768),
  allowFileClones: bool(process.env.DEVRELAY_AGENT_ALLOW_FILE_CLONES),
  caddyBin: process.env.DEVRELAY_AGENT_CADDY_BIN ?? '/usr/local/bin/caddy',
  buildMemoryMb: int(process.env.DEVRELAY_AGENT_BUILD_MEMORY_MB, 768),
  buildCpuMilli: int(process.env.DEVRELAY_AGENT_BUILD_CPU_MILLI, 900),
  cloneTimeoutMs: int(process.env.DEVRELAY_AGENT_CLONE_TIMEOUT_MS, 300_000),
  buildTimeoutMs: int(process.env.DEVRELAY_AGENT_BUILD_TIMEOUT_MS, 900_000),
  cmdTimeoutMs: int(process.env.DEVRELAY_AGENT_CMD_TIMEOUT_MS, 120_000),
  probeTimeoutMs: int(process.env.DEVRELAY_AGENT_PROBE_TIMEOUT_MS, 45_000),
  rollbackProbeTimeoutMs: int(process.env.DEVRELAY_AGENT_ROLLBACK_PROBE_TIMEOUT_MS, 30_000),
};

const logger = {
  info: (msg) => console.log(`[agent] ${msg}`),
  warn: (msg) => console.warn(`[agent] WARN: ${msg}`),
  error: (msg) => console.error(`[agent] ERROR: ${msg}`),
};

// ---------- real exec (docker / git / caddy shell-outs) ----------

function exec(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch { /* already gone */ } }, opts.timeoutMs)
      : null;
    child.stdout.on('data', (d) => { stdout = clip(stdout + d, 400_000); });
    child.stderr.on('data', (d) => { stderr = clip(stderr + d, 400_000); });
    const finish = (code, err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr: err ? `${stderr}\n${err}` : stderr, timedOut });
    };
    child.on('error', (e) => finish(-1, String(e)));
    child.on('close', (code) => finish(code));
  });
}

// ---------- real probe: any HTTP response = answering ----------

function tryOnce(port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: timeoutMs }, (res) => {
      res.resume(); // drain; status code irrelevant — listening is the fact we verify
      resolve(true);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

async function probe(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tryOnce(port, Math.min(3000, timeoutMs))) return { ok: true };
    await new Promise(r => setTimeout(r, 1500));
  }
  return { ok: false };
}

// ---------- agent + servers ----------

const agent = createAgent({ exec, fs, probe, env, logger });
await agent.boot();

const apiServer = http.createServer((req, res) => {
  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (c) => {
    size += c.length;
    if (size > 64 * 1024) { aborted = true; res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'body too large' })); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('error', () => { /* client went away */ });
  req.on('end', async () => {
    if (aborted) return;
    let body;
    if (chunks.length) {
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }
    }
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    let out;
    try {
      out = await agent.handleApiRequest({ method: req.method ?? 'GET', path, headers: req.headers, body });
    } catch (e) {
      logger.error(`handler error for ${req.method} ${path}: ${e?.stack ?? e}`);
      out = { status: 500, json: { error: 'internal agent error' } };
    }
    res.writeHead(out.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(out.json));
    logger.info(`${req.method} ${path} -> ${out.status}`);
  });
});

const askServer = http.createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const status = agent.handleAskRequest({ url: req.url ?? '/' });
  res.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
  res.end(status === 200 ? 'allowed' : 'denied');
});

apiServer.on('error', (e) => die(`cannot bind API port 127.0.0.1:${env.apiPort}: ${e.message}`));
askServer.on('error', (e) => die(`cannot bind ask port 127.0.0.1:${env.askPort}: ${e.message} (is the old python devrelay-ask.service still running?)`));

apiServer.listen(env.apiPort, '127.0.0.1', () => logger.info(`API listening on 127.0.0.1:${env.apiPort}`));
askServer.listen(env.askPort, '127.0.0.1', () => logger.info(`ask endpoint listening on 127.0.0.1:${env.askPort}`));

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received — closing servers (an in-flight build is marked failed on next boot)`);
  apiServer.close(() => process.exit(0));
  askServer.close(() => { /* closed */ });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
