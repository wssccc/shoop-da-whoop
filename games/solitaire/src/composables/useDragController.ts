// Pointer-based drag controller. Carries the REAL cards directly under the
// pointer (inline transform — no cloned ghost), hit-tests slot targets via
// manual rect tests (NOT elementFromPoint), and commits to game.moveCard() on
// release (or reverts with an error sound + return FLIP).
//
// 1:1 port of the original input.js DragController, wired to VueUse's
// `useEventListener` so listeners auto-teardown on component unmount. See
// memories/drag-hit-test-zoom.md for the iOS pinch-zoom positioning rationale.

import * as Rules from '@solitaire/game/rules';
import type { Card, CardColor, DestDescriptor } from '@solitaire/game/types';
import { useEventListener } from '@vueuse/core';
import { ref, type Ref } from 'vue';
import { Audio } from './useAudio';
import type { SolitaireGameApi } from './useSolitaireGame';

/** Shared FLIP duration/easing (matches the original anim.js constants). */
export const FLIP_MS = 240;
export const FLIP_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

interface DragState {
  e0: { x: number; y: number };
  dx: number;
  dy: number;
  run: Card[];
  origs: HTMLElement[];
  targets: DestDescriptor[];
  /** Drop targets captured once per drag — the board DOM is stable mid-drag. */
  slots: HTMLElement[];
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
 * Resolve a pointer position (clientX/Y) to the [data-slot] element under it.
 *
 * We manually test the point against every slot's getBoundingClientRect()
 * instead of calling document.elementFromPoint(). The drag pipeline elsewhere
 * (ghost positioning, FLIP) all speak the layout-viewport CSS-pixel language,
 * so matching against that same API keeps every coordinate source consistent.
 * elementFromPoint() under page zoom / ancestor transforms drifts out of sync.
 *
 * `slots` is captured once per drag (see DragState.slots) so we never re-query
 * the selector on every pointermove.
 */
function slotAtPoint(x: number, y: number, slots: HTMLElement[]): HTMLElement | null {
  for (const s of slots) {
    const r = s.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return s;
  }
  return null;
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
    // used — motion-v's projection subtracts it exactly when measuring.
    for (const el of d.origs) el.style.transform = `translate(${dx}px, ${dy}px)`;
    highlight(x, y, d.slots);
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
    if (game.justDealt.value || game.collecting.value) return;
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
      run,
      origs,
      targets: Rules.validDropTargets(state, run),
      slots: Array.from(document.querySelectorAll<HTMLElement>('#board [data-slot]')),
      hover: null,
      hoverEl: null,
    };

    e.preventDefault();
  }

  function highlight(x: number, y: number, slots: HTMLElement[]) {
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
      highlight(x, y, d.slots);
    }
    if (d.hoverEl) d.hoverEl.classList.remove('drop-ok');
    d.hoverEl = null;

    // The cards already sit at the release point (their transform followed
    // the pointer). Just drop the drag styles and settle the move. motion-v's
    // <motion.div layout> FLIPs from this parked position on commit.
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
      // Scrub the park styles once the FLIP spring has fully settled, so a
      // stale inline transform can't shift the next drag's ghost origin.
      setTimeout(() => {
        for (const el of d.origs) {
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
}
