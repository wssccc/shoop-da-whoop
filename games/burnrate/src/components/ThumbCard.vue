<script setup lang="ts">
/**
 * ThumbCard — 44x60 缩略卡（对手区 / 我的公司 / 我的项目）。
 * 基于 burn-rate.html 的 .card-thumb：类型色条 + 图标 + 名称 + 左右徽章。
 * 徽章映射引擎字段：staff → ⚙️技能 / 💼薪水；vp → 部门 / 💼薪水；
 * project → 🔥烧钱 / 需N技能；consultant → 💼薪水。
 * targeting 时合法目标金色呼吸（target），AI 即将打出的牌金色脉冲（highlighted）。
 */
import { computed } from 'vue';
import type { Card as CardModel } from '@burnrate/game/types';
import { kindMeta, shortName } from '../lib/card-meta';

const props = withDefaults(
  defineProps<{
    card: CardModel;
    /** Valid target for a pending action — gold pulse. */
    target?: boolean;
    /** AI about-to-play highlight (gold pulse). */
    highlighted?: boolean;
    /** Clicking emits. False = read-only (dead players, locked states). */
    clickable?: boolean;
    /** Skill progress for projects: { current, required }. */
    skillProgress?: { current: number; required: number } | null;
    /** Project complete-able AND has reward — green backlight. */
    completable?: boolean;
  }>(),
  { clickable: true, skillProgress: null, completable: false },
);

const emit = defineEmits<{ (e: 'click'): void }>();

const kind = computed(() => kindMeta(props.card));
/** 卡面短名（去掉与角标/badge 重复的括号描述）。 */
const displayName = computed(() => shortName(props.card));

const badges = computed<{ left: string; right: string }>(() => {
  const c = props.card;
  const none = { left: '', right: '' };
  if (c.kind === 'staff') return { left: `⚙${c.skill}`, right: `$${c.salary}` };
  if (c.kind === 'vp') return { left: c.dept.toUpperCase(), right: `$${c.salary}` };
  if (c.kind === 'project') {
    // 技能攒够且有奖励 → 右角徽章变为可领取的 💰奖励。
    if (props.completable) return { left: `🔥${c.burn}`, right: `💰${c.reward}` };
    return { left: `🔥${c.burn}`, right: c.reqSkill > 0 ? `需${c.reqSkill}` : '' };
  }
  if (c.kind === 'consultant') return { left: '💼', right: `$${c.salary}` };
  return none;
});

const rootClass = computed(() => {
  const list = ['card-thumb', `type-${kind.value.tag.replace('tag-', '')}`];
  if (props.target || props.highlighted) list.push('is-target');
  if (props.completable) list.push('is-completable');
  if (!props.clickable) list.push('is-dimmed');
  return list;
});

/** 进度条百分比（0-100）。 */
const progressPct = computed(() => {
  const s = props.skillProgress;
  if (!s || s.required <= 0) return 0;
  return Math.min(100, Math.round((s.current / s.required) * 100));
});
const progressDone = computed(() => {
  const s = props.skillProgress;
  return !!s && s.required > 0 && s.current >= s.required;
});

/** 悬浮提示：卡名 + 描述 + 技能进度 / 可收钱提示。 */
const thumbTitle = computed(() => {
  let t = `${props.card.name} — ${props.card.desc}`;
  const s = props.skillProgress;
  if (props.card.kind === 'project' && s) {
    t += `（技能 ${s.current}/${s.required}）`;
    if (props.completable) t += ' — 可完成并领取奖励 💰';
  }
  return t;
});

function onClick(): void {
  if (props.clickable) emit('click');
}
</script>

<template>
  <div :class="rootClass" :title="thumbTitle" @click="onClick">
    <div class="thumb-type-bar" />
    <div class="thumb-icon">{{ kind.icon }}</div>
    <div class="thumb-name">{{ displayName }}</div>
    <div v-if="skillProgress" class="thumb-progress" :class="{ done: progressDone }">
      <div class="thumb-progress-track">
        <div class="thumb-progress-fill" :style="{ width: progressPct + '%' }" />
      </div>
    </div>
    <div class="thumb-badges">
      <span v-if="badges.left" class="thumb-badge">{{ badges.left }}</span>
      <span v-else />
      <span v-if="badges.right" class="thumb-badge right">{{ badges.right }}</span>
      <span v-else />
    </div>
  </div>
