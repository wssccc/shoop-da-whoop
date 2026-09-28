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
import vue from '@vitejs/plugin-vue';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  // Root-absolute asset URLs. The site is deployed at the domain root
  // (GitHub Pages + CNAME) and a root base is REQUIRED for the service
  // worker setup: with a relative base, the PWA registration URL would
  // resolve under /games/<name>/ and 404.
  base: '/',

  plugins: [
    legacy({
      // `targets` is intentionally omitted → the plugin reads .browserslistrc,
      // keeping a single source of truth for "what we support".
      // Render modern-marked polyfills only when actually needed.
      modernPolyfills: true,
      // legacy bundle pulls in a curated core-js polyfill set automatically.
    }),
    // Vue 3 SFC compiler for the Othello entry (.vue). Harmless for
    // the plain-JS entries (home / solitaire / 1a2b): the plugin only
    // processes .vue files, so it won't touch their vanilla JS.
    vue(),
    // PWA: web app manifest + Workbox service worker (generateSW strategy).
    // The site is 100% static, so "offline" simply means "precache all of
    // dist/": the 7 html entries, both the modern and the legacy bundles,
    // images and sfx. Updates use the prompt flow (shared/pwa/pwa.ts shows a
    // banner; nothing reloads until the player taps Update).
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Shoop Da Whoop',
        short_name: 'ShoopDaWhoop',
        description: 'A tiny arcade of browser games.',
        theme_color: '#f5f0e8',
        background_color: '#f5f0e8',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/pwa/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache everything the site can serve (7 html entries + modern &
        // legacy bundles + public/ assets). Legacy doubles (1.4 MB before
        // gzip) are kept ON PURPOSE: iOS 13 has no other way to be offline.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,jpeg,gif,webp,mp3,wav,ogg,woff,woff2,ico}'],
        // Directory-style navigations (/games/solitaire/) resolve to the
        // precached index.html of that directory. NOTE: no navigateFallback
        // here — a global fallback would funnel every offline game URL to
        // the home page.
        directoryIndex: 'index.html',
        // Per-file cap stays at the 2 MB default: the largest dist file is
        // ~537 KB (csgame legacy bundle).
      },
      devOptions: {
        // Service worker is disabled in dev (it fights HMR). Verify offline
        // behavior through `npm run build && npm run preview`.
        enabled: false,
      },
    }),
  ],

  // `@othello` mirrors the Othello tsconfig `paths` (`@othello/* -> ./src/*`)
  // so the TSX sources keep their `@othello/components/...` imports under the
  // MPA build. `@solitaire` does the same for the Solitaire (Vue 3) entry.
  resolve: {
    alias: {
      '@othello': resolve(__dirname, 'games/othello/src'),
      '@solitaire': resolve(__dirname, 'games/solitaire/src'),
      '@burnrate': resolve(__dirname, 'games/burnrate/src'),
      '@keyflow': resolve(__dirname, 'games/keyflow/src'),
    },
  },

  build: {
    outDir: 'dist',
    // Generate sourcemaps for production debugging without exposing full sources
    // (default false is fine for a casual game; flip to true if you ship to
    // Sentry/bug-tracking). Keep false to shrink the bundle.
    sourcemap: false,
    // `target` is intentionally omitted: @vitejs/plugin-legacy owns it and emits
    // both a modern ESM build and a transpiled `nomodule` build targeting the
    // browsers declared in .browserslistrc (iOS 13 / Safari 13 floor).
    // `cssMinify: 'esbuild'` — Vite 8's default lightningcss chokes on the
    // Media Queries Level 5 syntax in 98.css (`@media (not(hover))`); esbuild
    // parses it fine.
    cssMinify: 'esbuild',
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
        burnrate: resolve(__dirname, 'games/burnrate/index.html'),
        csgame: resolve(__dirname, 'games/csgame/index.html'),
        keyflow: resolve(__dirname, 'games/keyflow/index.html'),
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
