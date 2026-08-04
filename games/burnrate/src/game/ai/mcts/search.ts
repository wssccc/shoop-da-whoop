// IS-MCTS search over the AI play-decision tree.
//
// Tree nodes are *single plays* ("hire this card", "audit that foe"), matching
// the engine's step-by-step AI turn choreography. The "end turn" transition is
// implicit and deterministic: when the mover has no legal plays left (or the
// rollout heuristic declines), we settle burn / check bankruptcy / refill /
// rotate via the engine — no tree node is created for it.
//
// Simulation uses real `BurnRateEngine` instances (restored from clones) so
// rule logic is never duplicated. Rollouts follow the heuristic ladder and are
// truncated at `depth` plays, then scored by `evaluate`. Backpropagation is
// binary from the root player's perspective (survive-to-end = 1).

import { AI_MCTS_GRUDGE_LAMBDA, MCTS_EXPLORATION_C } from '../../constants';
import { BurnRateEngine } from '../../engine';
import type { AiAction, GameState, PlayerId, Rng } from '../../types';
import { chooseAiAction, effectiveGrudge } from '../heuristic';
import { evaluate } from './eval';
import { actionKey, legalActions } from './legal';
import { sampleWorld } from './world';

export interface SearchOptions {
  /** Number of MCTS iterations (simulations) for this decision. */
  iterations: number;
  /** Rollout truncation: max heuristic plays past the decision point. */
  depth: number;
  /** Hard wall-clock cap per decision (safety net). */
  timeLimitMs: number;
}

interface Node {
  action: AiAction | null; // null = root
  player: PlayerId;
  parent: Node | null;
  children: Map<string, Node>;
  visits: number;
  wins: number;
  untried: AiAction[] | null;
}

// ---- Simulation primitives (engine-backed, zero rule duplication) ---------

/** Apply one AI action on a cloned state via a throwaway engine. */
export function simApply(
  state: GameState,
  action: AiAction,
  player: PlayerId,
  rng: Rng,
): { state: GameState; ok: boolean } {
  const sim = new BurnRateEngine({ rng });
  sim.restore(state);
  const res = sim.applyAiAction(action, player);
  return { state: sim.state, ok: res.ok };
}

/** Settle `player`'s turn end on a cloned state via a throwaway engine. */
export function simEndTurn(state: GameState, player: PlayerId, rng: Rng): GameState {
  const sim = new BurnRateEngine({ rng });
  sim.restore(state);
  sim.endTurn(player);
  return sim.state;
}

// ---- Tree helpers ---------------------------------------------------------

function ucb(child: Node, parentVisits: number): number {
  if (child.visits === 0) return Infinity;
  const exploitation = child.wins / child.visits;
  const exploration =
    MCTS_EXPLORATION_C * Math.sqrt(Math.log(parentVisits) / child.visits);
  return exploitation + exploration;
}

/** Static priority for expansion ordering (mirrors the heuristic ladder's
 *  rough ordering; cheap — no simulation needed). */
function actionPriority(a: AiAction): number {
  switch (a.kind) {
    case 'hire':
      return 8;
    case 'assignProject':
      return a.target === 'self' ? 3 : 7;
    case 'audit':
      return 6;
    case 'consultant':
      return 5;
    case 'poach':
      return 4;
    case 'abandonBad':
    case 'burnoutBad':
      return 2; // defensive rescue plays — explored after offensive ones
    case 'discard':
      return 1; // dead-card cleanup — lowest priority
    default:
      return 0;
  }
}

function untriedMoves(state: GameState, player: PlayerId, node: Node): AiAction[] {
  return legalActions(state, player)
    .filter((a) => !node.children.has(actionKey(a)))
    .sort((a, b) => actionPriority(b) - actionPriority(a));
}

/** One heuristic roll: play until depth cap, a bankruptcy, or one survivor. */
function rollout(
  state: GameState,
  mover: PlayerId,
  rootPlayer: PlayerId,
  depthLeft: number,
  rng: Rng,
): number {
  let s = state;
  let m = mover;
  let d = depthLeft;

  while (!s.gameOver && d > 0) {
    if (legalActions(s, m).length === 0) {
      s = simEndTurn(s, m, rng);
      m = s.currentPlayer;
      continue;
    }
    const action = chooseAiAction(s, m, rng); // opponents play heuristically too
    if (action) {
      const applied = simApply(s, action, m, rng);
      if (!applied.ok) {
        // Defensive: the heuristic's pre-validation failed against the sampled
        // world (e.g. a poach target vanished) — just end the turn.
        s = simEndTurn(s, m, rng);
        m = s.currentPlayer;
        continue;
      }
      s = applied.state;
      d--;
    } else {
      s = simEndTurn(s, m, rng);
      m = s.currentPlayer;
    }
  }

  if (s.gameOver) return s.winner === rootPlayer ? 1 : 0;
  return evaluate(s, rootPlayer) > 0 ? 1 : 0;
}

