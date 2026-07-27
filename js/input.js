// Pointer-based drag controller. Generates floating "ghost" cards that follow
// the pointer, hit-tests slot targets via elementFromPoint, and commits to
// game.move() on release (or reverts with an error sound).

import { FLIP_EASE, FLIP_MS } from './anim.js';
import { Audio } from './audio.js';
import * as Rules from './rules.js';

function parseSlot(str) {
  if (!str) return null;
  if (str.startsWith('col-')) return { type: 'column', index: Number(str.slice(4)) };
  if (str.startsWith('fc-')) return { type: 'freecell', index: Number(str.slice(3)) };
  if (str.startsWith('found-')) return { type: 'foundation', color: str.slice(6) };
  if (str === 'flower') return { type: 'flower' };
  return null;
}

export class DragController {
  constructor(board, game) {
    this.board = board;
    this.game = game;
    this.drag = null;
    this._onMove = this.onMove.bind(this);
    this._onUp = this.onUp.bind(this);
    board.addEventListener('pointerdown', e => this.onDown(e));
  }

  cardEl(id) {
    return this.board.querySelector(`.card[data-id="${id}"]`);
  }

  onDown(e) {
    const cardEl = e.target.closest('.card');
    if (!cardEl || cardEl.classList.contains('no-drag')) return;

    Audio.resume();
    const id = cardEl.dataset.id;
    const state = this.game.getState();
    const loc = Rules.findCard(state, id);
    if (!loc) return;

    let run;
    if (loc.zone === 'tableau') run = Rules.grabRunFromTableau(state, id);
    else if (loc.zone === 'freecell') {
      const fc = state.freeCells[loc.idx];
      run = fc ? [fc] : null;
    }
    if (!run) { Audio.error(); shake(cardEl); return; }

    const origs = run.map(c => this.cardEl(c.id)).filter(Boolean);
    if (origs.length !== run.length) return;

    const rects = origs.map(el => el.getBoundingClientRect());
    origs.forEach(el => el.classList.add('is-dragging'));

    const ghosts = origs.map((el, i) => {
      const g = el.cloneNode(true);
      g.classList.add('ghost');
      g.classList.remove('is-dragging');
      const r = rects[i];
      g.style.left = r.left + 'px';
      g.style.top = r.top + 'px';
      g.style.zIndex = String(1000 + i);
      document.body.appendChild(g);
      return g;
    });

    this.drag = {
      e0: { x: e.clientX, y: e.clientY },
      run, ghosts, rects, origs,
      targets: Rules.validDropTargets(state, run),
      hover: null,
    };

    e.preventDefault();
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', this._onUp);
  }

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.e0.x;
    const dy = e.clientY - d.e0.y;
    d.dx = dx;
    d.dy = dy;
    for (const g of d.ghosts) g.style.transform = `translate(${dx}px, ${dy}px)`;
    this.highlight(e.clientX, e.clientY);
  }

  highlight(x, y) {
    const d = this.drag;
    clearHighlights();
    d.hover = null;
    const el = document.elementFromPoint(x, y);
    if (!el) return;
    const slot = el.closest('[data-slot]');
    if (!slot) return;
    const desc = parseSlot(slot.dataset.slot);
    if (!desc) return;
    if (d.targets.some(t => Rules.sameDest(t, desc))) {
      slot.classList.add('drop-ok');
      d.hover = desc;
    }
  }

  onUp() {
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
    window.removeEventListener('pointercancel', this._onUp);

    const d = this.drag;
    this.drag = null;
    if (!d) return;

    clearHighlights();

    // Park each carried card at its drop point by copying the ghost's translate
    // onto the (still hidden) real element, then reveal it. getBoundingClientRect
    // counts this transform, so the FLIP render below reads the release point as
    // the card's "first" position and eases it into the target slot rather than
    // snapping. (visibility:hidden keeps layout, so no reflow here.)
    const dx = d.dx ?? 0;
    const dy = d.dy ?? 0;
    for (const el of d.origs) {
      el.style.transition = 'none';
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      el.classList.remove('is-dragging');
    }
    d.ghosts.forEach(g => g.remove());

    let committed = false;
    if (d.hover) {
      const res = this.game.move(d.run, d.hover);
      committed = !!res.ok;
      if (!committed) Audio.error();
    }
    if (committed) return; // game.move -> 'change' -> renderAll -> FLIP carries cards home.

    // Canceled / invalid drop: ease each card from the drop point back to base.
    const origs = d.origs;
    requestAnimationFrame(() => {
      for (const el of origs) {
        el.style.transition = `transform ${FLIP_MS}ms ${FLIP_EASE}`;
        el.style.transform = '';
      }
    });
    setTimeout(() => {
      for (const el of origs) {
        el.style.transition = '';
        el.style.transform = '';
      }
    }, FLIP_MS + 60);
  }
}

function clearHighlights() {
  document.querySelectorAll('.drop-ok').forEach(el => el.classList.remove('drop-ok'));
}

function shake(el) {
  el.classList.add('shake');
  setTimeout(() => el.classList.remove('shake'), 320);
}
