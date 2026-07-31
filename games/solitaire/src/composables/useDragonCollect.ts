// Dragon-collect animation for the 收龙 button — NO cloned ghosts.
//
// Collecting removes every exposed dragon of one colour, locks them into a
// single free cell, AND (usually) cascades into engine auto-moves — a flower
// flies to its slot, safe number runs fly to their foundations.
//
// Like the dealing fly-in, this drives the REAL cards with inline transforms:
//
//   Dragons (fly FIRST, then commit):
//     1. Snapshot each dragon's rect + column info.
//     2. Reset them to their natural position (transition start), lift z-index.
//     3. Fly them to the locked cell ONE AT A TIME, outermost card first
//        (layer by layer, like peeling an onion — each column's top card
//        leaves before the one beneath it). Destinations measured once —
//        slots are static mid-flight.
//     4. Once they land, commit game.collectDragons(): Vue unmounts the
//        dragons (already at the locked cell) and the locked pile appears in
//        their place — seamless. On failure, ease them back to origin.
//
//   Auto-moved cards (fly AFTER the commit):
//     5. Diff old vs new foundations/flower; for each moved card, snap the
//        real card (now in its slot) back to its dealt spot, then fly it
//        home — the same trick settleAutoMoves uses in useDealing.
//
// While the flight runs, `game.collecting` is true: App.vue passes
// noLayout to every <Card> (so motion-v never fights our transform channel)
// and the drag controller ignores pointerdown.

import { nextTick } from 'vue';
import type { SolitaireGameApi } from './useSolitaireGame';

/** Flight timing — matched to the CSS transition used below. */
const FLY_MS = 320;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Per-card gap between flights (global: one card takes off at a time). */
const STAGGER_MS = 200;
/**
 * Z-index base for cards WAITING to fly during the auto-move cascade. While
 * they wait, the moved cards live inside the foundation slot (an absolute
 * stack) and are only translate()d back to their tableau spot — so inside
 * that stacking context the DOM order is REVERSED vs. the column (the card
 * that flies last, e.g. 9, is last in DOM = on top). We re-order them by
 * take-off sequence so the first to fly sits on top, restoring the column's
 * natural overlap. Take-off lifts them to 6000+i, well above this band.
 */
const HOLD_Z_BASE = 5000;
const COLORS = ['red', 'black', 'green'] as const;
type Color = (typeof COLORS)[number];

interface Snap {
  el: HTMLElement;
  rect: DOMRect;
  colSlot: string | null;
  colIndex: number;
}

/** Where a card sits inside its column: used to order the take-off. */
function colInfo(el: HTMLElement): { colSlot: string | null; colIndex: number } {
  const col = el.closest<HTMLElement>('.slot.col');
  if (!col) return { colSlot: null, colIndex: -1 };
  return {
    colSlot: col.dataset.slot ?? null,
    colIndex: Array.from(col.children).indexOf(el),
  };
}

/** Column number of a snap's slot, for tie-breaking the collect order. */
function colNumber(slot: string | null): number {
  if (!slot) return -1;
  const m = /^col-(\d+)$/.exec(slot);
  return m ? Number(m[1]) : -1;
}

/**
 * Global flight order: OUTERMOST card first, one at a time.
 *
 * Cards are ranked by exposure — `colIndex` grows towards the top of a
 * column, so a bigger index is more exposed (outermost). Ordering by it
 * groups cards into "layers" (every column's top card, then the card beneath
 * each, ...), like peeling an onion. Within a layer, columns fly left to
 * right. Cards outside any column (free cells) rank last, matching the
 * engine's collectDragons() pop order (tableau first, free cells after).
 */
function staggerDelays(items: Snap[]): Map<Snap, number> {
  const ordered = [...items].sort((a, b) => {
    if (b.colIndex !== a.colIndex) return b.colIndex - a.colIndex;
    return colNumber(a.colSlot) - colNumber(b.colSlot);
  });
  const delayOf = new Map<Snap, number>();
  ordered.forEach((s, i) => delayOf.set(s, i * STAGGER_MS));
  return delayOf;
}

