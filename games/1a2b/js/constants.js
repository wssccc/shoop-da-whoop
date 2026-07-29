// All tunable constants & derived config for the 1A2B game.
// Mirrors the solitaire convention: one place for magic numbers, storage keys
// and the achievement catalogue.

export const DIGITS = 4; // classic 1A2B: a 4-digit code with unique digits

// localStorage key prefix — short, namespaced like solitaire's `szsol.`.
export const PREFIX = 'sz1a2b.';
export const STORAGE_STATS = PREFIX + 'stats';
export const STORAGE_ACHV = PREFIX + 'achievements';
export const STORAGE_MUTE = PREFIX + 'muted';
export const STORAGE_SAVE = PREFIX + 'save';
export const STORAGE_THEME = PREFIX + 'theme';

// Achievement catalogue.
//   type 'count'   → unlocked when cumulative finished games >= threshold
//   type 'guesses' → unlocked when a single game is won in <= threshold guesses
export const ACHIEVEMENTS = [
  { id: 'firstwin',   name: '初出茅庐 · First Strike',     type: 'count',   threshold: 1,   icon: '🎯' },
  { id: 'sharp',      name: '神机妙算 · Sharp Shooter',    type: 'guesses', threshold: 6,   icon: '🔫' },
  { id: 'prophet',    name: '料事如神 · Prophet',          type: 'guesses', threshold: 5,   icon: '🔮' },
  { id: 'veteran',    name: '身经百战 · Veteran',          type: 'count',   threshold: 10,  icon: '🎖️' },
  { id: 'centurion',  name: '百战不殆 · Centurion',        type: 'count',   threshold: 100, icon: '👑' },
];
