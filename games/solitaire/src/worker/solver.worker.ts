/**
 * Solver Web Worker
 *
 * Runs the tools/solver search (solve → compress) off the main thread so the
 * UI stays responsive while the solver explores (typical hard layout: ~30-35s).
 * Classic worker via the `?worker` suffix — same pattern as othello's MCTS
 * worker — so legacy Safari (no module workers) can run it.
 *
 * tools/solver is plain JS ESM with no Node APIs in the imported subset
 * (search.js / compress.js / rules.js); `solve()` is always called with an
 * explicit maxDepth so its `process.env` fallback is never touched.
 *
 * Communication protocol:
 *   Main → Worker: { id, state }            — solver-format state (solverAdapter)
 *   Worker → Main: { id, ok, steps?, ... }  — compressed steps (user+auto records)
 *   Worker → Main: { id, ok:false, reason }
 */

// @ts-ignore — tools/solver is plain JS (browser-safe subset, see tools/solver/docs.md)
import { solve } from '../../tools/solver/search.js';
// @ts-ignore
import { compressSteps } from '../../tools/solver/compress.js';

import type { SolverState, SolverStepRecord } from '../game/solverAdapter';

interface SolveRequest {
  id: number;
  state: SolverState;
}

interface SolveResponse {
  id: number;
  ok: boolean;
  reason?: string;
  steps?: SolverStepRecord[];
  nodes?: number;
  keySize?: number;
  elapsedMs?: number;
  /** True when `steps` are the raw solver path (compression failed). */
  raw?: boolean;
}

function post(msg: SolveResponse): void {
  self.postMessage(msg);
}

self.onmessage = (e: MessageEvent<SolveRequest>) => {
  const { id, state } = e.data;
  const t0 = Date.now();
  try {
    const res = solve(state, {
      maxDepth: 500,
      attempts: [{ beam: 12, maxNodes: 4_000_000, timeMs: 60_000 }],
    });
    if (!res.ok) {
      post({ id, ok: false, reason: res.reason, elapsedMs: Date.now() - t0 });
      return;
    }
    const comp = compressSteps(state, res.steps);
    if (!comp.win) {
      // Compression failed (fixpoint check or an illegal rewrite) — fall back
      // to the RAW solver path instead of failing outright: solve() steps are
      // generated from topRunStart slices so they are always legal, and the
      // runtime engine's auto-move rules mirror the solver's exactly, so the
      // raw path executes reliably (just less compact).
      // NOTE: keep the FULL records (including leading {user:null} auto-move
      // records) — useHint mirrors the solver's pre-collapsed cascade via
      // applyAutoMoves() before the first user step; filtering them out here
      // would make the first step's coordinates land on a stale board.
      const rawUser = res.steps
        .filter((s: SolverStepRecord) => s.user !== null)
        .map((s: SolverStepRecord) => s.user);
      if (rawUser.length === 0) {
        post({ id, ok: false, reason: 'compress-failed', elapsedMs: Date.now() - t0 });
        return;
      }
      post({
        id,
        ok: true,
        steps: res.steps,
        nodes: res.nodes,
        keySize: res.keySize,
        elapsedMs: Date.now() - t0,
        raw: true,
      });
      return;
    }
    post({
      id,
      ok: true,
      steps: comp.steps,
      nodes: res.nodes,
      keySize: res.keySize,
      elapsedMs: Date.now() - t0,
    });
  } catch (err) {
    post({ id, ok: false, reason: `error: ${String(err)}` });
  }
};
