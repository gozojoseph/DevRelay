import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { ApiError } from '../lib/http.js';
import { safeEqual } from '../lib/security.js';

export function verifyPaystackSignature(raw: Buffer, newHeader: string | undefined, legacyHeader: string | undefined,
  secrets: string[], legacySecret: string | undefined, now = Math.floor(Date.now() / 1000)) {
  // If a timestamped signature is present, NEVER fall back to the legacy header.
  if (newHeader) {
    const parts = newHeader.split(',').map(part => part.trim());
    const timestamps = parts.filter(part => part.startsWith('t='));
    if (timestamps.length !== 1 || !/^t=\d+$/.test(timestamps[0]!)) return false;
    const timestamp = Number(timestamps[0]!.slice(2));
    if (Math.abs(now - timestamp) > 300) return false;
    const signatures = parts.filter(part => /^v1=whk_[^:]+:[0-9a-f]{128}$/.test(part)).map(part => part.split(':')[1]!);
    return secrets.some(secret => {
      const expected = createHmac('sha512', secret).update(`${timestamp}.`).update(raw).digest();
      return signatures.some(sig => safeEqual(expected, Buffer.from(sig, 'hex')));
    });
  }
  if (!legacySecret || !legacyHeader || !/^[0-9a-f]{128}$/.test(legacyHeader)) return false;
  return safeEqual(createHmac('sha512', legacySecret).update(raw).digest(), Buffer.from(legacyHeader, 'hex'));
}

const verifiedSchema = z.object({
  status: z.literal(true), data: z.object({
    status: z.string(), reference: z.string(), amount: z.number().int().positive(), currency: z.string(),
    id: z.union([z.string(), z.number()]).optional(),
    customer: z.object({ email: z.email() }),
    metadata: z.unknown().optional(),
  }),
});
export type VerifiedPayment = z.infer<typeof verifiedSchema>['data'];

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const secret = config().PAYSTACK_SECRET_KEY;
  if (!secret) throw new ApiError(503, 'PAYMENT_UNAVAILABLE', 'Funding is not configured. Contact support.');
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...options, headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', ...options?.headers },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new ApiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Payment provider is temporarily unavailable. Try again later.');
  return await response.json() as T;
}

export async function initializePayment(input: { amountMinor: number; email: string; reference: string; accountId: string; callbackUrl: string }) {
  const result = await api<{ status: boolean; data?: { authorization_url: string; reference: string } }>('/transaction/initialize', {
    method: 'POST', body: JSON.stringify({ amount: input.amountMinor, currency: 'GHS', email: input.email,
      reference: input.reference, callback_url: input.callbackUrl, metadata: { devrelay_account_id: input.accountId } }),
  });
  if (!result.status || !result.data || result.data.reference !== input.reference || !result.data.authorization_url.startsWith('https://checkout.paystack.com/')) {
    throw new ApiError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Checkout could not be started. Try again later.');
  }
  return result.data.authorization_url;
}

export async function verifyPayment(reference: string) {
  return verifiedSchema.parse(await api(`/transaction/verify/${encodeURIComponent(reference)}`)).data;
}

export function matchesPayment(verified: VerifiedPayment, expected: { reference: string; amountMinor: number; currency: string; email: string; accountId: string }) {
  let metadata: Record<string, unknown> = {};
  try { metadata = typeof verified.metadata === 'string' ? JSON.parse(verified.metadata) as Record<string, unknown> : (verified.metadata ?? {}) as Record<string, unknown>; } catch { return false; }
  return verified.status === 'success' && verified.reference === expected.reference && verified.amount === expected.amountMinor
    && verified.currency === expected.currency && verified.customer.email.toLowerCase() === expected.email.toLowerCase()
    && metadata.devrelay_account_id === expected.accountId;
}
