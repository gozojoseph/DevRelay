import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, closeDb } from '../db/client.js';
import { auditEvents, users } from '../db/schema.js';
import { hashPassword, randomToken } from '../lib/security.js';

const email = z.email().parse(process.env.ADMIN_EMAIL);
let password = process.env.ADMIN_PASSWORD;
if (password && password.length < 16) throw new Error('ADMIN_PASSWORD must be at least 16 characters.');
if (!password) password = `${randomToken(24)}Aa1!`;

try {
  const [existing] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.email, email.toLowerCase()));
  if (existing) throw new Error('A user with this email already exists.');
  const [admin] = await db.insert(users).values({ email: email.toLowerCase(), passwordHash: await hashPassword(password),
    role: 'admin', emailVerifiedAt: new Date() }).returning();
  if (!admin) throw new Error('Could not create administrator.');
  await db.insert(auditEvents).values({ actorUserId: admin.id, action: 'admin.bootstrapped' });
  console.info(`Administrator created: ${admin.email}`);
  if (!process.env.ADMIN_PASSWORD) console.info(`Temporary password (shown once): ${password}`);
  console.info('Sign in immediately and configure TOTP MFA before using admin APIs.');
} finally {
  await closeDb();
}
