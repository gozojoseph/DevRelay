import { Router } from 'express';
import { and, count, desc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '../db/client.js';
import { accounts, apiKeys, auditEvents, consentRecords, deliveryEvents, ledgerAccounts, ledgerEntries,
  ledgerTransactions, messages, paymentAttempts, platformSettings, projects, senderRequests, supportRequests,
  suppressions, webhookAttempts, webhookEndpoints, webhookEvents } from '../db/schema.js';
import { availability, config } from '../config.js';
import { ApiError, assert, ok } from '../lib/http.js';
import { decrypt, randomToken, sha256 } from '../lib/security.js';
import { requireCsrf, requireDeveloper, requireSession } from '../middleware/auth.js';
import { balance } from '../services/ledger.js';
import { startFunding, reconcilePayment } from '../services/payments.js';
import { normalizePhone } from '../services/pricing.js';
import { sendSms, sendSmsSchema, sendWhatsapp, sendWhatsappSchema } from '../services/messaging.js';
import { createEndpoint, sendTestEndpoint } from '../services/webhooks.js';
import { conversationMessages, getWhatsapp, onboardWhatsapp, submitTemplate, syncTemplates } from '../services/whatsapp.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireSession, requireDeveloper);
const changed = (req: import('express').Request, action: string, targetType: string, targetId: string, details?: Record<string, unknown>) =>
  db.insert(auditEvents).values({ accountId: req.actor!.accountId, actorUserId: req.actor!.userId, action, targetType, targetId, details });
function accountId(req: import('express').Request) { return req.actor!.accountId!; }
const uuid = z.uuid();
const name = z.string().trim().min(2).max(100);

dashboardRouter.get('/projects', async (req, res) => {
  ok(req, res, await db.select().from(projects).where(eq(projects.accountId, accountId(req))).orderBy(desc(projects.createdAt)));
});
dashboardRouter.post('/projects', requireCsrf, async (req, res) => {
  const input = z.object({ name }).parse(req.body);
  const [project] = await db.insert(projects).values({ accountId: accountId(req), name: input.name }).returning();
  await changed(req, 'project.created', 'project', project!.id);
  ok(req, res, project, 201);
});
dashboardRouter.patch('/projects/:id', requireCsrf, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z.object({ name: name.optional(), dailySpendLimitMinor: z.number().int().min(0).optional(),
    dailyVolumeLimit: z.number().int().min(0).optional(), perMinuteLimit: z.number().int().min(1).max(300).optional(),
  }).refine(value => Object.values(value).some(v => v !== undefined)).parse(req.body);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId(req)));
  assert(account, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
  if ((input.dailySpendLimitMinor !== undefined && input.dailySpendLimitMinor > account.dailySpendLimitMinor) ||
    (input.dailyVolumeLimit !== undefined && input.dailyVolumeLimit > account.dailyVolumeLimit) ||
    (input.perMinuteLimit !== undefined && input.perMinuteLimit > account.perMinuteLimit)) {
    throw new ApiError(400, 'LIMIT_EXCEEDS_ACCOUNT', 'Project limit cannot exceed the account limit.');
  }
  const [project] = await db.update(projects).set({ ...input, updatedAt: new Date() }).where(and(eq(projects.id, id), eq(projects.accountId, accountId(req)))).returning();
  assert(project, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  await changed(req, 'project.updated', 'project', id, { limitChanged: input.dailySpendLimitMinor !== undefined || input.dailyVolumeLimit !== undefined });
  ok(req, res, project);
});

