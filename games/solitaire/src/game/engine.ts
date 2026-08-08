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

/** One atomic step of an action unit — generated AND applied by the engine,
 *  consumed (animated) by the animation layer. The unit lifecycle is
 *  beginUnit → stepUnit* → endUnit: each step moves exactly one card (a
 *  dragon into the locked pile, or an auto-move into flower/foundation), so
 *  the consumer can apply → animate → next and the data never runs ahead of
 *  what's on screen. */
export interface UnitAction {
  id: string;
  to: DestDescriptor | { type: 'dragonpile'; index: number };
}

type Unit =
  | { kind: 'move' } // a user move: only auto-moves remain in the unit
  | { kind: 'dragon'; color: CardColor }; // 收龙: dragon steps, then auto-moves

export class SolitaireEngine {
  state: GameState;
  /** Wired by the composable; fired for every sound effect the engine emits. */
  onSound: (name: EngineSoundName) => void = () => {};
  /** Wired by the composable; fired once per real win (guarded by `_winAwarded`). */
  onWin: () => void = () => {};

  private _winAwarded = false; // prevent double-counting wins across undo/re-move
  /** The action unit currently being consumed (beginUnit…endUnit), or null. */
  private unit: Unit | null = null;

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
    // Close any unit left open by a cancelled consumption (newGame may be
    // called mid-flight while the executor awaits): the replaced board makes
    // the old unit's steps moot, and leaving it open would make the NEXT
    // beginUnit('move') reuse it without snapping a fresh undo snapshot —
    // that move would be impossible to undo. See useSolitaireGame.newGame /
    // consumeUnit's consumeCanceled branch.
    this.unit = null;
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

  /** Apply a user move. Validates, then performs the single user step (the
   *  caller owns the unit lifecycle: beginUnit before, stepUnit loop for the
   *  auto-move cascade, endUnit after). */
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

