// Global constants for Solitaire (Chinese "Shanxi" FreeCell variant).
//
// Three "suits" by colour. Cards stack onto a card of a DIFFERENT colour,
// one rank higher (descending, alternating-colour sequences, like FreeCell).

export const COLORS = ['red', 'black', 'green'] as const;
export type ColorTuple = typeof COLORS;

export const TYPE_NUMBER = 'number';
export const TYPE_DRAGON = 'dragon';
export const TYPE_FLOWER = 'flower';

export const TABLEAU_COLS = 8;
export const FREE_CELL_COUNT = 3;
export const RANK_MIN = 1;
export const RANK_MAX = 9;
export const DRAGON_COUNT_PER_COLOR = 4; // 3 colours × 4 = 12 dragons total

// localStorage keys.
export const STORAGE_WINS = 'szsol.wins';
export const STORAGE_ACHV = 'szsol.achievements';
export const STORAGE_MUTE = 'szsol.muted';
export const STORAGE_SAVE = 'szsol.save';

// Win-count milestones mapped to the in-game achievement names.
export interface Achievement {
  id: string;
  name: string;
  threshold: number;
}
export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'climb', name: '登山 · Climb the Mountain', threshold: 1 },
  { id: 'dragon', name: '见龙 · Meet the Dragon', threshold: 10 },
  { id: 'immortal', name: '成仙 · Become Immortal', threshold: 100 },
];

// Sound effect names the engine may emit. (`error` is UI-only, not enumerated.)
export type EngineSoundName =
  | 'move'
  | 'place'
  | 'foundation'
  | 'flower'
  | 'dragon'
  | 'win';
