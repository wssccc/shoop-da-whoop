// Pure game rules + immutable-style actions for the Solitaire solver.
//
// Faithful 1:1 port of games/solitaire/src/game/{rules.ts, engine.ts, types.ts},
// expressed as plain ES modules with no DOM / Vue coupling. The solver works
// POSITIONALLY (moves carry an explicit source location) so we never need to
// look cards up by id — simpler and faster than the runtime engine which keys
// off card ids for drag/drop.
//
// State shape (mirror of `Board`):
//   {
//     tableau:    Card[][],           // 8 cols; col[last] = stack top (grabbable)
//     freeCells:  (Card | DragonPile | null)[],   // length 3
//     foundations: { red: Card[], black: Card[], green: Card[] },
//     flowerSlot:  Card | null,
//   }
// Card shapes:
//   { type:'number', color, rank }
//   { type:'dragon', color }
//   { type:'flower' }
//   DragonPile: { type:'dragonpile', locked:true, color, cards:DragonCard[] }

export const COLORS = ['red', 'black', 'green'];

export const COLOR_CN = { red: '红', black: '黑', green: '绿' };
// Dragon glyph by colour (rules.md: 红=中, 黑=萬, 绿=發).
export const DRAGON_CN = { red: '中', black: '萬', green: '發' };

export const TABLEAU_COLS = 8;
export const FREE_CELL_COUNT = 3;
export const RANK_MAX = 9;

export function isNumber(c) {
  return !!c && c.type === 'number';
}
export function isDragon(c) {
  return !!c && c.type === 'dragon';
}
export function isFlower(c) {
  return !!c && c.type === 'flower';
}

/** Can `moving` be stacked onto `target`? (target one rank higher, different colour) */
export function canStack(moving, target) {
  if (!isNumber(target) || !isNumber(moving)) return false;
  return target.rank === moving.rank + 1 && target.color !== moving.color;
}

export function isValidRun(cards) {
  if (!cards.every(isNumber)) return false;
  for (let i = 0; i < cards.length - 1; i++) {
    if (!canStack(cards[i + 1], cards[i])) return false;
  }
  return true;
}

export function freeEmptyCount(state) {
  return state.freeCells.filter((c) => c === null).length;
}

export function emptyColumnCount(state, exclude = -1) {
  let n = 0;
  for (let i = 0; i < state.tableau.length; i++) {
    if (i === exclude) continue;
    if (state.tableau[i].length === 0) n++;
  }
  return n;
}

/** Dragons still in play (tableau + loose free-cell dragons, excluding locked piles). */
export function dragonsOnBoard(state) {
  let n = 0;
  for (const col of state.tableau) for (const c of col) if (isDragon(c)) n++;
  for (const fc of state.freeCells) {
    if (fc && fc.type !== 'dragonpile' && isDragon(fc)) n++;
  }
  return n;
}

/** Dragons currently exposed (column tops or loose in free cells). */
export function exposedDragonCount(state) {
  let n = 0;
  for (const col of state.tableau) {
    if (col.length && isDragon(col[col.length - 1])) n++;
  }
  for (const fc of state.freeCells) {
    if (fc && fc.type !== 'dragonpile' && isDragon(fc)) n++;
  }
  return n;
}

export function isWin(state) {
  return (
    COLORS.every((c) => state.foundations[c].length === RANK_MAX) &&
    state.flowerSlot !== null &&
    dragonsOnBoard(state) === 0
  );
}

/** All four dragons of `color` are exposed (each a column top or in a free cell)? */
export function allDragonsOfColorExposed(state, color) {
  let total = 0;
  let exposed = 0;
  for (const col of state.tableau) {
    for (let i = 0; i < col.length; i++) {
      const card = col[i];
      if (isDragon(card) && card.color === color) {
        total++;
        if (i === col.length - 1) exposed++;
      }
    }
  }
  for (const fc of state.freeCells) {
    if (fc && fc.type !== 'dragonpile' && isDragon(fc) && fc.color === color) {
      total++;
      exposed++;
    }
  }
  return total > 0 && exposed === total;
}

