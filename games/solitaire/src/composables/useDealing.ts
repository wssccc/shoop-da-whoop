// Dealing fly-in animation for new games (新局).
//
// The original project dealt cards one at a time from the stock position on
// the `dealing` event; the Vue rewrite never implemented it (`justDealt` was
// set but nothing consumed it).
//
// This version animates the REAL cards with plain CSS transforms — no ghost
// clones. There is no competing layout-animation library in the picture, so
// we own the transform channel outright:
//
//   1. watch justDealt → true (set by newGame()); Vue paints the fresh deal.
//   2. Collect every tableau card's FINAL rect, in dealing order (rounds: all
//      columns' 1st card, then all columns' 2nd card, … — a real FreeCell deal).
//   3. Snap every real card to the FLOWER SLOT (the stock) with
//      transition:none, then force one style recalc so the browser commits
//      the snap as the CSS transition's start value.
//   4. Fly each card home, staggered per card (cards deal ON TOP, so the
//      last-dealt card — column top — arrives last: natural stack order).
//   5. When the last flight settles, clean up, then settle auto-moves — the
//      exposed flower flies to its slot and safe number runs fly to their
//      foundations, each via the shared action-unit executor (see
//      useSolitaireGame.consumeUnit).
//
// justDealt stays true through the settle so no other animation system can
// jump in mid-flow; the watch clears it (finally) once everything has landed.

import { nextTick, watch } from 'vue';
import type { SolitaireGameApi } from './useSolitaireGame';

/** Flight timing — matched to .flying-card's CSS transition (0.26s). */
const FLY_MS = 260;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Gap between consecutive dealt cards (~40 cards ≈ 1.8s total). */
const STAGGER_MS = 45;
const COL_COUNT = 8;
const ROWS = 5;

interface DealCard {
  id: string;
  el: HTMLElement;
  rect: DOMRect;
}

export function useDealing(game: SolitaireGameApi): void {
  /**
   * Deal generation. Every justDealt→true transition — including a new-game
   * request made WHILE a deal is already playing (newGame flips the flag
   * false→true to force the restart) — bumps the generation. A deal captures
   * its generation at start, and every async boundary (stagger timers, the
   * settle wait, the auto-move settle) aborts when a newer generation has
   * superseded it. Without this, a superseded deal's timers would keep
   * running on the REPLACED board: Vue reuses same-key card elements, so the
   * old fly/settle callbacks would yank the new board's cards around and the
   * old settle would strip the new deal's inline styles. Only the newest
   * generation may clear justDealt.
   */
  let gen = 0;

  watch(
    game.justDealt,
    (dealing) => {
      if (!dealing) return;
      const myGen = ++gen;
      void runDeal(myGen);
    },
    { flush: 'post' },
  );

  /** Deal + post-deal settle for ONE generation; superseded generations bail
   *  at every await boundary and never touch the board again. */
  async function runDeal(myGen: number): Promise<void> {
    try {
      // 1. Let Vue paint the fresh deal (cards at their final positions).
      await nextTick();
      if (myGen !== gen) return;
      await deal(myGen);
      if (myGen !== gen) return;
      // Settle safe auto-moves (still under justDealt).
      await settleAutoMoves(myGen);
    } finally {
      // Only the newest generation may end the dealing state — a superseded
      // one must not cut the new deal short.
      if (myGen === gen) game.justDealt.value = false;
    }
  }

  async function deal(myGen: number): Promise<void> {

    // 2. Collect every tableau card's final rect, keyed by column.
    const cols: DealCard[][] = [];
    for (let c = 0; c < COL_COUNT; c++) {
      const slot = document.querySelector<HTMLElement>(`.slot.col[data-slot="col-${c}"]`);
      const list: DealCard[] = [];
      if (slot) {
        for (const el of slot.querySelectorAll<HTMLElement>('.card')) {
          const id = el.dataset.id;
          if (id) list.push({ id, el, rect: el.getBoundingClientRect() });
        }
      }
      cols.push(list);
    }
    if (cols.every((c) => c.length === 0)) return;

    // 3. Dealing order = rounds: all columns' card r, column 0 → 7.
    const order: DealCard[] = [];
    for (let r = 0; r < ROWS; r++) {
      for (const col of cols) {
        const card = col[r];
        if (card) order.push(card);
      }
    }

    // 4. Stock position: the FLOWER SLOT (the original dealt from there).
    const stock = document.querySelector<HTMLElement>('#board .slot.flower-slot');
    const sr = stock
      ? stock.getBoundingClientRect()
      : document.getElementById('board')!.getBoundingClientRect();
    const stockX = sr.left + sr.width / 2;
    const stockY = sr.top + sr.height / 2;

    // 5. Snap every real card to the stock with transition:none. left/top are
    //    untouched (tableau layout stays put); only the transform moves the
    //    card visually. The forced recalc commits the snap as the CSS
    //    transition's START value — without it the browser coalesces snap +
    //    fly into one update and the flight has no start (cards just appear
    //    at their destination; see memories/…-css-transition-timing.md).
    order.forEach(({ el, rect }, i) => {
      el.style.transition = 'none';
      el.style.transform = `translate(${stockX - (rect.left + rect.width / 2)}px, ${stockY - (rect.top + rect.height / 2)}px)`;
      el.style.zIndex = String(5000 + i); // later-dealt cards stack on top
    });
    void document.body.offsetWidth; // commit the snap

    // 6. Fly each card home, staggered. A card's z-index stays ELEVATED while
    //    it is in flight (9000 = top of the world) and clears when it lands —
    //    so a mid-air card is never covered by the un-dealt stock pile
    //    (z 5000+) or by later cards crossing its path. Cards still waiting
    //    in the stock keep z 5000+i, so later-dealt cards stack on top there.
    order.forEach(({ el }, i) => {
      const delay = i * STAGGER_MS;
      const fly = () => {
        if (myGen !== gen) return; // superseded — a newer deal owns the board
        el.style.transition = `transform ${FLY_MS}ms ${EASE}`;
        el.style.transform = '';
        el.style.zIndex = '9000'; // in-flight card above everything else
        setTimeout(() => {
          if (myGen !== gen) return;
          el.style.zIndex = ''; // landed → back to normal stacking
        }, FLY_MS);
      };
      if (delay === 0) fly();
      else setTimeout(fly, delay);
    });

    // 7. When the last flight settles, strip any leftover inline styles, then
    //    settle the board's auto-moves (still under justDealt).
    const settleAt = FLY_MS + order.length * STAGGER_MS + 60;
    await new Promise((r) => setTimeout(r, settleAt));
    if (myGen !== gen) return; // superseded — don't strip the new deal's styles
    for (const { el } of order) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.zIndex = '';
    }
    await settleAutoMoves(myGen);
  }

  /** After the deal, settle safe auto-moves through the SAME action-unit
   *  executor as every other cascade: beginUnit + consumeUnit. Cards fly
   *  from their dealt spot to flower/foundation one at a time; resolves
   *  when the last card lands (justDealt stays true until then). */
  async function settleAutoMoves(myGen: number): Promise<void> {
    if (myGen !== gen) return;
    await game.settleAfterDeal(); // executor consumes the cascade (win check inside)
  }
}
