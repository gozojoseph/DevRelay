import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';

const client = new PGlite();
try {
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: './drizzle' });
  await db.execute(sql`SELECT 1 FROM accounts LIMIT 1`);
  await db.execute(sql`SELECT 1 FROM ledger_entries LIMIT 1`);
  console.info('Versioned migrations applied cleanly to isolated PostgreSQL (PGlite)');
} finally { await client.close(); }
