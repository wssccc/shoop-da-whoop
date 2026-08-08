// Drag drop-target hit-testing and highlight geometry (port of
// solitaire-dropzone-probe + the drop-ok highlight work):
//   1. The dashed drop-zone outline is a STATIC board property: empty
//      columns show it, filled columns cover it with their first card.
//   2. Lifting the last card of a column visually empties it (outline
//      exposed again) with no state-class flip.
//   3. Dragging over legal targets toggles `.drop-ok` highlight; the
//      highlighted rect is the pile rect (not stretched to the row
//      height), and the empty-column rect is the outline box.
//   4. A tableau column's HIT rect is its FULL drop zone: the pile rect
//      extended DOWN to the viewport bottom — the empty space below a short
//      pile still hits the column (while the highlight stays on the pile
//      rect, which never stretches). Below the viewport: no hit.
//   5. The drop candidate is the HEAD card's geometric center, not the
//      pointer: a corner/edge grab highlights the slot under the CARD (and
//      releases into it), even when the pointer sits outside that slot.
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

    // 4) Into the empty space BELOW col-3's pile (inside the row, outside the
    //    pile rect, but still inside the column's EXTENDED drop zone — down
    //    to the viewport bottom): the column still hits.
    const below = await page.evaluate(() => {
      const col = document.querySelector('.slot.col[data-slot="col-3"]') as HTMLElement;
      const r = col.getBoundingClientRect();
      const cards = col.querySelectorAll('.card');
      const last = cards[cards.length - 1].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: last.bottom + 10 };
    });
    await page.mouse.move(below.x, below.y, { steps: 4 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toEqual(['col-3']);

    // 5) Release over fc-0 → the card lands there (drag stays intact).
    await page.mouse.move(fc0.x + fc0.width / 2, fc0.y + fc0.height / 2, { steps: 4 });
    await page.mouse.up();
    await expectSettled(page);
    await expect(page.locator('.slot.free-cell[data-slot="fc-0"] .card')).toHaveAttribute('data-id', 'n-black-4');
  });

  test('grab by the card edge: the drop candidate is the CARD center, not the pointer', async ({ page }) => {
    await seedSave(page, makeDropSave(), ['n-black-4', 'n-red-5']);
    await expectSettled(page);

    // Geometry preconditions: the drop-candidate math below assumes the
    // DESKTOP breakpoint (--card-w=96, --gap=10, fixed 1280x900 viewport).
    // If these variables change, the assertions below would silently start
    // testing the old pointer-based behaviour — fail loudly instead.
    //   cardW <= 102: the candidate at pointer fc0.x+55 is then OUTSIDE fc-0
    //   (55 + cardW/2 - 4 > cardW ⇔ cardW < 102); with cardW=96 it sits at
    //   fc0.right + 3.
    //   gap >= 6: that candidate stays OUTSIDE fc-1 too (gap > 51 - cardW/2;
    //   with gap=10 it sits 7px short of fc-1's left edge).
    const W = await cardW(page);
    const gap = await page.evaluate(() => {
      const a = document.querySelector('.slot.free-cell[data-slot="fc-0"]')!.getBoundingClientRect();
      const b = document.querySelector('.slot.free-cell[data-slot="fc-1"]')!.getBoundingClientRect();
      return b.left - a.right;
    });
    expect(W).toBeLessThanOrEqual(102);
    expect(gap).toBeGreaterThanOrEqual(6);

    const src = await page.locator('.slot.col[data-slot="col-5"] .card').boundingBox();
    const fc0 = await page.locator('.slot.free-cell[data-slot="fc-0"]').boundingBox();

    // Grab near the card's LEFT edge: the head-card center then rides
    // (W/2 - 4)px to the RIGHT of the pointer for the whole drag — the
    // pointer and the card disagree about which slot they're over.
    const grabX = src.x + 4;
    const grabY = src.y + src.height / 2;
    const offX = src.x + src.width / 2 - grabX; // card center − pointer, fixed
    await page.mouse.move(grabX, grabY);
    await page.mouse.down();

    const dropOkState = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.slot.drop-ok')].map((s) => s.getAttribute('data-slot')),
      );

    // 1) Pointer OUTSIDE fc-0 (24px to its left), card center INSIDE it
    //    (20px in): the card decides — fc-0 highlights.
    await page.mouse.move(fc0.x - 24, fc0.y + fc0.height / 2, { steps: 8 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toContain('fc-0');

    // 2) Pointer INSIDE fc-0 (55px in), card center in the 10px dead gap
    //    between fc-0 and fc-1 (fc0.right + 3): no target under the card —
    //    no highlight (the old pointer-based test would highlight fc-0).
    await page.mouse.move(fc0.x + 55, fc0.y + fc0.height / 2, { steps: 8 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toEqual([]);

    // 3) Release in the pose from (1): the pointer is still outside fc-0 but
    //    the CARD sits over it — the drop commits into fc-0 (its visual
    //    seat), not the pointer's void.
    await page.mouse.move(fc0.x - 24, fc0.y + fc0.height / 2, { steps: 4 });
    await page.mouse.up();
    await expectSettled(page);
    await expect(page.locator('.slot.free-cell[data-slot="fc-0"] .card')).toHaveAttribute('data-id', 'n-black-4');

    expect(offX).toBeGreaterThan(0); // sanity: offset math above assumed it
  });

  test('empty space below a pile hits the column; below the viewport it does not', async ({ page }) => {
    await seedSave(page, makeDropSave(), ['n-black-4', 'n-red-5']);
    await expectSettled(page);

    const src = await page.locator('.slot.col[data-slot="col-5"] .card').boundingBox();
    const col3 = await page.locator('.slot.col[data-slot="col-3"]').boundingBox();
    const viewport = page.viewportSize()!;

    const dropOkState = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.slot.drop-ok')].map((s) => s.getAttribute('data-slot')),
      );

    // Center grab of the single card in col-5.
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();

    // 1) Card center DEEP BELOW col-3's 2-card pile (160px into the empty
    //    space, still inside the viewport): the column's extended drop zone
    //    hits — col-3 highlights (the old pile-rect test would not).
    await page.mouse.move(col3.x + col3.width / 2, col3.y + col3.height + 160, { steps: 8 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toEqual(['col-3']);

    // 2) Card center BELOW the viewport bottom: the zone ends there — no hit.
    await page.mouse.move(col3.x + col3.width / 2, viewport.height + 120, { steps: 8 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toEqual([]);

    // 3) Release down there: nothing is targeted, the card settles back home.
    await page.mouse.up();
    await expectSettled(page);
    await expect(page.locator('.slot.col[data-slot="col-5"] .card')).toHaveAttribute('data-id', 'n-black-4');
  });

  test('mid-drag scroll re-anchors the drop candidate to the CARD', async ({ page }) => {
    await seedSave(page, makeDropSave(), ['n-black-4', 'n-red-5']);
    await expectSettled(page);

    const src = await page.locator('.slot.col[data-slot="col-5"] .card').boundingBox();
    const fc0 = await page.locator('.slot.free-cell[data-slot="fc-0"]').boundingBox();

    // Make the viewport scroollable without shifting the board layout: an
    // absolutely-positioned tall spacer is out of flow. (html/body are
    // overflow:hidden, but programmatic scrollTo still works on overflowing
    // content — the only scroll path a mid-drag keyboard/programmatic scroll
    // could ever take.)
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.cssText =
        'position:absolute;top:0;left:0;width:1px;height:4000px;pointer-events:none;';
      document.body.appendChild(spacer);
      return document.body.offsetHeight; // force the reflow before scrolling
    });

    const dropOkState = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.slot.drop-ok')].map((s) => s.getAttribute('data-slot')),
      );

    // Center grab, park the card over fc-0: candidate = card center = fc-0.
    await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
    await page.mouse.down();
    await page.mouse.move(fc0.x + fc0.width / 2, fc0.y + fc0.height / 2, { steps: 8 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toEqual(['fc-0']);

    // Scroll the page 120px mid-drag. The card travels WITH the page, so its
    // candidate point must still sit on fc-0 — the scroll handler must
    // re-anchor to the card's LAYOUT center (visual center − translate), or
    // the next hit would be offset by the whole drag vector (dx, dy).
    await page.evaluate(() => window.scrollTo(0, 120));
    // Scroll position must actually change: html/body are overflow:hidden,
    // so this is the key check that the programmatic scroll (and thus the
    // scroll handler) really ran — otherwise this test is vacuously green.
    expect(await page.evaluate(() => window.scrollY)).toBe(120);
    await page.waitForTimeout(60);

    // Move the pointer again (scroll happened mid-drag — the user keeps
    // dragging!). Scroll moves the CARD and the SLOTS together (both −120px
    // in viewport coords), so parking the card back over fc-0 means returning
    // the pointer to the SAME viewport position as before the scroll —
    // the card then sits at the slot's scrolled center. Wiggle the pointer
    // first so a fresh pointermove fires, then park it back.
    // (Without the re-anchor fix, the next pointermove hit-tests from a
    // stale visual-center anchor plus the whole drag vector — nothing
    // highlights and the release below reverts.)
    await page.mouse.move(fc0.x + fc0.width / 2, fc0.y + fc0.height / 2 + 60, { steps: 4 });
    await page.mouse.move(fc0.x + fc0.width / 2, fc0.y + fc0.height / 2, { steps: 4 });
    await page.waitForTimeout(60);
    expect(await dropOkState()).toEqual(['fc-0']);

    // Release: the re-anchored candidate commits into fc-0.
    await page.mouse.up();
    await expectSettled(page);
    await expect(page.locator('.slot.free-cell[data-slot="fc-0"] .card')).toHaveAttribute('data-id', 'n-black-4');
  });
});
