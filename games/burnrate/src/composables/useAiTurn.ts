// AI turn choreography — drives ANY AI player's turn one step at a time so the
// UI can animate each action (highlight the played card, let motion-v FLIP it
// to the board, pause), then completes projects and ends that AI's turn.
//
// Multiplayer: watches `phase` (a player index). Only AI slots (index > 0)
// trigger work; the human's index is ignored. In spectate mode (human already
// bankrupt) the pacing compresses so the remaining AIs play out quickly.

import { watch } from 'vue';
import type { BurnRateGameApi } from './useBurnRateGame';

/** "Thinking" pause before an AI starts acting. */
const THINK_MS = 750;
/** Pause between individual actions. */
const STEP_MS = 520;
/** Highlight dwell before the card actually leaves the AI hand. */
const HIGHLIGHT_MS = 240;
/** Pause between auto-completed projects. */
const COMPLETE_MS = 420;

/** Spectate pacing (accelerated). */
const FAST_THINK_MS = 180;
const FAST_STEP_MS = 110;
const FAST_HIGHLIGHT_MS = 60;
const FAST_COMPLETE_MS = 90;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function useAiTurn(game: BurnRateGameApi): void {
  let running = false;

  watch(
    () => game.phase.value,
    async (p) => {
      // Only AI slots act here; the human is index 0.
      if (typeof p !== 'number' || p === 0 || running) return;
      const st = game.state.value;
      if (st.gameOver || !st.players[p]?.alive) return;

      running = true;
      game.aiBusy.value = true;
      const fast = game.spectate.value;
      try {
        await delay(fast ? FAST_THINK_MS : THINK_MS);

        // Exhaust the AI's plays, one action per step.
        let guard = 0;
        while (guard++ < 50 && !game.state.value.gameOver) {
          const action = await game.aiStep(p);
          if (!action) break;
          // Highlight the hand card about to be played (hire / assignProject).
          const cardId =
            action.kind === 'hire' || action.kind === 'assignProject'
              ? action.cardId
              : null;
          if (cardId) {
            game.aiHighlightId.value = cardId;
            await delay(fast ? FAST_HIGHLIGHT_MS : HIGHLIGHT_MS);
          }
          const res = game.applyAiAction(action, p);
          game.aiHighlightId.value = null;
          if (!res.ok) break;
          await delay(fast ? FAST_STEP_MS : STEP_MS);
        }

        // Auto-complete any doable projects.
        for (const idx of game.aiCompletions(p)) {
          if (game.state.value.gameOver) break;
          game.completeProjectAi(idx, p);
          await delay(fast ? FAST_COMPLETE_MS : COMPLETE_MS);
        }

        // Hand the turn to the next alive player (refills to six inside
        // endTurn — rules.md phase 1 of the new mover).
        if (!game.state.value.gameOver) {
          game.endAiTurn(p);
        }
      } finally {
        game.aiBusy.value = false;
        running = false;
      }
    },
  );
}
