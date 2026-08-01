// 💡 Hint composable — "show me the next move" backed by the tools/solver
// search, cached by the current board's canonical solver state key.
//
// Click behaviour:
//   1. If a solution for the CURRENT state is cached → execute its next step
//      (a positional user move mapped onto the engine via moveCard, or a
//      dragon collect). Auto-moves are handled by the engine itself.
//   2. Otherwise ask the solver worker (solve → compress, ~30s on the hard
//      layout), cache the compressed user-step list, then execute step 1.
//
// Cache: Map<stateKey, { steps, pos }> with an LRU cap. Advancing one step
// stores the SAME solution under the NEW state's key, so rapid consecutive
// clicks replay the whole solution without re-solving. Any manual move or
// undo changes the state key → cache miss → fresh solve (never a stale step).
// A new game clears the worker + cache.

import { ref, watch } from 'vue';
// @ts-ignore — tools/solver is plain JS (browser-safe subset)
import { stateKey } from '../../tools/solver/rules.js';
import { toSolverState, type SolverStepRecord, type SolverUserStep } from '../game/solverAdapter';
import type { Card, DestDescriptor } from '../game/types';
import Searcher from '../worker/solver.worker.ts?worker';
import type { SolitaireGameApi } from './useSolitaireGame';

const CACHE_MAX = 10;
const HINT_MSG_MS = 3200;

interface HintEntry {
  steps: SolverUserStep[];
  pos: number;
}

interface WorkerResult {
  id: number;
  ok: boolean;
  reason?: string;
  steps?: SolverStepRecord[];
}

export function useHint(game: SolitaireGameApi) {
  /** True while a solve is in flight (button shows ⏳ and is disabled). */
  const solving = ref(false);
  /** Transient feedback text (solved count / failures), auto-dismissed. */
  const hintMsg = ref('');

  const cache = new Map<string, HintEntry>();
  let worker: InstanceType<typeof Searcher> | null = null;
  let reqId = 0;
  let pendingKey: string | null = null;
  let msgTimer: ReturnType<typeof setTimeout> | null = null;

  function showMsg(text: string): void {
    hintMsg.value = text;
    if (msgTimer !== null) clearTimeout(msgTimer);
    msgTimer = setTimeout(() => {
      hintMsg.value = '';
    }, HINT_MSG_MS);
  }

  function cachePut(key: string, entry: HintEntry): void {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  /** Solver state key of the CURRENT board (same canonicalization the search uses). */
  function currentKey(): string {
    return stateKey(toSolverState(game.state.value));
  }

  /**
   * Execute ONE cached user step against the current engine state. Positional
   * moves are re-sliced from the live board (column arrays match the solver's
   * model, stack top = col[last]), so no card ids are shared.
   * Returns null on success, or a human-readable failure reason.
   */
  function executeStep(step: SolverUserStep): string | null {
    if (step.kind === 'collect') {
      return game.collectDragons(step.color) ? null : '收龙失败（龙未就绪）';
    }
    const st = game.state.value;
    let run: Card[] | null = null;
    if (step.from.zone === 'tableau') {
      const col = st.tableau[step.from.col];
      if (step.from.start >= col.length) return '源列已无牌';
      run = col.slice(step.from.start);
    } else {
      const fc = st.freeCells[step.from.idx];
      if (!fc || fc.type === 'dragonpile') return '空闲格为空或已锁定';
      run = [fc as Card];
    }
    if (!run || run.length === 0 || !run[0]) return '源位置为空';
    const res = game.moveCard(run, step.to as DestDescriptor);
    return res.ok ? null : `移动被拒绝（${res.reason}）`;
  }

  function ensureWorker(): InstanceType<typeof Searcher> {
    if (worker) return worker;
    worker = new Searcher();
    worker.onmessage = (e: MessageEvent<WorkerResult>) => {
      const msg = e.data;
      solving.value = false;
      if (!msg.ok || !msg.steps) {
        showMsg(msg.reason === 'no-solution' ? '当前局面无解' : '本次求解失败，请重试');
        return;
      }
      // The player may have moved while solving — only apply a solution that
      // still matches the state it was computed for.
      if (pendingKey !== null && currentKey() !== pendingKey) return;
      const steps = msg.steps
        .filter((s) => s.user !== null)
        .map((s) => s.user as SolverUserStep);
      if (steps.length === 0 || pendingKey === null) return;
      cachePut(pendingKey, { steps, pos: 0 });
      advance(pendingKey);
    };
    worker.onerror = () => {
      solving.value = false;
      showMsg('求解器异常');
    };
    return worker;
  }

  /** Execute the next cached step for `key` and re-key the cache to the post-step state. */
  function advance(key: string): void {
    const entry = cache.get(key);
    if (!entry) return;
    if (entry.pos >= entry.steps.length) {
      // Solution exhausted — the engine should have reported a win by now;
      // if not (e.g. manual interference) drop the stale entry.
      cache.delete(key);
      return;
    }
    const step = entry.steps[entry.pos];
    const fail = executeStep(step);
    if (fail !== null) {
      cache.delete(key); // board no longer matches the solution — re-solve next click
      showMsg(`提示步骤无法执行：${fail}`);
      return;
    }
    entry.pos += 1;
    const nextKey = currentKey();
    if (nextKey !== key) cachePut(nextKey, entry);
  }

  /** 💡 Click: cached → step; uncached → solve (worker) then step. */
  function hintOnce(): void {
    if (solving.value || game.won.value || game.justDealt.value) return;
    const key = currentKey();
    const entry = cache.get(key);
    if (entry) {
      advance(key);
      return;
    }
    solving.value = true;
    pendingKey = key;
    const id = ++reqId;
    ensureWorker().postMessage({ id, state: toSolverState(game.state.value) });
  }

  /** Clear worker + cache (new game; also stops any in-flight solve). */
  function reset(): void {
    cache.clear();
    solving.value = false;
    pendingKey = null;
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  // A fresh deal invalidates everything — terminate mid-flight solves too.
  watch(game.justDealt, (v) => {
    if (v) reset();
  });

  return { solving, hintMsg, hintOnce, reset };
}

export type HintApi = ReturnType<typeof useHint>;
