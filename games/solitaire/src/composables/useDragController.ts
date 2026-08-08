// Pointer-based drag controller. Carries the REAL cards directly under the
// pointer (inline transform — no cloned ghost), hit-tests slot targets via
// manual rect tests (NOT elementFromPoint), and commits to game.moveCard() on
// release (or reverts with an error sound + settle-back tween).
//
// Drop-candidate hit-tests use the HEAD card's geometric center (grab-time
// rect center + drag offset — pure arithmetic, no reflow), so the highlight
// and the release commit follow the card's visual position, not the pointer.
//
// 1:1 port of the original input.js DragController, wired to VueUse's
// `useEventListener` so listeners auto-teardown on component unmount. See
// memories/drag-hit-test-zoom.md for the iOS pinch-zoom positioning rationale.

import * as Rules from '@solitaire/game/rules';
import type { Card, CardColor, DestDescriptor } from '@solitaire/game/types';
import { useEventListener } from '@vueuse/core';
import { nextTick, ref, type Ref } from 'vue';
import { FLIP_SETTLE_MS } from './animateAutoMoves';
import { Audio } from './useAudio';
import type { SolitaireGameApi } from './useSolitaireGame';

/** Shared FLIP duration/easing (matches the original anim.js constants). */
export const FLIP_MS = FLIP_SETTLE_MS; // 250 — also the executor's consume delay
export const FLIP_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/** A drop target captured at drag start: element + its layout rect. */
interface DragSlot {
  el: HTMLElement;
  /** The element's own layout rect (the PILE rect for a tableau column).
   * Drives the visual `.drop-ok` highlight — the ring stays on the pile and
   * never stretches into the empty space below it. */
  rect: DOMRect;
  /** The HIT-TEST rect. For tableau columns this is the FULL column drop
   * zone: the pile rect extended DOWN to the viewport bottom, so the empty
   * space below a short pile still counts as that column's candidate. Every
   * other slot type hit-tests its own (card-sized) rect. */
  hitRect: { left: number; right: number; top: number; bottom: number };
}

interface DragState {
  e0: { x: number; y: number };
  dx: number;
  dy: number;
  /** Head card's center at grab time (client coords). The drop-candidate
   * point is `anchor + (dx, dy)` — pure arithmetic, so highlight and release
   * track the CARD's visual position, not the pointer. */
  anchor: { x: number; y: number };
  run: Card[];
  origs: HTMLElement[];
  targets: DestDescriptor[];
  /** Drop targets captured once per drag — the board DOM is stable mid-drag. */
  slots: DragSlot[];
  hover: DestDescriptor | null;
  /** The slot element currently showing `.drop-ok`, or null. */
  hoverEl: HTMLElement | null;
}

function parseSlot(str: string | null | undefined): DestDescriptor | null {
  if (!str) return null;
  if (str.startsWith('col-')) return { type: 'column', index: Number(str.slice(4)) };
  if (str.startsWith('fc-')) return { type: 'freecell', index: Number(str.slice(3)) };
  if (str.startsWith('found-')) {
    return { type: 'foundation', color: str.slice(6) as CardColor };
  }
  if (str === 'flower') return { type: 'flower' };
  return null;
}

/**
 * Resolve a point (client coords — the dragged head card's center) to the
 * [data-slot] element under it.
 *
 * We manually test the point against every slot's getBoundingClientRect()
 * instead of calling document.elementFromPoint(). The drag pipeline elsewhere
 * (park positioning, settle tweens) all speak the layout-viewport CSS-pixel
 * language, so matching against that same API keeps every coordinate source
 * consistent. elementFromPoint() under page zoom / ancestor transforms drifts
 * out of sync.
 *
 * `slots` is captured once per drag (see DragState.slots) so we never re-query
 * the selector on every pointermove. Hit-tests run against each slot's
 * `hitRect` (see DragSlot) — the extended column drop zone for tableau
 * columns, the plain rect for every other slot.
 */
