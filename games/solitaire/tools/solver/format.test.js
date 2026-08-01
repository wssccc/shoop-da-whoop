// Tests for key-step (irreversible move) analysis. Run with:  node --test
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { keyStepIndices } from './format.js';
import * as Rules from './rules.js';

function nearWinState() {
  const nums = (color, ranks) => ranks.map((rank) => ({ type: 'number', color, rank }));
  return {
    tableau: [
      [nums('green', [9])[0]], // col0: g9 (auto-finishes)
      [nums('red', [5])[0], nums('black', [4])[0]], // col1: [r5, b4] top b4
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

test('key steps: settled moves and auto foundation sends are marked', () => {
  const steps = [
    { user: mv({ zone: 'tableau', col: 1, start: 1 }, { type: 'column', index: 3 }), auto: [] }, // b4 → col3 (settled)
    { user: mv({ zone: 'tableau', col: 1, start: 0 }, { type: 'column', index: 4 }), auto: [] }, // r5 → col4 (settled)
  ];
  // g9 auto-flies on the leading settle (before any user step) — steps carry
  // no leading-auto record here, so flat = [b4-move, r5-move].
  const key = keyStepIndices(nearWinState(), steps, { commit: Rules });
  assert.deepEqual([...key].sort((a, b) => a - b), [0, 1]);
});

test('key steps: a card moved again later does NOT mark its earlier move', () => {
  const steps = [
    { user: mv({ zone: 'tableau', col: 1, start: 1 }, { type: 'column', index: 3 }), auto: [] }, // b4 → col3 (re-moved later)
    { user: mv({ zone: 'tableau', col: 3, start: 0 }, { type: 'column', index: 4 }), auto: [] }, // b4 → col4 (settled)
    { user: mv({ zone: 'tableau', col: 1, start: 0 }, { type: 'column', index: 5 }), auto: [] }, // r5 → col5 (settled)
  ];
  const key = keyStepIndices(nearWinState(), steps, { commit: Rules });
  assert.deepEqual([...key].sort((a, b) => a - b), [1, 2]);
});

test('key steps: auto moves (foundation/flower) are always marked', () => {
  const steps = [
    {
      user: mv({ zone: 'tableau', col: 1, start: 1 }, { type: 'column', index: 3 }),
      auto: [{ card: { type: 'number', color: 'green', rank: 9 }, from: { zone: 'tableau', col: 0 }, to: { type: 'foundation', color: 'green' } }],
    },
  ];
  const key = keyStepIndices(nearWinState(), steps, { commit: Rules });
  assert.equal(key.has(1), true, 'auto foundation send must be key');
});