dashboardRouter.get('/projects/:id/keys', async (req, res) => {
  const projectId = uuid.parse(req.params.id);
  const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.accountId, accountId(req))));
  assert(project, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  const keys = await db.select({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes,
    lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt, createdAt: apiKeys.createdAt })
    .from(apiKeys).where(and(eq(apiKeys.projectId, projectId), eq(apiKeys.accountId, accountId(req)))).orderBy(desc(apiKeys.createdAt));
  ok(req, res, keys);
});
async function createKey(req: import('express').Request, projectId: string, keyName: string, scopes: ('messaging:send' | 'messaging:read' | 'hosting:read' | 'hosting:write' | 'domains:read' | 'domains:write')[]) {
  const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.accountId, accountId(req))));
  assert(project, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
  const rawKey = `dr_${config().NODE_ENV === 'production' ? 'live' : 'test'}_${randomToken(32)}`;
  const [key] = await db.insert(apiKeys).values({ accountId: accountId(req), projectId, name: keyName, scopes,
    prefix: rawKey.slice(0, 18), keyHash: sha256(rawKey) }).returning();
  assert(key, 500, 'KEY_ERROR', 'Could not create API key.');
  await changed(req, 'api_key.created', 'api_key', key.id, { scopes });
  return { id: key.id, prefix: key.prefix, scopes: key.scopes, key: rawKey };
}
dashboardRouter.post('/projects/:id/keys', requireCsrf, async (req, res) => {
  const projectId = uuid.parse(req.params.id);
  const input = z.object({ name, scopes: z.array(z.enum(['messaging:send', 'messaging:read', 'hosting:read', 'hosting:write', 'domains:read', 'domains:write'])).min(1).max(6) }).parse(req.body);
  ok(req, res, await createKey(req, projectId, input.name, [...new Set(input.scopes)]), 201);
});
dashboardRouter.post('/projects/:id/keys/:keyId/revoke', requireCsrf, async (req, res) => {
  const projectId = uuid.parse(req.params.id); const keyId = uuid.parse(req.params.keyId);
  const [key] = await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId),
    eq(apiKeys.accountId, accountId(req)), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id });
  assert(key, 404, 'KEY_NOT_FOUND', 'Active key not found.');
  await changed(req, 'api_key.revoked', 'api_key', keyId);
  ok(req, res, { revoked: true });
});
dashboardRouter.post('/projects/:id/keys/:keyId/rotate', requireCsrf, async (req, res) => {
  const projectId = uuid.parse(req.params.id); const keyId = uuid.parse(req.params.keyId);
  const rawKey = `dr_${config().NODE_ENV === 'production' ? 'live' : 'test'}_${randomToken(32)}`;
  const result = await db.transaction(async tx => {
    const [old] = await tx.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId),
      eq(apiKeys.accountId, accountId(req)), isNull(apiKeys.revokedAt))).returning();
    assert(old, 404, 'KEY_NOT_FOUND', 'Active key not found.');
    const [replacement] = await tx.insert(apiKeys).values({ accountId: accountId(req), projectId, name: old.name,
      scopes: old.scopes, prefix: rawKey.slice(0, 18), keyHash: sha256(rawKey) }).returning();
    assert(replacement, 500, 'KEY_ERROR', 'Key rotation failed.');
    await tx.insert(auditEvents).values({ actorUserId: req.actor!.userId, accountId: accountId(req),
      action: 'api_key.rotated', targetType: 'api_key', targetId: old.id, details: { replacement: replacement.id } });
    return { id: replacement.id, prefix: replacement.prefix, scopes: replacement.scopes, key: rawKey };
  });
  ok(req, res, result, 201);
});

dashboardRouter.get('/wallet', async (req, res) => {
  const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1));
  ok(req, res, { ...(await balance(accountId(req))), minimumFundingMinor: settings?.minimumFundingMinor ?? null,
    fundingAvailable: availability().paystack && Boolean(settings?.minimumFundingMinor) });
});
dashboardRouter.post('/wallet/fund', requireCsrf, async (req, res) => {
  const input = z.object({ amountMinor: z.number().int().positive() }).parse(req.body);
  ok(req, res, await startFunding(accountId(req), req.actor!.userId, input.amountMinor), 201);
});
dashboardRouter.get('/wallet/payments', async (req, res) => {
  const rows = await db.select({ reference: paymentAttempts.reference, amountMinor: paymentAttempts.amountMinor,
    currency: paymentAttempts.currency, status: paymentAttempts.status, createdAt: paymentAttempts.createdAt,
    creditedAt: paymentAttempts.creditedAt }).from(paymentAttempts).where(eq(paymentAttempts.accountId, accountId(req)))
    .orderBy(desc(paymentAttempts.createdAt)).limit(100);
  ok(req, res, rows);
});
dashboardRouter.post('/wallet/payments/:reference/verify', requireCsrf, async (req, res) => {
  const reference = z.string().regex(/^dr_[a-f0-9]{32}$/).parse(req.params.reference);
  const [attempt] = await db.select().from(paymentAttempts).where(and(eq(paymentAttempts.reference, reference), eq(paymentAttempts.accountId, accountId(req))));
  assert(attempt, 404, 'PAYMENT_NOT_FOUND', 'Payment reference not found.');
  ok(req, res, await reconcilePayment(reference));
});
dashboardRouter.get('/wallet/history', async (req, res) => {
  const rows = await db.select({ reference: ledgerTransactions.reference, kind: ledgerTransactions.kind,
    amountMinor: ledgerEntries.amountMinor, createdAt: ledgerTransactions.createdAt })
    .from(ledgerEntries).innerJoin(ledgerTransactions, eq(ledgerEntries.transactionId, ledgerTransactions.id))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, ledgerEntries.ledgerAccountId))
    .where(and(eq(ledgerTransactions.accountId, accountId(req)), eq(ledgerAccounts.accountId, accountId(req)),
      eq(ledgerAccounts.kind, 'customer_available'))).orderBy(desc(ledgerTransactions.createdAt)).limit(1000);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="devrelay-credit-history.csv"');
    return res.send(['reference,type,amount_pesewas,currency,created_at', ...rows.map(row =>
      `${row.reference},${row.kind},${row.amountMinor},GHS,${row.createdAt.toISOString()}`)].join('\r\n'));
  }
  ok(req, res, rows);
});

