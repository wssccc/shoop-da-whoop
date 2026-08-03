// Fisher–Yates shuffle. Kept separate from cards.ts so it is independently
// testable and reusable. Non-mutating: always returns a fresh array.

import { defaultRng } from './rng';
import type { Rng } from './types';

export function shuffle<T>(arr: readonly T[], rng: Rng = defaultRng): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
