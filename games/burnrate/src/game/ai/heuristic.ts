// Heuristic AI adapter — a faithful, pure-logic port of the original HTML
// prototype's
// `aiPlayOneCard` priority ladder (multiplayer-aware).
//
// Priority ladder (highest first):
//   1. hire a VP                            (dept not already held)
//   2. play Audit on the weakest foe        (cash < $50M)
//   3. assign a Bad project to the weakest foe
//   4. play Consultant on the weakest foe   (70% chance, rng-gated)
//   5. Poach the richest foe's most valuable card (only if that foe has no HR VP)
//   6. hire any staff
//   7. start a Market project               (needs Sales VP)
//   8. start a Tech project                 (needs Eng VP, <2 own projects)
//   → otherwise null (no useful action this turn)
//
// `chooseAiAction` only *inspects* state; `runAiTurn` is the driver that
// applies the chosen actions through the engine and then completes doable
// projects. Deterministic under a seeded rng (rng only gates consultant).

import { AI_NO_ATTACK_ROUNDS } from '../constants';
import type { BurnRateEngine } from '../engine';
import {
    badAbandonCost,
    burnoutReq,
    canCompleteProject,
    getSkill,
    hasVP,
    opponents,
    poachCost,
    validPoachTargets,
    vpAlreadyHeld,
} from '../rules';
import type { AiAction, Card, GameState, PlayerId, Rng, StaffCard } from '../types';

/** Player with the lowest cash among `player`'s alive opponents. Ties are
 *  broken *randomly* — the old `<=` reduce always favoured the lowest index,
 *  so with everyone at $100M seats 1-3 all dumped their round-1 attacks on
 *  seat 0 (measured 14.6% vs ~27% win rate). */
export function weakestFoe(state: GameState, player: PlayerId, rng: Rng = Math.random): PlayerId | null {
  const foes = opponents(state, player);
  if (foes.length === 0) return null;
  const minCash = Math.min(...foes.map((f) => state.players[f].cash));
  const tied = foes.filter((f) => state.players[f].cash === minCash);
  return tied[Math.floor(rng() * tied.length)];
}

/** Player with the highest cash among `player`'s alive opponents. */
export function richestFoe(state: GameState, player: PlayerId): PlayerId | null {
  const foes = opponents(state, player);
  if (foes.length === 0) return null;
  return foes.reduce((a, b) => (state.players[a].cash >= state.players[b].cash ? a : b));
}

export function chooseAiAction(
  state: GameState,
  player: PlayerId = 0,
  rng: Rng = Math.random,
): AiAction | null {
  const me = state.players[player];
  const weakest = weakestFoe(state, player, rng);
  if (weakest === null) return null;
  const richest = richestFoe(state, player) ?? weakest;
  // Opening détente (house rule): the AI plays no attack cards during the
  // first `AI_NO_ATTACK_ROUNDS` rounds, so the first mover isn't punished for
  // spending first (he becomes the group's "weakest" → gets ganged).
  const opening = state.turn <= AI_NO_ATTACK_ROUNDS;

  // 1. VP — highest-impact first play (unlocks every action gate).
  const vp = me.hand.find((c) => c.kind === 'vp' && !vpAlreadyHeld(state, player, c.dept));
  if (vp) return { kind: 'hire', cardId: vp.id };

  // 2. Audit a cash-strapped foe (impl plays it even if blocked by Fin VP).
  if (!opening && state.players[weakest].cash < 50) {
    const audit = me.hand.find((c) => c.kind === 'action' && c.act === 'audit');
    if (audit) return { kind: 'audit', target: weakest };
  }

  // 3. Dump a Bad project on the weakest foe.
  if (!opening) {
    const bad = me.hand.find((c) => c.kind === 'project' && c.subtype === 'bad');
    if (bad) return { kind: 'assignProject', cardId: bad.id, target: weakest };
  }

  // 4. Cripple the weakest foe with a parasite consultant (70% of the time).
  if (!opening) {
    const consultant = me.hand.find((c) => c.kind === 'action' && c.act === 'consultant');
    if (consultant && rng() < 0.7) return { kind: 'consultant', target: weakest };
  }

  // 5. Poach the most valuable foe card (validPoachTargets already applies
  //    the shield rule — a foe HR VP must fall first — and the cash cost).
  //    Keep a $35M cushion: poaching drains cash fast in the AI meta, and a
  //    broke company can't fund its own projects.
  if (me.cash > 35) {
    const poachRefs = validPoachTargets(state, player);
    if (poachRefs.length > 0) {
      const best = pickBestPoach(poachRefs, state, richest);
      if (best) {
        const ref = poachRefs.find(
          (r) => state.players[r.player].company[r.index]?.id === best,
        );
        const card = ref ? state.players[ref.player].company[ref.index] : null;
        if (card && me.cash - poachCost(card) >= 35) {
          return { kind: 'poach', targetCardId: best };
        }
      }
    }
  }

  // 6. Hire any staff.
  const staff = me.hand.find((c) => c.kind === 'staff');
  if (staff) return { kind: 'hire', cardId: staff.id };

  // 7. Start a Market project (no VP gate — a Sales VP only adds +50% to the
  //    completion reward and lets it cash out).
  const market = me.hand.find((c) => c.kind === 'project' && c.subtype === 'market');
  if (market) {
    return { kind: 'assignProject', cardId: market.id, target: 'self' };
  }

  // 8. Start a Tech project (no VP gate, keep board ≤ 2 ongoing — the Eng VP
  //    halves its burn and boosts the reward instead of gating it).
  const tech = me.hand.find((c) => c.kind === 'project' && c.subtype === 'tech');
  if (tech && me.projects.length < 2) {
    return { kind: 'assignProject', cardId: tech.id, target: 'self' };
  }

  // 9. Rescue an own bad project (house rules): 画大饼 — sacrifice engineers
  //    (discounted by finance skill) — beats paying cash when it fits.
  const ownBad = me.projects.find((p) => p.subtype === 'bad');
  if (ownBad && getSkill(state, player, 'eng') < ownBad.reqSkill) {
    const req = burnoutReq(state, player, ownBad);
    const engs = me.company.filter(
      (c): c is StaffCard => c.kind === 'staff' && c.role === 'eng',
    );
    if (getSkill(state, player, 'eng') >= req) {
      // Greedy subset: highest skill first until the (discounted) bar is met.
      const sorted = [...engs].sort((a, b) => b.skill - a.skill);
      const pick: string[] = [];
      let sum = 0;
      for (const c of sorted) {
        if (sum >= req) break;
        pick.push(c.id);
        sum += c.skill;
      }
      if (sum >= req) return { kind: 'burnoutBad', cardId: ownBad.id, engineerIds: pick };
    }
    // Cash valve: pay 2×burn (+$8M comfort margin) to stop the bleed.
    if (me.cash >= badAbandonCost(ownBad) + 8) {
      return { kind: 'abandonBad', cardId: ownBad.id };
    }
  }

  // 10. Dump a duplicate VP (a department already has its VP) via the free
  //     once-per-turn discard — dead cards shouldn't clog the hand.
  if (!me.discardedThisTurn) {
    const dupVp = me.hand.find((c) => c.kind === 'vp' && vpAlreadyHeld(state, player, c.dept));
    if (dupVp) return { kind: 'discard', cardId: dupVp.id };
  }

  return null;
}

