import { Router } from 'express';
import { and, desc, eq, lt, ne } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { appDeployments, hostedApps, messages, deliveryEvents } from '../db/schema.js';
import { ApiError, assert, ok } from '../lib/http.js';
import { requireApiKey, requireScope } from '../middleware/auth.js';
import { balance } from '../services/ledger.js';
import { apiRateLimit, sendSms, sendSmsSchema, sendWhatsapp, sendWhatsappSchema } from '../services/messaging.js';
import { hostingPlans, createHostingApp, redeployApp, stopHostingApp, startHostingApp, deleteHostingApp, getPlan } from '../services/hosting.js';
import { DOMAIN_TLDS, DOMAIN_YEAR_DAYS, DOMAIN_GRACE_DAYS, domainRegistrantSchema, createDomainOrder,
  lookupDomainAvailability, listDomainsForActor, getDomainForActor, setDomainAutoRenew, renewDomainNow } from '../services/domains.js';
import { httpHostAgent } from '../providers/host-agent.js';
import { ProviderFailure } from '../providers/types.js';

export const apiRouter = Router();
apiRouter.use(requireApiKey);

apiRouter.use(async (req, res, next) => {
  try {
    const key = req.apiActor!;
    const isWrite = req.method !== 'GET' && req.method !== 'HEAD';
    const rate = await apiRateLimit(key.keyId, isWrite ? 20 : 120);
    res.setHeader('RateLimit-Limit', String(rate.limit));
    res.setHeader('RateLimit-Remaining', String(rate.remaining));
    res.setHeader('RateLimit-Reset', String(rate.reset));
    res.setHeader('X-RateLimit-Limit', String(rate.limit));
    res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
    res.setHeader('X-RateLimit-Reset', String(rate.reset));
    if (rate.exceeded) throw new ApiError(429, 'RATE_LIMITED', 'Request rate limit exceeded.');
    next();
  } catch (error) { next(error); }
});

function idempotencyKey(req: import('express').Request) {
  return z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).parse(req.header('idempotency-key'));
}

apiRouter.post('/messages/sms', requireScope('messaging:send'), async (req, res) => {
  const key = idempotencyKey(req);
  const body = sendSmsSchema.parse(req.body);
  const result = await sendSms({ accountId: req.apiActor!.accountId, projectId: req.apiActor!.projectId, idempotencyKey: key, body });
  res.setHeader('Idempotency-Key', key);
  ok(req, res, result, 202);
});

apiRouter.post('/messages/whatsapp', requireScope('messaging:send'), async (req, res) => {
  const key = idempotencyKey(req);
  const body = sendWhatsappSchema.parse(req.body);
  const result = await sendWhatsapp({ accountId: req.apiActor!.accountId, projectId: req.apiActor!.projectId, idempotencyKey: key, body });
  res.setHeader('Idempotency-Key', key);
  ok(req, res, result, 202);
});

apiRouter.get('/messages', requireScope('messaging:read'), async (req, res) => {
  const query = z.object({ cursor: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(25),
    status: z.string().optional(), channel: z.enum(['sms', 'whatsapp']).optional() }).parse(req.query);
  const conditions = [eq(messages.projectId, req.apiActor!.projectId), eq(messages.accountId, req.apiActor!.accountId)];
  if (query.cursor) conditions.push(lt(messages.createdAt, new Date(query.cursor)));
  if (query.status) conditions.push(eq(messages.status, query.status as typeof messages.$inferSelect['status']));
  if (query.channel) conditions.push(eq(messages.channel, query.channel));
  const rows = await db.select({ id: messages.id, channel: messages.channel, recipient: messages.recipient,
    status: messages.status, segments: messages.segments, quotedMinor: messages.quotedMinor, chargedMinor: messages.chargedMinor,
    createdAt: messages.createdAt, updatedAt: messages.updatedAt, errorCode: messages.errorCode,
    templateName: messages.templateName }).from(messages).where(and(...conditions)).orderBy(desc(messages.createdAt)).limit(query.limit + 1);
  const next = rows.length > query.limit ? rows.pop()!.createdAt.toISOString() : null;
  ok(req, res, { items: rows.map(row => ({ ...row, currency: 'GHS' })), nextCursor: next });
});