function slotAtPoint(x: number, y: number, slots: DragSlot[]): HTMLElement | null {
  for (const s of slots) {
    const r = s.hitRect;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s.el;
  }
  return null;
}

/** Current drop-candidate point: the head card's geometric center. Derived
 * from the grab-time anchor + drag offset — no layout read per frame. */
function hitPoint(d: DragState): { x: number; y: number } {
  return { x: d.anchor.x + d.dx, y: d.anchor.y + d.dy };
}

function shake(el: HTMLElement): void {
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 320);
}

export function useDragController(
  boardRef: Ref<HTMLElement | null>,
  game: SolitaireGameApi,
): void {
  const drag = ref<DragState | null>(null);

  // --- Pointer-move batching ----------------------------------------------
  // pointermove can fire faster than rAF (high-refresh panels). Coalesce every
  // move within a frame into a single application, and only write to the DOM
  // when a drag is actually live. On release we synchronously flush the last
  // pending move so park position + hover reflect the pointer's final location.
  let moveRafId = 0;
  let pendingMove: { x: number; y: number } | null = null;

  function flushPendingMove(): void {
    moveRafId = 0;
    const d = drag.value;
    if (!d || !pendingMove) return;
    const { x, y } = pendingMove;
    pendingMove = null;
    const dx = x - d.e0.x;
    const dy = y - d.e0.y;
    d.dx = dx;
    d.dy = dy;
    // The REAL cards follow the pointer directly (transition:none, so this is
    // instant and per-frame smooth). `.is-dragging { will-change: transform }`
    // keeps them on compositor layers. Same translate() matrix the original
    // used — the settle tweens later measure from exactly this offset.
    for (const el of d.origs) el.style.transform = `translate(${dx}px, ${dy}px)`;
    const p = hitPoint(d);
    highlight(p.x, p.y, d.slots);
  }

  function cancelPendingMove(): void {
    if (moveRafId) {
      cancelAnimationFrame(moveRafId);
      moveRafId = 0;
    }
    pendingMove = null;
  }

  function cardEl(id: string): HTMLElement | null {
    return boardRef.value?.querySelector<HTMLElement>(`.card[data-id="${id}"]`) ?? null;
  }

  function onDown(e: PointerEvent) {
    // Ignore input while the dealing fly-in (or its auto-move settle) runs —
    // cards are mid-transform and the board state is about to change anyway.
    // Also block while an action unit is being consumed (收龙 / post-move
    // cascade): the board state settles step by step, and starting a new
    // drag mid-consumption would read stale positions.
    if (game.justDealt.value || game.busy.value) return;
    const target = e.target as HTMLElement;
    const cardElLocal = target.closest<HTMLElement>('.card');
    if (!cardElLocal || cardElLocal.classList.contains('no-drag')) return;

    Audio.resume();
    const id = cardElLocal.dataset.id;
    if (!id) return;
    const state = game.state.value;
    const loc = Rules.findCard(state, id);
    if (!loc) return;

    let run: Card[] | null;
    if (loc.zone === 'tableau') {
      run = Rules.grabRunFromTableau(state, id);
    } else {
      const fc = state.freeCells[loc.idx];
      run = fc && fc.type !== 'dragonpile' ? [fc] : null;
    }
    if (!run) {
      Audio.error();
      shake(cardElLocal);
      return;
    }

    const origs = run.map((c) => cardEl(c.id)).filter((x): x is HTMLElement => x !== null);
    if (origs.length !== run.length) return;

    // Hit-test anchor: the HEAD card's center at grab time (client coords).
    // The card sits at its layout rect here (no transform is applied until
    // the first move), so anchor + (dx, dy) tracks its visual center exactly.
    const headRect = cardElLocal.getBoundingClientRect();

    // Lift the real cards: disable transitions (instant follow), add the
    // is-dragging class (z-index above the board + own compositor layer).
    origs.forEach((el) => {
      el.classList.add('is-dragging');
      el.style.transition = 'none';
    });

    cancelPendingMove(); // drop any stale move left over from a previous drag

    drag.value = {
      e0: { x: e.clientX, y: e.clientY },
      dx: 0,
      dy: 0,
      anchor: {
        x: headRect.left + headRect.width / 2,
        y: headRect.top + headRect.height / 2,
      },
      run,
      origs,
      targets: Rules.validDropTargets(state, run),
      // Capture element + layout rect in one pass — the board layout cannot
      // change mid-drag (cards move via transform only), so these stay valid
      // until release (or a scroll, which refreshes them). Tableau columns
      // get an EXTENDED hit rect — the pile rect stretched down to the
      // viewport bottom, so the empty space below a short pile still counts
      // as a drop candidate. The visual highlight keeps using the element's
      // own rect (the pile), which never stretches.
      slots: Array.from(document.querySelectorAll<HTMLElement>('#board [data-slot]')).map(
        (el) => {
          const rect = el.getBoundingClientRect();
          const isColumn = (el.dataset.slot ?? '').startsWith('col-');
          return {
            el,
            rect,
            hitRect: isColumn
              ? { left: rect.left, right: rect.right, top: rect.top, bottom: window.innerHeight }
              : rect,
          };
        },
      ),
      hover: null,
      hoverEl: null,
    };

    e.preventDefault();
  }

  /** Toggle `.drop-ok` on the slot under (x, y) — the drop-candidate point
   * (head card center), not the pointer. */
  function highlight(x: number, y: number, slots: DragSlot[]) {
    const d = drag.value;
    if (!d) return;
    const slot = slotAtPoint(x, y, slots);
    const desc = slot ? parseSlot(slot.dataset.slot) : null;
    const hit = desc && d.targets.some((t) => Rules.sameDest(t, desc)) ? slot : null;
    if (hit === d.hoverEl) return; // no visual change → skip all DOM writes
    if (d.hoverEl) d.hoverEl.classList.remove('drop-ok');
    d.hoverEl = hit;
    d.hover = hit ? desc : null;
    if (hit) hit.classList.add('drop-ok');
  }

  function onMove(e: PointerEvent) {
    const d = drag.value;
    if (!d) return;
    // Coalesce to one application per animation frame (cheap: just stores x/y).
    pendingMove = { x: e.clientX, y: e.clientY };
    if (!moveRafId) moveRafId = requestAnimationFrame(flushPendingMove);
  }

  function onUp(_e: PointerEvent) {
    const d = drag.value;
    drag.value = null;
    if (!d) return;

    // Flush any move that arrived after the last rAF so the parked position
    // and hover reflect the pointer's exact release coordinates.
    if (moveRafId) {
      cancelAnimationFrame(moveRafId);
      moveRafId = 0;
    }
    if (pendingMove) {
      const { x, y } = pendingMove;
      pendingMove = null;
      d.dx = x - d.e0.x;
      d.dy = y - d.e0.y;
      const p = hitPoint(d);
      highlight(p.x, p.y, d.slots);
    }
    if (d.hoverEl) d.hoverEl.classList.remove('drop-ok');
    d.hoverEl = null;

    // The cards already sit at the release point (their transform followed
    // the pointer). Just drop the drag styles and settle the move — the
    // settle-into tween below starts from this parked position on commit.
    const dx = d.dx;
    const dy = d.dy;
    for (const el of d.origs) {
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.classList.remove('is-dragging');
    }

    let committed = false;
    if (d.hover) {
      const result = game.moveCard(d.run, d.hover);
      committed = result.ok;
      if (!committed) Audio.error();
    }
    if (committed) {
      // Settle-into: the cards keep their parked translate() while Vue
      // re-renders them at the destination slot (v-for key reuse keeps the
      // elements, so the inline transform survives the move). Once the DOM
      // sits in its final layout, ease each card from the parked position to
      // its final one with a single CSS transition. (The engine's auto-move
      // cascade — if any — is consumed by the action-unit executor, which
      // starts only after this settle finishes.)
      void nextTick().then(() => {
        for (const el of d.origs) {
          if (!el.isConnected) continue; // undo / new-game raced the settle
          void el.offsetWidth; // commit parked transform as the tween's start value
          el.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
          el.style.transform = '';
        }
      });
      // Scrub inline styles once the settle tween has finished, so a stale
      // inline transform can't shift the next drag's park origin. Skip any
      // element a NEW drag has already taken over (is-dragging) — scrubbing
      // mid-drag would wipe its follow transform for a frame.
      setTimeout(() => {
        for (const el of d.origs) {
          if (el.classList.contains('is-dragging')) continue;
          el.style.transition = '';
          el.style.transform = '';
        }
      }, FLIP_MS + 400);
      return;
    }

    // Canceled / invalid drop: ease each card back from the release point.
    //
    // ORDER MATTERS: while the card is still parked, `transition` is 'none'
    // (set during park). We must force a style recalc (offsetWidth) to commit
    // the parked translate() BEFORE swapping in the transition — if the
    // transition and the park transform land in the same recalc batch, the
    // transition captures the PRE-recalc transform (none) as its start and
    // the card briefly flies out to the park position before snapping back.
    // With the park transform committed first, the transition starts from the
    // parked position and the rAF below eases it cleanly back to origin.
    const origs = d.origs;
    for (const el of origs) {
      void el.offsetWidth; // commit the parked transform while transition is still 'none'
      el.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
    }
    requestAnimationFrame(() => {
      for (const el of origs) el.style.transform = '';
    });
    setTimeout(() => {
      for (const el of origs) {
        if (el.classList.contains('is-dragging')) continue; // new drag owns it now
        el.style.transition = '';
        el.style.transform = '';
      }
    }, FLIP_MS + 60);
  }

  // Board owns pointerdown; window owns the move/up during a drag (no-op when not dragging).
  useEventListener(boardRef, 'pointerdown', onDown);
  useEventListener(window, 'pointermove', onMove);
  useEventListener(window, 'pointerup', onUp);
  useEventListener(window, 'pointercancel', onUp);
  // Mid-drag scrolling is FORBIDDEN: it would shift the board under the card
  // and stale both the cached slot rects and the center anchor. Block wheel
  // scrolls for the drag's duration (touch scrolling is already impossible —
  // the dragged card carries `touch-action: none`).
  useEventListener(
    window,
    'wheel',
    (e) => {
      if (drag.value) e.preventDefault();
    },
    { passive: false },
  );
  // If a scroll still sneaks through (keyboard / programmatic), refresh the
  // cached slot rects (both visual and hit rects) AND re-anchor the head card
  // from a live rect so the hit test keeps tracking the card's visual
  // position. Otherwise a normal drag stays completely reflow-free.
  useEventListener(window, 'scroll', () => {
    const d = drag.value;
    if (!d) return;
    for (const s of d.slots) {
      const r = s.el.getBoundingClientRect();
      s.rect = r;
      s.hitRect = (s.el.dataset.slot ?? '').startsWith('col-')
        ? { left: r.left, right: r.right, top: r.top, bottom: window.innerHeight }
        : r;
    }
    const head = d.origs[0];
    if (head?.isConnected) {
      // Re-anchor to the head card's LAYOUT center (visual center minus the
      // applied translate). hitPoint() assumes a transform-free anchor, like
      // at grab time — re-anchoring to the visual center would double-count
      // the current (dx, dy) and permanently offset every hit after the
      // scroll by exactly that much.
      const r = head.getBoundingClientRect();
      d.anchor = { x: r.left + r.width / 2 - d.dx, y: r.top + r.height / 2 - d.dy };
    }
  });
}
