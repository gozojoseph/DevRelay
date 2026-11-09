import { Router } from 'express';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import { messages, deliveryEvents } from '../db/schema.js';
import { ApiError, assert, ok } from '../lib/http.js';
import { requireApiKey, requireScope } from '../middleware/auth.js';
import { balance } from '../services/ledger.js';
import { apiRateLimit, sendSms, sendSmsSchema, sendWhatsapp, sendWhatsappSchema } from '../services/messaging.js';

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
