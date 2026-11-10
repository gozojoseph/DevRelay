import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The adapter reads config() lazily at send time; seed the gateway settings
// before the first import so the cached config sees them. The trailing slash
// proves the adapter normalizes the base URL.
process.env.GATEWAY_URL = 'http://192.168.1.20:8080/';
process.env.GATEWAY_USER = 'devrelay';
process.env.GATEWAY_PASSWORD = 'gateway-pass';

const { simGateway } = await import('../server/providers/sim-gateway.js');

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const sendArgs = { recipient: '+233201234567', sender: 'DEVRELAY', body: 'hello' };

describe('SIM-gateway SMS adapter (Android SMS Gateway)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts the documented contract with Basic auth and never a sender id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'gw-1' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(simGateway.send(sendArgs)).resolves.toEqual({ id: 'gw-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://192.168.1.20:8080/message');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization)
      .toBe(`Basic ${Buffer.from('devrelay:gateway-pass').toString('base64')}`);
    expect(JSON.parse(String(init.body))).toEqual({
      textMessage: { text: 'hello' }, phoneNumbers: ['+233201234567'], withDeliveryReport: true });
  });

  it('accepts messageId as the provider-id field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ messageId: 'gw-2' })));
    await expect(simGateway.send(sendArgs)).resolves.toEqual({ id: 'gw-2' });
  });

  it('never invents an id when the acceptance payload has none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })));
    await expect(simGateway.send(sendArgs))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_RESPONSE_UNCERTAIN' });
  });

  it('maps HTTP statuses: 429 retryable, 5xx ambiguous, other non-OK rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 429)));
    await expect(simGateway.send(sendArgs)).rejects.toMatchObject({ kind: 'retryable', publicCode: 'SMS_RATE_LIMITED' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(simGateway.send(sendArgs)).rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_PROVIDER_UNCERTAIN' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 400)));
    await expect(simGateway.send(sendArgs)).rejects.toMatchObject({ kind: 'rejected', publicCode: 'SMS_PROVIDER_REJECTED' });
  });

  it('treats an unparseable success body as uncertain, not failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as unknown as Response));
    await expect(simGateway.send(sendArgs))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_RESPONSE_UNCERTAIN' });
  });

  it('treats a network failure as ambiguous (the gateway may have accepted)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(simGateway.send(sendArgs))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_PROVIDER_TIMEOUT' });
  });
});
