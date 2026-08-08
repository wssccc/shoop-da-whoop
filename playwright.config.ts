// Playwright e2e configuration for the Shoop Da Whoop MPA.
//
// Conventions (agreed 2026-08):
//   * Specs live next to their game: games/<name>/e2e/*.spec.ts, with
//     shared helpers in games/<name>/e2e/helpers/.
//   * The webServer builds first then serves the production preview, so
//     tests always exercise the latest bundle (no stale-package false
//     positives). `reuseExistingServer` lets a manually started :8000
//     server be reused (e.g. `vite dev` while iterating).
//   * Chromium only, run locally on demand (`npm run test:e2e`); this
//     suite intentionally stays out of CI.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // testDir globs do not expand `*` reliably — point at `games` and match
  // the e2e folders explicitly instead.
  testDir: 'games',
  testMatch: '**/e2e/**/*.spec.ts',
  // 12 specs currently — keep the default parallelism but cap workers so
  // the animated card interactions don't thrash a tiny dev machine.
  fullyParallel: true,
  workers: 2,
  timeout: 60_000,
  expect: { timeout: 7_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:8000',
    viewport: { width: 1280, height: 900 },
    // Real mouse drags with `page.mouse` must move actual pixels; traces
    // help diagnose a failing animated interaction locally.
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:8000/games/solitaire/',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
