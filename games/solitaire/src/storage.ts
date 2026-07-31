// localStorage persistence: win count, unlocked achievements, mute state,
// and the in-progress board (so a refresh resumes the current game).

import {
    COLORS,
    FREE_CELL_COUNT,
    STORAGE_ACHV,
    STORAGE_MUTE,
    STORAGE_SAVE,
    STORAGE_WINS,
} from './game/constants';
import { toSaveable } from './game/state';
import type {
    Card,
    FlowerCard,
    Foundations,
    FreeCell,
    GameState,
    LoadedSave,
    Snapshot,
} from './game/types';

/** Shape of records stored under STORAGE_ACHV (id → unlocked bool). */
export type AchievementMap = Record<string, boolean>;

export const Storage = {
  getWins(): number {
    const n = parseInt(localStorage.getItem(STORAGE_WINS) || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  },
  setWins(n: number): void {
    localStorage.setItem(STORAGE_WINS, String(n));
  },

  getAchievements(): AchievementMap {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_ACHV) || '{}');
      return parsed && typeof parsed === 'object' ? (parsed as AchievementMap) : {};
    } catch {
      return {};
    }
  },
  setAchievements(o: AchievementMap): void {
    localStorage.setItem(STORAGE_ACHV, JSON.stringify(o));
  },

  getMuted(): boolean {
    return localStorage.getItem(STORAGE_MUTE) === '1';
  },
  setMuted(m: boolean): void {
    localStorage.setItem(STORAGE_MUTE, m ? '1' : '0');
  },

  saveGame(state: GameState): void {
    try {
      localStorage.setItem(STORAGE_SAVE, JSON.stringify(toSaveable(state)));
    } catch {
      // quota / private mode — ignore.
    }
  },

  loadGame(): LoadedSave | null {
    try {
      const raw = localStorage.getItem(STORAGE_SAVE);
      if (!raw) return null;
      const d = JSON.parse(raw) as unknown;
      if (!d || typeof d !== 'object') return null;
      const obj = d as Record<string, unknown>;
      if (!Array.isArray(obj.tableau)) return null;
      if (!obj.foundations || typeof obj.foundations !== 'object') return null;
      if (!Array.isArray(obj.freeCells) || obj.freeCells.length !== FREE_CELL_COUNT) {
        return null;
      }
      const fo = obj.foundations as Record<string, unknown>;
      const foundationsOk = COLORS.every((c) => Array.isArray(fo[c]));
      if (!foundationsOk) return null;
      // Validate the undo stack only shallowly: it must be an array whose every
      // entry is itself a board snapshot (has a tableau). A single corrupted
      // entry would break restoreSnapshot, so drop the whole stack in that case
      // — the current board is still playable, just no undo.
      let history: Snapshot[] | null = null;
      if (Array.isArray(obj.history)) {
        const allValid = (obj.history as unknown[]).every(
          (h) => !!h && typeof h === 'object' && Array.isArray((h as Record<string, unknown>).tableau),
        );
        history = allValid ? (obj.history as Snapshot[]) : null;
      }
      return {
        tableau: obj.tableau as Card[][],
        freeCells: obj.freeCells as FreeCell[],
        foundations: fo as Foundations,
        flowerSlot: (obj.flowerSlot ?? null) as FlowerCard | null,
        history,
      };
    } catch {
      return null;
    }
  },

  clearSave(): void {
    localStorage.removeItem(STORAGE_SAVE);
  },
};
