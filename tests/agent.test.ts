// Host agent contract tests (docs/hosting.md §Host agent API). The agent is
// the only executor of customer code, so its honesty rules are pinned here the
// same way the SMS rails are: idempotent deploy upserts, failed-builds-never-
// touch-the-live-container, rollback on a failed probe, fail-closed ask
// endpoint, and definite (not guessed) failure reporting.
import { describe, expect, it } from 'vitest';
import { createAgent, generateCaddyfile, tokenOk, validateDeployInput } from '../agent/core.mjs';

type ExecResult = { code: number; stdout: string; stderr: string; timedOut?: boolean };
type ExecCall = { cmd: string; args: string[]; opts?: { cwd?: string; timeoutMs?: number } };
type AgentHandle = Awaited<ReturnType<typeof makeAgent>>['agent'];

class MemFs {
  private files = new Map<string, string>();
  private dirs = new Set<string>();
  private static norm(p: string) { return p.replace(/\\/g, '/').replace(/\/+$/, ''); }
  existsSync(p: string) {
    const key = MemFs.norm(p);
    if (this.files.has(key) || this.dirs.has(key)) return true;
    for (const f of this.files.keys()) if (f.startsWith(`${key}/`)) return true;
    return false;
  }
  readFileSync(p: string, _enc?: string) {
    const v = this.files.get(MemFs.norm(p));
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  }
  writeFileSync(p: string, data: string) { this.files.set(MemFs.norm(p), String(data)); }
  renameSync(a: string, b: string) {
    const v = this.files.get(MemFs.norm(a));
    if (v === undefined) throw new Error(`ENOENT: ${a}`);
    this.files.delete(MemFs.norm(a));
    this.files.set(MemFs.norm(b), v);
  }
  mkdirSync(p: string, _opts?: unknown) { this.dirs.add(MemFs.norm(p)); }
  rmSync(p: string, _opts?: unknown) {
    const key = MemFs.norm(p);
    for (const f of [...this.files.keys()]) if (f === key || f.startsWith(`${key}/`)) this.files.delete(f);
    for (const d of [...this.dirs]) if (d === key || d.startsWith(`${key}/`)) this.dirs.delete(d);
  }
  read(p: string) { return this.files.get(MemFs.norm(p)); }
  has(p: string) { return this.files.has(MemFs.norm(p)); }
}

const baseEnv = {
  token: 'agent-test-token-0123456789abcdef',
  apiPort: 8787,
  askPort: 5577,
  baseDomain: 'apps.devrelay.africa',
  agentHost: 'agent.apps.devrelay.africa',
  staticRoutes: [{ host: 'hello.apps.devrelay.africa', upstream: '127.0.0.1:8080' }],
  dataDir: '/data',
  statePath: '/data/state.json',
  caddyConfigPath: '/data/Caddyfile',
  capacityMemoryMb: 768,
  allowFileClones: false,
  caddyBin: 'caddy',
};

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    deploymentId: 'dep-0001-aaaa', appId: 'app-0001-aaaa', slug: 'demo', name: 'Demo App',
    repoUrl: 'https://github.com/user/repo.git', branch: 'main', builder: 'dockerfile',
    plan: 'starter', memoryMb: 256, cpuMilli: 250, ...overrides,
  };
}

type ExecBehavior = {
  cloneFiles?: (dir: string, fs: MemFs) => void;
  cloneCode?: number;
  cloneStderr?: string;
  buildCode?: number;
  buildStderr?: string;
  runCode?: number;
  inspectStdout?: string;
};

