// Deal / hint / sealed-pile / layout behaviours (ports of
// solitaire-deal-settle-smoke, hint-undo-probe (essentials),
// dragon-pile-back-probe, solitaire-step3-visual):
//   1. A fresh deal + settle leaves zero inline-style residue, all 40
//      cards on the board and the busy lock released.
//   2. Hint solves the seeded board and executes the first step (animated),
//      then the board settles cleanly.
//   3. Sealed dragon piles restore statically as ONE full-size card back
//      each (no lock badge, no boot flip animation).
//   4. Layout sanity: toolbar sits above the tableau without overlap.
import { expect, test } from '@playwright/test';
import { expectSettled, watchConsoleErrors } from './helpers/board';
import { dragon, makeSave, num, seedSave } from './helpers/save-state';

const dragonPile = (color: 'red' | 'black' | 'green') => ({
  type: 'dragonpile' as const,
  locked: true as const,
  color,
  cards: [0, 1, 2, 3].map((i) => dragon(`dragon-${color}-${i}`, color)),
});

test.describe('deal, hint, sealed piles & layout', () => {
  let assertNoErrors: () => Promise<void>;

  test.beforeEach(async ({ page }) => {
    assertNoErrors = watchConsoleErrors(page);
  });

  test.afterEach(async () => {
    await assertNoErrors();
  });

  test('fresh deal + settle: no residue, 40 cards, busy released', async ({ page }) => {
    // No save in localStorage → the game deals a random 40-card layout and
    // settles safe auto-moves through the executor.
    await page.goto('/games/solitaire/');
    await expect(page.locator('#board .card').first()).toBeAttached();
    await expectSettled(page, 30_000);

    const state = await page.evaluate(() => ({
      total: document.querySelectorAll('#board .card').length,
      residue: [...document.querySelectorAll('#board .card')].filter((c) => {
        const s = (c as HTMLElement).style;
        return s.transform !== '' || s.zIndex !== '';
      }).length,
      flowerInSlot: document.querySelectorAll('.slot.flower-slot .card').length,
      // Hint is disabled while busy — after the deal settle it must be
      // enabled again (busy released).
      hintEnabled: !(document.querySelector('.btn-hint') as HTMLButtonElement).disabled,
    }));
    expect(state.total).toBe(40);
    expect(state.residue).toBe(0);
    expect(state.flowerInSlot).toBeLessThanOrEqual(1);
    expect(state.hintEnabled).toBe(true);
  });

  test('hint solves the board and executes the first step cleanly', async ({ page }) => {
    // Seeded WINNABLE layout (black-9 on top is unsafe; the solver must
    // find a full victory path, so the board has to actually be winnable).
    const save = makeSave({
      tableau: [[num('n-red-9', 'red', 9), num('t-black-9', 'black', 9)], [], [], [], [], [], [], []],
      foundations: {
        red: [1, 2, 3, 4, 5, 6, 7, 8].map((r) => num(`n-red-${r}`, 'red', r)),
        black: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => num(`n-black-${r}`, 'black', r)),
        green: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => num(`n-green-${r}`, 'green', r)),
      },
      flowerSlot: { id: 'flower', type: 'flower' },
    });
    await seedSave(page, save, ['t-black-9', 'n-red-9']);
    await expectSettled(page);

    const fingerprint = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('#board [data-slot] .card')]
          .map((c) => {
            const el = c as HTMLElement;
            return `${el.closest('[data-slot]')?.getAttribute('data-slot')}:${el.dataset.id}`;
          })
          .join(','),
      );
    const before = await fingerprint();

    const hintBtn = page.locator('.btn-hint');
    await hintBtn.click();
    // The worker solves this layout quickly and executes step 1 — which is
    // a WIN in one step here (black-9 → fc-0 cascades red-9 home), so the
    // emblem is the observable completion signal.
    await expect(page.locator('.win-stage')).toHaveCount(1, { timeout: 30_000 });
    await expectSettled(page);

    const after = await fingerprint();
    expect(after).not.toBe(before); // the hint step actually moved a card
  });

  test('sealed dragon piles restore statically as full-size card backs', async ({ page }) => {
    const save = makeSave({
      tableau: [[], [], [], [], [], [], [], []],
      freeCells: [dragonPile('red'), dragonPile('black'), dragonPile('green')],
    });
    await seedSave(page, save, ['dragon-red-0']);
    await expectSettled(page);

    await expect(page.locator('.locked-dragons .card-back')).toHaveCount(3);
    await expect(page.locator('.flip-card.flipped')).toHaveCount(3);
    await expect(page.locator('.locked-dragons .lock')).toHaveCount(0);

    // The back covers the whole slot (>0.95 both axes; slot border excluded).
    const cover = await page.evaluate(() => {
      const cell = document.querySelector('.slot.free-cell.locked') as HTMLElement;
      const c = cell.getBoundingClientRect();
      const b = (cell.querySelector('.card-back') as HTMLElement).getBoundingClientRect();
      return { w: b.width / c.width, h: b.height / c.height };
    });
    expect(cover.w).toBeGreaterThan(0.95);
    expect(cover.h).toBeGreaterThan(0.95);
  });

  test('layout sanity: toolbar sits above the tableau without overlap', async ({ page }) => {
    await page.goto('/games/solitaire/');
    await expect(page.locator('#board .card').first()).toBeAttached();
    await expectSettled(page, 30_000);

    const geo = await page.evaluate(() => {
      const tb = document.querySelector('.toolbar-panel')?.getBoundingClientRect();
      const tq = document.querySelector('.tableau')?.getBoundingClientRect();
      const cols = document.querySelectorAll('.slot.col').length;
      return {
        toolbarBottom: tb ? tb.bottom : -1,
        tableauTop: tq ? tq.top : -1,
        tableauLeft: tq ? tq.left : -1,
        cols,
      };
    });
    // Toolbar is a real flex item above the tableau strip; the tableau must
    // start BELOW it (row gap) and never overlap.
    expect(geo.cols).toBe(8);
    expect(geo.tableauTop).toBeGreaterThan(geo.toolbarBottom);
    expect(geo.tableauTop - geo.toolbarBottom).toBeGreaterThanOrEqual(4);
  });
});
