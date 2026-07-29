// localStorage persistence: lifetime stats, unlocked achievements, mute state,
// and the in-progress game (so a refresh resumes it). Mirrors solitaire's
// storage.js, namespaced under the `sz1a2b.` prefix.

import { STORAGE_ACHV, STORAGE_MUTE, STORAGE_SAVE, STORAGE_STATS, STORAGE_THEME } from './constants.js';
import { fromSaveable, toSaveable } from './state.js';

// Stats shape: { games: number, best: number|null, total: number }
//   games = finished games (won), best = fewest guesses in a single game,
//   total = sum of guesses across all finished games (used to derive average).

export const Storage = {
  getStats() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_STATS) || 'null');
      if (!d || typeof d !== 'object') return { games: 0, best: null, total: 0 };
      const games = Number.isInteger(d.games) && d.games > 0 ? d.games : 0;
      const total = Number.isInteger(d.total) && d.total > 0 ? d.total : 0;
      const best = Number.isInteger(d.best) && d.best > 0 ? d.best : null;
      return { games, total, best };
    } catch { return { games: 0, best: null, total: 0 }; }
  },
  setStats(s) {
    try { localStorage.setItem(STORAGE_STATS, JSON.stringify(s)); }
    catch { /* quota / private mode — ignore */ }
  },

  getAchievements() {
    try { return JSON.parse(localStorage.getItem(STORAGE_ACHV) || '{}') || {}; }
    catch { return {}; }
  },
  setAchievements(o) {
    try { localStorage.setItem(STORAGE_ACHV, JSON.stringify(o)); }
    catch { /* ignore */ }
  },

  getMuted() { return localStorage.getItem(STORAGE_MUTE) === '1'; },
  setMuted(m) { localStorage.setItem(STORAGE_MUTE, m ? '1' : '0'); },

  getTheme() {
    const t = localStorage.getItem(STORAGE_THEME);
    return t === 'light' || t === 'dark' || t === 'auto' ? t : 'auto';
  },
  setTheme(t) {
    if (t === 'light' || t === 'dark' || t === 'auto') {
      localStorage.setItem(STORAGE_THEME, t);
    }
  },

  saveGame(state) {
    try { localStorage.setItem(STORAGE_SAVE, JSON.stringify(toSaveable(state))); }
    catch { /* quota / private mode — ignore */ }
  },

  loadGame() {
    try {
      const raw = localStorage.getItem(STORAGE_SAVE);
      if (!raw) return null;
      return fromSaveable(JSON.parse(raw));
    } catch { return null; }
  },

  clearSave() { localStorage.removeItem(STORAGE_SAVE); },

  // Wipe everything this game owns (stats + achievements + save + mute).
  clearAll() {
    localStorage.removeItem(STORAGE_SAVE);
    localStorage.removeItem(STORAGE_STATS);
    localStorage.removeItem(STORAGE_ACHV);
    localStorage.removeItem(STORAGE_MUTE);
    localStorage.removeItem(STORAGE_THEME);
  },
};
