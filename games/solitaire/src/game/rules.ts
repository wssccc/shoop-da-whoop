// Pure rule helpers — no mutation, no DOM. Safe to unit-test in isolation.
// Faithful 1:1 port of the original rules.js, only adding types.

import { COLORS, RANK_MAX } from './constants';
import type {
    Board,
    Card,
    CardColor,
    CardLocation,
    DestDescriptor,
    DragonCard,
    FlowerCard,
    NumberCard,
} from './types';
export function isNumber(
  c: Card | null | undefined,
): c is NumberCard {
  return !!c && c.type === 'number';
}

export function isDragon(
  c: Card | null | undefined,
): c is DragonCard {
  return !!c && c.type === 'dragon';
}

export function isFlower(
  c: Card | null | undefined,
): c is FlowerCard {
  return !!c && c.type === 'flower';
}

/** Can `moving` be stacked onto `target`? (target one rank higher, different colour) */
export function canStack(moving: Card, target: Card): boolean {
  if (!isNumber(target) || !isNumber(moving)) return false;
  return target.rank === moving.rank + 1 && target.color !== moving.color;
}

/**
 * A sequence is valid if every card is a number and each successive card
 * (lower index = higher rank = the "bottom" of the carried run) is one rank
 * lower and a different colour than the previous one.
 */
export function isValidRun(cards: Card[]): boolean {
  if (!cards.every(isNumber)) return false;
  for (let i = 0; i < cards.length - 1; i++) {
    if (!canStack(cards[i + 1], cards[i])) return false; // cards[i+1] stacks on cards[i]
  }
  return true;
}

/**
 * Locate where a card currently lives among the movable zones
 * (tableau columns and free cells). Foundation/flower cards are never returned,
 * so they become non-draggable.
 */
export function findCard(state: Board, cardId: string): CardLocation | null {
  for (let c = 0; c < state.tableau.length; c++) {
    const idx = state.tableau[c].findIndex((card) => card.id === cardId);
    if (idx >= 0) return { zone: 'tableau', col: c, idx };
  }
  for (let i = 0; i < state.freeCells.length; i++) {
    const fc = state.freeCells[i];
    // A dragon pile is locked → not draggable. Only loose single cards are.
    if (fc && fc.type !== 'dragonpile' && fc.id === cardId) {
      return { zone: 'freecell', idx: i };
    }
  }
  return null;
}

export function freeEmptyCount(state: Board): number {
  return state.freeCells.filter((c) => c === null).length;
}

export function emptyColumnCount(state: Board, exclude = -1): number {
  let n = 0;
  for (let i = 0; i < state.tableau.length; i++) {
    if (i === exclude) continue;
    if (state.tableau[i].length === 0) n++;
  }
  return n;
}

/**
 * Theoretical max run length movable as a single super-move, given the
 * available free cells and empty columns. `destColumn` (when targeting an
 * empty column) is excluded from the empty-column count per FreeCell rules.
 *
 * NOTE: Kept as a reference helper only — validDropTargets() no longer enforces
 * a capacity limit, so any length of valid run may be moved to a tableau
 * column in a single action.
 */
export function movableCount(state: Board, destColumn = -1): number {
  const free = freeEmptyCount(state);
  const emptyCols = emptyColumnCount(state, destColumn);
  return (1 + free) * 2 ** emptyCols;
}

/** Number of dragons still in play (tableau + free cells, excluding a collected pile). */
export function dragonsOnBoard(state: Board): number {
  let n = 0;
  for (const col of state.tableau) {
    for (const c of col) if (isDragon(c)) n++;
  }
  for (const fc of state.freeCells) {
    if (fc && fc.type !== 'dragonpile' && isDragon(fc)) n++;
  }
  return n;
}

/** Are every remaining dragon of `color` exposed (a column top, or in a free cell)? */
export function allDragonsOfColorExposed(state: Board, color: CardColor): boolean {
  let total = 0;
  let exposed = 0;
  for (const col of state.tableau) {
    for (let i = 0; i < col.length; i++) {
      const card = col[i];
      if (isDragon(card) && card.color === color) {
        total++;
        if (i === col.length - 1) exposed++;
      }
    }
  }
  for (const fc of state.freeCells) {
    if (fc && fc.type !== 'dragonpile' && isDragon(fc) && fc.color === color) {
      total++;
      exposed++;
    }
  }
  return total > 0 && exposed === total;
}

/**
 * A dragon collect is allowed for `color` when all four of that colour are
 * exposed AND there is a destination slot: an empty free cell, or a free cell
 * currently holding a single dragon of the SAME colour (the collect step will
 * merge it in, vacating that slot). A free cell holding a different-colour
 * dragon must NOT count — otherwise collecting would overwrite that card.
 */
export function canCollectDragons(state: Board, color: CardColor): boolean {
  if (!allDragonsOfColorExposed(state, color)) return false;
  return state.freeCells.some(
    (c) => c === null || (c && c.type !== 'dragonpile' && isDragon(c) && c.color === color),
  );
}

