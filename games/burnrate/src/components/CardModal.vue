<script setup lang="ts">
/**
 * CardModal — 统一卡牌详情弹窗（合并旧 CardActionModal + CardDetailModal）。
 * 按来源区分操作：
 *   hand     → 手牌：招募入职 / 安排项目 / 执行行动（非法时禁用+原因）
 *   projects → 我的项目：可完成时显示「完成」+ 技能进度条
 *   company / opp → 只读（裁员/挖角/废弃等走行动卡，见 rules.md）
 */
import { computed, ref } from 'vue';
import type { Card } from '@burnrate/game/types';
import { kindMeta } from '../lib/card-meta';
import type { ActionAct } from '@burnrate/game/constants';

const props = defineProps<{
  card: Card | null;
  source: 'hand' | 'company' | 'projects' | 'opp';
  /** hand: disable the primary action. */
  actionDisabled?: boolean;
  /** hand: reason shown under the disabled primary action. */
  actionReason?: string;
  /** hand: free once-per-turn discard still available this turn. */
  canDiscard?: boolean;
  /** projects: project completable (complete button). */
  completable?: boolean;
  /** projects: skill progress { current, required }. */
  skill?: { current: number; required: number } | null;
  /** projects: actual completion reward including the matching-VP +50%. */
  effectiveReward?: number | null;
  /** projects (bad only): cash valve — pay 2×burn to abandon. */
  abandon?: { cost: number; can: boolean } | null;
  /** projects (bad only): 画大饼 — sacrifice engineers; req is the
   *  finance-discounted skill bar. */
  burnout?: { req: number; engineers: { id: string; name: string; skill: number }[] } | null;
  /** opp: whose card it is (e.g. "AI 1"). */
  owner?: string;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'hire'): void;
  (e: 'project'): void;
  (e: 'action'): void;
  (e: 'complete'): void;
  (e: 'abandon'): void;
  (e: 'burnout', engineerIds: string[]): void;
  (e: 'discard'): void;
}>();

/** 画大饼 engineer picker state. */
const burnoutOpen = ref(false);
const burnoutSelected = ref<string[]>([]);
const burnoutSum = computed(() =>
  (props.burnout?.engineers ?? [])
    .filter((e) => burnoutSelected.value.includes(e.id))
    .reduce((s, e) => s + e.skill, 0),
);
const burnoutFeasible = computed(
  () => (props.burnout?.req ?? 0) > 0 && burnoutSum.value >= (props.burnout?.req ?? 0),
);
function toggleBurnoutEngineer(id: string): void {
  const i = burnoutSelected.value.indexOf(id);
  if (i >= 0) burnoutSelected.value.splice(i, 1);
  else burnoutSelected.value.push(id);
}
function confirmBurnout(): void {
  const ids = burnoutSelected.value.slice();
  burnoutOpen.value = false;
  burnoutSelected.value = [];
  emit('burnout', ids);
}
function cancelBurnout(): void {
  burnoutOpen.value = false;
  burnoutSelected.value = [];
}

const meta = computed(() => (props.card ? kindMeta(props.card) : null));

const ACT_LABEL: Record<ActionAct, string> = {
  layoff: '裁员',
  poach: '挖角',
  consultant: '顾问',
  headhunter: '猎头',
  release: '重组',
  audit: '审计',
  resign: '辞职',
};

const typeLine = computed(() => {
  const c = props.card;
  if (!c) return '';
  const kind = meta.value?.name ?? '';
  switch (props.source) {
    case 'hand':
      return kind + ' · 手牌';
    case 'company':
      return kind + ' · 我的公司';
    case 'projects':
      return kind + ' · 我的项目';
    case 'opp':
      return kind + ' · ' + (props.owner ?? '对手') + ' 的' + '场上';
  }
});

