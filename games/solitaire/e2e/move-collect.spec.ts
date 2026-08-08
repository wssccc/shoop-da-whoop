// Move / collect behaviours (ports of solitaire-collect-smoke,
// dragon-collect-vanish-probe, solitaire-colcascade-probe):
//   1. 收龙: dragons commit in ENGINE column order, the pile stays
//      front-faced mid-flight and seals to one card back when complete,
//      undo is disabled while flying.
//   2. Auto-move order: exposing a cascade flies cards in engine order
//      (ranks ascending, column tie-break), not colour-grouped.
//   3. Win timing: the win emblem appears only AFTER the last flight lands.
//   4. Number cards never leave the board while the dragons fly (they must
//      not vanish / teleport off-viewport — the (-584,720) regression).
//   5. Same-column cascade converges without reversing the source stacking.
import { expect, test } from '@playwright/test';
import {
    card,
    dragCardTo,
    expectCardIds,
    expectSettled,
    FLY_MS,
    slot,
    watchConsoleErrors,
    watchTakeOffs,
} from './helpers/board';
import { dragon, flower, makeSave, num, seedSave } from './helpers/save-state';

const full = (color: 'red' | 'black' | 'green') =>
  Array.from({ length: 9 }, (_, k) => num(`n-${color}-${k + 1}`, color, k + 1));

