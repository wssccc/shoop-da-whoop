<script setup lang="ts">
/**
 * App — Burn Rate · 对战控制台（基于 burn-rate.html 新设计，引擎全保留）。
 * 主界面常驻；开局是覆盖其上的弹窗（无独立 start page）。
 *
 *   ┌ top-bar (44px): brand 🔥烧钱计划 · 回合/现金/烧钱/弃牌 · 阶段标签
 *   │                 · 按钮组 🔊静音 📖规则 📜战报 ✕开始菜单
 *   ├ opponent-area: 每个 AI 一个 opp-panel（现金/烧钱/手牌 + 人员/项目缩略卡）
 *   ├ divider-bar:   ◆ VS · 存活 x/y · BATTLEFIELD ◆
 *   ├ player-area:   player-info（统计+部门+我的公司/项目）+ 手牌大卡
 *   └ bottom-bar:    操作提示 + 🎯取消 / 📤提交
 *
 * Overlays: start modal（新游戏/继续 + 可展开设置）、card-modal（手牌操作 /
 * 场上详情 / 对手只读，三合一）、rules、log、new-game confirm、headhunter
 * pick、Finance-VP redraw、target-player choice、result（win/bankrupt-gate/
 * spectate-end）、invalid toast、achievement toasts、status toast。
 *
 * Targeting: 行动卡需要目标时，合法目标缩略卡金色呼吸，点击完成；
 * 底部栏提示 + 取消按钮（沿用引擎 selectTarget/cancelTargeting）。
 */
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useTransition } from '@vueuse/core';
import { AnimatePresence, motion } from 'motion-v';
import Card from '@burnrate/components/Card.vue';
import CardModal from '@burnrate/components/CardModal.vue';
import DiceRollOverlay from '@burnrate/components/DiceRollOverlay.vue';
import LogModal from '@burnrate/components/LogModal.vue';
import OpponentPanel from '@burnrate/components/OpponentPanel.vue';
import PlayerInfoPanel from '@burnrate/components/PlayerInfoPanel.vue';
import ResultOverlay from '@burnrate/components/ResultOverlay.vue';
import StartScreen from '@burnrate/components/StartScreen.vue';
import ThumbCard from '@burnrate/components/ThumbCard.vue';
import { HAND_CAP, HAND_SIZE } from '@burnrate/game/constants';
import { badAbandonCost, burnoutReq, canCompleteProject, canDiscard, canPlayCard, feudFeasible, getSkill, hasVP, projectReward } from '@burnrate/game/rules';
import { sideName } from '@burnrate/game/state';
import type {
    Card as CardModel,
    DiceRollOutcome,
    PlayerId,
    TargetRef,
} from '@burnrate/game/types';
import { useAchievements } from './composables/useAchievements';
import { useAiTurn } from './composables/useAiTurn';
import { useAudio } from './composables/useAudio';
import { useBurnRateGame, type GameSetup } from './composables/useBurnRateGame';
import { useDrawAnimations } from './composables/useDrawAnimations';
import './console.css';

// Wire the singleton audio's visibility-driven auto-resume.
useAudio();

const game = useBurnRateGame();
useAiTurn(game);
const achievements = useAchievements(game);
useDrawAnimations(game);

const s = computed(() => game.state.value);

// Template-facing refs — destructured so the template auto-unwraps them.
const phase = game.phase;
const won = game.won;
const lost = game.lost;
const muted = game.muted;
const hasSave = game.hasSave;
const spectate = game.spectate;
const targeting = game.targeting;
const targetingPickCount = game.targetingPickCount;
const targetingSelected = game.targetingSelected;
const targetingAct = game.targetingAct;
const targetChoices = game.targetChoices;
const pendingPick = game.pendingPick;
const redrawOpen = game.redrawOpen;
const redrawSelected = game.redrawSelected;
const justDealt = game.justDealt;
const animIds = game.animIds;
const invalidMsg = game.invalidMsg;
const burnRates = game.burnRates;
const toasts = achievements.toasts;

// ---- Console shell state ------------------------------------------------
/** 开局弹窗是否打开（主界面常驻在弹窗背后）。 */
const showStartModal = ref(true);
/** 用户是否已真正开局（弹窗首进不可关闭、新游戏需确认的判定依据）。 */
const gameStarted = ref(false);
const showRules = ref(false);
const showLog = ref(false);
const showNewGameConfirm = ref(false);
/** Setup of the running game (for "再来一局" restarts). */
const lastSetup = ref<GameSetup>({ playerCount: 2, difficulties: ['normal'] });
/** Setup pending the "开始新局？" confirm (mid-game restarts). */
const pendingSetup = ref<GameSetup>({ playerCount: 2, difficulties: ['normal'] });
/** Non-null while the opening dice animation plays. The start modal / result
 *  overlay stays open underneath; cancelling just dismisses the roll. */
