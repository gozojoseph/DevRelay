import { z } from 'zod';
import { config } from '../config.js';
import { ProviderFailure, type SmsAdapter } from './types.js';

const resultSchema = z.object({ SMSMessageData: z.object({ Message: z.string().optional(), Recipients: z.array(z.object({
  statusCode: z.number().int(), number: z.string(), messageId: z.string().optional(), cost: z.string().optional(),
})) }) });

// No floating point: provider strings such as "GHS 0.8000" round to the
// nearest pesewa (half up) for reporting only. Customer billing uses quote.
export function parseSupplierCost(cost: string | undefined) {
  const match = /^(?<currency>[A-Z]{3}) (?<units>\d+)(?:\.(?<fraction>\d+))?$/.exec(cost ?? '');
  if (!match?.groups) return null;
  const fraction = (match.groups.fraction ?? '').padEnd(3, '0');
  const value = Number(match.groups.units) * 100 + Number(fraction.slice(0, 2)) + (Number(fraction[2]) >= 5 ? 1 : 0);
  return Number.isSafeInteger(value) ? { supplierCostMinor: value, supplierCurrency: match.groups.currency! } : null;
}

export const africasTalking: SmsAdapter = {
  async send({ recipient, sender, body }) {
    const c = config();
    if (!c.AT_API_KEY || !c.AT_USERNAME) throw new ProviderFailure('rejected', 'SMS_NOT_CONFIGURED');
    const sandbox = c.AT_MODE === 'sandbox';
    const url = sandbox ? 'https://api.sandbox.africastalking.com/version1/messaging' : 'https://api.africastalking.com/version1/messaging/bulk';
    // Sandbox forbids custom sender IDs (approval is a live-account feature):
    // with `from` it answers 201 "InvalidSenderId" and sends nothing, so the
    // field is omitted there and the message leaves from the sandbox default.
    const payload = sandbox
      ? new URLSearchParams({ username: c.AT_USERNAME, to: recipient, message: body }).toString()
      : JSON.stringify({ username: c.AT_USERNAME, phoneNumbers: [recipient], senderId: sender, message: body, enqueue: 1 });
    let response: globalThis.Response;
    try {
      response = await fetch(url, { method: 'POST', headers: {
        apiKey: c.AT_API_KEY, Accept: 'application/json', 'Content-Type': sandbox ? 'application/x-www-form-urlencoded' : 'application/json',
      }, body: payload, signal: AbortSignal.timeout(12000) });
    } catch { throw new ProviderFailure('ambiguous', 'SMS_PROVIDER_TIMEOUT'); }
    if (response.status === 429) throw new ProviderFailure('retryable', 'SMS_RATE_LIMITED');
    if (response.status >= 500) throw new ProviderFailure('ambiguous', 'SMS_PROVIDER_UNCERTAIN');
    if (!response.ok) throw new ProviderFailure('rejected', 'SMS_PROVIDER_REJECTED');
    let data: z.infer<typeof resultSchema>;
    try { data = resultSchema.parse(await response.json()); } catch { throw new ProviderFailure('ambiguous', 'SMS_RESPONSE_UNCERTAIN'); }
    const result = data.SMSMessageData.Recipients.find(item => item.number === recipient);
    if (!result) {
      // An empty Recipients list is a definitive refusal — the provider named
      // the error (for example InvalidSenderId) and dispatched nothing — so it
      // fails with a charge release instead of parking credits indefinitely.
      if (data.SMSMessageData.Recipients.length === 0) {
        throw new ProviderFailure('rejected',
          data.SMSMessageData.Message === 'InvalidSenderId' ? 'SMS_PROVIDER_INVALID_SENDER_ID' : 'SMS_PROVIDER_REJECTED');
      }
      throw new ProviderFailure('ambiguous', 'SMS_RESPONSE_UNCERTAIN');
    }
    if ([100, 101, 102].includes(result.statusCode) && result.messageId && result.messageId !== 'None') {
      return { id: result.messageId, ...parseSupplierCost(result.cost) };
    }
    if (result.statusCode >= 500) throw new ProviderFailure('ambiguous', 'SMS_PROVIDER_UNCERTAIN');
    throw new ProviderFailure('rejected', `SMS_PROVIDER_${result.statusCode}`);
  },
};
