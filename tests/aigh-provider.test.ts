import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The adapter reads config() lazily at send time; seed the key before the
// first import so the cached config sees it.
process.env.AIGH_API_KEY = 'smp_devrelay_test_key';

const { aigh, extractProviderId } = await import('../server/providers/aigh.js');

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const sendArgs = { recipient: '+233201234567', sender: 'DEVRELAY', body: 'hello' };

describe('AIGH SMS adapter', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts the provisional contract and reports the provider id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, message: 'OK', data: { id: 'aigh-msg-1' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(aigh.send(sendArgs)).resolves.toEqual({ id: 'aigh-msg-1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://aigh.dev/api/v1/sms/send');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer smp_devrelay_test_key');
    expect(JSON.parse(String(init.body))).toEqual({ to: '+233201234567', from: 'DEVRELAY', message: 'hello' });
  });

  it('accepts alternative provider-id field names in data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { messageId: 'm-2' } })));
    await expect(aigh.send(sendArgs)).resolves.toEqual({ id: 'm-2' });
  });

  it('never invents an id when the success payload has none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { ok: true } })));
    await expect(aigh.send(sendArgs))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_RESPONSE_UNCERTAIN' });
  });

  it('maps a documented failure envelope to an honest rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: false, message: 'Invalid API key.' })));
    await expect(aigh.send(sendArgs))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'SMS_PROVIDER_REJECTED' });
  });

  it('maps HTTP statuses: 4xx rejected, 429 retryable, 5xx ambiguous', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 400)));
    await expect(aigh.send(sendArgs)).rejects.toMatchObject({ kind: 'rejected' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 429)));
    await expect(aigh.send(sendArgs)).rejects.toMatchObject({ kind: 'retryable', publicCode: 'SMS_RATE_LIMITED' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 503)));
    await expect(aigh.send(sendArgs)).rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_PROVIDER_UNCERTAIN' });
  });

  it('treats an unparseable success body as uncertain, not failed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as unknown as Response));
    await expect(aigh.send(sendArgs))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_RESPONSE_UNCERTAIN' });
  });

  it('treats a network failure as ambiguous (the provider may have accepted)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));
    await expect(aigh.send(sendArgs))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_PROVIDER_TIMEOUT' });
  });

  it('extracts ids only from non-empty string fields', () => {
    expect(extractProviderId({ id: 'x' })).toBe('x');
    expect(extractProviderId({ id: 42 })).toBeUndefined();
    expect(extractProviderId({ nested: { id: 'x' } })).toBeUndefined();
    expect(extractProviderId(null)).toBeUndefined();
  });
});
