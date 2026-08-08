<script setup lang="ts">
/**
 * WinCard — victory emblem shown IN the (now-empty) tableau area, no modal.
 *
 * A 3D coin-flip card (see index.css): once the last collect-flight has
 * settled (`flushWinIfIdle` → `won`), the card pops in over the tableau —
 * outer `scale` overshoot bounce + `rotateY` coin spin that starts facing
 * the navy SVG BACK and lands on the FRONT (`/images/2.gif`, object-fit
 * contained on a paper face). The outer wrapper carries the gold
 * `drop-shadow` BREATHE (was `text-shadow` on the old 🃏 emoji; text-shadow
 * can't glow an <img>). The 再来一局 button fades in after the entrance;
 * clicking it plays a 1.0s accelerating rotateY spin-off + linear scale 1→0,
 * then `game.newGame()` hands over to the dealing composable. The button is
 * disabled while the exit plays so a double-click can't race two deals.
 *
 * Interaction contract (agreed design):
 * - No overlay, no 恭喜通关 copy — the toolbar 胜局 pill already shows the
 *   counter.
 * - The board stays interactive: undo() clears `won` (see useSolitaireGame)
 *   and unmounts this component; the toolbar 新局 button restarts directly.
 */
import { onMounted, onUnmounted, ref } from 'vue';
import type { SolitaireGameApi } from '../composables/useSolitaireGame';

/**
 * Entrance timing — same cadence as the removed CSS keyframes: 0.55s hold on
 * the BACK pose, then 1s spin 180°→720° with a symmetric ease-in-out. The
 * exit is 1s, 720°→2520° accelerating + emblem scale 1→0 (linear).
 */
const ENTER_DELAY_S = 0.55;
const SPIN_S = 1;
const EXIT_S = 1;

const props = defineProps<{
  game: SolitaireGameApi;
}>();

/** The .win-card 3D element — receives the JS-driven rotateY pose. */
const cardRef = ref<HTMLElement | null>(null);
/** The .win-emblem wrapper — receives the exit scale (1→0). */
const emblemRef = ref<HTMLElement | null>(null);

/** True while the exit animation plays — button disabled, no re-entry. */
const exiting = ref(false);

type Phase = 'idle' | 'enter' | 'landed' | 'exit';
let phase: Phase = 'idle';
let driveRaf = 0;
let startAt = 0;

/** cubic-bezier evaluator — bisection-solve x(t)=p, return y(t). */
function makeBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const xAt = (t: number) => ((ax * t + bx) * t + cx) * t;
  const yAt = (t: number) => ((ay * t + by) * t + cy) * t;
  return (p: number): number => {
    let lo = 0;
    let hi = 1;
    let t = 0.5;
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2;
      if (xAt(t) < p) lo = t;
      else hi = t;
    }
    return yAt(t);
  };
}
const EASE_IN_OUT = makeBezier(0.33, 0, 0.67, 1); // entrance spin
const EASE_IN = makeBezier(0.5, 0, 0.75, 0); // exit spin

/** Entrance rotateX wobble — sampled from the original keyframes
 *  (0%:-2° 25%:+1° 50%:+2° 75%:0° 100%:-2°), piecewise-linear. */
const ROTX_PTS: ReadonlyArray<readonly [number, number]> = [
  [0, -2],
  [0.25, 1],
  [0.5, 2],
  [0.75, 0],
  [1, -2],
];
function rotXAt(p: number): number {
  for (let i = 1; i < ROTX_PTS.length; i++) {
    const [p0, v0] = ROTX_PTS[i - 1];
    const [p1, v1] = ROTX_PTS[i];
    if (p <= p1) return v0 + ((v1 - v0) * (p - p0)) / (p1 - p0);
  }
  return ROTX_PTS[ROTX_PTS.length - 1][1];
}

/**
 * Write the card pose AND the face visibility in the SAME frame — the core
 * of the iOS 13 fix. Old WebKit flattens the 3D chain (backface-visibility
 * gives out) AND its computed transform is unreliable during CSS animations
 * (returns `none`/stale values — which made the BACK face never appear), so
 * this component drives the spin itself: no computed-style reads, no
 * reliance on backface-visibility or CSS animation parsing. At most one
 * face is ever visible, by construction.
 */
