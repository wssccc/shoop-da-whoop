// Board renderer. Rebuilds card elements from the game state into the static
// slot containers defined in index.html.


const COLOR_ORDER = ['red', 'black', 'green'];

function cornerRank(rank, pos) {
  const wrap = document.createElement('span');
  wrap.className = `corner ${pos}`;
  const num = document.createElement('span');
  num.className = 'rank-num';
  num.textContent = String(rank);
  wrap.appendChild(num);
  return wrap;
}

function cornerGlyph(text, pos) {
  const wrap = document.createElement('span');
  wrap.className = `corner ${pos}`;
  const g = document.createElement('span');
  g.className = 'glyph-small';
  g.textContent = text;
  wrap.appendChild(g);
  return wrap;
}

function buildCard(card, opts = {}) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;
  if (card.type === 'number') {
    el.classList.add('num', 'c-' + card.color);
    el.appendChild(cornerRank(card.rank, 'tl'));
    el.appendChild(cornerRank(card.rank, 'br'));
  } else if (card.type === 'dragon') {
    el.classList.add('dragon', 'c-' + card.color);
    const dragonGlyph = { red: '中', black: '萬', green: '發' }[card.color] ?? '龍';
    el.appendChild(cornerGlyph(dragonGlyph, 'tl'));
    el.appendChild(cornerGlyph(dragonGlyph, 'br'));
  } else if (card.type === 'flower') {
    el.classList.add('flower');
    el.appendChild(cornerGlyph('✿', 'tl'));
    el.appendChild(cornerGlyph('✿', 'br'));
  }
  if (opts.noDrag) el.classList.add('no-drag');
  return el;
}

function buildLockedDragons(color) {
  const el = document.createElement('div');
  el.className = 'locked-dragons';
  if (color) el.classList.add('c-' + color);
  el.innerHTML = '<span class="glyph">🐉</span><span class="lock">🔒</span>';
  return el;
}

function setEmpty(slot, isEmpty) {
  slot.classList.toggle('empty', isEmpty);
}

function fillSlot(slot, content, isEmpty) {
  slot.innerHTML = '';
  if (content) slot.appendChild(content);
  setEmpty(slot, isEmpty);
}

export { buildCard };

export const Render = {
  board(state) {
    // Tableau columns.
    for (let i = 0; i < state.tableau.length; i++) {
      const col = document.getElementById('col-' + i);
      col.innerHTML = '';
      setEmpty(col, state.tableau[i].length === 0);
      for (const card of state.tableau[i]) col.appendChild(buildCard(card));
    }

    // Free cells (may hold a single card or a locked dragon pile).
    for (let i = 0; i < state.freeCells.length; i++) {
      const slot = document.getElementById('fc-' + i);
      slot.classList.remove('locked', 'c-red', 'c-black', 'c-green');
      const fc = state.freeCells[i];
      if (!fc) fillSlot(slot, null, true);
      else if (fc.locked) { slot.classList.add('locked', 'c-' + fc.color); fillSlot(slot, buildLockedDragons(fc.color), false); }
      else fillSlot(slot, buildCard(fc), false);
    }

    // Flower slot.
    const fs = document.getElementById('flower-slot');
    if (state.flowerSlot) fillSlot(fs, buildCard(state.flowerSlot, { noDrag: true }), false);
    else fillSlot(fs, null, true);

    // Foundations (render the top card + a count badge).
    for (const color of COLOR_ORDER) {
      const slot = document.getElementById('found-' + color);
      const arr = state.foundations[color];
      slot.innerHTML = '';
      if (arr.length) {
        slot.appendChild(buildCard(arr[arr.length - 1], { noDrag: true }));
        const b = document.createElement('span');
        b.className = 'count';
        b.textContent = String(arr.length);
        slot.appendChild(b);
        setEmpty(slot, false);
      } else {
        setEmpty(slot, true);
      }
    }
  },
};