/** Indices of `player`'s projects that are completable now (tech/bad via Eng
 *  VP, market via Sales VP), in board order, high→low. */
export function chooseAiCompletions(state: GameState, player: PlayerId = 0): number[] {
  const out: number[] = [];
  state.players[player].projects.forEach((proj, index) => {
    if (canCompleteProject(state, player, proj).ok) out.push(index);
  });
  // Apply high→low so splice offsets don't bite (caller resolves by value, but
  // we still reverse to clear later indices first as a defensive ordering).
  return out.reverse();
}

/** Drive one AI turn: exhaust the priority ladder, then complete projects. */
export function runAiTurn(
  engine: BurnRateEngine,
  player: PlayerId = 0,
  rng: Rng = Math.random,
): void {
  let guard = 0;
  while (guard++ < 50) {
    const action = chooseAiAction(engine.state, player, rng);
    if (!action) break;
    const res = engine.applyAiAction(action, player);
    // chooseAiAction pre-validates, so a failure means state drifted mid-loop;
    // bail rather than spin.
    if (!res.ok) break;
  }
  for (const idx of chooseAiCompletions(engine.state, player)) {
    engine.completeProject(idx, player);
  }
  // Finance VP privilege: exchange dead cards (action cards / duplicate VPs)
  // for fresh draws, up to 2 per turn.
  if (hasVP(engine.state, player, 'fin')) {
    const me = engine.state.players[player];
    const dead = me.hand
      .filter(
        (c) =>
          c.kind === 'action' ||
          (c.kind === 'vp' && vpAlreadyHeld(engine.state, player, c.dept)),
      )
      .sort((a, b) => finExchangeValue(a) - finExchangeValue(b))
      .slice(0, 2)
      .map((c) => c.id);
    if (dead.length) engine.discardAndDraw(dead, player);
  }
}

/** Keep-value for the AI's Fin-VP exchange: actions first, duplicate VPs
 *  second (mirrors the engine's auto-discard policy). */
function finExchangeValue(c: Card): number {
  switch (c.kind) {
    case 'staff': return c.skill;
    case 'vp': return c.salary;
    case 'project': return Math.max(0, c.reward - 2 * c.burn);
    default: return 0; // actions: situational — first to go
  }
}

// ---- helpers --------------------------------------------------------------

/** Of the poachable refs, return the id of the card with the highest value
 *  (staff skill, or VP salary), preferring the `richest` foe's cards on ties.
 *  Matches impl's `reduce(... skill||salary ...)`. */
export function pickBestPoach(
  refs: { player: PlayerId; zone: 'company' | 'projects'; index: number }[],
  state: GameState,
  richest: PlayerId | null,
): string | null {
  let bestCard: Card | null = null;
  let bestScore = -1;
  let bestIsRichest = false;
  for (const ref of refs) {
    const card = state.players[ref.player]?.company[ref.index];
    if (!card) continue;
    const score =
      card.kind === 'staff' ? card.skill : card.kind === 'vp' ? card.salary : 0;
    const isRichest = ref.player === richest;
    if (score > bestScore || (score === bestScore && isRichest && !bestIsRichest)) {
      bestScore = score;
      bestCard = card;
      bestIsRichest = isRichest;
    }
  }
  return bestCard ? bestCard.id : null;
}
