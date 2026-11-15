// What app rows exist (any status) — to confirm the orphans are truly orphaned.
import 'dotenv/config';
const { sql } = await import('drizzle-orm');
const { db, closeDb } = await import('./server/db/client.js');
try {
  const rows = await db.execute(sql`select id, slug, status, container_ref, url, current_deployment_id
    from hosted_apps order by created_at`);
  console.log(JSON.stringify(rows.rows ?? rows, null, 1));
} finally {
  await closeDb();
}
