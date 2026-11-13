import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';
import { config } from '../config.js';

export const pool = new pg.Pool({
  connectionString: config().DATABASE_URL, max: 10,
  connectionTimeoutMillis: 20000, idleTimeoutMillis: 30000,
  // Recycle pooled connections before NAT/firewalls silently drop them: a
  // half-open socket surfaces as a request-time 500 on first reuse.
  keepAlive: true, keepAliveInitialDelayMillis: 10000,
});
// Neon suspends idle computes and intermediaries can RST sockets, so a pooled
// client can die outside any query. pg forwards that to the pool, and without
// a listener the process exits with an unhandled 'error' event (seen live:
// local worker crashed on ECONNRESET while idle). The pool drops the dead
// client; the next query opens a fresh one.
pool.on('error', (err) => {
  console.error(`[db] pooled client error (pool recovers on next query): ${err.message}`);
});
// Round 2 of the same crash class: pg-pool REMOVES its idle error listener the
// moment a client is checked out (pg-pool/index.js:344) and only its own
// query() wrapper re-attaches one — clients handed to drizzle transactions via
// pool.connect() therefore run with NO error listener, so an RST mid-
// transaction exits the process (reproduced live: the exact worker stack).
// Attaching at the pool's 'connect' event covers every client for its whole
// life; pg still surfaces the same error to the outstanding query, so the
// transaction fails normally — the process just survives it.
pool.on('connect', (client) => {
  client.on('error', (err) => {
    console.error(`[db] checked-out client error (transaction fails; process survives): ${err.message}`);
  });
});
export const db = drizzle(pool, { schema });
export type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function closeDb() { await pool.end(); }