export function useDragonCollect(game: SolitaireGameApi): () => void {
  return async function collectDragons() {
    if (game.collecting.value) return;
    const color = game.dragonReadyColor.value;
    if (!color) return;

    // 1. Snapshot every card BEFORE the collect (positions + column info).
    const snap = new Map<string, Snap>();
    for (const el of document.querySelectorAll<HTMLElement>('#board .card')) {
      const id = el.dataset.id;
      if (!id) continue;
      const { colSlot, colIndex } = colInfo(el);
      snap.set(id, { el, rect: el.getBoundingClientRect(), colSlot, colIndex });
    }
    const dragonEls = [...snap.values()].filter(
      (s) => s.el.dataset.id?.startsWith(`dragon-${color}-`) ?? false,
    );
    if (dragonEls.length === 0) return;

    // 2. Remember foundation/flower state for the auto-move diff.
    const before = game.state.value;
    const beforeLen: Record<Color, number> = {
      red: before.foundations.red.length,
      black: before.foundations.black.length,
      green: before.foundations.green.length,
    };
    const flowerBefore = before.flowerSlot !== null;

    // 3. Destination: the locked cell the dragons will land in. The engine
    //    picks the first empty free cell (a same-colour dragon cell is cleared
    //    first, vacating it) — mirror that so we fly to the right slot.
    let destIdx = before.freeCells.findIndex((c) => c === null);
    if (destIdx === -1) {
      destIdx = before.freeCells.findIndex(
        (c) => c !== null && c.type === 'dragon' && c.color === color,
      );
    }
    const targetSlot = document.querySelector<HTMLElement>(
      `.slot.free-cell[data-slot="fc-${destIdx}"]`,
    );
    if (!targetSlot) return;
    const tr = targetSlot.getBoundingClientRect();
    const tX = tr.left + tr.width / 2;
    const tY = tr.top + tr.height / 2;

    game.collecting.value = true;
    try {
      // 4. Reset each dragon to its natural position (the transition START)
      //    and commit the start state. z-index is NOT touched here — only the
      //    card actually taking off is lifted (step 5), so dragons still
      //    waiting keep their natural stacking until their turn.
      dragonEls.forEach((s) => {
        s.el.style.transition = 'none';
        s.el.style.transform = '';
      });
      void document.body.offsetWidth;

      // 5. Fly each dragon to the locked cell, one at a time. The z-index lift
      //    happens AT TAKE-OFF only, cleared on landing.
      const delayOf = staggerDelays(dragonEls);
      let maxDelay = 0;
      for (const d of delayOf.values()) maxDelay = Math.max(maxDelay, d);
      const fly = (s: Snap, i: number) => {
        const dx = tX - (s.rect.left + s.rect.width / 2);
        const dy = tY - (s.rect.top + s.rect.height / 2);
        s.el.style.zIndex = String(7000 + i);
        s.el.style.transition = `transform ${FLY_MS}ms ${EASE}`;
        s.el.style.transform = `translate(${dx}px, ${dy}px)`;
        setTimeout(() => {
          s.el.style.zIndex = '';
        }, FLY_MS);
      };
      requestAnimationFrame(() => {
        dragonEls.forEach((s, i) => {
          const delay = delayOf.get(s) ?? 0;
          if (delay === 0) fly(s, i);
          else setTimeout(() => fly(s, i), delay);
        });
      });

      // 6. Wait for the last dragon to land, then commit. On success Vue
      //    unmounts the dragons (already at the locked cell) and the locked
      //    pile appears in their place. On failure, ease them back.
      await new Promise((r) => setTimeout(r, FLY_MS + maxDelay + 60));
      if (!game.collectDragons()) {
        for (const s of dragonEls) {
          s.el.style.transition = `transform ${FLY_MS}ms ${EASE}`;
          s.el.style.transform = '';
          s.el.style.zIndex = '';
        }
        return;
      }

      // 7. Auto-moves: fly the real cards that were auto-moved (flower + safe
      //    foundation runs) from their dealt spot to their new slot.
      await nextTick();
      const st = game.state.value;
      const moved: Array<{ id: string; target: HTMLElement | null }> = [];
      for (const c of COLORS) {
        const f = st.foundations[c];
        for (let i = beforeLen[c]; i < f.length; i++) {
          moved.push({
            id: f[i].id,
            target: document.querySelector(`.slot.foundation.c-${c}`),
          });
        }
      }
      if (!flowerBefore && st.flowerSlot) {
        moved.push({
          id: st.flowerSlot.id,
          target: document.querySelector('.slot.flower-slot'),
        });
      }

      if (moved.length > 0) {
        // Snap each card back to its dealt spot (transition start). No z-index
        // here — a waiting card keeps its natural stacking inside the column
        // until it is this card's turn to fly.
        const flying: HTMLElement[] = [];
        moved.forEach(({ id, target }) => {
          if (!target) return;
          const s = snap.get(id);
          const real = document.querySelector<HTMLElement>(`.card[data-id="${id}"]`);
          if (!s || !real) return;
          const t = target.getBoundingClientRect();
          const dx = s.rect.left + s.rect.width / 2 - (t.left + t.width / 2);
          const dy = s.rect.top + s.rect.height / 2 - (t.top + t.height / 2);
          real.style.transition = 'none';
          real.style.transform = `translate(${dx}px, ${dy}px)`;
          flying.push(real);
        });
        void document.body.offsetWidth; // commit the snap as the transition start

        // While they wait, the snapped-back cards all live inside the
        // foundation slot's absolute stack, where DOM order puts the LAST
        // mover (e.g. 9) on top — the opposite of the column's overlap
        // (8 should cover part of 9, 9 should sit under 8). Re-z by take-off
        // order so the first to fly covers the rest, like the original deal.
        flying.forEach((el, i) => {
          el.style.zIndex = String(HOLD_Z_BASE + (flying.length - 1 - i));
        });

        // Fly them home ONE AT A TIME — `moved` is in engine auto-move order
        // (lowest rank / outermost card first), so staggering by index reads
        // as a peeling cascade into the foundations, same cadence as the
        // dragon take-off above. The z-index lift happens at take-off only
        // and is cleared on landing.
        flying.forEach((el, i) => {
          const delay = i * STAGGER_MS;
          const takeOff = () => {
            el.style.zIndex = String(6000 + i);
            el.style.transition = `transform ${FLY_MS}ms ${EASE}`;
            el.style.transform = '';
          };
          if (delay === 0) takeOff();
          else setTimeout(takeOff, delay);
          setTimeout(() => {
            el.style.zIndex = '';
          }, delay + FLY_MS);
        });
        const maxDelay = (flying.length - 1) * STAGGER_MS;
        await new Promise((r) => setTimeout(r, FLY_MS + maxDelay + 60));
        for (const el of flying) {
          el.style.transition = '';
          el.style.transform = '';
          el.style.zIndex = '';
        }
      }
    } finally {
      game.collecting.value = false;
      // The flight is fully settled — if this collect won the game, show the
      // win overlay NOW (it was held back so it never pops over flying cards).
      game.flushDeferredWin();
    }
  };
}
