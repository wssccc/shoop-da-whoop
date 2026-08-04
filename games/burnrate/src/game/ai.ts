// AI adapter layer — single import surface for every AI strategy.
//
// The heuristic ladder from the original 1v1 build lives on unchanged in
// `ai/heuristic.ts` (same priorities, now multiplayer-aware and rng-injected);
// `createAiAdapter(difficulty)` is the strategy-abstraction entry point the
// game loop uses. Random and MCTS adapters complete the set.

export { createAiAdapter, makeAiContext } from './ai/adapter';
export { chooseAiAction, chooseAiCompletions, effectiveGrudge, richestFoe, runAiTurn, sampleFoeByWeakPoint, weakPoint } from './ai/heuristic';
export { evaluate, evaluatePlayer } from './ai/mcts/eval';
export { actionKey, legalActions } from './ai/mcts/legal';
export { findBestAction, simApply, simEndTurn, type SearchOptions } from './ai/mcts/search';
export { sampleWorld } from './ai/mcts/world';
export { chooseRandomAction } from './ai/random';

