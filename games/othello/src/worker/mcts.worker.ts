/**
 * MCTS Web Worker
 *
 * Runs MCTS search off the main thread so the UI stays responsive,
 * especially at expert difficulty (6000 iterations ≈ 300-500ms).
 *
 * Communication protocol:
 *   Main → Worker: { type: 'findBestMove', board: Cell[][], currentPlayer: Player, difficulty: string }
 *   Worker → Main: { type: 'bestMove', row: number, col: number, elapsed: number }
 */

import { createMCTS } from '../game/MCTS';
import { OthelloGame, type Cell, type Player } from '../game/OthelloGame';

interface FindBestMoveMessage {
  type: 'findBestMove';
  board: Cell[][];
  currentPlayer: Player;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
}

interface BestMoveResponse {
  type: 'bestMove';
  row: number;
  col: number;
  elapsed: number;
}

self.onmessage = (e: MessageEvent<FindBestMoveMessage>) => {
  const { board, currentPlayer, difficulty } = e.data;

  // Reconstruct game from serialized state
  const game = new OthelloGame(8);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      game.board[r][c] = board[r][c];
    }
  }
  game.currentPlayer = currentPlayer;

  // Run MCTS
  const mcts = createMCTS(difficulty);
  const start = performance.now();
  const move = mcts.findBestMove(game);
  const elapsed = performance.now() - start;

  const response: BestMoveResponse = {
    type: 'bestMove',
    row: move?.row ?? -1,
    col: move?.col ?? -1,
    elapsed: Math.round(elapsed),
  };

  self.postMessage(response);
};
