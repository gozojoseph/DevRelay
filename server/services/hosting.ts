import { and, count, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import { db, type DbTransaction } from '../db/client.js';
import { accounts, appDeployments, hostedAppEnvVars, hostedAppEvents, hostedApps } from '../db/schema.js';
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

/**
 * Deployment failures arrive either as free human text from the agent (git/
 * docker/npm build output) or as a bare internal code from the worker itself
 * (e.g. HOSTING_NOT_CONFIGURED). Customers must never be shown a bare
 * ALL-CAPS code alone: codes are turned into a short honest sentence that
 * still names the code for support. Human text passes through untouched.
 */
const DEPLOYMENT_FAILURE_HINTS: Record<string, string> = {
  HOSTING_NOT_CONFIGURED: 'The deployment never started: the platform could not reach its hosting agent (platform configuration fault). Please retry in a few minutes.',
  HOST_AGENT_REJECTED: 'The hosting agent refused the deployment request. Please retry; if it repeats, contact support.',
  BUILD_FAILED: 'The build failed and the agent reported no detailed error.',
};

const BARE_CODE_RE = /^[A-Z][A-Z0-9_]{2,}$/;

export function humanizeDeploymentError(error: string): string {
  if (!BARE_CODE_RE.test(error)) return error;
  const hint = DEPLOYMENT_FAILURE_HINTS[error];
  return hint ? `${hint} (code ${error})`
    : `The deployment failed with error code ${error}. Please retry; if it repeats, contact support.`;
}

/**
 * Appends one lifecycle event to the app's customer-visible event feed. Events
 * are observability, not state: a recording failure is logged and swallowed so
 * it can never break a deploy, an action, or a billing sweep.
 */
export async function recordEvent(tx: DbTransaction | typeof db, params: {
  appId: string; accountId: string; kind: string; message: string; deploymentId?: string;
}) {
  try {
    await tx.insert(hostedAppEvents).values({
      appId: params.appId, accountId: params.accountId, kind: params.kind,
      message: params.message.slice(0, 300), deploymentId: params.deploymentId,
    });
  } catch (error) {
    console.error('hosting event insert failed', { kind: params.kind,
      name: error instanceof Error ? error.name : 'unknown' });
  }
}

// Per-app environment variables: encrypted at rest, never returned to the
// dashboard (only key names + timestamps), passed to the agent at deploy time
// over the authenticated channel. A change takes effect on the next deploy —
// running containers keep their baked-in env until then, which the UI states.
export const APP_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,119}$/;
export const APP_ENV_MAX_VARS = 50;

export async function listAppEnvVars(appId: string) {
  return db.select({ key: hostedAppEnvVars.key, updatedAt: hostedAppEnvVars.updatedAt })
    .from(hostedAppEnvVars).where(eq(hostedAppEnvVars.appId, appId)).orderBy(hostedAppEnvVars.key);
}

export async function setAppEnvVar(params: { app: typeof hostedApps.$inferSelect; key: string; value: string }) {
  assert(APP_ENV_KEY_RE.test(params.key), 400, 'INVALID_ENV_KEY',
    'Variable names start with a letter or underscore and use letters, digits and underscores only.');
  const [existing] = await db.select({ id: hostedAppEnvVars.id }).from(hostedAppEnvVars)
    .where(and(eq(hostedAppEnvVars.appId, params.app.id), eq(hostedAppEnvVars.key, params.key)));
  if (!existing) {
    const [totals] = await db.select({ n: count() }).from(hostedAppEnvVars)
      .where(eq(hostedAppEnvVars.appId, params.app.id));
    assert(Number(totals?.n ?? 0) < APP_ENV_MAX_VARS, 409, 'ENV_LIMIT',
      `Up to ${APP_ENV_MAX_VARS} environment variables per app.`);
  }
  await db.insert(hostedAppEnvVars).values({ appId: params.app.id, key: params.key,
    valueEncrypted: encrypt(params.value, `app-env:${params.app.id}:${params.key}`) })
    .onConflictDoUpdate({ target: [hostedAppEnvVars.appId, hostedAppEnvVars.key],
      set: { valueEncrypted: sql`excluded.value_encrypted`, updatedAt: new Date() } });
  await recordEvent(db, { appId: params.app.id, accountId: params.app.accountId, kind: 'env_changed',
    message: `Environment variable ${params.key} ${existing ? 'updated' : 'added'}; applies on the next deploy.` });
}

export async function deleteAppEnvVar(params: { app: typeof hostedApps.$inferSelect; key: string }) {
  const deleted = await db.delete(hostedAppEnvVars)
    .where(and(eq(hostedAppEnvVars.appId, params.app.id), eq(hostedAppEnvVars.key, params.key))).returning();
  if (deleted.length) {
    await recordEvent(db, { appId: params.app.id, accountId: params.app.accountId, kind: 'env_changed',
      message: `Environment variable ${params.key} removed; applies on the next deploy.` });
  }
}

/** Decrypts the app's env for a deploy; runs inside the deploy's try block so
 * a decryption failure (e.g. key rotation) becomes an honest retry, not a lie. */
async function loadAppEnvForDeploy(appId: string): Promise<Record<string, string>> {
  const rows = await db.select({ key: hostedAppEnvVars.key, valueEncrypted: hostedAppEnvVars.valueEncrypted })
    .from(hostedAppEnvVars).where(eq(hostedAppEnvVars.appId, appId));
  const env: Record<string, string> = {};
  for (const row of rows) env[row.key] = decrypt(row.valueEncrypted, `app-env:${appId}:${row.key}`);
  return env;
}