/**
 * Collect-able when all four colour-mates are exposed AND there is a slot:
 * an empty free cell, or a free cell holding a same-colour dragon (merged in,
 * vacating the slot). A different-colour dragon in a cell must NOT count.
 */
export function canCollectDragons(state, color) {
  if (!allDragonsOfColorExposed(state, color)) return false;
  return state.freeCells.some(
    (c) => c === null || (c && c.type !== 'dragonpile' && isDragon(c) && c.color === color),
  );
}

export function readyDragonColors(state) {
  return COLORS.filter((c) => canCollectDragons(state, c));
}

/** "Safe" auto-move: this number card is the next rank AND every other colour
 *  has already placed rank-1, so it can never be needed as a tableau landing. */
export function isSafeNumber(state, card) {
  if (!isNumber(card)) return false;
  if (state.foundations[card.color].length !== card.rank - 1) return false;
  for (const c of COLORS) {
    if (c === card.color) continue;
    if (state.foundations[c].length < card.rank - 1) return false;
  }
  return true;
}

/**
 * All legal drop targets for the given run. `src` is the explicit source
 * location so we can skip moving a run back onto its own column.
 *   run[0] = carried head (highest rank of a number run; or the only card).
 *   src    = { zone:'tableau', col } | { zone:'freecell', idx } | null
 */
export function validDropTargets(state, run, src) {
  const targets = [];
  if (!run || run.length === 0) return targets;
  const head = run[0];
  const len = run.length;

  for (let i = 0; i < state.tableau.length; i++) {
    if (src && src.zone === 'tableau' && src.col === i) continue;
    const col = state.tableau[i];
    if (col.length === 0) {
      targets.push({ type: 'column', index: i });
    } else {
      const top = col[col.length - 1];
      if (isDragon(top)) continue; // nothing stacks onto a dragon
      if (canStack(head, top)) targets.push({ type: 'column', index: i });
    }
  }

  if (len === 1) {
    for (let i = 0; i < state.freeCells.length; i++) {
      if (state.freeCells[i] !== null) continue;
      if (src && src.zone === 'freecell' && src.idx === i) continue;
      targets.push({ type: 'freecell', index: i });
    }
  }

  if (len === 1 && isNumber(head)) {
    if (state.foundations[head.color].length === head.rank - 1) {
      targets.push({ type: 'foundation', color: head.color });
    }
  }

  if (len === 1 && isFlower(head) && state.flowerSlot === null) {
    targets.push({ type: 'flower' });
  }

  return targets;
}

// ---------------------------------------------------------------------------
// State mutation helpers (operate on a single mutable state; callers clone).
// ---------------------------------------------------------------------------

export function cloneState(state) {
  return {
    tableau: state.tableau.map((col) => col.map((c) => ({ ...c }))),
    freeCells: state.freeCells.map((c) => {
      if (!c) return null;
      if (c.type === 'dragonpile') {
        return { type: 'dragonpile', locked: true, color: c.color, cards: c.cards.map((x) => ({ ...x })) };
      }
      return { ...c };
    }),
    foundations: Object.fromEntries(COLORS.map((c) => [c, state.foundations[c].map((x) => ({ ...x }))])),
    flowerSlot: state.flowerSlot ? { ...state.flowerSlot } : null,
  };
}

/**
 * Apply ONE user move (move or collect). Assumes legality (use validDropTargets
 * for generation). Mutates `state`.
 */