const stats = computed<{ label: string; value: string; color?: string }[]>(() => {
  const c = props.card;
  if (!c) return [];
  const out: { label: string; value: string; color?: string }[] = [];
  if (c.kind === 'staff') {
    out.push({ label: '技能点', value: `⚙️ ${c.skill}`, color: '#FFD632' });
    out.push({ label: '薪水', value: `$${c.salary}M/轮`, color: '#FF7A90' });
    out.push({ label: '角色', value: c.role === 'eng' ? '工程' : c.role === 'mkt' ? '营销' : c.role === 'hr' ? 'HR' : '财务' });
  } else if (c.kind === 'vp') {
    out.push({ label: '部门', value: c.dept.toUpperCase(), color: '#FFBE50' });
    out.push({ label: '薪水', value: `$${c.salary}M/轮`, color: '#FF7A90' });
    out.push({ label: '特权', value: '部门高管' });
  } else if (c.kind === 'project') {
    const eff = props.effectiveReward ?? c.reward;
    out.push({ label: '烧钱', value: `$${c.burn}M/轮`, color: '#FF7A90' });
    out.push({ label: '需求', value: `${c.reqSkill} 技能`, color: '#FFD632' });
    out.push({
      label: eff > c.reward ? '奖励 (+50%)' : '奖励',
      value: c.reward > 0 ? `$${eff}M` : '—',
      color: '#5FE8D6',
    });
  } else if (c.kind === 'action') {
    out.push({ label: '效果', value: ACT_LABEL[c.act], color: '#B48CFF' });
    out.push({ label: '时机', value: '即打即生效' });
  } else if (c.kind === 'consultant') {
    out.push({ label: '顾问费', value: `$${c.salary}M/轮`, color: '#FF7A90' });
  }
  return out;
});

const isHire = computed(() => props.card?.kind === 'vp' || props.card?.kind === 'staff');
const isProject = computed(() => props.card?.kind === 'project');
const isAction = computed(() => props.card?.kind === 'action');

const progressPct = computed(() => {
  const s = props.skill;
  if (!s || s.required <= 0) return 0;
  return Math.min(100, Math.round((s.current / s.required) * 100));
});

const note = computed(() => {
  const c = props.card;
  if (!c) return '';
  if (props.source === 'hand' && props.actionDisabled) return props.actionReason ?? '当前无法执行此操作';
  if (props.source === 'projects' && c.kind === 'project') {
    if (props.completable) {
      if (c.subtype === 'market') return '✅ 技能已达标，项目将自动完成（有 Sales VP 才能变现领现金）';
      return '✅ 技能已达标，项目将自动完成并领取奖励！';
    }
    if (c.subtype === 'bad') {
      return '💡 烂尾工程极难完成：可支付现金止损，或用画大饼忽悠工程师（财务技能可降低所需点数）';
    }
    return '💡 技能点达到需求后项目将自动完成（无需 VP）';
  }
  if (props.source === 'company') {
    return '💡 员工/VP 只能通过裁员、挖角、辞职等行动卡离场';
  }
  return '';
});

const isBadProject = computed(
  () => props.source === 'projects' && props.card?.kind === 'project' && props.card.subtype === 'bad',
);
const burnoutEngTotal = computed(() =>
  (props.burnout?.engineers ?? []).reduce((s, e) => s + e.skill, 0),
);
</script>

