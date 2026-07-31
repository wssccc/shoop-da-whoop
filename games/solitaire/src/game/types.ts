// Discriminated-union card model.
//
// Faithful to the original plain-object shape, but typed so the engine and
// UI never have to second-guess a card's variant.

export type CardColor = 'red' | 'black' | 'green';

export interface NumberCard {
  id: string;
  type: 'number';
  color: CardColor;
  /** 1..RANK_MAX */
  rank: number;
}

export interface DragonCard {
  id: string;
  type: 'dragon';
  color: CardColor;
}

export interface FlowerCard {
  id: string;
  type: 'flower';
}

export type Card = NumberCard | DragonCard | FlowerCard;

/**
 * A locked pile holding all 4 dragons of one colour. Lives in a free cell.
 * Never draggable; never reachable via findCard (it filters locked).
 */
export interface DragonPile {
  type: 'dragonpile';
  locked: true;
  color: CardColor;
  cards: DragonCard[];
}

export type FreeCell = Card | DragonPile | null;

/** Foundations indexed by colour (each pile collects ranks 1..9 of its colour). */
export type Foundations = Record<CardColor, NumberCard[]>;

/** A board snapshot (history excluded) — used for undo points and saves. */
export interface Board {
  tableau: Card[][];
  freeCells: FreeCell[];
  foundations: Foundations;
  flowerSlot: FlowerCard | null;
}

export interface Snapshot extends Board {}

export interface GameState extends Board {
  /** Undo stack (each entry is a board-only snapshot). Persisted across reloads. */
  history: Snapshot[];
}

/** Serialisable layout written to localStorage. */
export interface Saveable extends Board {
  history: Snapshot[];
}

/** Result of loading a save; `history` is null when the stack was malformed. */
export interface LoadedSave extends Board {
  history: Snapshot[] | null;
}

export type DestDescriptor =
  | { type: 'column'; index: number }
  | { type: 'freecell'; index: number }
  | { type: 'foundation'; color: CardColor }
  | { type: 'flower' };

export type CardLocation =
  | { zone: 'tableau'; col: number; idx: number }
  | { zone: 'freecell'; idx: number };

export type MoveResult = { ok: true } | { ok: false; reason: MoveFailureReason };

export type MoveFailureReason =
  | 'empty'
  | 'not-found'
  | 'run-mismatch'
  | 'invalid-run'
  | 'freecell-multi'
  | 'bad-source'
  | 'invalid-dest'
  | 'not-ready'
  | 'no-cell';
