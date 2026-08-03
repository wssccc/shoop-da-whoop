<script setup lang="ts">
/**
 * StartModal — 开局弹窗，覆盖在常驻的主界面上（不再有独立的 start page）。
 * 主体只有两个动作：🕹️ 继续游戏（有存档时）与 🔥 新游戏。
 * 人数/强度收纳在可展开的 ⚙ 设置面板里：首次进入自动展开一次引导发现，
 * 之后记住用户上次的展开/收起状态与选择（localStorage，跨会话保留）。
 *
 * Props:
 *  - hasSave  有可继续的存档（显示「继续上次对局」+ 覆盖提示）
 *  - closable 是否允许关闭（游戏已开局时为 true；关闭即返回对局。
 *             首次进入/有待决存档时不可关闭，必须二选一）
 * Emits:
 *  - start(setup)   以当前设置开新局（App 决定是否先确认）
 *  - continue       恢复存档
 *  - close          关闭弹窗（仅 closable 时触发）
 */
import { reactive, watch } from 'vue';
import type { AiDifficulty } from '@burnrate/game/types';
import type { GameSetup } from '@burnrate/composables/useBurnRateGame';

const props = defineProps<{ hasSave: boolean; closable: boolean }>();

const emit = defineEmits<{
  (e: 'start', setup: GameSetup): void;
  (e: 'continue'): void;
  (e: 'close'): void;
}>();

// ---- 开局设置（localStorage 持久化） ------------------------------------

const STORAGE_KEY = 'burnrate.settings';
const AI_DIFFS: readonly AiDifficulty[] = ['easy', 'normal', 'hard', 'expert'];
const DIFF_META: Record<AiDifficulty, { label: string; hint: string }> = {
  easy: { label: '简单', hint: '随机决策' },
  normal: { label: '普通', hint: '启发式策略' },
  hard: { label: '困难', hint: 'MCTS 深度搜索' },
  expert: { label: '专家', hint: 'MCTS 更大预算' },
};

interface StartSettings {
  playerCount: number;
  difficulty: AiDifficulty;
  /** 设置面板展开态。首次（无存储记录）默认展开一次以引导发现。 */
  settingsOpen: boolean;
}

function loadSettings(): StartSettings {
  const fallback: StartSettings = { playerCount: 2, difficulty: 'normal', settingsOpen: true };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const d = JSON.parse(raw) as Record<string, unknown>;
    return {
      playerCount:
        typeof d.playerCount === 'number' && d.playerCount >= 2 && d.playerCount <= 5
          ? d.playerCount
          : fallback.playerCount,
      difficulty: AI_DIFFS.includes(d.difficulty as AiDifficulty)
        ? (d.difficulty as AiDifficulty)
        : fallback.difficulty,
      settingsOpen: typeof d.settingsOpen === 'boolean' ? d.settingsOpen : fallback.settingsOpen,
    };
  } catch {
    return fallback;
  }
}

const settings = reactive<StartSettings>(loadSettings());
watch(settings, (v) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    // quota / private mode — ignore.
  }
});

// ---- Actions --------------------------------------------------------------

function makeSetup(): GameSetup {
  const n = settings.playerCount;
  return {
    playerCount: n,
    difficulties: Array.from({ length: n - 1 }, () => settings.difficulty),
  };
}

function start(): void {
  emit('start', makeSetup());
}

/** 遮罩点击：仅在已开局（可安全返回对局）时允许关闭弹窗。 */
function onBackdrop(): void {
  if (props.closable) emit('close');
}
</script>

<template>
  <div class="full-overlay" @click.self="onBackdrop">
    <div class="start-card">
      <button v-if="closable" type="button" class="modal-close" @click="emit('close')">✕</button>
      <div class="start-icon">🔥</div>
      <h2>烧钱计划</h2>
      <div class="start-sub">卡牌对战 · Burn Rate</div>

      <div class="start-actions">
        <button type="button" class="action-btn start-btn" @click="start">
          <span class="action-icon">🔥</span>
          <span class="action-label">新游戏</span>
        </button>
        <button
          v-if="hasSave"
          type="button"
          class="action-btn continue-btn"
          @click="emit('continue')"
        >
          <span class="action-icon">🕹️</span>
          <span class="action-label">继续游戏</span>
        </button>
      </div>

      <!-- 可展开设置：人数 + 强度（v-show + CSS 过渡，避免弹窗快速开关时
           AnimatePresence exit 节点残留拦截点击） -->
      <button
        type="button"
        class="settings-toggle"
        :aria-expanded="settings.settingsOpen"
        @click="settings.settingsOpen = !settings.settingsOpen"
      >
        <span>⚙ 设置</span>
        <span class="chevron" :class="{ open: settings.settingsOpen }">▾</span>
      </button>
      <div
        v-show="settings.settingsOpen"
        class="settings-panel"
        :class="{ open: settings.settingsOpen }"
      >
        <div class="settings-inner">
          <div class="start-label">玩家人数（{{ settings.playerCount }} 人局）</div>
          <div class="player-select">
            <div
              v-for="n in [2, 3, 4, 5]"
              :key="n"
              class="p-opt"
              :class="{ selected: settings.playerCount === n }"
              @click="settings.playerCount = n"
            >{{ n }}</div>
          </div>
          <div class="start-label">AI 强度（{{ settings.playerCount - 1 }} 位 AI 统一配置）</div>
          <div class="diff-select">
            <button
              v-for="opt in AI_DIFFS"
              :key="opt"
              type="button"
              class="diff-opt"
              :class="{ selected: settings.difficulty === opt }"
              :title="DIFF_META[opt].hint"
              @click="settings.difficulty = opt"
            >{{ DIFF_META[opt].label }}</button>
          </div>
        </div>
      </div>

      <p v-if="hasSave" class="start-hint">💡 新局将覆盖上次存档</p>
    </div>
  </div>
