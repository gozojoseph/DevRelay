import { z } from 'zod';
import { config } from '../config.js';
import { ProviderFailure, type SmsAdapter } from './types.js';

// SIM-gateway rail: an Android phone running the open-source SMS Gateway
// (github.com/capcom6/android-sms-gateway) as the provider. Documented
// contract (docs.sms-gate.app): POST {url}/message with
// { textMessage: { text }, phoneNumbers, withDeliveryReport } and HTTP Basic
// auth; the response carries the gateway's message id. The SIM's own number
// is the sender — an approved alphanumeric sender ID cannot be honored by the
// device (that is a live-aggregator feature), so `sender` is deliberately
// unused here. Delivery states arrive as signed webhooks
// (sms:sent/delivered/failed/cancelled) on /api/webhooks/sms-gateway when
// GATEWAY_WEBHOOK_SECRET is configured.
const responseSchema = z.object({ id: z.string().min(1).optional(), messageId: z.string().min(1).optional() }).passthrough();

export const simGateway: SmsAdapter = {
  async send({ recipient, body }) {
    const c = config();
    if (!c.GATEWAY_URL) throw new ProviderFailure('rejected', 'SMS_NOT_CONFIGURED');
    const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (c.GATEWAY_USER || c.GATEWAY_PASSWORD) {
      headers.Authorization = `Basic ${Buffer.from(`${c.GATEWAY_USER ?? ''}:${c.GATEWAY_PASSWORD ?? ''}`).toString('base64')}`;
    }
    let response: globalThis.Response;
    try {
      response = await fetch(`${c.GATEWAY_URL.replace(/\/+$/, '')}/message`, {
        method: 'POST', headers,
        body: JSON.stringify({ textMessage: { text: body }, phoneNumbers: [recipient], withDeliveryReport: true,
          ...(c.GATEWAY_SIM_NUMBER ? { simNumber: c.GATEWAY_SIM_NUMBER } : {}) }),
        signal: AbortSignal.timeout(12000),
      });
    } catch { throw new ProviderFailure('ambiguous', 'SMS_PROVIDER_TIMEOUT'); }
    if (response.status === 429) throw new ProviderFailure('retryable', 'SMS_RATE_LIMITED');
    if (response.status >= 500) throw new ProviderFailure('ambiguous', 'SMS_PROVIDER_UNCERTAIN');
    if (!response.ok) throw new ProviderFailure('rejected', 'SMS_PROVIDER_REJECTED');
    let parsed: z.infer<typeof responseSchema>;
    try { parsed = responseSchema.parse(await response.json()); } catch { throw new ProviderFailure('ambiguous', 'SMS_RESPONSE_UNCERTAIN'); }
    const id = parsed.id ?? parsed.messageId;
    if (!id) throw new ProviderFailure('ambiguous', 'SMS_RESPONSE_UNCERTAIN');
    return { id };
  },
};
