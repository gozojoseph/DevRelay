import { and, eq, inArray, lte, ne } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, type DbTransaction } from '../db/client.js';
import { accounts, appDeployments, hostedApps } from '../db/schema.js';
import { config } from '../config.js';
import { ApiError, assert } from '../lib/http.js';
import { decrypt, encrypt } from '../lib/security.js';
import { transfer } from './ledger.js';
import { enqueue } from './jobs.js';
import { httpHostAgent } from '../providers/host-agent.js';
import { ProviderFailure } from '../providers/types.js';

// DevRelay Cloud (docs/hosting.md): hosted customer apps. Billing is a monthly
// plan charged IN ADVANCE from the GHS wallet — no balance, no app (paused
// apps show `paused_no_funds` honestly and resume automatically once a renewal
// charge succeeds). Plan prices are PLACEHOLDERS until the user sets final
// numbers: the plumbing never invents charges, it only applies the catalog.

export const hostingPlans = {
  starter: { id: 'starter', label: 'Starter', memoryMb: 256, cpuMilli: 250, priceMinor: 5_000 },
  standard: { id: 'standard', label: 'Standard', memoryMb: 512, cpuMilli: 500, priceMinor: 9_000 },
} as const;

export type HostingPlan = (typeof hostingPlans)[keyof typeof hostingPlans];
export const PLAN_PERIOD_DAYS = 30;

export function getPlan(plan: string): HostingPlan {
  const match = (hostingPlans as Record<string, HostingPlan | undefined>)[plan];
  assert(match, 400, 'INVALID_PLAN', `Unknown plan. Available: ${Object.keys(hostingPlans).join(', ')}.`);
  return match;
}

function slugify(name: string) {
  const base = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-+|-+$/g, '').slice(0, 24) || 'app';
  return `${base}-${randomBytes(4).toString('hex')}`;
}

function fallbackUrl(slug: string) {
  const domain = config().HOSTING_BASE_DOMAIN;
  return domain ? `https://${slug}.${domain}` : undefined;
}

async function chargePlan(tx: DbTransaction, params: { accountId: string; appId: string; plan: HostingPlan; expiresAt: Date }) {
  const reference = `hosting:${params.appId}:${params.expiresAt.toISOString().slice(0, 10)}`;
  try {
    await transfer(tx, { accountId: params.accountId, from: 'customer_available', to: 'platform_revenue',
      value: params.plan.priceMinor, kind: 'hosting_subscription', reference,
      description: `${params.plan.label} hosting plan (30 days)` });
  } catch (error) {
    // A never-funded account has no wallet rows at all — same honest answer.
    if (error instanceof ApiError && error.code === 'WALLET_MISSING') {
      throw new ApiError(402, 'INSUFFICIENT_CREDITS', 'Not enough messaging credits for the hosting plan. Add funds first.');
    }
    throw error;
  }
}

/** Creates the app + first deployment and charges the first month in advance. */
export async function createHostingApp(input: {
  accountId: string; projectId: string; name: string; repoUrl: string;
  repoToken?: string; branch: string; builder: 'dockerfile' | 'node'; plan: string;
}) {
  const c = config();
  if (!c.HOST_AGENT_URL || !c.HOST_AGENT_TOKEN) {
    throw new ApiError(503, 'HOSTING_NOT_CONFIGURED', 'App hosting is not available yet. Contact support.');
  }
  const plan = getPlan(input.plan);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, input.accountId));
  assert(account, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
  assert(account.status === 'active', 403, 'ACCOUNT_NOT_ACTIVE', 'Account must be active to host apps.');
  const slug = slugify(input.name);
  const [slugTaken] = await db.select({ id: hostedApps.id }).from(hostedApps).where(and(
    eq(hostedApps.slug, slug), ne(hostedApps.status, 'deleted')));
  assert(!slugTaken, 409, 'SLUG_TAKEN', 'That app name maps to a taken address. Pick another name.');
  const expiresAt = new Date(Date.now() + PLAN_PERIOD_DAYS * 86_400_000);
  const appId = randomUUID();
  return db.transaction(async tx => {
    const [app] = await tx.insert(hostedApps).values({
      id: appId, accountId: input.accountId, projectId: input.projectId, name: input.name, slug,
      builder: input.builder, repoUrl: input.repoUrl,
      repoTokenEncrypted: input.repoToken ? encrypt(input.repoToken, `app-repo:${appId}`) : null,
      branch: input.branch, plan: plan.id, planStartedAt: new Date(), planExpiresAt: expiresAt,
    }).returning();
    assert(app, 500, 'APP_CREATE_FAILED', 'Could not create the app.');
    const [deployment] = await tx.insert(appDeployments).values({ appId: app.id, ref: input.branch }).returning();
    await chargePlan(tx, { accountId: input.accountId, appId: app.id, plan, expiresAt });
    await enqueue(tx, { kind: 'app.deploy', dedupKey: `app.deploy:${deployment!.id}`,
      payload: { deploymentId: deployment!.id }, accountId: input.accountId, projectId: input.projectId,
      maxAttempts: 40 });
    return { app: app!, deploymentId: deployment!.id };
  });
}

