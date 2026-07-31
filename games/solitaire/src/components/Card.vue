<script setup lang="ts">
/**
 * Card — single card on the board.
 *
 * Renders the correct corner pips by card type:
 *  - number cards: rank digit in each corner
 *  - dragon cards: per-colour CJK glyph (中 / 萬 / 發)
 *  - flower cards: ✿
 *
 * The root carries `data-id="<card.id>"` so the drag controller can locate it,
 * and the `.c-{color}` / `.num|dragon|flower` classes drive the colour rules.
 *
 * `draggable=false` adds `.no-drag` (foundation/flower slots can't be dragged).
 * `dragging=true` adds `.is-dragging` (visibility:hidden) while a drag ghost is
 * flying the real card's slot for FLIP capture (Phase 6).
 */
import { computed } from 'vue';
import { motion } from 'motion-v';
import type { Card as CardModel, CardColor } from '@solitaire/game/types';

const props = defineProps<{
  card: CardModel;
  /** Pass `false` to mark this card non-draggable (foundation/flower cards). */
  draggable?: boolean;
  /** Hidden but in place; true while dragging this card. */
  dragging?: boolean;
  /**
   * Suppress motion-v's layout FLIP while the dealing fly-in runs. The deal
   * animation drives the REAL cards' inline transform directly (no ghost
   * clones); with layout active, motion-v would detect the old card-id's
   * position as the FLIP start and fight the hand-rolled animation.
   */
  noLayout?: boolean;
}>();

const DRAGON_GLYPHS: Record<CardColor, string> = {
  red: '中',
  black: '萬',
  green: '發',
};

const rootClass = computed(() => {
  const c = props.card;
  const list = ['card'];
  if ('color' in c) list.push(`c-${c.color}`);
  if (c.type === 'number') list.push('num');
  else list.push(c.type); // 'dragon' | 'flower'
  if (props.draggable === false) list.push('no-drag');
  if (props.dragging) list.push('is-dragging');
  return list;
});

const rankLabel = computed(() =>
  props.card.type === 'number' ? String(props.card.rank) : '',
);
const glyphLabel = computed(() => {
  const c = props.card;
  if (c.type === 'dragon') return DRAGON_GLYPHS[c.color];
  if (c.type === 'flower') return '✿';
  return '';
});
</script>

<template>
  <motion.div
    :class="rootClass"
    :data-id="card.id"
    :layout="!noLayout"
    :layout-id="noLayout ? undefined : `card-${card.id}`"
    :transition="{ type: 'spring', stiffness: 300, damping: 30 }"
  >
    <div class="corner tl">
      <span v-if="rankLabel" class="rank-num">{{ rankLabel }}</span>
      <span v-else class="glyph-small">{{ glyphLabel }}</span>
    </div>
    <div class="corner br">
      <span v-if="rankLabel" class="rank-num">{{ rankLabel }}</span>
      <span v-else class="glyph-small">{{ glyphLabel }}</span>
    </div>
  </motion.div>
</template>
