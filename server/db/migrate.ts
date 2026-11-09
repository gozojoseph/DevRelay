import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, closeDb } from './client.js';

try {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.info('Database migrations applied');
} finally { await closeDb(); }
