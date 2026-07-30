<script setup lang="ts">
/**
 * App.vue — main Othello game UI.
 *
 * Layout (mirrors the original React version):
 *   Left panel: title, scoreboard, turn status, controls
 *   Center:     8×8 board
 *   Dialogs:    help, settings, game-over
 */

import { useOthelloGame } from './composables/useOthelloGame';
import OthelloBoard from './components/OthelloBoard.vue';
import BaseButton from './components/ui/BaseButton.vue';
import BaseBadge from './components/ui/BaseBadge.vue';
import BaseDialog from './components/ui/BaseDialog.vue';
import {
  RotateCcw,
  User,
  HelpCircle,
  Settings2,
  Cpu,
  Zap,
  Brain,
} from 'lucide-vue-next';

const {
  game,
  humanPlayer,
  aiDifficulty,
  isAiThinking,
  lastMove,
  flippedKeys,
  gameOver,
  showHelp,
  showSettings,
  score,
  winner,
  currentPlayer,
  handleCellClick,
  resetGame,
  switchSide,
  setDifficulty,
} = useOthelloGame();

// ── Derived display helpers ─────────────────────────────
const difficultyLabel: Record<string, string> = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
  expert: '专家',
};

const difficultyIterations: Record<string, number> = {
  easy: 300,
  medium: 1200,
  hard: 3000,
  expert: 6000,
};

const turnText = () => {
  if (gameOver.value) return '';
  const color = currentPlayer.value === 1 ? '黑棋' : '白棋';
  const isHuman = currentPlayer.value === humanPlayer.value;
  if (isAiThinking.value) return 'AI 思考中...';
  return isHuman ? `${color}（你的回合）` : `${color}（AI 思考中...）`;
};

const winnerText = () => {
  const w = winner.value;
  if (w === 0) return '平局！';
  if (w === humanPlayer.value) return '你赢了！🎉';
  return 'AI 赢了！🤖';
};
</script>

