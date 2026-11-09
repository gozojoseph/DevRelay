import { defineConfig } from 'vitest/config';

// PGlite instances are created per test file, so files must not share workers.
// A single fork keeps each file's in-memory Postgres self-contained and paths
// deterministic on Windows.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-env.ts'],
    hookTimeout: 120000,
    testTimeout: 60000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
