<script setup lang="ts">
/**
 * OpponentPanel — 对手信息面板（burn-rate.html .opp-panel）：
 * 头像 / 名字 / 现金·烧钱·手牌 / 人员缩略行 / 项目缩略行。
 * active-turn 金色边框 + 「当前回合」指示；破产灰化。
 * targeting 时合法目标缩略卡金色呼吸、点击完成；AI 即将打出的牌高亮。
 */
import { computed } from 'vue';
import type { BurnRateGameApi } from '@burnrate/composables/useBurnRateGame';
import { canCompleteProject, getSkill } from '@burnrate/game/rules';
import type { PlayerId, PlayerState, TargetRef } from '@burnrate/game/types';
import ThumbCard from './ThumbCard.vue';

const props = defineProps<{
  game: BurnRateGameApi;
  playerId: PlayerId;
  player: PlayerState;
  name: string;
  icon: string;
  color: string;
  isTurn: boolean;
  isDead: boolean;
}>();

const emit = defineEmits<{
  (e: 'target', ref: TargetRef): void;
  (e: 'openCard', card: PlayerState['company'][number], zone: 'company' | 'projects', index: number): void;
}>();

const targeting = computed(() => props.game.targeting.value);
const burnRate = computed(() => props.game.burnRates.value[props.playerId] ?? 0);

function isTarget(zone: 'company' | 'projects', index: number): boolean {
  const t = targeting.value;
  if (!t) return false;
  return t.some((r) => r.player === props.playerId && r.zone === zone && r.index === index);
}

function isHighlight(cardId: string): boolean {
  return props.game.aiHighlightId.value === cardId;
}

function thumbClick(card: PlayerState['company'][number], zone: 'company' | 'projects', index: number): void {
  if (isTarget(zone, index)) {
    emit('target', { player: props.playerId, zone, index });
  } else {
    emit('openCard', card, zone, index);
  }
}

/** 项目技能进度（按对手技能计算）。 */
function projectSkill(c: PlayerState['projects'][number]): { current: number; required: number } | null {
  if (c.kind !== 'project') return null;
  const role = c.subtype === 'market' ? 'mkt' : 'eng';
  return { current: getSkill(props.game.state.value, props.playerId, role), required: c.reqSkill };
}

/** 项目可收钱（技能攒够 + 对应 VP + 奖励 > 0）→ 背光。 */
function projectCompletable(c: PlayerState['projects'][number]): boolean {
  if (c.kind !== 'project') return false;
  return c.reward > 0 && canCompleteProject(props.game.state.value, props.playerId, c).ok;
}
</script>

<template>
  <div
    class="opp-panel"
    :class="{ 'active-turn': isTurn && !isDead, dead: isDead }"
  >
    <div class="turn-indicator">当前回合</div>
    <div class="opp-header">
      <div class="opp-avatar" :style="{ borderColor: color + '44', background: color + '18' }">{{ icon }}</div>
      <div class="opp-name">{{ name }}</div>
    </div>
    <div class="opp-stats">
      <div class="opp-stat">现金 <span class="num cash">${{ player.cash }}M</span></div>
      <div class="opp-stat">烧钱 <span class="num burn">${{ burnRate }}M</span></div>
      <div class="opp-stat">手牌 <span class="num">{{ player.hand.length }}</span></div>
    </div>
    <div class="opp-section-label">人员 {{ player.company.length }}</div>
    <div class="thumb-row">
      <ThumbCard
        v-for="(c, i) in player.company"
        :key="c.id"
        :card="c"
        :target="isTarget('company', i)"
        :highlighted="isHighlight(c.id)"
        :clickable="!isDead"
        @click="thumbClick(c, 'company', i)"
      />
    </div>
    <div class="opp-section-label">项目 {{ player.projects.length }}</div>
    <div class="thumb-row">
      <ThumbCard
        v-for="(c, i) in player.projects"
        :key="c.id"
        :card="c"
        :skill-progress="projectSkill(c)"
        :completable="projectCompletable(c)"
        :target="isTarget('projects', i)"
        :highlighted="isHighlight(c.id)"
        :clickable="!isDead"
        @click="thumbClick(c, 'projects', i)"
      />
    </div>
  </div>
</template>
