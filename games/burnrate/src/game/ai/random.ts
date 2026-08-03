// Random AI adapter — picks uniformly among all legal plays (or null when the
// hand has nothing playable). The "easy" difficulty floor.

import type { AiAction, GameState, PlayerId, Rng } from '../types';
import { legalActions } from './mcts/legal';

export function chooseRandomAction(
  state: GameState,
  player: PlayerId = 0,
  rng: Rng = Math.random,
): AiAction | null {
  const moves = legalActions(state, player);
  if (moves.length === 0) return null;
  return moves[Math.floor(rng() * moves.length)];
}
