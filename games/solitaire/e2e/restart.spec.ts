// 重新开始 (restart) button — the toolbar's bulk rewind (engine.undoAll):
//   1. It always asks first, and 取消 is a strict no-op (board AND undo stack).
//   2. 确定 rewinds the whole undo stack and lands on the OPENING frame — the
//      raw deal re-settled by the post-deal auto-moves, not the raw deal —
//      then empties the stack: 撤销/重新开始 both grey out and the emptied
//      stack is what a reload restores.
//   3. Same deal, no re-shuffle: a played move is undone by the restart
//      (a re-deal would almost surely produce a different layout).
//   4. Unlike 新局 (which skips its dialog on a won board) the rewind still
//      asks — the finished position is destroyed for good — and the emblem
//      unmounts while the 胜局 counter keeps the win.
import { expect, test, type Page } from '@playwright/test';
import { dragCardTo, expectSettled, watchConsoleErrors } from './helpers/board';
import { makeSave, num, seedSave } from './helpers/save-state';
import type { Snapshot } from '../src/game/types';

const STORAGE_SAVE = 'szsol.save';
const WINS_KEY = 'szsol.wins';

const restartBtn = (page: Page) => page.locator('.controls button.btn-restart');
const undoBtn = (page: Page) => page.locator('button[title="撤销"]');
const dialog = (page: Page) => page.locator('.restart-card');

/** Every slot's card ids in DOM order — the whole board as one comparable string. */
async function boardSignature(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify(
      [...document.querySelectorAll('.slot[data-slot]')].map((s) => [
        (s as HTMLElement).dataset.slot,
        [...s.querySelectorAll('.card')].map((c) => (c as HTMLElement).dataset.id),
      ]),
    ),
  );
}

/** Length of the persisted undo stack (-1 when there is no save at all). */
async function saveHistoryLength(page: Page): Promise<number> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return -1;
    const parsed = JSON.parse(raw) as { history?: unknown[] };
    return Array.isArray(parsed.history) ? parsed.history.length : -1;
  }, STORAGE_SAVE);
}

/**
 * Mid-game board with a 2-deep undo stack:
 *   history[0] = the OPENING frame (red-1 still sitting on top of col-0 — the
 *                raw deal, before the post-deal settle collected it)
 *   history[1] = the settled frame (red-1 home)
 * The live board is the settled frame with black-8 parked in a free cell, so
 * a full rewind has to pop TWO entries and then re-run the settle.
 */
async function seedMidGame(page: Page): Promise<void> {
  const opening = makeSave({
    tableau: [
      [num('n-black-9', 'black', 9), num('n-red-1', 'red', 1)],
      [], [], [], [], [], [], [],
    ],
  }) as unknown as Snapshot;
  const settled = makeSave({
    tableau: [[num('n-black-9', 'black', 9)], [], [], [], [], [], [], []],
    foundations: { red: [num('n-red-1', 'red', 1)] },
  }) as unknown as Snapshot;
  const save = makeSave({
    tableau: [[], [], [], [], [], [], [], []],
    freeCells: [num('n-black-8', 'black', 8), null, null],
    foundations: { red: [num('n-red-1', 'red', 1)] },
    history: [opening, settled],
  });
  await seedSave(page, save, ['n-black-8']);
  await expectSettled(page);
}

