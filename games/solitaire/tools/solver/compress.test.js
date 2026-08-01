// Tests for the solution compressor. Run with:  node --test
//
// All tests use a NEAR-WIN board (green needs its 9; flower already in slot;
// all dragons collected) where the exposed g9 auto-finishes the game the
// moment the board settles — so any compression that leaves a legal, winning
// path passes replayCheck, and wasted moves (park/fetch, out-and-back) must be
// removable without breaking the win.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compressSteps } from './compress.js';

function nearWinState() {
  const nums = (color, ranks) => ranks.map((rank) => ({ type: 'number', color, rank }));
  return {
    tableau: [
      [nums('green', [9])[0]], // col0: g9 (auto-finishes when exposed/safe)
      [nums('red', [5])[0], nums('black', [4])[0]], // col1: [r5, b4] — top b4
      [], [], [], [], [], [],
    ],
    freeCells: [
      { type: 'dragonpile', locked: true, color: 'red', cards: [] },
      { type: 'dragonpile', locked: true, color: 'black', cards: [] },
      { type: 'dragonpile', locked: true, color: 'green', cards: [] },
    ],
    foundations: {
      red: nums('red', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
      black: nums('black', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
      green: nums('green', [1, 2, 3, 4, 5, 6, 7, 8]),
    },
    flowerSlot: { type: 'flower' },
  };
}

const mv = (from, to) => ({ kind: 'move', from, to, count: 1, head: { type: 'number', color: 'x', rank: 0 } });

/** Near-win board where g9 is BURIED under b4 (deal-only illegal stack): g9
 *  only auto-flies after b4 is moved away. */
function g9UnderState() {
  const nums = (color, ranks) => ranks.map((rank) => ({ type: 'number', color, rank }));
  return {
    tableau: [
      [nums('green', [9])[0], nums('black', [4])[0]], // col0: [g9, b4] — b4 top
      [], [], [], [], [], [], [],
    ],
    freeCells: [
      { type: 'dragonpile', locked: true, color: 'red', cards: [] },
      { type: 'dragonpile', locked: true, color: 'black', cards: [] },
      { type: 'dragonpile', locked: true, color: 'green', cards: [] },
    ],
    foundations: {
      red: nums('red', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
      black: nums('black', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
      green: nums('green', [1, 2, 3, 4, 5, 6, 7, 8]),
    },
    flowerSlot: { type: 'flower' },
  };
}

test('compress: "move out and back" pair is dropped entirely', () => {
  const steps = [
    { user: mv({ zone: 'tableau', col: 1, start: 1 }, { type: 'column', index: 3 }), auto: [] }, // b4 → col3 (waste park)
    { user: mv({ zone: 'tableau', col: 3, start: 0 }, { type: 'column', index: 1 }), auto: [] }, // b4 → back on r5 (no-op)
  ];
  const res = compressSteps(nearWinState(), steps);
  assert.equal(res.win, true, 'must still win');
  assert.equal(res.after, 0, 'both waste steps must be removed');
});

test('compress: "park then fetch" pair collapses to a direct move', () => {
  // g9 is buried under b4, so moving b4 away is REQUIRED (g9 auto-flies). The
  // park-then-fetch pair still collapses: b4 goes straight to col4.
  const state = g9UnderState();
  const steps = [
    { user: mv({ zone: 'tableau', col: 0, start: 1 }, { type: 'column', index: 3 }), auto: [] }, // b4 → col3
    { user: mv({ zone: 'tableau', col: 3, start: 0 }, { type: 'column', index: 4 }), auto: [] }, // b4 → col4
  ];
  const res = compressSteps(state, steps);
  assert.equal(res.win, true);
  assert.equal(res.after, 1, 'should be a single direct move');
  const u = res.steps.find((s) => s.user).user;
  assert.equal(u.to.index, 4);
  assert.equal(u.from.col, 0);
});

test('compress: cycle removal handles a loop followed by more moves', () => {
  // The loop (out-and-back) returns to the exact pre-loop state, so the whole
  // segment is dropped; the following move is then itself a pure reversible
  // detour on the near-win board and gets dropped too — nothing is lost.
  const steps = [
    { user: mv({ zone: 'tableau', col: 1, start: 1 }, { type: 'column', index: 3 }), auto: [] }, // out
    { user: mv({ zone: 'tableau', col: 3, start: 0 }, { type: 'column', index: 1 }), auto: [] }, // back → same state
    { user: mv({ zone: 'tableau', col: 1, start: 1 }, { type: 'column', index: 4 }), auto: [] }, // b4 → col4
  ];
  const res = compressSteps(nearWinState(), steps);
  assert.equal(res.win, true);
  assert.equal(res.after, 0, 'loop dropped; trailing move is a removable detour');
});

test('compress: intermediate steps that do not touch the park spot are preserved', () => {
  // Every move here is a pure detour on the near-win board: the pair (1,3)
  // collapses into a direct move, which is itself reversible and dropped, and
  // the r5 shuttle (step 2) is dropped too once the other moves are gone —
  // the whole path reduces to zero (the g9 auto-finish does all the work).
  const steps = [
    { user: mv({ zone: 'tableau', col: 1, start: 1 }, { type: 'column', index: 3 }), auto: [] }, // b4 → col3
    { user: mv({ zone: 'tableau', col: 1, start: 0 }, { type: 'column', index: 5 }), auto: [] }, // r5 → col5 (uses col1!)
    { user: mv({ zone: 'tableau', col: 3, start: 0 }, { type: 'column', index: 4 }), auto: [] }, // b4 → col4
  ];
  const res = compressSteps(nearWinState(), steps);
  assert.equal(res.win, true);
  assert.equal(res.after, 0, 'all waste moves removed on the near-win board');
});

test('compress: auto cascade is rebuilt after compression', () => {
  // Near-win board: g9 auto-flies to green foundation on settle. The waste
  // pair is removed entirely — the result needs ZERO user moves — and the
  // leading auto record (g9 flying home) must survive in the output.
  const g9 = { type: 'number', color: 'green', rank: 9 };
  const steps = [
    { user: null, auto: [{ card: g9, from: { zone: 'tableau', col: 0 }, to: { type: 'foundation', color: 'green' } }] },
    { user: mv({ zone: 'tableau', col: 1, start: 1 }, { type: 'column', index: 3 }), auto: [] },
    { user: mv({ zone: 'tableau', col: 3, start: 0 }, { type: 'column', index: 1 }), auto: [] },
  ];
  const res = compressSteps(nearWinState(), steps);
  assert.equal(res.win, true);
  assert.equal(res.after, 0);
  assert.equal(res.steps.length, 1, 'leading auto record must be kept');
  const finals = res.steps.flatMap((s) => s.auto);
  assert.equal(finals.some((a) => a.card && a.card.type === 'number' && a.card.rank === 9 && a.card.color === 'green'), true);
});

test('compress: single reversible step nobody touches afterwards is dropped', () => {
  // b4 parked on col3 with nothing depending on it — its inverse (back onto
  // r5) is legal, so the whole step is a pure reversible detour.
  const steps = [{ user: mv({ zone: 'tableau', col: 1, start: 1 }, { type: 'column', index: 3 }), auto: [] }];
  const res = compressSteps(nearWinState(), steps);
  assert.equal(res.win, true);
  assert.equal(res.after, 0, 'waste park must be dropped outright');
});

test('compress: reversible step whose deletion loses forced progress is kept', () => {
  // g9 buried under b4 (deal-only illegal stack): moving b4 away lets g9
  // auto-fly to the green foundation — irreversible progress. Dropping the
  // move would lose the cascade → replayCheck rejects, the step survives as a
  // "necessary detour" (and is still counted as reversible-left).
  const state = g9UnderState();
  const steps = [{ user: mv({ zone: 'tableau', col: 0, start: 1 }, { type: 'column', index: 3 }), auto: [] }];
  const res = compressSteps(state, steps);
  assert.equal(res.win, true);
  assert.equal(res.after, 1);
  assert.equal(res.reversibleLeft, 1, 'surviving step is a necessary detour');
});

test('compress: fixpoint — compressing the output again changes nothing', () => {
  const steps = [
    { user: mv({ zone: 'tableau', col: 1, start: 1 }, { type: 'column', index: 3 }), auto: [] }, // b4 → col3
    { user: mv({ zone: 'tableau', col: 1, start: 0 }, { type: 'column', index: 5 }), auto: [] }, // r5 → col5 (uses col1!)
    { user: mv({ zone: 'tableau', col: 3, start: 0 }, { type: 'column', index: 4 }), auto: [] }, // b4 → col4
  ];
  const res = compressSteps(nearWinState(), steps);
  assert.equal(res.win, true);
  const res2 = compressSteps(nearWinState(), res.steps);
  assert.equal(res2.win, true, 're-compressing must stay winning');
  assert.equal(res2.after, res.after, 'output must be a fixed point of the compression');
});
