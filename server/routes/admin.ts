import { Router } from 'express';
import { and, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { accounts, auditEvents, ledgerAccounts, messages, paymentAttempts, platformSettings, pricingVersions,
  projects, senderRequests, supportRequests, users } from '../db/schema.js';
import { availability } from '../config.js';
import { ApiError, assert, ok } from '../lib/http.js';
import { requireAdmin, requireSession } from '../middleware/auth.js';
import { resolveReservation } from '../services/status.js';
import { activateWhatsappConnection, listWhatsappConnections, setWhatsappConnectionStatus } from '../services/whatsapp.js';

export const adminRouter = Router();
adminRouter.use(requireSession, requireAdmin);
const uuid = z.uuid();
const dayStart = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);

adminRouter.get('/overview', async (req, res) => {
  const [accountCounts, messageCounts, pendingSenders, reconciliationCount, openSupport, [revenue]] = await Promise.all([
    db.select({ status: accounts.status, total: count() }).from(accounts).groupBy(accounts.status),
    db.select({ status: messages.status, total: count() }).from(messages).where(gte(messages.createdAt, dayStart())).groupBy(messages.status),
    db.select({ total: count() }).from(senderRequests).where(eq(senderRequests.status, 'pending')),
    db.select({ total: count() }).from(messages).where(and(eq(messages.reservationStatus, 'reserved'),
      inArray(messages.status, ['failed', 'pending_reconciliation']))),
    db.select({ total: count() }).from(supportRequests).where(eq(supportRequests.status, 'open')),
    db.select({ balanceMinor: ledgerAccounts.balanceMinor }).from(ledgerAccounts)
      .where(and(isNull(ledgerAccounts.accountId), eq(ledgerAccounts.kind, 'platform_revenue'))),
  ]);
  ok(req, res, { accounts: Object.fromEntries(accountCounts.map(row => [row.status, row.total])),
    messagesToday: Object.fromEntries(messageCounts.map(row => [row.status, row.total])),
    pendingSenders: pendingSenders[0]?.total ?? 0, pendingReconciliation: reconciliationCount[0]?.total ?? 0,
    openSupport: openSupport[0]?.total ?? 0, platformRevenueMinor: revenue?.balanceMinor ?? 0,
    availability: availability(), mfaRequiredForAdmin: true });
});

adminRouter.get('/accounts', async (req, res) => {
  const query = z.object({ status: z.string().optional(), search: z.string().max(100).optional() }).parse(req.query);
  const conditions = [];
  if (query.status) conditions.push(eq(accounts.status, query.status as typeof accounts.$inferSelect['status']));
  if (query.search) conditions.push(or(ilike(accounts.businessName, `%${query.search}%`), ilike(accounts.contactEmail, `%${query.search}%`))!);
  const rows = await db.select().from(accounts).where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(accounts.createdAt)).limit(500);
  const userRows = rows.length ? await db.select({ id: users.id, accountId: users.accountId, email: users.email,
    role: users.role, emailVerifiedAt: users.emailVerifiedAt, mfaEnabled: sql<boolean>`${users.mfaSecretEncrypted} IS NOT NULL` })
    .from(users).where(inArray(users.accountId, rows.map(row => row.id))) : [];
  const messageTotals = rows.length ? await db.select({ accountId: messages.accountId, total: count() }).from(messages)
    .where(inArray(messages.accountId, rows.map(row => row.id))).groupBy(messages.accountId) : [];
  ok(req, res, rows.map(row => ({ ...row, users: userRows.filter(user => user.accountId === row.id),
    messageCount: messageTotals.find(item => item.accountId === row.id)?.total ?? 0 })));
});

