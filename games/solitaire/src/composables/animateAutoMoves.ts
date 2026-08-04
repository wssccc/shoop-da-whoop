// Shared flight for "auto-moved" cards — the flower and safe foundation runs
// the engine collapses after a user move (engine.applyAutoMoves). All three
// auto-collect paths share the SAME slow one-at-a-time cadence:
//   - useDragonCollect (收龙 cascade),
//   - useDealing.settleAutoMoves (post-deal collapse),
//   - moveCard in useSolitaireGame (this module — cards re-rendered into the
//     foundation slot by Vue, snapped back to their source spot, then flown
//     home one at a time instead of motion-v's instant layout FLIP).
//
// Timing constants deliberately mirror useDragonCollect so every cascade
// reads consistently: 320ms flight, 200ms between take-offs.

import { nextTick } from 'vue';

export const AUTO_FLY_MS = 320;
export const AUTO_STAGGER_MS = 200;
/**
 * Z-index base for auto-moved cards WAITING to fly. While they wait, the
 * moved cards live inside the destination slot (an absolute stack) and are
 * translate()d back to their source spot — DOM order there is REVERSED vs.
 * the source column, so we re-order by take-off sequence (see the identical
 * HOLD_Z_BASE in useDragonCollect.ts). Take-off lifts them to 6000+i, well
 * above this band.
 */
export const AUTO_HOLD_Z_BASE = 5000;
export const AUTO_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

export interface AutoMoveTarget {
  id: string;
  /** Destination slot element (foundation / flower-slot). */
  target: HTMLElement | null;
}

/** Snapshot every visible card's rect — the "source" of the upcoming flight. */
export function snapshotCardRects(): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  for (const el of document.querySelectorAll<HTMLElement>('.card')) {
    const id = el.dataset.id;
    if (id) rects.set(id, el.getBoundingClientRect());
  }
  return rects;
}

/**
 * Fly auto-moved cards from their source spot to their destination slot, ONE
 * AT A TIME. Caller must have disabled motion-v layout on these cards (e.g.
 * via `autoMovingIds`) so we own their transform channel.
 */
export async function flyAutoMovedCards(
  entries: AutoMoveTarget[],
  srcRects: Map<string, DOMRect>,
): Promise<void> {
  if (entries.length === 0) return;
  await nextTick(); // Vue has re-rendered the moved cards into their slots

  // Snap each REAL card back to its source spot (transition start). No
  // z-index here — a waiting card keeps its natural stacking until its turn.
  const flying: HTMLElement[] = [];
  entries.forEach(({ id, target }) => {
    if (!target) return;
    const real = document.querySelector<HTMLElement>(`.card[data-id="${id}"]`);
    const src = srcRects.get(id);
    if (!real || !src) return;
    const t = target.getBoundingClientRect();
    const dx = t.left + t.width / 2 - (src.left + src.width / 2);
    const dy = t.top + t.height / 2 - (src.top + src.height / 2);
    // Card is at t (target). Snap it to src (source spot), then fly back.
    real.style.transition = 'none';
    real.style.transform = `translate(${-dx}px, ${-dy}px)`;
    flying.push(real);
  });
  void document.body.offsetWidth; // commit the snap as the transition start

  // While waiting, the cards sit in the destination slot's absolute stack,
  // where DOM order puts the LAST mover on top — the opposite of the source
  // column's overlap. Re-z by take-off order so the first to fly covers the
  // rest, like the original column.
  flying.forEach((el, i) => {
    el.style.zIndex = String(AUTO_HOLD_Z_BASE + (flying.length - 1 - i));
  });

  // Fly them home ONE AT A TIME — `entries` is in engine auto-move order
  // (lowest rank / outermost first). The z-index lift happens at take-off
  // only and is cleared on landing.
  //
  // STACKING ORDER IN FLIGHT MUST MIRROR THE SOURCE COLUMN, not the destination
  // foundation. Because tableau cards cascade in descending-alt-colour stacks,
  // a single move can expose several cards in ONE column (e.g. ...black-7,
  // red-6) which now both fly home. In the source column the lower rank (red-6)
  // was visually ON TOP of the higher one (black-7). If we lifted z by
  // `6000 + i` (later take-off = higher z), the later-take-off card would
  // pop ABOVE the earlier one mid-flight and visibly reverse the source
  // stacking — exactly the "叠放顺序会混乱" symptom. We mirror the hold-band
  // formula `base + (flying.length - 1 - i)` so the first-to-take-off card
  // (lowest rank, source-top among cross-/same-source peers) keeps the highest
  // z throughout flight. Landing clears z one at a time, after which the
  // foundation slot's natural DOM order takes over (later-pushed = higher) and
  // ends with the correct top card — see memories/solitaire-overlay-zindex-stack.md
  // for the same reverse-index reasoning used during the hold phase.
  flying.forEach((el, i) => {
    const delay = i * AUTO_STAGGER_MS;
    const takeOff = () => {
      el.style.zIndex = String(6000 + (flying.length - 1 - i));
      el.style.transition = `transform ${AUTO_FLY_MS}ms ${AUTO_EASE}`;
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