dashboardRouter.get('/senders', async (req, res) => {
  ok(req, res, await db.select().from(senderRequests).where(eq(senderRequests.accountId, accountId(req))).orderBy(desc(senderRequests.createdAt)));
});
dashboardRouter.post('/senders', requireCsrf, async (req, res) => {
  const input = z.object({ senderId: z.string().regex(/^[A-Za-z0-9]{3,11}$/), brand: z.string().trim().min(2).max(160),
    website: z.url().startsWith('https://'), sampleMessage: z.string().min(10).max(500),
    providerDetails: z.string().max(1000).optional() }).parse(req.body);
  const [request] = await db.insert(senderRequests).values({ accountId: accountId(req), ...input }).onConflictDoNothing().returning();
  assert(request, 409, 'SENDER_EXISTS', 'A request for this sender already exists.');
  await changed(req, 'sender.requested', 'sender', request.id);
  ok(req, res, request, 201);
});

dashboardRouter.get('/consents', async (req, res) => {
  ok(req, res, await db.select().from(consentRecords).where(eq(consentRecords.accountId, accountId(req))).orderBy(desc(consentRecords.consentedAt)).limit(200));
});
dashboardRouter.post('/consents', requireCsrf, async (req, res) => {
  const input = z.object({ channel: z.enum(['sms', 'whatsapp']), recipient: z.string().min(8),
    source: z.string().trim().min(8).max(180) }).parse(req.body);
  const phone = normalizePhone(input.recipient, input.channel === 'sms');
  const [blocked] = await db.select().from(suppressions).where(and(eq(suppressions.accountId, accountId(req)),
    eq(suppressions.channel, input.channel), eq(suppressions.recipient, phone.e164)));
  if (blocked) throw new ApiError(409, 'RECIPIENT_SUPPRESSED', 'This recipient opted out. Contact support with evidence of new consent before sending.');
  const [row] = await db.insert(consentRecords).values({ accountId: accountId(req), channel: input.channel,
    recipient: phone.e164, source: input.source, consentedAt: new Date() }).onConflictDoUpdate({
    target: [consentRecords.accountId, consentRecords.channel, consentRecords.recipient],
    set: { source: input.source, consentedAt: new Date(), revokedAt: null },
  }).returning();
  await changed(req, 'consent.recorded', 'consent', row!.id, { channel: input.channel, recipient: phone.e164 });
  ok(req, res, row, 201);
});
dashboardRouter.post('/suppressions', requireCsrf, async (req, res) => {
  const input = z.object({ channel: z.enum(['sms', 'whatsapp']), recipient: z.string(), reason: z.string().trim().min(3).max(80) }).parse(req.body);
  const phone = normalizePhone(input.recipient, input.channel === 'sms');
  await db.transaction(async tx => {
    await tx.insert(suppressions).values({ accountId: accountId(req), channel: input.channel, recipient: phone.e164, reason: input.reason }).onConflictDoNothing();
    await tx.update(consentRecords).set({ revokedAt: new Date() }).where(and(eq(consentRecords.accountId, accountId(req)),
      eq(consentRecords.channel, input.channel), eq(consentRecords.recipient, phone.e164)));
    await tx.insert(auditEvents).values({ accountId: accountId(req), actorUserId: req.actor!.userId, action: 'recipient.suppressed',
      details: { channel: input.channel, recipient: phone.e164 } });
  });
  ok(req, res, { suppressed: true });
});
dashboardRouter.get('/suppressions', async (req, res) => {
  ok(req, res, await db.select().from(suppressions).where(eq(suppressions.accountId, accountId(req))).orderBy(desc(suppressions.createdAt)).limit(200));
});

