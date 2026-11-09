import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../../server/db/schema.js';

/**
 * Shared PGlite-backed harness. Every test file gets its own isolated
 * in-memory PostgreSQL (Vitest isolates module registries per file), with the
 * real drizzle migrations applied once. Individual tests truncate all tables so
 * they start from an empty database.
 */
export type TestDb = PgliteDatabase<typeof schema>;

let client: PGlite | undefined;
let instance: TestDb | undefined;
let ready: Promise<void> | undefined;

export function getTestDb(): TestDb {
  if (instance) return instance;
  client = new PGlite();
  instance = drizzle(client, { schema });
  ready = migrate(instance, { migrationsFolder: './drizzle' }).then(() => undefined);
  return instance;
}

export async function ensureTestDb(): Promise<void> {
  getTestDb();
  await ready;
}

/** Empty the whole database between tests (fast, in-memory). */
export async function resetTestDb(): Promise<void> {
  await ensureTestDb();
  await client?.exec(
    `DO $$ DECLARE r record; BEGIN
      FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;`,
  );
}

export async function closeTestDb(): Promise<void> {
  if (!client) return;
  const closing = client;
  client = undefined;
  instance = undefined;
  ready = undefined;
  await closing.close();
}
