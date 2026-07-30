<script setup lang="ts">
/**
 * BoardCell — single cell on the Othello board.
 *
 * Renders:
 *  - Alternating dark/light green background
 *  - Piece (black/white gradient + 3D shadow) or empty
 *  - Valid-move indicator (translucent dot)
 *  - Last-move highlight (yellow ring)
 *  - Flip animation when an opponent piece is captured
 */

import { computed } from 'vue';
import type { Player } from '../game/OthelloGame';

const props = defineProps<{
  row: number;
  col: number;
  player: Player | 0;
  isValidMove: boolean;
  isLastMove: boolean;
  isFlipping: boolean;
  isDisabled: boolean;
}>();

const emit = defineEmits<{
  click: [row: number, col: number];
}>();

const isDark = computed(() => (props.row + props.col) % 2 === 0);

const bgClass = computed(() =>
  isDark.value ? 'bg-green-700' : 'bg-green-600',
);

/**
 * Inline fill for the piece. Uses real gradient CSS (no CSS custom
 * properties as gradient arguments) which every browser — including iOS 13 /
 * Safari 13 — can parse. `backgroundColor` is a solid fallback so the piece
 * never disappears even if the gradient is stripped.
 *
 * Why not the `bg-gradient-to-br from-* to-*` utilities: Tailwind v3 emits
 * them as `linear-gradient(var(--tw-gradient-position), var(--tw-gradient-stops))`.
 * Safari 13 drops the whole `background-image` declaration when a gradient's
 * argument list is built from multiple `var()`, making the piece transparent.
 */
const pieceStyle = computed(() => {
  if (props.player === 1) {
    // Black: gradient from gray-500 (#6b7280) down to black, mirroring the
    // previous `from-gray-500 to-black` look. `to-br` == 135deg.
    return {
      backgroundColor: '#000000',
      backgroundImage: 'linear-gradient(135deg, #6b7280, #000000)',
      boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.2), 0 2px 4px rgba(0,0,0,0.3)',
    };
  }
  // White: gradient from white to gray-300 (#d1d5db).
  return {
    backgroundColor: '#ffffff',
    backgroundImage: 'linear-gradient(135deg, #ffffff, #d1d5db)',
    boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.2)',
  };
});

function handleClick() {
  if (props.isDisabled) return;
  emit('click', props.row, props.col);
}
</script>

<template>
  <!--
    Use the universal padding-bottom aspect-ratio hack instead of CSS
    `aspect-ratio` (not supported in iOS 13 / Safari 13).
    The outer div creates a square box via padding-bottom: 100%,
    the inner div absolutely fills it to host the piece/dot content.
  -->
  <div
    class="relative h-0 cursor-pointer border-r border-b border-green-900/40 pb-[100%] transition-colors"
    :class="[
      bgClass,
      { 'cursor-default': isDisabled },
    ]"
    @click="handleClick"
  >
    <!--
      Stretch with `top/right/bottom/left` (not `inset` shorthand) so the
      absolutely-positioned child fills the parent's padding-box.  Using
      `h-full w-full` would resolve to 0 because the parent has `h-0`.
      Individual `top/right/bottom/left` are supported since CSS1/CSS2.
    -->
    <div class="absolute bottom-0 left-0 right-0 top-0 flex items-center justify-center">
      <!-- Valid-move dot (empty + legal) -->
      <div
        v-if="player === 0 && isValidMove"
        class="h-[22%] w-[22%] rounded-full bg-black/20 transition-transform hover:scale-125"
      />

      <!--
        Piece. Fill is applied via the inline `pieceStyle` (standard CSS
        gradient + solid fallback), NOT the `bg-gradient-to-br from-* to-*`
        utilities — those rely on CSS custom properties inside a
        `linear-gradient()` argument list, which iOS 13 / Safari 13 cannot
        parse, rendering the piece fully transparent.
      -->
      <div
        v-if="player !== 0"
        class="flex h-[72%] w-[72%] items-center justify-center rounded-full"
        :class="[
          isFlipping ? 'animate-flip' : '',
          isLastMove ? 'ring-2 ring-yellow-400' : '',
        ]"
        :style="pieceStyle"
      />
    </div>
  </div>
</template>

<style scoped>
@keyframes flip-piece {
  0% {
    transform: perspective(200px) rotateY(0deg);
  }
  50% {
    transform: perspective(200px) rotateY(90deg);
  }
  100% {
    transform: perspective(200px) rotateY(0deg);
  }
}

.animate-flip {
  animation: flip-piece 0.45s ease-in-out;
}
</style>
