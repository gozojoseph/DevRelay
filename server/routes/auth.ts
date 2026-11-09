import { Router } from 'express';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { db } from '../db/client.js';
import { accounts, auditEvents, authTokens, rateCounters, sessions, users } from '../db/schema.js';
import { availability, config } from '../config.js';
import { ApiError, assert, ok } from '../lib/http.js';
import { createTotpSecret, csrfToken, decrypt, encrypt, hashPassword, randomToken, sha256, validTotpStep, verifyPassword } from '../lib/security.js';
import { cookieName, requireCsrf, requireSession } from '../middleware/auth.js';
import { createWallet } from '../services/ledger.js';

export const authRouter = Router();
const email = z.email().max(254).transform(value => value.toLowerCase().trim());
const password = z.string().min(12).max(128);
export const TERMS_VERSION = '2026-11-draft';

async function throttle(key: string, limit: number) {
  const minute = new Date(Math.floor(Date.now() / 60000) * 60000);
  const [entry] = await db.insert(rateCounters).values({ key: sha256(key), minute, count: 1 })
    .onConflictDoUpdate({ target: [rateCounters.key, rateCounters.minute], set: { count: sql`${rateCounters.count} + 1` } }).returning();
  if (entry && entry.count > limit) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please wait and try again.');
}
async function mail(to: string, subject: string, url: string) {
  const c = config();
  if (c.EMAIL_MODE === 'console' && c.NODE_ENV !== 'production') {
    console.info(`[DEVELOPMENT EMAIL ONLY] To: ${to} | ${subject} | ${url}`); return;
  }
  if (!c.SMTP_HOST || !c.EMAIL_FROM) throw new ApiError(503, 'EMAIL_UNAVAILABLE', 'Email delivery is not configured. Contact support.');
  const transport = nodemailer.createTransport({ host: c.SMTP_HOST, port: c.SMTP_PORT, secure: c.SMTP_PORT === 465,
    auth: c.SMTP_USER ? { user: c.SMTP_USER, pass: c.SMTP_PASSWORD } : undefined });
  await transport.sendMail({ from: c.EMAIL_FROM, to, subject, text: `${subject}\n\nOpen this link (expires automatically): ${url}\n\nIf you did not request this, ignore this message.` });
}
async function issueToken(userId: string, kind: 'verify' | 'reset') {
  const token = randomToken();
  await db.insert(authTokens).values({ userId, kind, tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + (kind === 'verify' ? 86400000 : 1800000)) });
  return token;
}
async function issueSession(res: import('express').Response, userId: string) {
  const token = randomToken();
  await db.insert(sessions).values({ userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86400000) });
  res.cookie(cookieName(), token, { httpOnly: true, secure: config().NODE_ENV === 'production',
    sameSite: 'lax', path: '/', maxAge: 7 * 86400000 });
  return csrfToken(token);
}

authRouter.post('/register', async (req, res) => {
  const input = z.object({ email, password, businessName: z.string().trim().min(2).max(160),
    contactEmail: email, country: z.literal('GH'), intendedUse: z.string().trim().min(15).max(1500),
    expectedMonthlyVolume: z.number().int().min(1).max(1000000), acceptTerms: z.literal(true),
  }).parse(req.body);
  await throttle(`register:${req.ip}`, 6);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email));
  if (existing.length) throw new ApiError(409, 'REGISTRATION_UNAVAILABLE', 'This email cannot be registered. Try signing in or resetting your password.');
  const hash = await hashPassword(input.password);
  const user = await db.transaction(async tx => {
    const [account] = await tx.insert(accounts).values({ businessName: input.businessName, contactEmail: input.contactEmail,
      intendedUse: input.intendedUse, expectedMonthlyVolume: input.expectedMonthlyVolume, country: input.country,
      termsVersion: TERMS_VERSION, termsAcceptedAt: new Date() }).returning();
    assert(account, 500, 'REGISTRATION_ERROR', 'Could not create account.');
    const [created] = await tx.insert(users).values({ accountId: account.id, email: input.email, passwordHash: hash }).returning();
    assert(created, 500, 'REGISTRATION_ERROR', 'Could not create user.');
    await createWallet(tx, account.id);
    return created;
  });
  const token = await issueToken(user.id, 'verify');
  await mail(user.email, 'Verify your DevRelay email', `${config().APP_ORIGIN}/verify?token=${encodeURIComponent(token)}`);
  ok(req, res, { message: 'Account created. Check your email to verify it. Admin approval follows verification.' }, 201);
});