dashboardRouter.get('/support', async (req, res) => {
  const rows = await db.select({ id: supportRequests.id, subject: supportRequests.subject, body: supportRequests.body,
    status: supportRequests.status, createdAt: supportRequests.createdAt, updatedAt: supportRequests.updatedAt })
    .from(supportRequests).where(eq(supportRequests.accountId, accountId(req)))
    .orderBy(desc(supportRequests.createdAt)).limit(100);
  ok(req, res, rows);
});
dashboardRouter.post('/support', requireCsrf, async (req, res) => {
  const input = z.object({ subject: z.string().trim().min(3).max(160), body: z.string().trim().min(10).max(4000) }).parse(req.body);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId(req)));
  const [row] = await db.insert(supportRequests).values({ accountId: accountId(req), email: account!.contactEmail, ...input }).returning();
  ok(req, res, { id: row!.id, message: 'Your request has been recorded.' }, 201);
});

dashboardRouter.get('/overview', async (req, res) => {
  const startOfDay = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId(req)));
  assert(account, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
  const [messageCounts] = await db.select({ total: count() }).from(messages)
    .where(and(eq(messages.accountId, accountId(req)), gte(messages.createdAt, startOfDay)));
  const [projectCount] = await db.select({ total: count() }).from(projects).where(eq(projects.accountId, accountId(req)));
  const [senderCount] = await db.select({ total: count() }).from(senderRequests)
    .where(and(eq(senderRequests.accountId, accountId(req)), eq(senderRequests.status, 'approved')));
  const [webhookCount] = await db.select({ total: count() }).from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.accountId, accountId(req)), eq(webhookEndpoints.active, true)));
  const statuses = await db.select({ status: messages.status, total: count() }).from(messages)
    .where(and(eq(messages.accountId, accountId(req)), gte(messages.createdAt, startOfDay))).groupBy(messages.status);
  const recent = await db.select({ id: messages.id, channel: messages.channel, recipient: messages.recipient,
    status: messages.status, quotedMinor: messages.quotedMinor, chargedMinor: messages.chargedMinor,
    createdAt: messages.createdAt, errorCode: messages.errorCode }).from(messages)
    .where(eq(messages.accountId, accountId(req))).orderBy(desc(messages.createdAt)).limit(6);
  ok(req, res, { account: { id: account.id, status: account.status, businessName: account.businessName,
    dailySpendLimitMinor: account.dailySpendLimitMinor, dailyVolumeLimit: account.dailyVolumeLimit },
  wallet: await balance(accountId(req)), today: { messages: messageCounts?.total ?? 0,
    byStatus: Object.fromEntries(statuses.map(row => [row.status, row.total])) },
  projectCount: projectCount?.total ?? 0, approvedSenderCount: senderCount?.total ?? 0,
  activeWebhookCount: webhookCount?.total ?? 0, recent, availability: availability() });
});

dashboardRouter.get('/messages', async (req, res) => {
  const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50),
    channel: z.enum(['sms', 'whatsapp']).optional(), status: z.string().max(40).optional(),
    projectId: z.uuid().optional(), cursor: z.string().datetime().optional() }).parse(req.query);
  const conditions = [eq(messages.accountId, accountId(req)), eq(messages.direction, 'outbound')];
  if (query.channel) conditions.push(eq(messages.channel, query.channel));
  if (query.status) conditions.push(eq(messages.status, query.status as typeof messages.$inferSelect['status']));
  if (query.projectId) conditions.push(eq(messages.projectId, query.projectId));
  if (query.cursor) conditions.push(lt(messages.createdAt, new Date(query.cursor)));
  const rows = await db.select({ id: messages.id, projectId: messages.projectId, projectName: projects.name,
    channel: messages.channel, recipient: messages.recipient, sender: messages.sender, status: messages.status,
    segments: messages.segments, quotedMinor: messages.quotedMinor, chargedMinor: messages.chargedMinor,
    templateName: messages.templateName, errorCode: messages.errorCode, createdAt: messages.createdAt,
    lastProviderAt: messages.lastProviderAt }).from(messages).leftJoin(projects, eq(projects.id, messages.projectId))
    .where(and(...conditions)).orderBy(desc(messages.createdAt)).limit(query.limit + 1);
  const nextCursor = rows.length > query.limit ? rows.pop()!.createdAt.toISOString() : null;
  ok(req, res, { items: rows.map(row => ({ ...row, currency: 'GHS' })), nextCursor });
});

