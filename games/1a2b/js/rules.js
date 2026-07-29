// Pure rule helpers — no DOM, no side effects, no imports beyond constants /
// shared utils. Every function here is independently unit-testable, just like
// solitaire's rules.js.

import { shuffle } from '../../../shared/utils/common.js';
import { DIGITS } from './constants.js';

/**
 * Generate a fresh secret: a 4-digit code (0-9) with all unique digits.
 * Returns it as a string so a leading '0' is preserved (1A2B treats the code
 * as a symbol string, not a number).
 */
export function generateSecret() {
  const pool = shuffle(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  return pool.slice(0, DIGITS).join('');
}

/** True when every character of `s` is distinct. */
export function hasUniqueDigits(s) {
  const seen = new Set(s);
  return seen.size === s.length;
}

/**
 * Validate a user-supplied guess string.
 * Returns { ok, reason }. `reason` is a short machine code for diagnostics.
 *   ok=true ⇒ exactly DIGITS unique digits.
 */
export function validateGuess(input) {
  if (typeof input !== 'string' || input.length !== DIGITS) {
    return { ok: false, reason: 'length' };
  }
  if (!/^\d+$/.test(input)) {
    return { ok: false, reason: 'non-digit' };
  }
  if (!hasUniqueDigits(input)) {
    return { ok: false, reason: 'duplicate' };
  }
  return { ok: true, reason: '' };
}

/**
 * Score a guess against the secret using classic 1A2B semantics.
 *   A = digit correct AND in the correct position
 *   B = digit correct but in the wrong position
 * Returns { a, b }. Works for codes with unique digits (our invariant).
 */
export function computeAB(guess, secret) {
  let a = 0;
  let b = 0;
  for (let i = 0; i < secret.length; i++) {
    if (guess[i] === secret[i]) {
      a++;
    } else if (secret.includes(guess[i])) {
      b++;
    }
  }
  return { a, b };
}

/** Win ⇔ every digit is a positional match (4A0B). */
export function isWin(ab) {
  return ab.a === DIGITS;
}
