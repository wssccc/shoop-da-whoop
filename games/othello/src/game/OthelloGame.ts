// 黑白棋游戏逻辑 - 增强版（支持AI特征计算）

export type Player = 1 | 2; // 1: 黑棋, 2: 白棋
export type Cell = 0 | 1 | 2; // 0: 空, 1: 黑棋, 2: 白棋

export interface Position {
  row: number;
  col: number;
}

// 位置权重表（基于D4对称性）
export const WEIGHT_TABLE: number[][] = [
  [120, -20,  20,   5,   5,  20, -20, 120],
  [-20, -40,  -5,  -5,  -5,  -5, -40, -20],
  [ 20,  -5,  15,   3,   3,  15,  -5,  20],
  [  5,  -5,   3,   3,   3,   3,  -5,   5],
  [  5,  -5,   3,   3,   3,   3,  -5,   5],
  [ 20,  -5,  15,   3,   3,  15,  -5,  20],
  [-20, -40,  -5,  -5,  -5,  -5, -40, -20],
  [120, -20,  20,   5,   5,  20, -20, 120],
];

export class OthelloGame {
  board: Cell[][];
  currentPlayer: Player;
  size: number;

  constructor(size: number = 8) {
    this.size = size;
    this.board = Array(size).fill(null).map(() => Array(size).fill(0));
    this.currentPlayer = 1; // 黑棋先手
    
    // 初始化棋盘中心
    const mid = size / 2;
    this.board[mid - 1][mid - 1] = 2; // 白棋
    this.board[mid - 1][mid] = 1;     // 黑棋
    this.board[mid][mid - 1] = 1;     // 黑棋
    this.board[mid][mid] = 2;         // 白棋
  }

  // 深拷贝游戏状态
  clone(): OthelloGame {
    const newGame = new OthelloGame(this.size);
    newGame.board = this.board.map(row => [...row]);
    newGame.currentPlayer = this.currentPlayer;
    return newGame;
  }

  // 获取对手
  getOpponent(player: Player): Player {
    return player === 1 ? 2 : 1;
  }

  // 检查位置是否在棋盘内
  isValidPosition(row: number, col: number): boolean {
    return row >= 0 && row < this.size && col >= 0 && col < this.size;
  }

  // 检查某个位置是否可以落子
  isValidMove(row: number, col: number, player?: Player): boolean {
    const p = player || this.currentPlayer;
    if (!this.isValidPosition(row, col) || this.board[row][col] !== 0) {
      return false;
    }

    const directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];