dashboardRouter.get('/messages/:id', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const [row] = await db.select({ message: messages, projectName: projects.name }).from(messages)
    .leftJoin(projects, eq(projects.id, messages.projectId))
    .where(and(eq(messages.id, id), eq(messages.accountId, accountId(req))));
  assert(row, 404, 'MESSAGE_NOT_FOUND', 'Message not found.');
  const message = row.message;
  const events = await db.select({ status: deliveryEvents.status, occurredAt: deliveryEvents.occurredAt,
    createdAt: deliveryEvents.createdAt, details: deliveryEvents.details }).from(deliveryEvents)
    .where(eq(deliveryEvents.messageId, id)).orderBy(deliveryEvents.createdAt);
  ok(req, res, { id: message.id, direction: message.direction, channel: message.channel, recipient: message.recipient,
    sender: message.sender, projectName: row.projectName, status: message.status, segments: message.segments,
    quotedMinor: message.quotedMinor, chargedMinor: message.chargedMinor, currency: 'GHS',
    reservationStatus: message.reservationStatus, templateName: message.templateName,
    templateLanguage: message.templateLanguage,
    body: message.bodyEncrypted ? decrypt(message.bodyEncrypted, `message:${accountId(req)}`) : null,
    variables: message.variablesEncrypted ? JSON.parse(decrypt(message.variablesEncrypted, `message:${accountId(req)}`)) as string[] : [],
    errorCode: message.errorCode, providerPricingType: message.providerPricingType,
    providerPricingCategory: message.providerPricingCategory, createdAt: message.createdAt,
    acceptedAt: message.acceptedAt, lastProviderAt: message.lastProviderAt, events });
});

function dashboardIdempotencyKey(req: import('express').Request) {
  return z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).parse(req.header('idempotency-key') ?? randomUUID());
}
async function assertProject(req: import('express').Request, projectId: string) {
  const [project] = await db.select().from(projects).where(and(eq(projects.id, projectId), eq(projects.accountId, accountId(req))));
  assert(project, 404, 'PROJECT_NOT_FOUND', 'Project not found.');
}
dashboardRouter.post('/messages/sms', requireCsrf, async (req, res) => {
  const { projectId, ...raw } = z.object({ projectId: uuid }).passthrough().parse(req.body);
  await assertProject(req, projectId);
  const key = dashboardIdempotencyKey(req);
  const body = sendSmsSchema.parse(raw);
  const result = await sendSms({ accountId: accountId(req), projectId, idempotencyKey: key, body });
  res.setHeader('Idempotency-Key', key);
  ok(req, res, result, 202);
});
dashboardRouter.post('/messages/whatsapp', requireCsrf, async (req, res) => {
  const { projectId, ...raw } = z.object({ projectId: uuid }).passthrough().parse(req.body);
  await assertProject(req, projectId);
  const key = dashboardIdempotencyKey(req);
  const body = sendWhatsappSchema.parse(raw);
  const result = await sendWhatsapp({ accountId: accountId(req), projectId, idempotencyKey: key, body });
  res.setHeader('Idempotency-Key', key);
  ok(req, res, result, 202);
});

const webhookEventTypes = z.enum(['*', 'message.accepted', 'message.sent', 'message.delivered', 'message.read',
  'message.failed', 'message.reconciled']);
