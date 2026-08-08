// WinCard (no-modal victory) flow (port of win-card-probe):
//   1. A win triggers only AFTER the last flight lands (deferred win); the
//      emblem is a tableau-centered card with the two faces and 再来一局,
//      and NO overlay/dialog is open.
//   2. Undo unmounts the emblem and restores the pre-win board.
//   3. 再来一局 runs the exit animation (is-exiting + shrink), unmounts the
//      emblem and starts a fresh deal.
import { expect, test } from '@playwright/test';
import { dragCardTo, expectSettled, FLY_MS, watchConsoleErrors } from './helpers/board';
import { makeSave, num, seedSave } from './helpers/save-state';

const WINS_KEY = 'szsol.wins';

// black-9 on top is UNSAFE (black foundation full) so nothing auto-moves on
// boot; dragging it to fc-0 cascades red-9 home → win.
// NB: the tableau black-9 gets its own id (`t-black-9`) — the full black
// foundation already holds an `n-black-9`.
const makeWinSave = () =>
  makeSave({
    tableau: [[num('n-red-9', 'red', 9), num('t-black-9', 'black', 9)], [], [], [], [], [], [], []],
    foundations: {
      red: [1, 2, 3, 4, 5, 6, 7, 8].map((r) => num(`n-red-${r}`, 'red', r)),
      black: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => num(`n-black-${r}`, 'black', r)),
      green: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => num(`n-green-${r}`, 'green', r)),
    },
    flowerSlot: { id: 'flower', type: 'flower' },
  });

async function seedWinState(page: import('@playwright/test').Page): Promise<void> {
  await seedSave(page, makeWinSave(), ['t-black-9', 'n-red-9']);
  // Seed a wins counter so the pill bump is observable (seedSave's own
  // addInitScript runs first — it clears localStorage — so this one applies
  // afterwards and survives).
  await page.addInitScript((k) => {
    localStorage.setItem(k, '3');
  }, WINS_KEY);
  await page.reload();
  await expectSettled(page);
}

async function ensureWin(page: import('@playwright/test').Page): Promise<void> {
  await dragCardTo(page, 't-black-9', '.slot.free-cell[data-slot="fc-0"]');
}

