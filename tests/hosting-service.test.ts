import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { closeTestDb, ensureTestDb, getTestDb, resetTestDb, type TestDb } from './helpers/db.js';
import { seedAccount, seedLedgerWallets, seedProject } from './helpers/seed.js';
// Config must see the agent settings before the first import of the service.
process.env.HOST_AGENT_URL = 'http://127.0.0.1:9400';
process.env.HOST_AGENT_TOKEN = 'host-agent-test-token';
process.env.HOSTING_BASE_DOMAIN = 'apps.devrelay.test';

const mocks = vi.hoisted(() => ({
  upsertDeployment: vi.fn(),
  stopApp: vi.fn(),
  startApp: vi.fn(),
  deleteApp: vi.fn(),
  logs: vi.fn(),
}));

vi.mock('../server/providers/host-agent.js', () => ({
  httpHostAgent: {
    upsertDeployment: mocks.upsertDeployment,
    getDeployment: mocks.upsertDeployment,
    stopApp: mocks.stopApp,
    startApp: mocks.startApp,
    deleteApp: mocks.deleteApp,
    logs: mocks.logs,
  },
}));

vi.mock('../server/db/client.js', async () => {
  const harness = await import('./helpers/db.js');
  return { pool: {}, closeDb: async () => {}, db: harness.getTestDb() };
});

import { appDeployments, hostedAppEnvVars, hostedApps, jobs, ledgerAccounts, ledgerTransactions } from '../server/db/schema.js';
import { createHostingApp, deleteAppEnvVar, listAppEnvVars, listAppEvents, processAppAction, processAppDeploy, renewDueHostingApps, setAppEnvVar } from '../server/services/hosting.js';

beforeAll(ensureTestDb, 120_000);
beforeEach(() => {
  return resetTestDb();
});
afterAll(closeTestDb);

const createInput = {
  name: 'Clinic Reminders', repoUrl: 'https://github.com/example/app.git',
  branch: 'main', builder: 'node' as const, plan: 'starter',
};

async function seedWorld(db: TestDb, options: { availableMinor?: number } = {}) {
  const account = await seedAccount(db);
  await seedLedgerWallets(db, account.id, options.availableMinor ?? 100_000);
  const project = await seedProject(db, account.id);
  return { account, project };
}

async function wallet(db: TestDb, accountId: string, kind: string) {
  const rows = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.accountId, accountId));
  return rows.find(r => r.kind === kind)?.balanceMinor ?? 0;
}

describe('createHostingApp', () => {
  it('charges the first month in advance and queues the first deployment', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const { app, deploymentId } = await createHostingApp({ accountId: account.id, projectId: project.id, ...createInput });
    expect(app.status).toBe('pending');
    expect(app.slug).toMatch(/^clinic-reminders-[0-9a-f]{8}$/);
    expect(app.planExpiresAt).toBeInstanceOf(Date);
    const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId));
    expect(deployment?.status).toBe('queued');
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupKey, `app.deploy:${deploymentId}`));
    expect(job?.kind).toBe('app.deploy');
    // 100.00 GHS wallet − 50.00 GHS starter plan (placeholder price)
    expect(await wallet(db, account.id, 'customer_available')).toBe(95_000);
    const [tx] = await db.select().from(ledgerTransactions).where(eq(ledgerTransactions.kind, 'hosting_subscription'));
    expect(tx?.reference).toBe(`hosting:${app.id}:${app.planExpiresAt!.toISOString().slice(0, 10)}`);
  });

  it('refuses with 402 and creates nothing when the wallet cannot cover the plan', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db, { availableMinor: 100 });
    await expect(createHostingApp({ accountId: account.id, projectId: project.id, ...createInput }))
      .rejects.toMatchObject({ status: 402, code: 'INSUFFICIENT_CREDITS' });
    expect((await db.select().from(hostedApps)).length).toBe(0);
    expect((await db.select().from(jobs)).length).toBe(0);
  });

  it('rejects unknown plans with the available list', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    await expect(createHostingApp({ accountId: account.id, projectId: project.id, ...createInput, plan: 'mega' }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_PLAN' });
  });
});