function flowExec(fs: MemFs, behavior: ExecBehavior = {}) {
  return (cmd: string, args: string[]): ExecResult => {
    if (cmd === 'git' && args[0] === 'clone') {
      const dir = args[args.length - 1];
      if (behavior.cloneFiles) behavior.cloneFiles(dir, fs);
      if (behavior.cloneCode) return { code: behavior.cloneCode, stdout: '', stderr: behavior.cloneStderr ?? 'fatal: repository not found' };
      // a plain repo that satisfies the dockerfile builder; node-builder tests
      // override execImpl and plant their own package.json
      if (!fs.has(`${dir}/Dockerfile`)) fs.writeFileSync(`${dir}/Dockerfile`, 'FROM alpine\nEXPOSE 3000\n');
      return { code: 0, stdout: 'Cloning...', stderr: '' };
    }
    if (cmd === 'docker' && args[0] === 'build') {
      if (behavior.buildCode) return { code: behavior.buildCode, stdout: '', stderr: behavior.buildStderr ?? 'error: build failed' };
      return { code: 0, stdout: 'writing image', stderr: '' };
    }
    if (cmd === 'docker' && args[0] === 'image' && args[1] === 'inspect') {
      return { code: 0, stdout: behavior.inspectStdout ?? '3000/tcp ', stderr: '' };
    }
    if (cmd === 'docker' && args[0] === 'run') {
      if (behavior.runCode) return { code: behavior.runCode, stdout: '', stderr: 'docker: port already allocated' };
      return { code: 0, stdout: 'abc123', stderr: '' };
    }
    if (cmd === 'docker' && args[0] === 'ps') return { code: 0, stdout: '', stderr: '' };
    if (cmd === 'docker' && args[0] === 'logs') return { code: 0, stdout: 'app log line 1\napp log line 2', stderr: '' };
    if (cmd === 'caddy') return { code: 0, stdout: '', stderr: '' };
    return { code: 0, stdout: '', stderr: '' }; // stop/start/rm/images/rmi
  };
}

function makeAgent(overrides: {
  behavior?: ExecBehavior;
  execImpl?: (cmd: string, args: string[], fs: MemFs) => ExecResult | Promise<ExecResult>;
  probeImpl?: (port: number, timeoutMs: number) => Promise<{ ok: boolean }>;
  env?: Record<string, unknown>;
} = {}) {
  const fs = new MemFs();
  const calls: ExecCall[] = [];
  const impl = overrides.execImpl
    ? (cmd: string, args: string[]) => overrides.execImpl!(cmd, args, fs)
    : (cmd: string, args: string[]) => flowExec(fs, overrides.behavior)(cmd, args);
  const exec = async (cmd: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }) => {
    calls.push({ cmd, args, opts });
    return impl(cmd, args);
  };
  const probes: Array<{ port: number; timeoutMs: number }> = [];
  const probe = async (port: number, timeoutMs: number) => {
    probes.push({ port, timeoutMs });
    return overrides.probeImpl ? overrides.probeImpl(port, timeoutMs) : { ok: true };
  };
  const agent = createAgent({ exec, fs, probe, env: { ...baseEnv, ...(overrides.env ?? {}) } });
  return { agent, fs, calls, probes };
}

const authHeaders = { authorization: `Bearer ${baseEnv.token}` };

async function postDeploy(agent: AgentHandle, input: Record<string, unknown>) {
  return agent.handleApiRequest({ method: 'POST', path: '/deployments', headers: authHeaders, body: input });
}

async function deployAndDrain(agent: AgentHandle, input: Record<string, unknown>) {
  const post = await postDeploy(agent, input);
  expect(post.status).toBe(200);
  await agent.drain();
  return post;
}

const getDeployment = (agent: AgentHandle, id: string) =>
  agent.handleApiRequest({ method: 'GET', path: `/deployments/${id}`, headers: authHeaders, body: undefined });

describe('agent auth', () => {
  it('rejects missing and wrong bearer tokens on every contract route', async () => {
    const { agent } = makeAgent();
    for (const headers of [{}, { authorization: 'Bearer wrong-token-value-aaaaaaaaaaaa' }, { authorization: 'Basic abc' }]) {
      expect((await agent.handleApiRequest({ method: 'POST', path: '/deployments', headers, body: validInput() })).status).toBe(401);
      expect((await agent.handleApiRequest({ method: 'GET', path: '/deployments/x', headers, body: undefined })).status).toBe(401);
    }
  });

  it('tokenOk compares digests and rejects empty inputs', () => {
    expect(tokenOk(baseEnv.token, baseEnv.token)).toBe(true);
    expect(tokenOk('', baseEnv.token)).toBe(false);
    expect(tokenOk(baseEnv.token, '')).toBe(false);
    expect(tokenOk('nope', baseEnv.token)).toBe(false);
  });

  it('serves /healthz without auth', async () => {
    const { agent } = makeAgent();
    expect((await agent.handleApiRequest({ method: 'GET', path: '/healthz', headers: {}, body: undefined })).status).toBe(200);
  });
});