/** Return the first colour whose dragons are ready to collect, or null. */
export function readyDragonColor(state: Board): CardColor | null {
  for (const color of COLORS) {
    if (canCollectDragons(state, color)) return color;
  }
  return null;
}

/**
 * Determine the run that can be grabbed starting at `cardId` in the tableau.
 * - Clicking the top card (any type) grabs it alone.
 * - Clicking a deeper card grabs the tail only if it forms a valid run.
 */
export function grabRunFromTableau(state: Board, cardId: string): Card[] | null {
  const loc = findCard(state, cardId);
  if (!loc || loc.zone !== 'tableau') return null;
  const col = state.tableau[loc.col];
  const slice = col.slice(loc.idx);
  if (slice.length === 1) return slice; // top card, any type
  if (isValidRun(slice)) return slice;
  return null;
}

/** All legal drop targets for the given run. `run[0]` is the carried head (highest rank). */
export function validDropTargets(state: Board, run: Card[]): DestDescriptor[] {
  const targets: DestDescriptor[] = [];
  if (!run || run.length === 0) return targets;
  const head = run[0];
  const len = run.length;
  const src = findCard(state, head.id);

  // Tableau columns.
  for (let i = 0; i < state.tableau.length; i++) {
    if (src && src.zone === 'tableau' && src.col === i) continue;
    const col = state.tableau[i];
    if (col.length === 0) {
      targets.push({ type: 'column', index: i });
    } else {
      const top = col[col.length - 1];
      if (isDragon(top)) continue; // nothing stacks on a dragon
      if (canStack(head, top)) {
        targets.push({ type: 'column', index: i });
      }
    }
  }

  // Free cells: single card only.
  if (len === 1) {
    for (let i = 0; i < state.freeCells.length; i++) {
      if (state.freeCells[i] !== null) continue;
      if (src && src.zone === 'freecell' && src.idx === i) continue;
      targets.push({ type: 'freecell', index: i });
    }
  }

  // Foundations: single number card, next rank for its colour.
  if (len === 1 && isNumber(head)) {
    const f = state.foundations[head.color];
    if (f.length === head.rank - 1) {
      targets.push({ type: 'foundation', color: head.color });
    }
  }

  // Flower slot: single flower card.
  if (len === 1 && isFlower(head) && state.flowerSlot === null) {
    targets.push({ type: 'flower' });
  }

  return targets;
}

/**
 * "Safe" auto-move: a number card may fly to its foundation when it is the next
 * needed rank for its colour AND every other colour has already placed the
 * rank one below (so this card can never be needed as a tableau landing spot).
 * Rank 1 is always safe once its colour foundation expects it.
 */
function isSafeNumber(state: Board, card: Card): boolean {
  if (!isNumber(card)) return false;
  if (state.foundations[card.color].length !== card.rank - 1) return false;
  for (const c of COLORS) {
    if (c === card.color) continue;
    if (state.foundations[c].length < card.rank - 1) return false;
  }
  return true;
}

/** Return at most one auto-move to apply (lowest safe rank first; flower first). */
export function nextAutoMove(state: Board): { cardId: string; to: DestDescriptor } | null {
  // Flower flies to its slot the moment it is exposed.
  if (state.flowerSlot === null) {
    for (const col of state.tableau) {
      const top = col[col.length - 1];
      if (top && isFlower(top)) return { cardId: top.id, to: { type: 'flower' } };
    }
    for (const fc of state.freeCells) {
      if (fc && fc.type !== 'dragonpile' && isFlower(fc)) {
        return { cardId: fc.id, to: { type: 'flower' } };
      }
    }
  }

  const exposed: NumberCard[] = [];
  for (const col of state.tableau) {
    const top = col[col.length - 1];
    if (top && isNumber(top)) exposed.push(top);
  }
  for (const fc of state.freeCells) {
    if (fc && fc.type !== 'dragonpile' && isNumber(fc)) exposed.push(fc);
  }

  const candidates = exposed
    .filter((c) => isSafeNumber(state, c))
    .sort((a, b) => a.rank - b.rank);
  if (candidates.length === 0) return null;
  const card = candidates[0];
  return { cardId: card.id, to: { type: 'foundation', color: card.color } };
}

export function isWin(state: Board): boolean {
  return (
    COLORS.every((c) => state.foundations[c].length === RANK_MAX) &&
    state.flowerSlot !== null &&
    dragonsOnBoard(state) === 0
  );
}

/** Compare two drop-target descriptors. */
export function sameDest(a: DestDescriptor, b: DestDescriptor): boolean {
  if (a.type !== b.type) return false;
  if (a.type === 'column' || a.type === 'freecell') {
    return a.index === (b as { index: number }).index;
  }
  if (a.type === 'foundation') {
    return a.color === (b as { color: CardColor }).color;
  }
  return true; // flower
}
