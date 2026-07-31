// Deck composition and dealing.
//
// 40 cards total: 3 colours × ranks 1..9 (27 number cards)
// + 3 colours × 4 dragon cards (12) + 1 flower card.

import {
    COLORS,
    DRAGON_COUNT_PER_COLOR,
    RANK_MAX,
    RANK_MIN,
    TABLEAU_COLS,
} from './constants';
import type { Card } from './types';

/** Build a fresh, ordered deck of 40 cards (plain data objects). */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const color of COLORS) {
    for (let r = RANK_MIN; r <= RANK_MAX; r++) {
      cards.push({ id: `n-${color}-${r}`, type: 'number', color, rank: r });
    }
  }
  for (const color of COLORS) {
    for (let i = 0; i < DRAGON_COUNT_PER_COLOR; i++) {
      cards.push({ id: `dragon-${color}-${i}`, type: 'dragon', color });
    }
  }
  cards.push({ id: 'flower', type: 'flower' });
  return cards;
}

/** Fisher–Yates shuffle (returns a new array). */
export function shuffle<T>(
  arr: readonly T[],
  rng: () => number = Math.random,
): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Deal the shuffled deck evenly across the 8 tableau columns (5 each, all face up). */
export function deal(): Card[][] {
  const deck = shuffle(createDeck());
  const tableau: Card[][] = Array.from({ length: TABLEAU_COLS }, () => []);
  for (let i = 0; i < deck.length; i++) {
    tableau[i % TABLEAU_COLS].push(deck[i]);
  }
  return tableau;
}