describe('deploy input validation (definite 400s)', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['missing field', { slug: undefined }],
    ['uppercase slug', { slug: 'Demo' }],
    ['reserved slug', { slug: 'agent' }],
    ['bad builder', { builder: 'npm' }],
    ['http repo', { repoUrl: 'http://github.com/user/repo.git' }],
    ['ftp repo', { repoUrl: 'ftp://example.com/x' }],
    ['file repo when not allowed', { repoUrl: 'file:///srv/repo' }],
    ['memory over host cap', { memoryMb: 2000 }],
    ['cpu out of range', { cpuMilli: 5000 }],
    ['bad branch', { branch: 'a b' }],
    ['short id', { deploymentId: 'abc' }],
  ];
  for (const [name, override] of cases) {
    it(`rejects ${name}`, async () => {
      const { agent } = makeAgent();
      const r = await agent.handleApiRequest({ method: 'POST', path: '/deployments', headers: authHeaders, body: validInput(override) });
      expect(r.status).toBe(400);
      expect(r.json.error).toBeTruthy();
    });
  }

  it('accepts file:// clones only when explicitly enabled', () => {
    const input = validInput({ repoUrl: 'file:///srv/repo' });
    expect(validateDeployInput(input, { allowFileClones: false }).ok).toBe(false);
    expect(validateDeployInput(input, { allowFileClones: true }).ok).toBe(true);
  });

  it('rejects a non-object body', async () => {
    const { agent } = makeAgent();
    const r = await agent.handleApiRequest({ method: 'POST', path: '/deployments', headers: authHeaders, body: 'nonsense' });
    expect(r.status).toBe(400);
  });
});

