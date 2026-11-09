import { describe, expect, it } from 'vitest';
import {
  createTotpSecret, csrfToken, decrypt, encrypt, hashPassword, randomToken,
  sha256, totpAt, validTotpStep, verifyPassword,
} from '../server/lib/security.js';

describe('password hashing', () => {
  it('verifies the correct password and rejects wrong ones', async () => {
    const stored = await hashPassword('correct horse battery staple');
    expect(stored).toMatch(/^scrypt\$32768\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword('correct horse battery staple', stored)).toBe(true);
    expect(await verifyPassword('wrong password', stored)).toBe(false);
    expect(await verifyPassword('correct horse battery staple', 'not-a-valid-hash')).toBe(false);
  });

  it('salts every hash differently', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });
});

describe('sha256', () => {
  it('reproduces known vectors', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('randomToken', () => {
  it('emits url-safe base64 of expected length', () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken(32)).not.toBe(token);
  });
});

describe('AES-GCM encryption with context binding', () => {
  it('round-trips under the same context', () => {
    const ciphertext = encrypt('secret body', 'message:account-1');
    expect(ciphertext.split('.')).toHaveLength(3);
    expect(decrypt(ciphertext, 'message:account-1')).toBe('secret body');
  });

  it('refuses decryption under a different context', () => {
    const ciphertext = encrypt('secret body', 'message:account-1');
    expect(() => decrypt(ciphertext, 'message:account-2')).toThrow();
  });

  it('refuses tampered ciphertext (auth tag check)', () => {
    const ciphertext = encrypt('secret body', 'message:account-1');
    const [iv, tag, content] = ciphertext.split('.');
    const tampered = `${iv}.${tag}.${'x'.repeat(content!.length)}`;
    expect(() => decrypt(tampered, 'message:account-1')).toThrow();
  });
});

describe('csrf tokens', () => {
  it('is deterministic for a session and differs across sessions', () => {
    expect(csrfToken('session-a')).toBe(csrfToken('session-a'));
    expect(csrfToken('session-a')).not.toBe(csrfToken('session-b'));
  });
});

describe('TOTP (admin MFA)', () => {
  it('generates standard base32 secrets', () => {
    expect(createTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('matches the RFC 4226 Appendix D test vectors for the ASCII secret "12345678901234567890"', () => {
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 0)).toBe('755224');
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1)).toBe('287082');
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 2)).toBe('359152');
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 3)).toBe('969429');
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 4)).toBe('338314');
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 5)).toBe('254676');
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 6)).toBe('287922');
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 7)).toBe('162583');
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 8)).toBe('399871');
    expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 9)).toBe('520489');
  });

  it('stays six digits and padded for many counters', () => {
    const secret = createTotpSecret();
    for (let step = 0; step < 30_000; step += 997) {
      expect(totpAt(secret, step)).toMatch(/^\d{6}$/);
    }
  });

  it('accepts the current step plus/minus one and nothing further', () => {
    const secret = createTotpSecret();
    const step = Math.floor(Date.now() / 30_000);
    expect(validTotpStep(secret, totpAt(secret, step))).toBe(step);
    expect(validTotpStep(secret, totpAt(secret, step - 1))).toBe(step - 1);
    expect(validTotpStep(secret, totpAt(secret, step + 1))).toBe(step + 1);
    expect(validTotpStep(secret, totpAt(secret, step - 2))).toBeNull();
    expect(validTotpStep(secret, totpAt(secret, step + 2))).toBeNull();
  });

  it('rejects malformed codes', () => {
    const secret = createTotpSecret();
    const step = Math.floor(Date.now() / 30_000);
    expect(validTotpStep(secret, 'abcdef')).toBeNull();
    expect(validTotpStep(secret, '12345')).toBeNull();
    expect(validTotpStep(secret, `${totpAt(secret, step)}7`)).toBeNull();
  });
});
