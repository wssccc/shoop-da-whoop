// Immutable-ish game state model plus undo snapshot helpers.

import { COLORS, FREE_CELL_COUNT } from './constants.js';
import { deal } from './deck.js';

// A brand new, freshly dealt state.
export function createInitialState() {
  return fromLayout({
    tableau: deal(),
    freeCells: Array.from({ length: FREE_CELL_COUNT }, () => null),
    foundations: COLORS.reduce((o, c) => { o[c] = []; return o; }, {}),
    flowerSlot: null,
  });
}

// Wrap a persisted/incoming layout into a full state. `layout.history` (when
// present, e.g. restored from localStorage) becomes the undo stack; absent /
// malformed values fall back to an empty stack so a fresh game stays clean.
export function fromLayout(layout) {
  return {
    tableau: layout.tableau,
    freeCells: layout.freeCells,
    foundations: layout.foundations,
    flowerSlot: layout.flowerSlot,
    history: Array.isArray(layout.history) ? layout.history : [],
  };
}

// Deep-clone the board portion (no history) — used for undo snapshots & saves.
function snapshotClone(state, includeHistory = false) {
  const snap = {
    tableau: state.tableau.map(col => col.map(c => ({ ...c }))),
    freeCells: state.freeCells.map(c => {
      if (!c) return null;
      if (c.locked) return { locked: true, type: 'dragonpile', color: c.color, cards: c.cards.map(x => ({ ...x })) };
      return { ...c };
    }),
    foundations: Object.fromEntries(
      COLORS.map(c => [c, state.foundations[c].map(x => ({ ...x }))]),
    ),
    flowerSlot: state.flowerSlot ? { ...state.flowerSlot } : null,
  };
  if (includeHistory) snap.history = [];
  return snap;
}

// Public serialisable form for localStorage. Includes the undo stack so a
// refresh keeps undo working — each entry is a board-only clone (snapshotClone
// with the default `includeHistory=false` omits the history field), so there is
// no recursive nesting and the whole thing stays shallow & JSON-safe.
export function toSaveable(state) {
  const snap = snapshotClone(state);
  snap.history = state.history.map(h => snapshotClone(h));
  return snap;
}

// Push a restore point onto the undo stack.
export function snapshot(state) {
  state.history.push(snapshotClone(state));
  if (state.history.length > 300) state.history.shift();
}

// Pop and apply the last restore point. Returns false if none.
export function restoreSnapshot(state) {
  if (state.history.length === 0) return false;
  const s = state.history.pop();
  state.tableau = s.tableau;
  state.freeCells = s.freeCells;
  state.foundations = s.foundations;
  state.flowerSlot = s.flowerSlot;
  return true;
}
