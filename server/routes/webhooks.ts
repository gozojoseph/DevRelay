import express, { Router } from 'express';
import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { ApiError } from '../lib/http.js';
import { safeEqual, sha256 } from '../lib/security.js';
import { verifyPaystackSignature } from '../providers/paystack.js';
import { recordPaystackEvent } from '../services/payments.js';
import { recordProviderEvent } from '../services/events.js';

export const webhookRouter = Router();

function configuredSigningSecrets() {
  const c = config();
  return [c.PAYSTACK_WEBHOOK_SECRETS, c.PAYSTACK_WEBHOOK_SECRET, c.PAYSTACK_SECRET_KEY]
    .flatMap(value => (value ?? '').split(','))
    .map(value => value.trim())
    .filter(Boolean);
}

webhookRouter.post('/paystack', express.raw({ type: 'application/json', limit: '512kb' }), async (req, res) => {
  const c = config();
  const secrets = configuredSigningSecrets();
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const signatureOk = secrets.length > 0 && verifyPaystackSignature(raw, req.header('paystack-signature'),
    req.header('x-paystack-signature'), secrets, c.PAYSTACK_SECRET_KEY);
  if (!signatureOk) throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  let event: { event?: string; data?: { reference?: string } };
  try { event = JSON.parse(raw.toString('utf8')) as typeof event; }
  catch { throw new ApiError(400, 'WEBHOOK_INVALID', 'Invalid webhook payload.'); }
  await recordPaystackEvent(raw, event);
  res.status(200).json({ received: true });
});

webhookRouter.get('/meta', (req, res) => {
  const c = config();
  const mode = req.query['hub.mode'];
  const token = String(req.query['hub.verify_token'] ?? '');
  const challenge = String(req.query['hub.challenge'] ?? '');
  if (!c.META_VERIFY_TOKEN) throw new ApiError(503, 'WHATSAPP_UNAVAILABLE', 'Meta webhooks are not configured.');
  if (mode !== 'subscribe' || !safeEqual(Buffer.from(token), Buffer.from(c.META_VERIFY_TOKEN)) || !/^\d{1,200}$/.test(challenge)) {
    throw new ApiError(403, 'WEBHOOK_VERIFICATION_FAILED', 'Meta webhook verification failed.');
  }
  res.type('text/plain').send(challenge);
});

webhookRouter.post('/meta', express.raw({ type: 'application/json', limit: '2mb' }), async (req, res) => {
  const c = config();
  if (!c.META_APP_SECRET) throw new ApiError(503, 'WHATSAPP_UNAVAILABLE', 'Meta webhooks are not configured.');
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const received = req.header('x-hub-signature-256') ?? '';
  const match = /^sha256=([0-9a-f]{64})$/.exec(received);
  if (!match) throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  const expected = createHmac('sha256', c.META_APP_SECRET).update(raw).digest();
  if (!safeEqual(expected, Buffer.from(match[1]!, 'hex'))) {
    throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw.toString('utf8')); }
  catch { throw new ApiError(400, 'WEBHOOK_INVALID', 'Invalid webhook payload.'); }
  if (!parsed || typeof parsed !== 'object' || (parsed as { object?: unknown }).object !== 'whatsapp_business_account') {
    return res.status(200).json({ received: true, ignored: true });
  }
  await recordProviderEvent({ provider: 'meta', fingerprint: sha256(raw), rawPayload: raw.toString('utf8'),
    jobKind: 'meta.webhook', payload: {} });
  res.status(200).json({ received: true });
});

webhookRouter.post('/africastalking/:token', express.json({ limit: '256kb' }),
  express.urlencoded({ extended: false, limit: '256kb' }), async (req, res) => {
  const c = config();
  if (!c.AT_CALLBACK_TOKEN) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
  const token = req.params.token ?? '';
  if (!safeEqual(Buffer.from(token), Buffer.from(c.AT_CALLBACK_TOKEN))) {
    throw new ApiError(404, 'NOT_FOUND', 'Not found.');
  }
  const raw = JSON.stringify(req.body ?? {});
  await recordProviderEvent({ provider: 'africastalking', fingerprint: sha256(raw), rawPayload: raw,
    jobKind: 'at.callback', payload: {} });
  res.status(200).json({ received: true });
});

// SMS Gateway for Android delivery callbacks. The device signs each request
// with X-Signature = HMAC-SHA256(rawBody + X-Timestamp, signing key) — see
// docs.sms-gate.app/features/webhooks (Payload Signing).
webhookRouter.post('/sms-gateway', express.raw({ type: 'application/json', limit: '256kb' }), async (req, res) => {
  const c = config();
  if (!c.GATEWAY_WEBHOOK_SECRET) throw new ApiError(503, 'SMS_GATEWAY_UNCONFIGURED', 'SMS gateway webhooks are not configured.');
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const signature = (req.header('x-signature') ?? '').trim().toLowerCase();
  const timestamp = req.header('x-timestamp') ?? '';
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!/^[0-9a-f]{64}$/.test(signature) || !Number.isFinite(ageSeconds) || ageSeconds > 300) {
    throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  }
  const expected = createHmac('sha256', c.GATEWAY_WEBHOOK_SECRET)
    .update(Buffer.concat([raw, Buffer.from(timestamp)])).digest('hex');
  if (!safeEqual(Buffer.from(expected), Buffer.from(signature))) {
    throw new ApiError(401, 'WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature.');
  }
  let parsed: { event?: unknown };
  try { parsed = JSON.parse(raw.toString('utf8')) as typeof parsed; }
  catch { throw new ApiError(400, 'WEBHOOK_INVALID', 'Invalid webhook payload.'); }
  // Only outbound state events matter; inbound sms:received family is ignored
  // (receiving is out of scope) alongside unknown event types.
  if (typeof parsed.event !== 'string' || !['sms:sent', 'sms:delivered', 'sms:failed', 'sms:cancelled'].includes(parsed.event)) {
    return res.status(200).json({ received: true, ignored: true });
  }
  await recordProviderEvent({ provider: 'sms-gateway', fingerprint: sha256(raw), rawPayload: raw.toString('utf8'),
    jobKind: 'gateway.callback', payload: {} });
  res.status(200).json({ received: true });
});