</template>

<style scoped>
/* 开局弹窗遮罩：250 — 盖住结算弹窗（.full-overlay 200），但被确认弹窗等
 * .modal-overlay（300）盖住，保证"开始新局？"确认可见可点。 */
.full-overlay { z-index: 250; }
.start-card {
  width: 430px; background: #16162e; border: 1px solid rgba(255,255,255,0.1);
  border-radius: 16px; padding: 32px; text-align: center;
  box-shadow: 0 24px 80px rgba(0,0,0,0.6);
  max-height: 94%; overflow-y: auto; position: relative;
}
.start-icon { font-size: 48px; margin-bottom: 10px; }
.start-card h2 { font-size: 22px; color: #e8e8f5; margin-bottom: 4px; }
.start-sub { font-size: 12px; color: #5a5a78; margin-bottom: 22px; }

.start-btn,
.continue-btn {
  width: calc(50% - 6px); aspect-ratio: 1 / 1;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  border-radius: 14px; border: none; cursor: pointer; font-family: inherit;
  transition: all 0.2s; font-size: 13px; font-weight: 700;
}
.start-actions { display: flex; gap: 12px; justify-content: center; margin-bottom: 14px; }
.action-icon { font-size: 28px; line-height: 1; }
.action-label { font-size: 13px; }
.start-btn { background: linear-gradient(135deg, #13DDC4, #2EA7FF); color: #fff; }
.start-btn:hover { box-shadow: 0 4px 20px rgba(19,221,196,0.3); transform: translateY(-1px); }
.continue-btn {
  background: rgba(255,180,84,0.1); border: 1px solid rgba(255,180,84,0.3); color: #FFB454;
}
.continue-btn:hover { background: rgba(255,180,84,0.18); }

/* ---- 可展开设置面板 ---- */
.settings-toggle {
  width: 100%; display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px; border-radius: 10px; cursor: pointer;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
  color: #b8b8d0; font-size: 12px; font-weight: 600; transition: all 0.2s;
  font-family: inherit; margin-bottom: 12px;
}
.settings-toggle:hover { border-color: rgba(255,255,255,0.2); color: #e8e8f5; }
.chevron { transition: transform 0.2s; font-size: 10px; }
.chevron.open { transform: rotate(180deg); }

.settings-panel {
  overflow: hidden; max-height: 0; opacity: 0;
  transition: max-height 0.2s ease, opacity 0.2s ease;
}
.settings-panel.open { max-height: 320px; opacity: 1; }
.settings-inner {
  border: 1px solid rgba(255,255,255,0.08); border-radius: 10px;
  padding: 14px; margin-bottom: 12px; background: rgba(0,0,0,0.2);
}
.start-label {
  font-size: 11px; color: #8a8aa8; margin-bottom: 10px; text-align: left;
}
.player-select { display: flex; gap: 8px; justify-content: center; margin-bottom: 20px; }
.p-opt {
  width: 52px; height: 52px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1);
  background: rgba(255,255,255,0.03); color: #8a8aa8; font-size: 18px; font-weight: 700;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: all 0.2s; user-select: none;
}
.p-opt:hover { border-color: rgba(255,255,255,0.2); background: rgba(255,255,255,0.06); }
.p-opt.selected { border-color: #13DDC4; background: rgba(19,221,196,0.1); color: #13DDC4; }

.diff-select { display: flex; gap: 6px; }
.diff-opt {
  flex: 1; padding: 8px 0; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); color: #8a8aa8;
  transition: all 0.2s; font-family: inherit;
}
.diff-opt:hover { border-color: rgba(255,255,255,0.2); color: #e8e8f5; }
.diff-opt.selected { border-color: #13DDC4; background: rgba(19,221,196,0.1); color: #13DDC4; }

.start-hint {
  font-size: 10px; color: #5a5a78; text-align: left; margin: 0; line-height: 1.4;
}
</style>
