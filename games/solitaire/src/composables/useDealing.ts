// Dealing fly-in animation for new games (新局).
//
// The original project dealt cards one at a time from the stock position on
// the `dealing` event; the Vue rewrite never implemented it (`justDealt` was
// set but nothing consumed it).
//
// This version animates the REAL cards with plain CSS transforms — no ghost
// clones. While justDealt is true every <Card> renders with `noLayout`, which
// disables motion-v's layout FLIP; with no WAAPI animation in the picture, we
// own the transform channel outright:
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
//      foundations, each by snapping the real card back to its dealt spot and
//      flying it home the same way.
//
// justDealt stays true through the settle so motion-v never jumps in mid-flow;
// the watch clears it (finally) once everything has landed.

import { nextTick, watch } from 'vue';
import type { SolitaireGameApi } from './useSolitaireGame';

/** Flight timing — matched to .flying-card's CSS transition (0.26s). */
const FLY_MS = 260;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Gap between consecutive dealt cards (~40 cards ≈ 1.8s total). */
const STAGGER_MS = 45;
/**
 * Auto-settle (auto-move) flight timing — deliberately SLOWER than the deal
 * fly-in: auto-moves read as "cards flying home" and share the same
 * deliberate one-at-a-time cadence as the dragon-collect cascade
 * (useDragonCollect.ts), so every auto-collect scenario feels consistent.
 */
const AUTO_FLY_MS = 320;
const AUTO_STAGGER_MS = 200;
/**
 * Z-index base for auto-moved cards WAITING to fly. While they wait, the
 * moved cards live inside the foundation slot (an absolute stack) and are
 * translate()d back to their tableau spot — DOM order there is REVERSED vs.
 * the column, so we re-order by take-off sequence (see useDragonCollect.ts).
 */
const AUTO_HOLD_Z_BASE = 5000;
const COL_COUNT = 8;
const ROWS = 5;
const COLORS = ['red', 'black', 'green'] as const;
type Color = (typeof COLORS)[number];

interface DealCard {
  id: string;
  el: HTMLElement;
  rect: DOMRect;
}

export function useDealing(game: SolitaireGameApi): void {
  let active = false;

  watch(
    game.justDealt,
    async (dealing) => {
      if (!dealing || active) return;
      active = true;
      try {
        await deal();
      } finally {
        game.justDealt.value = false;
        active = false;
      }
    },
    { flush: 'post' },
  );

  async function deal(): Promise<void> {
    // 1. Let Vue paint the fresh deal (cards at their final positions, motion-v
    //    layout disabled by noLayout so nothing is mid-FLIP).
    await nextTick();

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
        el.style.transition = `transform ${FLY_MS}ms ${EASE}`;
        el.style.transform = '';
        el.style.zIndex = '9000'; // in-flight card above everything else
        setTimeout(() => {
          el.style.zIndex = ''; // landed → back to normal stacking
        }, FLY_MS);
      };
      if (delay === 0) fly();
      else setTimeout(fly, delay);
    });

    // 7. When the last flight settles, strip any leftover inline styles, then
    //    settle the board's auto-moves (still under justDealt/noLayout).
    const settleAt = FLY_MS + order.length * STAGGER_MS + 60;
    await new Promise((r) => setTimeout(r, settleAt));
    for (const { el } of order) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.zIndex = '';
    }
    await settleAutoMoves(order);
  }

  /** After the deal, collapse safe auto-moves, animating each moved card. */
  async function settleAutoMoves(order: DealCard[]): Promise<void> {
    const before = game.state.value;
    const beforeLen: Record<Color, number> = {
      red: before.foundations.red.length,
      black: before.foundations.black.length,
      green: before.foundations.green.length,
    };
    const flowerBefore = before.flowerSlot !== null;
    const dealRect = new Map(order.map((o) => [o.id, o.rect]));

    game.settleAfterDeal(); // engine.applyAutoMoves() → state change → Vue re-render
    await nextTick();

    // Diff old vs new to find the auto-moved cards.
    const st = game.state.value;
    const moved: Array<{ id: string; target: HTMLElement | null }> = [];
    for (const c of COLORS) {
      const f = st.foundations[c];
      for (let i = beforeLen[c]; i < f.length; i++) {
        moved.push({ id: f[i].id, target: document.querySelector(`.slot.foundation.c-${c}`) });
      }
    }
    if (!flowerBefore && st.flowerSlot) {
      moved.push({ id: st.flowerSlot.id, target: document.querySelector('.slot.flower-slot') });
    }
    if (moved.length === 0) return;

    // Snap each REAL card back to its dealt spot, then fly it to its slot.
    // No z-index here — a waiting card keeps its natural stacking until it is
    // this card's turn to fly.
    const flying: HTMLElement[] = [];
    moved.forEach(({ id, target }) => {
      if (!target) return;
      const real = document.querySelector<HTMLElement>(`.card[data-id="${id}"]`);
      const src = dealRect.get(id);
      if (!real || !src) return;
      const t = target.getBoundingClientRect();
      const dx = t.left + t.width / 2 - (src.left + src.width / 2);
      const dy = t.top + t.height / 2 - (src.top + src.height / 2);
      // Card is at t (target). Snap it to src (dealt spot), then fly back.
      real.style.transition = 'none';
      real.style.transform = `translate(${-dx}px, ${-dy}px)`;
      flying.push(real);
    });
    void document.body.offsetWidth; // commit the snap as the transition start

    // While they wait, the snapped-back cards sit in the foundation slot's
    // absolute stack where DOM order puts the LAST mover on top — the
    // opposite of the column's overlap. Re-z by take-off order so the first
    // to fly covers the rest, like the original column (see useDragonCollect).
    flying.forEach((el, i) => {
      el.style.zIndex = String(AUTO_HOLD_Z_BASE + (flying.length - 1 - i));
    });

    // Fly them home ONE AT A TIME — `moved` is in engine auto-move order
    // (lowest rank / outermost first), the same peeling cadence as the
    // dragon-collect cascade. The z-index lift happens at take-off only and
    // is cleared on landing. Z mirrors the hold-band reverse (NOT `6000 + i`):
    // first-take-off keeps the top z so source-column stacking is preserved
    // mid-flight (a single move can expose several cards from the SAME column,
    // whose visual overlap would otherwise reverse). See animateAutoMoves.ts.
    flying.forEach((el, i) => {
      const delay = i * AUTO_STAGGER_MS;
      const takeOff = () => {
        el.style.zIndex = String(6000 + (flying.length - 1 - i));
        el.style.transition = `transform ${AUTO_FLY_MS}ms ${EASE}`;
        el.style.transform = '';
      };
      if (delay === 0) takeOff();
      else setTimeout(takeOff, delay);
      setTimeout(() => {
        el.style.zIndex = '';
      }, delay + AUTO_FLY_MS);
    });

    const maxDelay = (flying.length - 1) * AUTO_STAGGER_MS;
    await new Promise((r) => setTimeout(r, AUTO_FLY_MS + maxDelay + 60));
    for (const el of flying) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.zIndex = '';
    }
  }
}
