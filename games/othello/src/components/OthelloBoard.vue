<script setup lang="ts">
/**
 * OthelloBoard — renders the 8×8 grid of BoardCell components.
 *
 * Computes valid-move keys for the human player and passes
 * click/state down to each cell.
 */

import { computed } from 'vue';
import type { OthelloGame, Player, Position } from '../game/OthelloGame';
import BoardCell from './BoardCell.vue';

const props = defineProps<{
  game: OthelloGame;
  humanPlayer: Player;
  lastMove: Position | null;
  flippedKeys: Set<string>;
  isAiThinking: boolean;
}>();

const emit = defineEmits<{
  cellClick: [row: number, col: number];
}>();

const board = computed(() => props.game.board);

const validKeys = computed(() => {
  const keys = new Set<string>();
  if (props.game.currentPlayer !== props.humanPlayer) return keys;
  if (props.isAiThinking) return keys;
  const moves = props.game.getValidMoves();
  for (const m of moves) {
    keys.add(`${m.row},${m.col}`);
  }
  return keys;
});

function onCellClick(row: number, col: number) {
  emit('cellClick', row, col);
}
</script>

<template>
  <div class="grid grid-cols-8 overflow-hidden rounded-lg border-[3px] border-green-950 shadow-2xl">
    <template v-for="(row, ri) in board" :key="ri">
      <BoardCell
        v-for="(cell, ci) in row"
        :key="`${ri}-${ci}`"
        :row="ri"
        :col="ci"
        :player="cell"
        :is-valid-move="validKeys.has(`${ri},${ci}`)"
        :is-last-move="lastMove?.row === ri && lastMove?.col === ci"
        :is-flipping="flippedKeys.has(`${ri},${ci}`)"
        :is-disabled="isAiThinking || game.currentPlayer !== humanPlayer"
        @click="onCellClick"
      />
    </template>
  </div>
</template>
