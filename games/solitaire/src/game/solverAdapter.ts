// Adapter between the game's `GameState` (cards carry ids, Vue) and the
// solver's positional state model (tools/solver/rules.js — plain cards with
// no ids, column arrays where col[last] = stack top, identical stack order).
//
// Solver move objects are positional: { kind:'move', from:{zone,col,start} | {zone:'freecell',idx}, to }
// — the run is re-sliced from the CURRENT game state at execution time, so the
// game and the solver never need to share card ids.

import type { Card, GameState } from './types';

export type SolverColor = 'red' | 'black' | 'green';

/** Card shape used by tools/solver (no id, no extra fields). */
export interface SolverCard {
  type: 'number' | 'dragon' | 'flower';
  color?: SolverColor;
  rank?: number;
}

export interface SolverDragonPile {
  type: 'dragonpile';
  locked: true;
  color: SolverColor;
  cards: SolverCard[];
}

/** State shape used by tools/solver (mirror of solver rules.js state). */
export interface SolverState {
  tableau: SolverCard[][];
  freeCells: (SolverCard | SolverDragonPile | null)[];
  foundations: Record<SolverColor, SolverCard[]>;
  flowerSlot: SolverCard | null;
}

export interface SolverMove {
  kind: 'move';
  from:
    | { zone: 'tableau'; col: number; start: number }
    | { zone: 'freecell'; idx: number };
  to:
    | { type: 'column'; index: number }
    | { type: 'freecell'; index: number }
    | { type: 'foundation'; color: SolverColor }
    | { type: 'flower' };
  count?: number;
}

export interface SolverCollect {
  kind: 'collect';
  color: SolverColor;
}

export type SolverUserStep = SolverMove | SolverCollect;

/** One solver output record: a user action + its forced auto-move cascade. */
export interface SolverStepRecord {
  user: SolverUserStep | null;
  auto: unknown[];
}

export function toSolverCard(card: Card): SolverCard {
  if (card.type === 'number') {
    return { type: 'number', color: card.color, rank: card.rank };
  }
  if (card.type === 'dragon') {
    return { type: 'dragon', color: card.color };
  }
  return { type: 'flower' };
}

/** Convert the game's current state into the solver's positional state. */
export function toSolverState(state: GameState): SolverState {
  return {
    tableau: state.tableau.map((col) => col.map(toSolverCard)),
    freeCells: state.freeCells.map((fc) => {
      if (!fc) return null;
      if (fc.type === 'dragonpile') {
        return {
          type: 'dragonpile',
          locked: true,
          color: fc.color,
          cards: fc.cards.map(toSolverCard),
        };
      }
      return toSolverCard(fc);
    }),
    foundations: {
      red: state.foundations.red.map(toSolverCard),
      black: state.foundations.black.map(toSolverCard),
      green: state.foundations.green.map(toSolverCard),
    },
    flowerSlot: state.flowerSlot ? toSolverCard(state.flowerSlot) : null,
  };
}