apiRouter.get('/messages/:id', requireScope('messaging:read'), async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const [message] = await db.select().from(messages).where(and(eq(messages.id, id), eq(messages.projectId, req.apiActor!.projectId),
    eq(messages.accountId, req.apiActor!.accountId)));
  assert(message, 404, 'MESSAGE_NOT_FOUND', 'Message not found.');
  const events = await db.select({ status: deliveryEvents.status, occurredAt: deliveryEvents.occurredAt,
    createdAt: deliveryEvents.createdAt }).from(deliveryEvents).where(eq(deliveryEvents.messageId, id)).orderBy(deliveryEvents.createdAt);
  ok(req, res, { id: message.id, channel: message.channel, recipient: message.recipient, status: message.status,
    segments: message.segments, quotedMinor: message.quotedMinor, chargedMinor: message.chargedMinor, currency: 'GHS',
    templateName: message.templateName, errorCode: message.errorCode, createdAt: message.createdAt,
    acceptedAt: message.acceptedAt, events });
});

apiRouter.get('/balance', requireScope('messaging:read'), async (req, res) => {
  ok(req, res, { ...(await balance(req.apiActor!.accountId)), currency: 'GHS' });
});

// ── DevRelay Cloud: hosted apps (docs/hosting.md). Plans are charged monthly
// in advance from the GHS wallet; failed redeploys never stop a live container.
function agentErrorToApi(error: ProviderFailure): ApiError {
  if (error.publicCode === 'HOSTING_NOT_CONFIGURED') {
    return new ApiError(503, 'HOSTING_NOT_CONFIGURED', 'App hosting is not available yet. Contact support.');
  }
  if (error.kind === 'retryable') return new ApiError(429, 'HOST_AGENT_BUSY', 'The host agent is busy. Try again shortly.');
  return new ApiError(502, 'HOST_AGENT_ERROR', 'The host agent returned an error. Nothing was billed for this action.');
}

const createAppSchema = z.object({
  name: z.string().trim().min(2).max(60),
  repoUrl: z.string().trim().url().max(500).startsWith('https://'),
  repoToken: z.string().min(1).max(300).optional(),
  branch: z.string().trim().min(1).max(120).default('main'),
  builder: z.enum(['dockerfile', 'node']).default('node'),
  plan: z.string().trim().min(1).max(20),
});

apiRouter.get('/hosting/plans', requireScope('hosting:read'), async (req, res) => {
  ok(req, res, { currency: 'GHS', periodDays: 30, items: Object.values(hostingPlans) });
});

apiRouter.post('/apps', requireScope('hosting:write'), async (req, res) => {
  const body = createAppSchema.parse(req.body);
  getPlan(body.plan); // 400 with the available plan list when unknown
  const result = await createHostingApp({ accountId: req.apiActor!.accountId, projectId: req.apiActor!.projectId, ...body });
  ok(req, res, { id: result.app.id, name: result.app.name, slug: result.app.slug, plan: result.app.plan,
    status: result.app.status, deploymentId: result.deploymentId }, 202);
});

apiRouter.get('/apps', requireScope('hosting:read'), async (req, res) => {
  const rows = await db.select({ id: hostedApps.id, name: hostedApps.name, slug: hostedApps.slug,
    plan: hostedApps.plan, status: hostedApps.status, url: hostedApps.url, branch: hostedApps.branch,
    builder: hostedApps.builder, planExpiresAt: hostedApps.planExpiresAt, lastError: hostedApps.lastError,
    createdAt: hostedApps.createdAt }).from(hostedApps)
    .where(and(eq(hostedApps.projectId, req.apiActor!.projectId), eq(hostedApps.accountId, req.apiActor!.accountId),
      ne(hostedApps.status, 'deleted')))
    .orderBy(desc(hostedApps.createdAt)).limit(100);
  ok(req, res, { items: rows });
});

async function ownedApp(req: import('express').Request, id: string) {
  const [app] = await db.select().from(hostedApps).where(and(eq(hostedApps.id, id),
    eq(hostedApps.projectId, req.apiActor!.projectId), eq(hostedApps.accountId, req.apiActor!.accountId),
    ne(hostedApps.status, 'deleted')));
  assert(app, 404, 'APP_NOT_FOUND', 'App not found.');
  return app;
}

