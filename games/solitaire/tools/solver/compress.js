// Post-processing: compress a raw solver solution before it is printed.
//
// A beam-DFS "any solution" search produces legal but wandering paths — cards
// parked in a free cell then immediately fetched, runs shuttled column-to-
// column and back, etc. This module rewrites the step list, state-consciously:
//
//   1. Cycle removal: replay the user steps, track the canonical key of every
//      post-step state; when a step lands on a state seen before, the whole
//      middle segment is a detour that returns to an earlier position — drop
//      it and rescan. (Loops cancel out exactly because the endpoint state is
//      identical.)
//
//   2. Detour compaction (three channels, restart-to-fixpoint):
//      a. "park then fetch": a parks a run at D, b later fetches the same run
//         off D — rewrite a to go straight to b's destination, drop b;
//      b. "inverse pair": b carries the run BACK to a's original location —
//         the pair is a pure move-out-and-move-back no-op — drop both
//         (guarded by location + exact run-content matching);
//      c. "single reversible step": a's inverse operation is legal and nobody
//         touches its parking spot afterwards — drop a outright.
//
//   Reversibility is the theory from the solver spec (games/solitaire/docs/
//   solver.md appendix): a step is reversible iff
//   its inverse move is legal in the post-step converged state (isReversibleStep
//   in rules.js). Dropping reversible detours yields a locally-optimal
//   "critical" solution — the fixpoint property is asserted at the end.
//
//   Every rewrite is accepted ONLY if a full replay of the candidate sequence
//   stays legal and still wins — the legality check (validDropTargets +
//   isWin) makes the rewrite provably safe even when static reasoning misses
//   an interaction.
//
//   3. Auto-move rebuild: the forced auto-move cascade (flower → slot, safe
//      numbers → foundations) is recomputed for every user step of the
//      compressed path, so the printed "自动" lines always match reality.

import {
    canCollectDragons,
    cloneState,
    commitUserMove,
    isReversibleStep,
    isWin,
    runAutoMoves,
    sameDest,
    stateKey,
    validDropTargets,
} from './rules.js';

/** Replay user steps (with the forced auto cascade) and check the whole path
 *  is legal and ends in a win. Used to accept/reject candidate compressions. */
function replayCheck(initial, leadingAuto, userSteps) {
  const state = cloneState(initial);
  runAutoMoves(state); // leading auto-moves
  for (const u of userSteps) {
    if (u.kind === 'collect') {
      if (!canCollectDragons(state, u.color)) return false;
    } else {
      let run;
      if (u.from.zone === 'tableau') {
        const col = state.tableau[u.from.col];
        if (u.from.start >= col.length) return false;
        run = col.slice(u.from.start);
      } else {
        const fc = state.freeCells[u.from.idx];
        if (!fc || fc.type === 'dragonpile') return false;
        run = [fc];
      }
      if (run.length === 0 || !run[0]) return false;
      const src = u.from.zone === 'tableau' ? { zone: 'tableau', col: u.from.col } : { zone: 'freecell', idx: u.from.idx };
      const targets = validDropTargets(state, run, src);
      if (!targets.some((t) => sameDest(t, u.to))) return false;
    }
    commitUserMove(state, u);
    runAutoMoves(state);
  }
  return isWin(state);
}

/** Does any step in [lo, hi] touch location `loc` (free cell or column)? */
function touches(steps, lo, hi, loc) {
  for (let k = lo; k <= hi; k++) {
    const u = steps[k];
    if (!u) continue;
    if (u.kind === 'collect') {
      // A collect occupies a free cell (locked dragon pile) → counts as touch.
      if (loc.type === 'freecell') return true;
      continue;
    }
    if (u.from.zone === 'freecell' && loc.type === 'freecell' && u.from.idx === loc.index) return true;
    if (u.to.type === 'freecell' && loc.type === 'freecell' && u.to.index === loc.index) return true;
    if (u.from.zone === 'tableau' && loc.type === 'column' && u.from.col === loc.index) return true;
    if (u.to.type === 'column' && loc.type === 'column' && u.to.index === loc.index) return true;
  }
  return false;
}

function sameLocation(to, from) {
  if (to.type === 'column' && from.zone === 'tableau') return from.col === to.index;
  if (to.type === 'freecell' && from.zone === 'freecell') return from.idx === to.index;
  return false;
}

/** Phase 1: drop segments that return to an already-seen state. */
function removeCycles(initial, leadingAuto, userSteps) {
  let changed = true;
  while (changed) {
    changed = false;
    const state = cloneState(initial);
    runAutoMoves(state);
    const seen = new Map([[stateKey(state), 0]]);
    const out = [];
    for (const u of userSteps) {
      commitUserMove(state, u);
      runAutoMoves(state);
      const k = stateKey(state);
      const prev = seen.get(k);
      if (prev !== undefined) {
        // Reached a state we were in after `prev` steps — the segment
        // [prev..current] is a detour. Drop it and CONTINUE with the remaining
        // steps (their coordinates are relative to this same state).
        out.length = prev;
        changed = true;
        for (const [key, val] of seen) if (val > prev) seen.delete(key);
      } else {
        seen.set(k, out.length + 1);
        out.push(u);
      }
    }
    userSteps = out;
  }
  return userSteps;
}

/** Replay user steps and trace, for each step, the converged post-state (a
 *  clone) and the card-code string of the run it moved. Used to check
 *  reversibility (Case 3) and exact run-content equality (Case 2). */