/** Queues a redeploy. Deploys themselves are free in v1; the plan is what bills. */
export async function redeployApp(params: { accountId: string; projectId: string; appId: string; ref?: string }) {
  const [app] = await db.select().from(hostedApps).where(and(eq(hostedApps.id, params.appId),
    eq(hostedApps.accountId, params.accountId), eq(hostedApps.projectId, params.projectId),
    ne(hostedApps.status, 'deleted')));
  assert(app, 404, 'APP_NOT_FOUND', 'App not found.');
  const [deployment] = await db.insert(appDeployments).values({
    appId: app.id, ref: params.ref ?? app.branch,
  }).returning();
  await db.transaction(async tx => {
    await enqueue(tx, { kind: 'app.deploy', dedupKey: `app.deploy:${deployment!.id}`,
      payload: { deploymentId: deployment!.id }, accountId: params.accountId, projectId: params.projectId,
      maxAttempts: 40 });
  });
  return { deploymentId: deployment!.id };
}

function queueAppAction(params: { accountId: string; appId: string; action: 'stop' | 'start' | 'delete' }) {
  return db.transaction(async tx => {
    await enqueue(tx, { kind: `app.${params.action}`, dedupKey: `app.${params.action}:${params.appId}:${randomBytes(6).toString('hex')}`,
      payload: { appId: params.appId }, accountId: params.accountId });
  });
}

export async function stopHostingApp(accountId: string, appId: string) {
  await assertAppOwned(accountId, appId, ['live', 'failed', 'paused_no_funds']);
  await queueAppAction({ accountId, appId, action: 'stop' });
}

export async function startHostingApp(accountId: string, appId: string) {
  await assertAppOwned(accountId, appId, ['paused_manual', 'paused_no_funds']);
  await queueAppAction({ accountId, appId, action: 'start' });
}

export async function deleteHostingApp(accountId: string, appId: string) {
  await assertAppOwned(accountId, appId, undefined);
  await queueAppAction({ accountId, appId, action: 'delete' });
}

async function assertAppOwned(accountId: string, appId: string, allowedStatuses: string[] | undefined) {
  const [app] = await db.select({ status: hostedApps.status }).from(hostedApps).where(and(
    eq(hostedApps.id, appId), eq(hostedApps.accountId, accountId), ne(hostedApps.status, 'deleted')));
  assert(app, 404, 'APP_NOT_FOUND', 'App not found.');
  if (allowedStatuses && !allowedStatuses.includes(app.status)) {
    throw new ApiError(409, 'APP_STATE_CONFLICT', `App is ${app.status}; that action is not available now.`);
  }
}

/**
 * Runs one deployment through the host agent. The agent upsert is idempotent
 * by deploymentId, so retries after an ambiguous timeout re-POST and read the
 * deployment's real state instead of guessing. A failed redeploy never stops
 * the previously live container.
 */
export async function processAppDeploy(deploymentId: string) {
  const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId));
  if (!deployment || deployment.status === 'live' || deployment.status === 'failed') return { done: true };
  const [app] = await db.select().from(hostedApps).where(eq(hostedApps.id, deployment.appId));
  if (!app || app.status === 'deleted') return { done: true };
  if (deployment.status === 'queued') {
    await db.update(appDeployments).set({ status: 'building', startedAt: new Date() }).where(eq(appDeployments.id, deployment.id));
    if (app.status === 'pending' || app.status === 'failed') {
      await db.update(hostedApps).set({ status: 'building', updatedAt: new Date() }).where(eq(hostedApps.id, app.id));
    }
  }
  const repoToken = app.repoTokenEncrypted ? decrypt(app.repoTokenEncrypted, `app-repo:${app.id}`) : undefined;
  const plan = getPlan(app.plan);
  try {
    const state = await httpHostAgent.upsertDeployment({
      deploymentId: deployment.id, appId: app.id, slug: app.slug, name: app.name,
      repoUrl: app.repoUrl, repoToken, branch: deployment.ref, builder: app.builder as 'dockerfile' | 'node',
      plan: plan.id, memoryMb: plan.memoryMb, cpuMilli: plan.cpuMilli,
    });
    if (state.status === 'building') {
      if (state.logTail) {
        await db.update(appDeployments).set({ buildLogTail: state.logTail }).where(eq(appDeployments.id, deployment.id));
      }
      return { done: false, retry: true, code: 'APP_BUILD_IN_PROGRESS' };
    }
    if (state.status === 'live') {
      await db.update(appDeployments).set({ status: 'live', finishedAt: new Date(),
        buildLogTail: state.logTail ?? null, error: null }).where(eq(appDeployments.id, deployment.id));
      await db.update(hostedApps).set({ status: 'live', url: state.url ?? fallbackUrl(app.slug) ?? null,
        containerRef: state.containerRef ?? app.containerRef, currentDeploymentId: deployment.id,
        lastError: null, updatedAt: new Date() }).where(eq(hostedApps.id, app.id));
      return { done: true };
    }
    return await failDeployment(deployment.id, app, state.error ?? 'BUILD_FAILED', state.logTail);
  } catch (error) {
    if (error instanceof ProviderFailure) {
      if (error.kind === 'retryable' || error.kind === 'ambiguous') {
        return { done: false, retry: true, code: error.publicCode };
      }
      return await failDeployment(deployment.id, app, error.publicCode);
    }
    return { done: false, retry: true, code: 'APP_DEPLOY_ERROR' };
  }
}

