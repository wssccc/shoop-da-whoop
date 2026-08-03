// Mass self-play benchmark — 4-player all-heuristic games, seeded & repeatable.
//
// This is the *baseline + A/B* harness for the playability tuning program:
// the same file runs unchanged on both rule sets, so a code diff between
// rule versions is the only variable. Metrics (see consensus spec):
//   1. win rate by seat & by dice first-mover (fairness)
//   2. rounds distribution (mean/median/p90) — pacing
//   3. first bankruptcy round distribution — "early death / dead time"
//   4. comeback: players who were at some point the strictly-lowest alive
//      cash player, and how many of them went on to win — catch-up signal
//
// Run:
//   BENCH_MASS=1 npx vitest run games/burnrate/src/game/bench-mass.test.ts
//   (or `npm run bench:burnrate:mass`)
// Env knobs:
//   BENCH_GAMES   (default 10_000)
//   BENCH_PLAYERS (default 4)
// Default (no BENCH_MASS=1) the whole group is skipped so normal test runs
// stay fast.

import { test } from 'vitest';
import { runAiTurn } from './ai';
import { BurnRateEngine } from './engine';
import { mulberry32 } from './rng';
import type { PlayerId } from './types';

const RUN = process.env.BENCH_MASS === '1';
const GAMES = Number(process.env.BENCH_GAMES ?? 10_000);
const PLAYERS = Number(process.env.BENCH_PLAYERS ?? 4);
const MAX_ROUNDS = 400;

interface GameMetrics {
  winner: PlayerId | null;
  /** Dice winner who moved first (null on abort). */
  firstPlayer: PlayerId | null;
  /** `state.turn` at game over — one full round = back to player 0. */
  rounds: number;
  /** Round of the *first* bankruptcy, or null if the guard aborted. */
  firstBankruptRound: number | null;
  /** Players who were ever the strictly-lowest *alive* cash player. */
  everStrictLowest: PlayerId[];
  aborted: boolean;
}

function playGame(seed: number): GameMetrics {
  const engine = new BurnRateEngine({ rng: mulberry32(seed) });
  // Dice decides the first mover, exactly like the UI flow.
  const roll = engine.rollFirst(PLAYERS);
  engine.newGame(PLAYERS, { firstPlayer: roll.winner });

  const everStrictLowest = new Set<PlayerId>();
  let firstBankruptRound: number | null = null;
  let aborted = false;
  let guard = 0;
  while (!engine.state.gameOver && guard++ < MAX_ROUNDS * PLAYERS) {
    const p = engine.state.currentPlayer;
    runAiTurn(engine, p, mulberry32(seed * 1000 + guard * 100 + 7));
    const res = engine.endTurn(p);
    if (res.bankrupt && firstBankruptRound === null) {
      firstBankruptRound = engine.state.turn;
    }
    // Strictly-lowest tracking, after burn settle (+ next mover's draw).
    const alive = engine.state.players
      .map((pl, idx) => ({ idx, cash: pl.cash, alive: pl.alive }))
      .filter((x) => x.alive);
    if (alive.length > 1) {
      const minCash = Math.min(...alive.map((x) => x.cash));
      const lowest = alive.filter((x) => x.cash === minCash);
      if (lowest.length === 1) everStrictLowest.add(lowest[0].idx);
    }
  }
  if (!engine.state.gameOver) aborted = true;
  return {
    winner: engine.state.winner,
    firstPlayer: roll.winner,
    rounds: engine.state.turn,
    firstBankruptRound,
    everStrictLowest: [...everStrictLowest],
    aborted,
  };
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = n >> 1;
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

function summarize(rows: GameMetrics[]): Record<string, unknown> {
  const n = rows.length;
  const finished = rows.filter((g) => !g.aborted);
  const seatWins = new Array<number>(PLAYERS).fill(0);
  let firstWins = 0;
  let notFirstWins = 0;
  const rounds: number[] = [];
  const firstBankrupt: number[] = [];
  let winnerEverLowest = 0;
  let lowestPlayers = 0;
  let lowestPlayersWhoWon = 0;

  for (const g of finished) {
    if (g.winner !== null) {
      seatWins[g.winner]++;
      if (g.firstPlayer === g.winner) firstWins++;
      else notFirstWins++;
      if (g.everStrictLowest.includes(g.winner)) winnerEverLowest++;
    }
    rounds.push(g.rounds);
    if (g.firstBankruptRound !== null) firstBankrupt.push(g.firstBankruptRound);
    for (const idx of g.everStrictLowest) {
      lowestPlayers++;
      if (g.winner === idx) lowestPlayersWhoWon++;
    }
  }
  rounds.sort((a, b) => a - b);
  firstBankrupt.sort((a, b) => a - b);

  const bucket = (xs: number[], edges: number[]): number[] =>
    edges.map((e, i) => xs.filter((x) => (i === 0 ? x <= e : x > edges[i - 1] && x <= e)).length);

  return {
    players: PLAYERS,
    games: n,
    aborted: rows.filter((g) => g.aborted).length,
    seatWinRate: seatWins.map((w) => Math.round((w / n) * 1000) / 10),
    firstMover: {
      firstWinRate: Math.round((firstWins / n) * 1000) / 10,
      notFirstWinRate: Math.round((notFirstWins / n) * 1000) / 10,
    },
    rounds: {
      mean: Math.round((rounds.reduce((a, b) => a + b, 0) / Math.max(1, rounds.length)) * 10) / 10,
      median: median(rounds),
      p90: pct(rounds, 90),
      max: rounds.at(-1) ?? 0,
    },
    firstBankruptRound: {
      mean: Math.round((firstBankrupt.reduce((a, b) => a + b, 0) / Math.max(1, firstBankrupt.length)) * 10) / 10,
      median: median(firstBankrupt),
      p90: pct(firstBankrupt, 90),
      buckets: bucket(firstBankrupt, [5, 10, 15, 20, 30, 40, Number.MAX_SAFE_INTEGER]),
    },
    comeback: {
      winnerEverLowestRate: Math.round((winnerEverLowest / Math.max(1, finished.length)) * 1000) / 10,
      lowestPlayerWinRate: Math.round((lowestPlayersWhoWon / Math.max(1, lowestPlayers)) * 1000) / 10,
    },
  };
}

test('bench:mass 4p all-heuristic baseline/A-B harness', { skip: !RUN, timeout: 0 }, () => {
  const t0 = Date.now();
  const rows: GameMetrics[] = [];
  for (let g = 0; g < GAMES; g++) rows.push(playGame(g + 1));
  const ms = Date.now() - t0;
  const summary = summarize(rows);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      { ...summary, wallMs: ms, msPerGame: Math.round((ms / GAMES) * 10) / 10 },
      null,
      2,
    ),
  );
  // eslint-disable-next-line no-console
  console.table(
    summary.seatWinRate.map((rate, seat) => ({
      seat,
      winRate: `${rate}%`,
      firstMover: rows.filter((g) => g.firstPlayer === seat).length,
    })),
  );
});
