<script setup lang="ts">
/**
 * Card — 手牌大卡（88x122），基于 burn-rate.html 的 .game-card 骨架：
 * 左上角费用圆点 / 右上类型图标 / art / 名称 / 底部徽章 / 类型色条。
 * 引擎字段映射：staff·vp·consultant → 💼薪水；project → 🔥烧钱(角标)+需N技能+💰奖励；
 * action → ⚡角标 + act 徽章。项目卡可叠加技能进度条（skillProgress）。
 *
 * 保留 motion-v layout FLIP（跨区移动动画）与交互状态：
 * clickable / target(金色呼吸) / completable(绿色完成徽章) / disabled /
 * selected / hoverLift / faceDown / highlighted(AI 即将打出)。
 */
import { computed } from 'vue';
import { motion } from 'motion-v';
import type {
    Card as CardModel,
    Dept,
    Role,
} from '@burnrate/game/types';
import { kindMeta, shortName } from '../lib/card-meta';
import type { ActionAct } from '@burnrate/game/constants';

const props = withDefaults(
  defineProps<{
    card: CardModel;
    /** AI-hand mode: render the card back (id stays for FLIP continuity). */
    faceDown?: boolean;
    /** Clickable (cursor + hover border). */
    clickable?: boolean;
    /** Valid target for a pending action — gold pulse. */
    target?: boolean;
    /** Project can be completed — green glow. */
    completable?: boolean;
    /** Dimmed (unplayable). */
    disabled?: boolean;
    /** Lifted/selected (redraw picks). */
    selected?: boolean;
    /** Hand hover lift. */
    hoverLift?: boolean;
    /** Disable motion-v layout FLIP (hand-rolled animations). */
    noLayout?: boolean;
    /** AI highlight — gold pulse. */
    highlighted?: boolean;
    /** Skill progress for projects: { current, required }. */
    skillProgress?: { current: number; required: number } | null;
  }>(),
  { skillProgress: null },
);

const emit = defineEmits<{ (e: 'click'): void }>();

const DEPT_LABEL: Record<Dept, string> = {
  hr: 'HR',
  fin: 'FIN',
  sales: 'SALES',
  eng: 'ENG',
};
const ROLE_LABEL: Record<Role, string> = {
  eng: '工程',
  mkt: '营销',
  hr: 'HR',
  fin: '财务',
};
const ACT_LABEL: Record<ActionAct, string> = {
  layoff: '裁员',
  poach: '挖角',
  consultant: '顾问',
  headhunter: '猎头',
  release: '重组',
  audit: '审计',
  resign: '辞职',
};

const kind = computed(() => kindMeta(props.card));

const rootClass = computed(() => {
  const list = ['game-card', `type-${kind.value.tag.replace('tag-', '')}`];
  if (props.faceDown) list.push('face-down');
  if (props.clickable) list.push('is-clickable');
  if (props.target || props.highlighted) list.push('is-target');
  if (props.completable) list.push('is-completable');
  if (props.disabled) list.push('is-disabled');
  if (props.selected) list.push('is-selected');
  if (props.hoverLift) list.push('hover-lift');
  return list;
});

const kindLabel = computed(() => {
  switch (props.card.kind) {
    case 'vp': return 'VP';
    case 'staff': return '员工';
    case 'project': {
      if (props.card.subtype === 'tech') return '技术';
      if (props.card.subtype === 'bad') return '烂尾';
      return '市场';
    }
    case 'action': return '行动';
    case 'consultant': return '顾问';
  }
});

/** 卡面短名（去掉与角标/badge 重复的括号描述）。 */
const displayName = computed(() => shortName(props.card));

const deptLabel = computed(() => {
  const c = props.card;
  if (c.kind === 'vp') return DEPT_LABEL[c.dept];
  if (c.kind === 'staff') return ROLE_LABEL[c.role];
  return '';
});

/** 左上角圆点（对应新设计 cost 位）。 */
const corner = computed(() => {
  const c = props.card;
  switch (c.kind) {
    case 'vp':
    case 'staff':
    case 'consultant':
      return `$${c.salary}`;
    case 'project':
      return `🔥${c.burn}`;
    case 'action':
      return '⚡';
  }
});

const cornerTitle = computed(() => {
  const c = props.card;
  switch (c.kind) {
    case 'vp':
    case 'staff':
    case 'consultant':
      return `薪水 $${c.salary}M / 轮`;
    case 'project':
      return `烧钱 $${c.burn}M / 轮`;
    case 'action':
      return ACT_LABEL[c.act];
  }
});

