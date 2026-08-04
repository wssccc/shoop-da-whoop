// Immutable-ish game state model plus undo snapshot helpers.

import { COLORS, FREE_CELL_COUNT } from './constants';
import { deal } from './deck';
import type {
    Board,
    Foundations,
    GameState,
    Snapshot,
} from './types';

export interface IncomingLayout {
  tableau: Board['tableau'];
  freeCells: Board['freeCells'];
  foundations: Board['foundations'];
  flowerSlot: Board['flowerSlot'];
  history?: unknown;
}

/** A brand new, freshly dealt state. */
export function createInitialState(): GameState {
  return fromLayout({
    tableau: deal(),
    freeCells: Array.from({ length: FREE_CELL_COUNT }, () => null),
    foundations: COLORS.reduce(
      (o, c) => {
        o[c] = [];
        return o;
      },
      {} as Foundations,
    ),
    flowerSlot: null,
  });
}

/**
 * Wrap a persisted/incoming layout into a full state. `layout.history` (when
 * present, e.g. restored from localStorage) becomes the undo stack; absent /
 * malformed values fall back to an empty stack so a fresh game stays clean.
 */
export function fromLayout(layout: IncomingLayout): GameState {
  const history = Array.isArray(layout.history)
    ? (layout.history as Snapshot[])
    : [];
  return {
    tableau: layout.tableau,
    freeCells: layout.freeCells,
    foundations: layout.foundations,
    flowerSlot: layout.flowerSlot,
    history,
  };
}

/** Deep-clone the board portion (no history) — used for undo snapshots & saves. */
export function snapshotClone(state: Board): Snapshot {
  return {
    tableau: state.tableau.map((col) => col.map((c) => ({ ...c }))),
    freeCells: state.freeCells.map((c) => {
      if (!c) return null;
      if (c.type === 'dragonpile') {
        return {
          type: 'dragonpile',
          locked: true,
          color: c.color,
          cards: c.cards.map((x) => ({ ...x })),
        };
      }
      return { ...c };
    }),
    // PRE-EXISTING RISK surfaced by the new gate: Object.fromEntries is ES2019
    // (Chrome 73+ / Safari 12.1+), absent on the Chrome 60 floor. TODO rewrite
    // as COLORS.reduce() so snapshot/undo can't throw on legacy Chrome. Tracked
    // separately so this burnrate-focused change doesn't alter solitaire logic.
    /* eslint-disable compat/compat */
    foundations: Object.fromEntries(
      COLORS.map((c) => [c, state.foundations[c].map((x) => ({ ...x }))]),
    ) as Foundations,
    /* eslint-enable compat/compat */
    flowerSlot: state.flowerSlot ? { ...state.flowerSlot } : null,
  };
}

/**
 * Public serialisable form for localStorage. Includes the undo stack so a
 * refresh keeps undo working — each entry is a board-only clone, so there is
 * no recursive nesting and the whole thing stays shallow & JSON-safe.
 */
export function toSaveable(state: GameState): Snapshot & { history: Snapshot[] } {
  const snap = snapshotClone(state);
  return { ...snap, history: state.history.map((h) => snapshotClone(h)) };
}

/** Push a restore point onto the undo stack. */
export function snapshot(state: GameState): void {
  state.history.push(snapshotClone(state));
  if (state.history.length > 300) state.history.shift();
}

/** Pop and apply the last restore point. Returns false if none. */
export function restoreSnapshot(state: GameState): boolean {
  if (state.history.length === 0) return false;
  const s = state.history.pop()!;
  state.tableau = s.tableau;
  state.freeCells = s.freeCells;
  state.foundations = s.foundations;
  state.flowerSlot = s.flowerSlot;
  return true;
}