    for (const [dr, dc] of directions) {
      if (this.canFlipInDirection(row, col, dr, dc, p)) {
        return true;
      }
    }
    return false;
  }

  // 检查某个方向是否可以翻转棋子
  private canFlipInDirection(row: number, col: number, dr: number, dc: number, player: Player): boolean {
    const opponent = this.getOpponent(player);
    let r = row + dr;
    let c = col + dc;
    let hasOpponent = false;

    while (this.isValidPosition(r, c) && this.board[r][c] === opponent) {
      hasOpponent = true;
      r += dr;
      c += dc;
    }

    return hasOpponent && this.isValidPosition(r, c) && this.board[r][c] === player;
  }

  // 获取所有合法移动
  getValidMoves(player?: Player): Position[] {
    const p = player || this.currentPlayer;
    const moves: Position[] = [];
    
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (this.isValidMove(row, col, p)) {
          moves.push({ row, col });
        }
      }
    }
    
    return moves;
  }

  // 执行落子并翻转棋子，返回翻转数量
  makeMove(row: number, col: number, player?: Player): number {
    const p = player || this.currentPlayer;
    
    if (!this.isValidMove(row, col, p)) {
      return 0;
    }

    this.board[row][col] = p;
    let totalFlipped = 0;

    const directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];

    for (const [dr, dc] of directions) {
      totalFlipped += this.flipInDirection(row, col, dr, dc, p);
    }

    return totalFlipped;
  }

  // 在某个方向翻转棋子，返回翻转数量
  private flipInDirection(row: number, col: number, dr: number, dc: number, player: Player): number {
    const opponent = this.getOpponent(player);
    const toFlip: Position[] = [];
    let r = row + dr;
    let c = col + dc;

    while (this.isValidPosition(r, c) && this.board[r][c] === opponent) {
      toFlip.push({ row: r, col: c });
      r += dr;
      c += dc;
    }

    if (toFlip.length > 0 && this.isValidPosition(r, c) && this.board[r][c] === player) {
      for (const pos of toFlip) {
        this.board[pos.row][pos.col] = player;
      }
      return toFlip.length;
    }
    return 0;
  }

  // 切换玩家
  switchPlayer(): void {
    this.currentPlayer = this.getOpponent(this.currentPlayer);
  }

  // 检查游戏是否结束
  isGameOver(): boolean {
    return this.getValidMoves(1).length === 0 && this.getValidMoves(2).length === 0;
  }

  // 获取棋子数量
  getScore(): { black: number; white: number } {
    let black = 0;
    let white = 0;
    
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (this.board[row][col] === 1) black++;
        else if (this.board[row][col] === 2) white++;
      }
    }
    
    return { black, white };
  }

  // 获取获胜者
  getWinner(): 0 | 1 | 2 {
    const { black, white } = this.getScore();
    if (black > white) return 1;
    if (white > black) return 2;
    return 0; // 平局
  }

  // 跳过当前玩家回合（如果没有合法移动）
  canCurrentPlayerMove(): boolean {
    return this.getValidMoves(this.currentPlayer).length > 0;
  }

  // ============ AI特征计算 ============

  // 空格数量
  countEmpty(): number {
    let count = 0;
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (this.board[row][col] === 0) count++;
      }
    }
    return count;
  }

  // 是否是角落
  isCorner(pos: Position): boolean {
    return (pos.row === 0 || pos.row === 7) && (pos.col === 0 || pos.col === 7);
  }

  // 是否是X位（角落旁边的对角线位置）
  isXSquare(pos: Position): boolean {
    return (
      (pos.row === 1 && pos.col === 1) ||
      (pos.row === 1 && pos.col === 6) ||
      (pos.row === 6 && pos.col === 1) ||
      (pos.row === 6 && pos.col === 6)
    );
  }

  // 是否是C位（角落旁边的边缘位置）
  isCSquare(pos: Position): boolean {
    return (
      (pos.row === 0 && (pos.col === 1 || pos.col === 6)) ||
      (pos.row === 7 && (pos.col === 1 || pos.col === 6)) ||
      (pos.col === 0 && (pos.row === 1 || pos.row === 6)) ||
      (pos.col === 7 && (pos.row === 1 || pos.row === 6))
    );
  }

  // 是否是边缘（非角落非X非C）
  isEdge(pos: Position): boolean {
    return (
      (pos.row === 0 || pos.row === 7 || pos.col === 0 || pos.col === 7) &&
      !this.isCorner(pos) && !this.isXSquare(pos) && !this.isCSquare(pos)
    );
  }

  // 计算前沿棋子数量（与空格相邻的棋子）
  countFrontier(player?: Player): number {
    const p = player || this.currentPlayer;
    let count = 0;
    const directions = [
      [-1, -1], [-1, 0], [-1, 1],
      [0, -1],           [0, 1],
      [1, -1],  [1, 0],  [1, 1]
    ];

    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (this.board[row][col] === p) {
          for (const [dr, dc] of directions) {
            const nr = row + dr;
            const nc = col + dc;
            if (this.isValidPosition(nr, nc) && this.board[nr][nc] === 0) {
              count++;
              break;
            }
          }
        }
      }
    }
    return count;
  }

  // 计算稳定子数量（不会被翻转的棋子）
  countStable(player?: Player): number {
    const p = player || this.currentPlayer;
    let count = 0;

    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (this.board[row][col] === p && this.isStableDisk(row, col, p)) {
          count++;
        }
      }
    }
    return count;
  }

  // 检查某个棋子是否稳定
  private isStableDisk(row: number, col: number, _player: Player): boolean {
    // 四个方向对都要被填满且不能翻转
    const directions = [
      [[-1, 0], [1, 0]],   // 垂直
      [[0, -1], [0, 1]],   // 水平
      [[-1, -1], [1, 1]],  // 对角线1
      [[-1, 1], [1, -1]]   // 对角线2
    ];

    for (const [dir1, dir2] of directions) {
      let filled1 = true;
      let filled2 = true;
      
      // 方向1
      let r = row + dir1[0];
      let c = col + dir1[1];
      while (this.isValidPosition(r, c)) {
        if (this.board[r][c] === 0) {
          filled1 = false;
          break;
        }
        r += dir1[0];
        c += dir1[1];
      }
      if (!this.isValidPosition(r - dir1[0], c - dir1[1])) filled1 = true; // 到达边界

      // 方向2
      r = row + dir2[0];
      c = col + dir2[1];
      while (this.isValidPosition(r, c)) {
        if (this.board[r][c] === 0) {
          filled2 = false;
          break;
        }
        r += dir2[0];
        c += dir2[1];
      }
      if (!this.isValidPosition(r - dir2[0], c - dir2[1])) filled2 = true; // 到达边界

      // 如果两个方向都不满，则不稳定
      if (!filled1 && !filled2) return false;
    }

    return true;
  }
}