async function failDeployment(deploymentId: string, app: typeof hostedApps.$inferSelect, error: string, logTail?: string) {
  await db.update(appDeployments).set({ status: 'failed', error: error.slice(0, 240),
    finishedAt: new Date(), buildLogTail: logTail ?? null }).where(eq(appDeployments.id, deploymentId));
  // A failed redeploy must not take the previously live container down.
  if (app.status !== 'live') {
    await db.update(hostedApps).set({ status: 'failed', lastError: error.slice(0, 240), updatedAt: new Date() })
      .where(eq(hostedApps.id, app.id));
  }
  return { done: true };
}

/** Runs a stop/start/delete against the agent and mirrors the honest DB state. */
export async function processAppAction(appId: string, action: 'stop' | 'start' | 'delete') {
  const [app] = await db.select().from(hostedApps).where(eq(hostedApps.id, appId));
  if (!app || app.status === 'deleted') return { done: true };
  try {
    if (action === 'stop') await httpHostAgent.stopApp(app.id);
    else if (action === 'start') await httpHostAgent.startApp(app.id);
    else await httpHostAgent.deleteApp(app.id);
  } catch (error) {
    if (error instanceof ProviderFailure) {
      if (error.kind === 'rejected') return { done: false, dead: true, code: error.publicCode };
      return { done: false, retry: true, code: error.publicCode };
    }
    return { done: false, retry: true, code: 'APP_ACTION_ERROR' };
  }
  if (action === 'stop') {
    const next = app.status === 'paused_no_funds' ? 'paused_no_funds' : 'paused_manual';
    await db.update(hostedApps).set({ status: next, updatedAt: new Date() }).where(eq(hostedApps.id, app.id));
  } else if (action === 'start') {
    await db.update(hostedApps).set({ status: 'live', lastError: null, updatedAt: new Date() }).where(eq(hostedApps.id, app.id));
  } else {
    await db.update(hostedApps).set({ status: 'deleted', updatedAt: new Date() }).where(eq(hostedApps.id, app.id));
  }
  return { done: true };
}

/**
 * Renewal sweep (worker calls this every few minutes, like payment
 * reconciliation): charge each app whose plan expires within 3 days, in
 * advance, for the next 30-day period. Success resumes `paused_no_funds`
 * apps; failure pauses `live` apps honestly. The ledger reference (one per
 * app per period) makes every charge idempotent.
 */
export async function renewDueHostingApps() {
  const horizon = new Date(Date.now() + 3 * 86_400_000);
  const due = await db.select().from(hostedApps).where(and(
    inArray(hostedApps.status, ['live', 'paused_no_funds', 'paused_manual']),
    lte(hostedApps.planExpiresAt, horizon)));
  let charged = 0, paused = 0;
  for (const app of due) {
    const plan = (hostingPlans as Record<string, HostingPlan | undefined>)[app.plan];
    if (!plan) continue;
    const now = Date.now();
    const base = app.planExpiresAt && app.planExpiresAt.getTime() > now ? app.planExpiresAt.getTime() : now;
    const newExpiry = new Date(base + PLAN_PERIOD_DAYS * 86_400_000);
    try {
      await db.transaction(async tx => {
        const [current] = await tx.select().from(hostedApps).where(eq(hostedApps.id, app.id)).for('update');
        if (!current || current.status === 'deleted') return;
        if (current.planExpiresAt && current.planExpiresAt.getTime() >= newExpiry.getTime()) return; // already renewed
        await chargePlan(tx, { accountId: current.accountId, appId: current.id, plan, expiresAt: newExpiry });
        await tx.update(hostedApps).set({ planExpiresAt: newExpiry, status: current.status === 'paused_manual' ? 'paused_manual' : 'live',
          lastError: null, updatedAt: new Date() }).where(eq(hostedApps.id, current.id));
      });
      charged += 1;
      if (app.status === 'paused_no_funds') {
        await queueAppAction({ accountId: app.accountId, appId: app.id, action: 'start' }).catch(() => undefined);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'INSUFFICIENT_CREDITS') {
        if (app.status === 'live') {
          await db.update(hostedApps).set({ status: 'paused_no_funds',
            lastError: 'PLAN_RENEWAL_INSUFFICIENT_CREDITS', updatedAt: new Date() }).where(eq(hostedApps.id, app.id));
          await queueAppAction({ accountId: app.accountId, appId: app.id, action: 'stop' }).catch(() => undefined);
          paused += 1;
        }
        continue;
      }
      throw error;
    }
  }
  return { charged, paused };
}