test.describe('重新开始 (restart)', () => {
  let assertNoErrors: () => Promise<void>;

  test.beforeEach(async ({ page }) => {
    assertNoErrors = watchConsoleErrors(page);
  });

  test.afterEach(async () => {
    await assertNoErrors();
  });

  test('取消 is a strict no-op — board and undo stack untouched', async ({ page }) => {
    await seedMidGame(page);
    const before = await boardSignature(page);
    await expect(undoBtn(page)).toBeEnabled();
    expect(await saveHistoryLength(page)).toBe(2);

    await restartBtn(page).click();
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).locator('h2')).toHaveText('重新开始本局？');
    await expect(dialog(page).locator('p')).toHaveText('将回到本局开局状态，撤销记录会清空。');

    await dialog(page).locator('.btn-ghost').click();

    await expect(dialog(page)).toHaveCount(0);
    expect(await boardSignature(page)).toBe(before);
    await expect(undoBtn(page)).toBeEnabled();
    expect(await saveHistoryLength(page)).toBe(2);
  });

  test('确定 rewinds the whole stack, lands on the opening frame and persists it', async ({ page }) => {
    await seedMidGame(page);
    await expect(page.locator('.slot.free-cell[data-slot="fc-0"] .card')).toHaveAttribute('data-id', 'n-black-8');

    await restartBtn(page).click();
    await dialog(page).locator('.btn-primary').click();
    await expectSettled(page);

    // black-9 is back in col-0 (both snapshots popped) and the red-1 that sat
    // on top of it was auto-collected AGAIN — the rewind settles the deal like
    // a fresh one instead of stopping at the raw deal (it would still be
    // sitting on the column otherwise).
    await expect(page.locator('.slot.col[data-slot="col-0"] .card')).toHaveCount(1);
    await expect(page.locator('.slot.col[data-slot="col-0"] .card')).toHaveAttribute('data-id', 'n-black-9');
    await expect(page.locator('.slot.foundation.c-red .card')).toHaveCount(1);
    await expect(page.locator('.slot.free-cell[data-slot="fc-0"] .card')).toHaveCount(0);

    // The rewind is the new floor: nothing to undo, nothing to re-restart.
    await expect(undoBtn(page)).toBeDisabled();
    await expect(restartBtn(page)).toBeDisabled();
    expect(await saveHistoryLength(page)).toBe(0);

    // …and the emptied stack is exactly what a fresh page restores.
    // NB: a reload() would NOT do here — seedSave's addInitScript re-injects
    // the seed on every navigation (that is its job), so the check has to come
    // from a page that never ran it. Same context → same localStorage.
    const after = await boardSignature(page);
    const fresh = await page.context().newPage();
    await fresh.goto('/games/solitaire/');
    await expect(fresh.locator('#board .card').first()).toBeAttached();
    await expectSettled(fresh);
    expect(await boardSignature(fresh)).toBe(after);
    await fresh.close();
  });

  test('a real deal: the rewind reproduces the dealt layout after a played move', async ({ page }) => {
    await page.goto('/games/solitaire/');
    await expect(page.locator('#board .card').first()).toBeAttached();
    await expectSettled(page);
    // A boot-dealt board carries no undo stack → nothing to rewind.
    await expect(restartBtn(page)).toBeDisabled();

    await page.locator('.controls button[title="新局"]').click();
    await page.locator('.newgame-card .btn-primary').click();
    await expectSettled(page, 30_000);
    const dealt = await boardSignature(page);
    await expect(undoBtn(page)).toBeEnabled();

    const top = await page.evaluate(
      () => (document.querySelector('.slot.col[data-slot="col-0"] .card:last-child') as HTMLElement | null)?.dataset.id,
    );
    expect(top, 'col-0 must hold a dealt card').toBeTruthy();
    await dragCardTo(page, top!, '.slot.free-cell[data-slot="fc-0"]');
    await expectSettled(page);
    expect(await boardSignature(page)).not.toBe(dealt);

    await restartBtn(page).click();
    await dialog(page).locator('.btn-primary').click();
    await expectSettled(page);

    // Same deal (nothing re-shuffled), same opening frame, nothing left to undo.
    expect(await boardSignature(page)).toBe(dealt);
    await expect(undoBtn(page)).toBeDisabled();
  });

  test('a won board still asks — and the rewind clears the emblem but keeps the win counted', async ({ page }) => {
    // black-9 on top is UNSAFE (black foundation full) so nothing auto-moves on
    // boot; dragging it to fc-0 cascades red-9 home → win.
    await seedSave(
      page,
      makeSave({
        tableau: [
          [num('n-red-9', 'red', 9), num('t-black-9', 'black', 9)],
          [], [], [], [], [], [], [],
        ],
        foundations: {
          red: [1, 2, 3, 4, 5, 6, 7, 8].map((r) => num(`n-red-${r}`, 'red', r)),
          black: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => num(`n-black-${r}`, 'black', r)),
          green: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => num(`n-green-${r}`, 'green', r)),
        },
        flowerSlot: { id: 'flower', type: 'flower' },
      }),
      ['t-black-9', 'n-red-9'],
    );
    await page.addInitScript((k) => {
      localStorage.setItem(k, '3');
    }, WINS_KEY);
    await page.reload();
    await expectSettled(page);

    await dragCardTo(page, 't-black-9', '.slot.free-cell[data-slot="fc-0"]');
    await expectSettled(page);
    await expect(page.locator('.win-stage')).toHaveCount(1);
    await expect(page.locator('.wins-pill span')).toHaveText('4');
    await expect(restartBtn(page)).toBeEnabled();

    // 新局 skips its dialog on a won board (nothing left to lose); the rewind
    // does NOT — it throws the finished position away for good.
    await restartBtn(page).click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).locator('.btn-primary').click();
    await expectSettled(page);

    await expect(page.locator('.win-stage')).toHaveCount(0);
    await expect(undoBtn(page)).toBeDisabled();
    // Back to the seeded board: both cards on col-0, red-9 no longer home,
    // and the win that already happened stays counted.
    await expect(page.locator('.slot.col[data-slot="col-0"] .card')).toHaveCount(2);
    await expect(page.locator('.slot.foundation.c-red .card')).toHaveCount(8);
    await expect(page.locator('.slot.free-cell[data-slot="fc-0"] .card')).toHaveCount(0);
    await expect(page.locator('.wins-pill span')).toHaveText('4');
  });
});
