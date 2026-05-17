import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  bundle:      true,
  platform:    'node',
  target:      'node20',
  format:      'esm',
  outfile:     'dist/main.js',
  // Only native addons stay external (can't be bundled). Pure-JS deps are
  // bundled so esbuild does the CJS→ESM interop (@xterm/* ship as CommonJS).
  external: [
    'node-pty',
    'ghostty-opentui',
    'keytar',
  ],
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