/** 底部徽章（引擎字段）。 */
const chips = computed<{ text: string; cls?: string }[]>(() => {
  const c = props.card;
  const out: { text: string; cls?: string }[] = [];
  if (c.kind === 'staff') {
    out.push({ text: `⚙️${c.skill}`, cls: 'atk' });
    out.push({ text: `💼$${c.salary}M`, cls: 'hp' });
  } else if (c.kind === 'vp') {
    out.push({ text: DEPT_LABEL[c.dept], cls: 'atk' });
    out.push({ text: `💼$${c.salary}M`, cls: 'hp' });
  } else if (c.kind === 'project') {
    // 项目卡：烧钱 🔥N 在左上角、需求 ⚙N 在右上角，底部只留收益。
    if (c.reward > 0) out.push({ text: `💰$${c.reward}M`, cls: 'reward' });
  } else if (c.kind === 'action') {
    out.push({ text: ACT_LABEL[c.act], cls: 'act' });
  } else if (c.kind === 'consultant') {
    out.push({ text: `💼$${c.salary}M`, cls: 'hp' });
  }
  return out;
});

const progressPct = computed(() => {
  const s = props.skillProgress;
  if (!s || s.required <= 0) return 0;
  return Math.min(100, Math.round((s.current / s.required) * 100));
});
const progressDone = computed(() => {
  const s = props.skillProgress;
  return !!s && s.required > 0 && s.current >= s.required;
});
</script>

<template>
  <motion.div
    :class="rootClass"
    :data-id="card.id"
    :layout="!noLayout"
    :layout-id="noLayout ? undefined : `card-${card.id}`"
    :transition="{ type: 'spring', stiffness: 300, damping: 30 }"
    @click="emit('click')"
  >
    <template v-if="faceDown">
      <div class="card-back-glyph">💸</div>
      <div class="card-back-stripe" />
    </template>
    <template v-else>
      <span v-if="completable" class="card-complete-badge">✅ 可完成</span>
      <div class="card-corner" :title="cornerTitle">{{ corner }}</div>
      <!-- 项目卡右上角：技能需求 ⚙N；其它卡：类型图标 -->
      <div v-if="card.kind === 'project'" class="card-req" title="所需技能点">⚙{{ card.reqSkill }}</div>
      <div v-else class="card-type-icon" :title="kindLabel">{{ kind.icon }}</div>
      <div class="card-art">{{ kind.icon }}</div>
      <div class="card-name">
        {{ displayName }}
        <span v-if="deptLabel" class="card-dept">{{ deptLabel }}</span>
      </div>
      <div v-if="card.kind === 'project'" class="card-progress" :class="{ done: progressDone }">
        <div class="card-progress-track">
          <div class="card-progress-fill" :style="{ width: progressPct + '%' }" />
        </div>
        <span class="card-progress-num">
          {{ skillProgress ? `${skillProgress.current}/${skillProgress.required}` : `0/${card.reqSkill}` }}
        </span>
      </div>
      <div class="card-badges" :class="{ single: chips.length === 1 }">
        <span v-for="chip in chips" :key="chip.text" class="card-badge" :class="chip.cls">
          {{ chip.text }}
        </span>
      </div>
      <div class="card-rarity" />
    </template>
  </motion.div>
</template>

<style scoped>
.game-card {
  width: 88px; height: 122px; border-radius: 7px; position: relative; cursor: pointer;
  display: flex; flex-direction: column; border: 1px solid;
  background: linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%);
  transition: transform 0.2s, box-shadow 0.2s; user-select: none; flex-shrink: 0;
}
.game-card.hover-lift:hover { transform: translateY(-6px); }
.game-card.is-selected {
  transform: translateY(-12px); box-shadow: 0 0 20px rgba(255,180,84,0.25), 0 6px 20px rgba(0,0,0,0.4);
  border-color: #FFB454 !important;
}
.game-card.is-clickable { cursor: pointer; }
.game-card.is-disabled { opacity: 0.45; cursor: default; }
.game-card.is-target {
  border-color: #FFB454 !important;
  box-shadow: 0 0 16px rgba(255,180,84,0.6);
  animation: cardPulse 1.1s ease-in-out infinite;
}
.game-card.is-completable { box-shadow: 0 0 14px rgba(80,220,180,0.45); }
@keyframes cardPulse {
  0%, 100% { box-shadow: 0 0 6px rgba(255,180,84,0.35); }
  50% { box-shadow: 0 0 18px rgba(255,180,84,0.8); }
}