test.describe('win card', () => {
  let assertNoErrors: () => Promise<void>;

  test.beforeEach(async ({ page }) => {
    assertNoErrors = watchConsoleErrors(page);
  });

  test.afterEach(async () => {
    await assertNoErrors();
  });

  test('emblem appears only after the flight lands, with card faces and no overlay', async ({ page }) => {
    await seedWinState(page);

    await ensureWin(page);

    // Red-9 flies home (320ms) — the emblem must NOT be up mid-flight.
    await page.waitForTimeout(FLY_MS / 2);
    await expect(page.locator('.win-stage')).toHaveCount(0);

    await expectSettled(page);
    await expect(page.locator('.win-stage')).toHaveCount(1);
    // Wait for the rAF entrance spin to LAND (WinCard.land() parks the card
    // at `rotateY(0deg) rotateX(0deg)` — earlier frames still carry a
    // rotateX that compresses the measured rect).
    await expect
      .poll(async () => {
        const t = await page.evaluate(
          () => (document.querySelector('.win-card') as HTMLElement | null)?.style.transform ?? '',
        );
        return t;
      }, { timeout: 6_000, message: 'win-card entrance never landed' })
      .toBe('rotateY(0deg) rotateX(0deg)');
    const info = await page.evaluate(() => {
      const stage = document.querySelector('.win-stage') as HTMLElement | null;
      const emblem = document.querySelector('.win-emblem') as HTMLElement | null;
      const card = document.querySelector('.win-card') as HTMLElement | null;
      const front = document.querySelector('.win-card .face.front img') as HTMLImageElement | null;
      const back = document.querySelector('.win-card .face.back img') as HTMLImageElement | null;
      const frontFace = document.querySelector('.win-card .face.front') as HTMLElement | null;
      const backFace = document.querySelector('.win-card .face.back') as HTMLElement | null;
      const btn = document.querySelector('.win-btn') as HTMLElement | null;
      const tableau = document.querySelector('.tableau') as HTMLElement | null;
      if (!stage || !emblem || !card || !front || !back || !btn || !tableau) return { present: false };
      const sr = stage.getBoundingClientRect();
      const tr = tableau.getBoundingClientRect();
      return {
        present: true,
        frontSrc: front.getAttribute('src') ?? '',
        backSrc: back.getAttribute('src') ?? '',
        emblemAnim: getComputedStyle(emblem).animationName,
        // The spin is rAF-driven (WinCard.vue writes the pose inline — the
        // old CSS coin-spin is gone), so assert the mechanism: inline pose
        // + JS-managed face visibility, front parked after landing.
        cardPose: card.style.transform,
        frontFaceVisible: frontFace?.style.visibility,
        backFaceHidden: backFace?.style.visibility,
        preserve3d: getComputedStyle(card).transformStyle === 'preserve-3d',
        cardW: card.getBoundingClientRect().width,
        cardH: card.getBoundingClientRect().height,
        btnText: btn.textContent?.trim() ?? '',
        centered:
          Math.abs(sr.left + sr.width / 2 - (tr.left + tr.width / 2)) < 4 &&
          Math.abs(sr.top + sr.height / 2 - (tr.top + tr.height / 2)) < 4,
        overlayOpen: !!document.querySelector('.overlay[data-state="open"]'),
        dialogCount: document.querySelectorAll('.dialog-content').length,
        wins: document.querySelector('.wins-pill span')?.textContent,
      };
    });
    expect(info.present).toBe(true);
    expect(info.frontSrc.endsWith('/images/2.gif')).toBe(true);
    expect(info.backSrc.endsWith('/images/card-back.svg')).toBe(true);
    expect(info.emblemAnim).toMatch(/win-breathe/);
    expect(info.emblemAnim).toMatch(/win-enter-scale/);
    expect(info.cardPose).toContain('rotateY'); // rAF pose is applied inline
    expect(info.frontFaceVisible).toBe('visible');
    expect(info.backFaceHidden).toBe('hidden');
    expect(info.preserve3d).toBe(true);
    // Same aspect ratio as a tableau card (140×198 ≈ 96×136 ≈ 0.706). The
    // absolute size breathes (win-breathe scales the emblem), so only the
    // ratio and a "clearly bigger than a tableau card" floor are asserted.
    expect(info.cardW / info.cardH).toBeCloseTo(140 / 198, 1);
    expect(info.cardW).toBeGreaterThan(110);
    expect(info.btnText).toBe('再来一局');
    expect(info.centered).toBe(true);
    expect(info.overlayOpen).toBe(false);
    expect(info.dialogCount).toBe(0);
    expect(info.wins).toBe('4');
  });

  test('undo unmounts the emblem; 再来一局 runs the exit animation then deals', async ({ page }) => {
    await seedWinState(page);
    await ensureWin(page);
    await expectSettled(page);
    await expect(page.locator('.win-stage')).toHaveCount(1);

    // Undo → emblem unmounts, board reverts to the pre-win layout.
    await page.locator('button[title="撤销"]').click();
    await expectSettled(page);
    await expect(page.locator('.win-stage')).toHaveCount(0);
    const col0 = await page.evaluate(() =>
      [...document.querySelectorAll('.slot.col[data-slot="col-0"] .card')].map((c) => (c as HTMLElement).dataset.id),
    );
    expect(col0).toEqual(['n-red-9', 't-black-9']);
    await expect(page.locator('.slot.foundation.c-red .card')).toHaveCount(8);

    // Re-win for the restart flow.
    await ensureWin(page);
    await expectSettled(page);
    await expect(page.locator('.win-stage')).toHaveCount(1);

    await page.locator('.win-btn').click();
    // Mid-exit: is-exiting + shrinking scale.
    await page.waitForTimeout(350);
    const mid = await page.evaluate(() => {
      const el = document.querySelector('.win-emblem') as HTMLElement | null;
      if (!el) return null;
      return {
        exiting: el.classList.contains('is-exiting'),
        scale: new DOMMatrix(getComputedStyle(el).transform).a,
      };
    });
    expect(mid).not.toBeNull();
    expect(mid!.exiting).toBe(true);
    expect(mid!.scale).toBeLessThan(1);
    expect(mid!.scale).toBeGreaterThan(0);

    // Exit is 1.0s → emblem unmounted, fresh deal on the board.
    await expectSettled(page, 20_000);
    await expect(page.locator('.win-stage')).toHaveCount(0);
    const cardCount = await page.evaluate(() => document.querySelectorAll('#board .card').length);
    expect(cardCount).toBeGreaterThan(0);
  });
});
