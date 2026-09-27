// Touch-input regressions (the iOS 13 class devices this game targets):
//   1. EVERY element must opt out of the browser's own touch gestures. The
//      cards always declared `touch-action: none`, but the chrome (toolbar
//      buttons, panels, overlays) was left at the initial `auto` — and since
//      `touch-action` does not inherit, a double-tap on a button zoomed the
//      page on iOS 10+ (which ignores `user-scalable=no` / `maximum-scale`).
//      The declarative `* { touch-action: none }` in index.css is the switch
//      WebKit documents for this.
//   2. No tap may be swallowed: the removed `touchend` 300ms guard used to
//      preventDefault every tap that followed another tap within 300ms, which
//      dropped the synthesized click (rapid re-taps, or tap A then quickly tap
//      B, went dead until you waited). Every tap must now activate its button.
import { expect, test } from '@playwright/test';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test.describe('touch input', () => {
  test('every element opts out of browser pan/zoom gestures', async ({ page }) => {
    await page.goto('/games/solitaire/');
    await expect(page.locator('#board .card').first()).toBeAttached();

    const targets = [
      'html',
      'body',
      '#board',
      '.controls button[title="新局"]',
      '.controls button[title="撤销"]',
      '.controls button.btn-restart',
      '.controls button.btn-hint',
      '.dragon-btn',
      '.slot.col',
      '#board .card',
    ];
    for (const sel of targets) {
      const ta = await page
        .locator(sel)
        .first()
        .evaluate((el) => getComputedStyle(el).touchAction);
      expect(ta, `${sel} must declare touch-action: none`).toBe('none');
    }
  });

  test('rapid taps all land — no 300ms window swallows a click', async ({ page }) => {
    await page.goto('/games/solitaire/');
    await expect(page.locator('#board .card').first()).toBeAttached();

    // Count the clicks that reach the toolbar: the old guard preventDefault'ed
    // the synthesized click, so a swallowed tap dispatched none at all.
    await page.evaluate(() => {
      const w = window as unknown as { __clicks: number };
      w.__clicks = 0;
      document.addEventListener(
        'click',
        (e) => {
          if ((e.target as HTMLElement | null)?.closest('.controls')) w.__clicks += 1;
        },
        true,
      );
    });

    // Mute (not 新局 — that one opens a confirm dialog between taps).
    const box = await page.locator('.controls button.btn-mute').boundingBox();
    if (!box) throw new Error('mute button not visible in the mobile layout');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    for (let i = 0; i < 4; i++) {
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(120); // well inside the old 300ms window
    }
    await page.waitForTimeout(400); // let the last synthesized click land

    expect(
      await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks),
    ).toBe(4);
  });
});