/* 角标与徽章 */
.card-corner {
  position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 99px;
  display: flex; align-items: center; justify-content: center; font-size: 9px;
  font-family: "D-DIN", monospace; font-weight: 700; color: #fff; z-index: 2;
  background: linear-gradient(135deg, #4488FF, #2266DD); border: 1px solid rgba(255,255,255,0.2);
}
.card-type-icon { position: absolute; top: 3px; right: 3px; font-size: 10px; opacity: 0.6; z-index: 2; }
/* 项目卡右上角技能需求（⚙N） */
.card-req {
  position: absolute; top: 3px; right: 3px; z-index: 2;
  font-size: 9px; font-family: "D-DIN", monospace; font-weight: 700;
  padding: 1px 4px; border-radius: 3px; line-height: 12px;
  background: rgba(255,200,50,0.15); color: #FFD632;
}
.card-art {
  flex: 1; display: flex; align-items: center; justify-content: center; font-size: 30px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.card-name {
  padding: 4px 5px 1px; font-size: 9px; font-weight: 600; color: #e8e8f5;
  text-align: center; line-height: 1.2; max-height: 22px; overflow: hidden;
}
.card-name .card-dept { color: #8a8aa8; font-weight: 400; }
.card-badges { display: flex; justify-content: space-between; padding: 2px 5px 4px; gap: 2px; }
.card-badges.single { justify-content: center; }
.card-badge {
  font-size: 9px; font-family: "D-DIN", monospace; font-weight: 700; padding: 1px 4px;
  border-radius: 3px; line-height: 12px; flex-shrink: 0;
}
.card-badge.atk { background: rgba(255,200,50,0.15); color: #FFD632; }
.card-badge.hp { background: rgba(255,80,80,0.15); color: #FF6B6B; }
.card-badge.reward { background: rgba(80,220,180,0.15); color: #50DCB4; }
.card-badge.act { background: rgba(180,140,255,0.15); color: #B48CFF; }
.card-rarity { height: 2px; border-radius: 0 0 7px 7px; margin-top: auto; }

/* 项目技能进度条 */
.card-progress { display: flex; align-items: center; gap: 4px; padding: 1px 5px 2px; }
.card-progress-track {
  flex: 1; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.08); overflow: hidden;
}
.card-progress-fill {
  height: 100%; border-radius: 2px; background: linear-gradient(90deg, #FFD632, #FFB454);
  transition: width 0.4s ease;
}
.card-progress.done .card-progress-fill { background: linear-gradient(90deg, #50DCB4, #13DDC4); }
.card-progress-num {
  font-size: 7px; font-family: "D-DIN", monospace; color: #8a8aa8; flex-shrink: 0;
}
.card-progress.done .card-progress-num { color: #50DCB4; }

/* 完成徽章 */
.card-complete-badge {
  position: absolute; top: -7px; left: 50%; transform: translateX(-50%);
  background: linear-gradient(135deg, #2AA87A, #1E7A5A); color: #fff;
  font-size: 8px; font-weight: 700; padding: 1px 8px; border-radius: 99px;
  border: 1px solid rgba(80,220,180,0.5); z-index: 3; white-space: nowrap;
  box-shadow: 0 2px 8px rgba(80,220,180,0.3);
}

/* 类型色（色条 + 边框） */
.game-card.type-action   { border-color: rgba(180,140,255,0.3); }
.game-card.type-action   .card-rarity { background: linear-gradient(90deg, #B48CFF, #7A5FD4); }
.game-card.type-tech     { border-color: rgba(80,220,180,0.3); }
.game-card.type-tech     .card-rarity { background: linear-gradient(90deg, #50DCB4, #2AA87A); }
.game-card.type-staff    { border-color: rgba(100,180,255,0.3); }
.game-card.type-staff    .card-rarity { background: linear-gradient(90deg, #64B4FF, #3A8CD4); }
.game-card.type-finance  { border-color: rgba(255,190,80,0.3); }
.game-card.type-finance  .card-rarity { background: linear-gradient(90deg, #FFBE50, #D49020); }
.game-card.type-market   { border-color: rgba(255,120,80,0.3); }
.game-card.type-market   .card-rarity { background: linear-gradient(90deg, #FF7850, #D45028); }
.game-card.type-bad      { border-color: rgba(255,80,100,0.3); }
.game-card.type-bad      .card-rarity { background: linear-gradient(90deg, #FF5064, #D42840); }
.game-card.type-consultant { border-color: rgba(255,140,200,0.3); }
.game-card.type-consultant .card-rarity { background: linear-gradient(90deg, #FF8CC8, #D4589C); }

/* 背面 */
.game-card.face-down {
  background: linear-gradient(180deg, #1c1c3a 0%, #14142c 100%);
  border-color: rgba(140,130,255,0.35);
  display: flex; align-items: center; justify-content: center; cursor: default;
}
.card-back-glyph { font-size: 26px; opacity: 0.9; }
.card-back-stripe {
  position: absolute; inset: 6px; border-radius: 4px;
  border: 1px dashed rgba(140,130,255,0.35);
}
</style>
