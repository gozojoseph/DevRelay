import 'dotenv/config';
import { z } from 'zod';

const environment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().startsWith('postgres'),
  APP_ORIGIN: z.url(), PUBLIC_API_URL: z.url(),
  SESSION_SECRET: z.string().min(32), ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  EMAIL_MODE: z.enum(['smtp', 'console', 'mailtrap']).default('smtp'),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(), EMAIL_FROM: z.string().optional(),
  // Mailtrap Email API rail (EMAIL_MODE=mailtrap). Token:
  // https://mailtrap.io/settings/api-tokens — live sending needs a verified
  // sending domain; sandbox testing needs MAILTRAP_INBOX_ID (never in prod).
  MAILTRAP_API_TOKEN: z.string().optional(), MAILTRAP_FROM_EMAIL: z.string().optional(),
  MAILTRAP_FROM_NAME: z.string().optional(),
  MAILTRAP_USE_SANDBOX: z.enum(['true', 'false']).default('false'),
  MAILTRAP_INBOX_ID: z.coerce.number().int().positive().optional(),
  SUPPORT_EMAIL: z.email().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(), PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
  PAYSTACK_WEBHOOK_SECRETS: z.string().optional(),
  AT_USERNAME: z.string().optional(), AT_API_KEY: z.string().optional(),
  AT_MODE: z.enum(['sandbox', 'live']).default('sandbox'), AT_CALLBACK_TOKEN: z.string().optional(),
  // Alternative SMS rail (AIGH, https://aigh.dev/api/v1). SMS_PROVIDER=aigh
  // routes worker sends to it; availability then keys off AIGH_API_KEY alone.
  SMS_PROVIDER: z.enum(['africastalking', 'aigh']).default('africastalking'),
  AIGH_API_KEY: z.string().optional(), AIGH_BASE_URL: z.url().default('https://aigh.dev/api/v1'),
  META_APP_ID: z.string().optional(), META_APP_SECRET: z.string().optional(), META_CONFIG_ID: z.string().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.0$/).default('v27.0'),
  META_VERIFY_TOKEN: z.string().optional(), META_PRODUCTION_APPROVED: z.enum(['true', 'false']).default('false'),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60000).default(1500),
  // Neon platform services (env pulled by `neon deploy`). All optional;
  // each Neon service counts as unavailable when its env is absent.
  DATABASE_URL_UNPOOLED: z.string().optional(),
  NEON_BRANCH: z.string().optional(),
  NEON_BRANCH_ID: z.string().optional(),
  NEON_AUTH_BASE_URL: z.url().optional(),
  NEON_AUTH_JWKS_URL: z.url().optional(),
  NEON_FUNCTION_HOST_SUFFIX: z.string().optional(),
  NEON_AI_GATEWAY_BASE_URL: z.url().optional(),
  NEON_AI_GATEWAY_TOKEN: z.string().optional(),
  NEON_REALTIME_URL: z.url().optional(),
  NEON_REALTIME_SECRET: z.string().optional(),
});

export function readConfig(values: NodeJS.ProcessEnv = process.env) {
  const env = environment.parse(values);
  if (env.NODE_ENV === 'production') {
    if (!env.APP_ORIGIN.startsWith('https://') || !env.PUBLIC_API_URL.startsWith('https://')) throw new Error('HTTPS public origins required in production');
    // Email must be really deliverable in production — one honest rail,
    // chosen by EMAIL_MODE: legacy SMTP or the Mailtrap Email API.
    const smtpReady = env.EMAIL_MODE === 'smtp' && Boolean(env.SMTP_HOST && env.EMAIL_FROM);
    const mailtrapReady = env.EMAIL_MODE === 'mailtrap' && Boolean(env.MAILTRAP_API_TOKEN && env.MAILTRAP_FROM_EMAIL);
    if (!smtpReady && !mailtrapReady) {
      throw new Error('Real email delivery required in production: EMAIL_MODE=smtp with SMTP_HOST+EMAIL_FROM, or mailtrap with MAILTRAP_API_TOKEN+MAILTRAP_FROM_EMAIL');
    }
    if (env.EMAIL_MODE === 'mailtrap' && env.MAILTRAP_USE_SANDBOX === 'true') throw new Error('Mailtrap sandbox cannot send from production');
    if (env.AT_MODE === 'sandbox' && env.AT_API_KEY) throw new Error('AT sandbox credentials cannot send from production');
  }
  return env;
}

export type AppConfig = ReturnType<typeof readConfig>;
let cached: AppConfig | undefined;
export function config() { return cached ??= readConfig(); }
export function availability(c: AppConfig = config()) {
  return {
    paystack: Boolean(c.PAYSTACK_SECRET_KEY),
    sms: c.SMS_PROVIDER === 'aigh'
      ? Boolean(c.AIGH_API_KEY)
      : Boolean(c.AT_USERNAME && c.AT_API_KEY && c.AT_CALLBACK_TOKEN && (c.NODE_ENV !== 'production' || c.AT_MODE === 'live')),
    whatsappTest: Boolean(c.META_APP_ID && c.META_APP_SECRET && c.META_CONFIG_ID && c.META_VERIFY_TOKEN),
    whatsappLive: Boolean(c.META_PRODUCTION_APPROVED === 'true' && c.NODE_ENV === 'production' && c.META_APP_ID && c.META_APP_SECRET && c.META_CONFIG_ID && c.META_VERIFY_TOKEN),
  };
}

/** Neon platform services, next to availability(): booleans only — never secrets. */
export function neonAvailability(c: AppConfig = config()) {
  return {
    postgres: Boolean(c.DATABASE_URL),
    neonAuth: Boolean(c.NEON_AUTH_BASE_URL && c.NEON_AUTH_JWKS_URL),
    functions: Boolean(c.NEON_FUNCTION_HOST_SUFFIX),
    aiGateway: Boolean(c.NEON_AI_GATEWAY_BASE_URL && c.NEON_AI_GATEWAY_TOKEN),
    realtime: Boolean(c.NEON_REALTIME_URL && c.NEON_REALTIME_SECRET),
  };
}

/** Builds a Neon Functions URL for a deploy-declared function slug. */
export function neonFunctionUrl(c: AppConfig = config(), slug: string): string | undefined {
  if (!c.NEON_BRANCH_ID || !c.NEON_FUNCTION_HOST_SUFFIX) return undefined;
  return `https://${c.NEON_BRANCH_ID}-${slug}${c.NEON_FUNCTION_HOST_SUFFIX}/`;
}
