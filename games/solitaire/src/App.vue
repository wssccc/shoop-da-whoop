<script setup lang="ts">
/**
 * App — Solitaire root layout.
 *
 * Multi-region layout (kept visually identical to the original:
 *   ┌── toolbar ─────────────────────────────────┐  ← real flex item, pushes row 2 down
 *   ├── [free×3 + dragon btn] [flower] [found×3] ─
 *   └── tableau cols 0..7 (negative-margin stack)  ┘
 *
 * The side panels use `display: contents` (their children become flex items of
 * `.game-layout`), see memories/display-contents-margin-rowgap.md for the
 * polyfill quirks. Drag (Phase 5) and motion (Phase 6) attach to the board root
 * via the `#board` ref.
 */
import { ref, shallowReadonly } from 'vue';
import { useFullscreen } from '@vueuse/core';
import { motion, AnimatePresence } from 'motion-v';
import Card from '@solitaire/components/Card.vue';
import { FREE_CELL_COUNT, TABLEAU_COLS } from '@solitaire/game/constants';
import type {
  Card as CardModel,
  CardColor,
  FreeCell,
} from '@solitaire/game/types';
import { useSolitaireGame } from './composables/useSolitaireGame';
import { useAudio } from './composables/useAudio';
import { useAchievements } from './composables/useAchievements';
import { useDragController } from './composables/useDragController';
import { useDragonCollect } from './composables/useDragonCollect';
import { useDealing } from './composables/useDealing';

const boardRef = ref<HTMLElement | null>(null);

// Wire the singleton audio's visibility-driven auto-resume.
useAudio();

const game = useSolitaireGame();
const achievements = useAchievements(game.wins);
const { toggle: toggleFullscreen } = useFullscreen();

// Drag (board-level pointerdelegation). No per-card pointer handler needed.
useDragController(boardRef, game);

// Dealing fly-in on new games; settles safe auto-moves once the deal lands.
useDealing(game);

const state = shallowReadonly(game.state);
const COLORS: CardColor[] = ['red', 'black', 'green'];

/** Indices for template iteration. */
const freeCellIndices = Array.from({ length: FREE_CELL_COUNT }, (_, i) => i);
const tableauIndices = Array.from({ length: TABLEAU_COLS }, (_, i) => i);

// Type guards local to the template logic.
function isCard(cell: FreeCell): cell is CardModel {
  return cell !== null && cell.type !== 'dragonpile';
}
function isDragonPile(cell: FreeCell) {
  return cell !== null && cell.type === 'dragonpile';
}

/** New-game confirmation: a mis-click on 新局 would wipe the current board,
 *  so gate it behind a modal instead of acting immediately. */
const showNewGameConfirm = ref(false);

function askNewGame() {
  showNewGameConfirm.value = true;
}
function confirmNewGame() {
  showNewGameConfirm.value = false;
  game.newGame();
}
function cancelNewGame() {
  showNewGameConfirm.value = false;
}
function onUndo() {
  void game.undo();
}
function onMuteToggle() {
  game.toggleMute();
}
const onCollectDragons = useDragonCollect(game);
</script>

