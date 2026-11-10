import { z } from 'zod';
import { config } from '../config.js';
import { ProviderFailure, type SmsAdapter } from './types.js';

// Arkesel (arkesel.com, Ghana) SMS rail. Documented contract from the vendor's
// own samples (arkesel.com/developer-api/sms-api, Nov 2026): POST
// {ARKESEL_BASE_URL}/sms/send with an `api-key` header and
// { sender, message, recipients }, answering 200
// { status: 'success', data: { id, credits_used? } }. Delivery webhooks are
// advertised but their payload/signature spec is not machine-readable yet, so
// sends rest honestly at `accepted` until the callback contract is published
// (docs/providers.md §Arkesel). Customer billing always uses DevRelay's own
// quote; credits_used never becomes money — a credit's GHS value depends on
// the buyer's prepaid bundle tier, which DevRelay cannot know.
const responseSchema = z.object({
  status: z.string(),
  data: z.object({ id: z.string().min(1).optional(), credits_used: z.number().int().optional() })
    .passthrough().optional(),
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
    const id = parsed.data?.id;
    if (!id) throw new ProviderFailure('ambiguous', 'SMS_RESPONSE_UNCERTAIN');
    return { id };
  },
};
