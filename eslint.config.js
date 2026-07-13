// Flat config. Intentionally lenient: this lands lint on a codebase that
// grew without it, so noisy stylistic rules are warnings, not errors —
// the goal is signal in CI, not a wall of failures. Tighten over time.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/*.config.{js,ts,mjs}',
      'packages/web/dist/**',
      'site/**',
      // Claude Code spawns isolated copies of the repo under
      // .claude/worktrees/<id>/ — never lint into them. They will be
      // garbage-collected by Claude Code itself.
      '.claude/**',
      '**/.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
    },
  },
  // Service-worker file lives in /public — it gets shipped raw, never
  // bundled, so it needs the `self`/`caches`/`fetch` globals.
  {
    files: ['packages/web/public/sw.js', '**/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },
  // Build / install / housekeeping scripts run under Node, not the
  // browser — give them console/process/etc.
  {
    files: [
      '**/scripts/**/*.{js,mjs,cjs}',
      '**/build.mjs',
    ],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