/** The app's lifecycle feed, newest first. */
export async function listAppEvents(appId: string) {
  return db.select({ id: hostedAppEvents.id, kind: hostedAppEvents.kind, message: hostedAppEvents.message,
    deploymentId: hostedAppEvents.deploymentId, createdAt: hostedAppEvents.createdAt })
    .from(hostedAppEvents).where(eq(hostedAppEvents.appId, appId)).orderBy(desc(hostedAppEvents.createdAt)).limit(50);
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
    await recordEvent(tx, { appId: app.id, accountId: input.accountId, kind: 'app_created',
      message: `App created; ${plan.label} plan charged in advance.` });
    const [deployment] = await tx.insert(appDeployments).values({ appId: app.id, ref: input.branch }).returning();
    await chargePlan(tx, { accountId: input.accountId, appId: app.id, plan, expiresAt });
    await enqueue(tx, { kind: 'app.deploy', dedupKey: `app.deploy:${deployment!.id}`,
      payload: { deploymentId: deployment!.id }, accountId: input.accountId, projectId: input.projectId,
      maxAttempts: 40 });
    await recordEvent(tx, { appId: app.id, accountId: input.accountId, kind: 'deploy_queued',
      message: `First deploy queued for branch ${input.branch}.`, deploymentId: deployment!.id });
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
    const env = await loadAppEnvForDeploy(app.id);
    const state = await httpHostAgent.upsertDeployment({
      deploymentId: deployment.id, appId: app.id, slug: app.slug, name: app.name,
      repoUrl: app.repoUrl, repoToken, branch: deployment.ref, builder: app.builder as 'dockerfile' | 'node',
      plan: plan.id, memoryMb: plan.memoryMb, cpuMilli: plan.cpuMilli,
      env: Object.keys(env).length ? env : undefined,
    });
    if (state.status === 'building') {
      if (state.logTail) {
        await db.update(appDeployments).set({ buildLogTail: state.logTail }).where(eq(appDeployments.id, deployment.id));
      }
      if (deployment.status === 'queued') {
        await recordEvent(db, { appId: app.id, accountId: app.accountId, kind: 'deploy_building',
          message: `Build started for branch ${deployment.ref}.`, deploymentId: deployment.id });
      }
      return { done: false, retry: true, code: 'APP_BUILD_IN_PROGRESS' };
    }
    if (state.status === 'live') {
      const liveUrl = state.url ?? fallbackUrl(app.slug) ?? null;
      await db.update(appDeployments).set({ status: 'live', finishedAt: new Date(),
        buildLogTail: state.logTail ?? null, error: null }).where(eq(appDeployments.id, deployment.id));
      await db.update(hostedApps).set({ status: 'live', url: liveUrl,
        containerRef: state.containerRef ?? app.containerRef, currentDeploymentId: deployment.id,
        lastError: null, updatedAt: new Date() }).where(eq(hostedApps.id, app.id));
      // Exactly-once by construction: line 252 early-returns for deployments
      // already 'live' or 'failed', so this path only runs for a
      // queued/building deployment reaching live.
      await recordEvent(db, { appId: app.id, accountId: app.accountId, kind: 'deploy_live',
        message: liveUrl ? `Deployment live at ${liveUrl}.` : 'Deployment live.', deploymentId: deployment.id });
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
  const message = humanizeDeploymentError(error).slice(0, 240);
  await db.update(appDeployments).set({ status: 'failed', error: message,
    finishedAt: new Date(), buildLogTail: logTail ?? null }).where(eq(appDeployments.id, deploymentId));
  await recordEvent(db, { appId: app.id, accountId: app.accountId, kind: 'deploy_failed',
    message, deploymentId });
  // A failed redeploy must not take the previously live container down.
  if (app.status !== 'live') {
    await db.update(hostedApps).set({ status: 'failed', lastError: message, updatedAt: new Date() })
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
    await recordEvent(db, { appId: app.id, accountId: app.accountId, kind: 'app_stopped',
      message: 'App stopped; the container is paused, not serving traffic.' });
  } else if (action === 'start') {
    await db.update(hostedApps).set({ status: 'live', lastError: null, updatedAt: new Date() }).where(eq(hostedApps.id, app.id));
    await recordEvent(db, { appId: app.id, accountId: app.accountId, kind: 'app_started',
      message: 'App started; the container is serving again.' });
  } else {
    await db.update(hostedApps).set({ status: 'deleted', updatedAt: new Date() }).where(eq(hostedApps.id, app.id));
    await recordEvent(db, { appId: app.id, accountId: app.accountId, kind: 'app_deleted',
      message: 'App deleted; container removed and billing stopped.' });
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
        await recordEvent(tx, { appId: current.id, accountId: current.accountId, kind: 'plan_renewed',
          message: `Plan renewed through ${newExpiry.toISOString().slice(0, 10)}.` });
        if (current.status === 'paused_no_funds') {
          await recordEvent(tx, { appId: current.id, accountId: current.accountId, kind: 'plan_resumed',
            message: 'Renewal succeeded; the paused app resumes.' });
        }
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
          await recordEvent(db, { appId: app.id, accountId: app.accountId, kind: 'plan_paused',
            message: 'Plan renewal failed (insufficient credits); the app is paused until the wallet is funded.' });
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
