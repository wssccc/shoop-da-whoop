// Drag drop-target hit-testing and highlight geometry (port of
// solitaire-dropzone-probe + the drop-ok highlight work):
//   1. The dashed drop-zone outline is a STATIC board property: empty
//      columns show it, filled columns cover it with their first card.
//   2. Lifting the last card of a column visually empties it (outline
//      exposed again) with no state-class flip.
//   3. Dragging over legal targets toggles `.drop-ok` highlight; the
//      highlighted rect is the pile rect (not stretched to the row
//      height), and the empty-column rect is the outline box.
//   4. Dragging into the gap BELOW a short pile no longer hits the column.
import { expect, test } from '@playwright/test';
import { expectSettled, watchConsoleErrors } from './helpers/board';
import { makeSave, num, seedSave } from './helpers/save-state';

// col-1 tall (8 cards), col-3 short (2 cards), col-5 single black-4 (the
// drag source), everything else empty. No rank-1 tops → no boot auto-move.
const makeDropSave = () =>
  makeSave({
    tableau: [
      [],
      [num('n-red-6', 'red', 6), num('n-black-5', 'black', 5), num('n-red-4', 'red', 4), num('n-black-3', 'black', 3), num('n-red-2', 'red', 2), num('n-black-9', 'black', 9), num('n-red-8', 'red', 8), num('n-black-7', 'black', 7)],
      [],
      [num('n-green-2', 'green', 2), num('n-red-5', 'red', 5)],
      [],
      [num('n-black-4', 'black', 4)],
      [],
      [],
    ],
  });

const cardW = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-w')));
const cardH = async (page: import('@playwright/test').Page) =>
  page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--card-h')));

test.describe('drag drop-zones & highlight', () => {
  let assertNoErrors: () => Promise<void>;

  test.beforeEach(async ({ page }) => {
    assertNoErrors = watchConsoleErrors(page);
  });

  test.afterEach(async () => {
    await assertNoErrors();
  });

  test('dashed outline is static: empty cols expose it, filled cols cover it', async ({ page }) => {
    await seedSave(page, makeDropSave(), ['n-black-4', 'n-red-5']);
    await expectSettled(page);

    const H = await cardH(page);
    const W = await cardW(page);
    const statics = await page.evaluate(
      ({ H, W }) => {
        const read = (sel: string) => {
          const col = document.querySelector(sel) as HTMLElement;
          const r = col.getBoundingClientRect();
          const el = document.elementFromPoint(r.left + W / 2, r.top + H / 2);
          return {
            hasOutline: getComputedStyle(col, '::before').content !== 'none',
            coveredByCard: !!el && el.classList.contains('card'),
          };
        };
        return {
          emptyCol: read('.slot.col[data-slot="col-0"]'), // empty → outline exposed
          filledCol: read('.slot.col[data-slot="col-3"]'), // non-empty → first card covers it
        };
      },
      { H, W },
    );
    expect(statics.emptyCol.hasOutline).toBe(true);
    expect(statics.emptyCol.coveredByCard).toBe(false);
    expect(statics.filledCol.hasOutline).toBe(true); // ::before always present
    expect(statics.filledCol.coveredByCard).toBe(true);
  });

  test('dragging switches .drop-ok by geometry and the highlight fits the pile', async ({ page }) => {
    await seedSave(page, makeDropSave(), ['n-black-4', 'n-red-5']);
    await expectSettled(page);

    const H = await cardH(page);
    const W = await cardW(page);
    const src = await page.locator('.slot.col[data-slot="col-5"] .card').boundingBox();
    const fc0 = await page.locator('.slot.free-cell[data-slot="fc-0"]').boundingBox();
    const col3 = await page.locator('.slot.col[data-slot="col-3"]').boundingBox();
    const col0 = await page.locator('.slot.col[data-slot="col-0"]').boundingBox();

    const dropOkState = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.slot.drop-ok')].map((s) => s.getAttribute('data-slot')),
      );

    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();

    // 1) Over fc-0: free cell highlights.
    await page.mouse.move(fc0.x + fc0.width / 2, fc0.y + fc0.height / 2, { steps: 8 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toContain('fc-0');

    // 2) Over col-3 (short, non-empty): column highlights and its rect is
    //    the PILE rect — first card top to last card bottom (136 + 28px
    //    overlap for 2 cards), NOT stretched to the tallest column.
    await page.mouse.move(col3.x + col3.width / 2, col3.y + col3.height / 2, { steps: 8 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toEqual(['col-3']);
    const col3Rect = await page.evaluate(() => {
      const col = document.querySelector('.slot.col[data-slot="col-3"]') as HTMLElement;
      const cards = col.querySelectorAll('.card');
      const first = cards[0].getBoundingClientRect();
      const last = cards[cards.length - 1].getBoundingClientRect();
      return {
        colRect: col.getBoundingClientRect().toJSON(),
        pileTop: first.top,
        pileBottom: last.bottom,
        expectedPileH: Math.round(last.bottom - first.top),
      };
    });
    const pileH = Math.round(col3Rect.pileBottom - col3Rect.pileTop);
    expect(pileH).toBe(col3Rect.expectedPileH);
    // 2 cards: H + (H - 108px overlap). Not stretched to the 8-card row.
    expect(pileH).toBeGreaterThan(H);
    expect(pileH).toBeLessThan(H * 3);
    expect(Math.abs(col3Rect.colRect.top - col3Rect.pileTop)).toBeLessThan(2);
    expect(Math.abs(col3Rect.colRect.bottom - col3Rect.pileBottom)).toBeLessThan(2);

    // 3) Over col-0 (empty): the highlight is the outline box (card-sized).
    await page.mouse.move(col0.x + col0.width / 2, col0.y + col0.height / 2, { steps: 8 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toEqual(['col-0']);
    const col0Rect = await page.evaluate(() => {
      const col = document.querySelector('.slot.col[data-slot="col-0"]') as HTMLElement;
      const r = col.getBoundingClientRect();
      return { h: r.height, w: r.width };
    });
    expect(Math.round(col0Rect.h)).toBe(Math.round(H));
    expect(Math.round(col0Rect.w)).toBe(Math.round(W));

    // 4) Into the gap BELOW col-3's pile (inside the row, outside the pile
    //    rect): no column hit.
    const below = await page.evaluate(() => {
      const col = document.querySelector('.slot.col[data-slot="col-3"]') as HTMLElement;
      const r = col.getBoundingClientRect();
      const cards = col.querySelectorAll('.card');
      const last = cards[cards.length - 1].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: last.bottom + 10 };
    });
    await page.mouse.move(below.x, below.y, { steps: 4 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toEqual([]);

    // 5) Release over fc-0 → the card lands there (drag stays intact).
    await page.mouse.move(fc0.x + fc0.width / 2, fc0.y + fc0.height / 2, { steps: 4 });
    await page.mouse.up();
    await expectSettled(page);
    await expect(page.locator('.slot.free-cell[data-slot="fc-0"] .card')).toHaveAttribute('data-id', 'n-black-4');
  });
});