const diceRoll = ref<{
  setup: GameSetup;
  outcome: DiceRollOutcome;
} | null>(null);
/** 手牌操作弹窗（source='hand'）。 */
const modalCard = ref<CardModel | null>(null);
/** 我的公司/项目详情弹窗。 */
const detailCard = ref<CardModel | null>(null);
const detailIndex = ref(0);
const detailZone = ref<'company' | 'projects'>('company');
/** 对手场上卡只读弹窗。 */
const oppCard = ref<CardModel | null>(null);
const oppOwner = ref('');

// ---- 1024x768 画布等比缩放 -------------------------------------------
const scale = ref(1);
function updateScale(): void {
  scale.value = Math.min(1, window.innerWidth / 1024, window.innerHeight / 768);
}
onMounted(() => {
  updateScale();
  window.addEventListener('resize', updateScale);
});
onUnmounted(() => window.removeEventListener('resize', updateScale));

// ---- Status / phase ------------------------------------------------------
const statusMsg = computed(() => {
  const log = s.value.log;
  return log.length ? log[0].msg : '烧钱计划 · 对战控制台';
});

const isAiTurn = computed(() => typeof phase.value === 'number' && phase.value > 0);

const phaseLabel = computed(() => {
  if (phase.value === 'over') return won.value ? '你获胜 🏆' : '对局结束';
  if (phase.value === 0) return '● 你的回合';
  return `○ ${sideName(phase.value)} 思考中`;
});

const phaseTagClass = computed(() => {
  if (phase.value === 'over') return 'phase-tag over';
  return isAiTurn.value ? 'phase-tag ai-turn' : 'phase-tag';
});

const isPlayerTurn = computed(() => phase.value === 0 && !s.value.gameOver);

const playerCashShown = useTransition(
  () => s.value.players[0]?.cash ?? 0,
  { duration: 500 },
);

/** Display name of the AI currently acting (empty when it's not an AI turn). */
const currentAiName = computed(() =>
  isAiTurn.value ? sideName(phase.value as PlayerId) : '',
);

const aiThinkingSuffix = computed(() =>
  game.aiThinking.value ? ' 🤔（MCTS 思考中…）' : '',
);

const handHint = computed(() => {
  if (targeting.value) return '🎯 请点击金色高亮的目标完成行动';
  if (isAiTurn.value) return '🤖 AI 回合中…';
  if (phase.value === 'over') return '';
  return '点击手牌查看详情并处理 · 可直接提交进入下一轮';
});

const canEndTurn = computed(
  () =>
    isPlayerTurn.value &&
    !targeting.value &&
    !pendingPick.value &&
    !redrawOpen.value &&
    !justDealt.value,
);

const submitDisabled = computed(() => !canEndTurn.value);
const submitLabel = computed(() => {
  if (isAiTurn.value) return '⏳ AI 回合中…';
  return '📤 提交进入下一轮';
});

const aliveCount = computed(() => {
  const alive = s.value.players.filter((p) => p.alive).length;
  return s.value.gameOver ? 0 : alive;
});
const totalCount = computed(() => s.value.players.length);

/** The AI slots (players 1..n-1) for the opponent grid. The existence check
 *  guards a transient state swap (e.g. re-opening with fewer players) where
 *  a stale index could otherwise render `s.players[a]` as undefined. */
const ais = computed(() =>
  s.value.players.map((_, id) => id).filter((id) => id !== 0 && s.value.players[id]),
);

const AVATAR_ICONS = ['🤖', '👾', '👽', '💀', '🎃'];
const AVATAR_COLORS = ['#B48CFF', '#FF7A90', '#50DCB4', '#FFB454', '#64B4FF'];