authRouter.post('/verify', async (req, res) => {
  const { token } = z.object({ token: z.string().min(20).max(200) }).parse(req.body);
  await db.transaction(async tx => {
    const [record] = await tx.select().from(authTokens).where(and(eq(authTokens.tokenHash, sha256(token)), eq(authTokens.kind, 'verify'))).for('update');
    assert(record && !record.consumedAt && record.expiresAt > new Date(), 400, 'TOKEN_INVALID', 'Verification link expired or already used. Request another one.');
    const [user] = await tx.select().from(users).where(eq(users.id, record.userId));
    assert(user?.accountId, 400, 'TOKEN_INVALID', 'Verification link invalid.');
    await tx.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
    await tx.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, record.id));
    await tx.update(accounts).set({ status: 'pending_approval', updatedAt: new Date() }).where(and(eq(accounts.id, user.accountId), eq(accounts.status, 'pending_verification')));
    await tx.insert(auditEvents).values({ accountId: user.accountId, actorUserId: user.id, action: 'email.verified' });
  });
  ok(req, res, { message: 'Email verified. An administrator must approve your account before sending.' });
});

authRouter.post('/resend-verification', async (req, res) => {
  const input = z.object({ email }).parse(req.body);
  await throttle(`resend:${req.ip}`, 3);
  const [user] = await db.select().from(users).where(eq(users.email, input.email));
  if (user && !user.emailVerifiedAt && user.role === 'developer') {
    const token = await issueToken(user.id, 'verify');
    await mail(user.email, 'Verify your DevRelay email', `${config().APP_ORIGIN}/verify?token=${encodeURIComponent(token)}`);
  }
  ok(req, res, { message: 'If this account needs verification, an email has been sent.' });
});

authRouter.post('/login', async (req, res) => {
  const input = z.object({ email, password: z.string(), mfaCode: z.string().optional() }).parse(req.body);
  await throttle(`login:ip:${req.ip}`, 12);
  await throttle(`login:user:${input.email}`, 12);
  const [user] = await db.select().from(users).where(eq(users.email, input.email));
  const valid = user ? await verifyPassword(input.password, user.passwordHash) : await verifyPassword(input.password, DUMMY_HASH);
  if (!user || !valid) throw new ApiError(401, 'LOGIN_FAILED', 'Invalid email, password or authentication code.');
  if (user.role === 'admin' && user.mfaSecretEncrypted) {
    const secret = decrypt(user.mfaSecretEncrypted, `mfa:${user.id}`);
    const step = validTotpStep(secret, input.mfaCode ?? '');
    if (step === null) throw new ApiError(401, 'LOGIN_FAILED', 'Invalid email, password or authentication code.');
    const [updated] = await db.update(users).set({ mfaLastStep: step }).where(and(eq(users.id, user.id),
      or(isNull(users.mfaLastStep), lt(users.mfaLastStep, step)))).returning({ id: users.id });
    if (!updated) throw new ApiError(401, 'LOGIN_FAILED', 'Invalid email, password or authentication code.');
  }
  const csrf = await issueSession(res, user.id);
  ok(req, res, { csrfToken: csrf, role: user.role, mfaSetupRequired: user.role === 'admin' && !user.mfaSecretEncrypted });
});

// A valid dummy scrypt hash avoids a fast path for nonexistent emails (generated offline for tests below).
const DUMMY_HASH = 'scrypt$32768$d8ywy2G6ae3I1sJ-lTcSsw$6tCZX3fuHJS8dXYBBdcbIO4P976CWWny-Nmyu18PFeX4ylreA3kj8Dy5bbkrJs4PzKOo0AxYQhSg8LtFT0UmZqA';

authRouter.post('/request-reset', async (req, res) => {
  const input = z.object({ email }).parse(req.body);
  await throttle(`reset:${req.ip}`, 4);
  const [user] = await db.select().from(users).where(eq(users.email, input.email));
  if (user) {
    const token = await issueToken(user.id, 'reset');
    await mail(user.email, 'Reset your DevRelay password', `${config().APP_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`);
  }
  ok(req, res, { message: 'If the account exists, a reset email has been sent.' });
});

authRouter.post('/reset', async (req, res) => {
  const input = z.object({ token: z.string().min(20), password }).parse(req.body);
  const hash = await hashPassword(input.password);
  await db.transaction(async tx => {
    const [record] = await tx.select().from(authTokens).where(and(eq(authTokens.tokenHash, sha256(input.token)), eq(authTokens.kind, 'reset'))).for('update');
    assert(record && !record.consumedAt && record.expiresAt > new Date(), 400, 'TOKEN_INVALID', 'Reset link expired or already used. Request another one.');
    await tx.update(users).set({ passwordHash: hash, updatedAt: new Date() }).where(eq(users.id, record.userId));
    await tx.update(authTokens).set({ consumedAt: new Date() }).where(eq(authTokens.id, record.id));
    await tx.update(sessions).set({ invalidatedAt: new Date() }).where(eq(sessions.userId, record.userId));
    await tx.insert(auditEvents).values({ actorUserId: record.userId, action: 'password.reset' });
  });
  ok(req, res, { message: 'Password changed. Sign in again on every device.' });
});

