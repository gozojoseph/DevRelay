import { describe, expect, it } from 'vitest';
import { neonAvailability, neonFunctionUrl, readConfig } from '../server/config.js';

function envWith(extra: Record<string, string>) {
  const base: Record<string, string> = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/devrelay',
    APP_ORIGIN: 'http://localhost:4000',
    PUBLIC_API_URL: 'http://localhost:4000',
    SESSION_SECRET: 'test-session-secret-ab-cdef-ghij-klmn',
    ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
  };
  // config.ts loads the repo .env via dotenv — strip Neon vars so the
  // "unconfigured" case is deterministic regardless of the local machine.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('NEON_') || key === 'DATABASE_URL_UNPOOLED') continue;
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