function applyPose(angleDeg: number, rotX = 0, scale?: number): void {
  const card = cardRef.value;
  if (!card) return;
  const a = ((angleDeg % 360) + 360) % 360;
  const frontFacing = a < 90 || a > 270; // front faces the viewer in (270°,360°]∪[0°,90°)
  card.style.transform = `rotateY(${angleDeg}deg) rotateX(${rotX}deg)`;
  for (const face of card.querySelectorAll('.face')) {
    const isFront = face.classList.contains('front');
    (face as HTMLElement).style.visibility =
      isFront === frontFacing ? 'visible' : 'hidden';
  }
  // Exit only: the entrance scale is the CSS win-enter-scale animation; an
  // empty inline transform during enter leaves that animation untouched.
  if (emblemRef.value) {
    emblemRef.value.style.transform = scale === undefined ? '' : `scale(${scale})`;
  }
}

/** One rAF step: advance the current phase by wall-clock time. */
function drive(now: number): void {
  if (phase === 'enter') {
    const t = (now - startAt) / 1000;
    if (t < ENTER_DELAY_S) {
      applyPose(180, -2); // hold the BACK pose during the delay
    } else if (t < ENTER_DELAY_S + SPIN_S) {
      const p = EASE_IN_OUT((t - ENTER_DELAY_S) / SPIN_S);
      applyPose(180 + 540 * p, rotXAt(p));
    } else {
      land();
      return;
    }
  } else if (phase === 'exit') {
    const t = (now - startAt) / 1000;
    if (t >= EXIT_S) {
      finishExit();
      return;
    }
    const p = EASE_IN(t);
    applyPose(720 + 1800 * p, 0, 1 - t);
  } else {
    return;
  }
  driveRaf = requestAnimationFrame(drive);
}

/** Land the entrance: park on the FRONT with both faces settled. */
function land(): void {
  phase = 'landed';
  cancelAnimationFrame(driveRaf);
  applyPose(0);
}

/** Exit finished: settle styles, then hand over to the deal (justDealt
 *  flips → useDealing plays the fly-in, then settles safe auto-moves). */
function finishExit(): void {
  phase = 'idle';
  cancelAnimationFrame(driveRaf);
  applyPose(0, 0, 1);
  props.game.newGame();
}

function onRestart(): void {
  if (exiting.value) return;
  exiting.value = true;
  phase = 'exit';
  startAt = performance.now();
  driveRaf = requestAnimationFrame(drive);
}

onMounted(() => {
  // Begin the entrance: the very first frame holds the BACK pose (180°),
  // then the 1s spin lands on the FRONT — same cadence as the old CSS
  // animation (and the emblem's CSS win-enter-scale, which starts at the
  // same time).
  phase = 'enter';
  startAt = performance.now();
  driveRaf = requestAnimationFrame(drive);
});

onUnmounted(() => {
  cancelAnimationFrame(driveRaf);
});
</script>

<template>
  <div class="win-stage" role="status" aria-live="polite">
    <div ref="emblemRef" class="win-emblem" :class="{ 'is-exiting': exiting }">
      <div class="win-scene">
        <div ref="cardRef" class="win-card" aria-hidden="true">
          <!-- FRONT: celebration gif (native 200×150, 4:3), letterboxed by
               object-fit:contain on the paper face (see index.css). -->
          <div class="face front">
            <img src="/images/2.gif" alt="" draggable="false" />
          </div>
          <!-- BACK: the shared playing-card back (same file as the locked
               dragon piles — one deck, one identity; object-fit:contain
               letterboxes it onto the paper face, see index.css). A plain
               <img> sidesteps the SVG's internal pattern/filter id
               collisions across instances and is iOS-13-safe. -->
          <div class="face back">
            <img src="/images/card-back.svg" alt="" draggable="false" />
          </div>
        </div>
      </div>
    </div>
    <button
      type="button"
      class="win-btn"
      :disabled="exiting"
      @click="onRestart"
    >再来一局</button>
  </div>
</template>
