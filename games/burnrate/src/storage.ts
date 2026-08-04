// localStorage persistence: win count, unlocked achievements, mute state,
// and the in-progress match (so a refresh resumes the current game).
//
// Save format is versioned (`format: 2` = multiplayer players array). Any
// old 1v1 save (or a corrupted one) fails validation and is discarded —
// the game then starts fresh.

import type { AiDifficulty, GameState } from './game/types';

const STORAGE_SAVE = 'burnrate.save';
const STORAGE_WINS = 'burnrate.wins';
const STORAGE_ACHV = 'burnrate.achievements';
const STORAGE_MUTE = 'burnrate.muted';

/** Current save format. Bump when the persisted shape changes. */
const SAVE_FORMAT = 2;

export type AchievementMap = Record<string, boolean>;

export interface SavePayload {
  state: GameState;
  /** Difficulty per AI slot (slot i → index i-1). */
  difficulties: AiDifficulty[];
}

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

  /** Persist the current GameState as plain JSON (types are serialisable). */
  saveGame(state: GameState, difficulties: AiDifficulty[] = []): void {
    try {
      localStorage.setItem(
        STORAGE_SAVE,
        JSON.stringify({ format: SAVE_FORMAT, state, difficulties }),
      );
    } catch {
      // quota / private mode — ignore.
    }
  },

  /** Restore a saved GameState, validating the shape shallowly. Returns null
   *  on any mismatch (including old formats) so a bad save never crashes
   *  the app — the caller starts a new game instead. */
  loadGame(): SavePayload | null {
    try {
      const raw = localStorage.getItem(STORAGE_SAVE);
      if (!raw) return null;
      const d = JSON.parse(raw) as unknown;
      if (!d || typeof d !== 'object') return null;
      const obj = d as Record<string, unknown>;
      if (obj.format !== SAVE_FORMAT || !obj.state) return null;
      const st = obj.state as Record<string, unknown>;
      if (!Array.isArray(st.deck) || !Array.isArray(st.discard)) return null;
      if (typeof st.turn !== 'number') return null;
      if (typeof st.currentPlayer !== 'number') return null;
      if (!Array.isArray(st.players) || st.players.length < 2) return null;
      for (const p of st.players) {
        if (!p || typeof p !== 'object') return null;
        const ps = p as Record<string, unknown>;
        if (typeof ps.cash !== 'number' || !Array.isArray(ps.hand)) return null;
      }
      const difficulties = Array.isArray(obj.difficulties)
        ? (obj.difficulties as AiDifficulty[])
        : [];
      // Backfill the revenge ledger for saves that predate it (no format
      // bump - a missing `attackers` is just an empty grudge ledger, no loss).
      for (const p of st.players as Record<string, unknown>[]) {
        if (!p.attackers) p.attackers = {};
      }
      return { state: obj.state as GameState, difficulties };
    } catch {
      return null;
    }
  },

  clearSave(): void {
    localStorage.removeItem(STORAGE_SAVE);
  },
};
