import type { Request, Response, NextFunction } from 'express';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { accounts, apiKeys, projects, sessions, users } from '../db/schema.js';
import { config } from '../config.js';
import { ApiError, assert } from '../lib/http.js';
import { csrfToken, safeEqual, sha256 } from '../lib/security.js';

export const cookieName = () => config().NODE_ENV === 'production' ? '__Host-devrelay' : 'devrelay_session';

export async function requireSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[cookieName()];
    assert(typeof token === 'string' && token.length > 30, 401, 'AUTH_REQUIRED', 'Sign in to continue.');
    const [row] = await db.select({ session: sessions, user: users }).from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date()), isNull(sessions.invalidatedAt)));
    assert(row, 401, 'SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    req.actor = { userId: row.user.id, accountId: row.user.accountId, role: row.user.role,
      sessionToken: token, mfaEnabled: Boolean(row.user.mfaSecretEncrypted) };
    next();
  } catch (error) { next(error); }
}

export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  try {
    assert(req.actor, 401, 'AUTH_REQUIRED', 'Sign in to continue.');
    const received = req.header('x-csrf-token') ?? '';
    assert(safeEqual(Buffer.from(received), Buffer.from(csrfToken(req.actor.sessionToken))), 403, 'CSRF_INVALID', 'Refresh the page and try again.');
    next();
  } catch (error) { next(error); }
}

export function requireDeveloper(req: Request, _res: Response, next: NextFunction) {
  try {
    assert(req.actor?.role === 'developer' && req.actor.accountId, 403, 'FORBIDDEN', 'Developer account required.');
    next();
  } catch (error) { next(error); }
}

export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  try {
    assert(req.actor?.role === 'admin', 403, 'FORBIDDEN', 'Admin access required.');
    assert(req.actor.mfaEnabled, 403, 'MFA_REQUIRED', 'Set up admin multi-factor authentication first.');
    next();
  } catch (error) { next(error); }
}

export async function requireApiKey(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.header('authorization') ?? '';
    assert(/^Bearer dr_(?:live|test)_[A-Za-z0-9_-]{32,}$/.test(header), 401, 'INVALID_API_KEY', 'Send a valid project API key as a Bearer token.');
    assert(config().NODE_ENV !== 'production' || !header.startsWith('Bearer dr_test_'), 401, 'INVALID_API_KEY',
      'Test API keys cannot be used in production.');
    const hash = sha256(header.slice(7));
    const [row] = await db.select({ key: apiKeys, project: projects, account: accounts }).from(apiKeys)
      .innerJoin(projects, eq(projects.id, apiKeys.projectId)).innerJoin(accounts, eq(accounts.id, apiKeys.accountId))
      .where(and(eq(apiKeys.keyHash, hash), isNull(apiKeys.revokedAt)));
    assert(row && row.project.accountId === row.account.id, 401, 'INVALID_API_KEY', 'API key is invalid or revoked.');
    assert(row.account.status === 'active', 403, 'ACCOUNT_NOT_ACTIVE', 'Email verification and admin approval are required before live API access.');
    req.apiActor = { accountId: row.account.id, projectId: row.project.id, keyId: row.key.id, scopes: row.key.scopes };
    if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt.getTime() > 600000) {
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.key.id));
    }
    next();
  } catch (error) { next(error); }
}

export function requireScope(scope: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.apiActor?.scopes.includes(scope)) return next(new ApiError(403, 'SCOPE_REQUIRED', `API key needs ${scope} scope.`));
    next();
  };
}
