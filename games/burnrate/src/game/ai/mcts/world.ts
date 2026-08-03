// IS-MCTS world sampling (determinisation).
//
// The AI may only observe: its own hand + all public zones (companies,
// projects, discard). Opponents' hands and the deck order are hidden. Each
// MCTS simulation starts from a *sampled* world drawn from the current state:
//
//   unknown pool = current deck (hidden order) ∪ all opponents' hidden hands
//
// We shuffle that pool with the simulation rng and re-slice it — the first
// N_foe cards become the sampled opponent hands, the rest the sampled deck.
// This is an exact uniform draw without replacement, so the sampled world is
// consistent (no card appears twice) and unbiased.

import { cloneState } from '../../state';
import type { Card, GameState, PlayerId, Rng } from '../../types';

/** Sample one deterministic world consistent with what `self` may know. */
export function sampleWorld(state: GameState, rng: Rng, self: PlayerId): GameState {
  const s = cloneState(state);

  const hands: { player: PlayerId; count: number }[] = [];
  let needed = 0;
  for (let i = 0; i < s.players.length; i++) {
    if (i === self || !s.players[i].alive) continue;
    const count = s.players[i].hand.length;
    if (count > 0) {
      hands.push({ player: i, count });
      needed += count;
    }
  }
  if (needed === 0) return s; // nothing hidden — already fully determined

  const pool: Card[] = [...s.deck];
  // Guard against a pathological deck smaller than the hidden hands.
  needed = Math.min(needed, pool.length);
  // Partial Fisher-Yates: shuffle only the first `needed` slots into place.
  for (let i = 0; i < needed && i < pool.length; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  let ptr = 0;
  for (const h of hands) {
    const count = Math.min(h.count, needed - ptr);
    if (count <= 0) {
      s.players[h.player].hand = [];
      continue;
    }
    s.players[h.player].hand = pool.slice(ptr, ptr + count);
    ptr += count;
  }
  s.deck = pool.slice(ptr);
  return s;
}