<template>
  <main
    :ref="(el) => (boardRef = el as HTMLElement | null)"
    id="board"
    class="board"
  >
    <div class="game-layout">
      <!-- Toolbar -->
      <header class="side-panel toolbar-panel">
        <div class="brand">
          <span class="brand-glyph">龍</span>
          <h1>纸牌接龙</h1>
        </div>
        <nav class="controls">
          <button
            type="button"
            title="新局"
            @click="askNewGame"
          >⟳ 新局</button>
          <button
            type="button"
            title="撤销"
            :disabled="!game.canUndo.value"
            @click="onUndo"
          >↶ 撤销</button>
          <button
            class="btn-mute"
            type="button"
            title="静音"
            @click="onMuteToggle"
          >{{ game.muted.value ? '🔇' : '🔊' }}</button>
          <button
            class="btn-fullscreen"
            type="button"
            title="横屏全屏"
            @click="toggleFullscreen()"
          >⛶</button>
          <div class="wins-pill">胜局 <span>{{ game.wins.value }}</span></div>
        </nav>
      </header>

      <!-- Left panel: free cells + dragon collect button -->
      <aside class="side-panel left-panel">
        <div class="panel-content">
          <div class="cell-group">
            <div
              v-for="i in freeCellIndices"
              :key="`fc-${i}`"
              class="slot free-cell"
              :class="{
                empty: state.freeCells[i] === null,
                locked: isDragonPile(state.freeCells[i]),
                [`c-${state.freeCells[i]?.type === 'dragonpile' ? state.freeCells[i].color : ''}`]: isDragonPile(state.freeCells[i]),
              }"
              :data-slot="`fc-${i}`"
            >
              <Card
                v-if="isCard(state.freeCells[i])"
                :card="state.freeCells[i] as CardModel"
                :draggable="true"
                :no-layout="game.justDealt.value || game.collecting.value"
              />
              <div
                v-else-if="isDragonPile(state.freeCells[i])"
                class="locked-dragons"
                :class="`c-${state.freeCells[i]!.color}`"
              >
                🐉<span class="lock">🔒</span>
              </div>
            </div>
          </div>
          <button
            class="dragon-btn"
            :class="{ ready: game.dragonReadyColor.value !== null }"
            :data-color="game.dragonReadyColor.value ?? ''"
            type="button"
            title="收"
            :disabled="game.collecting.value || game.dragonReadyColor.value === null"
            @click="onCollectDragons"
          >
            <span class="glyph">🐉</span><span class="lbl">收</span>
          </button>
        </div>
      </aside>

      <!-- Right panel: foundations + flower slot -->
      <aside class="side-panel right-panel">
        <div class="panel-content">
          <div class="cell-group foundations">
            <div
              v-for="color in COLORS"
              :key="`found-${color}`"
              class="slot foundation"
              :class="[`c-${color}`, { empty: state.foundations[color].length === 0 }]"
              :data-slot="`found-${color}`"
            >
              <Card
                v-for="card in state.foundations[color]"
                :key="card.id"
                :card="card"
                :draggable="false"
                :no-layout="game.justDealt.value || game.collecting.value"
              />
            </div>
          </div>
        </div>
        <div
          class="slot flower-slot"
          :class="{ empty: state.flowerSlot === null }"
          data-slot="flower"
        >
          <Card
            v-if="state.flowerSlot"
            :card="state.flowerSlot"
            :draggable="false"
            :no-layout="game.justDealt.value || game.collecting.value"
          />
        </div>
      </aside>

      <!-- Tableau: 8 columns of stacked cards -->
      <section class="tableau">
        <div
          v-for="i in tableauIndices"
          :key="`col-${i}`"
          class="slot col"
          :class="{ empty: state.tableau[i].length === 0 }"
          :data-slot="`col-${i}`"
        >
          <Card
            v-for="card in state.tableau[i]"
            :key="card.id"
            :card="card"
            :draggable="true"
            :no-layout="game.justDealt.value || game.collecting.value"
          />
        </div>
      </section>

      <span class="side-label lbl-left">空闲 + 龙牌</span>
      <span class="side-label lbl-right">终局 + 花牌</span>
    </div>
  </main>

  <!-- New-game confirmation. Single motion layer (the overlay itself fades) so
       AnimatePresence's exit finishes in one short tween — nesting a second
       motion layer here made the dialog linger ~600ms after cancel/confirm. -->
  <AnimatePresence>
    <motion.div
      v-if="showNewGameConfirm"
      class="overlay"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      :transition="{ duration: 0.15 }"
    >
      <div class="overlay-card newgame-card">
        <div class="overlay-glyph">⟳</div>
        <h2>开始新局？</h2>
        <p>当前棋局的进度将会被丢弃。</p>
        <div class="dialog-actions">
          <button
            type="button"
            class="btn-ghost"
            @click="cancelNewGame"
          >取消</button>
          <button
            type="button"
            class="btn-primary"
            autofocus
            @click="confirmNewGame"
          >确定</button>
        </div>
      </div>
    </motion.div>
  </AnimatePresence>

  <!-- Win overlay (AnimatePresence handles fade + spring-scale). -->
  <AnimatePresence>
    <motion.div
      v-if="game.won.value"
      class="overlay"
      :initial="{ opacity: 0 }"
      :animate="{ opacity: 1 }"
      :exit="{ opacity: 0 }"
      :transition="{ duration: 0.2 }"
    >
      <motion.div
        class="overlay-card"
        :initial="{ scale: 0.85, opacity: 0 }"
        :animate="{ scale: 1, opacity: 1 }"
        :exit="{ scale: 0.85, opacity: 0 }"
        :transition="{ type: 'spring', stiffness: 200, damping: 20 }"
      >
        <div class="overlay-glyph">☯</div>
        <h2>恭喜通关</h2>
        <p>累计胜局 <strong>{{ game.wins.value }}</strong> 局</p>
        <button
          type="button"
          @click="askNewGame"
        >再来一局</button>
      </motion.div>
    </motion.div>
  </AnimatePresence>

  <!-- Toasts (AnimatePresence stack; each auto-dismisses after 3.2s). -->
  <div
    class="toasts"
    aria-live="polite"
  >
    <AnimatePresence>
      <motion.div
        v-for="t in achievements.toasts.value"
        :key="t.key"
        class="toast"
        :initial="{ opacity: 0, y: 10 }"
        :animate="{ opacity: 1, y: 0 }"
        :exit="{ opacity: 0, y: -6 }"
        :transition="{ duration: 0.25 }"
      >
        {{ t.achievement.name }}
      </motion.div>
    </AnimatePresence>
  </div>
</template>
