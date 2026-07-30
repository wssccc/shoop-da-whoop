// 经典MCTS + 好的rollout启发式
// 简化设计：统一从rootPlayer视角，UCB1选择，高质量rollout

import { OthelloGame, type Player, type Position } from './OthelloGame';
import { WEIGHT_TABLE } from './OthelloGame';

// UCB1常数
const EXPLORATION_C = 1.414;

// 经典MCTS节点
class MCTSNode {
  game: OthelloGame;
  parent: MCTSNode | null;
  children: MCTSNode[];
  move: Position | null;
  visits: number;
  wins: number; // 从rootPlayer视角的胜利次数
  untriedMoves: Position[];

  constructor(game: OthelloGame, parent: MCTSNode | null = null, move: Position | null = null) {
    this.game = game.clone();
    this.parent = parent;
    this.children = [];
    this.move = move;
    this.visits = 0;
    this.wins = 0;
    this.untriedMoves = game.getValidMoves();
  }

  ucb1(rootPlayerVisits: number): number {
    if (this.visits === 0) return Infinity;
    const exploitation = this.wins / this.visits;
    const exploration = EXPLORATION_C * Math.sqrt(Math.log(rootPlayerVisits) / this.visits);
    return exploitation + exploration;
  }

  selectBestChild(rootPlayerVisits: number): MCTSNode {
    let best = this.children[0];
    let bestScore = best.ucb1(rootPlayerVisits);
    for (let i = 1; i < this.children.length; i++) {
      const score = this.children[i].ucb1(rootPlayerVisits);
      if (score > bestScore) {
        best = this.children[i];
        bestScore = score;
      }
    }
    return best;
  }

  expand(): MCTSNode {
    // 按启发式排序：优先扩展好位置
    if (this.untriedMoves.length > 1 && this.parent !== null) {
      this.untriedMoves.sort((a, b) => {
        return heuristicScore(this.game, b) - heuristicScore(this.game, a);
      });
    }
    
    const move = this.untriedMoves.pop()!;
    const newGame = this.game.clone();
    newGame.makeMove(move.row, move.col);
    newGame.switchPlayer();
    
    const child = new MCTSNode(newGame, this, move);
    this.children.push(child);
    return child;
  }

  isFullyExpanded(): boolean {
    return this.untriedMoves.length === 0;
  }
}

// 为某个走法打快分（越高越好）
function heuristicScore(game: OthelloGame, move: Position): number {
  let score = WEIGHT_TABLE[move.row][move.col] * 2;

  // 角落 = 极高优先级
  if (isCorner(move)) score += 1000;
  // X位 = 强烈避免
  else if (isXSquare(move)) score -= 500;
  // C位 = 避免
  else if (isCSquare(move)) score -= 200;
  // 安全边 = 鼓励
  else if (isSafeEdge(game, move)) score += 100;
  // 普通边 = 小鼓励
  else if (isEdge(move)) score += 40;

  return score;
}

// 位置判断辅助函数
function isCorner(pos: Position): boolean {
  return (pos.row === 0 || pos.row === 7) && (pos.col === 0 || pos.col === 7);
}
function isXSquare(pos: Position): boolean {
  return (pos.row === 1 && pos.col === 1) || (pos.row === 1 && pos.col === 6) ||
         (pos.row === 6 && pos.col === 1) || (pos.row === 6 && pos.col === 6);
}
function isCSquare(pos: Position): boolean {
  return (pos.row === 0 && (pos.col === 1 || pos.col === 6)) ||
         (pos.row === 7 && (pos.col === 1 || pos.col === 6)) ||
         (pos.col === 0 && (pos.row === 1 || pos.row === 6)) ||
         (pos.col === 7 && (pos.row === 1 || pos.row === 6));
}
function isEdge(pos: Position): boolean {
  return (pos.row === 0 || pos.row === 7 || pos.col === 0 || pos.col === 7) &&
         !isCorner(pos) && !isXSquare(pos) && !isCSquare(pos);
}
// 安全边：有邻居角落已被占据的边
function isSafeEdge(game: OthelloGame, pos: Position): boolean {
  if (!isEdge(pos)) return false;
  const corners = [
    [0, 0], [0, 7], [7, 0], [7, 7]
  ];
  // 如果相邻角落被占据，这条边相对安全
  for (const [cr, cc] of corners) {
    if (game.board[cr][cc] !== 0) {
      // 检查pos是否在这条边上且靠近这个角落
      if ((pos.row === cr || pos.row === 7 - cr) && (pos.col === cc || pos.col === 7 - cc)) {
        return true;
      }
    }
  }
  return false;
}

export class MCTS {
  iterations: number;

  constructor(iterations: number = 2000) {
    this.iterations = iterations;
  }

