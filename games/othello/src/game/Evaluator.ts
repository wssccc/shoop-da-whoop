// 双头评价函数：价值头 V(s) + 策略头 π(a|s)
// 修复版：优化性能，修正评分范围

import { OthelloGame, WEIGHT_TABLE, type Position } from './OthelloGame';

// Softmax 函数
function softmax(scores: number[]): number[] {
  const maxScore = Math.max(...scores);
  const expScores = scores.map(s => Math.exp(s - maxScore));
  const sumExp = expScores.reduce((a, b) => a + b, 0);
  return expScores.map(s => s / sumExp);
}

// ============ 价值头 V(s)：局面评分 ============
/**
 * 评价局面价值，返回值在 [-1, 1] 之间
 * 1 表示 currentPlayer 极大优势，-1 表示极大劣势
 */
export function evaluateValue(game: OthelloGame): number {
  const empty = game.countEmpty();
  
  // 终局精确评估（empty <= 12）
  if (empty <= 12) {
    const score = game.getScore();
    const myScore = game.currentPlayer === 1 ? score.black : score.white;
    const oppScore = game.currentPlayer === 1 ? score.white : score.black;
    const diff = myScore - oppScore;
    // 用更平缓的映射，保留差异信息
    if (diff > 0) return Math.min(0.5 + diff * 0.05, 0.95);
    if (diff < 0) return Math.max(-0.5 + diff * 0.05, -0.95);
    return 0;
  }

  // 1. 位置权重（查表）
  let posScore = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (game.board[row][col] === game.currentPlayer) {
        posScore += WEIGHT_TABLE[row][col];
      } else if (game.board[row][col] !== 0) {
        posScore -= WEIGHT_TABLE[row][col];
      }
    }
  }

  // 2. 行动力差（核心指标）
  const myMob = game.getValidMoves(game.currentPlayer).length;
  const oppMob = game.getValidMoves(game.getOpponent(game.currentPlayer)).length;
  const mobScore = (myMob - oppMob) * 12;

  // 3. 稳定子差
  const myStable = game.countStable(game.currentPlayer);
  const oppStable = game.countStable(game.getOpponent(game.currentPlayer));
  const stableScore = (myStable - oppStable) * 30;

  // 4. 前沿棋子差（前沿越少越好）
  const myFrontier = game.countFrontier(game.currentPlayer);
  const oppFrontier = game.countFrontier(game.getOpponent(game.currentPlayer));
  const frontScore = (oppFrontier - myFrontier) * 6;

  // 5. 奇偶性
  const parityScore = (empty % 2 === 1) ? 15 : -15;

  // 根据游戏阶段调整权重
  const stage = getGameStage(empty);
  
  let raw: number;
  if (stage === 'opening') {
    raw = posScore * 1.0 + mobScore * 2.0 + stableScore * 0.3 + frontScore * 1.0 + parityScore * 0.3;
  } else if (stage === 'midgame') {
    raw = posScore * 0.8 + mobScore * 2.5 + stableScore * 1.0 + frontScore * 1.5 + parityScore * 0.8;
  } else {
    raw = posScore * 0.5 + mobScore * 1.5 + stableScore * 2.0 + frontScore * 0.8 + parityScore * 1.5;
  }

  // 归一化：预估raw范围约 [-400, 400]，用tanh平滑
  return Math.tanh(raw / 200);
}

// ============ 策略头 π(a|s)：走法先验 ============
export function evaluatePolicy(game: OthelloGame, moves: Position[]): number[] {
  if (moves.length === 0) return [];
  if (moves.length === 1) return [1.0];

  const scores: number[] = [];

  for (const move of moves) {
    // 执行该步后的局面价值（对手视角的负值=对我有利）
    const nextGame = game.clone();
    nextGame.makeMove(move.row, move.col);
    nextGame.switchPlayer();
    
    const base = -evaluateValue(nextGame) * 0.5;

    // 位置特征
    let featureScore = 0;
    if (game.isCorner(move)) featureScore += 1.5;
    if (game.isXSquare(move)) featureScore -= 1.0;
    if (game.isCSquare(move)) featureScore -= 0.5;
    if (game.isEdge(move)) featureScore += 0.4;

    // 行动力增益
    const myNextMob = nextGame.getValidMoves(game.currentPlayer).length;
    featureScore += myNextMob * 0.015;

    // 前沿减少
    const myFrontierBefore = game.countFrontier(game.currentPlayer);
    const myFrontierAfter = nextGame.countFrontier(game.currentPlayer);
    featureScore += (myFrontierBefore - myFrontierAfter) * 0.08;

    scores.push(base + featureScore);
  }

  return softmax(scores);
}

// ============ 快速策略（用于Rollout） ============
/**
 * 轻量策略：不克隆游戏，只基于位置特征+快速启发式
 * 返回评分数组（越大越好）
 */
export function fastPolicy(game: OthelloGame, moves: Position[]): number[] {
  if (moves.length === 0) return [];

  const scores: number[] = [];
  const moveCount = moves.length;

  for (let i = 0; i < moveCount; i++) {
    const move = moves[i];
    let score = WEIGHT_TABLE[move.row][move.col];

    // 位置类型加成
    if (game.isCorner(move)) {
      score += 500;  // 最高优先级
    } else if (game.isXSquare(move)) {
      score -= 300;  // 强烈避免
    } else if (game.isCSquare(move)) {
      score -= 150;  // 避免
    } else if (game.isEdge(move)) {
      score += 80;   // 鼓励占边
    }

    scores.push(score);
  }

  return scores;
}

// ============ 辅助函数 ============

function getGameStage(emptyCount: number): 'opening' | 'midgame' | 'endgame' {
  if (emptyCount >= 40) return 'opening';
  if (emptyCount >= 20) return 'midgame';
  return 'endgame';
}
