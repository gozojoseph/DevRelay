import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The client reads config() lazily at call time; seed the agent settings
// before the first import so the cached config sees them.
process.env.HOST_AGENT_URL = 'http://127.0.0.1:9400/';
process.env.HOST_AGENT_TOKEN = 'host-agent-test-token';

const { httpHostAgent } = await import('../server/providers/host-agent.js');

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const deployInput = {
  deploymentId: 'dep-1', appId: 'app-1', slug: 'test-app', name: 'Test App',
  repoUrl: 'https://github.com/example/repo.git', branch: 'main',
  builder: 'node' as const, plan: 'starter', memoryMb: 256, cpuMilli: 250,
};

describe('host agent client', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('POSTs the deployment with the bearer token and returns a live state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      status: 'live', url: 'https://test-app.apps.example.test', containerRef: 'dr-test-app' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(httpHostAgent.upsertDeployment(deployInput)).resolves.toMatchObject({
      status: 'live', url: 'https://test-app.apps.example.test' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:9400/deployments');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer host-agent-test-token');
    expect(JSON.parse(String(init.body))).toMatchObject({ deploymentId: 'dep-1', slug: 'test-app' });
  });

  it('maps a building state through untouched (the deploy job keeps polling)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'building', logTail: 'npm ci' })));
    await expect(httpHostAgent.upsertDeployment(deployInput)).resolves.toMatchObject({ status: 'building' });
  });

  it('maps 4xx to a definite rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad repo' }, 400)));
    await expect(httpHostAgent.upsertDeployment(deployInput))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'HOST_AGENT_REJECTED' });
  });

  it('maps 429 to retryable and 5xx to ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 429)));
    await expect(httpHostAgent.stopApp('app-1')).rejects.toMatchObject({ kind: 'retryable' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(httpHostAgent.stopApp('app-1')).rejects.toMatchObject({ kind: 'ambiguous' });
  });

  it('treats a network failure as ambiguous (the agent may have accepted)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(httpHostAgent.upsertDeployment(deployInput))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'HOST_AGENT_TIMEOUT' });
  });

  it('treats an unparseable success body as ambiguous, never a guessed state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ totally: 'unexpected' })));
    await expect(httpHostAgent.upsertDeployment(deployInput))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'HOST_AGENT_RESPONSE_UNCERTAIN' });
  });

  it('fetches logs through the same contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ tail: 'listening on 3000' })));
    await expect(httpHostAgent.logs('app-1')).resolves.toEqual({ tail: 'listening on 3000' });
  });
});
