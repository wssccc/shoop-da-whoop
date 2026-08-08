// Root ESLint config (flat).
//
// Scope: a SINGLE cross-cutting gate — browser-compatibility, enforced by
// `eslint-plugin-compat`, which reads `.browserslistrc` (iOS >= 13 / Safari
// >= 13 floor) and fails the lint whenever source uses an API or syntax newer
// than those targets. Examples it catches at edit time:
//
//   * structuredClone(...)        → Safari 15.4+ / iOS 15.4+   (was the
//     root cause of the burnrate iOS-13 "AI silently idle" bug — the MCTS
//     worker threw here and timed out to null every turn)
//   * Array.prototype.at / arr.at(-1)
//   * Object.hasOwn
//   * String.prototype.replaceAll / matchAll
//   * Promise.allSettled / .any
//   * structuredClone, queueMicrotask, globalThis (on the very oldest engines)
//
// Why this is the right shape of fix: `.browserslistrc` is already the single
// source of truth that @vitejs/plugin-legacy + postcss-preset-env consume.
// Wiring it into lint turns that same source of truth into a *pre-commit*
// guard, so an unsupported API can never again reach a shipped build silently.
//
// Per-entry style rules (vue/ts/js recommended) stay in each game's own
// eslint config; this root file deliberately owns ONLY compatibility so that
// adding it cannot churn any pre-existing lint baseline.

import compat from 'eslint-plugin-compat';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

export default defineConfig([
  // Don't emit "unused eslint-disable" warnings. Several pre-existing test
  // files carry `eslint-disable no-console`, which this root config does not
  // enable; surfacing those as new reports would churn unrelated files. Keep
  // the new gate focused purely on browser compatibility.
  {
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },

  // Never lint build output, deps, generated assets, the throwaway temp/
  // scratch dir, vendored images, build-tooling scripts (*.config.js/ts), or
  // solver/dev tooling under **/tools/** — all node-only, never shipped.
  globalIgnores([
    'dist',
    'node_modules',
    'temp',
    '.devcontainer',
    'public/images',
    '**/*.config.js',
    '**/*.config.ts',
    '**/tools/**',
  ]),

  // The compatibility gate. Registered manually (plugins + rule) rather than
  // via compat.configs['flat/recommended'] so we retain full control of the
  // per-file-type parsers below — the premade config would force espree and
  // choke on TypeScript / Vue.
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,vue,jsx,tsx}'],
    plugins: { compat },
    rules: { 'compat/compat': 'error' },
  },

  // e2e specs run ONLY on the bundled Playwright Chromium (latest), never on
  // the iOS 13 / Safari 13 floor — compat's browser targets don't apply.
  {
    files: ['games/*/e2e/**/*.{ts,js,mjs}'],
    rules: { 'compat/compat': 'off' },
  },

  // Parsers per file kind. The compat rule needs a valid AST; these blocks
  // teach ESLint how to read TS / Vue but add NO style rules, so enabling
  // them cannot disturb any pre-existing lint baseline.
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      ecmaVersion: 2022,
      parserOptions: { parser: tseslint.parser, sourceType: 'module' },
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },
]);
