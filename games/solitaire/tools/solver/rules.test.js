// Sanity tests for the solver rules port. Run with:  node --test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseLayout } from './parse.js';
import * as R from './rules.js';

test('canStack: number, +1 rank, different colour', () => {
  assert.equal(R.canStack({ type: 'number', color: 'red', rank: 3 }, { type: 'number', color: 'black', rank: 4 }), true);
  assert.equal(R.canStack({ type: 'number', color: 'red', rank: 3 }, { type: 'number', color: 'red', rank: 4 }), false);
  assert.equal(R.canStack({ type: 'number', color: 'red', rank: 3 }, { type: 'number', color: 'black', rank: 5 }), false);
  assert.equal(R.canStack({ type: 'number', color: 'red', rank: 3 }, { type: 'dragon', color: 'black' }), false);
});

test('isValidRun rejects mixed/non-number tails', () => {
  assert.equal(R.isValidRun([
    { type: 'number', color: 'red', rank: 5 },
    { type: 'number', color: 'black', rank: 4 },
    { type: 'number', color: 'green', rank: 3 },
  ]), true);
  assert.equal(R.isValidRun([
    { type: 'number', color: 'red', rank: 5 },
    { type: 'number', color: 'black', rank: 4 },
    { type: 'dragon', color: 'green' },
  ]), false);
});

test('isSafeNumber: needs all other colours at rank-1', () => {
  const s = {
    foundations: { red: [], black: [], green: [] },
  };
  // red 1 is always safe
  assert.equal(R.isSafeNumber(s, { type: 'number', color: 'red', rank: 2 }), false); // red empty
  s.foundations.red = [{ type: 'number', color: 'red', rank: 1 }];
  // red 2 needs black>=1 and green>=1
  assert.equal(R.isSafeNumber(s, { type: 'number', color: 'red', rank: 2 }), false);
  s.foundations.black = [{ type: 'number', color: 'black', rank: 1 }];
  s.foundations.green = [{ type: 'number', color: 'green', rank: 1 }];
  assert.equal(R.isSafeNumber(s, { type: 'number', color: 'red', rank: 2 }), true);
});

test('collect dragons: all REMAINING dragons of the colour exposed + free slot', () => {
  const s = {
    tableau: [
      [{ type: 'dragon', color: 'red' }, { type: 'number', color: 'black', rank: 2 }], // buried under the number
      [{ type: 'dragon', color: 'red' }],                                              // exposed top
      [{ type: 'dragon', color: 'red' }],
      [{ type: 'dragon', color: 'red' }],
    ],
    freeCells: [null, null, null],
    foundations: { red: [], black: [], green: [] },
  };
  // one of four red dragons buried -> not ready
  assert.equal(R.canCollectDragons(s, 'red'), false);
  // expose it
  s.tableau[0].pop();
  assert.equal(R.canCollectDragons(s, 'red'), true);
  // ...but no free slot -> not ready
  s.freeCells[0] = { type: 'number', color: 'black', rank: 9 };
  s.freeCells[1] = { type: 'number', color: 'green', rank: 9 };
  s.freeCells[2] = { type: 'number', color: 'red', rank: 9 };
  assert.equal(R.canCollectDragons(s, 'red'), false);
});

test('stateKey treats same-colour dragons as interchangeable', () => {
  const a = {
    tableau: [[{ type: 'dragon', color: 'red' }, { type: 'number', color: 'black', rank: 5 }]],
    freeCells: [null, null, null],
    foundations: { red: [], black: [], green: [] },
    flowerSlot: null,
  };
  assert.equal(R.stateKey(a), R.stateKey(a));
});