function avatarIcon(id: number): string {
  return AVATAR_ICONS[id % AVATAR_ICONS.length];
}
function avatarColor(id: number): string {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

// ---- Targeting helpers ---------------------------------------------------
function zoneClick(ref: TargetRef): void {
  if (targeting.value) game.selectTarget(ref);
}

/** 我的公司/项目缩略卡（手牌区）：targeting 时选目标，否则打开详情。 */
const me = computed(() => s.value.players[0]);
function isBoardTarget(zone: 'company' | 'projects', index: number): boolean {
  const t = targeting.value;
  if (!t) return false;
  return t.some((r) => r.player === 0 && r.zone === zone && r.index === index);
}
function boardThumbClick(card: CardModel, zone: 'company' | 'projects', index: number): void {
  if (isBoardTarget(zone, index)) zoneClick({ player: 0, zone, index });
  else openDetail(card, zone, index);
}

// ---- 手牌处理弹窗 --------------------------------------------------------
function openHandCard(card: CardModel): void {
  if (!isPlayerTurn.value || targeting.value || pendingPick.value || redrawOpen.value) return;
  modalCard.value = card;
}

const actionDisabled = computed(() => {
  const c = modalCard.value;
  if (!c || !isPlayerTurn.value) return true;
  return !canPlayCard(s.value, 0, c);
});

/** 是否拥有 Finance VP（决定提交确认界面可否弃牌重抽）。 */
const hasFinVp = computed(() => hasVP(s.value, 0, 'fin'));
function playReason(card: CardModel): string {
  if (card.kind === 'vp') return '该部门已有 VP，无法重复聘请';
  if (card.kind === 'project') {
    return '项目启动无 VP 门槛，可随时启动'; // canPlayCard is now always true
  }
  if (card.kind === 'action') {
    switch (card.act) {
      case 'layoff':
        return '需要 HR VP 支持才能裁员（解雇自己的员工/VP/顾问）';
      case 'release':
        return '需要 Eng/Sales VP，且有项目可废弃';
      case 'poach':
        return '需先挖掉对方的 HR VP（$4M）；现金不足或该部门已有 VP 时无法挖角';
      case 'resign':
        return '需先辞掉对方的 HR VP，或没有可辞退的员工/VP';
      case 'consultant':
        return '没有可塞顾问的对手';
      case 'audit':
        return '所有对手都有 Finance VP 免疫';
      case 'headhunter':
        return '牌堆/弃牌堆已无可用目标';
    }
  }
  return '当前无法执行此操作';
}
const actionReason = computed(() => {
  const c = modalCard.value;
  if (!c || !actionDisabled.value) return '';
  return playReason(c);
});

function doHire(): void {
  const c = modalCard.value;
  if (c) game.playCard(c);
  modalCard.value = null;
}
function doProject(): void {
  const c = modalCard.value;
  if (c) game.playCard(c);
  modalCard.value = null;
}
function doAction(): void {
  const c = modalCard.value;
  if (c) game.playCard(c);
  modalCard.value = null;
}
function doDiscard(): void {
  const c = modalCard.value;
  if (c) game.discardCard(c.id);
  modalCard.value = null;
}
/** 免费弃牌（house rule）：每回合 1 次，无补偿。 */
const canFreeDiscard = computed(() => isPlayerTurn.value && canDiscard(s.value, 0));

// ---- 我的公司/项目详情弹窗 ----------------------------------------------
function openDetail(card: CardModel, zone: 'company' | 'projects', index: number): void {
  if (targeting.value) return;
  detailCard.value = card;
  detailIndex.value = index;
  detailZone.value = zone;
}
function detailCompletable(): boolean {
  const c = detailCard.value;
  if (!c || c.kind !== 'project') return false;
  return canCompleteProject(s.value, 0, c).ok;
}
const detailSkill = computed(() => {
  const c = detailCard.value;
  if (!c || c.kind !== 'project') return null;
  const role = c.subtype === 'market' ? 'mkt' : 'eng';
  return { current: getSkill(s.value, 0, role), required: c.reqSkill };
});
function completeFromDetail(): void {
  const i = detailIndex.value;
  detailCard.value = null;
  game.completeProject(i);
}

/** 详情弹窗：完成项目实际可得奖励（含对应 VP 的 +50% 加成）。 */
const detailReward = computed(() => {
  const c = detailCard.value;
  if (!c || c.kind !== 'project') return null;
  return projectReward(s.value, 0, c);
});

// ---- 坏项目自救（house rules） ----------------------------------------
/** 现金止损阀：支付 2×burn 废弃自己的烂尾项目。 */
const detailAbandon = computed(() => {
  const c = detailCard.value;
  if (!c || c.kind !== 'project' || c.subtype !== 'bad' || !isPlayerTurn.value) return null;
  const cost = badAbandonCost(c);
  return { cost, can: (s.value.players[0]?.cash ?? 0) >= cost };
});
/** 画大饼：牺牲工程师（财务技能打折后的需求点数）。 */
const detailBurnout = computed(() => {
  const c = detailCard.value;
  if (!c || c.kind !== 'project' || c.subtype !== 'bad' || !isPlayerTurn.value) return null;
  const st = s.value;
  const engineers = st.players[0].company
    .filter((x): x is Extract<CardModel, { kind: 'staff' }> => x.kind === 'staff' && x.role === 'eng')
    .map((x) => ({ id: x.id, name: x.name, skill: x.skill }));
  return { req: burnoutReq(st, 0, c), engineers };
});
function doAbandon(): void {
  const c = detailCard.value;
  if (c) game.abandonProject(c.id);
  detailCard.value = null;
}
function doBurnout(engineerIds: string[]): void {
  const c = detailCard.value;
  if (c) game.burnoutProject(c.id, engineerIds);
  detailCard.value = null;
}

// ---- 手牌上限（house rule） -------------------------------------------
const overCap = computed(() => (s.value.players[0]?.hand.length ?? 0) > HAND_CAP);
const canRedraw = computed(() => hasFinVp.value || overCap.value);

// ---- 高层内斗（house rule）：裁员清顾问，无需 HR VP ---------------------
const canFeud = computed(() => isPlayerTurn.value && feudFeasible(s.value, 0));

// ---- 对手只读详情 --------------------------------------------------------
function openOppCard(card: CardModel, _zone: 'company' | 'projects', _index: number): void {
  oppCard.value = card;
  oppOwner.value = 'AI';
}

// ---- Start / exit --------------------------------------------------------
function beginDice(setup: GameSetup): void {
  // Pre-roll with the engine's RNG: the animation plays out to a known
  // result, so skipping it never changes who goes first.
  diceRoll.value = { setup, outcome: game.rollFirst(setup.playerCount) };
}
function startGame(setup: GameSetup): void {
  lastSetup.value = setup;
  // Mid-game restarts go through the "开始新局？" confirm; fresh boots and
  // finished games just roll (nothing of value is lost).
  if (gameStarted.value && !s.value.gameOver) {
    pendingSetup.value = setup;
    showNewGameConfirm.value = true;
    return;
  }
  beginDice(setup);
}
function continueSaved(): void {
  gameStarted.value = true;
  showStartModal.value = false;
  game.continueSaved();
}
function backToMenu(): void {
  showStartModal.value = true;
  modalCard.value = null;
  detailCard.value = null;
  oppCard.value = null;
}
function confirmNewGame(): void {
  showNewGameConfirm.value = false;
  beginDice(pendingSetup.value);
}
function onDiceDone(winner: PlayerId): void {
  const d = diceRoll.value;
  diceRoll.value = null;
  if (!d) return;
  gameStarted.value = true;
  showStartModal.value = false;
  game.newGame(d.setup, winner);
  showToast(`🎲 先手：${sideName(winner)}`);
}
function onDiceCancel(): void {
  // The start modal / result overlay stays put — just dismiss the roll.
  diceRoll.value = null;
}

// ---- Toast ----------------------------------------------------------------
let toastTimer: ReturnType<typeof setTimeout> | null = null;
const toastMsg = ref('');
const toastShow = ref(false);
function showToast(msg: string): void {
  toastMsg.value = msg;
  toastShow.value = true;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastShow.value = false; }, 2200);
}