test.describe('move & collect', () => {
  let assertNoErrors: () => Promise<void>;

  test.beforeEach(async ({ page }) => {
    assertNoErrors = watchConsoleErrors(page);
  });

  test.afterEach(async () => {
    await assertNoErrors();
  });

  test('收龙: engine column order, front-faced mid-flight, seals to one back', async ({ page }) => {
    // Dragons at different exposure layers: engine collects by column
    // (0→7), peel flies by layer — the orders diverge, exercising the
    // arrival-order stacking fix.
    const redDragons = [0, 1, 2, 3].map((i) => dragon(`dragon-red-${i}`, 'red'));
    const save = makeSave({
      tableau: [
        [num('n-red-8', 'red', 8), num('n-black-7', 'black', 7), redDragons[0]],
        [num('n-green-9', 'green', 9)],
        [num('n-red-9', 'red', 9)],
        [num('n-black-9', 'black', 9)],
        [num('n-green-8', 'green', 8)],
        [num('n-red-6', 'red', 6), num('n-black-5', 'black', 5), num('n-green-4', 'green', 4), num('n-red-3', 'red', 3), redDragons[1]],
        [num('n-green-7', 'green', 7), redDragons[2]],
        [num('n-black-8', 'black', 8), redDragons[3]],
      ],
      // One history entry so canUndo=true — the "undo disabled mid-flight"
      // assertion then really exercises the busy lock, not a missing stack.
      history: [makeSave({ tableau: [] })],
    });
    await seedSave(page, save, ['dragon-red-0', 'dragon-red-1', 'dragon-red-2', 'dragon-red-3']);
    await expectSettled(page);

    const collectBtn = page.locator('.dragon-btn');
    await expect(collectBtn).toBeEnabled();
    const readTakeOffs = await watchTakeOffs(page);

    await collectBtn.click();

    // Sequential consume: the first dragon renders into the locked cell
    // almost immediately; the pile is NOT sealed yet (cards.length < 4).
    await expect(page.locator('.slot.free-cell .card').first()).toBeAttached();
    await expect(page.locator('.flip-card.flipped')).toHaveCount(0);
    await expect(page.locator('button[title="撤销"]')).toBeDisabled();

    await expectSettled(page);
    const takeOffs = await readTakeOffs();
    expect(takeOffs).toEqual(['dragon-red-0', 'dragon-red-1', 'dragon-red-2', 'dragon-red-3']);

    // DOM order inside the pile IS the arrival order (last on top).
    const stack = await page.evaluate(() =>
      [...document.querySelectorAll('.slot.free-cell.locked .locked-dragons .card')].map(
        (c) => (c as HTMLElement).dataset.id ?? '',
      ),
    );
    expect(stack).toEqual(['dragon-red-0', 'dragon-red-1', 'dragon-red-2', 'dragon-red-3']);
    // Pile complete → flip to ONE card back, lock badge removed.
    await expect(page.locator('.flip-card.flipped')).toHaveCount(1);
    await expect(page.locator('.locked-dragons .card-back')).toHaveCount(1);
    await expect(page.locator('.locked-dragons .lock')).toHaveCount(0);
  });

  test('auto-move cascade flies in engine order (ranks ascending, column tie-break)', async ({ page }) => {
    // green-3 is buried under red-5; dragging red-5 away exposes the cascade.
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

    const readTakeOffs = await watchTakeOffs(page);
    await dragCardTo(page, 'n-red-5', '.slot.free-cell[data-slot="fc-0"]');

    await expectSettled(page);
    const auto = (await readTakeOffs()).filter((id) => id !== 'n-red-5'); // the drag tween itself
    expect(auto).toEqual(['n-green-3', 'n-black-4', 'n-red-4']);

    await expect(page.locator('.slot.foundation.c-black .card')).toHaveCount(4);
    await expect(page.locator('.slot.foundation.c-red .card')).toHaveCount(4);
    await expect(page.locator('.slot.foundation.c-green .card')).toHaveCount(3);
  });

  test('win emblem appears only after the last flight lands, wins persisted', async ({ page }) => {
    // Move red-6 away → black-7 → green-8 → black-8 → green-9 → black-9 → win.
    // NB: the tableau red-6 gets its own id (`t-red-6`) — the foundations
    // already hold an `n-red-6`, and duplicate data-ids would confuse both
    // Vue's keying and every data-id locator.
    const save = makeSave({
      tableau: [
        [num('n-green-9', 'green', 9), num('n-green-8', 'green', 8)],
        [num('n-red-9', 'red', 9), num('n-black-8', 'black', 8)],
        [num('n-black-7', 'black', 7), num('t-red-6', 'red', 6)],
        [num('n-black-9', 'black', 9)],
        [],
        [],
        [],
        [],
      ],
      foundations: {
        red: full('red'),
        black: [1, 2, 3, 4, 5, 6].map((r) => num(`n-black-${r}`, 'black', r)),
        green: [1, 2, 3, 4, 5, 6, 7].map((r) => num(`n-green-${r}`, 'green', r)),
      },
      flowerSlot: flower('flower'),
    });
    await seedSave(page, save, ['t-red-6', 'flower']);
    await expectSettled(page);

    const readTakeOffs = await watchTakeOffs(page);
    await dragCardTo(page, 't-red-6', '.slot.free-cell[data-slot="fc-0"]');

    // Mid-flight (first card airborne): the emblem must NOT be up.
    await page.waitForTimeout(FLY_MS / 2);
    await expect(page.locator('.win-stage')).toHaveCount(0);

    await expectSettled(page);
    await expect(page.locator('.win-stage')).toHaveCount(1);
    const auto = (await readTakeOffs()).filter((id) => id !== 't-red-6');
    expect(auto).toEqual(['n-black-7', 'n-green-8', 'n-black-8', 'n-green-9', 'n-black-9']);

    const wins = await page.evaluate(() => Number(localStorage.getItem('szsol.wins') || '0'));
    expect(wins).toBe(1);
  });

  test('number cards never leave the board while the dragons fly', async ({ page }) => {
    // Green column 9..1 is buried under dragon-red-0; red/black foundations
    // are full so boot auto-move can't touch the column. Collecting the
    // dragons must keep every number card in the DOM at ALL times, and
    // every in-flight card (z=9000) must stay inside the viewport — the
    // old bug teleported cards off-screen ((-584,720)) while still firing
    // transitionstart, which pure order assertions cannot catch.
    const redDragons = [0, 1, 2, 3].map((i) => dragon(`dragon-red-${i}`, 'red'));
    const save = makeSave({
      tableau: [
        [
          num('n-green-9', 'green', 9), num('n-green-8', 'green', 8),
          num('n-green-7', 'green', 7), num('n-green-6', 'green', 6),
          num('n-green-5', 'green', 5), num('n-green-4', 'green', 4),
          num('n-green-3', 'green', 3), num('n-green-2', 'green', 2),
          num('n-green-1', 'green', 1), redDragons[0],
        ],
        [redDragons[1]],
        [redDragons[2]],
        [redDragons[3]],
        [],
        [],
        [],
        [],
      ],
      foundations: { red: full('red'), black: full('black'), green: [] },
    });
    await seedSave(page, save, ['n-green-1', 'dragon-red-0']);
    await expectSettled(page);
    const numIds = Array.from({ length: 9 }, (_, k) => `n-green-${k + 1}`);

    await page.locator('.dragon-btn').click();

    // Sample continuously while the 4-dragon flight runs (~1s): every
    // number card must stay attached, and every flight card (z=9000) must
    // stay inside the viewport bounds.
    const violations: string[] = [];
    const deadline = Date.now() + 2500;
    let sawFlight = false;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => {
        const present = new Set(
          [...document.querySelectorAll('#board .card')].map((c) => (c as HTMLElement).dataset.id ?? ''),
        );
        const flight = [...document.querySelectorAll('#board .card')].filter(
          (c) => (c as HTMLElement).style.zIndex === '9000',
        );
        const outOfViewport = flight
          .map((c) => {
            const r = c.getBoundingClientRect();
            return { id: (c as HTMLElement).dataset.id, l: r.left, t: r.top, r: r.right, b: r.bottom };
          })
          .filter((r) => r.l < -50 || r.t < -50 || r.r > window.innerWidth + 50 || r.b > window.innerHeight + 50);
        return { present: [...present], outOfViewport, flightCount: flight.length };
      });
      if (state.flightCount > 0) sawFlight = true;
      for (const id of numIds) {
        if (!state.present.includes(id)) violations.push(`missing ${id}`);
      }
      for (const r of state.outOfViewport) violations.push(`${r.id} off-viewport at(${r.l},${r.t})`);
      if (violations.length > 0) break;
      await page.waitForTimeout(40);
    }

    expect(sawFlight, 'collect flight should have been observed').toBe(true);
    expect(violations).toEqual([]);

    await expectSettled(page);
    await expect(page.locator('.slot.foundation.c-green .card')).toHaveCount(9);
    // Whole-board check: nothing lost and nothing extra — foundations are
    // full (red/black 1-9) plus the 9 greens and the 4 dragons.
    await expectCardIds(page, [
      ...numIds,
      ...['dragon-red-0', 'dragon-red-1', 'dragon-red-2', 'dragon-red-3'],
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => `n-red-${r}`),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => `n-black-${r}`),
    ]);
  });

  test('same-column cascade converges without losing the source stack', async ({ page }) => {
    // col0 = [black-7, red-6, dragon-black-3]. Dragging the dragon exposes
    // red-6 (safe: red=5) then black-7 (safe: black=6) — two cards from the
    // SAME column flying in engine order without reversing stacking.
    const save = makeSave({
      tableau: [
        [num('n-black-7', 'black', 7), num('n-red-6', 'red', 6), dragon('dragon-black-3', 'black')],
        [dragon('dragon-red-0', 'red')],
        [dragon('dragon-green-0', 'green')],
        [dragon('dragon-black-0', 'black')],
        [dragon('dragon-green-1', 'green')],
        [dragon('dragon-red-1', 'red')],
        [dragon('dragon-black-1', 'black')],
        [dragon('dragon-green-2', 'green')],
      ],
      foundations: {
        red: [1, 2, 3, 4, 5].map((r) => num(`n-red-${r}`, 'red', r)),
        black: [1, 2, 3, 4, 5, 6].map((r) => num(`n-black-${r}`, 'black', r)),
        green: [1, 2, 3, 4, 5, 6].map((r) => num(`n-green-${r}`, 'green', r)),
      },
    });
    await seedSave(page, save, ['dragon-black-3', 'n-red-6']);
    await expectSettled(page);

    await dragCardTo(page, 'dragon-black-3', '.slot.free-cell[data-slot="fc-0"]');

    await expectSettled(page);
    const fRed = await page.evaluate(() =>
      [...document.querySelectorAll('.slot.foundation.c-red .card')].map((c) => (c as HTMLElement).dataset.id),
    );
    const fBlack = await page.evaluate(() =>
      [...document.querySelectorAll('.slot.foundation.c-black .card')].map((c) => (c as HTMLElement).dataset.id),
    );
    expect(fRed).toEqual(['n-red-1', 'n-red-2', 'n-red-3', 'n-red-4', 'n-red-5', 'n-red-6']);
    expect(fBlack).toEqual(['n-black-1', 'n-black-2', 'n-black-3', 'n-black-4', 'n-black-5', 'n-black-6', 'n-black-7']);
    // The dragged dragon sits in fc-0.
    await expect(card(page, 'dragon-black-3')).toBeAttached();
    await expect(slot(page, 'fc-0').locator('.card')).toHaveCount(1);
  });
});
