// Single-card flight — the ONLY animation primitive the action-unit executor
// needs. Every "cards fly home" animation (收龙, the post-move cascade, the
// post-deal settle) is now generated + applied by the ENGINE one step at a
// time (beginUnit / stepUnit / endUnit — see engine.ts): each step moves one
// card, the executor animates that one card with a single FLIP tween, then
// asks for the next step. Data and display stay in lockstep — a card is
// never committed to its destination before its own animation starts, so
// nothing can "vanish" while other cards fly.
//
// (The previous commit-then-fly machinery — flyCardsHome / prepareFlight /
// launchFlight / peelOrder / the HOLD/TAKE_OFF z-bands — is gone. Multiple
// cards still overlap in flight via the interleaved cadence below, each
// lifting to IN_FLIGHT_Z at take-off and clearing on landing.)

export const FLY_MS = 320;
/** Gap between consecutive take-offs (the interleave in the executor loop). */
export const STAGGER_MS = 200;
export const AUTO_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** Z while a card is airborne (above the whole board, below the overlays). */
export const IN_FLIGHT_Z = 9000;
/**
 * Lift for the destination pile's OUTER stacking context (`.flip-scene`)
 * while a card flies INTO it. The flying card's z=9000 lives INSIDE the
 * pile's stacking-context chain (perspective → transform → backface), so the
 * root context only ever sees the pile itself — which sits at z:auto and
 * loses to any LATER sibling pile (a sealed dragon pile showing its card
 * back, see `solitaire-dragon-pile-back`): the flying card gets covered by
 * another pile's card back.
 *
 * Lifting the pile to 1 (NOT 9001) is enough: 1 already beats sibling piles'
 * auto=0, and 9001 would bury the root-level z=9000 cascade/deal cards (the
 * pile is only required to win against OTHER piles, not against root-level
 * flying cards). Cleared when the last in-flight card lands — static state
 * (a boot-restored pile) never carries an inline z-index.
 */
export const PILE_LIFT_Z = 1;

/**
 * Active in-flight lift counts per `.flip-scene`. Interleaved take-offs
 * overlap (a later card takes off while the previous one is still airborne),
 * so each flight increments and each landing decrements; the inline z-index
 * is only written on 0→1 and cleared on 1→0.
 */
const pileLiftCounts = new Map<HTMLElement, number>();

/**
 * Extra time the destination pile's z-lift is held after the LAST card of a
 * SEALED pile (flipped) lands. The seal flip runs from flipped-class time
 * (delay 0.4s + 0.8s transition = 1.2s — see index.css .flip-card.flipped);
 * the flight lands at 0.38s. Clearing the pile's z-index (a compositor
 * layer re-org) inside that window — or exactly at its end — lets mobile
 * GPUs glitch the just-revealed card back (a one-frame flash of the front
 * face). Holding the lift past the flip's end keeps the layer re-org away
 * from the reveal. Harmless while held: z=1 only beats sibling piles
 * (positioned apart) and loses to root-level z=9000 flying cards.
 */
export const SEAL_Z_HOLD_MS = 1200;

function liftPile(el: HTMLElement): void {
  const scene = el.closest<HTMLElement>('.flip-scene');
  if (!scene) return; // not flying into a dragon pile — nothing to lift
  const n = (pileLiftCounts.get(scene) ?? 0) + 1;
  pileLiftCounts.set(scene, n);
  if (n === 1) scene.style.zIndex = String(PILE_LIFT_Z);
}

function dropPile(el: HTMLElement): void {
  const scene = el.closest<HTMLElement>('.flip-scene');
  if (!scene) return;
  const n = (pileLiftCounts.get(scene) ?? 0) - 1;
  if (n <= 0) {
    pileLiftCounts.delete(scene);
    scene.style.zIndex = '';
  } else {
    pileLiftCounts.set(scene, n);
  }
}
/**
 * Duration of the drag-drop settle tween — ALSO the delay before the
 * action-unit executor starts consuming the post-move cascade, so the
 * dropped run's settle never races the cascade's first step. Single source
 * of truth for both (previously 240ms, unified to 250ms).
 */
export const FLIP_SETTLE_MS = 250;

/**
 * Fly ONE real card from where it currently renders (`fromRect`) to its
 * destination slot with a single FLIP tween.
 *
 * The card has already been committed + re-rendered into the destination
 * slot (the executor called engine.stepUnit() and awaited nextTick), so it
 * sits at the target spot: snap it back to `fromRect` with transition:none
 * (one forced recalc commits the snap as the transition's start value),
 * then ease it home. z lifts to IN_FLIGHT_Z at take-off and clears on
 * landing — later steps may take off while this card is still airborne.
 *
 * The caller does NOT need to await the full flight; the executor starts the
 * next step after STAGGER_MS (see useSolitaireGame.consumeUnit).
 */
export async function flyCardTo(
  el: HTMLElement,
  fromRect: DOMRect,
  targetEl: HTMLElement,
): Promise<void> {
  return flip(el, fromRect, targetEl.getBoundingClientRect());
}

/**
 * FLIP one card from its source rect to wherever it renders NOW — the card
 * must already be re-rendered into its final position. Unlike flyCardTo this
 * targets the card's own rect, so it also works when the destination is a
 * tableau column (the column slot's rect centre ≠ the card's stacked spot).
 * Used by the hint executor's animated user move.
 */
export async function flyCardHome(
  el: HTMLElement,
  fromRect: DOMRect,
): Promise<void> {
  return flip(el, fromRect, el.getBoundingClientRect());
}

/** Shared FLIP tween core: snap the card back to `fromRect`, lift it above
 *  the board, ease it to `toRect`, then clean up the inline styles. */
async function flip(
  el: HTMLElement,
  fromRect: DOMRect,
  toRect: DOMRect,
): Promise<void> {
  const dx = toRect.left + toRect.width / 2 - (fromRect.left + fromRect.width / 2);
  const dy = toRect.top + toRect.height / 2 - (fromRect.top + fromRect.height / 2);
  el.style.transition = 'none';
  el.style.transform = `translate(${-dx}px, ${-dy}px)`;
  void document.body.offsetWidth; // commit the snap as the transition start
  el.style.zIndex = String(IN_FLIGHT_Z);
  liftPile(el); // flying INTO a dragon pile — lift the pile above sibling piles
  // Is this the seal flip's last card (the pile is complete)? Its z-lift must
  // outlive the flip — see SEAL_Z_HOLD_MS.
  const sealed =
    el.closest<HTMLElement>('.flip-card')?.classList.contains('flipped') ?? false;
  el.style.transition = `transform ${FLY_MS}ms ${AUTO_EASE}`;
  el.style.transform = '';
  await new Promise((r) => setTimeout(r, FLY_MS + 60));
  el.style.transition = '';
  el.style.transform = '';
  el.style.zIndex = '';
  if (sealed) {
    // Keep the pile's lift past the seal flip's end (0.4s delay + 0.8s
    // transition), so the z-clear (compositor re-org) never coincides with
    // the just-revealed card back — mobile GPUs can flash the front face.
    await new Promise((r) => setTimeout(r, SEAL_Z_HOLD_MS));
  }
  dropPile(el); // last card of this pile landed — restore the static z
}