<template>
  <div v-if="card && meta" class="modal-overlay" @click.self="emit('close')">
    <div class="modal-card">
      <button type="button" class="modal-close" @click="emit('close')">✕</button>
      <div class="modal-header">
        <div class="modal-icon" :class="`type-${meta.tag.replace('tag-', '')}`">{{ meta.icon }}</div>
        <div>
          <div class="modal-title">{{ card.name }}</div>
          <div class="modal-type">{{ typeLine }}</div>
        </div>
      </div>

      <div class="modal-stats">
        <div v-for="s in stats" :key="s.label" class="modal-stat">
          <div class="s-label">{{ s.label }}</div>
          <div class="s-value" :style="s.color ? { color: s.color } : {}">{{ s.value }}</div>
        </div>
      </div>

      <div v-if="isProject && skill" class="skill-progress" :class="{ done: completable }">
        <div class="sp-row">
          <span>技能进度</span>
          <span><b>{{ skill.current }}</b> / {{ skill.required }}</span>
        </div>
        <div class="sp-track"><div class="sp-fill" :style="{ width: progressPct + '%' }" /></div>
      </div>

      <div class="modal-desc">{{ card.desc }}</div>
      <div v-if="note" class="modal-note">{{ note }}</div>

      <div class="modal-actions">
        <template v-if="source === 'hand'">
          <button
            v-if="isHire"
            type="button"
            class="btn btn-primary"
            :disabled="actionDisabled"
            @click="emit('hire')"
          >👤 招募入职</button>
          <button
            v-else-if="isProject"
            type="button"
            class="btn btn-primary"
            :disabled="actionDisabled"
            @click="emit('project')"
          >📂 安排项目</button>
          <button
            v-else-if="isAction"
            type="button"
            class="btn btn-primary"
            :disabled="actionDisabled"
            @click="emit('action')"
          >⚡ 执行行动</button>
          <button
            v-if="canDiscard"
            type="button"
            class="btn btn-secondary btn-discard"
            @click="emit('discard')"
          >🗑️ 弃牌（本回合 1 次）</button>
          <button type="button" class="btn btn-secondary" @click="emit('close')">关闭</button>
        </template>

        <template v-else-if="source === 'projects'">
          <button
            v-if="completable"
            type="button"
            class="btn btn-primary"
            @click="emit('complete')"
          >✅ 完成项目</button>
          <template v-if="isBadProject">
            <button
              v-if="abandon"
              type="button"
              class="btn btn-danger"
              :disabled="!abandon.can"
              @click="emit('abandon')"
            >🛑 支付 ${{ abandon.cost }}M 止损</button>
            <button
              v-if="burnout"
              type="button"
              class="btn btn-warn"
              :disabled="burnoutEngTotal < burnout.req"
              @click="burnoutOpen = true"
            >🥧 画大饼（需 {{ burnout.req }} 工程师技能）</button>
          </template>
          <button type="button" class="btn btn-secondary" @click="emit('close')">关闭</button>
        </template>

        <template v-else>
          <button type="button" class="btn btn-secondary" @click="emit('close')">关闭</button>
        </template>
      </div>

      <!-- 画大饼：选择牺牲的工程师 -->
      <div v-if="burnoutOpen && burnout" class="burnout-panel">
        <div class="bp-title">🥧 画大饼 · 选择牺牲的工程师</div>
        <div class="bp-sub">工程师技能合计 ≥ <b>{{ burnout.req }}</b>（当前 <b>{{ burnoutSum }}</b>），被选工程师将与烂尾工程一同废弃</div>
        <div class="bp-grid">
          <button
            v-for="e in burnout.engineers"
            :key="e.id"
            type="button"
            class="bp-eng"
            :class="{ on: burnoutSelected.includes(e.id) }"
            @click="toggleBurnoutEngineer(e.id)"
          >
            <span class="bp-name">{{ e.name }}</span>
            <span class="bp-skill">⚙️ {{ e.skill }}</span>
          </button>
        </div>
        <div class="bp-actions">
          <button
            type="button"
            class="btn btn-primary"
            :disabled="!burnoutFeasible"
            @click="confirmBurnout"
          >{{ burnoutFeasible ? `牺牲并废弃（${burnoutSum}/${burnout.req}）` : '技能不足' }}</button>
          <button type="button" class="btn btn-secondary" @click="cancelBurnout">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-icon.type-action   { background: rgba(180,140,255,0.12); }
.modal-icon.type-tech     { background: rgba(80,220,180,0.12); }
.modal-icon.type-staff    { background: rgba(100,180,255,0.12); }
.modal-icon.type-finance  { background: rgba(255,190,80,0.12); }
.modal-icon.type-market   { background: rgba(255,120,80,0.12); }
.modal-icon.type-bad      { background: rgba(255,80,100,0.12); }
.modal-icon.type-consultant { background: rgba(255,140,200,0.12); }

/* 画大饼 engineer picker */
.burnout-panel {
  margin-top: 14px;
  padding: 12px;
  border: 1px dashed rgba(255, 190, 80, 0.45);
  border-radius: 10px;
  background: rgba(255, 190, 80, 0.06);
}
.bp-title { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
.bp-sub { font-size: 12px; color: rgba(255, 255, 255, 0.62); margin-bottom: 10px; }
.bp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 8px;
  max-height: 180px;
  overflow-y: auto;
}
.bp-eng {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 6px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  cursor: pointer;
  color: inherit;
  font-size: 12px;
  transition: border-color 0.15s, background 0.15s;
}
.bp-eng.on {
  border-color: #ffbe50;
  background: rgba(255, 190, 80, 0.16);
}
.bp-skill { color: #ffd632; font-weight: 700; }
.bp-actions { display: flex; gap: 8px; margin-top: 12px; }

.btn-danger {
  background: rgba(255, 80, 100, 0.16);
  color: #ff7a90;
}
.btn-danger:disabled { opacity: 0.45; }
.btn-warn {
  background: rgba(255, 190, 80, 0.14);
  color: #ffbe50;
}
.btn-warn:disabled { opacity: 0.45; }

.btn-discard {
  color: rgba(255, 255, 255, 0.72);
}
</style>