apiRouter.get('/apps/:id', requireScope('hosting:read'), async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const app = await ownedApp(req, id);
  const deployments = await db.select({ id: appDeployments.id, ref: appDeployments.ref,
    status: appDeployments.status, error: appDeployments.error, startedAt: appDeployments.startedAt,
    finishedAt: appDeployments.finishedAt, createdAt: appDeployments.createdAt })
    .from(appDeployments).where(eq(appDeployments.appId, id)).orderBy(desc(appDeployments.createdAt)).limit(10);
  ok(req, res, { id: app.id, name: app.name, slug: app.slug, plan: app.plan, status: app.status,
    url: app.url, branch: app.branch, builder: app.builder, planExpiresAt: app.planExpiresAt,
    lastError: app.lastError, createdAt: app.createdAt, deployments });
});

apiRouter.post('/apps/:id/deploy', requireScope('hosting:write'), async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const app = await ownedApp(req, id);
  const body = z.object({ ref: z.string().trim().min(1).max(120).optional() }).parse(req.body ?? {});
  const result = await redeployApp({ accountId: req.apiActor!.accountId, projectId: req.apiActor!.projectId,
    appId: app.id, ref: body.ref });
  ok(req, res, result, 202);
});

for (const action of ['stop', 'start'] as const) {
  apiRouter.post(`/apps/:id/${action}`, requireScope('hosting:write'), async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    await ownedApp(req, id);
    if (action === 'stop') await stopHostingApp(req.apiActor!.accountId, id);
    else await startHostingApp(req.apiActor!.accountId, id);
    ok(req, res, { queued: true }, 202);
  });
}

apiRouter.delete('/apps/:id', requireScope('hosting:write'), async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  await ownedApp(req, id);
  await deleteHostingApp(req.apiActor!.accountId, id);
  ok(req, res, { queued: true }, 202);
});

apiRouter.get('/apps/:id/logs', requireScope('hosting:read'), async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const app = await ownedApp(req, id);
  try {
    const { tail } = await httpHostAgent.logs(app.id);
    ok(req, res, { tail });
  } catch (error) {
    if (error instanceof ProviderFailure) throw agentErrorToApi(error);
    throw error;
  }
});

// ── Domain reselling (docs/domains.md). Wallet is charged before any
// registrar action; domains lapse when unrenewed, so warnings are explicit.
const buyDomainSchema = z.object({
  domain: z.string().trim().min(4).max(253),
  autoRenew: z.boolean().default(true),
  registrant: domainRegistrantSchema,
});

apiRouter.get('/domains/pricing', requireScope('domains:read'), async (req, res) => {
  ok(req, res, { currency: 'GHS', periodDays: DOMAIN_YEAR_DAYS, graceDays: DOMAIN_GRACE_DAYS,
    items: Object.values(DOMAIN_TLDS).map(({ tld, priceMinor }) => ({ tld, priceMinor, periodYears: 1 })) });
});

apiRouter.post('/domains/lookup', requireScope('domains:read'), async (req, res) => {
  const body = z.object({ domain: z.string().trim().min(4).max(253) }).parse(req.body);
  ok(req, res, await lookupDomainAvailability(body.domain));
});

apiRouter.post('/domains', requireScope('domains:write'), async (req, res) => {
  const body = buyDomainSchema.parse(req.body);
  const result = await createDomainOrder({ accountId: req.apiActor!.accountId,
    projectId: req.apiActor!.projectId, domain: body.domain, registrant: body.registrant,
    autoRenew: body.autoRenew });
  ok(req, res, { id: result.domain.id, name: result.domain.name, tld: result.domain.tld,
    status: result.domain.status, orderId: result.orderId }, 202);
});

apiRouter.get('/domains', requireScope('domains:read'), async (req, res) => {
  ok(req, res, { items: await listDomainsForActor(req.apiActor!.accountId, req.apiActor!.projectId) });
});

apiRouter.get('/domains/:id', requireScope('domains:read'), async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  ok(req, res, await getDomainForActor(req.apiActor!.accountId, req.apiActor!.projectId, id));
});

apiRouter.patch('/domains/:id', requireScope('domains:write'), async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const body = z.object({ autoRenew: z.boolean() }).parse(req.body);
  await setDomainAutoRenew({ accountId: req.apiActor!.accountId, projectId: req.apiActor!.projectId,
    domainId: id, autoRenew: body.autoRenew });
  ok(req, res, { id, autoRenew: body.autoRenew });
});

apiRouter.post('/domains/:id/renew', requireScope('domains:write'), async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const result = await renewDomainNow({ accountId: req.apiActor!.accountId,
    projectId: req.apiActor!.projectId, domainId: id });
  ok(req, res, result, 202);
});
