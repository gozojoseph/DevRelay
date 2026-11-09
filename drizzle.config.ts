import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './server/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  dbCredentials: { url: process.env.DATABASE_URL || 'postgresql://unused:unused@localhost:5432/unused' },
});
