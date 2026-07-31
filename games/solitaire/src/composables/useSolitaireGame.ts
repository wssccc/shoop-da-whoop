// Central state orchestrator — mirrors othello's `useOthelloGame` pattern:
// `shallowRef` holds the engine state, an `afterChange()` hook re-publishes
// state + persists + checks win, and exposed actions wrap the framework-agnostic engine.
//
// Vue's reactivity only sees the top-level `state` ref reassignment; deep
// mutation happens inside the engine and we re-publish a new state object each
// time (so shallowRef is correct — see memories/othello-vue-migration.md).

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
    won.value = true;
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
    const result = engine.move(run, dest);
    if (result.ok) afterChange();
    return result;
  }

  function collectDragons(): boolean {
    const color = engine.dragonReady();
    if (!color) return false;
    const result = engine.collectDragons(color);
    if (result.ok) afterChange();
    return result.ok;
  }

  function undo(): boolean {
    const wasUndone = engine.undo();
    if (wasUndone) afterChange();
    return wasUndone;
  }

  function newGame(): void {
    engine.newGame();
    state.value = engine.getState();
    won.value = false;
    justDealt.value = true; // useDealing plays the fly-in, then settles auto-moves
    Storage.saveGame(state.value); // persist the fresh deal; reload should NOT revert to a stale save
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
    canUndo,
    dragonReadyColor,
    moveCard,
    collectDragons,
    undo,
    newGame,
    settleAfterDeal,
    toggleMute,
    validDropTargets,
    grabRun,
    /** Engine instance — exposed for the drag controller & dealing composable. */
    engine,
  };
}

export type SolitaireGameApi = ReturnType<typeof useSolitaireGame>;