adminRouter.get('/accounts/:id', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, id));
  assert(account, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
  const accountUsers = await db.select({ id: users.id, email: users.email, role: users.role,
    emailVerifiedAt: users.emailVerifiedAt, mfaEnabled: sql<boolean>`${users.mfaSecretEncrypted} IS NOT NULL`,
    createdAt: users.createdAt }).from(users).where(eq(users.accountId, id));
  const accountProjects = await db.select().from(projects).where(eq(projects.accountId, id)).orderBy(desc(projects.createdAt));
  const payments = await db.select({ reference: paymentAttempts.reference, amountMinor: paymentAttempts.amountMinor,
    status: paymentAttempts.status, createdAt: paymentAttempts.createdAt, creditedAt: paymentAttempts.creditedAt })
    .from(paymentAttempts).where(eq(paymentAttempts.accountId, id)).orderBy(desc(paymentAttempts.createdAt)).limit(50);
  const senders = await db.select().from(senderRequests).where(eq(senderRequests.accountId, id)).orderBy(desc(senderRequests.createdAt));
  ok(req, res, { account, users: accountUsers, projects: accountProjects, payments, senders });
});

adminRouter.post('/accounts/:id/approve', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z.object({ note: z.string().trim().max(500).optional() }).parse(req.body ?? {});
  const result = await db.transaction(async tx => {
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, id)).for('update');
    assert(account, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
    const [verified] = await tx.select({ id: users.id }).from(users).where(and(eq(users.accountId, id),
      sql`${users.emailVerifiedAt} IS NOT NULL`)).limit(1);
    assert(verified, 409, 'EMAIL_NOT_VERIFIED', 'The account owner must verify their email before approval.');
    const [updated] = await tx.update(accounts).set({ status: 'active', updatedAt: new Date() }).where(eq(accounts.id, id)).returning();
    await tx.insert(auditEvents).values({ actorUserId: req.actor!.userId, accountId: id, action: 'account.approved',
      targetType: 'account', targetId: id, details: { note: input.note ?? null } });
    return updated;
  });
  ok(req, res, result);
});

adminRouter.post('/accounts/:id/suspend', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
  const result = await db.transaction(async tx => {
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, id)).for('update');
    assert(account, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
    const [updated] = await tx.update(accounts).set({ status: 'suspended', updatedAt: new Date() }).where(eq(accounts.id, id)).returning();
    await tx.insert(auditEvents).values({ actorUserId: req.actor!.userId, accountId: id, action: 'account.suspended',
      targetType: 'account', targetId: id, details: { reason: input.reason } });
    return updated;
  });
  ok(req, res, result);
});

adminRouter.get('/senders', async (req, res) => {
  const query = z.object({ status: z.string().optional() }).parse(req.query);
  const conditions = [];
  if (query.status) conditions.push(eq(senderRequests.status, query.status));
  const rows = await db.select({ request: senderRequests, businessName: accounts.businessName, contactEmail: accounts.contactEmail })
    .from(senderRequests).innerJoin(accounts, eq(accounts.id, senderRequests.accountId))
    .where(conditions.length ? and(...conditions) : undefined).orderBy(desc(senderRequests.createdAt)).limit(500);
  ok(req, res, rows.map(row => ({ ...row.request, businessName: row.businessName, contactEmail: row.contactEmail })));
});

adminRouter.post('/senders/:id/review', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z.object({ decision: z.enum(['approved', 'rejected']), providerReference: z.string().trim().min(3).max(200).optional(),
    rejectionReason: z.string().trim().min(5).max(500).optional() }).parse(req.body);
  if (input.decision === 'approved' && !input.providerReference) {
    throw new ApiError(400, 'PROVIDER_REFERENCE_REQUIRED', 'Record evidence that the sender ID is registered with the upstream provider.');
  }
  if (input.decision === 'rejected' && !input.rejectionReason) {
    throw new ApiError(400, 'REJECTION_REASON_REQUIRED', 'Give the customer a rejection reason.');
  }
  const result = await db.transaction(async tx => {
    const [request] = await tx.select().from(senderRequests).where(eq(senderRequests.id, id)).for('update');
    assert(request, 404, 'SENDER_NOT_FOUND', 'Sender request not found.');
    const [updated] = await tx.update(senderRequests).set({ status: input.decision,
      providerReference: input.providerReference ?? request.providerReference,
      rejectionReason: input.decision === 'rejected' ? input.rejectionReason ?? null : null,
      reviewedBy: req.actor!.userId, reviewedAt: new Date() }).where(eq(senderRequests.id, id)).returning();
    await tx.insert(auditEvents).values({ actorUserId: req.actor!.userId, accountId: request.accountId,
      action: `sender.${input.decision}`, targetType: 'sender_request', targetId: id,
      details: { providerReference: input.providerReference ?? null, rejectionReason: input.rejectionReason ?? null } });
    return updated;
  });
  ok(req, res, result);
});