export function commitUserMove(state, move) {
  if (move.kind === 'collect') {
    commitCollect(state, move.color);
    return;
  }
  // kind === 'move'
  let cards;
  const from = move.from;
  if (from.zone === 'tableau') {
    cards = state.tableau[from.col].splice(from.start);
  } else {
    // freecell — count is always 1
    cards = [state.freeCells[from.idx]];
    state.freeCells[from.idx] = null;
  }
  const to = move.to;
  if (to.type === 'column') {
    state.tableau[to.index].push(...cards);
  } else if (to.type === 'freecell') {
    state.freeCells[to.index] = cards[0];
  } else if (to.type === 'foundation') {
    state.foundations[to.color].push(cards[0]);
  } else {
    // flower
    state.flowerSlot = cards[0];
  }
}

/** Collect all dragons of `color` into a locked pile in an empty free cell. */
export function commitCollect(state, color) {
  const dragons = [];
  for (const col of state.tableau) {
    while (col.length) {
      const top = col[col.length - 1];
      if (!isDragon(top) || top.color !== color) break;
      dragons.push(col.pop());
    }
  }
  for (let i = 0; i < state.freeCells.length; i++) {
    const fc = state.freeCells[i];
    if (fc && fc.type !== 'dragonpile' && isDragon(fc) && fc.color === color) {
      dragons.push(fc);
      state.freeCells[i] = null;
    }
  }
  const dest = state.freeCells.findIndex((c) => c === null);
  // Mirrors engine.ts: a free cell with a same-colour dragon was cleared above
  // so an empty slot always exists when canCollectDragons was true.
  state.freeCells[dest] = { type: 'dragonpile', locked: true, color, cards: dragons };
}

/**
 * Run safe auto-moves (flower → slot, safe numbers → foundation) to fixpoint.
 * Returns the list of auto steps applied, each { card, from, to }.
 * Mutates `state`.
 */
export function runAutoMoves(state) {
  const auto = [];
  let guard = 0;
  while (guard++ < 1000) {
    const m = nextAutoMove(state);
    if (!m) break;
    if (m.from.zone === 'tableau') state.tableau[m.from.col].pop();
    else state.freeCells[m.from.idx] = null;
    if (m.to.type === 'flower') state.flowerSlot = m.card;
    else if (m.to.type === 'foundation') state.foundations[m.to.color].push(m.card);
    auto.push(m);
  }
  return auto;
}

/** Next auto-move (flower first; then lowest safe rank), mirroring rules.ts. */
export function nextAutoMove(state) {
  if (state.flowerSlot === null) {
    for (let c = 0; c < state.tableau.length; c++) {
      const col = state.tableau[c];
      const top = col[col.length - 1];
      if (top && isFlower(top)) return { card: top, from: { zone: 'tableau', col: c }, to: { type: 'flower' } };
    }
    for (let i = 0; i < state.freeCells.length; i++) {
      const fc = state.freeCells[i];
      if (fc && fc.type !== 'dragonpile' && isFlower(fc)) {
        return { card: fc, from: { zone: 'freecell', idx: i }, to: { type: 'flower' } };
      }
    }
  }

  const exposed = [];
  for (let c = 0; c < state.tableau.length; c++) {
    const col = state.tableau[c];
    const top = col[col.length - 1];
    if (top && isNumber(top)) exposed.push({ card: top, from: { zone: 'tableau', col: c } });
  }
  for (let i = 0; i < state.freeCells.length; i++) {
    const fc = state.freeCells[i];
    if (fc && fc.type !== 'dragonpile' && isNumber(fc)) exposed.push({ card: fc, from: { zone: 'freecell', idx: i } });
  }
  const safe = exposed.filter((e) => isSafeNumber(state, e.card)).sort((a, b) => a.card.rank - b.card.rank);
  if (safe.length === 0) return null;
  const e = safe[0];
  return { card: e.card, from: e.from, to: { type: 'foundation', color: e.card.color } };
}

// ---------------------------------------------------------------------------
// Move generation.
// ---------------------------------------------------------------------------

/**
 * Index in `col` where the longest top valid number-run begins.
 * If the top card alone (dragon/flower, or a number with no valid run above),
 * returns col.length - 1.
 */
