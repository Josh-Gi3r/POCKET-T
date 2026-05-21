import { defineConfig } from 'vitest/config';

// Post-v1-nuke: VtStream.test.ts was the only suite, and it tested v1
// PTY/VT normalization that no longer exists. Until we add v2 tests
// (recorder, ws-v3 routing, adapter event mapping), let `pnpm test`
// pass when zero tests are present so CI stays green.
export default defineConfig({
  test: {
    globals:         true,
    passWithNoTests: true,
  },
});