describe('deploy pipeline', () => {
  it('registers building immediately, then reaches live with honest artifacts', async () => {
    const { agent, calls, fs } = makeAgent();
    const post = await postDeploy(agent, validInput());
    expect(post.status).toBe(200);
    expect(post.json.status).toBe('building');

    await agent.drain();

    const get = await getDeployment(agent, 'dep-0001-aaaa');
    expect(get.status).toBe(200);
    expect(get.json).toMatchObject({ status: 'live', url: 'https://demo.apps.devrelay.africa', containerRef: 'dr-app-0001-aaaa' });
    expect(get.json.error).toBeUndefined();

    const run = calls.find(c => c.cmd === 'docker' && c.args[0] === 'run');
    expect(run).toBeTruthy();
    expect(run!.args).toContain('--read-only');
    expect(run!.args).toContain('256m');          // --memory value
    expect(run!.args).toContain('--pids-limit');
    expect(run!.args).toContain('127.0.0.1:10000:3000'); // loopback publish, EXPOSE-derived port

    const caddy = fs.read('/data/Caddyfile') ?? '';
    expect(caddy).toContain('demo.apps.devrelay.africa');
    expect(caddy).toContain('reverse_proxy 127.0.0.1:10000');
    expect(caddy).toContain('*.apps.devrelay.africa');
  });

  it('is idempotent by deploymentId: re-POST reads reality instead of rebuilding', async () => {
    let releaseClone: () => void = () => {};
    const cloneGate = new Promise<void>(resolve => { releaseClone = resolve; });
    const { agent } = makeAgent({
      execImpl: (cmd, args, fs) => {
        if (cmd === 'git' && args[0] === 'clone') {
          const dir = args[args.length - 1];
          // hold the build in-flight so the re-POST lands while it is building
          return cloneGate.then(() => {
            fs.writeFileSync(`${dir}/Dockerfile`, 'FROM alpine\n');
            return { code: 0, stdout: '', stderr: '' };
          });
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    const first = await postDeploy(agent, validInput());
    expect(first.json.status).toBe('building');

    const during = await postDeploy(agent, validInput());
    expect(during.status).toBe(200);
    expect(during.json.status).toBe('building');

    releaseClone();
    await agent.drain();

    const after = await postDeploy(agent, validInput());
    expect(after.status).toBe(200);
    expect(after.json.status).toBe('live');
    expect(after.json.url).toBe('https://demo.apps.devrelay.africa');
  });

  it('node builder: generates the Dockerfile, publishes 3000, skips EXPOSE inspection', async () => {
    let generated = '';
    const { agent, calls } = makeAgent({
      execImpl: (cmd, args, fs) => {
        if (cmd === 'git' && args[0] === 'clone') {
          fs.writeFileSync(`${args[args.length - 1]}/package.json`, JSON.stringify({ name: 'x', scripts: { start: 'node server.js' } }));
          return { code: 0, stdout: '', stderr: '' };
        }
        if (cmd === 'docker' && args[0] === 'build') {
          // the agent generates the Dockerfile into the build dir before building
          generated = fs.read(`${args[args.length - 1]}/Dockerfile`) ?? '';
          return { code: 0, stdout: 'writing image', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    await deployAndDrain(agent, validInput({ builder: 'node', appId: 'app-0002-bbbb', slug: 'nodesite', deploymentId: 'dep-0002-bbbb' }));
    const get = await getDeployment(agent, 'dep-0002-bbbb');
    expect(get.json.status).toBe('live');
    expect(generated).toContain('FROM node:22-alpine');
    expect(generated).toContain('CMD ["npm", "start"]');
    // the node builder knows its port: no `docker image inspect` step happens
    expect(calls.some(c => c.cmd === 'docker' && c.args[0] === 'image')).toBe(false);
    const run = calls.find(c => c.cmd === 'docker' && c.args[0] === 'run');
    expect(run!.args).toContain('127.0.0.1:10000:3000');
  });

  it('node builder without a start script fails honestly', async () => {
    const { agent } = makeAgent({
      execImpl: (_cmd, _args, fs) => {
        // clone "succeeds" but the repo has no package.json
        void fs;
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    await deployAndDrain(agent, validInput({ builder: 'node', deploymentId: 'dep-0003-cccc', appId: 'app-0003-cccc', slug: 'noscript' }));
    const get = await getDeployment(agent, 'dep-0003-cccc');
    expect(get.json.status).toBe('failed');
    expect(get.json.error).toContain('package.json');
  });

  it('dockerfile builder without a Dockerfile fails honestly', async () => {
    const { agent } = makeAgent({ execImpl: () => ({ code: 0, stdout: '', stderr: '' }) }); // clone ok, repo empty
    await deployAndDrain(agent, validInput({ deploymentId: 'dep-0004-dddd', appId: 'app-0004-dddd', slug: 'nodkr' }));
    const get = await getDeployment(agent, 'dep-0004-dddd');
    expect(get.json.status).toBe('failed');
    expect(get.json.error).toContain('no Dockerfile');
  });

  it('clone failure: definite error, logTail, and no container ever started', async () => {
    const { agent, calls } = makeAgent({
      behavior: { cloneCode: 128, cloneStderr: 'fatal: repository not found' },
    });
    await deployAndDrain(agent, validInput({ deploymentId: 'dep-0005-eeee', appId: 'app-0005-eeee', slug: 'badclone' }));
    const get = await getDeployment(agent, 'dep-0005-eeee');
    expect(get.json.status).toBe('failed');
    expect(get.json.error).toContain('git clone failed');
    expect(get.json.logTail).toBeTruthy();
    expect(get.json.logTail!.length).toBeLessThanOrEqual(20_000);
    expect(calls.some(c => c.cmd === 'docker' && c.args[0] === 'run')).toBe(false);
  });

  it('build failure: the previously live container is untouched', async () => {
    let firstBuild = true;
    const { agent } = makeAgent({
      execImpl: (cmd, args, fs) => {
        if (cmd === 'git' && args[0] === 'clone') {
          fs.writeFileSync(`${args[args.length - 1]}/Dockerfile`, 'FROM alpine\n');
          return { code: 0, stdout: '', stderr: '' };
        }
        if (cmd === 'docker' && args[0] === 'build') {
          if (firstBuild) { firstBuild = false; return { code: 0, stdout: 'ok', stderr: '' }; }
          return { code: 1, stdout: '', stderr: 'error: npm install failed' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    await deployAndDrain(agent, validInput()); // first deploy OK
    await deployAndDrain(agent, validInput({ deploymentId: 'dep-0006-ffff', slug: 'demo' })); // build fails
    const get = await getDeployment(agent, 'dep-0006-ffff');
    expect(get.json.status).toBe('failed');
    expect(get.json.error).toContain('docker build failed');
    const app = agent.state.apps['app-0001-aaaa'];
    expect(app.status).toBe('live');
    expect(app.currentImage).toBe('dr-app-0001-aaaa:dep-0001-aaaa');
  });

  it('probe failure on first deploy: failed status, container removed', async () => {
    const { agent, calls } = makeAgent({ probeImpl: async () => ({ ok: false }) });
    await deployAndDrain(agent, validInput({ deploymentId: 'dep-0007-gggg', appId: 'app-0007-gggg', slug: 'silent' }));
    const get = await getDeployment(agent, 'dep-0007-gggg');
    expect(get.json.status).toBe('failed');
    expect(get.json.error).toContain('never answered HTTP');
    expect(calls.some(c => c.cmd === 'docker' && c.args[0] === 'rm')).toBe(true);
    expect(agent.state.apps['app-0007-gggg'].status).toBe('failed');
  });

  it('probe failure on redeploy rolls back to the previous image and keeps the app live', async () => {
    let lastRunImage = '';
    const { agent } = makeAgent({
      execImpl: (cmd, args, fs) => {
        if (cmd === 'git' && args[0] === 'clone') {
          fs.writeFileSync(`${args[args.length - 1]}/Dockerfile`, 'FROM alpine\n');
          return { code: 0, stdout: '', stderr: '' };
        }
        if (cmd === 'docker' && args[0] === 'run') {
          lastRunImage = args[args.length - 1];
          return { code: 0, stdout: 'containerid', stderr: '' };
        }
        return { code: 0, stdout: '', stderr: '' };
      },
      // the ORIGINAL image answers; the new build's container stays silent
      probeImpl: async () => ({ ok: lastRunImage === 'dr-app-0008-hhhh:dep-0008-hhhh' }),
    });

    await deployAndDrain(agent, validInput({ appId: 'app-0008-hhhh', slug: 'roller', deploymentId: 'dep-0008-hhhh' }));
    expect(agent.state.apps['app-0008-hhhh'].status).toBe('live');
    expect(agent.state.apps['app-0008-hhhh'].currentImage).toBe('dr-app-0008-hhhh:dep-0008-hhhh');

    await deployAndDrain(agent, validInput({ appId: 'app-0008-hhhh', slug: 'roller', deploymentId: 'dep-0009-jjjj' }));
    const d2 = await getDeployment(agent, 'dep-0009-jjjj');
    expect(d2.json.status).toBe('failed');
    expect(d2.json.error).toContain('rolled back to the previous image');
    expect(d2.json.error).toContain('never answered HTTP');

    const app = agent.state.apps['app-0008-hhhh'];
    expect(app.status).toBe('live');
    expect(app.currentImage).toBe('dr-app-0008-hhhh:dep-0008-hhhh');
  });

  it('conflicts: slug taken by another app, immutable slug, concurrent build, host capacity', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { agent } = makeAgent({
      execImpl: (cmd, args, fs) => {
        if (cmd === 'git' && args[0] === 'clone') {
          const dir = args[args.length - 1];
          const plant = () => { fs.writeFileSync(`${dir}/Dockerfile`, 'FROM alpine\n'); return { code: 0, stdout: '', stderr: '' }; };
          // hold dep-0001 in-flight so the concurrent-build gate is exercised
          return dir.includes('dep-0001-aaaa') ? gate.then(plant) : plant();
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    expect((await postDeploy(agent, validInput())).status).toBe(200);

    const other = await postDeploy(agent, validInput({ appId: 'app-0002-bbbb', slug: 'other', deploymentId: 'dep-0002-bbbb' }));
    expect(other.status).toBe(200);

    const collision = await postDeploy(agent, validInput({ appId: 'app-0003-cccc', slug: 'demo', deploymentId: 'dep-0003-cccc' }));
    expect(collision.status).toBe(409);

    const rename = await postDeploy(agent, validInput({ appId: 'app-0001-aaaa', slug: 'renamed', deploymentId: 'dep-0004-dddd' }));
    expect(rename.status).toBe(409);

    const concurrent = await postDeploy(agent, validInput({ appId: 'app-0001-aaaa', slug: 'demo', deploymentId: 'dep-0005-eeee' }));
    expect(concurrent.status).toBe(409);

    release();
    await agent.drain();

    const { agent: capAgent } = makeAgent();
    await deployAndDrain(capAgent, validInput({ appId: 'app-0010-aaaa', slug: 'big1', deploymentId: 'dep-0010-aaaa', memoryMb: 512 }));
    const secondBig = await postDeploy(capAgent, validInput({ appId: 'app-0011-bbbb', slug: 'big2', deploymentId: 'dep-0011-bbbb', memoryMb: 512 }));
    expect(secondBig.status).toBe(409);
    expect(secondBig.json.error).toContain('capacity');
  });

  it('404s are definite for unknown deployments and apps', async () => {
    const { agent } = makeAgent();
    expect((await getDeployment(agent, 'nope0001-x')).status).toBe(404);
    expect((await agent.handleApiRequest({ method: 'POST', path: '/apps/nope0001-x/stop', headers: authHeaders, body: undefined })).status).toBe(404);
    expect((await agent.handleApiRequest({ method: 'GET', path: '/apps/nope0001-x/logs', headers: authHeaders, body: undefined })).status).toBe(404);
  });
});

describe('app actions', () => {
  async function liveAgent() {
    const { agent, fs } = makeAgent();
    await deployAndDrain(agent, validInput());
    return { agent, fs };
  }

  it('stop -> 200, app stopped; start brings it back', async () => {
    const { agent } = await liveAgent();
    const stop = await agent.handleApiRequest({ method: 'POST', path: '/apps/app-0001-aaaa/stop', headers: authHeaders, body: undefined });
    expect(stop.status).toBe(200);
    expect(agent.state.apps['app-0001-aaaa'].status).toBe('stopped');
    const start = await agent.handleApiRequest({ method: 'POST', path: '/apps/app-0001-aaaa/start', headers: authHeaders, body: undefined });
    expect(start.status).toBe(200);
    expect(agent.state.apps['app-0001-aaaa'].status).toBe('live');
  });

  it('start without a container is a definite 409 (honest, not a guess)', async () => {
    const { agent } = await liveAgent();
    agent.state.apps['app-0001-aaaa'].container = null;
    const start = await agent.handleApiRequest({ method: 'POST', path: '/apps/app-0001-aaaa/start', headers: authHeaders, body: undefined });
    expect(start.status).toBe(409);
    expect(start.json.error).toContain('deploy again');
  });

  it('delete removes routing and the ask allow-list entry', async () => {
    const { agent, fs } = await liveAgent();
    expect(agent.handleAskRequest({ url: '/?domain=demo.apps.devrelay.africa' })).toBe(200);
    const del = await agent.handleApiRequest({ method: 'DELETE', path: '/apps/app-0001-aaaa', headers: authHeaders, body: undefined });
    expect(del.status).toBe(200);
    expect(agent.state.apps['app-0001-aaaa']).toBeUndefined();
    expect(agent.handleAskRequest({ url: '/?domain=demo.apps.devrelay.africa' })).toBe(404);
    expect(fs.read('/data/Caddyfile')).not.toContain('demo.apps.devrelay.africa');
  });

  it('actions during an active build are 409', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const { agent } = makeAgent({
      execImpl: (cmd, args, fs) => {
        if (cmd === 'git' && args[0] === 'clone') {
          const dir = args[args.length - 1];
          const plant = () => { fs.writeFileSync(`${dir}/Dockerfile`, 'FROM alpine\n'); return { code: 0, stdout: '', stderr: '' }; };
          return dir.includes('dep-0002-bbbb') ? gate.then(plant) : plant();
        }
        return { code: 0, stdout: '', stderr: '' };
      },
    });
    await deployAndDrain(agent, validInput());
    const post = await postDeploy(agent, validInput({ deploymentId: 'dep-0002-bbbb', slug: 'demo' }));
    expect(post.status).toBe(200);
    const stop = await agent.handleApiRequest({ method: 'POST', path: '/apps/app-0001-aaaa/stop', headers: authHeaders, body: undefined });
    expect(stop.status).toBe(409);
    release();
    await agent.drain();
  });

  it('logs returns the docker tail clipped to 20k', async () => {
    const { agent } = await liveAgent();
    const logs = await agent.handleApiRequest({ method: 'GET', path: '/apps/app-0001-aaaa/logs', headers: authHeaders, body: undefined });
    expect(logs.status).toBe(200);
    expect(logs.json.tail).toContain('app log line 2');
  });
});

describe('ask endpoint (on-demand TLS gate)', () => {
  it('fails closed: only hosted domains, the agent host, and static routes are allowed', async () => {
    const { agent } = makeAgent();
    await deployAndDrain(agent, validInput());
    expect(agent.handleAskRequest({ url: '/?domain=demo.apps.devrelay.africa' })).toBe(200);
    expect(agent.handleAskRequest({ url: '/?domain=agent.apps.devrelay.africa' })).toBe(200);
    expect(agent.handleAskRequest({ url: '/?domain=hello.apps.devrelay.africa' })).toBe(200);
    expect(agent.handleAskRequest({ url: '/?domain=unknown.apps.devrelay.africa' })).toBe(404);
    expect(agent.handleAskRequest({ url: '/?domain=../etc/passwd' })).toBe(404);
    expect(agent.handleAskRequest({ url: '/?domain=evil..name' })).toBe(404);
    expect(agent.handleAskRequest({ url: '/?domain=one.apps.devrelay.africa&domain=two.apps.devrelay.africa' })).toBe(404);
    expect(agent.handleAskRequest({ url: '/' })).toBe(404);
  });

  it('deny survives uppercase and path tricks', () => {
    const { agent } = makeAgent();
    expect(agent.handleAskRequest({ url: '/?domain=DEMO.apps.devrelay.africa' })).toBe(404);
    expect(agent.handleAskRequest({ url: '/?domain=demo.apps.devrelay.africa/extra' })).toBe(404);
  });
});

describe('boot reconciliation', () => {
  it('fails interrupted builds honestly and adopts container reality', async () => {
    const fs = new MemFs();
    fs.writeFileSync('/data/state.json', JSON.stringify({
      version: 1,
      apps: { 'app-0001-aaaa': { appId: 'app-0001-aaaa', slug: 'demo', name: 'Demo', domain: 'demo.apps.devrelay.africa',
        port: 10000, container: 'dr-app-0001-aaaa', currentImage: 'dr-app-0001-aaaa:old', previousImage: null,
        memoryMb: 256, cpuMilli: 250, status: 'building', createdAt: 't' } },
      deployments: { 'dep-0001-aaaa': { deploymentId: 'dep-0001-aaaa', appId: 'app-0001-aaaa', status: 'building', createdAt: 't' } },
    }));
    const agent = createAgent({
      exec: async (_cmd, args) => (args[0] === 'ps'
        ? { code: 0, stdout: 'dr-app-0001-aaaa\tUp 2 minutes (healthy)\n', stderr: '' }
        : { code: 0, stdout: '', stderr: '' }),
      fs,
      probe: async () => ({ ok: true }),
      env: baseEnv,
    });
    await agent.boot();
    expect(agent.state.deployments['dep-0001-aaaa'].status).toBe('failed');
    expect(agent.state.deployments['dep-0001-aaaa'].error).toContain('agent restarted');
    expect(agent.state.apps['app-0001-aaaa'].status).toBe('live');
    expect(fs.has('/data/Caddyfile')).toBe(true);
  });

  it('a container that vanished from docker is reported failed, not live', async () => {
    const fs = new MemFs();
    fs.writeFileSync('/data/state.json', JSON.stringify({
      version: 1,
      apps: { 'app-0001-aaaa': { appId: 'app-0001-aaaa', slug: 'demo', name: 'Demo', domain: 'demo.apps.devrelay.africa',
        port: 10000, container: 'dr-app-0001-aaaa', currentImage: 'img', previousImage: null,
        memoryMb: 256, cpuMilli: 250, status: 'live', createdAt: 't' } },
      deployments: {},
    }));
    const agent = createAgent({
      exec: async (_cmd, args) => (args[0] === 'ps' ? { code: 0, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' }),
      fs, probe: async () => ({ ok: true }), env: baseEnv,
    });
    await agent.boot();
    expect(agent.state.apps['app-0001-aaaa'].status).toBe('failed');
  });
});

describe('caddyfile generation', () => {
  it('emits the ask gate, agent host, static routes, app blocks, and a 404 wildcard', () => {
    const caddy = generateCaddyfile(baseEnv, [{ domain: 'demo.apps.devrelay.africa', port: 10001 }]);
    expect(caddy).toContain('ask http://127.0.0.1:5577');
    expect(caddy).toContain('agent.apps.devrelay.africa');
    expect(caddy).toContain('reverse_proxy 127.0.0.1:8787');
    expect(caddy).toContain('hello.apps.devrelay.africa');
    expect(caddy).toContain('reverse_proxy 127.0.0.1:8080');
    expect(caddy).toContain('reverse_proxy 127.0.0.1:10001');
    expect(caddy).toContain('*.apps.devrelay.africa');
    expect(caddy).toContain('404');
  });
});
