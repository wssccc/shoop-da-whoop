// Central state orchestrator — mirrors othello's `useOthelloGame` pattern:
// `shallowRef` holds the engine state, an `afterChange()` hook re-publishes
// state + persists + checks win, and exposed actions wrap the framework-agnostic engine.
//
// Vue's reactivity only sees the top-level `state` ref reassignment; deep
// mutation happens inside the engine and we re-publish a new state object each
// time (so shallowRef is correct — see memories/othello-vue-migration.md).

import { COLORS } from '@solitaire/game/constants';
import { SolitaireEngine } from '@solitaire/game/engine';
import * as Rules from '@solitaire/game/rules';
import { fromLayout } from '@solitaire/game/state';
import type {
    Card,
    CardColor,
    DestDescriptor,
    MoveResult,
} from '@solitaire/game/types';
import { Storage } from '@solitaire/storage';
import { computed, ref, shallowRef } from 'vue';
import {
    flyAutoMovedCards,
    snapshotCardRects,
    type AutoMoveTarget,
} from './animateAutoMoves';
import { Audio, getMuted as audioGetMuted, setMuted as audioSetMuted } from './useAudio';

export function useSolitaireGame() {
  const engine = new SolitaireEngine();
  const state = shallowRef(engine.state);
  const wins = ref(Storage.getWins());
  const muted = ref(Storage.getMuted());
  /** Set true after a win; UI overlays reset to false on new game. */
  const won = ref(false);
  /** Set true once the dealing animation starts; UI clears it when finished. */
  const justDealt = ref(false);
  /** Set true while the dragon-collect flight runs (drag & layout disabled). */
  const collecting = ref(false);
  /**
   * Card ids currently flying home after a USER MOVE triggered the engine's
   * auto-move cascade (flower + safe foundation runs). While a card is in
   * here it renders with noLayout (see App.vue) so motion-v's layout FLIP
   * doesn't fight our hand-rolled one-at-a-time flight.
   */
  const autoMovingIds = ref<string[]>([]);
  /**
   * A win detected WHILE the dragon-collect flight is still running. The
   * overlay must wait until every card has landed — otherwise the "恭喜通关"
   * dialog pops mid-animation over flying cards. `flushDeferredWin()` (called
   * by useDragonCollect once the flight settles) releases it.
   */
  let deferredWin = false;

  // Boot: restore any in-progress save, then collapse the safe auto-moves.
  const saved = Storage.loadGame();
  if (saved) {
    engine.setState(
      fromLayout({
        tableau: saved.tableau,
        freeCells: saved.freeCells,
        foundations: saved.foundations,
        flowerSlot: saved.flowerSlot,
        history: saved.history ?? [],
      }),
    );
    engine.applyAutoMoves();
    state.value = engine.getState();
  }

  // Wire engine callbacks. Sounds are routed to the singleton Audio; a win
  // bumps the persisted win counter and flags `won` for the overlay.
  engine.onSound = (name) => {
    switch (name) {
      case 'move':
        Audio.move();
        break;
      case 'place':
        Audio.place();
        break;
      case 'foundation':
        Audio.foundation();
        break;
      case 'flower':
        Audio.flower();
        break;
      case 'dragon':
        Audio.dragon();
        break;
      case 'win':
        Audio.win();
        break;
    }
  };
  engine.onWin = () => {
    wins.value += 1;
    Storage.setWins(wins.value);
    // A plain move can win immediately; a win that lands mid-collect-flight
    // (the last auto-moved card reaching its foundation IS the win) waits for
    // the flight to finish so the overlay appears after the animation.
    if (collecting.value) deferredWin = true;
    else won.value = true;
  };

  // Sync the persisted mute flag into the singleton.
  audioSetMuted(audioGetMuted());
  if (muted.value) audioSetMuted(true);

  // Computed-from-state.value so they re-evaluate when we re-publish a new top-level state object.
  const canUndo = computed(() => state.value.history.length > 0);
  const dragonReadyColor = computed<CardColor | null>(() =>
    Rules.readyDragonColor(state.value),
  );

  /** Re-publish state as a NEW top-level object reference (shallow clone).
   *
   *  The engine mutates the game state IN PLACE (`splice`/`pop`/array index
   *  assignment on the same object), so just reassigning `state.value = engine.getState()`
   *  shares the same reference and Vue's shallowRef sees no change → no re-render.
   *  A shallow spread produces a new top-level object every change, which
   *  triggers shallowRef + the v-for / computed re-evaluations above.
   *  (Inner arrays still share reference; v-for detects length/key changes.) */
  function afterChange(): void {
    state.value = { ...engine.getState() };
    Storage.saveGame(state.value);
  }

  function moveCard(run: Card[] | null, dest: DestDescriptor): MoveResult {
    // Snapshot BEFORE the move: every card's rect + foundation/flower state,
    // so cards the engine auto-moves can be flown home one at a time.
    const srcRects = snapshotCardRects();
    const before = engine.getState();
    const beforeLen: Record<CardColor, number> = {
      red: before.foundations.red.length,
      black: before.foundations.black.length,
      green: before.foundations.green.length,
    };
    const flowerBefore = before.flowerSlot !== null;

    const result = engine.move(run, dest);
    if (!result.ok) return result;
    afterChange();

    // Diff old vs new to find the auto-moved cards (flower + safe foundation
    // runs) and fly them home one at a time instead of motion-v's instant
    // layout FLIP.
    const st = engine.getState();
    const moved: AutoMoveTarget[] = [];
    for (const c of COLORS) {
      const f = st.foundations[c];
      for (let i = beforeLen[c]; i < f.length; i++) {
        moved.push({
          id: f[i].id,
          target: document.querySelector(`.slot.foundation.c-${c}`),
        });
      }
    }
    if (!flowerBefore && st.flowerSlot) {
      moved.push({
        id: st.flowerSlot.id,
        target: document.querySelector('.slot.flower-slot'),
      });
    }
    if (moved.length > 0) {
      // Disable motion-v layout on exactly these cards (next render) so we
      // own their transform channel; fly them home, then re-enable.
      // APPEND (not replace) so a second launch while a previous flight is
      // still airborne (hint/undo bypass the drag guard) keeps the in-flight
      // cards' noLayout engaged — replacing here would hand them back to
      // motion-v mid-transform and they'd vanish/flip weirdly (`牌看不见`).
      const myIds = new Set(moved.map((m) => m.id));
      autoMovingIds.value = [...autoMovingIds.value, ...myIds];
      void flyAutoMovedCards(moved, srcRects).finally(() => {
        autoMovingIds.value = autoMovingIds.value.filter((id) => !myIds.has(id));
      });
    }
    return result;
  }

  /** Collect dragons — auto-picks the first ready colour, or a caller-chosen
   *  one (the 💡 hint executes solver steps, which name the colour). */
  function collectDragons(color?: CardColor): boolean {
    const c = color ?? engine.dragonReady();
    if (!c) return false;
    const result = engine.collectDragons(c);
    if (result.ok) afterChange();
    return result.ok;
  }

  function undo(): boolean {
    const wasUndone = engine.undo();
    if (wasUndone) {
      // The board is no longer in a winning state — drop any held-back win.
      deferredWin = false;
      afterChange();
    }
    return wasUndone;
  }

  function newGame(): void {
    engine.newGame();
    state.value = engine.getState();
    won.value = false;
    deferredWin = false;
    justDealt.value = true; // useDealing plays the fly-in, then settles auto-moves
    Storage.saveGame(state.value); // persist the fresh deal; reload should NOT revert to a stale save
  }

  /**
   * Release a win that was held back during the dragon-collect flight. Called
   * by useDragonCollect after the last card lands — the win counter is already
   * bumped (persisted) at detection time; this only reveals the overlay.
   */
  function flushDeferredWin(): void {
    if (deferredWin) {
      deferredWin = false;
      won.value = true;
    }
  }

  /**
   * Collapse the safe auto-moves (flower + safe foundation sends) AFTER the
   * dealing animation has finished. newGame() deliberately leaves the fresh
   * deal untouched so the fly-in can play first; this settles the board.
   */
  function settleAfterDeal(): void {
    engine.applyAutoMoves();
    afterChange();
  }

  function toggleMute(): void {
    muted.value = !muted.value;
    Storage.setMuted(muted.value);
    audioSetMuted(muted.value);
  }

  /** Compute legal drop targets for a candidate run from the current state. */
  function validDropTargets(run: Card[]): DestDescriptor[] {
    return Rules.validDropTargets(state.value, run);
  }
  function grabRun(cardId: string): Card[] | null {
    return Rules.grabRunFromTableau(state.value, cardId);
  }

  return {
    state,
    wins,
    muted,
    won,
    justDealt,
    collecting,
    autoMovingIds,
    canUndo,
    dragonReadyColor,
    moveCard,
    collectDragons,
    undo,
    newGame,
    settleAfterDeal,
    flushDeferredWin,
    toggleMute,
    validDropTargets,
    grabRun,
    /** Engine instance — exposed for the drag controller & dealing composable. */
    engine,
  };
}

export type SolitaireGameApi = ReturnType<typeof useSolitaireGame>;
