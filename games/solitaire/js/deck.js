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
    TYPE_DRAGON,
    TYPE_FLOWER,
    TYPE_NUMBER,
} from './constants.js';

// Build a fresh, ordered deck of 40 cards (plain data objects):
// 27 number cards (3 colours × ranks 1..9) + 12 dragons (3 × 4) + 1 flower.
export function createDeck() {
  const cards = [];
  for (const color of COLORS) {
    for (let r = RANK_MIN; r <= RANK_MAX; r++) {
      cards.push({ id: `n-${color}-${r}`, type: TYPE_NUMBER, color, rank: r });
    }
  }
  for (const color of COLORS) {
    for (let i = 0; i < DRAGON_COUNT_PER_COLOR; i++) {
      cards.push({ id: `dragon-${color}-${i}`, type: TYPE_DRAGON, color });
    }
  }
  cards.push({ id: 'flower', type: TYPE_FLOWER });
  return cards;
}

// Fisher–Yates shuffle (returns a new array).
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Deal the shuffled deck evenly across the 8 tableau columns (5 each, all face up).
export function deal() {
  const deck = shuffle(createDeck());
  const tableau = Array.from({ length: TABLEAU_COLS }, () => []);
  for (let i = 0; i < deck.length; i++) {
    tableau[i % TABLEAU_COLS].push(deck[i]);
  }
  return tableau;
}
