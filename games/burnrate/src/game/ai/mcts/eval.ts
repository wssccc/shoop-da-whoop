// Heuristic terminal evaluation for truncated MCTS rollouts.
//
// Values are relative (own-side minus the strongest opponent), so they are
// comparable across positions and player counts. Only used when a rollout
// hits the depth cap before a bankruptcy; real endings are scored 0/1.

import { opponents } from '../../rules';
import type { GameState, PlayerId } from '../../types';

const VP_VALUE = 40;
const STAFF_VALUE = 8; // per skill point
const CONSULTANT_PENALTY = 5; // per $ of salary
const HAND_VP = 25;
const HAND_STAFF = 4; // per skill point
const HAND_PROJECT = 5;
const PROJECT_PRESSURE = 2; // per $ of burn, doubled below

/** Raw board strength of one player (cash + company + hand + projects). */
export function evaluatePlayer(state: GameState, player: PlayerId): number {
  const p = state.players[player];
  let score = p.cash;

  for (const c of p.company) {
    if (c.kind === 'vp') score += VP_VALUE;
    else if (c.kind === 'staff') score += c.skill * STAFF_VALUE;
    else if (c.kind === 'consultant') score -= c.salary * CONSULTANT_PENALTY;
  }
  for (const c of p.hand) {
    if (c.kind === 'vp') score += HAND_VP;
    else if (c.kind === 'staff') score += c.skill * HAND_STAFF;
    else if (c.kind === 'project') score += c.target === 'self' ? HAND_PROJECT : 2;
  }
  for (const proj of p.projects) score -= proj.burn * PROJECT_PRESSURE;

  return score;
}

/** Relative score of `player` vs the strongest alive opponent. */
export function evaluate(state: GameState, player: PlayerId): number {
  const mine = evaluatePlayer(state, player);
  let foeBest = -Infinity;
  for (const foe of opponents(state, player)) {
    foeBest = Math.max(foeBest, evaluatePlayer(state, foe));
  }
  return mine - (foeBest === -Infinity ? 0 : foeBest);
}
