import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { promises as dns } from 'node:dns';
import https from 'node:https';
import { and, eq } from 'drizzle-orm';
import { db, type DbTransaction } from '../db/client.js';
import { auditEvents, messages, webhookAttempts, webhookEndpoints, webhookEvents } from '../db/schema.js';
import { ApiError, assert } from '../lib/http.js';
import { decrypt, encrypt } from '../lib/security.js';
import { enqueue } from './jobs.js';

const BLOCKED_V4: [number, number, number, number, number][] = [
  [0, 0, 0, 0, 8], [10, 0, 0, 0, 8], [100, 64, 0, 0, 10], [127, 0, 0, 0, 8],
  [169, 254, 0, 0, 16], [172, 16, 0, 0, 12], [192, 0, 0, 0, 24], [192, 0, 2, 0, 24],
  [192, 168, 0, 0, 16], [198, 18, 0, 0, 15], [198, 51, 100, 0, 24], [203, 0, 113, 0, 24],
  [224, 0, 0, 0, 4], [240, 0, 0, 0, 4],
];

function inV4Range(address: string) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const numeric = ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
  return BLOCKED_V4.some(([a, b, c, d, bits]) => {
    const base = ((a! << 24) | (b! << 16) | (c! << 8) | d!) >>> 0;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (numeric & mask) === (base & mask);
  });
}

export function isBlockedAddress(address: string) {
  const value = address.toLowerCase().split('%')[0]!;
  if (value.includes('.')) {
    const v4 = value.startsWith('::ffff:') ? value.slice(7) : value;
    return inV4Range(v4);
  }
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') ||
    value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff')) return true;
  return false;
}

export function validateWebhookUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ApiError(400, 'WEBHOOK_URL_INVALID', 'Enter a valid HTTPS webhook URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') {
    throw new ApiError(400, 'WEBHOOK_URL_INVALID', 'Webhook URLs must use HTTPS on port 443 without embedded credentials.');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.internal') || url.hostname.endsWith('.local')) {
    throw new ApiError(400, 'WEBHOOK_URL_BLOCKED', 'That webhook destination is not permitted.');
  }
  return url;
}

async function resolveSafety(url: URL) {
  let addresses: { address: string; family: number }[];
  try { addresses = await dns.lookup(url.hostname, { all: true, verbatim: true }); }
  catch { throw new Error('Webhook hostname could not be resolved'); }
  if (!addresses.length || addresses.some(item => isBlockedAddress(item.address))) throw new Error('Webhook destination resolves to a blocked network');
  return addresses;
}

async function requestPinned(url: URL, body: string, headers: Record<string, string>) {
  const addresses = await resolveSafety(url);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, value?: { status: number; body: string }) => {
      if (settled) return; settled = true;
      if (error) reject(error); else resolve(value!);
    };
    const req = https.request(url, {
      method: 'POST', headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body)) },
      timeout: 10_000, rejectUnauthorized: true, servername: url.hostname,
      lookup: (_hostname, _options, callback) => {
        // Use only addresses validated immediately before connection. We do not
        // follow redirects; connection is pinned so DNS rebinding cannot switch it.
        const selected = addresses[0]!;
        (callback as unknown as (err: NodeJS.ErrnoException | null, address: string, family: number) => void)(null, selected.address, selected.family);
      },
    }, response => {
      let received = 0; const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > 65536) { response.destroy(new Error('Webhook response exceeded 64 KiB')); return; }
        chunks.push(chunk);
      });
      response.on('end', () => finish(undefined, { status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      response.on('error', error => finish(error));
    });
    req.on('timeout', () => req.destroy(new Error('Webhook timed out')));
    req.on('error', error => finish(error));
    req.end(body);
  });
}