// ---- Search ---------------------------------------------------------------

/** Resolve the foe a targeting action hits, for grudge weighting. Returns
 *  null for self-targeting / non-attacking actions (hire, self-project,
 *  discard, rescue) so they get no grudge boost. */
function actionTargetPlayer(state: GameState, a: AiAction): PlayerId | null {
  switch (a.kind) {
    case 'audit':
    case 'consultant':
      return a.target;
    case 'assignProject':
      return a.target === 'self' ? null : a.target;
    case 'poach':
    case 'resign': {
      for (let pid = 0; pid < state.players.length; pid++) {
        if (state.players[pid].company.some((c) => c.id === a.targetCardId)) return pid;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * Find the best next play for `player`, from the *real* state, using IS-MCTS:
 * each iteration samples a deterministic world, walks the shared tree with
 * UCB1 (implicit end-turn transitions), expands one node, then rolls out
 * heuristically. Returns the root child with the most visits, nudged by the
 * grudge ledger (visits × (1 + λ × grudgeNorm(target))).
 */
export function findBestAction(
  state: GameState,
  player: PlayerId,
  opts: SearchOptions,
  rng: Rng,
): AiAction | null {
  const moves = legalActions(state, player);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];

  const now = typeof performance !== 'undefined' ? performance.now.bind(performance) : Date.now;
  const start = now();
  const root: Node = {
    action: null,
    player,
    parent: null,
    children: new Map(),
    visits: 0,
    wins: 0,
    untried: null,
  };

  for (let i = 0; i < opts.iterations; i++) {
    if (now() - start > opts.timeLimitMs) break;

    // 1. Sample a deterministic world.
    const world = sampleWorld(state, rng, player);

    // 2. Select: walk the tree until a node needs expansion.
    let node = root;
    let simState = world;
    let mover = world.currentPlayer;
    while (!simState.gameOver) {
      if (legalActions(simState, mover).length === 0) {
        simState = simEndTurn(simState, mover, rng);
        mover = simState.currentPlayer;
        continue;
      }
      if (node.untried === null) {
        node.untried = untriedMoves(simState, mover, node);
      }
      if (node.untried.length > 0 || node.children.size === 0) break;

      // Full node → UCB descent.
      let best: Node | null = null;
      let bestScore = -Infinity;
      for (const child of node.children.values()) {
        const score = ucb(child, Math.max(1, node.visits));
        if (score > bestScore) {
          bestScore = score;
          best = child;
        }
      }
      if (!best) break;
      const applied = simApply(simState, best.action!, best.player, rng);
      if (!applied.ok) {
        // Stale child (illegal under this sample) — drop and re-select.
        node.children.delete(actionKey(best.action!));
        continue;
      }
      node = best;
      mover = best.player;
      simState = applied.state;
    }

    // 3. Expand one node (skip the iteration if the action fails to apply).
    if (!simState.gameOver && node.untried !== null && node.untried.length > 0) {
      const action = node.untried.shift()!;
      const child: Node = {
        action,
        player: mover,
        parent: node,
        children: new Map(),
        visits: 0,
        wins: 0,
        untried: null,
      };
      const applied = simApply(simState, action, mover, rng);
      if (applied.ok) {
        node.children.set(actionKey(action), child);
        node = child;
        simState = applied.state;
      }
    }

    // 4. Rollout + backprop.
    const result = rollout(simState, mover, player, opts.depth, rng);
    let cur: Node | null = node;
    while (cur !== null) {
      cur.visits++;
      cur.wins += result;
      cur = cur.parent;
    }
  }

  // Pick the root child with the most visits, nudged by the grudge ledger:
  // visits × (1 + λ × grudgeNorm(target)). Keeps MCTS largely win-rate driven
  // with a light revenge bias toward players who attacked us.
  let best: Node | null = null;
  let bestScore = -Infinity;
  for (const child of root.children.values()) {
    const target = actionTargetPlayer(state, child.action!);
    const grudge = target !== null ? effectiveGrudge(state, player, target) : 0;
    const grudgeNorm = grudge / (1 + grudge);
    const score = child.visits * (1 + AI_MCTS_GRUDGE_LAMBDA * grudgeNorm);
    if (score > bestScore) {
      bestScore = score;
      best = child;
    }
  }
  return best ? best.action : moves[0];
}
