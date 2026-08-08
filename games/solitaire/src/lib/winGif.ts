// Win-card celebration picker: hash the LAST collected card's id to one of
// the three parade gifs. Deterministic — the same final card always shows
// the same gif (and the e2e suite predicts it for the fixed win path).
import type { Card } from '../game/types';

const GIFS = ['/images/1.gif', '/images/2.gif', '/images/3.gif'];

/** djb2 string hash (unsigned). The 27 number-card ids map ~evenly onto
 *  0..2 — 9 ids per residue — so wins spread across the three gifs. */
export function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}

/** The celebration gif for a win, keyed off the card that completed it. */
export function winGifFor(lastCard: Card | null): string {
  if (!lastCard) return GIFS[1]; // no card recorded — 2.gif (legacy default)
  return GIFS[djb2(lastCard.id) % GIFS.length];
}
