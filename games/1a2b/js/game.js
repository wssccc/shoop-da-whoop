// Game controller: owns the live state, applies input/submit, and emits events
// ('change', 'sound', 'win', 'newgame') for the UI to react to. Mirrors
// solitaire's Game class (on/emit, single source of truth, no DOM here).

import { DIGITS, MAX_GUESSES } from './constants.js';
import * as Rules from './rules.js';
import { createInitialState } from './state.js';

export class Game {
  constructor() {
    this.state = createInitialState();
    this.listeners = { change: [], sound: [], win: [], newgame: [] };
    this._winAwarded = false; // guard against double-counting
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

  /** Start over with a fresh secret. */
  newGame() {
    this.state = createInitialState();
    this._winAwarded = false;
    this.emit('newgame');
    this.emit('change');
    this.sound('newgame');
  }

  /** Restore a previously-saved state (does not award a win). */
  restore(state) {
    if (!state) return false;
    this.state = state;
    this._winAwarded = state.won; // already-completed games should not re-award
    this.emit('change');
    return true;
  }

  // ---- input editing before submit ----

  /** Append a digit char to the in-progress input (refuses if locked). */
  inputDigit(d) {
    if (this.state.won || this.state.lost) return false;
    if (this.state.input.length >= DIGITS) return false;
    // No repeats within a single guess (matches the secret invariant).
    if (this.state.input.includes(d)) {
      this.sound('error');
      return false;
    }
    this.state.input += d;
    this.emit('change');
    return true;
  }

  /** Remove the last entered digit. */
  backspace() {
    if (this.state.won || this.state.lost) return false;
    if (this.state.input.length === 0) return false;
    this.state.input = this.state.input.slice(0, -1);
    this.emit('change');
    return true;
  }

  /** Clear the whole in-progress guess. */
  clearInput() {
    if (this.state.won || this.state.lost) return false;
    if (this.state.input.length === 0) return false;
    this.state.input = '';
    this.emit('change');
    return true;
  }

  /**
   * Submit the current input as a guess. Validates, scores, records, clears the
   * input buffer and — on 4A0B — emits 'win'. Returns a result descriptor.
   */
  submitGuess() {
    if (this.state.won) return { ok: false, reason: 'already-won' };
    if (this.state.lost) return { ok: false, reason: 'lost' };
    if (this.state.guesses.length >= MAX_GUESSES) return { ok: false, reason: 'max-guesses' };

    const input = this.state.input;
    const v = Rules.validateGuess(input);
    if (!v.ok) {
      this.sound('error');
      return { ok: false, reason: v.reason };
    }

    const { a, b } = Rules.computeAB(input, this.state.secret);
    const entry = { guess: input, a, b };
    this.state.guesses.push(entry);
    this.state.input = '';
    this.emit('change');
    this.sound('submit');

    if (Rules.isWin({ a, b }) && !this._winAwarded) {
      this._winAwarded = true;
      this.state.won = true;
      this.sound('win');
      this.emit('win', { guesses: this.state.guesses.length, entry });
      this.emit('change');
    } else if (this.state.guesses.length >= MAX_GUESSES) {
      // Out of shots — reveal the secret and end the game as a loss.
      this.state.lost = true;
      this.sound('lose');
      this.emit('lose', { secret: this.state.secret, guesses: this.state.guesses.length, entry });
      this.emit('change');
    }

    return { ok: true, a, b, entry };
  }
}
