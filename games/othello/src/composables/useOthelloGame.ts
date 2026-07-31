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
import { clearGameState, loadGameState, loadSettings, saveGameState, saveSettings, type GameSnapshot } from '../storage';
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
  // Undo history: one pure-data snapshot per state change (human move, AI
  // move, or pass). Cleared on reset; persisted with the game state so undo
  // survives a page refresh. Stored as plain data (not OthelloGame instances)
  // so it serializes to localStorage and keeps the game-logic layer history-
  // free (MCTS cloning would otherwise duplicate it everywhere).
  const history = ref<GameSnapshot[]>([]);

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
  // Undo is only available when there's history to revert to, the AI isn't
  // mid-computation (would race the worker's reply), and the game isn't over.
  const canUndo = computed(
    () => history.value.length > 0 && !isAiThinking.value && !gameOver.value,
  );

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

  /** Push a deep-copy snapshot of the current game onto the undo history. */
  function pushHistory(): void {
    history.value.push({
      board: game.value.board.map(r => [...r]),
      currentPlayer: game.value.currentPlayer,
      lastMove: lastMove.value,
    });
  }

  function applyMove(row: number, col: number) {
    // Snapshot the state *before* mutation so it can be undone.
    pushHistory();
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
    pushHistory();
    const newGame = game.value.clone();
    newGame.switchPlayer();
    game.value = newGame;
    afterGameChange();
  }

  /**
   * Undo back to the most recent human decision point, popping the AI's
   * reply (and any forced passes) along the way. Each snapshot was captured
   * *before* a mutation, so restoring one yields a valid prior state. We
   * loop until it's the human's turn again (or history is exhausted, e.g.
   * undoing back to an AI-opened game's start) so a single click reverts
   * both the AI's answer and the player's own previous move.
   */
  function undo() {
    if (history.value.length === 0) return;

    // Clear transient UI/timer state so undo doesn't fight it.
    flippedInfo.value = null;
    if (passNoticeTimer !== null) {
      clearTimeout(passNoticeTimer);
      passNoticeTimer = null;
    }
    passNotice.value = null;
    gameOver.value = false;

    do {
      const snap = history.value.pop();
      if (!snap) break;
      const restored = new OthelloGame(8);
      restored.board = snap.board.map(r => [...r]);
      restored.currentPlayer = snap.currentPlayer;
      game.value = restored;
      lastMove.value = snap.lastMove;
    } while (
      history.value.length > 0 &&
      game.value.currentPlayer !== humanPlayer.value
    );

    // Re-drive the turn engine: persists the reverted state (history
    // included), re-checks pass/game-over, and — since we land on the
    // human's turn — won't re-dispatch the AI.
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
    history.value = [];
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
    // Deep-copy history boards so the serialized state can't be mutated
    // later via live OthelloGame references.
    saveGameState({
      board: game.value.board,
      currentPlayer: game.value.currentPlayer,
      humanPlayer: humanPlayer.value,
      aiDifficulty: aiDifficulty.value,
      history: history.value.map(s => ({
        board: s.board.map(r => [...r]),
        currentPlayer: s.currentPlayer,
        lastMove: s.lastMove,
      })),
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
      // Restore undo history (old saves predating this field get an empty one).
      history.value = saved.history ?? [];

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
    canUndo,
    // Actions
    handleCellClick,
    resetGame,
    switchSide,
    setDifficulty,
    undo,
  };
}