function replayWithTraces(initial, leadingAuto, userSteps) {
  const state = cloneState(initial);
  runAutoMoves(state);
  const states = [];
  const runs = [];
  for (const u of userSteps) {
    let run = [];
    if (u.kind !== 'collect') {
      run =
        u.from.zone === 'tableau'
          ? state.tableau[u.from.col].slice(u.from.start)
          : state.freeCells[u.from.idx]
            ? [state.freeCells[u.from.idx]]
            : [];
    }
    runs.push(run.map((c) => (c ? c.color[0] + c.rank : '?')).join(','));
    commitUserMove(state, u);
    runAutoMoves(state);
    states.push(cloneState(state));
  }
  return { states, runs };
}

/**
 * Phase 2: collapse detours into direct moves — "park then fetch" rewrites,
 * inverse-pair removal and single-step reversible removal — iterating to a
 * fixpoint (every successful rewrite restarts the scan). All candidates are
 * validated by replayCheck before being accepted.
 */
function compactDetours(initial, leadingAuto, userSteps) {
  let changed = true;
  while (changed) {
    changed = false;
    const { states, runs } = replayWithTraces(initial, leadingAuto, userSteps);
    outer: for (let i = 0; i < userSteps.length; i++) {
      const a = userSteps[i];
      if (!a || a.kind !== 'move') continue;
      const D = a.to; // where a parked the run

      for (let j = i + 1; j < userSteps.length; j++) {
        const b = userSteps[j];
        if (!b || b.kind !== 'move') continue;

        // --- Case 1: b fetches the same run off D and carries it elsewhere.
        // Rewrite a to go straight to b's destination, drop b.
        if (sameLocation(D, b.from)) {
          if (touches(userSteps, i + 1, j - 1, D)) continue;
          const candidate = userSteps.slice();
          candidate[i] = { ...a, to: b.to };
          candidate.splice(j, 1);
          if (replayCheck(initial, leadingAuto, candidate)) {
            userSteps = candidate;
            changed = true;
            break outer;
          }
        }

        // --- Case 2: b carries the run BACK to a's original location — the
        // pair is a pure "move out and move back" no-op. Drop both. Require
        // the exact same run content (not just the same locations) — the
        // intermediate steps must not have touched D or the origin either.
        if (sameLocation(b.to, a.from)) {
          if (runs[i] !== runs[j]) continue;
          if (touches(userSteps, i + 1, j - 1, D)) continue;
          if (touches(userSteps, i + 1, j - 1, fromLocation(a.from))) continue;
          const candidate = userSteps.slice();
          candidate.splice(j, 1);
          candidate.splice(i, 1);
          if (replayCheck(initial, leadingAuto, candidate)) {
            userSteps = candidate;
            changed = true;
            break outer;
          }
        }
      }

      // --- Case 3: a single reversible step nobody touches afterwards — the
      // run sits at D until the end, so dropping a restores the pre-step
      // layout and nothing else ever depended on it.
      if (touches(userSteps, i + 1, userSteps.length - 1, D)) continue;
      if (states[i] && isReversibleStep(states[i], a)) {
        const candidate = userSteps.slice();
        candidate.splice(i, 1);
        if (replayCheck(initial, leadingAuto, candidate)) {
          userSteps = candidate;
          changed = true;
          break outer;
        }
      }
    }
  }
  return userSteps;
}

function fromLocation(from) {
  return from.zone === 'tableau'
    ? { type: 'column', index: from.col }
    : { type: 'freecell', index: from.idx };
}

/**
 * Compress a solver `steps` list (user + auto records). Returns
 * { steps, win, before, after, reversibleLeft } — `steps` rebuilt with fresh
 * auto cascades, and `win:false` (with `steps` = raw input) if the fixpoint
 * self-check fails so the caller can fall back to the raw solution.
 */
export function compressSteps(initial, steps) {
  const before = steps.filter((s) => s.user).length;
  const leadingAuto = steps[0] && steps[0].user === null ? steps[0].auto : [];
  let userSteps = steps.filter((s) => s.user !== null).map((s) => s.user);

  // Alternate cycle removal and detour compaction until NEITHER changes —
  // each pass can unlock removals for the other.
  for (;;) {
    const afterCycles = removeCycles(initial, leadingAuto, userSteps);
    const afterDetours = compactDetours(initial, leadingAuto, afterCycles);
    if (afterDetours.length === userSteps.length) {
      userSteps = afterDetours;
      break;
    }
    userSteps = afterDetours;
  }

  // Fixpoint self-check (defensive): the output must be a fixed point of BOTH
  // passes. If the loop above was buggy and left something removable, treat
  // the compression as failed rather than printing a non-critical solution.
  const checkCycles = removeCycles(initial, leadingAuto, userSteps);
  const checkDetours = compactDetours(initial, leadingAuto, checkCycles);
  if (checkDetours.length !== userSteps.length) {
    return { steps, win: false, before, after: userSteps.length, reversibleLeft: -1, reason: 'fixpoint' };
  }

  // Rebuild auto cascades from the compressed user path.
  const out = [];
  if (leadingAuto.length) out.push({ user: null, auto: leadingAuto });
  const state = cloneState(initial);
  runAutoMoves(state);
  for (const u of userSteps) {
    commitUserMove(state, u);
    const auto = runAutoMoves(state);
    out.push({ user: u, auto });
  }

  return {
    steps: out,
    win: isWin(state),
    before,
    after: userSteps.length,
    reversibleLeft: countReversibleSteps(initial, out),
  };
}

/** Replay the (already compressed) step list and count user steps whose
 *  inverse is still legal in their post-step converged state — i.e. the
 *  "necessary detours" that compression could not remove. */
export function countReversibleSteps(initial, steps) {
  const state = cloneState(initial);
  runAutoMoves(state); // leading auto (user === null records)
  let n = 0;
  for (const s of steps) {
    if (!s.user) continue;
    commitUserMove(state, s.user);
    runAutoMoves(state);
    if (isReversibleStep(state, s.user)) n++;
  }
  return n;
}
