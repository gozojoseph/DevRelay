import { sql } from 'drizzle-orm';
import { db, closeDb } from '../db/client.js';

// Financial ledger and message records are intentionally retained. This script
// removes only operational data with a bounded lifetime. Run daily from cron.
const statements: [string, ReturnType<typeof sql>][] = [
  ['rate_counters', sql`DELETE FROM rate_counters WHERE minute < now() - interval '2 days'`],
  ['jobs_done', sql`DELETE FROM jobs WHERE status = 'done' AND updated_at < now() - interval '30 days'`],
  ['jobs_dead', sql`DELETE FROM jobs WHERE status = 'dead' AND updated_at < now() - interval '90 days'`],
  ['sessions', sql`DELETE FROM sessions WHERE expires_at < now() - interval '7 days'
    OR (invalidated_at IS NOT NULL AND invalidated_at < now() - interval '7 days')`],
  ['auth_tokens', sql`DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days'
    OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '7 days')`],
  ['provider_webhook_events', sql`DELETE FROM provider_webhook_events
    WHERE processed_at IS NOT NULL AND created_at < now() - interval '30 days'`],
  ['webhook_attempts', sql`DELETE FROM webhook_attempts WHERE created_at < now() - interval '90 days'`],
  ['webhook_events', sql`DELETE FROM webhook_events WHERE created_at < now() - interval '90 days'`],
  ['delivery_events', sql`DELETE FROM delivery_events WHERE created_at < now() - interval '2 years'`],
  ['audit_events', sql`DELETE FROM audit_events WHERE created_at < now() - interval '2 years'`],
  ['support_requests', sql`DELETE FROM support_requests WHERE created_at < now() - interval '2 years'`],
];

try {
  for (const [name, statement] of statements) {
    const result = await db.execute(statement);
    console.info(`Retention ${name}: removed ${result.rowCount ?? 0}`);
  }
} finally {
  await closeDb();
}