<template>
  <div class="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-3 sm:p-4 lg:p-6">
    <!-- Main flex row: sidebar + board -->
    <div class="flex w-full max-w-5xl flex-col items-center justify-center gap-4 lg:flex-row lg:items-start lg:gap-6">
      
      <!-- ── Left panel ── -->
      <div class="order-1 flex w-full flex-col items-center gap-4 lg:w-auto lg:min-w-[220px] lg:max-w-[260px]">
        
        <!-- Title -->
        <h1 class="text-2xl font-bold tracking-tight text-white lg:text-3xl">
          黑白棋
        </h1>

        <!-- Scoreboard -->
        <div class="flex w-full gap-2">
          <!-- Black score -->
          <div
            class="flex flex-1 flex-col items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-3"
            :class="currentPlayer === 1 && !gameOver && !isAiThinking
              ? 'ring-1 ring-green-500/50 bg-green-500/20'
              : ''"
          >
            <div class="flex items-center gap-1.5">
              <span
                class="inline-block h-3 w-3 rounded-full shadow-sm"
                :style="{ backgroundColor: '#000000', backgroundImage: 'linear-gradient(135deg, #6b7280, #000000)' }"
              />
              <span class="text-lg font-bold text-white">{{ score.black }}</span>
            </div>
            <BaseBadge variant="secondary" class="text-[10px]">
              <User v-if="humanPlayer === 1" class="mr-0.5 inline size-3" />
              <Cpu v-else class="mr-0.5 inline size-3" />
              {{ humanPlayer === 1 ? '你' : 'AI' }}
            </BaseBadge>
          </div>

          <!-- White score -->
          <div
            class="flex flex-1 flex-col items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 p-3"
            :class="currentPlayer === 2 && !gameOver && !isAiThinking
              ? 'ring-1 ring-green-500/50 bg-green-500/20'
              : ''"
          >
            <div class="flex items-center gap-1.5">
              <span
                class="inline-block h-3 w-3 rounded-full shadow-sm"
                :style="{ backgroundColor: '#ffffff', backgroundImage: 'linear-gradient(135deg, #ffffff, #d1d5db)' }"
              />
              <span class="text-lg font-bold text-white">{{ score.white }}</span>
            </div>
            <BaseBadge variant="secondary" class="text-[10px]">
              <User v-if="humanPlayer === 2" class="mr-0.5 inline size-3" />
              <Cpu v-else class="mr-0.5 inline size-3" />
              {{ humanPlayer === 2 ? '你' : 'AI' }}
            </BaseBadge>
          </div>
        </div>

        <!-- Turn status -->
        <div class="flex items-center gap-2 text-sm text-slate-300">
          <Brain
            v-if="isAiThinking"
            class="size-4 animate-pulse text-purple-400"
          />
          <span>{{ turnText() }}</span>
        </div>

        <!-- Difficulty badge -->
        <BaseBadge variant="outline" class="gap-1 border-slate-600 text-slate-300">
          <Zap class="size-3" />
          {{ difficultyLabel[aiDifficulty] }}
        </BaseBadge>

        <!-- Control buttons -->
        <div class="grid w-full grid-cols-4 gap-2 lg:grid-cols-2">
          <BaseButton
            variant="outline"
            size="sm"
            class="bg-slate-800/60 border-slate-600 text-white hover:bg-slate-700"
            @click="resetGame"
          >
            <RotateCcw class="size-4" />
            <span class="hidden sm:inline">重开</span>
          </BaseButton>

          <BaseButton
            variant="outline"
            size="sm"
            class="bg-slate-800/60 border-slate-600 text-white hover:bg-slate-700"
            @click="switchSide"
          >
            <User class="size-4" />
            <span class="hidden sm:inline">换边</span>
          </BaseButton>

          <BaseButton
            variant="outline"
            size="sm"
            class="bg-slate-800/60 border-slate-600 text-white hover:bg-slate-700"
            @click="showSettings = true"
          >
            <Settings2 class="size-4" />
            <span class="hidden sm:inline">设置</span>
          </BaseButton>

          <BaseButton
            variant="outline"
            size="sm"
            class="bg-slate-800/60 border-slate-600 text-white hover:bg-slate-700"
            @click="showHelp = true"
          >
            <HelpCircle class="size-4" />
            <span class="hidden sm:inline">规则</span>
          </BaseButton>
        </div>
      </div>

      <!-- ── Board ── -->
      <div class="order-2 w-full max-w-[500px] max-w-[min(85vw,85vh,500px)]">
        <OthelloBoard
          :game="game"
          :human-player="humanPlayer"
          :last-move="lastMove"
          :flipped-keys="flippedKeys"
          :is-ai-thinking="isAiThinking"
          @cell-click="handleCellClick"
        />
      </div>
    </div>

    <!-- ── Help Dialog ── -->
    <BaseDialog :open="showHelp" title="游戏规则" @update:open="showHelp = $event">
      <div class="space-y-3 text-sm text-slate-300">
        <p><strong>黑白棋</strong>（Reversi/Othello）规则：</p>
        <p>1. 黑棋先手，双方轮流落子。</p>
        <p>2. 落子必须能翻转至少一颗对方棋子。</p>
        <p>3. 翻转方向为横、竖、斜八个方向。</p>
        <p>4. 若一方无合法落子位置则跳过。</p>
        <p>5. 双方均无合法走法时游戏结束，棋子多者胜。</p>
        <div class="mt-3 rounded-md bg-green-900/30 p-3 text-xs text-green-300">
          💡 提示：占据角落可以稳固地盘，避免下在角落旁边的位置（X位/C位）以免送给对手角落。
        </div>
      </div>
    </BaseDialog>

    <!-- ── Settings Dialog ── -->
    <BaseDialog :open="showSettings" title="AI 难度" @update:open="showSettings = $event">
      <div class="space-y-3">
        <p class="text-sm text-slate-400">选择 AI 难度（迭代次数越高越强）：</p>
        <div class="grid grid-cols-2 gap-2">
          <BaseButton
            v-for="d in (['easy', 'medium', 'hard', 'expert'] as const)"
            :key="d"
            :variant="aiDifficulty === d ? 'default' : 'outline'"
            size="sm"
            class="justify-start"
            :class="aiDifficulty === d
              ? 'bg-green-600 text-white hover:bg-green-500'
              : 'border-slate-600 text-slate-300 hover:bg-slate-700'"
            @click="setDifficulty(d)"
          >
            <Zap class="size-3" />
            {{ difficultyLabel[d] }}
            <span class="ml-auto text-[10px] opacity-60">{{ difficultyIterations[d] }}次</span>
          </BaseButton>
        </div>
      </div>
    </BaseDialog>

    <!-- ── Game Over Dialog ── -->
    <BaseDialog :open="gameOver" title="游戏结束" @update:open="gameOver = $event">
      <div class="flex flex-col items-center gap-4">
        <p class="text-xl font-bold text-white">{{ winnerText() }}</p>

        <div class="flex w-full gap-4">
          <div class="flex flex-1 flex-col items-center gap-1 rounded-lg bg-slate-900/50 p-3">
            <span
              class="inline-block h-4 w-4 rounded-full"
              :style="{ backgroundColor: '#000000', backgroundImage: 'linear-gradient(135deg, #6b7280, #000000)' }"
            />
            <span class="text-2xl font-bold text-white">{{ score.black }}</span>
            <span class="text-xs text-slate-400">黑棋</span>
          </div>
          <div class="flex flex-1 flex-col items-center gap-1 rounded-lg bg-slate-900/50 p-3">
            <span
              class="inline-block h-4 w-4 rounded-full"
              :style="{ backgroundColor: '#ffffff', backgroundImage: 'linear-gradient(135deg, #ffffff, #d1d5db)' }"
            />
            <span class="text-2xl font-bold text-white">{{ score.white }}</span>
            <span class="text-xs text-slate-400">白棋</span>
          </div>
        </div>

        <BaseButton
          variant="default"
          class="bg-green-600 hover:bg-green-500"
          @click="resetGame"
        >
          <RotateCcw class="size-4" />
          再来一局
        </BaseButton>
      </div>
    </BaseDialog>
  </div>
</template>