// 回合切换 / 破产等关键节点播报
watch(
  () => s.value.turn,
  (t, prev) => {
    // Skip the very first round and any turn reset (a restarted game goes
    // backwards — the dice overlay already announced the new starter).
    if (prev === undefined || t === prev || t < prev) return;
    if (phase.value === 0) showToast(`第 ${s.value.turn} 轮，你的回合`);
    else if (typeof phase.value === 'number') showToast(`${sideName(phase.value)} 的回合`);
  },
);
watch(
  () => s.value.players.map((p) => (p ? p.alive : false)).join(''),
  (alive, prev) => {
    if (prev === undefined || alive === prev) return;
    const deadIdx = s.value.players.findIndex((p) => p && !p.alive);
    if (deadIdx >= 0) showToast(`💀 ${sideName(deadIdx)} 破产了！`);
  },
);

// ---- 手牌项目技能进度 ----------------------------------------------------
function handSkill(c: CardModel): { current: number; required: number } | null {
  if (c.kind !== 'project') return null;
  const role = c.subtype === 'market' ? 'mkt' : 'eng';
  return { current: getSkill(s.value, 0, role), required: c.reqSkill };
}

/** 项目是否可收钱（技能攒够 + 有对应 VP + 奖励 > 0）→ 缩略卡背光。 */
function boardCompletable(c: CardModel): boolean {
  if (c.kind !== 'project') return false;
  return c.reward > 0 && canCompleteProject(s.value, 0, c).ok;
}

// ---- Result mode ----------------------------------------------------------
const resultMode = computed<'win' | 'bankrupt-gate' | 'spectate-end' | 'game-over' | null>(() => {
  if (phase.value === 'over') {
    if (won.value) return 'win';
    return spectate.value ? 'spectate-end' : 'game-over';
  }
  if (lost.value && !spectate.value && !s.value.gameOver) return 'bankrupt-gate';
  return null;
});
</script>

