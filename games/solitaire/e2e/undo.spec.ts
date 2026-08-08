// Undo / busy-lock behaviours (ports of solitaire-undo-smoke,
// solitaire-undo-probe, solitaire-overlap-probe):
//   1. Undo restores the WHOLE unit — the dragged card AND the cascade it
//      triggered — with no inline-style residue.
//   2. The undo button is locked while the cascade flies (busy lock), and
//      undo after the flight returns the board to the pre-move snapshot
//      with every card in its original slot (no stuck cards).
//   3. Two quick consecutive drags (the second firing while the first
//      cascade is still airborne) settle cleanly without corrupting either
//      cascade's cards.
import { expect, test } from '@playwright/test';
import { dragCardTo, expectSettled, watchConsoleErrors } from './helpers/board';
import { dragon, makeSave, num, seedSave } from './helpers/save-state';

const undoBtn = (page: import('@playwright/test').Page) => page.locator('button[title="撤销"]');

test.describe('undo & busy lock', () => {
  let assertNoErrors: () => Promise<void>;

  test.beforeEach(async ({ page }) => {
    assertNoErrors = watchConsoleErrors(page);
  });

  test.afterEach(async () => {
    await assertNoErrors();
  });

  test('undo restores the whole unit (move + cascade) with no residue', async ({ page }) => {
    // green-3 buried under red-5; dragging red-5 away exposes the cascade
    // green-3 → black-4 → red-4.
    const save = makeSave({
      tableau: [
        [num('n-black-4', 'black', 4)],
        [num('n-red-4', 'red', 4)],
        [num('n-green-3', 'green', 3), num('n-red-5', 'red', 5)],
        [],
        [],
        [],
        [],
        [],
      ],
      foundations: {
        red: [1, 2, 3].map((r) => num(`n-red-${r}`, 'red', r)),
        black: [1, 2, 3].map((r) => num(`n-black-${r}`, 'black', r)),
        green: [1, 2].map((r) => num(`n-green-${r}`, 'green', r)),
      },
    });
    await seedSave(page, save, ['n-green-3', 'n-red-5']);
    await expectSettled(page);

    await dragCardTo(page, 'n-red-5', '.slot.free-cell[data-slot="fc-0"]');
    await expectSettled(page);

    // Post-move state: red-5 in fc-0, green foundation topped by green-3.
    await expect(page.locator('.slot.free-cell[data-slot="fc-0"] .card')).toHaveAttribute('data-id', 'n-red-5');
    await expect(page.locator('.slot.foundation.c-green .card')).toHaveCount(3);
    await expect(page.locator('.slot.foundation.c-green .card').last()).toHaveAttribute('data-id', 'n-green-3');
    await expect(undoBtn(page)).toBeEnabled();

    await undoBtn(page).click();
    await expectSettled(page);

    // Whole unit reverted: red-5 back on top of green-3, fc-0 empty,
    // green foundation back to 2, zero airborne/residual cards.
    await expect(page.locator('.slot.col[data-slot="col-2"] .card')).toHaveCount(2);
    const col2 = await page.evaluate(() =>
      [...document.querySelectorAll('.slot.col[data-slot="col-2"] .card')].map((c) => (c as HTMLElement).dataset.id),
    );
    expect(col2).toEqual(['n-green-3', 'n-red-5']);
    await expect(page.locator('.slot.free-cell[data-slot="fc-0"] .card')).toHaveCount(0);
    await expect(page.locator('.slot.foundation.c-green .card')).toHaveCount(2);
    const residue = await page.evaluate(
      () => [...document.querySelectorAll('#board .card')].filter((c) => {
        const s = (c as HTMLElement).style;
        return s.transform !== '' || s.zIndex !== '';
      }).length,
    );
    expect(residue).toBe(0);
  });

  test('undo is locked mid-flight and then restores the pre-move snapshot', async ({ page }) => {
    // Dragging dragon-green-0 away exposes a red 5→6→7→8 cascade (4 flights
    // ≈ 1.1s window) — long enough to observe the busy lock.
    const save = makeSave({
      tableau: [
        [num('n-red-5', 'red', 5), dragon('dragon-green-0', 'green')],
        [num('n-red-6', 'red', 6)],
        [num('n-red-7', 'red', 7)],
        [num('n-red-8', 'red', 8)],
        [dragon('dragon-black-0', 'black')],
        [dragon('dragon-green-1', 'green')],
        [dragon('dragon-red-0', 'red')],
        [dragon('dragon-green-2', 'green')],
      ],
      foundations: {
        red: [1, 2, 3, 4].map((r) => num(`n-red-${r}`, 'red', r)),
        black: [1, 2, 3, 4, 5, 6, 7].map((r) => num(`n-black-${r}`, 'black', r)),
        green: [1, 2, 3, 4, 5, 6, 7].map((r) => num(`n-green-${r}`, 'green', r)),
      },
    });
    await seedSave(page, save, ['dragon-green-0', 'n-red-8']);
    await expectSettled(page);

    await dragCardTo(page, 'dragon-green-0', '.slot.free-cell[data-slot="fc-0"]');

    // The drop settle (250ms) then the cascade hold the busy lock: the
    // undo button must be disabled while cards are airborne.
    await expect(undoBtn(page)).toBeDisabled({ timeout: 6_000 });

    await expectSettled(page);
    await expect(undoBtn(page)).toBeEnabled();
    await undoBtn(page).click();
    await expectSettled(page);

    // Board back to the pre-move snapshot: red 5-8 back in their columns,
    // dragon back on top of col-0, foundation.red back to 1-4, fc-0 empty.
    const where = await page.evaluate(() => {
      const out: Record<string, string> = {};
      for (const id of ['n-red-5', 'n-red-6', 'n-red-7', 'n-red-8', 'dragon-green-0']) {
        const el = document.querySelector(`.card[data-id="${id}"]`);
        out[id] = el ? (el.closest('[data-slot]')?.getAttribute('data-slot') ?? '??') : 'GONE';
      }
      return out;
    });
    expect(where).toEqual({
      'n-red-5': 'col-0',
      'n-red-6': 'col-1',
      'n-red-7': 'col-2',
      'n-red-8': 'col-3',
      'dragon-green-0': 'col-0',
    });
    await expect(page.locator('.slot.foundation.c-red .card')).toHaveCount(4);
    await expect(page.locator('.slot.free-cell[data-slot="fc-0"] .card')).toHaveCount(0);
  });

  test('drag during the settle/cascade busy lock is rejected; the first cascade completes cleanly', async ({ page }) => {
    // col0 drag exposes red-5 (1 flight), col3 drag exposes black-6. A
    // second drag started right after the first drop lands inside the busy
    // lock (drop settle 250ms + cascade) and MUST be ignored — the engine
    // stays consistent, the first cascade completes, and the second card
    // set is still fully draggable afterwards.
    const save = makeSave({
      tableau: [
        [num('n-red-5', 'red', 5), dragon('dragon-green-0', 'green')],
        [dragon('dragon-red-0', 'red')],
        [dragon('dragon-green-1', 'green')],
        [num('n-black-6', 'black', 6), dragon('dragon-red-1', 'red')],
        [dragon('dragon-green-2', 'green')],
        [dragon('dragon-black-0', 'black')],
        [dragon('dragon-green-3', 'green')],
        [dragon('dragon-black-1', 'black')],
      ],
      foundations: {
        red: [1, 2, 3, 4].map((r) => num(`n-red-${r}`, 'red', r)),
        black: [1, 2, 3, 4, 5].map((r) => num(`n-black-${r}`, 'black', r)),
        green: [1, 2, 3, 4, 5, 6, 7].map((r) => num(`n-green-${r}`, 'green', r)),
      },
    });
    await seedSave(page, save, ['dragon-green-0', 'dragon-red-1']);
    await expectSettled(page);

    await dragCardTo(page, 'dragon-green-0', '.slot.free-cell[data-slot="fc-0"]', { steps: 4 });

    // The busy lock is on (settle + cascade) — a second drag is rejected.
    await expect(undoBtn(page)).toBeDisabled({ timeout: 6_000 });
    await dragCardTo(page, 'dragon-red-1', '.slot.free-cell[data-slot="fc-1"]', { steps: 4 });
    // Rejected: dragon-red-1 is still in col-3 with black-6 under it.
    await expect(page.locator('.slot.col[data-slot="col-3"] .card')).toHaveCount(2);
    await expect(page.locator('.slot.free-cell[data-slot="fc-1"] .card')).toHaveCount(0);

    // First cascade completes untouched.
    await expectSettled(page, 20_000);
    await expect(page.locator('.slot.foundation.c-red .card')).toHaveCount(5);
    await expect(page.locator('.slot.foundation.c-red .card').last()).toHaveAttribute('data-id', 'n-red-5');
    const residue = await page.evaluate(() =>
      [...document.querySelectorAll('#board .card')].filter((c) => {
        const s = (c as HTMLElement).style;
        return s.transform !== '' || s.zIndex !== '';
      }).length,
    );
    expect(residue).toBe(0);

    // Now unlocked — the second card set drags and cascades normally.
    await dragCardTo(page, 'dragon-red-1', '.slot.free-cell[data-slot="fc-1"]', { steps: 4 });
    await expectSettled(page);
    await expect(page.locator('.slot.foundation.c-black .card')).toHaveCount(6);
    await expect(page.locator('.slot.foundation.c-black .card').last()).toHaveAttribute('data-id', 'n-black-6');
  });
});
