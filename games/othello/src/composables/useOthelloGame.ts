/**
 * useOthelloGame — Vue 3 composable that replaces all React state/effects.
 *
 * Manages:
 *  - Game state (board, currentPlayer, scores)
 *  - AI vs Human turn logic
 *  - MCTS AI via Web Worker (non-blocking)
 *  - Flip animation state
 *  - Game-over detection
 *  - localStorage persistence
 */

import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { OthelloGame, type Cell, type Player, type Position } from '../game/OthelloGame';
import { clearGameState, loadGameState, loadSettings, saveGameState, saveSettings } from '../storage';
import MctsWorker from '../worker/mcts.worker.ts?worker';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

interface FlippedInfo {
  positions: Position[];
  player: Player;
}

export function useOthelloGame() {
  // ── Reactive state ──────────────────────────────────────────
  const game = shallowRef(new OthelloGame());
  const humanPlayer = ref<Player>(1);
  const aiDifficulty = ref<Difficulty>('medium');
  const isAiThinking = ref(false);
  const lastMove = ref<Position | null>(null);
  const flippedInfo = ref<FlippedInfo | null>(null);
  const gameOver = ref(false);
  const showHelp = ref(false);
  const showSettings = ref(false);
  // Transient notice shown when a player has no legal move and must pass.
  // Holds the Player who just passed, or null when there's nothing to show.
  const passNotice = ref<Player | null>(null);

  // Non-reactive guard (like useRef) to prevent re-entrant AI calls.
  let isAiRunning = false;
  let worker: Worker | null = null;
  let pendingAiResolve: (() => void) | null = null;
  // Timer id for clearing the pass notice; non-reactive.
  let passNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Computed ────────────────────────────────────────────────
  const score = computed(() => game.value.getScore());
  const winner = computed(() => game.value.getWinner());
  const currentPlayer = computed(() => game.value.currentPlayer);
  const validMoves = computed(() => game.value.getValidMoves());
  const flippedKeys = computed(() => {
    const s = new Set<string>();
    if (flippedInfo.value) {
      for (const p of flippedInfo.value.positions) {
        s.add(`${p.row},${p.col}`);
      }
    }
    return s;
  });

  // ── Worker lifecycle ───────────────────────────────────────
  function initWorker() {
    // Use Vite's ?worker import to create a classic Worker (no `type: 'module'`),
    // ensuring compatibility with iOS 13 / Safari 13 which doesn't support
    // module workers. Vite bundles the worker code into a self-contained chunk
    // so no import/export statements remain — a classic Worker is sufficient.
    worker = new MctsWorker();
    worker.onmessage = (e: MessageEvent) => {
      const { type, row, col } = e.data;
      if (type === 'bestMove') {
        if (row >= 0 && col >= 0) {
          applyMove(row, col);
        } else {
          // Defensive fallback: AI reported no legal move. Should not happen
          // because afterGameChange pre-checks canCurrentPlayerMove, but we
          // guard against race / corrupted state so the game never deadlocks.
          skipTurn();
        }
      }
      isAiRunning = false;
      isAiThinking.value = false;
      if (pendingAiResolve) {
        pendingAiResolve();
        pendingAiResolve = null;
      }
    };
    worker.onerror = (err) => {
      console.error('MCTS Worker error:', err);
      isAiRunning = false;
      isAiThinking.value = false;
      if (pendingAiResolve) {
        pendingAiResolve();
        pendingAiResolve = null;
      }
    };
  }

  // ── Move application ────────────────────────────────────────
  /**
   * Get all positions that would be flipped by placing `player` at (row, col).
   */
  function getFlippedPositions(g: OthelloGame, row: number, col: number, player: Player): Position[] {
    const flipped: Position[] = [];
    const opponent: Player = player === 1 ? 2 : 1;
    const dirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];

    for (const [dr, dc] of dirs) {
      const candidates: Position[] = [];
      let r = row + dr;
      let c = col + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && g.board[r][c] === opponent) {
        candidates.push({ row: r, col: c });
        r += dr;
        c += dc;
      }
      if (r >= 0 && r < 8 && c >= 0 && c < 8 && g.board[r][c] === player) {
        flipped.push(...candidates);
      }
    }
    return flipped;
  }

  function applyMove(row: number, col: number) {
    const newGame = game.value.clone();
    const player = newGame.currentPlayer;
    const flipped = getFlippedPositions(newGame, row, col, player);
    newGame.makeMove(row, col);
    newGame.switchPlayer();
    game.value = newGame;
    lastMove.value = { row, col };

    // Set flip animation state
    flippedInfo.value = { positions: flipped, player };
    setTimeout(() => {
      flippedInfo.value = null;
    }, 500);

    afterGameChange();
  }

  function skipTurn() {
    const newGame = game.value.clone();
    newGame.switchPlayer();
    game.value = newGame;
    afterGameChange();
  }

  // ── Turn logic ─────────────────────────────────────────────
  function afterGameChange() {
    persistGame();

    if (game.value.isGameOver()) {
      gameOver.value = true;
      return;
    }

    // Unified pass handling: regardless of whether the current player is the
    // human or the AI, if they have no legal move they must pass. This is the
    // fix for the deadlock where the AI would return {-1, -1} from the worker
    // and nobody advanced the turn. We surface a transient UI notice before
    // switching so the user can see *why* the turn skipped.
    if (!game.value.canCurrentPlayerMove()) {
      const passingPlayer = game.value.currentPlayer;
      passNotice.value = passingPlayer;
      if (passNoticeTimer !== null) {
        clearTimeout(passNoticeTimer);
      }
      passNoticeTimer = setTimeout(() => {
        passNotice.value = null;
        passNoticeTimer = null;
      }, 1200);
      skipTurn();
      return;
    }

    // Current player has at least one legal move — dispatch normally.
    if (game.value.currentPlayer !== humanPlayer.value) {
      // AI's turn. Because of the check above we know the AI has a legal move,
      // so runAiMove -> worker is guaranteed to return a valid {row, col}.
      if (!isAiThinking.value && !isAiRunning) {
        runAiMove();
      }
    }
    // Human's turn and has moves: wait for a click.
  }

  function runAiMove() {
    if (isAiRunning) return;
    isAiRunning = true;
    isAiThinking.value = true;

    // Yield to let Vue flush "thinking…" UI before blocking on worker dispatch
    nextTick().then(() => {
      if (!worker) return;
      const board: Cell[][] = game.value.board.map(r => [...r]);
      worker.postMessage({
        type: 'findBestMove',
        board,
        currentPlayer: game.value.currentPlayer,
        difficulty: aiDifficulty.value,
      });
    });
  }

  // ── Public actions ──────────────────────────────────────────
  function handleCellClick(row: number, col: number) {
    if (isAiThinking.value) return;
    if (game.value.currentPlayer !== humanPlayer.value) return;
    if (!game.value.isValidMove(row, col)) return;

    applyMove(row, col);
  }

  function resetGame() {
    isAiRunning = false;
    isAiThinking.value = false;
    game.value = new OthelloGame();
    lastMove.value = null;
    flippedInfo.value = null;
    gameOver.value = false;
    clearGameState();
    afterGameChange();
  }

  function switchSide() {
    humanPlayer.value = humanPlayer.value === 1 ? 2 : 1;
    persistSettings();
    resetGame();
  }

  function setDifficulty(d: Difficulty) {
    aiDifficulty.value = d;
    showSettings.value = false;
    persistSettings();
    resetGame();
  }

  // ── Persistence ────────────────────────────────────────────
  function persistGame() {
    saveGameState({
      board: game.value.board,
      currentPlayer: game.value.currentPlayer,
      humanPlayer: humanPlayer.value,
      aiDifficulty: aiDifficulty.value,
    });
  }

  function persistSettings() {
    saveSettings({
      humanPlayer: humanPlayer.value,
      aiDifficulty: aiDifficulty.value,
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────
  onMounted(() => {
    initWorker();

    // Restore settings
    const savedSettings = loadSettings();
    if (savedSettings) {
      humanPlayer.value = savedSettings.humanPlayer;
      aiDifficulty.value = savedSettings.aiDifficulty;
    }

    // Restore game state
    const saved = loadGameState();
    if (saved) {
      const restored = new OthelloGame(8);
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          restored.board[r][c] = saved.board[r][c];
        }
      }
      restored.currentPlayer = saved.currentPlayer;
      game.value = restored;
      humanPlayer.value = saved.humanPlayer;
      aiDifficulty.value = saved.aiDifficulty;

      if (restored.isGameOver()) {
        gameOver.value = true;
      } else {
        // Route every restored game (including "AI's turn but AI must pass")
        // through the unified turn dispatcher so pass/deadlock logic applies.
        nextTick(() => afterGameChange());
      }
    } else {
      // Fresh game — AI goes first if human is white
      nextTick(() => afterGameChange());
    }
  });

  onUnmounted(() => {
    worker?.terminate();
    if (passNoticeTimer !== null) {
      clearTimeout(passNoticeTimer);
      passNoticeTimer = null;
    }
  });

  // ── Composable output ──────────────────────────────────────
  return {
    // State
    game,
    humanPlayer,
    aiDifficulty,
    isAiThinking,
    lastMove,
    flippedInfo,
    gameOver,
    showHelp,
    showSettings,
    passNotice,
    // Computed
    score,
    winner,
    currentPlayer,
    validMoves,
    flippedKeys,
    // Actions
    handleCellClick,
    resetGame,
    switchSide,
    setDifficulty,
  };
}