export function topRunStart(col) {
  const n = col.length;
  let i = n - 1;
  while (i - 1 >= 0 && isNumber(col[i]) && isNumber(col[i - 1]) && canStack(col[i], col[i - 1])) {
    i--;
  }
  return i;
}

/**
 * Is this user step "reversible" — i.e. is its inverse operation (moving the
 * same run back to its source location) legal in the given state?
 *
 * `state` MUST be the converged state AFTER the step's move + auto cascade
 * (the search-graph node semantics). The inverse is checked LIVE against the
 * actual board — the initial deal may contain illegal stacks (e.g. a dragon
 * sat on a number card), so "it used to sit there" is never a valid argument.
 *
 * Rules:
 *   - collect / foundation / flower targets: never reversible (forced progress)
 *   - source is a free cell: inverse "put it back into the (now empty) cell"
 *     is always legal → reversible
 *   - source is a column: inverse = move the run back onto that column —
 *     legal iff the column is now empty, or its top card accepts the run head
 *     (canStack). The auto cascade may have removed the card under the run, so
 *     the check always uses whatever is on top of the column NOW.
 *   - dragons: only reversible into an empty column (nothing stacks on a
 *     dragon, and a dragon stacks on nothing) or an empty source column.
 *
 * NOTE: the auto cascade need NOT be empty for reversibility — cascade records
 * ride along with the user step and get dropped/rebuild with it; the
 * compressor's replayCheck decides whether a deletion is actually safe.
 */
export function isReversibleStep(state, step) {
  if (step.kind === 'collect') return false;
  const { from, to } = step;
  if (to.type === 'foundation' || to.type === 'flower') return false;
  if (from.zone === 'freecell') {
    // Inverse = put the card back into the free cell it came from — that cell
    // is empty now (nothing ever gets *placed into* a free cell by a cascade).
    return true;
  }
  // from.zone === 'tableau' — inverse = move the run back onto the source
  // column. Legal iff the column is empty, or its top accepts the run head.
  const col = state.tableau[from.col];
  if (col.length === 0) return true;
  const top = col[col.length - 1];
  let run;
  if (to.type === 'column') {
    // The moved run sits at the TOP of the destination column; `count` is the
    // number of cards the original step carried (NOT the whole top run — the
    // destination may hold cards under it that were never moved).
    const dest = state.tableau[to.index];
    const count = step.count ?? 1;
    run = dest.slice(Math.max(0, dest.length - count));
  } else {
    // freecell — single card
    run = state.freeCells[to.index] ? [state.freeCells[to.index]] : [];
  }
  const head = run[0];
  return !!head && canStack(head, top);
}

function destIsSafeFoundation(state, head, to) {
  return to.type === 'foundation' && isSafeNumber(state, head);
}

/**
 * Generate all candidate USER moves, ordered best-first by a heuristic score
 * (lower = tried first). Safe auto-moves (flower→slot, safe→foundation) are
 * omitted because runAutoMoves() fires them after every user action anyway —
 * generating them would only duplicate post-state and waste branching.
 *
 * Move objects:
 *   { kind:'move',    from, to, count, head, isWhole, isSingleton, score }
 *   { kind:'collect', color }
 */
