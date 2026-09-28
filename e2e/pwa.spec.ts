// PWA offline e2e: manifest wiring, service-worker registration and
// full-site offline navigation for all 7 entries.
//
// Notes:
//   * Chromium only (see playwright.config.ts) — the iOS 13 run is manual.
//   * Needs the build+preview webServer: the service worker only exists in
//     the built output, never in dev.
//   * registerType 'prompt' means the first registration has no
//     clientsClaim, so the tab is reloaded once before going offline; from
//     then on every navigation in the scope is handled by the active SW.
import { expect, test, type Page } from '@playwright/test';

// Every entry point, with a cheap marker that proves the app actually
// mounted (not just that HTML was served from the cache).
const PAGES: Array<{ path: string; selector: string }> = [
  { path: '/', selector: '.main-title' },
  { path: '/games/solitaire/', selector: '#board' },
  { path: '/games/1a2b/', selector: '#app .toolbar' },
  { path: '/games/othello/', selector: 'h1' },
  { path: '/games/burnrate/', selector: '.game-stage' },
  { path: '/games/keyflow/', selector: '.keyflow-window' },
  { path: '/games/csgame/', selector: '#app canvas' },
];

interface PrecacheInfo {
  name: string | null;
  count: number;
  urls: string[];
}

async function readPrecache(page: Page): Promise<PrecacheInfo> {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const name = names.find((n) => n.indexOf('workbox-precache') === 0) ?? null;
    if (!name) return { name: null, count: 0, urls: [] };
    const cache = await caches.open(name);
    const requests = await cache.keys();
    return {
      name,
      count: requests.length,
      urls: requests.map((r) => new URL(r.url).pathname),
    };
  });
}

test.describe('PWA', () => {
  test('manifest is served and linked from every page', async ({ page }) => {
    for (const { path } of PAGES) {
      await page.goto(path);
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
        'href',
        '/manifest.webmanifest',
      );
    }

    const response = await page.request.get('/manifest.webmanifest');
    expect(response.ok()).toBeTruthy();
    const manifest = await response.json();
    expect(manifest.name).toBe('Shoop Da Whoop');
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
  });

  test('service worker precaches the whole site and everything loads offline', async ({
    page,
    context,
  }) => {
    await page.goto('/');

    // `ready` resolves once the SW is active; in generateSW mode activation
    // only happens after the install step cached the whole manifest, so a
    // resolved promise also means "precache complete".
    await page.evaluate(() => navigator.serviceWorker.ready);
    const precache = await readPrecache(page);
    expect(precache.name).toBeTruthy();

    // All 7 html entries are precached (directory URLs resolve through
    // directoryIndex, so the manifest stores the index.html forms).
    const expectedHtml = [
      '/index.html',
      ...PAGES.filter((p) => p.path !== '/').map((p) => `${p.path}index.html`),
    ];
    for (const url of expectedHtml) {
      expect(precache.urls, `precached: ${url}`).toContain(url);
    }
    // Icons and both bundles (modern + legacy) are in as well.
    expect(precache.urls).toContain('/pwa/icon-192.png');
    expect(precache.urls).toContain('/pwa/icon-512-maskable.png');
    expect(precache.urls.some((u) => u.includes('legacy'))).toBe(true);
    expect(precache.count).toBeGreaterThan(30);

    // Prompt mode has no clientsClaim: reload once so this tab is SW-controlled.
    await page.reload();
    expect(
      await page.evaluate(() => navigator.serviceWorker.controller !== null),
    ).toBe(true);

    // Flight mode.
    await context.setOffline(true);
    for (const { path, selector } of PAGES) {
      await page.goto(path);
      await page.waitForSelector(selector, { timeout: 15_000 });
    }
  });
});
