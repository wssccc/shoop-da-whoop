// Framework-agnostic game controller.
//
// Applies validated moves, drives auto-moves, undo & win flow. Instead of an
// event emitter it exposes two callbacks (`onSound`, `onWin`) that the Vue
// composable layer wires up — keeping this class pure logic with no DOM/Svelte/Vue coupling.
//
// Faithful 1:1 port of the original game.js `class Game` semantics.

import type { EngineSoundName } from './constants';
import * as Rules from './rules';
import { createInitialState, restoreSnapshot, snapshot } from './state';
import type {
    Card,
    CardColor,
    CardLocation,
    DestDescriptor,
    DragonCard,
    FlowerCard,
    GameState,
    MoveResult,
    NumberCard,
} from './types';

export class SolitaireEngine {
  state: GameState;
  /** Wired by the composable; fired for every sound effect the engine emits. */
  onSound: (name: EngineSoundName) => void = () => {};
  /** Wired by the composable; fired once per real win (guarded by `_winAwarded`). */
  onWin: () => void = () => {};

  private _winAwarded = false; // prevent double-counting wins across undo/re-move

  constructor() {
    this.state = createInitialState();
  }

  getState(): GameState {
    return this.state;
  }

  setState(state: GameState): void {
    this.state = state;
    this._winAwarded = Rules.isWin(state);
  }

  canUndo(): boolean {
    return this.state.history.length > 0;
  }

  locate(cardId: string): CardLocation | null {
    return Rules.findCard(this.state, cardId);
  }

  /** Replace the current board with a freshly dealt one and reset win-award. */
  newGame(): void {
    this.state = createInitialState();
    this._winAwarded = false;
  }

  /** Restore the previous board snapshot (one step back). Re-enables win award. */
  undo(): boolean {
    if (!restoreSnapshot(this.state)) return false;
    // Re-enable win-award eligibility: if the player undoes the move that
    // triggered a win, the game is no longer won and a future win should
    // count again (the previous award already incremented the counter).
    this._winAwarded = false;
    return true;
  }

  /** First colour whose dragons are ready to collect, or null. */
  dragonReady(): CardColor | null {
    return Rules.readyDragonColor(this.state);
  }

  /** Apply a user move. Validates, snapshots, performs, auto-moves. */
  move(run: Card[] | null, dest: DestDescriptor): MoveResult {
    if (!run || run.length === 0) return { ok: false, reason: 'empty' };
    const head = run[0];
    const loc = Rules.findCard(this.state, head.id);
    if (!loc) return { ok: false, reason: 'not-found' };

    // Resolve & validate the source run.
    let sourceCards: Card[];
    if (loc.zone === 'tableau') {
      const col = this.state.tableau[loc.col];
      const slice = col.slice(loc.idx);
      if (slice.length !== run.length || slice.some((c, i) => c.id !== run[i].id)) {
        return { ok: false, reason: 'run-mismatch' };
      }
      if (slice.length > 1 && !Rules.isValidRun(slice)) {
        return { ok: false, reason: 'invalid-run' };
      }
      sourceCards = slice;
    } else {
      // freecell — findCard only returns freecell locations for loose cards.
      if (run.length !== 1) return { ok: false, reason: 'freecell-multi' };
      sourceCards = [this.state.freeCells[loc.idx] as Card];
    }

    // Validate destination against current legal targets.
    const targets = Rules.validDropTargets(this.state, sourceCards);
    const matched = targets.some((t) => Rules.sameDest(t, dest));
    if (!matched) return { ok: false, reason: 'invalid-dest' };

    // Commit: snapshot once for the whole user-action unit (incl. its auto cascade).
    snapshot(this.state);
    this._take(loc);
    this._place(sourceCards, dest);
    this.onSound(soundFor(dest));
    this.applyAutoMoves();
    this.checkWin();
    return { ok: true };
  }

  /** Collect all exposed dragons of `color` into a single locked free cell. */
  collectDragons(color: CardColor): MoveResult {
    if (!Rules.canCollectDragons(this.state, color)) {
      return { ok: false, reason: 'not-ready' };
    }

    snapshot(this.state);
    const dragons: DragonCard[] = [];
    for (const col of this.state.tableau) {
      while (col.length) {
        const top = col[col.length - 1];
        if (!Rules.isDragon(top) || top.color !== color) break;
        dragons.push(top);
        col.pop();
      }
    }
    for (let i = 0; i < this.state.freeCells.length; i++) {
      const fc = this.state.freeCells[i];
      if (fc && fc.type !== 'dragonpile' && Rules.isDragon(fc) && fc.color === color) {
        dragons.push(fc);
        this.state.freeCells[i] = null;
      }
    }

    // The locked pile may only land in a genuinely empty cell. This also covers
    // the "merge" case: any same-colour dragon already sitting in a free cell
    // was cleared into `dragons` above, so its slot is now null and is found
    // here. We deliberately do NOT fall back to an occupied cell (even another
    // dragon's) — that would clobber a different-colour card.
    const dest = this.state.freeCells.findIndex((c) => c === null);
    if (dest === -1) {
      restoreSnapshot(this.state);
      return { ok: false, reason: 'no-cell' };
    }

    this.state.freeCells[dest] = {
      type: 'dragonpile',
      locked: true,
      color,
      cards: dragons,
    };
    this.onSound('dragon');
    this.applyAutoMoves();
    this.checkWin();
    return { ok: true };
  }

  /** Run safe auto-moves to convergence (flower + safe foundation sends). */
  applyAutoMoves(): void {
    let guard = 0;
    while (guard++ < 1000) {
      const m = Rules.nextAutoMove(this.state);
      if (!m) break;
      const loc = Rules.findCard(this.state, m.cardId);
      if (!loc) break;
      if (loc.zone === 'tableau') {
        const card = this.state.tableau[loc.col].pop()!;
        this.routeAutoMove(card, m.to);
      } else {
        const card = this.state.freeCells[loc.idx] as Card;
        this.state.freeCells[loc.idx] = null;
        this.routeAutoMove(card, m.to);
      }
    }
  }

  private routeAutoMove(card: Card, to: DestDescriptor): void {
    if (to.type === 'flower') {
      this.state.flowerSlot = card as FlowerCard;
      this.onSound('flower');
    } else if (to.type === 'foundation') {
      this.state.foundations[to.color].push(card as NumberCard);
      this.onSound('foundation');
    }
    // (nextAutoMove never emits column/freecell targets.)
  }

  private checkWin(): void {
    if (Rules.isWin(this.state) && !this._winAwarded) {
      this._winAwarded = true;
      this.onWin();
      this.onSound('win');
    }
  }

  private _take(loc: CardLocation): void {
    if (loc.zone === 'tableau') this.state.tableau[loc.col].splice(loc.idx);
    else this.state.freeCells[loc.idx] = null;
  }

  private _place(sourceCards: Card[], dest: DestDescriptor): void {
    if (dest.type === 'column') {
      this.state.tableau[dest.index].push(...sourceCards);
    } else if (dest.type === 'freecell') {
      this.state.freeCells[dest.index] = sourceCards[0];
    } else if (dest.type === 'foundation') {
      this.state.foundations[dest.color].push(sourceCards[0] as NumberCard);
    } else {
      // flower
      this.state.flowerSlot = sourceCards[0] as FlowerCard;
    }
  }
}

function soundFor(dest: DestDescriptor): EngineSoundName {
  if (dest.type === 'foundation') return 'foundation';
  if (dest.type === 'flower') return 'flower';
  if (dest.type === 'freecell') return 'move';
  return 'place';
}
