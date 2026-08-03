// MCTS Web Worker — off-main-thread search so hard/expert AI never janks the
// UI. Classic worker via Vite's `?worker` import (iOS 13 friendly).
//
// Protocol:
//   Main → Worker: { type: 'chooseAction', state, player, difficulty, seed }
//   Worker → Main: { type: 'action', action: AiAction | null, elapsed }
//
// Determinism: the seed (from the engine's injected rng) drives all sampling
// and consultant rolls inside the search, so a fixed game seed reproduces the
// exact same AI moves.

import { AI_LEVELS, AI_TIME_LIMIT_MS, MCTS_ROLLOUT_DEPTH } from '../../constants';
import { mulberry32 } from '../../rng';
import type { AiAction, AiDifficulty, GameState, PlayerId } from '../../types';
import { findBestAction } from './search';

interface ChooseActionMessage {
  type: 'chooseAction';
  state: GameState;
  player: PlayerId;
  difficulty: AiDifficulty;
  seed: number;
}

interface ActionResponse {
  type: 'action';
  action: AiAction | null;
  elapsed: number;
}

self.onmessage = (e: MessageEvent<ChooseActionMessage>) => {
  const { state, player, difficulty, seed } = e.data;
  const rng = mulberry32(seed >>> 0);
  const start = performance.now();

  const action = findBestAction(
    state,
    player,
    {
      iterations: AI_LEVELS[difficulty].budget,
      depth: MCTS_ROLLOUT_DEPTH,
      timeLimitMs: AI_TIME_LIMIT_MS,
    },
    rng,
  );

  const response: ActionResponse = {
    type: 'action',
    action,
    elapsed: Math.round(performance.now() - start),
  };
  self.postMessage(response);
};