    // Commit the user step only — the auto-move cascade is generated and
    // applied one step at a time by the unit consumer (stepUnit), so the
    // data never runs ahead of the animation. The undo snapshot was taken by
    // beginUnit.
    this._take(loc);
    this._place(sourceCards, dest);
    this.onSound(soundFor(dest));
    return { ok: true };
  }

  /**
   * Begin an action unit. A unit is ONE undo step: the undo snapshot is
   * pushed here, and the whole unit (user step + cascade, or the entire
   * dragon collect) settles atomically — endUnit runs checkWin and the
   * caller persists. An aborted unit (beginUnit followed by a failed move)
   * must call abortUnit to pop the snapshot.
   */
  beginUnit(kind: 'move'): void;
  beginUnit(kind: 'dragon', color: CardColor): boolean;
  beginUnit(kind: 'move' | 'dragon', color?: CardColor): void | boolean {
    if (kind === 'move') {
      // A unit may already be open: the hint path snapshots the board BEFORE
      // applying the solver's leading auto-moves, then the user step's unit
      // continues it — one snapshot covers the whole hint action, so a
      // single undo reverts everything (auto-moves included). Reuse it.
      if (this.unit) return;
      this.unit = { kind: 'move' };
      snapshot(this.state);
      return;
    }
    const c = color!;
    if (!Rules.canCollectDragons(this.state, c)) return false;
    this.unit = { kind: 'dragon', color: c };
    snapshot(this.state);
    return true;
  }

  /** Cancel a unit before any step was applied — pops the undo snapshot. */
  abortUnit(): void {
    // No-op when no unit is open: the hint path may abort on failures that
    // never opened a unit (a cache-hit step that fails before any move), and
    // popping history here would silently eat a legitimate undo snapshot.
    if (!this.unit) return;
    this.unit = null;
    if (this.state.history.length > 0) this.state.history.pop();
  }

  /**
   * Generate AND apply the next atomic step of the current unit (dragon
   * steps first for a 收龙 unit, then the auto-move cascade), or null when
   * the unit is complete. The consumer animates each returned step (the
   * card now renders at its destination), then calls again — sequential
   * consume and apply, data and display in lockstep.
   */
  stepUnit(): UnitAction | null {
    if (!this.unit) return null;
    if (this.unit.kind === 'dragon') {
      const dragon = this.collectNextDragon(this.unit.color);
      if (dragon) return dragon;
      // All dragons collected — fall through to the auto-move cascade.
    }
    return this.applyNextAutoMove();
  }

  /** Finish the unit: reset state and award a win if the board just won. */
  endUnit(): void {
    this.unit = null;
    this.checkWin();
  }

  /** Collect all exposed dragons of `color` — begins a 收龙 unit (validates +
   *  snapshots). The actual dragon steps are consumed via stepUnit, one
   *  dragon per step, in engine order (columns 0→7, then free cells). */
  collectDragons(color: CardColor): boolean {
    return this.beginUnit('dragon', color) === true;
  }

  /** Run safe auto-moves to convergence — the no-animation path (boot /
   *  restore), which settles the whole cascade in one synchronous pass. The
   *  animated path consumes the same steps one at a time via stepUnit. */
  applyAutoMoves(): void {
    let guard = 0;
    while (guard++ < 1000 && this.applyNextAutoMove()) {
      // converges
    }
  }

  /** The next auto-move step of the cascade (flower first, then safe number
   *  runs in ascending rank order), applied — or null at convergence. */
  private applyNextAutoMove(): UnitAction | null {
    const m = Rules.nextAutoMove(this.state);
    if (!m) return null;
    const loc = Rules.findCard(this.state, m.cardId);
    if (!loc) return null;
    if (loc.zone === 'tableau') {
      const card = this.state.tableau[loc.col].pop()!;
      return this.routeAutoMove(card, m.to);
    }
    const card = this.state.freeCells[loc.idx] as Card;
    this.state.freeCells[loc.idx] = null;
    return this.routeAutoMove(card, m.to);
  }

  /** Pop the next exposed dragon of `color` (column 0→7, then free cells) and
   *  lock it into the same-colour dragon pile — one step of a 收龙 unit. */
  /**
   * Next dragon step of the current 收龙 unit: FREE-CELL dragons first,
   * then column-top dragons — NOT "columns first". Reason: the very first
   * collected dragon must always find a destination slot. A column-top
   * dragon collected first can land in a board with NO empty free cell
   * (the classic layout: 3 free cells each holding a same-colour dragon +
   * 1 column-top dragon — `canCollectDragons` allows it because a
   * same-colour free-cell dragon counts as a merge target). pushDragon
   * would then write to `freeCells[-1]`, a ghost index that never renders
   * (the dragon vanishes, no animation). Free-cell dragons vacate their
   * slot when collected, guaranteeing the fresh pile always has a home.
   */
  private collectNextDragon(color: CardColor): UnitAction | null {
    for (let i = 0; i < this.state.freeCells.length; i++) {
      const fc = this.state.freeCells[i];
      if (fc && fc.type !== 'dragonpile' && Rules.isDragon(fc) && fc.color === color) {
        this.state.freeCells[i] = null;
        return this.pushDragon(fc);
      }
    }
    for (const col of this.state.tableau) {
      const top = col[col.length - 1];
      if (top && Rules.isDragon(top) && top.color === color) {
        col.pop();
        return this.pushDragon(top);
      }
    }
    return null;
  }

  /** Lock a dragon into the same-colour pile, or into the first empty cell as
   *  a fresh pile. Mirrors the old bulk collect: the pile lands in a
   *  genuinely empty cell (a same-colour free-cell dragon was cleared into
   *  the pile above, vacating its slot). */
  private pushDragon(d: DragonCard): UnitAction {
    let idx = this.state.freeCells.findIndex(
      (c) => c !== null && c.type === 'dragonpile' && c.color === d.color,
    );
    if (idx === -1) idx = this.state.freeCells.findIndex((c) => c === null);
    // Defensive: canCollectDragons guarantees a destination exists (an empty
    // free cell, or a same-colour free-cell dragon that collectNextDragon
    // just vacated), so this is unreachable by construction. If that
    // invariant is ever broken, fail loudly instead of writing to a ghost
    // freeCells[-1] (the dragon would vanish without an animation — the bug
    // the free-cell-first order exists to prevent).
    if (idx === -1) {
      throw new Error(`[engine] collectDragons: no free cell for the ${d.color} dragon pile`);
    }
    const pile = this.state.freeCells[idx];
    if (pile && pile.type === 'dragonpile') {
      pile.cards.push(d);
    } else {
      this.state.freeCells[idx] = {
        type: 'dragonpile',
        locked: true,
        color: d.color,
        cards: [d],
      };
    }
    this.onSound('dragon');
    return { id: d.id, to: { type: 'dragonpile', index: idx } };
  }

  private routeAutoMove(card: Card, to: DestDescriptor): UnitAction {
    if (to.type === 'flower') {
      this.state.flowerSlot = card as FlowerCard;
      this.onSound('flower');
    } else if (to.type === 'foundation') {
      this.state.foundations[to.color].push(card as NumberCard);
      this.onSound('foundation');
    }
    // (nextAutoMove never emits column/freecell targets.)
    return { id: card.id, to };
  }

  /** Award the win once per real win (guarded by `_winAwarded`). */
  checkWin(): void {
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
