import { defineConfig } from 'vitest/config';

// Each test file starts an embedded PostgreSQL (PGlite): allow it time to boot, and run files one at a time.
export default defineConfig({
  test: { hookTimeout: 60_000, testTimeout: 30_000, fileParallelism: false },
});