export function webhookSignature(secret: string, timestamp: number, body: string) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function timingSafeString(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function createEndpoint(input: { accountId: string; projectId: string; url: string; events: string[] }) {
  const url = validateWebhookUrl(input.url);
  await resolveSafety(url).catch(error => { throw new ApiError(400, 'WEBHOOK_URL_BLOCKED', error instanceof Error ? error.message : 'Unsafe webhook URL.'); });
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const [endpoint] = await db.insert(webhookEndpoints).values({ accountId: input.accountId, projectId: input.projectId,
    url: url.toString(), secretEncrypted: encrypt(secret, `webhook:${input.projectId}`), events: input.events }).returning();
  assert(endpoint, 500, 'WEBHOOK_ERROR', 'Could not save webhook endpoint.');
  return { endpoint: { id: endpoint.id, url: endpoint.url, events: endpoint.events, active: endpoint.active }, secret };
}

export async function emitMessageEvent(tx: DbTransaction, message: typeof messages.$inferSelect, type: string) {
  if (!message.projectId) return;
  const endpoints = await tx.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.projectId, message.projectId),
    eq(webhookEndpoints.active, true)));
  if (!endpoints.length) return;
  const payload = { id: message.id, type, createdAt: new Date().toISOString(), data: {
    messageId: message.id, channel: message.channel, recipient: message.recipient, status: message.status,
    segments: message.segments, chargedMinor: message.chargedMinor, currency: 'GHS', errorCode: message.errorCode,
    templateName: message.templateName,
  } };
  const [event] = await tx.insert(webhookEvents).values({ accountId: message.accountId, projectId: message.projectId,
    messageId: message.id, type, payload }).returning();
  assert(event, 500, 'WEBHOOK_ERROR', 'Could not create webhook event.');
  for (const endpoint of endpoints) {
    if (!endpoint.events.includes(type) && !endpoint.events.includes('*')) continue;
    await enqueue(tx, { kind: 'webhook.deliver', dedupKey: `webhook:${event.id}:${endpoint.id}`,
      accountId: message.accountId, projectId: message.projectId, payload: { eventId: event.id, endpointId: endpoint.id }, maxAttempts: 8 });
  }
}

export async function sendTestEndpoint(input: { accountId: string; projectId: string; endpointId: string; actorUserId: string }) {
  const [endpoint] = await db.select().from(webhookEndpoints).where(and(eq(webhookEndpoints.id, input.endpointId),
    eq(webhookEndpoints.projectId, input.projectId), eq(webhookEndpoints.accountId, input.accountId)));
  assert(endpoint, 404, 'WEBHOOK_NOT_FOUND', 'Webhook endpoint not found.');
  const [event] = await db.insert(webhookEvents).values({ accountId: input.accountId, projectId: input.projectId,
    type: 'webhook.test', payload: { id: randomUUID(), type: 'webhook.test', createdAt: new Date().toISOString(),
      data: { message: 'DevRelay test event. This is not a delivery report.' } } }).returning();
  assert(event, 500, 'WEBHOOK_ERROR', 'Could not create test event.');
  await db.transaction(async tx => {
    await enqueue(tx, { kind: 'webhook.deliver', dedupKey: `webhook:${event.id}:${endpoint.id}`, accountId: input.accountId,
      projectId: input.projectId, payload: { eventId: event.id, endpointId: endpoint.id }, maxAttempts: 3 });
    await tx.insert(auditEvents).values({ actorUserId: input.actorUserId, accountId: input.accountId, action: 'webhook.test_sent',
      targetType: 'webhook_endpoint', targetId: endpoint.id });
  });
  return { eventId: event.id, message: 'Test event queued.' };
}

export async function deliverWebhook(input: { eventId: string; endpointId: string; attempt: number }) {
  const [row] = await db.select({ event: webhookEvents, endpoint: webhookEndpoints }).from(webhookEvents)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, input.endpointId)).where(and(eq(webhookEvents.id, input.eventId),
      eq(webhookEndpoints.projectId, webhookEvents.projectId)));
  if (!row || !row.endpoint.active) return { skipped: true };
  const url = validateWebhookUrl(row.endpoint.url);
  const body = JSON.stringify(row.event.payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const secret = decrypt(row.endpoint.secretEncrypted, `webhook:${row.endpoint.projectId}`);
  const signature = webhookSignature(secret, timestamp, body);
  let attemptRecorded = false;
  try {
    const response = await requestPinned(url, body, {
      'Content-Type': 'application/json', 'User-Agent': 'DevRelay-Webhooks/1.0',
      'X-DevRelay-Event-Id': row.event.id, 'X-DevRelay-Timestamp': String(timestamp), 'X-DevRelay-Signature': signature,
    });
    await db.insert(webhookAttempts).values({ eventId: row.event.id, endpointId: row.endpoint.id, attempt: input.attempt,
      httpStatus: response.status, error: response.status >= 200 && response.status < 300 ? null : `HTTP ${response.status}` });
    attemptRecorded = true;
    if (response.status < 200 || response.status >= 300) throw new Error(`Webhook returned HTTP ${response.status}`);
    return { status: response.status };
  } catch (error) {
    if (!attemptRecorded) {
      const message = error instanceof Error ? error.message.slice(0, 190) : 'Webhook delivery failed';
      await db.insert(webhookAttempts).values({ eventId: row.event.id, endpointId: row.endpoint.id, attempt: input.attempt, error: message });
    }
    throw error;
  }
}
