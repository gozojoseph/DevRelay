import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The adapter reads config() lazily at send time; seed the key before the
// first import so the cached config sees it.
process.env.ARKESEL_API_KEY = 'ark_devrelay_test_key';

const { arkesel } = await import('../server/providers/arkesel.js');

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const sendArgs = { recipient: '+233201234567', sender: 'Affordable', body: 'hello' };

describe('Arkesel SMS adapter', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts the documented contract with the api-key header and honored sender', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: 'success', data: { id: 'msg_9f8k2j', credits_used: 1 } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(arkesel.send(sendArgs)).resolves.toEqual({ id: 'msg_9f8k2j' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sms.arkesel.com/api/v2/sms/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['api-key']).toBe('ark_devrelay_test_key');
    expect(JSON.parse(String(init.body))).toEqual({
      sender: 'Affordable', message: 'hello', recipients: ['+233201234567'] });
  });

  it('never invents an id when the success payload has none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'success', data: {} })));
    await expect(arkesel.send(sendArgs))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_RESPONSE_UNCERTAIN' });
  });

  it('maps a named failure envelope to an honest rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'error', message: 'Invalid API key.' })));
    await expect(arkesel.send(sendArgs))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'SMS_PROVIDER_REJECTED' });
  });

  it('maps HTTP statuses: 429 retryable, 5xx ambiguous, other non-OK rejected', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 429)));
    await expect(arkesel.send(sendArgs)).rejects.toMatchObject({ kind: 'retryable', publicCode: 'SMS_RATE_LIMITED' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(arkesel.send(sendArgs)).rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_PROVIDER_UNCERTAIN' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 400)));
    await expect(arkesel.send(sendArgs)).rejects.toMatchObject({ kind: 'rejected', publicCode: 'SMS_PROVIDER_REJECTED' });
  });

  it('treats an unparseable success body as uncertain, not failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as unknown as Response));
    await expect(arkesel.send(sendArgs))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_RESPONSE_UNCERTAIN' });
  });

  it('treats a network failure as ambiguous (the provider may have accepted)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(arkesel.send(sendArgs))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_PROVIDER_TIMEOUT' });
  });
});
