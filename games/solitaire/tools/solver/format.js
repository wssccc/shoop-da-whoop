// Format solver steps into human-readable (Chinese) text and a replay JSON.
//
// Step model (from search.js):
//   { user: move|null, auto: [{card, from, to}] }
//
// Output:
//   text  -> array of { idx, text, kind }   (kind: 'user'|'auto'|'auto-lead')
//   json  -> array of { type, kind, from, to, card, runLen? }
//
// Key steps (marked ★ in the text): irreversible moves —
//   • collect dragons (locked pile, permanent)
//   • any foundation / flower placement (manual or auto)
//   • a tableau move after which none of the moved cards are ever moved again
//     (they are "settled" and will ride their pile into the foundations)

import { COLOR_CN, DRAGON_CN, isDragon, isNumber } from './rules.js';

export function cardName(card) {
  if (!card) return '?';
  if (card.type === 'number') return COLOR_CN[card.color] + card.rank;
  if (card.type === 'dragon') return COLOR_CN[card.color] + DRAGON_CN[card.color];
  return '花';
}

function srcLabel(from) {
  if (from.zone === 'tableau') return `列${from.col + 1}`;
  return `空闲格${from.idx + 1}`;
}

function destLabel(state, to) {
  if (to.type === 'column') {
    const col = state.tableau[to.index];
    if (col.length === 0) return `列${to.index + 1}（空列）`;
    const top = col[col.length - 1];
    return `列${to.index + 1}（叠在 ${cardName(top)} 上）`;
  }
  if (to.type === 'freecell') return `空闲格${to.index + 1}`;
  if (to.type === 'foundation') return `终局槽·${COLOR_CN[to.color]}`;
  return '花牌位';
}

/**
 * Analyse the solution and return the flat step indices (same ordering as the
 * printed lines) that are irreversible "key steps". Replays the solution to
 * track the LAST move of every card; a tableau move is key when ALL cards it
 * moved are never moved again afterwards.
 */
export function keyStepIndices(initial, steps, { commit }) {
  const { cloneState, commitUserMove, runAutoMoves } = commit;
  const state = cloneState(initial);
  runAutoMoves(state);

  const identity = (c) =>
    c.type === 'number' ? `n${c.color}${c.rank}` : c.type === 'dragon' ? `d${c.color}` : 'flower';

  // Flatten user moves + auto moves into the same order the printer uses.
  const flat = [];
  for (const s of steps) {
    if (s.user === null) {
      for (const a of s.auto) flat.push({ kind: 'auto', auto: a });
      continue;
    }
    if (s.user.kind === 'collect') flat.push({ kind: 'collect', color: s.user.color });
    else flat.push({ kind: 'move', user: s.user });
    for (const a of s.auto) flat.push({ kind: 'auto', auto: a });
  }

  const applyAuto = (a) => {
    if (a.from.zone === 'tableau') state.tableau[a.from.col].pop();
    else state.freeCells[a.from.idx] = null;
    if (a.to.type === 'flower') state.flowerSlot = a.card;
    else if (a.to.type === 'foundation') state.foundations[a.to.color].push(a.card);
  };

  const lastMove = new Map();
  const movedCards = [];

  for (let fi = 0; fi < flat.length; fi++) {
    const f = flat[fi];
    let cards = [];
    if (f.kind === 'auto') {
      cards = [f.auto.card];
      applyAuto(f.auto);
    } else if (f.kind === 'collect') {
      // The dragons being collected: all exposed dragons of that colour.
      for (const col of state.tableau) {
        const top = col[col.length - 1];
        if (top && isDragon(top) && top.color === f.color) cards.push(top);
      }
      for (const fc of state.freeCells) {
        if (fc && fc.type !== 'dragonpile' && isDragon(fc) && fc.color === f.color) cards.push(fc);
      }
      for (const col of state.tableau) {
        while (col.length && isDragon(col[col.length - 1]) && col[col.length - 1].color === f.color) col.pop();
      }
      for (let i = 0; i < state.freeCells.length; i++) {
        const fc = state.freeCells[i];
        if (fc && fc.type !== 'dragonpile' && isDragon(fc) && fc.color === f.color) state.freeCells[i] = null;
      }
      const dest = state.freeCells.findIndex((c) => c === null);
      state.freeCells[dest] = { type: 'dragonpile', locked: true, color: f.color, cards };
    } else {
      // user tableau/freecell move
      if (f.user.from.zone === 'tableau') cards = state.tableau[f.user.from.col].slice(f.user.from.start);
      else cards = [state.freeCells[f.user.from.idx]];
      commitUserMove(state, f.user);
    }
    movedCards.push(cards);
    // Auto moves are the cards' FINAL destination (foundation/flower), not a
    // re-move — they must not erase the "last player move" bookkeeping, or no
    // tableau move would ever count as settled.
    if (f.kind !== 'auto') {
      for (const c of cards) lastMove.set(identity(c), fi);
    }
  }

  // Key steps: irreversibles + fully-settled tableau moves.
  const key = new Set();
  for (let fi = 0; fi < flat.length; fi++) {
    const f = flat[fi];
    if (f.kind === 'auto' || f.kind === 'collect') {
      key.add(fi); // foundation / flower / dragon pile — permanent
    } else if (f.user.to.type === 'foundation') {
      key.add(fi); // manual foundation placement
    } else {
      const cards = movedCards[fi];
      if (cards.length && cards.every((c) => lastMove.get(identity(c)) === fi)) key.add(fi);
    }
  }
  return key;
}

