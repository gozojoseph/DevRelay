import { describe, expect, it } from 'vitest';
import { availability, neonAvailability, neonFunctionUrl, readConfig } from '../server/config.js';

function envWith(extra: Record<string, string>) {
  const base: Record<string, string> = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/devrelay',
    APP_ORIGIN: 'http://localhost:4000',
    PUBLIC_API_URL: 'http://localhost:4000',
    SESSION_SECRET: 'test-session-secret-ab-cdef-ghij-klmn',
    ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  };
  // config.ts loads the repo .env via dotenv — strip Neon vars and the dev
  // machine's provider choice so the "unconfigured" cases are deterministic
  // regardless of the local machine.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('NEON_') || key === 'DATABASE_URL_UNPOOLED' || key === 'SMS_PROVIDER') continue;
    cleaned[key] = value;
  }
  return readConfig({ ...cleaned, ...base, ...extra });
}

describe('Neon service availability', () => {
  it('reports every Neon service unconfigured without Neon env', () => {
    const config = envWith({});
    expect(neonAvailability(config)).toEqual({
      postgres: true,
      neonAuth: false,
      functions: false,
      aiGateway: false,
      realtime: false,
    });
    expect(neonFunctionUrl(config, 'hello')).toBeUndefined();
  });

  it('reports services configured and derives function URLs from env', () => {
    const config = envWith({
      NEON_BRANCH: 'production',
      NEON_BRANCH_ID: 'br-lingering-cell-bdevndeh',
      NEON_AUTH_BASE_URL: 'https://auth.example.com',
      NEON_AUTH_JWKS_URL: 'https://auth.example.com/.well-known/jwks.json',
      NEON_FUNCTION_HOST_SUFFIX: '.compute.c-8.us-east-2.aws.neon.tech',
      NEON_AI_GATEWAY_BASE_URL: 'https://gateway.example.com',
      NEON_AI_GATEWAY_TOKEN: 'gateway-token',
      NEON_REALTIME_URL: 'https://realtime.example.com',
      NEON_REALTIME_SECRET: 'realtime-secret',
    });
    expect(neonAvailability(config)).toEqual({
      postgres: true,
      neonAuth: true,
      functions: true,
      aiGateway: true,
      realtime: true,
    });
    expect(neonFunctionUrl(config, 'hello'))
      .toBe('https://br-lingering-cell-bdevndeh-hello.compute.c-8.us-east-2.aws.neon.tech/');
  });
});

describe('production email delivery gate', () => {
  // Test env seeds AT sandbox stubs (setup-env.ts) that the production boot
  // gate rightly refuses — force them out so the email gate is what's tested.
  const prod = {
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://devrelay.example.com',
    PUBLIC_API_URL: 'https://devrelay.example.com',
    AT_MODE: 'live',
  };

  it('accepts a really-configured SMTP rail', () => {
    const c = envWith({ ...prod, EMAIL_MODE: 'smtp', SMTP_HOST: 'smtp.gmail.com', EMAIL_FROM: 'DevRelay <no-reply@devrelay.example.com>' });
    expect(c.EMAIL_MODE).toBe('smtp');
  });

  it('accepts a really-configured Mailtrap rail', () => {
    const c = envWith({ ...prod, EMAIL_MODE: 'mailtrap', MAILTRAP_API_TOKEN: 'mt-token',
      MAILTRAP_FROM_EMAIL: 'no-reply@devrelay.example.com', MAILTRAP_FROM_NAME: 'DevRelay' });
    expect(c.EMAIL_MODE).toBe('mailtrap');
    expect(c.MAILTRAP_USE_SANDBOX).toBe('false');
  });

  it('refuses production without a real email rail', () => {
    expect(() => envWith({ ...prod, EMAIL_MODE: 'smtp' })).toThrow(/email delivery/i);
    expect(() => envWith({ ...prod, EMAIL_MODE: 'console' })).toThrow(/email delivery/i);
    expect(() => envWith({ ...prod, EMAIL_MODE: 'mailtrap' })).toThrow(/email delivery/i);
    expect(() => envWith({ ...prod, EMAIL_MODE: 'mailtrap', MAILTRAP_API_TOKEN: 'mt-token' })).toThrow(/email delivery/i);
  });

  it('never allows Mailtrap sandbox to send from production', () => {
    expect(() => envWith({ ...prod, EMAIL_MODE: 'mailtrap', MAILTRAP_API_TOKEN: 'mt-token',
      MAILTRAP_FROM_EMAIL: 'no-reply@devrelay.example.com', MAILTRAP_USE_SANDBOX: 'true', MAILTRAP_INBOX_ID: '1000001' }))
      .toThrow(/sandbox/i);
  });

  it('allows Mailtrap sandbox only outside production', () => {
    const c = envWith({ EMAIL_MODE: 'mailtrap', MAILTRAP_API_TOKEN: 'mt-token',
      MAILTRAP_FROM_EMAIL: 'no-reply@devrelay.example.com', MAILTRAP_USE_SANDBOX: 'true', MAILTRAP_INBOX_ID: '1000001' });
    expect(c.MAILTRAP_INBOX_ID).toBe(1000001);
  });

  it('still refuses AT sandbox keys in production (unchanged predecessor gate)', () => {
    expect(() => envWith({ ...prod, AT_MODE: 'sandbox', EMAIL_MODE: 'smtp', SMTP_HOST: 'smtp.gmail.com', EMAIL_FROM: 'no-reply@devrelay.example.com' }))
      .toThrow(/AT sandbox/i);
  });

  it('never allows the ResellerClub sandbox URL in production (customers must never pay for unreal domains)', () => {
    expect(() => envWith({ ...prod, EMAIL_MODE: 'smtp', SMTP_HOST: 'smtp.gmail.com', EMAIL_FROM: 'no-reply@devrelay.example.com',
      DOMAIN_RESELLER_URL: 'https://api.sandbox.resellerclub.com/v2', DOMAIN_RESELLER_USERNAME: 'u', DOMAIN_RESELLER_API_KEY: 'k' }))
      .toThrow(/sandbox/i);
  });

  it('accepts the live ResellerClub URL in production', () => {
    const c = envWith({ ...prod, EMAIL_MODE: 'smtp', SMTP_HOST: 'smtp.gmail.com', EMAIL_FROM: 'no-reply@devrelay.example.com',
      DOMAIN_RESELLER_URL: 'https://api.resellerclub.com/v2', DOMAIN_RESELLER_USERNAME: 'u', DOMAIN_RESELLER_API_KEY: 'k' });
    expect(c.DOMAIN_RESELLER_URL).toBe('https://api.resellerclub.com/v2');
  });
});

