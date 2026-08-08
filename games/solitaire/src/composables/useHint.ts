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

import { dismissToast, toast } from '@solitaire/lib/toaster';
import { ref, watch } from 'vue';
// @ts-ignore — tools/solver is plain JS (browser-safe subset)
import { stateKey } from '../../tools/solver/rules.js';
import { toSolverState, type SolverStepRecord, type SolverUserStep } from '../game/solverAdapter';
import type { Card, DestDescriptor } from '../game/types';
import Searcher from '../worker/solver.worker.ts?worker';
import type { SolitaireGameApi } from './useSolitaireGame';

const CACHE_MAX = 10;

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

  const cache = new Map<string, HintEntry>();
  let worker: InstanceType<typeof Searcher> | null = null;
  let reqId = 0;
  let pendingKey: string | null = null;

  /** Transient feedback toast (solved count / failures); the fixed `hint` id
   *  replaces any previous hint toast (single-message semantics), and the
   *  reka-ui ToastRoot duration auto-dismisses it after 3.2s. */
  function showMsg(text: string): void {
    toast({ id: 'hint', title: text });
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
    try {
      if (step.kind === 'collect') {
        return game.collectDragons(step.color) ? null : '收龙失败（龙未就绪）';
      }
      const st = game.state.value;
      let run: Card[] | null = null;
      if (step.from.zone === 'tableau') {
        const col = st.tableau[step.from.col];
        if (!col || step.from.start >= col.length) return '源列已无牌';
        run = col.slice(step.from.start);
      } else {
        const fc = st.freeCells[step.from.idx];
        if (!fc || fc.type === 'dragonpile') return '空闲格为空或已锁定';
        run = [fc as Card];
      }
      if (!run || run.length === 0 || !run[0]) return '源位置为空';
      // Animated: the run FLIPs from its source slot to the destination (same
      // flight look as the auto-move cascade) instead of cutting in place.
      const res = game.moveCardAnimated(run, step.to as DestDescriptor);
      return res.ok ? null : `移动被拒绝（${res.reason}）`;
    } catch (err) {
      // A stale solver step (board changed under the cached solution) can
      // throw on out-of-range indices — surface it as a message instead of
      // silently wedging the hint pipeline.
      // eslint-disable-next-line no-console
      console.error('[solitaire] hint executeStep failed', err);
      return '求解步骤已过期，请重试';
    }
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
      if (pendingKey !== null && currentKey() !== pendingKey) {
        dismissToast('hint'); // stale solve — drop the 正在求解 toast
        return;
      }
      const steps = msg.steps
        .filter((s) => s.user !== null)
        .map((s) => s.user as SolverUserStep);
      if (steps.length === 0 || pendingKey === null) {
        dismissToast('hint');
        return;
      }
      // The solver collapses the initial auto-move cascade (leading
      // {user:null} records) BEFORE the first user step; the engine must
      // mirror that or the first step's coordinates (computed on the
      // post-cascade board) hit a stale layout — invalid-run / invalid-dest.
      const leading = msg.steps.find((s) => s.user === null && s.auto.length > 0);
      if (leading) game.applyAutoMoves();
      cachePut(pendingKey, { steps, pos: 0 });
      // Replace the long-running 正在求解 toast with a short confirmation
      // only when a step actually executed (advance may fail → it toasts).
      if (advance(pendingKey)) showMsg('已为你执行下一步');
    };
    worker.onerror = () => {
      solving.value = false;
      showMsg('求解器异常');
    };
    return worker;
  }

  /** Execute the next cached step for `key` and re-key the cache to the post-step state.
   *  Returns true when a step was executed (the caller may confirm it). */
  function advance(key: string): boolean {
    const entry = cache.get(key);
    if (!entry) return false;
    if (entry.pos >= entry.steps.length) {
      // Solution exhausted — the engine should have reported a win by now;
      // if not (e.g. manual interference) drop the stale entry.
      cache.delete(key);
      return false;
    }
    const step = entry.steps[entry.pos];
    const fail = executeStep(step);
    if (fail !== null) {
      // A failed step may leave an open unit behind (applyAutoMoves opened
      // it to mirror the solver's leading cascade, then the step never ran) —
      // close it so the NEXT drag/hint can't inherit its stale undo snapshot
      // (one undo would then revert the never-finished hint's auto-moves
      // along with the player's own move). abortUnit is a no-op when no unit
      // is open (cache-hit failures, collect failures).
      game.engine.abortUnit();
      cache.delete(key); // board no longer matches the solution — re-solve next click
      showMsg(`提示步骤无法执行：${fail}`);
      return false;
    }
    entry.pos += 1;
    const nextKey = currentKey();
    // The pre-step key must NOT keep the advanced entry: undoing back to it
    // would replay a step computed for a LATER board (invalid-dest etc.).
    // Drop it so any revert to this state misses → fresh solve.
    cache.delete(key);
    if (nextKey !== key) cachePut(nextKey, entry);
    return true;
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
    // Immediate, persistent feedback: a solve may run for up to a minute and
    // the fixed `hint` id keeps this toast visible until the result (step
    // confirmation or failure) replaces it.
    toast({ id: 'hint', title: '正在求解…', duration: 120_000 });
    const id = ++reqId;
    ensureWorker().postMessage({ id, state: toSolverState(game.state.value) });
  }

  /** Clear worker + cache (new game; also stops any in-flight solve). */
  function reset(): void {
    cache.clear();
    solving.value = false;
    pendingKey = null;
    dismissToast('hint');
    if (worker) {
      worker.terminate();
      worker = null;
    }
  }

  // A fresh deal invalidates everything — terminate mid-flight solves too.
  watch(game.justDealt, (v) => {
    if (v) reset();
  });

  // Undo pops the history stack — any cached solution now points at steps
  // computed for a LATER board. Drop the cache so the next hint re-solves
  // from the reverted state instead of replaying a stale step. (The engine
  // never shrinks history outside undo.)
  watch(
    () => game.state.value.history.length,
    (len, prev) => {
      if (prev !== null && len < prev) cache.clear();
    },
  );

  return { solving, hintOnce, reset };
}

export type HintApi = ReturnType<typeof useHint>;
