<script setup lang="ts">
/**
 * PlayerInfoPanel — 玩家信息面板（burn-rate.html .player-info）：
 * 头像 / 现金 / 烧钱率 / 烧钱构成 / 部门技能点 / 顾问数 / 抽牌堆剩余。
 * 我的公司 / 我的项目缩略卡已移入手牌区（App.vue .hand-board）。
 */
import { computed } from 'vue';
import type { BurnRateGameApi } from '@burnrate/composables/useBurnRateGame';
import type { Card, Dept, Role } from '@burnrate/game/types';
import { burnBreakdown, getSkill, hasVP } from '@burnrate/game/rules';

const props = defineProps<{ game: BurnRateGameApi }>();

const s = computed(() => props.game.state.value);
const me = computed(() => s.value.players[0]);
const burnRate = computed(() => props.game.burnRates.value[0] ?? 0);

const DEPTS: { key: Dept; label: string; role: Role }[] = [
  { key: 'hr', label: 'HR', role: 'hr' },
  { key: 'fin', label: 'FIN', role: 'fin' },
  { key: 'sales', label: 'SALES', role: 'mkt' },
  { key: 'eng', label: 'ENG', role: 'eng' },
];

/** 部门是否已雇 VP。 */
const deptActive = computed<Record<Dept, boolean>>(() => {
  const st = s.value;
  if (!st.players[0]) return { hr: false, fin: false, sales: false, eng: false };
  return {
    hr: hasVP(st, 0, 'hr'),
    fin: hasVP(st, 0, 'fin'),
    sales: hasVP(st, 0, 'sales'),
    eng: hasVP(st, 0, 'eng'),
  };
});

/** 各部门技能点总数（SALES 对应营销技能）。 */
const deptSkill = computed<Record<Dept, number>>(() => {
  const st = s.value;
  if (!st.players[0]) return { hr: 0, fin: 0, sales: 0, eng: 0 };
  return {
    hr: getSkill(st, 0, 'hr'),
    fin: getSkill(st, 0, 'fin'),
    sales: getSkill(st, 0, 'mkt'),
    eng: getSkill(st, 0, 'eng'),
  };
});

/** 高价顾问数（只能靠 HR VP 裁员清除）。 */
const consultantCount = computed(
  () => me.value?.company.filter((c: Card) => c.kind === 'consultant').length ?? 0,
);

/** 抽牌堆剩余张数。 */
const deckLeft = computed(() => s.value.deck.length);

/** 烧钱构成：薪水 + 项目/顾问运维 + 最低运营 + 市场恐慌（与 calcBurn 同源拆分，
 *  只显示非零项）。 */
const burnSplit = computed(() =>
  s.value.players[0] ? burnBreakdown(s.value, 0) : { salary: 0, ops: 0, floor: 0, panic: 0 },
);
const burnSplitText = computed(() => {
  const b = burnSplit.value;
  const parts: string[] = [];
  if (b.salary > 0) parts.push(`薪水 $${b.salary}M`);
  if (b.ops > 0) parts.push(`运维 $${b.ops}M`);
  if (b.floor > 0) parts.push(`最低运营 $${b.floor}M`);
  if (b.panic > 0) parts.push(`市场恐慌 $${b.panic}M`);
  return parts.length ? parts.join(' + ') : '无开支'; // 不会发生（有最低运营底限）
});
</script>

<template>
  <div class="player-info">
    <div class="p-header">
      <div class="p-avatar">🧑‍💼</div>
      <div>
        <div class="p-name">我</div>
        <div class="p-sub">CEO</div>
      </div>
    </div>
    <div class="p-stat-row"><span class="label">现金</span><span class="value cash">${{ me?.cash ?? 0 }}M</span></div>
    <div class="p-stat-row"><span class="label">烧钱率</span><span class="value burn">${{ burnRate }}M</span></div>
    <div class="p-stat-row burn-split"><span class="label">烧钱构成</span><span class="value">{{ burnSplitText }}</span></div>

    <div class="p-section-title">部门技能点</div>
    <div class="p-depts">
      <span
        v-for="d in DEPTS"
        :key="d.key"
        class="p-dept"
        :class="{ active: deptActive[d.key] }"
        :title="d.label + (deptActive[d.key] ? '（已雇 VP）' : '（未雇 VP）')"
      >{{ d.label }} <b>⚙{{ deptSkill[d.key] }}</b></span>
    </div>

    <div class="p-stat-row"><span class="label">顾问</span><span class="value" :class="{ warn: consultantCount > 0 }">×{{ consultantCount }}</span></div>
    <div class="p-stat-row"><span class="label">抽牌堆剩余</span><span class="value">{{ deckLeft }} 张</span></div>
  </div>
</template>
