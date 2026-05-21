// pocket-t — the daemon binary's CLI entry point.
//
// Thin wrapper that dispatches to the pt-registry server. Args pass
// through verbatim (--tunnel, --relay, etc.), so `pocket-t serve
// --tunnel` is identical to `pt-registry serve --tunnel`.
//
// self-hosted only. Default mode runs the daemon on
// 127.0.0.1:7700 (same Mac access). Pass --tunnel to open a free
// Cloudflare Quick Tunnel so a phone on any network can reach the
// UI. Pass --relay <url> if you've deployed your own ws-v3 hub
// somewhere (docs/self-hosting.md).
//
// Power users invoke `pt-registry` directly (same package, more
// subcommands: list, status, pending, approve, recordings, replay).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const [, , command, ...rest] = process.argv;

function serveCommand(): void {
  // Delegate to packages/daemon/src/pt-registry/main.ts.
  // Resolved relative to this file so it works in both src/ (under tsx)
  // and dist/ (after esbuild bundles to a single file).
  const here     = path.dirname(fileURLToPath(import.meta.url));
  const registry = path.join(here, 'pt-registry', 'main.js');
  const child    = spawn(process.execPath, [registry, 'serve', ...rest], { stdio: 'inherit' });
  child.on('exit', (code) => process.exit(code ?? 0));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => child.kill(sig));
  }
}

function usage(): void {
  console.log(`pocket-t — terminal sessions on any browser, any network.

Usage:
  pocket-t serve [--tunnel] [--relay <url>]

  --tunnel       Open a free Cloudflare Quick Tunnel so your phone (on
                 any network) can reach the pocket-t UI. Requires
                 \`cloudflared\` (\`brew install cloudflared\`). No signup,
                 no card.

  --relay <url>  Alternative: dial out to a self-hosted ws-v3 hub.
                 Use this if you've deployed your own relay
                 (see docs/self-hosting.md).

  (none)         Local only — UI at http://127.0.0.1:7700/ on this Mac.

The shell side (\`pt\`) lives in a separate native binary:
  install:  bash install.sh
  set as Terminal.app shell:
    Settings → Profiles → Shell → Run command: /usr/local/bin/pt

For more subcommands, invoke pt-registry directly:
  pnpm --filter @pocket-t/daemon pt-registry --help
`);
}

switch (command) {
  case 'serve':   serveCommand(); break;
  case '-h':
  case '--help':
  case undefined: usage(); break;
  default:
    console.error(`[pocket-t] unknown command: ${command}`);
    console.error(`run \`pocket-t --help\` for usage`);
    process.exit(1);
}
