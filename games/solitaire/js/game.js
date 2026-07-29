// Game controller: applies validated moves, drives auto-moves, undo & win flow,
// and emits events ('change', 'sound', 'win') for the UI to react to.

import { COLORS } from './constants.js';
import * as Rules from './rules.js';
import {
    createInitialState,
    restoreSnapshot,
    snapshot,
} from './state.js';

export class Game {
  constructor() {
    this.state = createInitialState();
    this.listeners = { change: [], sound: [], win: [], autoMove: [], dealing: [] };
    this._winAwarded = false;  // prevent double-counting wins across undo/re-move
  }

  on(event, cb) {
    (this.listeners[event] ||= []).push(cb);
    return this;
  }

  emit(event, payload) {
    for (const cb of this.listeners[event]) cb(payload);
  }

  sound(name) { this.emit('sound', name); }

  getState() { return this.state; }

  canUndo() { return this.state.history.length > 0; }

  locate(cardId) { return Rules.findCard(this.state, cardId); }

  newGame() {
    this.state = createInitialState();
    this._winAwarded = false;
    this.emit('dealing');
  }

  undo() {
    if (!restoreSnapshot(this.state)) return false;
    // Re-enable win-award eligibility: if the player undoes the move that
    // triggered a win, the game is no longer won and a future win should
    // count again (the previous award already incremented the counter).
    this._winAwarded = false;
    this.emit('change');
    return true;
  }

  dragonReady() { return Rules.readyDragonColor(this.state); }

  // Apply a user move. `run` is the carried card objects (head = run[0]);
  // `dest` is a drop descriptor. Validates, snap­shots, performs, auto-moves.
  move(run, dest) {
    if (!run || run.length === 0) return { ok: false, reason: 'empty' };
    const head = run[0];
    const loc = Rules.findCard(this.state, head.id);
    if (!loc) return { ok: false, reason: 'not-found' };

    // Resolve & validate the source run.
    let sourceCards;
    if (loc.zone === 'tableau') {
      const col = this.state.tableau[loc.col];
      const slice = col.slice(loc.idx);
      if (slice.length !== run.length || slice.some((c, i) => c.id !== run[i].id)) {
        return { ok: false, reason: 'run-mismatch' };
      }
      if (slice.length > 1 && !Rules.isValidRun(slice)) return { ok: false, reason: 'invalid-run' };
      sourceCards = slice;
    } else if (loc.zone === 'freecell') {
      if (run.length !== 1) return { ok: false, reason: 'freecell-multi' };
      sourceCards = [this.state.freeCells[loc.idx]];
    } else {
      return { ok: false, reason: 'bad-source' };
    }

    // Validate destination against current legal targets.
    const targets = Rules.validDropTargets(this.state, sourceCards);
    const matched = targets.some(t => Rules.sameDest(t, dest));
    if (!matched) return { ok: false, reason: 'invalid-dest' };

    // Commit: snapshot once for the whole user-action unit (incl. its auto cascade).
    snapshot(this.state);
    this._take(sourceCards, loc);
    this._place(sourceCards, dest);
    this.sound(soundFor(dest));
    this.applyAutoMoves();
    this.emit('change');
    if (Rules.isWin(this.state) && !this._winAwarded) {
      this._winAwarded = true;
      this.emit('win'); this.sound('win');
    }
    return { ok: true };
  }

  // Collect all exposed dragons of `color` into a single locked free cell.
  collectDragons(color) {
    if (!Rules.canCollectDragons(this.state, color)) return { ok: false, reason: 'not-ready' };

    snapshot(this.state);
    const dragons = [];
    for (const col of this.state.tableau) {
      while (col.length && Rules.isDragon(col[col.length - 1]) && col[col.length - 1].color === color) {
        dragons.push(col.pop());
      }
    }
    for (let i = 0; i < this.state.freeCells.length; i++) {
      const fc = this.state.freeCells[i];
      if (fc && !fc.locked && Rules.isDragon(fc) && fc.color === color) {
        dragons.push(fc);
        this.state.freeCells[i] = null;
      }
    }

    // The locked pile may only land in a genuinely empty cell. This also covers
    // the "merge" case: any same-colour dragon already sitting in a free cell
    // was cleared into `dragons` above, so its slot is now null and is found
    // here. We deliberately do NOT fall back to an occupied cell (even another
    // dragon's) — that would clobber a different-colour card.
    let dest = this.state.freeCells.findIndex(c => c === null);
    if (dest === -1) { restoreSnapshot(this.state); return { ok: false, reason: 'no-cell' }; }

    this.state.freeCells[dest] = { locked: true, type: 'dragonpile', cards: dragons, color };
    this.sound('dragon');
    this.applyAutoMoves();
    this.emit('change');
    if (Rules.isWin(this.state) && !this._winAwarded) {
      this._winAwarded = true;
      this.emit('win'); this.sound('win');
    }
    return { ok: true };
  }

  // Run safe auto-moves to convergence (flower + safe foundation sends).
  applyAutoMoves() {
    let guard = 0;
    while (guard++ < 1000) {
      const m = Rules.nextAutoMove(this.state);
      if (!m) break;
      const loc = Rules.findCard(this.state, m.cardId);
      if (!loc) break;
      let card;
      if (loc.zone === 'tableau') {
        card = this.state.tableau[loc.col].pop();
      } else {
        card = this.state.freeCells[loc.idx];
        this.state.freeCells[loc.idx] = null;
      }
      if (m.to.type === 'flower') {
        this.state.flowerSlot = card;
        this.sound('flower');
      } else if (m.to.type === 'foundation') {
        this.state.foundations[m.to.color].push(card);
        this.sound('foundation');
      }
      this.emit('autoMove', { cardId: m.cardId, to: m.to });
    }
  }

  _take(sourceCards, loc) {
    if (loc.zone === 'tableau') this.state.tableau[loc.col].splice(loc.idx);
    else this.state.freeCells[loc.idx] = null;
  }

  _place(sourceCards, dest) {
    const head = sourceCards[0];
    if (dest.type === 'column') this.state.tableau[dest.index].push(...sourceCards);
    else if (dest.type === 'freecell') this.state.freeCells[dest.index] = head;
    else if (dest.type === 'foundation') this.state.foundations[dest.color].push(head);
    else if (dest.type === 'flower') this.state.flowerSlot = head;
  }
}

function soundFor(dest) {
  if (dest.type === 'foundation') return 'foundation';
  if (dest.type === 'flower') return 'flower';
  if (dest.type === 'freecell') return 'move';
  return 'place';
}

export { COLORS };
