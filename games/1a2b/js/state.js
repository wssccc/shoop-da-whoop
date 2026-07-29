// Game state shape + (de)serialisation. Unlike solitaire there is no undo,
// so there is no snapshot stack here — just the live state and its JSON form.
//
// State:
//   { secret: string, guesses: [{guess, a, b}], input: string, won: boolean }

import { DIGITS } from './constants.js';
import { generateSecret, hasUniqueDigits } from './rules.js';

/** Build a fresh state for a brand-new game. */
export function createInitialState() {
  return {
    secret: generateSecret(),
    guesses: [],
    input: '',
    won: false,
  };
}

/** Strip anything non-serialisable (here: everything is plain data already). */
export function toSaveable(state) {
  return {
    secret: state.secret,
    guesses: state.guesses.map(g => ({ guess: g.guess, a: g.a, b: g.b })),
    input: state.input,
    won: state.won,
  };
}

/**
 * Rebuild a state from persisted data, validating structure like solitaire's
 * loadGame() does. Returns a valid state or null if the data is corrupt.
 */
export function fromSaveable(data) {
  if (!data || typeof data !== 'object') return null;
  const { secret, guesses, input, won } = data;
  // Secret: 4 unique digits.
  if (typeof secret !== 'string' || secret.length !== DIGITS || !/^\d+$/.test(secret) || !hasUniqueDigits(secret)) {
    return null;
  }
  // Guesses: array of {guess, a, b} with sane ranges.
  if (!Array.isArray(guesses)) return null;
  for (const g of guesses) {
    if (!g || typeof g.guess !== 'string' || g.guess.length !== DIGITS) return null;
    if (!Number.isInteger(g.a) || !Number.isInteger(g.b) || g.a < 0 || g.b < 0) return null;
    if (g.a > DIGITS || g.b > DIGITS) return null;
  }
  // input: 0..DIGITS digit chars (may be empty mid-entry).
  if (typeof input !== 'string' || !/^\d*$/.test(input) || input.length > DIGITS) {
    return null;
  }
  if (typeof won !== 'boolean') return null;
  return { secret, guesses, input, won };
}
