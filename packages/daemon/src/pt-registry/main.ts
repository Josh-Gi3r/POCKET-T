// pt-registry entry point.
//
// All the actual code lives elsewhere — this file exists so
// `tsx src/pt-registry/main.ts` and `node dist/pt-registry/main.js`
// have a place to land. The CLI argv dispatch is in `cli.ts`; the
// daemon itself is in `server.ts`. Anything else (recorder, tunnel,
// browser UI, IPC frame protocol) lives in its own focused file.

import { main } from './cli.js';

main().catch((e) => {
  console.error('[pt-registry]', (e as Error)?.message ?? e);
  process.exit(1);
});
