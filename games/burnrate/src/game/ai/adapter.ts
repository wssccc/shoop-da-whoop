// AI adapter factory — the strategy-abstraction entry point.
//
// `AiDifficulty` maps onto (algorithm kind, budget) via `AI_LEVELS` in
// constants.ts: easy=random, normal=heuristic, hard/expert=MCTS with growing
// iteration budgets. All adapters share the greedy completion pass.

import { AI_LEVELS, AI_TIME_LIMIT_MS, MCTS_ROLLOUT_DEPTH } from '../constants';
import type { AiAction, AiAdapter, AiContext, AiDifficulty, AiKind, GameState, PlayerId } from '../types';
import { chooseAiAction, chooseAiCompletions } from './heuristic';
import { findBestAction } from './mcts/search';
import { chooseRandomAction } from './random';

/** Difficulty → adapter, cheap and stateless (MCTS builds no cache yet). */
export function createAiAdapter(difficulty: AiDifficulty): AiAdapter {
  const { kind, budget } = AI_LEVELS[difficulty];
  switch (kind) {
    case 'random':
      return {
        kind,
        difficulty,
        chooseAction: (state, player, ctx) =>
          chooseRandomAction(state, player, ctx.rng),
        chooseCompletions: chooseAiCompletions,
      };
    case 'heuristic':
      return {
        kind,
        difficulty,
        chooseAction: (state, player, ctx) =>
          chooseAiAction(state, player, ctx.rng),
        chooseCompletions: chooseAiCompletions,
      };
    case 'mcts':
      return {
        kind,
        difficulty,
        chooseAction: (state, player, ctx) =>
          findBestAction(
            state,
            player,
            {
              iterations: budget,
              depth: MCTS_ROLLOUT_DEPTH,
              timeLimitMs: ctx.timeLimitMs,
            },
            ctx.rng,
          ),
        chooseCompletions: chooseAiCompletions,
      };
  }
}

/** Standard per-decision context for adapters (budget from the difficulty). */
export function makeAiContext(difficulty: AiDifficulty, rng: AiContext['rng']): AiContext {
  return {
    rng,
    budget: AI_LEVELS[difficulty].budget,
    timeLimitMs: AI_TIME_LIMIT_MS,
  };
}

export type { AiAction, AiAdapter, AiContext, AiDifficulty, AiKind, GameState, PlayerId };
