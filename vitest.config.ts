// Vitest configuration.
//
// Vitest brings its own Vite copy to run tests, so it is decoupled from the
// project's app `vite.config.js` (and its vite-8 peer); we only register the
// `@burnrate` / `@solitaire` path aliases (mirroring each game's tsconfig)
// and constrain the test globs to the framework-agnostic engine layers.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@burnrate': fileURLToPath(new URL('games/burnrate/src', import.meta.url)),
      '@solitaire': fileURLToPath(new URL('games/solitaire/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: [
      'games/burnrate/src/**/*.test.ts',
      'games/solitaire/src/**/*.test.ts',
    ],
  },
  // Avoid clashing with the app's vite config (different root / plugins).
  root: here,
});
