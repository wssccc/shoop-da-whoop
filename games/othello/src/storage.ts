/**
 * localStorage persistence for Othello game state.
 *
 * Saves/restores: board, currentPlayer, humanPlayer, aiDifficulty.
 * Auto-save after every move so refreshing the page resumes the game.
 */

import type { Cell, Player } from './game/OthelloGame';

const STORAGE_KEY = 'othello_game_state';
const SETTINGS_KEY = 'othello_settings';

export interface SavedGameState {
  board: Cell[][];
  currentPlayer: Player;
  humanPlayer: Player;
  aiDifficulty: 'easy' | 'medium' | 'hard' | 'expert';
}

export interface SavedSettings {
  humanPlayer: Player;
  aiDifficulty: 'easy' | 'medium' | 'hard' | 'expert';
}

/** Save a full game snapshot (board + players). */
export function saveGameState(state: SavedGameState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage full or unavailable — silently ignore.
  }
}

/** Load a previously saved game snapshot, or null if none exists. */
export function loadGameState(): SavedGameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedGameState;
  } catch {
    return null;
  }
}

/** Remove saved game state (called after game over or manual reset). */
export function clearGameState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Save settings only (humanPlayer + aiDifficulty), preserving for next game. */
export function saveSettings(settings: SavedSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

/** Load saved settings. */
export function loadSettings(): SavedSettings | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SavedSettings;
  } catch {
    return null;
  }
}
