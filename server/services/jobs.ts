import { and, asc, eq, lte, or } from 'drizzle-orm';
import { randomInt, randomUUID } from 'node:crypto';
import { db, type DbTransaction } from '../db/client.js';
import { jobs } from '../db/schema.js';

export async function enqueue(tx: DbTransaction, input: {
  kind: string; dedupKey: string; payload: Record<string, unknown>; accountId?: string; projectId?: string; maxAttempts?: number; runAt?: Date;
}) {
  return tx.insert(jobs).values(input).onConflictDoNothing().returning();
}

export async function claimJobs(workerId: string, size = 5) {
  return db.transaction(async tx => {
    const due = await tx.select().from(jobs).where(or(
      and(eq(jobs.status, 'pending'), lte(jobs.runAt, new Date())),
      and(eq(jobs.status, 'running'), lte(jobs.leaseUntil, new Date())),
    )).orderBy(asc(jobs.runAt)).limit(size).for('update', { skipLocked: true });
    const claimed: (typeof jobs.$inferSelect)[] = [];
    for (const job of due) {
      const [updated] = await tx.update(jobs).set({ status: 'running', attempts: job.attempts + 1,
        lockedBy: workerId, leaseUntil: new Date(Date.now() + 60_000), updatedAt: new Date() }).where(eq(jobs.id, job.id)).returning();
      if (updated) claimed.push(updated);
    }
    return claimed;
  });
}

export async function finishJob(job: typeof jobs.$inferSelect) {
  await db.update(jobs).set({ status: 'done', leaseUntil: null, lockedBy: null, updatedAt: new Date() })
    .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, job.lockedBy!)));
}
export async function retryJob(job: typeof jobs.$inferSelect, code: string) {
  const dead = job.attempts >= job.maxAttempts;
  const delay = Math.min(1_800_000, 2 ** Math.min(job.attempts, 10) * 2000 + randomInt(0, 1200));
  await db.update(jobs).set({ status: dead ? 'dead' : 'pending', leaseUntil: null, lockedBy: null,
    runAt: new Date(Date.now() + delay), lastError: code.slice(0, 200), updatedAt: new Date() })
    .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, job.lockedBy!)));
}
export async function markJobDead(job: typeof jobs.$inferSelect, code: string) {
  await db.update(jobs).set({ status: 'dead', leaseUntil: null, lockedBy: null,
    lastError: code.slice(0, 200), updatedAt: new Date() })
    .where(and(eq(jobs.id, job.id), eq(jobs.lockedBy, job.lockedBy!)));
}

export function newWorkerId() { return randomUUID(); }