  findBestMove(game: OthelloGame): Position | null {
    const validMoves = game.getValidMoves();
    if (validMoves.length === 0) return null;
    if (validMoves.length === 1) return validMoves[0];

    const rootPlayer = game.currentPlayer;
    const root = new MCTSNode(game);

    for (let i = 0; i < this.iterations; i++) {
      // 1. Select
      let node: MCTSNode = root;
      while (node.isFullyExpanded() && node.children.length > 0 && !node.game.isGameOver()) {
        node = node.selectBestChild(root.visits || 1);
      }

      // 2. Expand
      if (!node.game.isGameOver() && !node.isFullyExpanded()) {
        node = node.expand();
      }

      // 3. Simulate (rollout with good heuristic)
      const winner = this.rollout(node.game.clone(), rootPlayer);

      // 4. Backpropagate (all nodes from rootPlayer perspective)
      let current: MCTSNode | null = node;
      while (current !== null) {
        current.visits++;
        if (winner === rootPlayer) {
          current.wins++;
        }
        current = current.parent;
      }
    }

    // Select child with most visits
    let bestChild = root.children[0];
    for (let i = 1; i < root.children.length; i++) {
      if (root.children[i].visits > bestChild.visits) {
        bestChild = root.children[i];
      }
    }

    return bestChild.move;
  }

  // Rollout: 用好的启发式快速模拟到结束
  private rollout(game: OthelloGame, _rootPlayer: Player): Player | 0 {
    let passCount = 0;

    while (!game.isGameOver() && passCount < 2) {
      const moves = game.getValidMoves();
      if (moves.length === 0) {
        game.switchPlayer();
        passCount++;
        continue;
      }
      passCount = 0;

      // 选择走法：70%按启发式，30%随机
      let move: Position;
      if (Math.random() < 0.70) {
        move = this.selectHeuristicMove(game, moves);
      } else {
        move = moves[Math.floor(Math.random() * moves.length)];
      }

      game.makeMove(move.row, move.col);
      game.switchPlayer();
    }

    return game.getWinner();
  }

  // 启发式走子选择（选择得分最高的）
  private selectHeuristicMove(game: OthelloGame, moves: Position[]): Position {
    if (moves.length === 1) return moves[0];

    let bestMove = moves[0];
    let bestScore = -Infinity;

    for (const move of moves) {
      const score = this.evaluateMove(game, move);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  // 评估某个走法的价值（从game.currentPlayer视角）
  private evaluateMove(game: OthelloGame, move: Position): number {
    let score = 0;

    // 位置权重（最重要）
    score += WEIGHT_TABLE[move.row][move.col] * 3;

    // 角落 = 极高价值
    if (isCorner(move)) {
      score += 10000;
    }
    // X位 = 极低价值（送角落）
    else if (isXSquare(move)) {
      score -= 5000;
      // 如果对应角落已被我方占据，X位反而变安全
      const cornerRow = move.row <= 1 ? 0 : 7;
      const cornerCol = move.col <= 1 ? 0 : 7;
      if (game.board[cornerRow][cornerCol] === game.currentPlayer) {
        score += 4000; // 抵消负面并加分
      }
    }
    // C位 = 低价值
    else if (isCSquare(move)) {
      score -= 2000;
      const cornerRow = move.row === 0 || move.row === 1 ? 0 : 7;
      const cornerCol = move.col === 0 || move.col === 1 ? 0 : 7;
      if (game.board[cornerRow][cornerCol] === game.currentPlayer) {
        score += 1500;
      }
    }
    // 安全边
    else if (isSafeEdge(game, move)) {
      score += 500;
    }
    // 普通边
    else if (isEdge(move)) {
      score += 200;
    }

    // 模拟一步看结果（获取翻转数、行动力变化）
    const nextGame = game.clone();
    const flipped = nextGame.makeMove(move.row, move.col);
    nextGame.switchPlayer();

    // 翻转数（中局前不要贪多）
    const empty = game.countEmpty();
    if (empty > 40) {
      // 开局：少翻转更好（保持灵活）
      score -= flipped * 10;
    } else if (empty > 20) {
      // 中局：适度
      score += flipped * 2;
    } else {
      // 残局：多翻转好
      score += flipped * 15;
    }

    // 行动力（关键指标）：执行后对手的行动力
    const oppMoves = nextGame.getValidMoves(nextGame.currentPlayer).length;
    score -= oppMoves * 50; // 减少对手行动力很重要

    // 前沿棋子数变化
    const myFrontierBefore = game.countFrontier(game.currentPlayer);
    const myFrontierAfter = nextGame.countFrontier(game.currentPlayer);
    score += (myFrontierBefore - myFrontierAfter) * 20;

    return score;
  }
}

// 便捷构造器
export function createMCTS(difficulty: 'easy' | 'medium' | 'hard' | 'expert'): MCTS {
  switch (difficulty) {
    case 'easy': return new MCTS(300);
    case 'medium': return new MCTS(1200);
    case 'hard': return new MCTS(3000);
    case 'expert': return new MCTS(6000);
  }
}
