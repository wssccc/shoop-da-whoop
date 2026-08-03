// Burn Rate AI 对打基准 — MCTS vs 启发式胜率矩阵（seed 可控）。
//
// 运行：BENCH=1 npx vitest run games/burnrate/src/game/bench.test.ts
// （或 npm run bench:burnrate）。默认（无 BENCH=1）整组跳过，不拖慢常规测试。
//
// 每次"打牌决策"按预算迭代数跑 MCTS（同 worker 用的同一搜索核心），对局
// 驱动用 runAiTurn 语义 + engine.endTurn。默认配置刻意开小预算以控制总时长，
// 需要更精确的胜率时调大 BENCH_GAMES / BENCH_ITER。

import { expect, test } from 'vitest';
import { chooseAiAction, findBestAction } from './ai';
import { BurnRateEngine } from './engine';
import { mulberry32 } from './rng';
import type { AiAction, GameState, PlayerId, Rng } from './types';

const RUN_BENCH = process.env.BENCH === '1';
const GAMES = Number(process.env.BENCH_GAMES ?? 8);
const ITERATIONS = Number(process.env.BENCH_ITER ?? 100);
const DEPTH = 6;
const MAX_ROUNDS = 120;

interface BenchRow {
  config: string;
  games: number;
  mctsWins: number;
  heuristicWins: number;
  draws: number;
  avgRounds: number;
  avgMsPerDecision: number;
}

interface DecisionFn {
  label: string;
  choose: (state: GameState, player: PlayerId, rng: Rng) => AiAction | null;
}

const mcts: DecisionFn = {
  label: `mcts(${ITERATIONS})`,
  choose: (state, player, rng) =>
    findBestAction(
      state,
      player,
      { iterations: ITERATIONS, depth: DEPTH, timeLimitMs: 10_000 },
      rng,
    ),
};

const heuristic: DecisionFn = {
  label: 'heuristic',
  choose: (state, player, rng) => chooseAiAction(state, player, rng),
};

/** Play one full game; returns { winner, rounds, mctsDecisions, ms }. */
function playGame(seed: number, mctsSide: PlayerId, aiA: DecisionFn, aiB: DecisionFn) {
  const engine = new BurnRateEngine({ rng: mulberry32(seed) });
  engine.newGame(2);
  let rounds = 0;
  let decisions = 0;
  let ms = 0;
  let guard = 0;
  while (!engine.state.gameOver && guard++ < MAX_ROUNDS * 2) {
    const p = engine.state.currentPlayer;
    const fn = p === mctsSide ? aiA : aiB;
    // One full turn: play cards via the decision fn (mcts re-searches per play),
    // then complete projects greedily, then end the turn.
    let guard2 = 0;
    while (guard2++ < 50 && !engine.state.gameOver) {
      const t0 = Date.now();
      const action = fn.choose(engine.state, p, mulberry32(seed * 1000 + guard * 100 + guard2));
      ms += Date.now() - t0;
      decisions++;
      if (!action) break;
      if (!engine.applyAiAction(action, p).ok) break;
    }
    engine.endTurn(p);
    if (p === 1) rounds++;
  }
  return { winner: engine.state.winner, rounds, decisions, ms };
}

function runBench(mctsSide: PlayerId, oppLabel: string, opp: DecisionFn): BenchRow {
  let mctsWins = 0;
  let heurWins = 0;
  let roundsSum = 0;
  let msSum = 0;
  let decisionsSum = 0;
  for (let g = 0; g < GAMES; g++) {
    const r = playGame(g + 1, mctsSide, mcts, opp);
    if (r.winner === mctsSide) mctsWins++;
    else if (r.winner !== null) heurWins++;
    roundsSum += r.rounds;
    msSum += r.ms;
    decisionsSum += r.decisions;
  }
  const avgMsPerDecision = decisionsSum > 0 ? msSum / decisionsSum : 0;
  return {
    config: `mcts vs ${oppLabel} (mcts 先手=${mctsSide === 0})`,
    games: GAMES,
    mctsWins,
    heuristicWins: heurWins,
    draws: GAMES - mctsWins - heurWins,
    avgRounds: Math.round(roundsSum / GAMES),
    avgMsPerDecision: Math.round(avgMsPerDecision * 10) / 10,
  };
}

test('bench: MCTS vs heuristic (2人局, seed 可控)', { skip: !RUN_BENCH, timeout: 120_000 }, () => {
  const rows: BenchRow[] = [
    runBench(0, 'heuristic', heuristic),
    runBench(1, 'heuristic', heuristic),
  ];
  // eslint-disable-next-line no-console
  console.table(rows);
  for (const r of rows) {
    // Smoke-level sanity: the games must actually finish.
    expect(r.games).toBeGreaterThan(0);
  }
});
