import 'dotenv/config';
import { z } from 'zod';

const environment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().startsWith('postgres'),
  APP_ORIGIN: z.url(), PUBLIC_API_URL: z.url(),
  SESSION_SECRET: z.string().min(32), ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/),
  EMAIL_MODE: z.enum(['smtp', 'console']).default('smtp'),
  SMTP_HOST: z.string().optional(), SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().optional(), SMTP_PASSWORD: z.string().optional(), EMAIL_FROM: z.string().optional(),
  SUPPORT_EMAIL: z.email().optional(),
  PAYSTACK_SECRET_KEY: z.string().optional(), PAYSTACK_WEBHOOK_SECRET: z.string().optional(),
  PAYSTACK_WEBHOOK_SECRETS: z.string().optional(),
  AT_USERNAME: z.string().optional(), AT_API_KEY: z.string().optional(),
  AT_MODE: z.enum(['sandbox', 'live']).default('sandbox'), AT_CALLBACK_TOKEN: z.string().optional(),
  META_APP_ID: z.string().optional(), META_APP_SECRET: z.string().optional(), META_CONFIG_ID: z.string().optional(),
  META_GRAPH_VERSION: z.string().regex(/^v\d+\.0$/).default('v27.0'),
  META_VERIFY_TOKEN: z.string().optional(), META_PRODUCTION_APPROVED: z.enum(['true', 'false']).default('false'),
  WORKER_POLL_MS: z.coerce.number().int().min(250).max(60000).default(1500),
});

export function readConfig(values: NodeJS.ProcessEnv = process.env) {
  const env = environment.parse(values);
  if (env.NODE_ENV === 'production') {
    if (!env.APP_ORIGIN.startsWith('https://') || !env.PUBLIC_API_URL.startsWith('https://')) throw new Error('HTTPS public origins required in production');
    if (env.EMAIL_MODE !== 'smtp' || !env.SMTP_HOST || !env.EMAIL_FROM) throw new Error('SMTP required in production');
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
    sms: Boolean(c.AT_USERNAME && c.AT_API_KEY && c.AT_CALLBACK_TOKEN && (c.NODE_ENV !== 'production' || c.AT_MODE === 'live')),
    whatsappTest: Boolean(c.META_APP_ID && c.META_APP_SECRET && c.META_CONFIG_ID && c.META_VERIFY_TOKEN),
    whatsappLive: Boolean(c.META_PRODUCTION_APPROVED === 'true' && c.NODE_ENV === 'production' && c.META_APP_ID && c.META_APP_SECRET && c.META_CONFIG_ID && c.META_VERIFY_TOKEN),
  };
}
