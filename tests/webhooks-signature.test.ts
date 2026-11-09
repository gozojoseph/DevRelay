import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../server/lib/http.js';
import { isBlockedAddress, timingSafeString, validateWebhookUrl, webhookSignature } from '../server/services/webhooks.js';

describe('customer webhook signatures', () => {
  const body = JSON.stringify({ id: 'evt-1', type: 'message.delivered' });
  const timestamp = 1_770_000_000;

  it('signs `${timestamp}.${body}` with HMAC-SHA256 over the endpoint secret', () => {
    const expected = `sha256=${createHmac('sha256', 'whsec_test_secret').update(`${timestamp}.${body}`).digest('hex')}`;
    expect(webhookSignature('whsec_test_secret', timestamp, body)).toBe(expected);
    expect(webhookSignature('whsec_test_secret', timestamp, body)).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it('binds both the timestamp and the exact body', () => {
    const signature = webhookSignature('whsec_test_secret', timestamp, body);
    expect(webhookSignature('whsec_test_secret', timestamp, `${body} `)).not.toBe(signature);
    expect(webhookSignature('whsec_test_secret', timestamp + 1, body)).not.toBe(signature);
    expect(webhookSignature('whsec_other_secret', timestamp, body)).not.toBe(signature);
  });

  it('compares headers in constant time', () => {
    const signature = webhookSignature('whsec_test_secret', timestamp, body);
    expect(timingSafeString(signature, signature)).toBe(true);
    expect(timingSafeString(signature, `sha256=${'0'.repeat(64)}`)).toBe(false);
    expect(timingSafeString('abc', 'abcd')).toBe(false);
  });
});

describe('validateWebhookUrl', () => {
  it('accepts plain HTTPS on port 443', () => {
    const url = validateWebhookUrl('https://hooks.example.test/devrelay');
    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('hooks.example.test');
    expect(validateWebhookUrl('https://hooks.example.test:443/devrelay').href)
      .toBe('https://hooks.example.test/devrelay');
  });

  it('rejects non-HTTPS, embedded credentials and non-standard ports', () => {
    expect(() => validateWebhookUrl('http://hooks.example.test/devrelay')).toThrow(ApiError);
    expect(() => validateWebhookUrl('https://user:pass@hooks.example.test/')).toThrow(ApiError);
    expect(() => validateWebhookUrl('https://hooks.example.test:8443/')).toThrow(ApiError);
    expect(() => validateWebhookUrl('not-a-url')).toThrow(ApiError);
  });

  it('rejects private/local hostnames', () => {
    for (const host of ['localhost', 'api.localhost', 'service.internal', 'metro.local']) {
      const error = (() => {
        try { validateWebhookUrl(`https://${host}/hook`); return null; }
        catch (caught) { return caught as ApiError; }
      })();
      expect(error).toBeInstanceOf(ApiError);
      expect(error?.code).toBe('WEBHOOK_URL_BLOCKED');
    }
  });
});

describe('isBlockedAddress', () => {
  it('blocks loopback, private and special-use IPv4 ranges', () => {
    for (const address of [
      '127.0.0.1', '10.0.0.7', '172.16.0.5', '172.31.255.255', '192.168.1.1',
      '169.254.9.9', '0.0.0.0', '100.64.0.1', '198.51.100.10', '203.0.113.5',
      '224.0.0.1', '240.0.0.1', '::ffff:127.0.0.1',
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('blocks IPv6 loopback, ULA, link-local and multicast', () => {
    for (const address of ['::', '::1', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1']) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const address of ['8.8.8.8', '172.32.0.5', '185.199.108.153', '2001:4860:4860::8888']) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it('treats malformed addresses as unsafe', () => {
    expect(isBlockedAddress('999.1.1.1')).toBe(true);
    expect(isBlockedAddress('abc.def.ghi.jkl')).toBe(true);
  });
});
