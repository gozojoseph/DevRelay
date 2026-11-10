import { z } from 'zod';
import { config } from '../config.js';
import { ProviderFailure, type SmsAdapter } from './types.js';

// Arkesel (arkesel.com, Ghana) SMS rail. Documented contract from the vendor's
// own samples (arkesel.com/developer-api/sms-api, Nov 2026): POST
// {ARKESEL_BASE_URL}/sms/send with an `api-key` header and
// { sender, message, recipients }, answering 200 { status: 'success', data }.
// Live-verified 2026-11-10: `data` is an ARRAY of per-recipient results
// ({ id, recipient }), not the object the samples show, and carries top-level
// main_balance/sms_balance instead of credits_used — the adapter accepts both
// shapes and matches the echoed recipient. Delivery webhooks are advertised
// but their payload/signature spec is not machine-readable yet, so sends rest
// honestly at `accepted` until the callback contract is published
// (docs/providers.md §Arkesel). Customer billing always uses DevRelay's own
// quote; provider balances never become money in the ledger.
const perRecipientSchema = z.object({
  id: z.string().min(1).optional(), recipient: z.string().optional(), credits_used: z.number().int().optional(),
}).passthrough();
const responseSchema = z.object({
  status: z.string(),
  data: z.union([perRecipientSchema, z.array(perRecipientSchema)]).optional(),
}).passthrough();

export const arkesel: SmsAdapter = {
  async send({ recipient, sender, body }) {
    const c = config();
    if (!c.ARKESEL_API_KEY) throw new ProviderFailure('rejected', 'SMS_NOT_CONFIGURED');
    let response: globalThis.Response;
    try {
      response = await fetch(`${c.ARKESEL_BASE_URL.replace(/\/+$/, '')}/sms/send`, {
        method: 'POST',
        headers: { 'api-key': c.ARKESEL_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender, message: body, recipients: [recipient] }),
        signal: AbortSignal.timeout(12000),
      });
    } catch { throw new ProviderFailure('ambiguous', 'SMS_PROVIDER_TIMEOUT'); }
    if (response.status === 429) throw new ProviderFailure('retryable', 'SMS_RATE_LIMITED');
    if (response.status >= 500) throw new ProviderFailure('ambiguous', 'SMS_PROVIDER_UNCERTAIN');
    if (!response.ok) throw new ProviderFailure('rejected', 'SMS_PROVIDER_REJECTED');
    let parsed: z.infer<typeof responseSchema>;
    try { parsed = responseSchema.parse(await response.json()); } catch { throw new ProviderFailure('ambiguous', 'SMS_RESPONSE_UNCERTAIN'); }
    if (parsed.status !== 'success') throw new ProviderFailure('rejected', 'SMS_PROVIDER_REJECTED');
    // One recipient per send: prefer the entry echoing that number (digits
    // only — the live API echoes without the leading +), else the first entry.
    const entries = parsed.data === undefined ? [] : Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const digits = recipient.replace(/\D/g, '');
    const match = entries.find(item => item.recipient?.replace(/\D/g, '') === digits) ?? entries[0];
    const id = match?.id;
    if (!id) throw new ProviderFailure('ambiguous', 'SMS_RESPONSE_UNCERTAIN');
    return { id };
  },
};
