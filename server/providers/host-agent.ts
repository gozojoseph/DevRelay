import { z } from 'zod';
import { config } from '../config.js';
import { ProviderFailure } from './types.js';

// DevRelay Cloud host agent (docs/hosting.md §Host agent API): the service on
// the hosting VPS that builds Git sources and runs one container per app.
// The client is the adapter seam — today it targets the documented HTTP
// contract; the H0 substrate decision (Coolify/Dokploy vs custom agent) only
// ever replaces this module, never the billing or job logic above it.
//
// Honesty rules, mirroring the SMS rails: an unreachable or uncertain agent
// answer is `ambiguous` (the deployment may still be running agent-side, so
// deploy jobs retry by re-POSTing the same idempotent deploymentId); only a
// definite 4xx is `rejected`; 429 is `retryable`.

const agentStateSchema = z.object({
  status: z.enum(['building', 'live', 'failed']),
  url: z.string().min(1).optional(),
  containerRef: z.string().min(1).optional(),
  error: z.string().max(240).optional(),
  logTail: z.string().max(20_000).optional(),
}).passthrough();

export type AgentDeploymentState = z.infer<typeof agentStateSchema>;

export interface DeployInput {
  deploymentId: string; appId: string; slug: string; name: string;
  repoUrl: string; repoToken?: string; branch: string;
  builder: 'dockerfile' | 'node'; plan: string;
  memoryMb: number; cpuMilli: number;
}

export interface HostAgentClient {
  /** Idempotent by deploymentId: re-POSTing returns the deployment's current state. */
  upsertDeployment(input: DeployInput): Promise<AgentDeploymentState>;
  getDeployment(deploymentId: string): Promise<AgentDeploymentState>;
  stopApp(appId: string): Promise<void>;
  startApp(appId: string): Promise<void>;
  deleteApp(appId: string): Promise<void>;
  logs(appId: string): Promise<{ tail: string }>;
}

async function call(path: string, init: RequestInit | undefined, parse: (body: unknown) => void): Promise<Response> {
  const c = config();
  if (!c.HOST_AGENT_URL || !c.HOST_AGENT_TOKEN) throw new ProviderFailure('rejected', 'HOSTING_NOT_CONFIGURED');
  let response: globalThis.Response;
  try {
    response = await fetch(`${c.HOST_AGENT_URL.replace(/\/+$/, '')}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${c.HOST_AGENT_TOKEN}`, Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new ProviderFailure('ambiguous', 'HOST_AGENT_TIMEOUT'); }
  if (response.status === 429) throw new ProviderFailure('retryable', 'HOST_AGENT_RATE_LIMITED');
  if (response.status >= 500) throw new ProviderFailure('ambiguous', 'HOST_AGENT_UNCERTAIN');
  if (!response.ok) throw new ProviderFailure('rejected', 'HOST_AGENT_REJECTED');
  if (parse) {
    try { parse(await response.json()); } catch { throw new ProviderFailure('ambiguous', 'HOST_AGENT_RESPONSE_UNCERTAIN'); }
  }
  return response;
}

export const httpHostAgent: HostAgentClient = {
  async upsertDeployment(input) {
    let state: AgentDeploymentState | undefined;
    await call('/deployments', {
      method: 'POST',
      body: JSON.stringify(input),
    }, body => { state = agentStateSchema.parse(body); });
    return state!;
  },

  async getDeployment(deploymentId) {
    let state: AgentDeploymentState | undefined;
    await call(`/deployments/${encodeURIComponent(deploymentId)}`, { method: 'GET' },
      body => { state = agentStateSchema.parse(body); });
    return state!;
  },

  async stopApp(appId) {
    await call(`/apps/${encodeURIComponent(appId)}/stop`, { method: 'POST' }, () => undefined);
  },

  async startApp(appId) {
    await call(`/apps/${encodeURIComponent(appId)}/start`, { method: 'POST' }, () => undefined);
  },

  async deleteApp(appId) {
    await call(`/apps/${encodeURIComponent(appId)}`, { method: 'DELETE' }, () => undefined);
  },

  async logs(appId) {
    let tail = '';
    await call(`/apps/${encodeURIComponent(appId)}/logs`, { method: 'GET' },
      body => { tail = z.object({ tail: z.string().max(20_000) }).passthrough().parse(body).tail; });
    return { tail };
  },
};