export function genUserMoves(state) {
  const moves = [];
  const last = (col) => col[col.length - 1];

  for (let c = 0; c < state.tableau.length; c++) {
    const col = state.tableau[c];
    if (col.length === 0) continue;
    const i = topRunStart(col);
    const n = col.length;
    for (let start = i; start <= n - 1; start++) {
      const run = col.slice(start);
      const head = run[0];
      if (isFlower(head)) continue; // auto-handled

      const src = { zone: 'tableau', col: c, start };
      const isWhole = start === i;
      const isSingleton = run.length === 1;
      const targets = validDropTargets(state, run, src);

      for (const to of targets) {
        if (to.type === 'flower') continue;
        // Skip safe-foundation as a user move — auto will send it.
        if (destIsSafeFoundation(state, head, to)) continue;
        // Skip parking a safe number in a freecell (auto sends it to foundation
        // → same post-state, pure redundant branching).
        if (to.type === 'freecell' && isNumber(head) && isSafeNumber(state, head)) continue;
        // Prune "whole column → empty column": pure relabel of column names,
        // never structurally useful (any solution using it relabels to one
        // that doesn't).
        if (
          to.type === 'column' &&
          state.tableau[to.index].length === 0 &&
          src.zone === 'tableau' &&
          src.start === 0
        ) {
          continue;
        }

        moves.push({
          kind: 'move',
          from: src,
          to,
          count: run.length,
          head,
          isWhole,
          isSingleton,
          score: scoreMove(state, run, src, to, isWhole, isSingleton),
        });
      }
    }
  }

  // Loose free-cell cards.
  for (let i = 0; i < state.freeCells.length; i++) {
    const fc = state.freeCells[i];
    if (!fc || fc.type === 'dragonpile') continue;
    if (isFlower(fc)) continue;
    const head = fc;
    const src = { zone: 'freecell', idx: i };
    const targets = validDropTargets(state, [head], src);
    for (const to of targets) {
      if (to.type === 'flower') continue;
      if (to.type === 'freecell') continue; // relabelling — pure churn
      if (destIsSafeFoundation(state, head, to)) continue; // auto handles safe
      moves.push({
        kind: 'move',
        from: src,
        to,
        count: 1,
        head,
        isWhole: true,
        isSingleton: true,
        score: scoreMove(state, [head], src, to, true, true),
      });
    }
  }

  // Collect dragons (one move per ready colour).
  for (const color of readyDragonColors(state)) {
    moves.push({ kind: 'collect', color, score: 0 });
  }

  moves.sort((a, b) => a.score - b.score);
  return moves;
}

function scoreMove(state, run, src, to, isWhole, isSingleton) {
  // collect handled separately (score 0).
  if (to.type === 'foundation') return 1; // commit a number — high-value, but may be premature

  if (to.type === 'freecell') {
    // parking a card away from a column to unblock is sometimes needed,
    // but rank it low so the search prefers constructive moves first.
    return 7;
  }

  // to.type === 'column'
  const destCol = state.tableau[to.index];
  if (destCol.length === 0) {
    // moving onto an empty column: valuable when it EMPTIES the source column
    // elsewhere (start>0) — i.e. it unblocks buried cards. A pure relocate
    // (moving the whole column) is usually wasteful.
    if (src.zone === 'tableau' && src.start > 0) return 2;
    return 6;
  }

  // Stacking onto an existing card. Always reduces disorder a bit.
  // Slightly prefer moving whole runs (compresses the board faster).
  return isWhole && !isSingleton ? 2 : 3;
}

// ---------------------------------------------------------------------------
// Canonical state key (same-colour dragons treated as interchangeable — they
// are identical in terms of every future legal move and the win condition).
// ---------------------------------------------------------------------------

function cardCode(c) {
  if (!c) return '.';
  if (c.type === 'number') return c.color[0] + c.rank;
  if (c.type === 'dragon') return 'D' + c.color[0];
  return 'H'; // flower
}

function cellCode(fc) {
  if (!fc) return '.';
  if (fc.type === 'dragonpile') return 'P' + fc.color[0];
  return cardCode(fc);
}

export function stateKey(state) {
  const cols = state.tableau.map((col) => col.map(cardCode).join(',')).join('|');
  const fc = state.freeCells.map(cellCode).join(',');
  const fd = COLORS.map((c) => c[0] + state.foundations[c].length).join(',');
  const fl = state.flowerSlot ? 'H' : '.';
  return cols + '#' + fc + '#' + fd + '#' + fl;
}

export function sameDest(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'column' || a.type === 'freecell') return a.index === b.index;
  if (a.type === 'foundation') return a.color === b.color;
  return true; // flower
}
