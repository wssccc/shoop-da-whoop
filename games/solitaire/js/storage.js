// localStorage persistence: win count, unlocked achievements, mute state,
// and the in-progress board (so a refresh resumes the current game).

import {
    COLORS,
    STORAGE_ACHV,
    STORAGE_MUTE,
    STORAGE_SAVE,
    STORAGE_WINS,
} from './constants.js';
import { toSaveable } from './state.js';

export const Storage = {
  getWins() {
    const n = parseInt(localStorage.getItem(STORAGE_WINS) || '0', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  },
  setWins(n) { localStorage.setItem(STORAGE_WINS, String(n)); },

  getAchievements() {
    try { return JSON.parse(localStorage.getItem(STORAGE_ACHV) || '{}') || {}; }
    catch { return {}; }
  },
  setAchievements(o) { localStorage.setItem(STORAGE_ACHV, JSON.stringify(o)); },

  getMuted() { return localStorage.getItem(STORAGE_MUTE) === '1'; },
  setMuted(m) { localStorage.setItem(STORAGE_MUTE, m ? '1' : '0'); },

  saveGame(state) {
    try { localStorage.setItem(STORAGE_SAVE, JSON.stringify(toSaveable(state))); }
    catch { /* quota / private mode — ignore */ }
  },

  loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_SAVE);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.tableau) || !d.foundations) return null;
      if (!Array.isArray(d.freeCells) || d.freeCells.length !== 3) return null;
      const ok = COLORS.every(c => Array.isArray(d.foundations[c]));
      if (!ok) return null;
      // Validate the undo stack only shallowly: it must be an array whose every
      // entry is itself a board snapshot (has a tableau). A single corrupted
      // entry would break restoreSnapshot, so drop the whole stack in that case
      // — the current board is still playable, just no undo.
      let history = null;
      if (Array.isArray(d.history)) {
        history = d.history.every(h => h && Array.isArray(h.tableau)) ? d.history : null;
      }
      return { tableau: d.tableau, freeCells: d.freeCells, foundations: d.foundations, flowerSlot: d.flowerSlot || null, history };
    }
    catch { return null; }
  },

  clearSave() { localStorage.removeItem(STORAGE_SAVE); },
};
