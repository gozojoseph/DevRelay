import { z } from 'zod';
import { config } from '../config.js';
import { ProviderFailure, type SmsAdapter } from './types.js';

// AIGH (https://aigh.dev/api/v1) publishes an overview only: Bearer auth with
// `smp_`-prefixed keys, a uniform `{ success, message, data }` envelope and an
// SMS family ("send bulk SMS, track delivery, manage sender IDs"). The full
// SMS reference (send path, field names, delivery webhooks, cost fields) was
// not available when this adapter was written, so the send contract below is
// provisional. Honesty rules: success is reported only on the documented
// envelope with an extractable provider message id — anything else fails as
// rejected/ambiguous and the message lands in pending_reconciliation, never
// in a simulated success. Customer billing always uses DevRelay's own quote.
const SEND_PATH = '/sms/send';

const envelopeSchema = z.object({ success: z.boolean(), message: z.string().optional(), data: z.unknown().optional() });

/** Pulls a provider message id out of the undocumented `data` shape. */
export function extractProviderId(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ['id', 'messageId', 'message_id', 'smsId', 'sms_id']) {
    const value = record[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  return undefined;
}

export const aigh: SmsAdapter = {
  async send({ recipient, sender, body }) {
    const c = config();
    if (!c.AIGH_API_KEY) throw new ProviderFailure('rejected', 'SMS_NOT_CONFIGURED');
    let response: globalThis.Response;
    try {
      response = await fetch(`${c.AIGH_BASE_URL}${SEND_PATH}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.AIGH_API_KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient, from: sender, message: body }),
        signal: AbortSignal.timeout(12000),
      });
    } catch { throw new ProviderFailure('ambiguous', 'SMS_PROVIDER_TIMEOUT'); }
    if (response.status === 429) throw new ProviderFailure('retryable', 'SMS_RATE_LIMITED');
    if (response.status >= 500) throw new ProviderFailure('ambiguous', 'SMS_PROVIDER_UNCERTAIN');
    if (!response.ok) throw new ProviderFailure('rejected', 'SMS_PROVIDER_REJECTED');
    let envelope: z.infer<typeof envelopeSchema>;
    try { envelope = envelopeSchema.parse(await response.json()); } catch { throw new ProviderFailure('ambiguous', 'SMS_RESPONSE_UNCERTAIN'); }
    if (!envelope.success) throw new ProviderFailure('rejected', 'SMS_PROVIDER_REJECTED');
    const id = extractProviderId(envelope.data);
    if (!id) throw new ProviderFailure('ambiguous', 'SMS_RESPONSE_UNCERTAIN');
    return { id };
  },
};