test('parseLayout: the documented initial layout is a valid 40-card deck', () => {
  const text = `
b5 g6 g8 g4 r6
g9 r3 g5 w r4
g1 f b9 r8 w
b3 w b4 g3 r1
r5 f b8 r2 z
w z z h b7
b1 r9 f r7 b6
z g7 g2 b2 f

w=万
f=发
z=中
h=花
`;
  const st = parseLayout(text);
  // each column has 5 cards; a line reads bottom-of-stack → top-of-stack, so
  // the LAST token is the grabbable column top ("最外层在右边").
  assert.equal(st.tableau.length, 8);
  assert.equal(st.tableau[0].length, 5);
  // col0 line "b5 g6 g8 g4 r6" → top (grabbable) = r6
  assert.equal(st.tableau[0][4].type, 'number');
  assert.equal(st.tableau[0][4].color, 'red');
  assert.equal(st.tableau[0][4].rank, 6);
  // col7 line "z g7 g2 b2 f" → top = f (green dragon, grabbable); 黑2 at idx3
  // has the 發 "outside" it (nearer the top) — matches the player's board.
  assert.equal(st.tableau[7][4].type, 'dragon');
  assert.equal(st.tableau[7][4].color, 'green');
  assert.equal(st.tableau[7][3].type, 'number');
  assert.equal(st.tableau[7][3].color, 'black');
  assert.equal(st.tableau[7][3].rank, 2);
  // col3 line "b3 w b4 g3 r1" → top = r1 (auto-fly at deal)
  assert.equal(st.tableau[3][4].rank, 1);
  assert.equal(st.tableau[3][4].color, 'red');
  // flower is at col5 line6 token 3 ("h") → internal idx 3
  const flower = st.tableau[5][3];
  assert.equal(flower.type, 'flower');
});

// ---------------------------------------------------------------------------
// isReversibleStep — the theory from the solver spec (games/solitaire/docs/
// solver.md appendix): a step is reversible iff
// its inverse move is legal in the post-step converged state.
// ---------------------------------------------------------------------------

const num = (color, rank) => ({ type: 'number', color, rank });
const drg = (color) => ({ type: 'dragon', color });
function mkState(rows, freeCells = [null, null, null], foundations = { red: [], black: [], green: [] }) {
  return { tableau: rows, freeCells, foundations, flowerSlot: null };
}
const mv = (from, to) => ({ kind: 'move', from, to });
// isReversibleStep judges the POST-step converged state, so apply the move
// (plus its forced auto cascade) first.
function postStep(initial, step) {
  const state = R.cloneState(initial);
  R.commitUserMove(state, step);
  R.runAutoMoves(state);
  return state;
}

test('isReversibleStep: spec example 1 — b2 off r3 onto g3 is reversible', () => {
  // col0 = [r3, b2] (b2 on top), col1 = [g3]; move b2 onto g3.
  const initial = mkState([[num('red', 3), num('black', 2)], [num('green', 3)]]);
  const step = mv({ zone: 'tableau', col: 0, start: 1 }, { type: 'column', index: 1 });
  // Post-move: col0 = [r3], col1 = [g3, b2]. Inverse (b2 back onto r3):
  // r3.rank === 2+1 and colours differ → legal.
  assert.equal(R.isReversibleStep(postStep(initial, step), step), true);
});

test('isReversibleStep: spec example 2 — r2 off r3 onto g3 is NOT reversible', () => {
  // col0 = [r3, r2] (same-colour stack — only possible from an initial deal),
  // col1 = [g3]; move r2 onto g3.
  const initial = mkState([[num('red', 3), num('red', 2)], [num('green', 3)]]);
  const step = mv({ zone: 'tableau', col: 0, start: 1 }, { type: 'column', index: 1 });
  // Inverse (r2 back onto r3): same colour → illegal.
  assert.equal(R.isReversibleStep(postStep(initial, step), step), false);
});

test('isReversibleStep: dragon into empty column / free cell is reversible', () => {
  // Dragon off col0 into an empty column: source column ends up empty.
  const s1 = mkState([[drg('red')], []]);
  const step1 = mv({ zone: 'tableau', col: 0, start: 0 }, { type: 'column', index: 1 });
  assert.equal(R.isReversibleStep(postStep(s1, step1), step1), true);
  // Dragon into an empty free cell — same, source column empty.
  const s2 = mkState([[drg('red')]]);
  const step2 = mv({ zone: 'tableau', col: 0, start: 0 }, { type: 'freecell', index: 0 });
  assert.equal(R.isReversibleStep(postStep(s2, step2), step2), true);
});