adminRouter.get('/pricing', async (_req, res) => {
  ok(_req, res, await db.select().from(pricingVersions).orderBy(desc(pricingVersions.effectiveFrom)).limit(500));
});

adminRouter.post('/pricing', async (req, res) => {
  const input = z.object({ channel: z.enum(['sms', 'whatsapp']), country: z.string().regex(/^[A-Z]{2}$/),
    route: z.string().trim().min(2).max(60), category: z.string().trim().min(2).max(32),
    customerUnitMinor: z.number().int().positive(), providerCostMinor: z.number().int().nonnegative().optional(),
    providerCostCurrency: z.string().length(3).optional(), effectiveFrom: z.coerce.date().optional() }).parse(req.body);
  const start = input.effectiveFrom ?? new Date();
  const price = await db.transaction(async tx => {
    const existing = await tx.select().from(pricingVersions).where(and(eq(pricingVersions.channel, input.channel),
      eq(pricingVersions.country, input.country), eq(pricingVersions.route, input.route),
      eq(pricingVersions.category, input.category))).orderBy(desc(pricingVersions.effectiveFrom));
    const overlapping = existing.find(row => row.effectiveFrom >= start && (!row.effectiveTo || row.effectiveTo > start));
    if (overlapping) throw new ApiError(409, 'PRICE_OVERLAP', 'A price version already covers the requested start time.');
    const current = existing.find(row => row.effectiveFrom < start && (!row.effectiveTo || row.effectiveTo > start));
    if (current) await tx.update(pricingVersions).set({ effectiveTo: start }).where(eq(pricingVersions.id, current.id));
    const [created] = await tx.insert(pricingVersions).values({ channel: input.channel, country: input.country,
      route: input.route, category: input.category, customerUnitMinor: input.customerUnitMinor,
      providerCostMinor: input.providerCostMinor ?? null, providerCostCurrency: input.providerCostCurrency ?? null,
      effectiveFrom: start, createdBy: req.actor!.userId }).returning();
    await tx.insert(auditEvents).values({ actorUserId: req.actor!.userId, action: 'pricing.created',
      targetType: 'pricing_version', targetId: created!.id, details: { channel: input.channel, country: input.country,
        route: input.route, category: input.category, customerUnitMinor: input.customerUnitMinor } });
    return created;
  });
  ok(req, res, price, 201);
});

adminRouter.get('/messages', async (req, res) => {
  const query = z.object({ status: z.string().optional(), channel: z.enum(['sms', 'whatsapp']).optional(),
    accountId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(100) }).parse(req.query);
  const conditions = [];
  if (query.status) conditions.push(eq(messages.status, query.status as typeof messages.$inferSelect['status']));
  if (query.channel) conditions.push(eq(messages.channel, query.channel));
  if (query.accountId) conditions.push(eq(messages.accountId, query.accountId));
  const rows = await db.select({ id: messages.id, accountId: messages.accountId, businessName: accounts.businessName,
    channel: messages.channel, recipient: messages.recipient, status: messages.status, segments: messages.segments,
    quotedMinor: messages.quotedMinor, chargedMinor: messages.chargedMinor, reservationStatus: messages.reservationStatus,
    errorCode: messages.errorCode, providerMessageId: messages.providerMessageId, createdAt: messages.createdAt,
    lastProviderAt: messages.lastProviderAt }).from(messages).innerJoin(accounts, eq(accounts.id, messages.accountId))
    .where(conditions.length ? and(...conditions) : undefined).orderBy(desc(messages.createdAt)).limit(query.limit);
  ok(req, res, rows);
});

adminRouter.get('/reconciliation', async (_req, res) => {
  const rows = await db.select({ id: messages.id, accountId: messages.accountId, businessName: accounts.businessName,
    channel: messages.channel, recipient: messages.recipient, status: messages.status, quotedMinor: messages.quotedMinor,
    reservationStatus: messages.reservationStatus, errorCode: messages.errorCode, createdAt: messages.createdAt })
    .from(messages).innerJoin(accounts, eq(accounts.id, messages.accountId))
    .where(and(eq(messages.reservationStatus, 'reserved'), inArray(messages.status, ['failed', 'pending_reconciliation'])))
    .orderBy(desc(messages.createdAt)).limit(200);
  ok(_req, res, rows);
});

