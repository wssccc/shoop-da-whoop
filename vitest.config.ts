// Vitest configuration.
//
// Vitest brings its own Vite copy to run tests, so it is decoupled from the
// project's app `vite.config.js` (and its vite-8 peer); we only register the
// `@burnrate` path alias (mirroring the burnrate tsconfig) and constrain the
// test glob to the burnrate lib for now.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@burnrate': fileURLToPath(new URL('games/burnrate/src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['games/burnrate/src/**/*.test.ts'],
  },
  // Avoid clashing with the app's vite config (different root / plugins).
  root: here,
});
