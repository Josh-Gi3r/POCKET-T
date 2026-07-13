import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle:      true,
  platform:    'node',
  target:      'node20',
  format:      'esm',
  outfile:     'dist/main.js',
  // Nothing native left to externalise post-v1 cleanup (node-pty,
  // keytar, ghostty-opentui all gone with the v1 PTY / hosted-auth /
  // VtStream paths). esbuild bundles every dep, doing CJS→ESM interop
  // for the @xterm/* packages (which still ship as CommonJS).
  external: [],
  banner: {
    js: [
      // Aliased so these never collide with identifiers in bundled code
      // (esbuild can't rename around the opaque banner text).
      "import { createRequire as __bnCreateRequire } from 'module';",
      "import { fileURLToPath as __bnFileURLToPath } from 'url';",
      "import { dirname as __bnDirname } from 'path';",
      "const require = __bnCreateRequire(import.meta.url);",
      "const __filename = __bnFileURLToPath(import.meta.url);",
      "const __dirname = __bnDirname(__filename);",
    ].join('\n'),
  },
});

console.log('✓ daemon built → dist/main.js');