adminRouter.post('/messages/:id/reconcile', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z.object({ action: z.enum(['charge', 'release']), reason: z.string().trim().min(10).max(500) }).parse(req.body);
  const result = await resolveReservation({ messageId: id, charge: input.action === 'charge',
    actorUserId: req.actor!.userId, reason: input.reason });
  assert(result, 404, 'MESSAGE_NOT_FOUND', 'Message not found.');
  if (!result.changed) throw new ApiError(409, 'NOTHING_TO_RECONCILE', 'This message has no reserved credits left to resolve.');
  ok(req, res, result);
});

adminRouter.get('/support', async (req, res) => {
  const query = z.object({ status: z.string().optional() }).parse(req.query);
  const rows = await db.select({ request: supportRequests, businessName: accounts.businessName })
    .from(supportRequests).leftJoin(accounts, eq(accounts.id, supportRequests.accountId))
    .where(query.status ? eq(supportRequests.status, query.status) : undefined)
    .orderBy(desc(supportRequests.createdAt)).limit(300);
  ok(req, res, rows.map(row => ({ ...row.request, businessName: row.businessName })));
});

adminRouter.post('/support/:id/resolve', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const [updated] = await db.update(supportRequests).set({ status: 'resolved', updatedAt: new Date() })
    .where(eq(supportRequests.id, id)).returning();
  assert(updated, 404, 'SUPPORT_NOT_FOUND', 'Support request not found.');
  await db.insert(auditEvents).values({ actorUserId: req.actor!.userId, accountId: updated.accountId,
    action: 'support.resolved', targetType: 'support_request', targetId: id });
  ok(req, res, updated);
});

adminRouter.get('/audit', async (req, res) => {
  const query = z.object({ accountId: z.uuid().optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
  const rows = await db.select().from(auditEvents).where(query.accountId ? eq(auditEvents.accountId, query.accountId) : undefined)
    .orderBy(desc(auditEvents.createdAt)).limit(query.limit);
  ok(req, res, rows);
});

adminRouter.get('/settings', async (req, res) => {
  const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1));
  ok(req, res, settings ?? { id: 1, minimumFundingMinor: null });
});
adminRouter.patch('/settings', async (req, res) => {
  const input = z.object({ minimumFundingMinor: z.number().int().nonnegative().max(100_000_000) }).parse(req.body);
  const [settings] = await db.insert(platformSettings).values({ id: 1, minimumFundingMinor: input.minimumFundingMinor,
    updatedAt: new Date() }).onConflictDoUpdate({ target: platformSettings.id,
    set: { minimumFundingMinor: input.minimumFundingMinor, updatedAt: new Date() } }).returning();
  await db.insert(auditEvents).values({ actorUserId: req.actor!.userId, action: 'settings.updated',
    targetType: 'platform_settings', targetId: '1', details: input });
  ok(req, res, settings);
});

adminRouter.get('/whatsapp', async (_req, res) => {
  ok(_req, res, await listWhatsappConnections());
});
adminRouter.post('/whatsapp/:id/activate', async (req, res) => {
  const id = uuid.parse(req.params.id);
  const input = z.object({ billingConfirmed: z.literal(true) }).parse(req.body);
  ok(req, res, await activateWhatsappConnection({ actorUserId: req.actor!.userId, connectionId: id, billingConfirmed: input.billingConfirmed }));
});
adminRouter.post('/whatsapp/:id/suspend', async (req, res) => {
  const id = uuid.parse(req.params.id);
  ok(req, res, await setWhatsappConnectionStatus({ actorUserId: req.actor!.userId, connectionId: id, status: 'suspended' }));
});
adminRouter.post('/whatsapp/:id/reactivate', async (req, res) => {
  const id = uuid.parse(req.params.id);
  ok(req, res, await setWhatsappConnectionStatus({ actorUserId: req.actor!.userId, connectionId: id, status: 'active' }));
});
