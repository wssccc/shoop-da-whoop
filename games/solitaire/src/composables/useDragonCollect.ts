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
//     3. Fly each to the locked cell, staggered per source column (outermost
//        first). Destinations measured once — slots are static mid-flight.
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
const FLY_MS = 260;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Per-card gap between flights within the same column. */
const STAGGER_MS = 90;
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

/** Sort a list of snaps so the OUTERMOST card (top of column) flies first. */
function staggerDelays(items: Snap[]): Map<Snap, number> {
  const byCol = new Map<string, Snap[]>();
  for (const s of items) {
    const key = s.colSlot ?? '__nocol__';
    const list = byCol.get(key);
    if (list) list.push(s);
    else byCol.set(key, [s]);
  }
  const delayOf = new Map<Snap, number>();
  for (const [key, list] of byCol) {
    if (key === '__nocol__') {
      for (const s of list) delayOf.set(s, 0);
      continue;
    }
    list.sort((a, b) => b.colIndex - a.colIndex); // top/outermost first
    list.forEach((s, i) => delayOf.set(s, i * STAGGER_MS));
  }
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
      // 4. Reset each dragon to its natural position (the transition START),
      //    lift it above the board, and commit the start state.
      dragonEls.forEach((s, i) => {
        s.el.style.transition = 'none';
        s.el.style.transform = '';
        s.el.style.zIndex = String(7000 + i);
      });
      void document.body.offsetWidth;

      // 5. Fly each dragon to the locked cell, staggered per column.
      const delayOf = staggerDelays(dragonEls);
      let maxDelay = 0;
      for (const d of delayOf.values()) maxDelay = Math.max(maxDelay, d);
      const fly = (s: Snap) => {
        const dx = tX - (s.rect.left + s.rect.width / 2);
        const dy = tY - (s.rect.top + s.rect.height / 2);
        s.el.style.transition = `transform ${FLY_MS}ms ${EASE}`;
        s.el.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      requestAnimationFrame(() => {
        for (const s of dragonEls) {
          const delay = delayOf.get(s) ?? 0;
          if (delay === 0) fly(s);
          else setTimeout(() => fly(s), delay);
        }
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
        // Snap each card back to its dealt spot (transition start).
        const flying: HTMLElement[] = [];
        moved.forEach(({ id, target }, i) => {
          if (!target) return;
          const s = snap.get(id);
          const real = document.querySelector<HTMLElement>(`.card[data-id="${id}"]`);
          if (!s || !real) return;
          const t = target.getBoundingClientRect();
          const dx = s.rect.left + s.rect.width / 2 - (t.left + t.width / 2);
          const dy = s.rect.top + s.rect.height / 2 - (t.top + t.height / 2);
          real.style.transition = 'none';
          real.style.transform = `translate(${dx}px, ${dy}px)`;
          real.style.zIndex = String(6000 + i);
          flying.push(real);
        });
        void document.body.offsetWidth; // commit the snap as the transition start

        // Fly them all home (same-column cards fly together here; they were
        // snapshotted from one column so a single flight reads naturally).
        // z-index stays elevated during the flight, then clears on landing.
        flying.forEach((el) => {
          el.style.transition = `transform ${FLY_MS}ms ${EASE}`;
          el.style.transform = '';
          setTimeout(() => {
            el.style.zIndex = '';
          }, FLY_MS);
        });
        await new Promise((r) => setTimeout(r, FLY_MS + 60));
        for (const el of flying) {
          el.style.transition = '';
          el.style.transform = '';
          el.style.zIndex = '';
        }
      }
    } finally {
      game.collecting.value = false;
    }
  };
}
