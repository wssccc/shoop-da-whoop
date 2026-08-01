// DFS solver for the Solitaire puzzle.
//
// Strategy: iterative (explicit-stack) graph search over post-auto-cascade
// states, with:
//   - a global visited set keyed by the canonical state key (a state's full
//     successor set is deterministic, so the first visit is sufficient to find
//     ANY win),
//   - one-ply look-ahead move ordering: every candidate user move is applied
//     on a scratch clone, its forced auto-move cascade counted, and moves that
//     trigger foundation/flower sends or collect dragons are tried first,
//   - beam iterations: search tries the top-K scored moves per node first
//     (narrow, focused), widening K on each retry up to an unlimited final
//     pass, so a missed beam never loses a solution permanently,
//   - node + wall-clock budgets per attempt and overall, aborting cleanly.
//
// Every node in the solution = ONE user action followed by its forced safe
// auto-move cascade, matching engine.ts semantics (snapshot once per user
// action, then applyAutoMoves() to convergence).

import {
    cloneState,
    commitUserMove,
    exposedDragonCount,
    genUserMoves,
    isReversibleStep,
    isWin,
    runAutoMoves,
    stateKey,
} from './rules.js';

const DEFAULT_ATTEMPTS = [
  { beam: 8, maxNodes: 2_000_000, timeMs: 60_000 },
  { beam: 24, maxNodes: 5_000_000, timeMs: 120_000 },
  { beam: 0, maxNodes: 12_000_000, timeMs: 240_000 }, // unlimited (final pass)
  { beam: 12, random: true, maxNodes: 4_000_000, timeMs: 120_000 },
  { beam: 12, random: true, maxNodes: 4_000_000, timeMs: 120_000 },
];

/**
 * Solve from `initial`. Options: { attempts, maxDepth }.
 * Returns:
 *   { ok:true, steps, nodes, keySize, beam, elapsedMs }
 *   { ok:false, reason:'budget'|'no-solution', nodes, keySize, elapsedMs }
 *
 * `steps` is an array of { user, auto } where:
 *   user = a move object (kind 'move'|'collect') — the player action
 *   auto = array of auto-move records { card, from, to } fired right after it
 *
 * Any auto-moves present on the INITIAL board are returned as a leading entry
 * with user === null.
 */
export function solve(initial, opts = {}) {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS;
  const maxDepth = opts.maxDepth ?? Number(process.env.SOLVER_MAX_DEPTH ?? 500);
  const start = Date.now();
  let totalNodes = 0;
  let bestProgress = 0;
  const onAttempt = opts.onAttempt ?? (() => {});
  // Custom goal predicate (default: win). Used for reachability probes.
  const goal = opts.goal ?? isWin;
  const goalName = opts.goalName ?? 'win';
  for (const attempt of attempts) {
    const visited = new Set();
    let nodes = 0;
    const attemptStart = Date.now();

    const state0 = cloneState(initial);
    const leadingAuto = runAutoMoves(state0);
    visited.add(stateKey(state0));

    if (isWin(state0)) {
      const steps = leadingAuto.length ? [{ user: null, auto: leadingAuto }] : [];
      return ok(steps, totalNodes, visited.size, attempt.beam, Date.now() - start);
    }

    const deadline = Date.now() + attempt.timeMs;
    const stack = [{ state: state0, m: null, auto: leadingAuto, depth: 0, children: null, ci: 0 }];
    let aborted = false;

    while (stack.length) {
      const top = stack[stack.length - 1];

      if (goal(top.state)) {
        const steps = [];
        if (leadingAuto.length) steps.push({ user: null, auto: leadingAuto });
        for (let i = 1; i < stack.length; i++) {
          steps.push({ user: stack[i].m, auto: stack[i].auto });
        }
        return ok(steps, totalNodes + nodes, visited.size, attempt.beam, Date.now() - start);
      }

      if (nodes > attempt.maxNodes || Date.now() > deadline) {
        aborted = true;
        break;
      }

      if (!top.children) {
        nodes++;
        top.children = buildChildren(top.state, visited, attempt.beam, maxDepth, top.depth, !!attempt.random);
        top.ci = 0;
      }

      if (top.ci >= top.children.length) {
        stack.pop(); // exhausted this node — backtrack
        continue;
      }

      const ch = top.children[top.ci++];
      const p = progressScore(ch.next);
      if (p > bestProgress) bestProgress = p;
      visited.add(ch.k); // mark explored before pushing — prevents re-walking
      stack.push({ state: ch.next, m: ch.m, auto: ch.auto, depth: top.depth + 1, children: null, ci: 0 });
    }

    totalNodes += nodes;
    onAttempt(attempts.indexOf(attempt) + 1, attempts.length, attempt.beam, nodes, Date.now() - attemptStart);
    // Last attempt exhausted without a win → genuinely no solution found.
    if (!aborted && attempt === attempts[attempts.length - 1]) {
      return {
        ok: false,
        reason: 'no-solution',
        nodes: totalNodes,
        keySize: visited.size,
        bestProgress,
        elapsedMs: Date.now() - start,
      };
    }
    // else: budget hit — widen the beam and retry.
  }

  return {
    ok: false,
    reason: 'budget',
    nodes: totalNodes,
    keySize: 0,
    bestProgress,
    elapsedMs: Date.now() - start,
  };
}

function foundationProgress(state) {
  let f = 0;
  for (const pile of Object.values(state.foundations)) f += pile.length;
  return f;
}

/** Composite progress used for diagnostics: foundations + collected colours
 *  (big weight — unburying & collecting dragons is the core of the puzzle). */
export function progressScore(state) {
  let f = 0;
  for (const pile of Object.values(state.foundations)) f += pile.length;
  let collected = 0;
  for (const fc of state.freeCells) if (fc && fc.type === 'dragonpile') collected++;
  return f + collected * 12 + (state.flowerSlot ? 5 : 0);
}

function buildChildren(state, visited, beam, maxDepth, depth, randomize) {
  if (depth >= maxDepth) return [];
  const moves = genUserMoves(state);
  const children = [];
  const preExposed = exposedDragonCount(state);

  for (const m of moves) {
    const next = cloneState(state);
    commitUserMove(next, m);
    const auto = runAutoMoves(next);
    const k = stateKey(next);
    if (visited.has(k)) continue;
    // score: base heuristic, minus big bonus per auto move fired (foundation /
    // flower sends are near-certain progress), minus extra for collects and
    // for newly exposed dragons (dragons are the biggest roadblock), plus a
    // small penalty for REVERSIBLE moves (their inverse is legal — they are
    // the detours the compressor later removes; slight bias is enough to try
    // irreversible progress first without starving necessary parking).
    const score =
      m.score -
      auto.length * 40 -
      (m.kind === 'collect' ? 15 : 0) -
      Math.max(0, exposedDragonCount(next) - preExposed) * 12 +
      (m.kind === 'move' && isReversibleStep(next, m) ? 2 : 0);
    children.push({ m, next, auto, k, score });
  }

  children.sort((a, b) => a.score - b.score);
  if (beam > 0 && children.length > beam) children.length = beam;
  if (randomize) shuffle(children);
  return children;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function ok(steps, nodes, keySize, beam, elapsedMs) {
  return { ok: true, steps, nodes, keySize, beam, elapsedMs };
}
