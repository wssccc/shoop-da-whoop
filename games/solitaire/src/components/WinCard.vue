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
import { onUnmounted, ref } from 'vue';
import type { SolitaireGameApi } from '../composables/useSolitaireGame';

/** Exit duration — must match @keyframes win-exit-coin / win-exit-scale. */
const WIN_EXIT_MS = 1000;

const props = defineProps<{
  game: SolitaireGameApi;
}>();

/** True while the exit animation plays — button disabled, no re-entry. */
const exiting = ref(false);

/** Exit timeout handle — cleared on unmount. The board stays interactive
 * during the 1s exit, so an undo (clears `won` → unmounts this card) or a
 * toolbar 新局 (fires newGame directly) racing the exit must not fire
 * `newGame()` a second time (would discard an undo / double-deal). */
let exitTimer: ReturnType<typeof setTimeout> | undefined;

function onRestart(): void {
  if (exiting.value) return;
  exiting.value = true;
  // Wait the CSS exit out, then hand over to the deal (justDealt flips →
  // useDealing plays the fly-in, then settles safe auto-moves).
  exitTimer = setTimeout(() => {
    props.game.newGame();
  }, WIN_EXIT_MS);
}

onUnmounted(() => {
  if (exitTimer) {
    clearTimeout(exitTimer);
    exitTimer = undefined;
  }
});
</script>

<template>
  <div class="win-stage" role="status" aria-live="polite">
    <div class="win-emblem" :class="{ 'is-exiting': exiting }">
      <div class="win-scene">
        <div class="win-card" aria-hidden="true">
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
