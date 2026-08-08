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
import Card from '@solitaire/components/Card.vue';
import CardBack from '@solitaire/components/CardBack.vue';
import GlyphIcon from '@solitaire/components/GlyphIcon.vue';
import Toaster from '@solitaire/components/Toaster.vue';
import WinCard from '@solitaire/components/WinCard.vue';
import {
  DRAGON_COUNT_PER_COLOR,
  FREE_CELL_COUNT,
  TABLEAU_COLS,
} from '@solitaire/game/constants';
import type {
  CardColor,
  Card as CardModel,
  FreeCell,
} from '@solitaire/game/types';
import { useFullscreen } from '@vueuse/core';
import {
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui';
import { computed, ref, shallowReadonly, watch } from 'vue';
import { useAchievements } from './composables/useAchievements';
import { useAudio } from './composables/useAudio';
import { useDealing } from './composables/useDealing';
import { useDragController } from './composables/useDragController';
import { useHint } from './composables/useHint';
import { useSolitaireGame } from './composables/useSolitaireGame';

const boardRef = ref<HTMLElement | null>(null);

// Wire the singleton audio's visibility-driven auto-resume.
useAudio();

const game = useSolitaireGame();
const hint = useHint(game);
// Side-effect only: watches the win counter and pushes achievement toasts.
useAchievements(game.wins);
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

/**
 * Per-slot dragon-pile card counts — re-evaluates on every publish (the
 * shallowReadonly top-level state object is replaced per engine step, so a
 * pile going 3→4 IS a change). Used to fire the seal-flip's rotateX tilt
 * animation ONLY when the pile actually completes in play — a boot-restored
 * pile is already 4 on first render, so no watch callback runs and the
 * flipped card-back appears statically (no tilt tween on restore).
 */
const pileCounts = computed(() =>
    state.value.freeCells.map((c) =>
        c !== null && c.type === 'dragonpile' ? c.cards.length : -1,
    ),
);
/** Free-cell indices whose pile JUST filled (4 dragons) — drives `.playing`.
 *  Removed on animationend. */
const sealPlaying = ref(new Set<number>());
watch(pileCounts, (now, prev) => {
    const next = new Set(sealPlaying.value);
    now.forEach((len, i) => {
        const was = prev?.[i] ?? -1;
        if (len === DRAGON_COUNT_PER_COLOR && was !== DRAGON_COUNT_PER_COLOR) {
            next.add(i);
        }
    });
    sealPlaying.value = next;
});
/** Animation finished (or cancelled) — release the tilt trigger. */
function onSealTiltEnd(i: number) {
    const next = new Set(sealPlaying.value);
    next.delete(i);
    sealPlaying.value = next;
}

/**
 * The seal flip's rotateY transition finished — hide the front face
 * outright (inline), so the revealed card back never depends on
 * backface-visibility ALONE: iOS Safari flattens the 3D chain (backface
 * gives out) and mobile GPUs can glitch the composite around the flip
 * (a one-frame flash of the front face). The inline visibility:hidden is
 * precise (fires exactly when the flip lands, unlike the CSS 1.2s delay
 * fallback in index.css which races the transition end) and harmless when
 * backface-visibility works (the front is already hidden by it).
 *
 * Guard: only the flip-card's OWN transform transition counts — flying
 * cards' transform transitions bubble up from `.face.front .card`.
 */
function onFlipCardEnd(e: TransitionEvent) {
    if (e.propertyName !== 'transform') return;
    if (e.target !== e.currentTarget) return;
    const front = (e.currentTarget as HTMLElement).querySelector('.face.front');
    if (front) (front as HTMLElement).style.visibility = 'hidden';
}

/** New-game confirmation: a mis-click on 新局 would wipe the current board,
 *  so gate it behind a modal instead of acting immediately. */
const showNewGameConfirm = ref(false);

function askNewGame() {
  // Win overlay is open → the board is already finished, nothing to lose:
  // restart immediately instead of stacking a confirm dialog over the win
  // dialog (two fixed .overlay layers at the same z-index would trap the
  // click — the later-rendered win overlay intercepts the confirm button).
  if (game.won.value) {
    game.newGame();
    return;
  }
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
/** 收龙: begins a 收龙 unit — the executor animates each dragon + cascade step. */
function onCollectDragons() {
  game.collectDragons();
}
</script>

<template>
  <main
    :ref="(el) => (boardRef = el as HTMLElement | null)"
    id="board"
    class="board max-w-[920px] mx-auto mb-10 px-[14px] touch-none"
  >
    <div class="game-layout">
      <!-- Toolbar -->
      <header class="side-panel toolbar-panel">
        <div class="brand">
          <span class="brand-glyph">🃏</span>
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
            :disabled="!game.canUndo.value || game.busy.value"
            @click="onUndo"
          >↶ 撤销</button>
          <button
            class="btn-hint"
            type="button"
            :title="hint.solving.value ? '求解中…' : '提示一步（自动执行当前局面解的第一步）'"
            :disabled="hint.solving.value || game.won.value || game.justDealt.value || game.busy.value"
            @click="hint.hintOnce()"
          >
            <GlyphIcon :name="hint.solving.value ? 'hourglass' : 'hint'" :size="16" />
          </button>
          <button
            class="btn-mute"
            type="button"
            title="静音"
            @click="onMuteToggle"
          >
            <GlyphIcon :name="game.muted.value ? 'muted' : 'sound'" :size="16" />
          </button>
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
              />
              <!-- Locked dragon pile: render the REAL dragon cards (all four,
                   stacked at the slot origin) so the 收龙 flight can snap them
                   back to their columns and fly them home — the same
                   commit-then-fly playback as every other auto-collect path.
                   Once the pile is complete (`cards.length === DRAGON_COUNT_PER_COLOR`)
                   the flip-card turns 180° and the pile reads as ONE card back
                   (CardBack) — the dragon pile is sealed. The flip is
                   data-driven, so an undo (pile vanishes / shrinks) reverts it
                   automatically; `.slot.locked` keeps the per-colour frame. -->
              <div
                v-else-if="isDragonPile(state.freeCells[i])"
                class="locked-dragons"
                :class="`c-${state.freeCells[i]!.color}`"
              >
                <div class="flip-scene">
                  <!-- Tilt shell: rotateX lift-and-put-down envelope around
                       the rotateY flip. Fired by the watch on pile completion
                       (sealPlaying) — NOT by the flipped class, so a
                       boot-restored pile (already 4 on first render) stays
                       static. animationend clears the trigger. -->
                  <div
                    class="flip-tilt"
                    :class="{ playing: sealPlaying.has(i) }"
                    @animationend="onSealTiltEnd(i)"
                  >
                    <div
                      class="flip-card"
                      :class="{
                        flipped:
                          state.freeCells[i]!.cards.length ===
                          DRAGON_COUNT_PER_COLOR,
                      }"
                      @transitionend="onFlipCardEnd"
                    >
                      <div class="face front">
                        <Card
                          v-for="card in state.freeCells[i]!.cards"
                          :key="card.id"
                          :card="card"
                          :draggable="false"
                        />
                      </div>
                      <div class="face back">
                        <CardBack />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <button
            class="dragon-btn"
            :class="{ ready: game.dragonReadyColor.value !== null }"
            :data-color="game.dragonReadyColor.value ?? ''"
            type="button"
            title="收"
            :disabled="game.busy.value || game.dragonReadyColor.value === null"
            @click="onCollectDragons"
          >
            <span class="glyph">🐉</span>
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
          />
        </div>
      </aside>

      <!-- Tableau: 8 columns of stacked cards. WinCard overlays the (now
           empty) tableau region — no modal, the rest of the board stays
           visible and interactive. -->
      <section class="tableau">
        <div
          v-for="i in tableauIndices"
          :key="`col-${i}`"
          class="slot col"
          :data-slot="`col-${i}`"
        >
          <Card
            v-for="card in state.tableau[i]"
            :key="card.id"
            :card="card"
            :draggable="true"
          />
        </div>
        <!-- Victory emblem: replaces the win dialog (agreed design — see
             WinCard.vue). `won` gates it exactly like the old dialog, so it
             still appears only after the last collect-flight lands. -->
        <WinCard v-if="game.won.value" :game="game" />
      </section>

      <span class="side-label">空闲 + 龙牌</span>
      <span class="side-label">终局 + 花牌</span>
    </div>
  </main>

  <!-- New-game confirmation (reka-ui Dialog: overlay click / Escape close,
       focus trap + aria — full defaults). Enter/exit run off data-state
       CSS animations, see index.css. -->
  <DialogRoot v-model:open="showNewGameConfirm">
    <DialogPortal>
      <DialogOverlay class="overlay newgame-overlay" />
      <DialogContent class="overlay-card newgame-card dialog-content">
        <div class="overlay-glyph">⟳</div>
        <DialogTitle class="dialog-title">开始新局？</DialogTitle>
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
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- Toasts (reka-ui Toast, imperative store — see lib/toaster.ts). -->
  <Toaster />
</template>
