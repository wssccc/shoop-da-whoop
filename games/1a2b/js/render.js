// DOM rendering — pure output, no state mutation. Mirrors solitaire's render.js
// convention (a `Render` namespace object rebuilding its sections from state).

import { DIGITS } from './constants.js';

// ---- builders (return detached elements) ----

/** One history row: the 4-digit guess + its A/B badges. */
export function buildRow(entry, opts = {}) {
  const row = document.createElement('div');
  row.className = 'history-row';
  if (opts.win) row.classList.add('win');

  const num = document.createElement('span');
  num.className = 'history-num';
  num.textContent = entry.guess;
  row.appendChild(num);

  const badges = document.createElement('span');
  badges.className = 'ab-badges';

  const badgeA = document.createElement('span');
  badgeA.className = 'badge-ab badge-a' + (entry.a === 0 ? ' zero' : '');
  badgeA.textContent = entry.a + 'A';

  const badgeB = document.createElement('span');
  badgeB.className = 'badge-ab badge-b' + (entry.b === 0 ? ' zero' : '');
  badgeB.textContent = entry.b + 'B';

  badges.appendChild(badgeA);
  badges.appendChild(badgeB);
  row.appendChild(badges);
  return row;
}

export const Render = {
  /** The 4 input slots: filled digits + the pulsing cursor on the next slot. */
  input(state) {
    const host = document.getElementById('input-display');
    host.textContent = '';
    const filled = state.input.length;
    for (let i = 0; i < DIGITS; i++) {
      const slot = document.createElement('div');
      if (i < filled) {
        slot.className = 'slot';
        slot.textContent = state.input[i];
      } else {
        slot.className = 'slot empty';
        if (i === filled && !state.won) slot.classList.add('cursor');
      }
      host.appendChild(slot);
    }
  },

  /** Full rebuild of the guess history (newest appended at the bottom). */
  history(state) {
    const host = document.getElementById('history');
    host.textContent = '';

    // Strictly recreate the placeholder each render: assigning textContent=''
    // above detaches the previous #history-empty node, so getElementById would
    // return null on a later 0-guess render and break appendChild.
    if (state.guesses.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.id = 'history-empty';
      empty.textContent = '输入 4 位不重复数字，猜中即 4A0B';
      host.appendChild(empty);
      return;
    }
    state.guesses.forEach((g, i) => {
      host.appendChild(buildRow(g, { win: i === state.guesses.length - 1 && state.won }));
    });

    // Auto-scroll to the newest entry.
    host.scrollTop = host.scrollHeight;
  },

  /** The compact stats strip in the toolbar (games / best / average). */
  stats(stats) {
    const host = document.getElementById('stats');
    host.textContent = '';
    const avg = stats.games > 0 ? (stats.total / stats.games).toFixed(1) : '—';
    const fields = [
      { label: '局数', value: stats.games },
      { label: '最佳', value: stats.best == null ? '—' : stats.best },
      { label: '平均', value: avg },
    ];
    for (const f of fields) {
      const stat = document.createElement('div');
      stat.className = 'stat';
      stat.innerHTML = `<b>${f.value}</b><span>${f.label}</span>`;
      host.appendChild(stat);
    }
  },
};
