// Vite configuration for the Shoop Da Whoop site (MPA).
//
// Goals:
//   * Multi-page entry: home (index.html) + each game under games/<name>/index.html.
//   * Zero-config dev server with HMR (replaces the python http.server workflow).
//   * Production build that ships a modern ES module bundle PLUS a transpiled
//     legacy bundle (nomodule) so iOS 13 / Safari 13 (and other older engines)
//     keep running. Source can freely use `??`, `||=`, optional chaining, etc.
//   * CSS hardened through PostCSS preset-env + autoprefixer (auto-expand
//     `inset`, `gap` where possible, add vendor prefixes).
//
// Targets are declared once in `.browserslistrc` and read by both
// @vitejs/plugin-legacy and postcss-preset-env / autoprefixer.

import legacy from '@vitejs/plugin-legacy';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Relative asset URLs so dist/ can be hosted from any sub-path
  // (file://, GitHub Pages sub-folder, CDN, etc.).
  base: './',

  plugins: [
    legacy({
      // `targets` is intentionally omitted → the plugin reads .browserslistrc,
      // keeping a single source of truth for "what we support".
      // Render modern-marked polyfills only when actually needed.
      modernPolyfills: true,
      // legacy bundle pulls in a curated core-js polyfill set automatically.
    }),
  ],

  build: {
    outDir: 'dist',
    // Generate sourcemaps for production debugging without exposing full sources
    // (default false is fine for a casual game; flip to true if you ship to
    // Sentry/bug-tracking). Keep false to shrink the bundle.
    sourcemap: false,
    // `target` is intentionally omitted: @vitejs/plugin-legacy owns it and emits
    // both a modern ESM build and a transpiled `nomodule` build targeting the
    // browsers declared in .browserslistrc (iOS 13 / Safari 13 floor).
    // Drop the noisy legal-comment banner.
    minify: 'terser',
    terserOptions: {
      format: { comments: false },
    },
    // Multi-page entries: home + one per game folder under games/.
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        solitaire: resolve(__dirname, 'games/solitaire/index.html'),
        '1a2b': resolve(__dirname, 'games/1a2b/index.html'),
        othello: resolve(__dirname, 'games/othello/index.html'),
      },
    },
  },

  server: {
    host: '0.0.0.0',
    port: 8000,
    strictPort: false,
  },

  preview: {
    host: '0.0.0.0',
    port: 8000,
  },
});