dashboardRouter.get('/webhooks', async (req, res) => {
  const endpoints = await db.select({ id: webhookEndpoints.id, projectId: webhookEndpoints.projectId, url: webhookEndpoints.url,
    events: webhookEndpoints.events, active: webhookEndpoints.active, createdAt: webhookEndpoints.createdAt })
    .from(webhookEndpoints).where(eq(webhookEndpoints.accountId, accountId(req))).orderBy(desc(webhookEndpoints.createdAt));
  const events = await db.select({ id: webhookEvents.id, projectId: webhookEvents.projectId, type: webhookEvents.type,
    messageId: webhookEvents.messageId, createdAt: webhookEvents.createdAt }).from(webhookEvents)
    .where(eq(webhookEvents.accountId, accountId(req))).orderBy(desc(webhookEvents.createdAt)).limit(50);
  const attempts = events.length ? await db.select({ eventId: webhookAttempts.eventId, endpointId: webhookAttempts.endpointId,
    attempt: webhookAttempts.attempt, httpStatus: webhookAttempts.httpStatus, error: webhookAttempts.error,
    createdAt: webhookAttempts.createdAt }).from(webhookAttempts)
    .where(inArray(webhookAttempts.eventId, events.map(event => event.id)))
    .orderBy(desc(webhookAttempts.createdAt)) : [];
  ok(req, res, { endpoints, events: events.map(event => ({ ...event, attempts: attempts.filter(attempt => attempt.eventId === event.id) })) });
});
dashboardRouter.post('/webhooks', requireCsrf, async (req, res) => {
  const input = z.object({ projectId: uuid, url: z.url().max(2000),
    events: z.array(webhookEventTypes).min(1).max(10) }).parse(req.body);
  await assertProject(req, input.projectId);
  ok(req, res, await createEndpoint({ accountId: accountId(req), projectId: input.projectId,
    url: input.url, events: [...new Set(input.events)] }), 201);
});
dashboardRouter.patch('/webhooks/:id', requireCsrf, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z.object({ active: z.boolean().optional(), url: z.url().max(2000).optional(),
    events: z.array(webhookEventTypes).min(1).max(10).optional() })
    .refine(value => Object.values(value).some(item => item !== undefined)).parse(req.body);
  if (input.url) {
    const { validateWebhookUrl } = await import('../services/webhooks.js');
    validateWebhookUrl(input.url);
  }
  const [endpoint] = await db.update(webhookEndpoints).set({ ...input, updatedAt: new Date() })
    .where(and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.accountId, accountId(req)))).returning();
  assert(endpoint, 404, 'WEBHOOK_NOT_FOUND', 'Webhook endpoint not found.');
  await changed(req, 'webhook.updated', 'webhook_endpoint', id, { active: input.active });
  ok(req, res, { id: endpoint.id, url: endpoint.url, events: endpoint.events, active: endpoint.active });
});
dashboardRouter.post('/webhooks/:id/test', requireCsrf, async (req, res) => {
  const id = uuid.parse(req.params.id);
  const [endpoint] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, id),
    eq(webhookEndpoints.accountId, accountId(req))));
  assert(endpoint, 404, 'WEBHOOK_NOT_FOUND', 'Webhook endpoint not found.');
  ok(req, res, await sendTestEndpoint({ accountId: accountId(req), projectId: endpoint.projectId,
    endpointId: endpoint.id, actorUserId: req.actor!.userId }), 202);
});

dashboardRouter.get('/whatsapp', async (req, res) => {
  ok(req, res, await getWhatsapp(accountId(req)));
});
dashboardRouter.post('/whatsapp/onboarding', requireCsrf, async (req, res) => {
  const [account] = await db.select().from(accounts).where(eq(accounts.id, accountId(req)));
  assert(account?.status === 'active', 403, 'ACCOUNT_NOT_ACTIVE', 'Your account must be approved before WhatsApp onboarding.');
  const input = z.object({ code: z.string().min(8).max(2048), wabaId: z.string().regex(/^\d{5,40}$/),
    phoneNumberId: z.string().regex(/^\d{5,40}$/), businessId: z.string().regex(/^\d{5,40}$/).optional(),
    pin: z.string().regex(/^\d{6}$/).optional() }).parse(req.body);
  ok(req, res, await onboardWhatsapp({ accountId: accountId(req), userId: req.actor!.userId, ...input }), 201);
});
dashboardRouter.post('/whatsapp/templates/sync', requireCsrf, async (req, res) => {
  const input = z.object({ connectionId: uuid.optional() }).parse(req.body);
  ok(req, res, await syncTemplates(accountId(req), req.actor!.userId, input.connectionId));
});
dashboardRouter.post('/whatsapp/templates', requireCsrf, async (req, res) => {
  const input = z.object({ connectionId: uuid, name: z.string().regex(/^[a-z0-9_]{1,180}$/),
    language: z.string().regex(/^[a-z]{2,3}(?:_[A-Z]{2})?$/), category: z.enum(['MARKETING', 'UTILITY']),
    body: z.string().trim().min(1).max(1024), examples: z.array(z.string().max(200)).max(10).optional() }).parse(req.body);
  const template = await submitTemplate(accountId(req), req.actor!.userId, input.connectionId, input);
  ok(req, res, template, 201);
});
dashboardRouter.get('/whatsapp/conversations/:id/messages', async (req, res) => {
  const id = uuid.parse(req.params.id);
  ok(req, res, await conversationMessages(accountId(req), id));
});
