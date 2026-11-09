import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config().DATABASE_URL, max: 10, connectionTimeoutMillis: 20000, idleTimeoutMillis: 30000 });
export const db = drizzle(pool, { schema });
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function closeDb() { await pool.end(); }