</template>

<style scoped>
.card-thumb {
  width: 44px; height: 60px; border-radius: 5px; position: relative; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px;
  border: 1px solid; transition: transform 0.15s, box-shadow 0.15s; user-select: none; flex-shrink: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%);
}
.card-thumb:hover { transform: translateY(-3px) scale(1.05); z-index: 2; }
.card-thumb.is-dimmed { cursor: default; }
.card-thumb.is-dimmed:hover { transform: none; }
.card-thumb .thumb-type-bar {
  position: absolute; top: 0; left: 0; right: 0; height: 2px; border-radius: 5px 5px 0 0;
}
.card-thumb .thumb-icon { font-size: 14px; line-height: 1; }
.card-thumb .thumb-name {
  font-size: 7px; color: rgba(255,255,255,0.7); text-align: center; line-height: 1.1;
  max-width: 38px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 1px;
}
.card-thumb .thumb-badges {
  position: absolute; bottom: 2px; left: 2px; right: 2px; display: flex; justify-content: space-between;
}
.card-thumb .thumb-badge {
  font-size: 7px; font-family: "D-DIN", monospace; font-weight: 700; padding: 0 2px;
  border-radius: 2px; line-height: 10px;
}
.card-thumb .thumb-badge.right { background: rgba(255,200,50,0.2); color: #FFD632; }

/* 类型色 */
.card-thumb.type-action   { border-color: rgba(180,140,255,0.35); }
.card-thumb.type-action   .thumb-type-bar { background: #B48CFF; }
.card-thumb.type-tech     { border-color: rgba(80,220,180,0.35); }
.card-thumb.type-tech     .thumb-type-bar { background: #50DCB4; }
.card-thumb.type-staff    { border-color: rgba(100,180,255,0.35); }
.card-thumb.type-staff    .thumb-type-bar { background: #64B4FF; }
.card-thumb.type-finance  { border-color: rgba(255,190,80,0.35); }
.card-thumb.type-finance  .thumb-type-bar { background: #FFBE50; }
.card-thumb.type-market   { border-color: rgba(255,120,80,0.35); }
.card-thumb.type-market   .thumb-type-bar { background: #FF7850; }
.card-thumb.type-bad      { border-color: rgba(255,80,100,0.35); }
.card-thumb.type-bad      .thumb-type-bar { background: #FF5064; }
.card-thumb.type-consultant { border-color: rgba(255,140,200,0.35); }
.card-thumb.type-consultant .thumb-type-bar { background: #FF8CC8; }

/* 目标/高亮：金色呼吸 */
.card-thumb.is-target {
  border-color: #FFB454 !important;
  box-shadow: 0 0 12px rgba(255,180,84,0.55);
  animation: thumbPulse 1.1s ease-in-out infinite;
}
@keyframes thumbPulse {
  0%, 100% { box-shadow: 0 0 6px rgba(255,180,84,0.35); }
  50% { box-shadow: 0 0 16px rgba(255,180,84,0.75); }
}

/* 可完成且有奖励：绿色背光呼吸（点开即可收钱） */
.card-thumb.is-completable {
  border-color: rgba(80,220,180,0.9) !important;
  animation: thumbCompletePulse 1.2s ease-in-out infinite;
}
@keyframes thumbCompletePulse {
  0%, 100% { box-shadow: 0 0 5px rgba(80,220,180,0.45); }
  50% { box-shadow: 0 0 14px rgba(80,220,180,0.85); }
}

/* 项目技能进度条（徽章上方细条） */
.card-thumb .thumb-progress {
  position: absolute; left: 3px; right: 3px; bottom: 13px; height: 2.5px;
  border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden;
}
.card-thumb .thumb-progress-track { height: 100%; }
.card-thumb .thumb-progress-fill {
  height: 100%; border-radius: 2px; background: linear-gradient(90deg, #FFD632, #FFB454);
  transition: width 0.4s ease;
}
.card-thumb .thumb-progress.done .thumb-progress-fill {
  background: linear-gradient(90deg, #50DCB4, #13DDC4);
}
</style>
