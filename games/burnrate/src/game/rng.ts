// Deterministic PRNG + default randomness.
//
// All randomness in the engine flows through an injectable `Rng`. Tests pass a
// seeded `mulberry32(n)` so builds/AI choices are fully reproducible.

import type { Rng } from './types';

/** Fast, well-distributed seeded PRNG. Produces the same sequence for the same
 *  seed, which is what makes the engine snapshot-testable. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The non-deterministic fallback used by the real game in the browser. */
export const defaultRng: Rng = Math.random;
