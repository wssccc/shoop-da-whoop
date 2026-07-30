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

function handleClick() {
  if (props.isDisabled) return;
  emit('click', props.row, props.col);
}
</script>

<template>
  <div
    class="relative flex aspect-square cursor-pointer items-center justify-center border-r border-b border-green-900/40 transition-colors"
    :class="[
      bgClass,
      { 'cursor-default': isDisabled },
    ]"
    @click="handleClick"
  >
    <!-- Valid-move dot (empty + legal) -->
    <div
      v-if="player === 0 && isValidMove"
      class="h-[22%] w-[22%] rounded-full bg-black/20 transition-transform hover:scale-125"
    />

    <!-- Piece -->
    <div
      v-if="player !== 0"
      class="flex h-[72%] w-[72%] items-center justify-center rounded-full"
      :class="[
        isFlipping ? 'animate-flip' : '',
        player === 1
          ? 'bg-gradient-to-br from-gray-500 to-black'
          : 'bg-gradient-to-br from-white to-gray-300',
        isLastMove ? 'ring-2 ring-yellow-400' : '',
      ]"
      :style="{
        boxShadow:
          player === 1
            ? 'inset 0 2px 4px rgba(255,255,255,0.2), 0 2px 4px rgba(0,0,0,0.3)'
            : 'inset 0 2px 4px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.2)',
      }"
    />
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
