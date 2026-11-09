import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { config } from '../config.js';
import { ApiError } from '../lib/http.js';
import { ProviderFailure, type WhatsappAdapter } from './types.js';

const phoneSchema = z.object({ data: z.array(z.object({ id: z.string(), display_phone_number: z.string().optional(),
  verified_name: z.string().optional(), quality_rating: z.string().optional(), status: z.string().optional() })) });
export type MetaPhone = z.infer<typeof phoneSchema>['data'][number];

function versioned(path: string, token?: string) {
  const c = config();
  const url = new URL(`https://graph.facebook.com/${c.META_GRAPH_VERSION}/${path.replace(/^\//, '')}`);
  if (token && c.META_APP_SECRET) url.searchParams.set('appsecret_proof', createHmac('sha256', c.META_APP_SECRET).update(token).digest('hex'));
  return url;
}
export async function graph<T>(path: string, token: string, options?: RequestInit): Promise<T> {
  let response: globalThis.Response;
  try {
    response = await fetch(versioned(path, token), { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...options?.headers },
      signal: AbortSignal.timeout(12000) });
  } catch { throw new ProviderFailure('ambiguous', 'META_PROVIDER_TIMEOUT'); }
  if (response.status === 429) throw new ProviderFailure('retryable', 'META_RATE_LIMITED');
  if (response.status >= 500) throw new ProviderFailure('ambiguous', 'META_PROVIDER_UNCERTAIN');
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new ProviderFailure('rejected', 'META_TOKEN_OR_PERMISSION');
    throw new ProviderFailure('rejected', 'META_REQUEST_REJECTED');
  }
  try { return await response.json() as T; } catch { throw new ProviderFailure('ambiguous', 'META_RESPONSE_UNCERTAIN'); }
}

export async function exchangeSignupCode(code: string) {
  const c = config();
  if (!c.META_APP_ID || !c.META_APP_SECRET) throw new ApiError(503, 'META_UNAVAILABLE', 'Meta onboarding is not configured.');
  const url = versioned('oauth/access_token');
  url.searchParams.set('client_id', c.META_APP_ID);
  url.searchParams.set('client_secret', c.META_APP_SECRET);
  url.searchParams.set('code', code);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new ApiError(502, 'META_SIGNUP_FAILED', 'Meta code exchange failed. Restart Embedded Signup; codes are single-use and short-lived.');
    return z.object({ access_token: z.string().min(12), expires_in: z.number().optional() }).parse(await response.json());
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(502, 'META_SIGNUP_UNCERTAIN', 'Meta signup could not be confirmed. Restart Embedded Signup.');
  }
}

export async function verifyAndSubscribe(token: string, wabaId: string, phoneId: string) {
  const phones = phoneSchema.parse(await graph<unknown>(`${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status`, token));
  const phone = phones.data.find(item => item.id === phoneId);
  if (!phone) throw new ApiError(403, 'META_ASSET_NOT_GRANTED', 'This number was not granted to your Meta connection.');
  const subscribed = await graph<{ success?: boolean }>(`${wabaId}/subscribed_apps`, token, { method: 'POST' });
  if (!subscribed.success) throw new ApiError(502, 'META_SUBSCRIPTION_FAILED', 'Meta webhook subscription could not be confirmed.');
  return phone;
}

export async function registerPhone(token: string, phoneId: string, pin: string) {
  const result = await graph<{ success?: boolean }>(`${phoneId}/register`, token, { method: 'POST', body: JSON.stringify({ messaging_product: 'whatsapp', pin }) });
  if (!result.success) throw new ApiError(502, 'META_REGISTRATION_FAILED', 'Meta phone registration could not be confirmed.');
}

const templateSchema = z.object({ data: z.array(z.object({
  id: z.string().optional(), name: z.string(), language: z.string(), status: z.string(),
  category: z.string(), components: z.array(z.object({ type: z.string(), text: z.string().optional(),
    format: z.string().optional(), example: z.unknown().optional() })).optional(),
  rejected_reason: z.string().optional(),
})) });
export type MetaTemplate = z.infer<typeof templateSchema>['data'][number];

export function templateBody(template: MetaTemplate) {
  return template.components?.find(component => component.type === 'BODY')?.text ?? '';
}

export function variableCount(body: string) {
  const matches = [...body.matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
  return matches.length ? Math.max(...matches) : 0;
}

export async function listTemplates(token: string, wabaId: string) {
  const result = templateSchema.parse(await graph<unknown>(
    `${wabaId}/message_templates?fields=id,name,language,status,category,components,rejected_reason&limit=100`, token));
  return result.data;
}

export async function createTemplate(token: string, wabaId: string, input: {
  name: string; language: string; category: string; body: string; examples?: string[];
}) {
  const components: Record<string, unknown>[] = [{ type: 'BODY', text: input.body }];
  const count = variableCount(input.body);
  if (count > 0) {
    const examples = Array.from({ length: count }, (_, index) => input.examples?.[index]?.trim() || `example ${index + 1}`);
    components[0]!.example = { body_text: [examples] };
  }
  const result = await graph<{ id?: string; status?: string; category?: string }>(`${wabaId}/message_templates`, token, {
    method: 'POST', body: JSON.stringify({ name: input.name, language: input.language, category: input.category, components }),
  });
  return result;
}

export const metaCloud: WhatsappAdapter = {
  async send({ phoneId, recipient, body, template, token, messageId }) {
    const payload = {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient,
      biz_opaque_callback_data: messageId,
      ...(template ? { type: 'template', template: { name: template.name, language: { code: template.language },
        ...(template.variables.length ? { components: [{ type: 'body', parameters: template.variables.map(text => ({ type: 'text', text })) }] } : {}) } }
        : { type: 'text', text: { body } }),
    };
    const data = await graph<unknown>(`${phoneId}/messages`, token, { method: 'POST', body: JSON.stringify(payload) });
    const parsed = z.object({ messages: z.array(z.object({ id: z.string() })).min(1) }).safeParse(data);
    if (!parsed.success) throw new ProviderFailure('ambiguous', 'META_RESPONSE_UNCERTAIN');
    return { id: parsed.data.messages[0]!.id };
  },
};