<template>
  <StartScreen
    v-if="showStartModal"
    :has-save="hasSave"
    :closable="gameStarted"
    @start="startGame"
    @continue="continueSaved"
    @close="showStartModal = false"
  />

  <div class="game-stage">
    <div class="game-fit" :style="{ width: 1024 * scale + 'px', height: 768 * scale + 'px' }">
      <div class="game-wrapper" :style="{ transform: 'scale(' + scale + ')' }">

        <!-- ===== 顶部信息栏 ===== -->
        <div class="top-bar">
          <div class="brand">
            <div class="brand-icon">🔥</div>
            <div class="brand-name">烧钱计划</div>
            <span v-if="spectate" class="spectate-badge">观战模式</span>
          </div>
          <div class="status-group">
            <div class="status-item">回合 <span class="value" id="round-num">{{ s.turn }}</span></div>
            <div class="status-item">现金 <span class="value cash" id="player-cash">${{ Math.round(playerCashShown) }}M</span></div>
            <div class="status-item">烧钱 <span class="value burn" id="player-burn">${{ burnRates[0] ?? 0 }}M</span></div>
            <div class="status-item">弃牌 <span class="value" id="discard-count">{{ s.discard.length }}</span></div>
            <div class="status-item">
              <span class="phase-tag" :class="phaseTagClass" id="phase-tag">
                <template v-if="isAiTurn">{{ currentAiName }} 思考中{{ aiThinkingSuffix }}</template>
                <template v-else>{{ phaseLabel }}</template>
              </span>
            </div>
          </div>
          <div class="top-actions">
            <button class="icon-btn" :title="muted ? '取消静音' : '静音'" @click="game.toggleMute()">
              {{ muted ? '🔇' : '🔊' }}
            </button>
            <button class="icon-btn" title="游戏规则" @click="showRules = true">📖</button>
            <button class="icon-btn" title="战报" @click="showLog = true">📜</button>
            <button class="icon-btn" title="开始菜单" @click="backToMenu">✕</button>
          </div>
        </div>

        <!-- ===== 对手区 ===== -->
        <div class="opponent-area" id="opponent-area">
          <div class="opp-grid">
            <OpponentPanel
              v-for="a in ais"
              :key="a"
              :game="game"
              :player-id="a"
              :player="s.players[a]"
              :name="sideName(a)"
              :icon="avatarIcon(a)"
              :color="avatarColor(a)"
              :is-turn="phase === a && !s.gameOver"
              :is-dead="!s.players[a]?.alive"
              @target="zoneClick"
              @open-card="openOppCard"
            />
          </div>
        </div>

        <!-- ===== 分隔区 ===== -->
        <div class="divider-bar">
          <div class="divider-label">VS</div>
          <div class="vs-badge" id="alive-count">存活 {{ aliveCount }}/{{ totalCount }}</div>
          <div class="divider-label">BATTLEFIELD</div>
        </div>

        <!-- ===== 玩家区 ===== -->
        <div class="player-area">
          <PlayerInfoPanel :game="game" />
          <div class="hand-area">
            <div class="hand-header">
              <span class="h-title">🃏 手牌</span>
              <span class="h-count" id="hand-count">{{ s.players[0]?.hand.length ?? 0 }}/{{ HAND_SIZE }} 张</span>
            </div>
            <div class="hand-cards" id="hand-cards">
              <Card
                v-for="c in s.players[0]?.hand ?? []"
                :key="c.id"
                :card="c"
                :no-layout="animIds.includes(c.id) || justDealt"
                :clickable="isPlayerTurn && !targeting"
                :disabled="isAiTurn || !!targeting"
                :hover-lift="isPlayerTurn && !targeting"
                :skill-progress="handSkill(c)"
                @click="openHandCard(c)"
              />
            </div>
            <div class="hand-board" id="hand-board">
              <div class="hand-section-title">🏢 我的公司 {{ me?.company.length ?? 0 }}</div>
              <div class="thumb-row">
                <ThumbCard
                  v-for="(c, i) in me?.company ?? []"
                  :key="c.id"
                  :card="c"
                  :target="isBoardTarget('company', i)"
                  @click="boardThumbClick(c, 'company', i)"
                />
              </div>
              <div class="hand-section-title">📋 我的项目 {{ me?.projects.length ?? 0 }}</div>
              <div class="thumb-row">
                <ThumbCard
                  v-for="(c, i) in me?.projects ?? []"
                  :key="c.id"
                  :card="c"
                  :skill-progress="handSkill(c)"
                  :completable="boardCompletable(c)"
                  :target="isBoardTarget('projects', i)"
                  @click="boardThumbClick(c, 'projects', i)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- ===== 底部操作栏 ===== -->
        <div class="bottom-bar">
          <div class="hint">
            <span v-if="targeting" class="target-hint">
              🎯 {{ targetingAct === 'layoffFeud'
                ? `高层内斗：选 1 个 VP + 1 个顾问（已选 ${targetingSelected.length}/2）`
                : targetingPickCount > 1
                  ? `请选择 ${targetingPickCount} 个目标（已选 ${targetingSelected.length}）`
                  : '请选择高亮目标完成行动' }}
            </span>
            <span v-else-if="isAiTurn">🤖 {{ currentAiName }} 行动中{{ aiThinkingSuffix }} · 每一步都会记录到「📜 战报」</span>
            <span v-else>{{ handHint }}</span>
            <span class="highlight" style="margin-left: 10px;">{{ statusMsg }}</span>
          </div>
          <div class="actions">
            <button
              v-if="targeting && targetingAct === 'layoff' && canFeud"
              type="button"
              class="btn btn-warn"
              @click="game.startFeudLayoff()"
            >🔁 高层内斗（VP+顾问同归于尽）</button>
            <button
              v-if="targeting"
              type="button"
              class="btn btn-danger"
              @click="game.cancelTargeting()"
            >✕ 取消</button>
            <button
              type="button"
              class="btn btn-primary"
              id="btn-submit"
              :disabled="submitDisabled"
              @click="game.askEndTurn()"
            >{{ submitLabel }}</button>
          </div>
        </div>

        <!-- ===== 提示条 ===== -->
        <div class="toast-bar" :class="{ show: toastShow }" id="toast-bar">{{ toastMsg }}</div>

        <!-- ===== 卡牌弹窗（手牌操作 / 我的场上详情 / 对手只读） ===== -->
        <CardModal
          v-if="modalCard"
          :card="modalCard"
          source="hand"
          :action-disabled="actionDisabled"
          :action-reason="actionReason"
          :can-discard="canFreeDiscard"
          @close="modalCard = null"
          @hire="doHire"
          @project="doProject"
          @action="doAction"
          @discard="doDiscard"
        />
        <CardModal
          v-else-if="detailCard"
          :card="detailCard"
          :source="detailZone"
          :completable="detailCompletable()"
          :skill="detailSkill"
          :effective-reward="detailReward"
          :abandon="detailAbandon"
          :burnout="detailBurnout"
          @close="detailCard = null"
          @complete="completeFromDetail"
          @abandon="doAbandon"
          @burnout="doBurnout"
        />
        <CardModal
          v-else-if="oppCard"
          :card="oppCard"
          source="opp"
          :owner="oppOwner"
          @close="oppCard = null"
        />

        <!-- ===== 战报弹窗 ===== -->
        <LogModal :game="game" :open="showLog" @close="showLog = false" />

        <!-- ===== 规则弹窗 ===== -->
        <div v-if="showRules" class="modal-overlay" @click.self="showRules = false">
          <div class="modal-card" style="width: 540px;">
            <button type="button" class="modal-close" @click="showRules = false">✕</button>
            <div class="modal-header">
              <div class="modal-icon" style="background: rgba(255,180,84,0.12);">📖</div>
              <div>
                <div class="modal-title">游戏规则</div>
                <div class="modal-type">{{ totalCount }} 人局 · 最后存活者获胜</div>
              </div>
            </div>
            <div class="modal-scroll">
              <h3 class="modal-h">🎯 目标</h3>
              <p>让所有对手现金 ≤ $0 破产，成为最后存活的赢家。</p>
              <h3 class="modal-h">💰 初始</h3>
              <p>每人各 $100M 与 6 张手牌（每轮补回 6 张）。</p>
              <h3 class="modal-h">🔄 回合流程</h3>
              <p>1. 补牌到 6 张（现金最低者补 7 张）· 2. 出牌：雇佣 VP/员工、启动项目、行动卡，张数不限（每回合可免费弃 1 张手牌）· 3. 结算烧钱 = 薪水 + 未完成项目运维费 + 固定开销（$2M 下限；仅剩 2 人时 +$2M 市场恐慌）· 4. 现金 ≤ 0 触发一次紧急融资（$10M + 财务技能×2），再破产才出局</p>
              <h3 class="modal-h">🃏 卡牌</h3>
              <p><b style="color:#FFBE50">VP</b>（黄）：每部门最多 1 位，$4M/轮——HR 裁员/挡箭牌（被挖被辞先倒下）、FIN 弃牌重抽/免疫审计、SALES 市场项目奖励+50%并可变现、ENG 技术项目烧钱减半+奖励+50%</p>
              <p><b style="color:#64B4FF">员工</b>（蓝）：提供技能，薪水 = 技能等级</p>
              <p><b style="color:#50DCB4">技术 / 市场项目</b>（绿/橙）：无需 VP 即可启动，技能攒够自动完成；有对应 VP 时完成奖励 +50%；市场项目需 Sales VP 在场才能变现领现金</p>
              <p><b style="color:#FF5064">烂尾工程</b>（红）：塞给对手的巨额烧钱炸弹，极难完成——可支付 2×烧钱止损，或用<b>画大饼</b>牺牲工程师（财务技能降低所需点数）</p>
              <p><b style="color:#B48CFF">行动</b>（紫）：裁员（HR VP；也可用<b>高层内斗</b>：1 VP+1 顾问同归于尽，无需 HR VP）、挖角（花现金，HR VP 需先倒下）、高价顾问、猎头、项目重组、财务审计、强制辞职（HR VP 需先倒下）</p>
              <h3 class="modal-h">💡 提示</h3>
              <p>项目启动无 VP 门槛（任意玩家可直接启动技术/市场项目）；完成只看技能点（攒够即自动完成）；市场项目需 Sales VP 在场才能变现；被审计时薪水翻倍（有 Finance VP 免疫）；烂尾项目可用项目重组废弃；多对手时审计/顾问/烂尾项目需要选择目标玩家。</p>
              <p><b style="color:#FF8CC8">顾问</b>：高价顾问不提供技能，只索要高额薪水，且免疫挖角/辞职 —— 只能靠 <b>HR VP + 裁员</b> 从自己公司清除。</p>
              <h3 class="modal-h">🧾 新规则（可玩性优化）</h3>
              <p>1. <b>落后补牌</b>：现金全场唯一最低者，每轮补牌多 1 张。<br>2. <b>紧急融资</b>：每人每场一次，现金首次 ≤ 0 回到 $10M + 财务技能×$2M。<br>3. <b>固定开销</b>：每轮至少烧 $2M；仅剩 2 人时额外 +$2M。<br>4. <b>手牌上限</b>：回合结束最多留 8 张。<br>5. <b>烂尾自救</b>：付 2×烧钱直接废弃；或画大饼（牺牲工程师，财务技能打折）。<br>6. <b>通用弃牌</b>：每回合可免费弃 1 张手牌（弃牌堆，无补偿）——重复 VP 等死卡有出口。<br>7. <b>项目无 VP 门槛</b>：技术/市场项目无需 VP 即可启动；Eng VP 让技术项目烧钱减半，对应 VP 让完成奖励 +50%。</p>
            </div>
            <div class="modal-actions" style="margin-top: 12px;">
              <button type="button" class="btn btn-primary" @click="showRules = false">知道了</button>
            </div>
          </div>
        </div>

        <!-- ===== 新局确认（Teleport 到 body：脱离 .game-wrapper 的 transform
             层叠上下文，否则会被开局弹窗 z-250 遮住） ===== -->
        <Teleport to="body">
          <div v-if="showNewGameConfirm" class="modal-overlay" style="position: fixed; z-index: 310;">
            <div class="modal-card" style="width: 380px;">
              <button type="button" class="modal-close" @click="showNewGameConfirm = false">✕</button>
              <div class="modal-header">
                <div class="modal-icon" style="background: rgba(255,80,100,0.12);">⟳</div>
                <div>
                  <div class="modal-title">开始新局？</div>
                  <div class="modal-type">当前对局将作废</div>
                </div>
              </div>
              <p style="margin: 0 0 14px;">确定重开吗？</p>
              <div class="modal-actions">
                <button type="button" class="btn btn-primary" @click="confirmNewGame">确定重开</button>
                <button type="button" class="btn btn-secondary" @click="showNewGameConfirm = false">取消</button>
              </div>
            </div>
          </div>
        </Teleport>

        <!-- ===== 猎头选择 ===== -->
        <div v-if="pendingPick" class="modal-overlay">
          <div class="modal-card">
            <button type="button" class="modal-close" @click="game.cancelTargeting()">✕</button>
            <div class="modal-header">
              <div class="modal-icon" style="background: rgba(180,140,255,0.12);">🎯</div>
              <div>
                <div class="modal-title">猎头：定向搜寻</div>
                <div class="modal-type">从抽牌堆/弃牌堆定向招募 VP 或员工</div>
              </div>
            </div>
            <div class="modal-scroll">
              <p>直接加入手牌（灰色为已绝版）</p>
              <div class="hh-grid">
                <button
                  v-for="ch in pendingPick"
                  :key="ch.key"
                  type="button"
                  class="hh-choice"
                  :class="{ off: ch.available === 0 }"
                  :disabled="ch.available === 0"
                  @click="game.pickHeadhunter(ch.key)"
                >
                  <span class="hh-name">{{ ch.label }}</span>
                  <span class="hh-avail">{{ ch.available === 0 ? '已绝版' : `剩 ${ch.available} 张` }}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- ===== 提交确认 / Finance VP 弃牌重抽 ===== -->
        <div v-if="redrawOpen" class="modal-overlay">
          <div class="modal-card" style="width: 520px;">
            <button type="button" class="modal-close" @click="game.cancelRedraw()">✕</button>
            <div class="modal-header">
              <div class="modal-icon" style="background: rgba(255,190,80,0.12);">📤</div>
              <div>
                <div class="modal-title">提交确认</div>
                <div class="modal-type">结束本回合，进入烧钱结算</div>
              </div>
            </div>
            <div class="modal-scroll">
              <p style="margin-top: 0;">
                <template v-if="overCap">
                  ⚠️ 手牌超过 <b>8</b> 张，结束回合前须弃至 8（点选要弃的牌，其余超限部分自动弃最低价值）。
                  <template v-if="redrawSelected.length">已选 <b>{{ redrawSelected.length }}</b> 张。</template>
                </template>
                <template v-else-if="hasFinVp">
                  🟡 Finance VP 特权：可弃掉手牌，每弃 1 张重抽 1 张。
                  <template v-if="redrawSelected.length">当前将弃 <b>{{ redrawSelected.length }}</b> 张并重抽 <b>{{ redrawSelected.length }}</b> 张。</template>
                </template>
                <template v-else>⚪ 需要 <b>Finance VP</b> 才能弃牌重抽（当前只能确认结束或取消）。</template>
              </p>
              <div class="redraw-grid">
                <Card
                  v-for="c in s.players[0]?.hand ?? []"
                  :key="c.id"
                  :card="c"
                  :selected="redrawSelected.includes(c.id)"
                  :hover-lift="canRedraw"
                  :clickable="canRedraw"
                  :disabled="!canRedraw"
                  @click="game.toggleRedraw(c.id)"
                />
              </div>
            </div>
            <div class="modal-actions" style="margin-top: 12px;">
              <button type="button" class="btn btn-primary" @click="game.confirmRedraw()">
                {{ overCap ? '弃牌并结束回合' : redrawSelected.length ? `弃 ${redrawSelected.length} 张并结束回合` : '确认结束回合' }}
              </button>
              <button type="button" class="btn btn-secondary" @click="game.cancelRedraw()">取消提交</button>
            </div>
          </div>
        </div>

        <!-- ===== 选择目标玩家（审计/顾问/烂尾） ===== -->
        <AnimatePresence>
          <motion.div
            v-if="targetChoices && targeting"
            class="modal-overlay"
            :initial="{ opacity: 0 }"
            :animate="{ opacity: 1 }"
            :exit="{ opacity: 0 }"
          >
            <motion.div
              class="modal-card"
              style="width: 380px;"
              :initial="{ scale: 0.9, opacity: 0 }"
              :animate="{ scale: 1, opacity: 1 }"
              :exit="{ scale: 0.95, opacity: 0 }"
              :transition="{ type: 'spring', stiffness: 240, damping: 22 }"
            >
              <button type="button" class="modal-close" @click="game.cancelTargeting()">✕</button>
              <div class="modal-header">
                <div class="modal-icon" style="background: rgba(255,214,50,0.12);">🎯</div>
                <div>
                  <div class="modal-title">选择目标玩家</div>
                  <div class="modal-type">按现金从低到高排列</div>
                </div>
              </div>
              <p style="margin-top: 0;">选择要作用的对手：</p>
              <div class="player-choice-list">
                <button
                  v-for="(p, i) in targetChoices"
                  :key="p"
                  type="button"
                  class="player-choice"
                  @click="game.selectTarget(targeting[i])"
                >
                  <span class="player-choice-name">🤖 {{ sideName(p) }}</span>
                  <span class="player-choice-cash">${{ s.players[p]?.cash ?? 0 }}M</span>
                </button>
              </div>
            </motion.div>
          </motion.div>
        </AnimatePresence>

        <!-- ===== 结算 / 观战门 ===== -->
        <ResultOverlay
          v-if="resultMode"
          :game="game"
          :mode="resultMode"
          @new-game="beginDice(lastSetup)"
          @back-menu="backToMenu"
        />

        <!-- ===== Invalid-action toast ===== -->
        <AnimatePresence>
          <motion.div
            v-if="invalidMsg"
            class="invalid-toast"
            :initial="{ opacity: 0, y: -14 }"
            :animate="{ opacity: 1, y: 0 }"
            :exit="{ opacity: 0, y: -10 }"
            :transition="{ duration: 0.18 }"
          >⚠️ {{ invalidMsg }}</motion.div>
        </AnimatePresence>

        <!-- ===== Achievement toasts ===== -->
        <div class="toaster">
          <AnimatePresence>
            <motion.div
              v-for="t in toasts"
              :key="t.key"
              class="toast"
              :initial="{ opacity: 0, y: -22, scale: 0.92 }"
              :animate="{ opacity: 1, y: 0, scale: 1 }"
              :exit="{ opacity: 0, y: -18, scale: 0.94 }"
              :transition="{ type: 'spring', stiffness: 260, damping: 22 }"
            >
              <span class="toast-icon">{{ t.achievement.icon }}</span>
              <div>
                <div class="toast-title">成就解锁：{{ t.achievement.name }}</div>
                <div class="toast-desc">{{ t.achievement.desc }}</div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== 开局掷骰定先手 ===== -->
  <DiceRollOverlay
    v-if="diceRoll"
    :outcome="diceRoll.outcome"
    @done="onDiceDone"
    @cancel="onDiceCancel"
  />
</template>
