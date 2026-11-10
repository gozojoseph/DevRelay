import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// setup-env seeds AT sandbox stubs (AT_MODE=sandbox), which is the mode under test.
const { africasTalking } = await import('../server/providers/africastalking.js');

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const sendArgs = { recipient: '+233531649960', sender: 'Affordable', body: 'hello' };

describe('Africa\'s Talking SMS adapter (sandbox)', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('omits the sender id in sandbox (sender approval is live-only) and reports supplier cost', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ SMSMessageData: { Recipients: [
      { statusCode: 101, number: '+233531649960', messageId: 'ATXid_1', cost: 'GHS 0.2323' } ] } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(africasTalking.send(sendArgs)).resolves.toEqual({
      id: 'ATXid_1', supplierCostMinor: 23, supplierCurrency: 'GHS' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.sandbox.africastalking.com/version1/messaging');
    const form = new URLSearchParams(String(init.body));
    expect(form.get('from')).toBeNull();
    expect(form.get('to')).toBe('+233531649960');
  });

  it('treats an empty-Recipients refusal as a definite rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ SMSMessageData: { Message: 'InvalidSenderId', Recipients: [] } }, 201)));
    await expect(africasTalking.send(sendArgs))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'SMS_PROVIDER_INVALID_SENDER_ID' });
  });

  it('maps other empty-recipient refusals to a generic rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse({ SMSMessageData: { Message: 'SomethingElse', Recipients: [] } }, 201)));
    await expect(africasTalking.send(sendArgs))
      .rejects.toMatchObject({ kind: 'rejected', publicCode: 'SMS_PROVIDER_REJECTED' });
  });

  it('keeps a missing recipient echo ambiguous (number-format mismatch)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ SMSMessageData: { Recipients: [
      { statusCode: 101, number: '233531649960', messageId: 'ATXid_2' } ] } })));
    await expect(africasTalking.send(sendArgs))
      .rejects.toMatchObject({ kind: 'ambiguous', publicCode: 'SMS_RESPONSE_UNCERTAIN' });
  });
});