test('isReversibleStep: collect / foundation / flower targets are never reversible', () => {
  const s = mkState([[num('red', 3)]]);
  assert.equal(R.isReversibleStep(s, { kind: 'collect', color: 'red' }), false);
  const f = mv({ zone: 'tableau', col: 0, start: 0 }, { type: 'foundation', color: 'red' });
  assert.equal(R.isReversibleStep(postStep(s, f), f), false);
  const fl = mv({ zone: 'tableau', col: 0, start: 0 }, { type: 'flower' });
  assert.equal(R.isReversibleStep(postStep(s, fl), fl), false);
});

test('isReversibleStep: source free cell is always reversible', () => {
  // b4 parked in free cell 0, col0 = [r5]; move b4 onto r5 — inverse puts it
  // back into the (now empty) cell → always legal.
  const initial = mkState([[num('red', 5)]], [num('black', 4), null, null]);
  const step = mv({ zone: 'freecell', idx: 0 }, { type: 'column', index: 0 });
  assert.equal(R.isReversibleStep(postStep(initial, step), step), true);
});

test('isReversibleStep: cascade removing the card under the run — judged against the new top', () => {
  // col0 = [r5, r4, b3] (b3 top; r4 on r5 is an illegal stack, deal-only),
  // col1 = [g4]; foundations red/black/green at 3.
  // Move b3 onto g4 → the cascade exposes r4 (safe → red foundation) and g4
  // (safe → green foundation), leaving col0 = [r5], col1 = [b3].
  const initial = mkState(
    [
      [num('red', 5), num('red', 4), num('black', 3)],
      [num('green', 4)],
    ],
    [null, null, null],
    {
      red: [num('red', 1), num('red', 2), num('red', 3)],
      black: [num('black', 1), num('black', 2), num('black', 3)],
      green: [num('green', 1), num('green', 2), num('green', 3)],
    },
  );
  const step = mv({ zone: 'tableau', col: 0, start: 2 }, { type: 'column', index: 1 });
  // Inverse (b3 back onto col0): col0 top is now r5 (r4 flew) — r5.rank !== 3+1.
  assert.equal(R.isReversibleStep(postStep(initial, step), step), false);
});

test('isReversibleStep: cascade emptying the source column makes the move reversible', () => {
  // col0 = [g4, b3] (b3 top, legal stack), col1 = [r4]; all foundations at 3.
  // Move b3 onto r4 → cascade sends g4 (safe) to the green foundation, and r4
  // to the red foundation, leaving col0 EMPTY → the inverse (b3 back) is legal.
  const initial = mkState(
    [
      [num('green', 4), num('black', 3)],
      [num('red', 4)],
    ],
    [null, null, null],
    {
      red: [num('red', 1), num('red', 2), num('red', 3)],
      black: [num('black', 1), num('black', 2), num('black', 3)],
      green: [num('green', 1), num('green', 2), num('green', 3)],
    },
  );
  const step = mv({ zone: 'tableau', col: 0, start: 1 }, { type: 'column', index: 1 });
  assert.equal(R.isReversibleStep(postStep(initial, step), step), true);
});

test('isReversibleStep: initial-deal illegal stacks — dragon on a number, number on a dragon', () => {
  // col0 = [b2, f] — a green dragon sitting on b2 (deal-only). Move the dragon
  // to an empty column: inverse would stack the dragon back onto b2 → illegal.
  const s1 = mkState([[num('black', 2), drg('green')], []]);
  const step1 = mv({ zone: 'tableau', col: 0, start: 1 }, { type: 'column', index: 1 });
  assert.equal(R.isReversibleStep(postStep(s1, step1), step1), false);
  // col0 = [f, b2] — b2 sitting on a green dragon. Move b2 to an empty column:
  // inverse would stack b2 onto the dragon → illegal.
  const s2 = mkState([[drg('green'), num('black', 2)], []]);
  const step2 = mv({ zone: 'tableau', col: 0, start: 1 }, { type: 'column', index: 1 });
  assert.equal(R.isReversibleStep(postStep(s2, step2), step2), false);
});
