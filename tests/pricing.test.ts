import { describe, expect, it } from 'vitest';
import { quoteMinor, normalizePhone, smsSegments } from '../server/services/pricing.js';
import { ApiError } from '../server/lib/http.js';

function expectApiError(run: () => unknown, status: number, code: string): void {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ApiError);
  expect(caught).toMatchObject({ status, code });
}

describe('normalizePhone', () => {
  it('normalizes Ghana local format to E.164', () => {
    expect(normalizePhone('0244000000')).toStrictEqual({ e164: '+233244000000', country: 'GH' });
    expect(normalizePhone('+233 24 400 0000')).toStrictEqual({ e164: '+233244000000', country: 'GH' });
    expect(normalizePhone('0201234567')).toStrictEqual({ e164: '+233201234567', country: 'GH' });
  });

  it('rejects invalid numbers', () => {
    expectApiError(() => normalizePhone('12345'), 400, 'INVALID_RECIPIENT');
  });

  it('rejects non-Ghana numbers for SMS (Ghana-only launch)', () => {
    expectApiError(() => normalizePhone('+447911123456', true), 400, 'UNSUPPORTED_DESTINATION');
  });

  it('accepts international numbers when not Ghana-restricted (WhatsApp)', () => {
    const parsed = normalizePhone('+447911123456');
    expect(parsed.e164).toBe('+447911123456');
    expect(parsed.country).not.toBe('GH');
  });
});

describe('smsSegments', () => {
  it('single GSM-7 segment up to 160 characters', () => {
    expect(smsSegments('Hello world')).toEqual({ count: 1, encoding: 'GSM-7' });
    expect(smsSegments('a'.repeat(160))).toEqual({ count: 1, encoding: 'GSM-7' });
  });

  it('counts multipart GSM-7 segments at 153 characters each', () => {
    expect(smsSegments('a'.repeat(161)).count).toEqual(2);
    expect(smsSegments('a'.repeat(1600)).count).toEqual(11);
  });

  it('counts UCS-2 encoding for emoji', () => {
    expect(smsSegments('🎉'.repeat(100)).count).toEqual(4);
    expect(smsSegments('🎉'.repeat(50)).count).toEqual(2);
  });

  it('rejects empty or oversized bodies', () => {
    expectApiError(() => smsSegments('   '), 400, 'INVALID_MESSAGE');
    expectApiError(() => smsSegments('a'.repeat(1601)), 400, 'INVALID_MESSAGE');
  });

  it('rejects more than 12 billable segments', () => {
    expectApiError(() => smsSegments('🎉'.repeat(400)), 400, 'MESSAGE_TOO_LONG');
  });
});

describe('quoteMinor', () => {
  it('multiplies unit price by segment count', () => {
    expect(quoteMinor(20, 1)).toBe(20);
    expect(quoteMinor(20, 3)).toBe(60);
    expect(quoteMinor(150, 1)).toBe(150);
  });

  it('rejects zero or unsafe totals', () => {
    expectApiError(() => quoteMinor(0, 1), 503, 'PRICE_UNAVAILABLE');
    expectApiError(() => quoteMinor(1, 0), 503, 'PRICE_UNAVAILABLE');
  });
});