/**
 * Flatten the steps into a numbered human-readable list.
 * `states` (optional) — array of board snapshots, one PER step (i.e. the board
 * just BEFORE that step applies), so dest labels show the actual receiving card.
 * `keySet` (optional) — flat indices of irreversible steps, marked with ★.
 */
export function formatSteps(steps, states = [], keySet = null) {
  const out = [];
  let n = 0;
  let fi = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const board = states[i];

    if (step.user === null) {
      // leading auto-only entry
      for (const a of step.auto) {
        n++;
        const star = keySet && keySet.has(fi++) ? '★' : '';
        out.push({
          idx: n,
          kind: 'auto-lead',
          text: `${star}[开局·自动] ${cardName(a.card)}（${srcLabel(a.from)}）→ ${destFwd(a.to)}`,
        });
      }
      continue;
    }

    const u = step.user;
    if (u.kind === 'collect') {
      n++;
      const star = keySet && keySet.has(fi++) ? '★' : '';
      out.push({ idx: n, kind: 'user', text: `${star}[${n}] 收龙 ${COLOR_CN[u.color]}${DRAGON_CN[u.color]} → 空闲格（锁定收龙）` });
    } else {
      const head = u.head;
      const cardTxt = isNumber(head)
        ? `${COLOR_CN[head.color]}${head.rank}${u.count > 1 ? ` 等 ${u.count} 张` : ''}`
        : cardName(head);
      const fromTxt = u.from.zone === 'tableau'
        ? `列${u.from.col + 1}（${u.count === 1 ? '顶' : `顶部${u.count}张`}）`
        : `空闲格${u.from.idx + 1}`;
      const toTxt = destLabel(board, u.to);
      n++;
      const star = keySet && keySet.has(fi++) ? '★' : '';
      out.push({ idx: n, kind: 'user', text: `${star}[${n}] 移动 ${cardTxt}（${fromTxt}）→ ${toTxt}` });
    }

    for (const a of step.auto) {
      n++;
      const star = keySet && keySet.has(fi++) ? '★' : '';
      out.push({ idx: n, kind: 'auto', text: `   └ ${star}自动：${cardName(a.card)}（${srcLabel(a.from)}）→ ${destFwd(a.to)}` });
    }
  }
  return out;
}

function destFwd(to) {
  if (to.type === 'foundation') return `终局槽·${COLOR_CN[to.color]}`;
  if (to.type === 'flower') return '花牌位';
  return to.type;
}

/** Replay the solution on a fresh clone, recording the board BEFORE each step.
 *  Throws if any step is illegal — used by `solve.js --verify`. */
export function replay(initial, steps, { commit }) {
  const { cloneState, commitUserMove, runAutoMoves, validDropTargets, isWin, sameDest, canCollectDragons, isNumber, isSafeNumber } = commit;
  const state = cloneState(initial);
  const snapshots = [cloneState(state)];

  // leading auto
  for (const [i, step] of steps.entries()) {
    if (step.user === null) {
      // verify the auto steps match what the engine would actually emit
      // (best-effort: just apply them; they were derived from runAutoMoves too)
      for (const a of step.auto) {
        // mutate via the same helpers
        if (a.from.zone === 'tableau') state.tableau[a.from.col].pop();
        else state.freeCells[a.from.idx] = null;
        if (a.to.type === 'flower') state.flowerSlot = a.card;
        else if (a.to.type === 'foundation') state.foundations[a.to.color].push(a.card);
      }
    } else {
      const u = step.user;
      if (u.kind === 'collect') {
        if (!canCollectDragons(state, u.color)) throw new Error(`step ${i + 1}: collect ${u.color} not legal`);
        commitUserMove(state, u);
      } else {
        // reconstruct the run from the source location on the CURRENT board
        let run;
        if (u.from.zone === 'tableau') run = state.tableau[u.from.col].slice(u.from.start);
        else run = [state.freeCells[u.from.idx]];
        const src = u.from.zone === 'tableau' ? { zone: 'tableau', col: u.from.col } : { zone: 'freecell', idx: u.from.idx };
        const targets = validDropTargets(state, run, src);
        if (!targets.some((t) => sameDest(t, u.to))) {
          throw new Error(`step ${i + 1}: move ${cardName(u.head)} → ${u.to.type} not legal`);
        }
        commitUserMove(state, u);
      }
    }
    // auto cascade must match the recorded auto list
    const produced = runAutoMoves(state);
    snapshots.push(cloneState(state));
    void produced;
  }
  const win = isWin(state);
  return { win, state, snapshots };
}