describe('processAppDeploy', () => {
  async function seedApp(db: TestDb, overrides: Partial<typeof hostedApps.$inferInsert> = {}) {
    const { account, project } = await seedWorld(db);
    const { app, deploymentId } = await createHostingApp({ accountId: account.id, projectId: project.id, ...createInput });
    let row = app;
    if (Object.keys(overrides).length > 0) {
      const [updated] = await db.update(hostedApps).set(overrides).where(eq(hostedApps.id, app.id)).returning();
      row = updated!;
    }
    return { account, app: row, deploymentId };
  }

  it('marks the app live with the agent URL when the deployment succeeds', async () => {
    const db = getTestDb();
    mocks.upsertDeployment.mockResolvedValue({ status: 'live', url: 'https://x.example.test', containerRef: 'c-1' });
    const { app, deploymentId } = await seedApp(db);
    const outcome = await processAppDeploy(deploymentId);
    expect(outcome).toEqual({ done: true });
    const [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('live');
    expect(after?.url).toBe('https://x.example.test');
    expect(after?.currentDeploymentId).toBe(deploymentId);
    const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId));
    expect(deployment?.status).toBe('live');
  });

  it('keeps polling while the agent reports the build in progress', async () => {
    const db = getTestDb();
    mocks.upsertDeployment.mockResolvedValue({ status: 'building', logTail: 'npm ci' });
    const { deploymentId } = await seedApp(db);
    const outcome = await processAppDeploy(deploymentId);
    expect(outcome).toMatchObject({ done: false, retry: true });
    const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId));
    expect(deployment?.status).toBe('building');
    expect(deployment?.buildLogTail).toBe('npm ci');
  });

  it('fails the app honestly when the build fails, and never touches a live app', async () => {
    const db = getTestDb();
    mocks.upsertDeployment.mockResolvedValue({ status: 'failed', error: 'npm ERR! missing script' });
    const { app, deploymentId } = await seedApp(db);
    await processAppDeploy(deploymentId);
    let [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('failed');
    expect(after?.lastError).toBe('npm ERR! missing script');

    // A failed REdeploy on a live app keeps the old container serving.
    await db.update(hostedApps).set({ status: 'live', url: 'https://old.example.test' }).where(eq(hostedApps.id, app.id));
    const [redeployment] = await db.insert(appDeployments).values({ appId: app.id, ref: 'main' }).returning();
    await processAppDeploy(redeployment!.id);
    [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('live');
    expect(after?.url).toBe('https://old.example.test');
    const [failedDeployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, redeployment!.id));
    expect(failedDeployment?.status).toBe('failed');
  });

  it('retries on ambiguous agent answers without inventing a final state', async () => {
    const db = getTestDb();
    mocks.upsertDeployment.mockRejectedValue(new (await import('../server/providers/types.js')).ProviderFailure('ambiguous', 'HOST_AGENT_TIMEOUT'));
    const { deploymentId } = await seedApp(db);
    const outcome = await processAppDeploy(deploymentId);
    expect(outcome).toMatchObject({ done: false, retry: true, code: 'HOST_AGENT_TIMEOUT' });
    const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId));
    expect(deployment?.status).toBe('building'); // still honestly in flight
  });

  it('stores bare platform codes as a human sentence that keeps the code', async () => {
    const db = getTestDb();
    mocks.upsertDeployment.mockRejectedValue(new (await import('../server/providers/types.js')).ProviderFailure('rejected', 'HOSTING_NOT_CONFIGURED'));
    const { app, deploymentId } = await seedApp(db);
    await processAppDeploy(deploymentId);
    const [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('failed');
    expect(after?.lastError).toContain('HOSTING_NOT_CONFIGURED');
    expect(after?.lastError).toContain('hosting agent');
    expect(after?.lastError).not.toBe('HOSTING_NOT_CONFIGURED'); // never a bare code
    const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId));
    expect(deployment?.error).toBe(after?.lastError);
    expect(deployment?.status).toBe('failed');
  });

  it('maps unknown bare codes to an honest generic sentence', async () => {
    const db = getTestDb();
    mocks.upsertDeployment.mockResolvedValue({ status: 'failed', error: 'FUTURE_AGENT_CODE' });
    const { app, deploymentId } = await seedApp(db);
    await processAppDeploy(deploymentId);
    const [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('failed');
    expect(after?.lastError).toContain('FUTURE_AGENT_CODE');
    expect(after?.lastError).not.toBe('FUTURE_AGENT_CODE');
  });
});