describe('SMS provider selection', () => {
  it('defaults to Africa\'s Talking and keeps its credential requirements', () => {
    const c = envWith({});
    expect(c.SMS_PROVIDER).toBe('africastalking');
    // setup-env seeds AT stubs, so dev/test availability stays true.
    expect(availability(c).sms).toBe(true);
  });

  it('bases SMS availability on the AIGH key alone when SMS_PROVIDER=aigh', () => {
    // Force the key empty: the developer's local .env must not decide the outcome.
    expect(availability(envWith({ SMS_PROVIDER: 'aigh', AIGH_API_KEY: '' })).sms).toBe(false);
    expect(availability(envWith({ SMS_PROVIDER: 'aigh', AIGH_API_KEY: 'smp_test_key' })).sms).toBe(true);
  });

  it('bases SMS availability on GATEWAY_URL alone when SMS_PROVIDER=sim-gateway', () => {
    expect(availability(envWith({ SMS_PROVIDER: 'sim-gateway', GATEWAY_URL: '' })).sms).toBe(false);
    expect(availability(envWith({ SMS_PROVIDER: 'sim-gateway', GATEWAY_URL: 'http://192.168.1.20:8080' })).sms).toBe(true);
  });

  it('bases SMS availability on the Arkesel key alone when SMS_PROVIDER=arkesel', () => {
    expect(availability(envWith({ SMS_PROVIDER: 'arkesel', ARKESEL_API_KEY: '' })).sms).toBe(false);
    expect(availability(envWith({ SMS_PROVIDER: 'arkesel', ARKESEL_API_KEY: 'ark_test_key' })).sms).toBe(true);
  });

  it('bases hosting availability on the host agent URL and token together', () => {
    expect(availability(envWith({ HOST_AGENT_URL: '', HOST_AGENT_TOKEN: '' })).hosting).toBe(false);
    // Explicit empties: other test files set these env vars process-wide.
    expect(availability(envWith({ HOST_AGENT_URL: 'http://10.0.0.9:9400', HOST_AGENT_TOKEN: '' })).hosting).toBe(false);
    expect(availability(envWith({ HOST_AGENT_URL: 'http://10.0.0.9:9400', HOST_AGENT_TOKEN: 'agent-token' })).hosting).toBe(true);
  });

  it('never reports domains available while the reseller adapter is a stub, even with env set', () => {
    const flags = availability(envWith({
      DOMAIN_RESELLER_URL: 'https://reseller-api.example.com',
      DOMAIN_RESELLER_USERNAME: 'reseller@example.com',
      DOMAIN_RESELLER_API_KEY: 'reseller-key',
    }));
    expect(flags.domains).toBe(false); // readiness is adapter-driven, not env-driven
  });
});