authRouter.get('/me', requireSession, async (req, res) => {
  const actor = req.actor!;
  const [user] = await db.select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
    .from(users).where(eq(users.id, actor.userId));
  const [account] = actor.accountId ? await db.select().from(accounts).where(eq(accounts.id, actor.accountId)) : [];
  ok(req, res, { user: { id: actor.userId, email: user?.email, role: actor.role, verified: Boolean(user?.emailVerifiedAt),
    mfaEnabled: actor.mfaEnabled }, account: account && { id: account.id, businessName: account.businessName,
      status: account.status, country: account.country, dailySpendLimitMinor: account.dailySpendLimitMinor,
      dailyVolumeLimit: account.dailyVolumeLimit }, csrfToken: csrfToken(actor.sessionToken), availability: availability() });
});

authRouter.post('/logout', requireSession, requireCsrf, async (req, res) => {
  await db.update(sessions).set({ invalidatedAt: new Date() }).where(eq(sessions.tokenHash, sha256(req.actor!.sessionToken)));
  res.clearCookie(cookieName(), { path: '/', sameSite: 'lax', secure: config().NODE_ENV === 'production' });
  ok(req, res, { message: 'Signed out.' });
});

authRouter.post('/password', requireSession, requireCsrf, async (req, res) => {
  const input = z.object({ currentPassword: z.string(), newPassword: password }).parse(req.body);
  const [user] = await db.select().from(users).where(eq(users.id, req.actor!.userId));
  assert(user && await verifyPassword(input.currentPassword, user.passwordHash), 401, 'LOGIN_FAILED', 'Current password incorrect.');
  await db.transaction(async tx => {
    await tx.update(users).set({ passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() }).where(eq(users.id, user.id));
    await tx.update(sessions).set({ invalidatedAt: new Date() }).where(eq(sessions.userId, user.id));
    await tx.insert(auditEvents).values({ actorUserId: user.id, accountId: user.accountId, action: 'password.changed' });
  });
  res.clearCookie(cookieName(), { path: '/', sameSite: 'lax', secure: config().NODE_ENV === 'production' });
  ok(req, res, { message: 'Password updated. Sign in again on every device.' });
});

authRouter.post('/admin/mfa/setup', requireSession, requireCsrf, async (req, res) => {
  assert(req.actor?.role === 'admin' && !req.actor.mfaEnabled, 403, 'FORBIDDEN', 'MFA is already active or this is not an administrator.');
  const secret = createTotpSecret();
  await db.update(users).set({ mfaPendingEncrypted: encrypt(secret, `mfa:${req.actor.userId}`) }).where(eq(users.id, req.actor.userId));
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, req.actor.userId));
  ok(req, res, { secret, otpauthUrl: `otpauth://totp/DevRelay:${encodeURIComponent(user!.email)}?secret=${secret}&issuer=DevRelay&digits=6&period=30` });
});
authRouter.post('/admin/mfa/confirm', requireSession, requireCsrf, async (req, res) => {
  assert(req.actor?.role === 'admin' && !req.actor.mfaEnabled, 403, 'FORBIDDEN', 'Admin MFA setup only.');
  const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  const [user] = await db.select().from(users).where(eq(users.id, req.actor.userId));
  assert(user?.mfaPendingEncrypted, 400, 'MFA_NOT_STARTED', 'Begin MFA setup first.');
  const step = validTotpStep(decrypt(user.mfaPendingEncrypted, `mfa:${user.id}`), code);
  assert(step !== null, 400, 'MFA_INVALID', 'Invalid one-time code. Check your authenticator clock.');
  await db.transaction(async tx => {
    await tx.update(users).set({ mfaSecretEncrypted: user.mfaPendingEncrypted, mfaPendingEncrypted: null, mfaLastStep: step }).where(eq(users.id, user.id));
    await tx.update(sessions).set({ invalidatedAt: new Date() }).where(eq(sessions.userId, user.id));
    await tx.insert(auditEvents).values({ actorUserId: user.id, action: 'admin.mfa.enabled' });
  });
  res.clearCookie(cookieName(), { path: '/', sameSite: 'lax', secure: config().NODE_ENV === 'production' });
  ok(req, res, { message: 'MFA active. Sign in again with a fresh code.' });
});