describe('processAppAction', () => {
  async function seedLiveApp(db: TestDb) {
    const { account, project } = await seedWorld(db);
    const { app, deploymentId } = await createHostingApp({ accountId: account.id, projectId: project.id, ...createInput });
    mocks.upsertDeployment.mockResolvedValue({ status: 'live', url: 'https://x.example.test', containerRef: 'c-1' });
    await processAppDeploy(deploymentId);
    const [live] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    return { account, app: live! };
  }

  it('stops and restarts, mirroring the paused state honestly', async () => {
    const db = getTestDb();
    const { app } = await seedLiveApp(db);
    await processAppAction(app.id, 'stop');
    let [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('paused_manual');
    await processAppAction(app.id, 'start');
    [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('live');
  });

  it('deletes the app and keeps the row for history', async () => {
    const db = getTestDb();
    const { app } = await seedLiveApp(db);
    await processAppAction(app.id, 'delete');
    const [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('deleted');
  });

  it('lets a rejected agent answer kill the job without lying about app state', async () => {
    const db = getTestDb();
    const { app } = await seedLiveApp(db);
    mocks.stopApp.mockRejectedValue(new (await import('../server/providers/types.js')).ProviderFailure('rejected', 'HOST_AGENT_REJECTED'));
    const outcome = await processAppAction(app.id, 'stop');
    expect(outcome).toMatchObject({ done: false, dead: true });
    const [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('live'); // unchanged — the stop never happened
  });
});

describe('renewDueHostingApps', () => {
  it('charges due apps, extends the period, and resumes unfunded pauses', async () => {
    const db = getTestDb();
    const { account } = await seedWorld(db);
    const { app, deploymentId } = await createHostingApp({ accountId: account.id, projectId: (await seedProject(db, account.id)).id, ...createInput });
    mocks.upsertDeployment.mockResolvedValue({ status: 'live', url: 'https://x.example.test' });
    await processAppDeploy(deploymentId);
    await db.update(hostedApps).set({ status: 'paused_no_funds', planExpiresAt: new Date(Date.now() + 2 * 86_400_000) })
      .where(eq(hostedApps.id, app.id));

    const result = await renewDueHostingApps();
    expect(result).toEqual({ charged: 1, paused: 0 });
    const [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('live');
    expect(after!.planExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 25 * 86_400_000);
    // A paused app resumed by renewal needs its container started again.
    const startJobs = await db.select().from(jobs).where(eq(jobs.kind, 'app.start'));
    expect(startJobs.length).toBe(1);
  });

  it('pauses a live app honestly when the wallet cannot cover renewal', async () => {
    const db = getTestDb();
    const { account } = await seedWorld(db);
    const { app, deploymentId } = await createHostingApp({ accountId: account.id, projectId: (await seedProject(db, account.id)).id, ...createInput });
    mocks.upsertDeployment.mockResolvedValue({ status: 'live', url: 'https://x.example.test' });
    await processAppDeploy(deploymentId);
    await db.update(hostedApps).set({ planExpiresAt: new Date(Date.now() + 2 * 86_400_000) }).where(eq(hostedApps.id, app.id));
    await db.update(ledgerAccounts).set({ balanceMinor: 0 }).where(eq(ledgerAccounts.accountId, account.id));

    const result = await renewDueHostingApps();
    expect(result).toEqual({ charged: 0, paused: 1 });
    const [after] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    expect(after?.status).toBe('paused_no_funds');
    expect(after?.lastError).toBe('PLAN_RENEWAL_INSUFFICIENT_CREDITS');
    const stopJobs = await db.select().from(jobs).where(eq(jobs.kind, 'app.stop'));
    expect(stopJobs.length).toBe(1);
  });

  it('never double-charges the same period', async () => {
    const db = getTestDb();
    const { account } = await seedWorld(db);
    const { app } = await createHostingApp({ accountId: account.id, projectId: (await seedProject(db, account.id)).id, ...createInput });
    await db.update(hostedApps).set({ status: 'live', planExpiresAt: new Date(Date.now() + 2 * 86_400_000) })
      .where(eq(hostedApps.id, app.id));
    await renewDueHostingApps();
    const balanceAfterFirst = await wallet(db, account.id, 'customer_available');
    await renewDueHostingApps();
    expect(await wallet(db, account.id, 'customer_available')).toBe(balanceAfterFirst);
  });
});

describe('app event feed', () => {
  async function seedLiveApp(db: TestDb) {
    const { account, project } = await seedWorld(db);
    const { app, deploymentId } = await createHostingApp({ accountId: account.id, projectId: project.id, ...createInput });
    mocks.upsertDeployment.mockResolvedValue({ status: 'live', url: 'https://x.example.test', containerRef: 'c-1' });
    // vi.fn implementations persist across tests in a file; make the agent
    // mocks explicitly happy here regardless of what earlier tests set.
    mocks.stopApp.mockResolvedValue(undefined);
    mocks.startApp.mockResolvedValue(undefined);
    mocks.deleteApp.mockResolvedValue(undefined);
    await processAppDeploy(deploymentId);
    const [live] = await db.select().from(hostedApps).where(eq(hostedApps.id, app.id));
    return { account, app: live!, events: () => listAppEvents(app.id) };
  }

  it('records app_created and deploy_queued at create time', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const { app, deploymentId } = await createHostingApp({ accountId: account.id, projectId: project.id, ...createInput });
    const events = await listAppEvents(app.id);
    expect(new Set(events.map(e => e.kind))).toEqual(new Set(['app_created', 'deploy_queued']));
    const queued = events.find(e => e.kind === 'deploy_queued')!;
    expect(queued.deploymentId).toBe(deploymentId);
    expect(queued.message).toContain('main');
  });

  it('records deploy_live with the URL when the deployment succeeds', async () => {
    const db = getTestDb();
    const { app, events } = await seedLiveApp(db);
    const live = (await events()).find(e => e.kind === 'deploy_live')!;
    expect(live).toBeTruthy();
    expect(live.message).toContain('https://x.example.test');
    expect(live.deploymentId).toBe(app.currentDeploymentId);
  });

  it('records deploy_failed with the humanized message, never a bare code', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const { app, deploymentId } = await createHostingApp({ accountId: account.id, projectId: project.id, ...createInput });
    mocks.upsertDeployment.mockResolvedValue({ status: 'failed', error: 'HOST_AGENT_TIMEOUT' });
    await processAppDeploy(deploymentId);
    const failed = (await listAppEvents(app.id)).find(e => e.kind === 'deploy_failed')!;
    expect(failed).toBeTruthy();
    expect(failed.message).toContain('HOST_AGENT_TIMEOUT');
    expect(failed.message).not.toBe('HOST_AGENT_TIMEOUT'); // the event carries the human sentence
    expect(failed.deploymentId).toBe(deploymentId);
  });

  it('records stop, start and delete actions', async () => {
    const db = getTestDb();
    const { app, events } = await seedLiveApp(db);
    await processAppAction(app.id, 'stop');
    await processAppAction(app.id, 'start');
    await processAppAction(app.id, 'delete');
    const kinds = (await events()).map(e => e.kind);
    for (const kind of ['app_stopped', 'app_started', 'app_deleted']) expect(kinds).toContain(kind);
  });

  it('records renewal, resume and honest pause events from the sweep', async () => {
    const db = getTestDb();
    const { account } = await seedWorld(db);
    const { app, deploymentId } = await createHostingApp({ accountId: account.id, projectId: (await seedProject(db, account.id)).id, ...createInput });
    mocks.upsertDeployment.mockResolvedValue({ status: 'live', url: 'https://x.example.test' });
    await processAppDeploy(deploymentId);
    await db.update(hostedApps).set({ status: 'paused_no_funds', planExpiresAt: new Date(Date.now() + 2 * 86_400_000) })
      .where(eq(hostedApps.id, app.id));
    await renewDueHostingApps();
    let kinds = (await listAppEvents(app.id)).map(e => e.kind);
    for (const kind of ['plan_renewed', 'plan_resumed']) expect(kinds).toContain(kind);

    // A live app whose wallet runs dry pauses with an honest event.
    const { app: app2, deploymentId: deployment2 } = await createHostingApp({ accountId: account.id, projectId: (await seedProject(db, account.id)).id, ...createInput });
    await processAppDeploy(deployment2);
    await db.update(hostedApps).set({ planExpiresAt: new Date(Date.now() + 2 * 86_400_000) }).where(eq(hostedApps.id, app2.id));
    await db.update(ledgerAccounts).set({ balanceMinor: 0 }).where(eq(ledgerAccounts.accountId, account.id));
    await renewDueHostingApps();
    kinds = (await listAppEvents(app2.id)).map(e => e.kind);
    expect(kinds).toContain('plan_paused');
  });
});

describe('app environment variables', () => {
  async function seedApp(db: TestDb) {
    const { account, project } = await seedWorld(db);
    const { app } = await createHostingApp({ accountId: account.id, projectId: project.id, ...createInput });
    return { account, app };
  }

  it('encrypts at rest and lists only key names and timestamps', async () => {
    const db = getTestDb();
    const { app } = await seedApp(db);
    await setAppEnvVar({ app, key: 'API_KEY', value: 'super-secret-value' });
    const [row] = await db.select().from(hostedAppEnvVars)
      .where(and(eq(hostedAppEnvVars.appId, app.id), eq(hostedAppEnvVars.key, 'API_KEY')));
    expect(row).toBeTruthy();
    expect(row!.valueEncrypted).not.toContain('super-secret-value');
    expect(row!.valueEncrypted.split('.')).toHaveLength(3); // iv.tag.payload

    const listed = await listAppEnvVars(app.id);
    expect(listed).toEqual([{ key: 'API_KEY', updatedAt: expect.anything() }]); // no value, ever
  });

  it('passes decrypted values to the agent on the next deploy and records env_changed', async () => {
    const db = getTestDb();
    const { account, project } = await seedWorld(db);
    const { app, deploymentId } = await createHostingApp({ accountId: account.id, projectId: project.id, ...createInput });
    mocks.upsertDeployment.mockResolvedValue({ status: 'live', url: 'https://x.example.test' });

    // No env yet: the deploy input carries no env values.
    await processAppDeploy(deploymentId);
    let call = mocks.upsertDeployment.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(call.env).toBeUndefined();

    await setAppEnvVar({ app, key: 'API_KEY', value: 'super-secret-value' });
    await setAppEnvVar({ app, key: 'NASTY', value: 'has=equals+and spaces' });
    const [redeployment] = await db.insert(appDeployments).values({ appId: app.id, ref: 'main' }).returning();
    await processAppDeploy(redeployment!.id);
    call = mocks.upsertDeployment.mock.calls.at(-1)![0] as Record<string, unknown>;
    expect(call.env).toEqual({ API_KEY: 'super-secret-value', NASTY: 'has=equals+and spaces' });

    const messages = (await listAppEvents(app.id)).filter(e => e.kind === 'env_changed').map(e => e.message);
    expect(messages.some(m => m.includes('API_KEY') && m.includes('added'))).toBe(true);
    expect(messages.some(m => m.includes('NASTY') && m.includes('added'))).toBe(true);
  });

  it('updates an existing key in place and says updated', async () => {
    const db = getTestDb();
    const { app } = await seedApp(db);
    await setAppEnvVar({ app, key: 'API_KEY', value: 'first' });
    await setAppEnvVar({ app, key: 'API_KEY', value: 'second' });
    const rows = await db.select().from(hostedAppEnvVars).where(eq(hostedAppEnvVars.appId, app.id));
    expect(rows).toHaveLength(1);
    const messages = (await listAppEvents(app.id)).filter(e => e.kind === 'env_changed').map(e => e.message);
    expect(messages.filter(m => m.includes('API_KEY')).some(m => m.includes('updated'))).toBe(true);
  });

  it('rejects bad keys with INVALID_ENV_KEY and the 51st variable with ENV_LIMIT', async () => {
    const db = getTestDb();
    const { app } = await seedApp(db);
    await expect(setAppEnvVar({ app, key: '9BAD-KEY', value: 'x' }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_ENV_KEY' });

    await db.insert(hostedAppEnvVars).values(Array.from({ length: 50 }, (_, i) => ({
      appId: app.id, key: `V_${i}`, valueEncrypted: 'x',
    })));
    await expect(setAppEnvVar({ app, key: 'ONE_TOO_MANY', value: 'x' }))
      .rejects.toMatchObject({ status: 409, code: 'ENV_LIMIT' });
    // Updating one of the existing 50 is still allowed — the limit caps new keys.
    await setAppEnvVar({ app, key: 'V_0', value: 'rotated' });
  });

  it('removes a variable with an event, and deleting a missing key is a silent no-op', async () => {
    const db = getTestDb();
    const { app } = await seedApp(db);
    await setAppEnvVar({ app, key: 'API_KEY', value: 'x' });
    await deleteAppEnvVar({ app, key: 'API_KEY' });
    expect(await listAppEnvVars(app.id)).toHaveLength(0);
    expect((await listAppEvents(app.id)).some(e => e.kind === 'env_changed' && e.message.includes('removed'))).toBe(true);

    const before = await listAppEvents(app.id);
    await deleteAppEnvVar({ app, key: 'NEVER_EXISTED' });
    expect(await listAppEvents(app.id)).toHaveLength(before.length); // no phantom event
  });
});
