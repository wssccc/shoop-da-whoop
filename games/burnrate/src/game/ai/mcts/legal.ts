// Legal-action enumeration for the AI action space (mirrors `AiAction`).
//
// The AI deliberately does NOT play headhunter / layoff / resign / release —
// they are out of scope for every adapter (same as the original heuristic) so
// the action space stays small and the MCTS tree branchable.

import { badAbandonCost, burnoutReq, opponents, validPoachTargets, vpAlreadyHeld } from '../../rules';
import type { AiAction, GameState, PlayerId, StaffCard } from '../../types';

/** All legal `AiAction`s for `player` right now (each targeting action expands
 *  once per alive opponent; poach expands once per legal victim card). */
export function legalActions(state: GameState, player: PlayerId): AiAction[] {
  const out: AiAction[] = [];
  const me = state.players[player];
  const foes = opponents(state, player);

  for (const card of me.hand) {
    switch (card.kind) {
      case 'vp':
        if (!vpAlreadyHeld(state, player, card.dept)) {
          out.push({ kind: 'hire', cardId: card.id });
        }
        break;
      case 'staff':
        out.push({ kind: 'hire', cardId: card.id });
        break;
      case 'project':
        if (card.target === 'self') {
          out.push({ kind: 'assignProject', cardId: card.id, target: 'self' });
        } else {
          for (const foe of foes) {
            out.push({ kind: 'assignProject', cardId: card.id, target: foe });
          }
        }
        break;
      case 'action':
        switch (card.act) {
          case 'audit':
            for (const foe of foes) out.push({ kind: 'audit', target: foe });
            break;
          case 'consultant':
            for (const foe of foes) out.push({ kind: 'consultant', target: foe });
            break;
          case 'poach': {
            // validPoachTargets applies the HR-VP shield rule + cash cost.
            for (const ref of validPoachTargets(state, player)) {
              const c = state.players[ref.player].company[ref.index];
              if (c) out.push({ kind: 'poach', targetCardId: c.id });
            }
            break;
          }
          default:
            break; // headhunter/layoff/resign/release excluded by design
        }
        break;
      case 'consultant':
        break; // parasites are never in a hand
    }
  }

  // Own bad projects: rescue via cash (abandon) or 画大饼 (burnout). The
  // burnout action uses the greedy highest-skill subset (same as the
  // heuristic) to keep the action space linear instead of 2^n.
  for (const proj of me.projects) {
    if (proj.subtype !== 'bad') continue;
    if (me.cash >= badAbandonCost(proj)) {
      out.push({ kind: 'abandonBad', cardId: proj.id });
    }
    const req = burnoutReq(state, player, proj);
    const engs = me.company.filter(
      (c): c is StaffCard => c.kind === 'staff' && c.role === 'eng',
    );
    const sorted = [...engs].sort((a, b) => b.skill - a.skill);
    const pick: string[] = [];
    let sum = 0;
    for (const c of sorted) {
      if (sum >= req) break;
      pick.push(c.id);
      sum += c.skill;
    }
    if (sum >= req) out.push({ kind: 'burnoutBad', cardId: proj.id, engineerIds: pick });
  }

  // Free once-per-turn discard: expose it for duplicate VPs only (keeps the
  // action space linear; the heuristic uses the same criterion).
  if (!me.discardedThisTurn) {
    for (const card of me.hand) {
      if (card.kind === 'vp' && vpAlreadyHeld(state, player, card.dept)) {
        out.push({ kind: 'discard', cardId: card.id });
      }
    }
  }

  return out;
}

/** Canonical identity of an action (Map keys, tree children dedup). */
export function actionKey(a: AiAction): string {
  return JSON.stringify(a);
}
