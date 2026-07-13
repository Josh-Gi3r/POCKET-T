import { defineConfig } from 'vitest/config';

// Unit tests exercise the pure protocol/reconnect helpers, so they run in a
// plain Node environment with no DOM, no Svelte plugin, and no PWA build
// step. Files under src/lib that touch the browser (connection.ts, store.ts)
// are never imported by these tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
