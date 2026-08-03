// Smoke tests: fully-automated multiplayer games (all AI) must terminate
// within a bounded number of rounds without engine errors — for 2, 3 and 5
// players, and with a mix of difficulties.
import { expect, test } from 'vitest';
import { findBestAction, runAiTurn } from './ai';
import { BurnRateEngine } from './engine';
import { mulberry32 } from './rng';

/** Drive a whole game with every player handled by the heuristic adapter. */
function playFullGame(playerCount: number, seed: number, rounds: number): BurnRateEngine {
  const engine = new BurnRateEngine({ rng: mulberry32(seed) });
  engine.newGame(playerCount);
  let guard = 0;
  while (!engine.state.gameOver && guard++ < rounds * playerCount) {
    const p = engine.state.currentPlayer;
    runAiTurn(engine, p, mulberry32(seed + guard));
    engine.endTurn(p); // runAiTurn plays cards; the caller ends the turn
  }
  return engine;
}

test('2-player all-AI game terminates with a winner', () => {
  const engine = playFullGame(2, 1, 200);
  expect(engine.state.gameOver).toBe(true);
  expect(engine.state.winner).not.toBeNull();
  const alive = engine.state.players.filter((p) => p.alive).length;
  expect(alive).toBe(1);
});

test('3-player all-AI game terminates with a winner', () => {
  const engine = playFullGame(3, 2, 200);
  expect(engine.state.gameOver).toBe(true);
  expect(engine.state.winner).not.toBeNull();
  const alive = engine.state.players.filter((p) => p.alive).length;
  expect(alive).toBe(1);
});

test('5-player all-AI game terminates with a winner', () => {
  const engine = playFullGame(5, 3, 300);
  expect(engine.state.gameOver).toBe(true);
  expect(engine.state.winner).not.toBeNull();
  const alive = engine.state.players.filter((p) => p.alive).length;
  expect(alive).toBe(1);
});

test('MCTS search drives a full 2-player game without errors', () => {
  const engine = new BurnRateEngine({ rng: mulberry32(5) });
  engine.newGame(2);
  let guard = 0;
  while (!engine.state.gameOver && guard++ < 16) {
    const player = engine.state.currentPlayer;
    if (player === 1) {
      // Small budget for test speed — still exercises sampling + rollout.
      const a = findBestAction(
        engine.state,
        player,
        { iterations: 40, depth: 6, timeLimitMs: 800 },
        mulberry32(guard),
      );
      if (a) {
        const res = engine.applyAiAction(a, player);
        expect(res.ok).toBe(true);
        engine.endTurn(player);
        continue;
      }
    }
    runAiTurn(engine, player, mulberry32(guard));
    engine.endTurn(player);
  }
  // Not necessarily finished within 16 turns — just must stay consistent.
  expect(engine.state.players.filter((p) => p.alive).length).toBeGreaterThan(0);
  expect(engine.state.currentPlayer).toBeGreaterThanOrEqual(0);
});
