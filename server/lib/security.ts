import { randomBytes, createHash, createHmac, timingSafeEqual, scrypt as scryptCallback, createCipheriv, createDecipheriv } from 'node:crypto';
import { config } from '../config.js';

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
}
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const safeEqual = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export async function hashPassword(password: string) {
  const salt = randomToken(16);
  const hash = await scrypt(password, salt);
  return `scrypt$32768$${salt}$${hash.toString('base64url')}`;
}
export async function verifyPassword(password: string, stored: string) {
  const [algorithm, cost, salt, expected] = stored.split('$');
  if (algorithm !== 'scrypt' || cost !== '32768' || !salt || !expected) return false;
  const hash = await scrypt(password, salt);
  return safeEqual(hash, Buffer.from(expected, 'base64url'));
}
export function csrfToken(sessionToken: string) { return createHmac('sha256', config().SESSION_SECRET).update(`csrf:${sessionToken}`).digest('base64url'); }
export function encrypt(plaintext: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(config().ENCRYPTION_KEY, 'hex'), iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}
export function decrypt(ciphertext: string, context: string) {
  const [iv, tag, content] = ciphertext.split('.');
  if (!iv || !tag || !content) throw new Error('Invalid encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(config().ENCRYPTION_KEY, 'hex'), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(content, 'base64url')), decipher.final()]).toString('utf8');
}

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes: Buffer) {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { result += alphabet[(value >>> (bits -= 5)) & 31]; } }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}
function fromBase32(text: string) {
  let bits = 0, value = 0; const result: number[] = [];
  for (const letter of text.toUpperCase().replace(/=+$/, '')) { const digit = alphabet.indexOf(letter); if (digit < 0) return Buffer.alloc(0); value = (value << 5) | digit; bits += 5; if (bits >= 8) result.push((value >>> (bits -= 8)) & 255); }
  return Buffer.from(result);
}
export function createTotpSecret() { return base32(randomBytes(20)); }
export function totpAt(secret: string, step: number) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = digest[19]! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}
export function validTotpStep(secret: string, code: string, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now / 30000);
  for (const delta of [-1, 0, 1]) if (safeEqual(Buffer.from(totpAt(secret, step + delta)), Buffer.from(code))) return step + delta;
  return null;
}
