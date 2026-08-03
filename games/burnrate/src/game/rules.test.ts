// Pure rule-function tests. Each operates on a tiny, hand-built `GameState`,
// so failures pinpoint the rule (never the engine or rng).
// Multiplayer model: players are an array (0 = human, 1 = AI).
import { expect, test } from 'vitest';
import {
    badAbandonCost,
    bailoutAmount,
    burnBreakdown,
    burnoutReq,
    calcBurn,
    canAbandonBad,
    canCompleteProject,
    canDiscard,
    canHire,
    canPlayCard,
    feudFeasible,
    getConsultantOutlay,
    getProjectBurn,
    getSalaryOutlay,
    getSkill,
    hasVP,
    isStrictLowestCash,
    lastStanding,
    nextAlive,
    opponents,
    projectBurnOf,
    projectReward,
    validLayoffTargets,
    validPoachTargets,
    validReleaseTargets,
    validResignTargets,
} from './rules';
import type {
    ActionCard,
    ConsultantCard,
    GameState,
    PlayerState,
    ProjectCard,
    StaffCard,
    VPCard,
} from './types';

// ---- fixtures -------------------------------------------------------------

let seq = 0;
const nid = () => 't' + seq++;

function vp(dept: VPCard['dept']): VPCard {
  return { id: nid(), name: dept + 'VP', kind: 'vp', dept, salary: 4, desc: '' };
}
function staff(role: StaffCard['role'], skill: number): StaffCard {
  return { id: nid(), name: role + skill, kind: 'staff', role, skill, salary: skill, desc: '' };
}
function proj(p: Omit<ProjectCard, 'id' | 'name' | 'kind' | 'desc'>): ProjectCard {
  return { id: nid(), name: 'p', kind: 'project', desc: '', ...p };
}
function consultant(cost: number): ConsultantCard {
  return { id: nid(), name: '顾问', kind: 'consultant', salary: cost, desc: '' };
}
function action(act: ActionCard['act']): ActionCard {
  return { id: nid(), name: act, kind: 'action', act, desc: '' };
}

function basePlayer(over: Partial<PlayerState> = {}): PlayerState {
  return { cash: 100, hand: [], company: [], projects: [], auditThisTurn: false, alive: true, bailoutUsed: false, wasStrictLowest: false, discardedThisTurn: false, ...over };
}

function mkState(playerOver: Partial<PlayerState> = {}, aiOver: Partial<PlayerState> = {}): GameState {
  return {
    deck: [],
    discard: [],
    turn: 1,
    currentPlayer: 0,
    players: [basePlayer(playerOver), basePlayer(aiOver)],
    log: [],
    gameOver: false,
    winner: null,
    pending: null,
  };
}

// ---- tests ----------------------------------------------------------------

test('hasVP & rotation helpers', () => {
  const s = mkState({ company: [vp('hr')] });
  expect(hasVP(s, 0, 'hr')).toBe(true);
  expect(hasVP(s, 0, 'fin')).toBe(false);
  expect(opponents(s, 0)).toEqual([1]);
  expect(opponents(s, 1)).toEqual([0]);
  expect(nextAlive(s, 0)).toBe(1);
  expect(nextAlive(s, 1)).toBe(0);
  expect(lastStanding(s)).toBeNull();
  s.players[1].alive = false;
  expect(lastStanding(s)).toBe(0);
});

test('getSkill sums only matching-role staff', () => {
  const s = mkState({ company: [staff('eng', 2), staff('eng', 1), staff('mkt', 3), vp('eng')] });
  expect(getSkill(s, 0, 'eng')).toBe(3);
  expect(getSkill(s, 0, 'mkt')).toBe(3);
  expect(getSkill(s, 0, 'hr')).toBe(0);
});

test('getSalaryOutlay covers vp+staff only; consultants are a separate line', () => {
  const s = mkState({ company: [vp('hr'), staff('eng', 2), consultant(4)] });
  expect(getSalaryOutlay(s, 0)).toBe(4 + 2);
  expect(getConsultantOutlay(s, 0)).toBe(4);
});

test('getProjectBurn sums project burns', () => {
  const s = mkState({ projects: [proj({ subtype: 'tech', reqSkill: 3, burn: 2, reward: 0, target: 'self' }), proj({ subtype: 'bad', reqSkill: 9, burn: 5, reward: 0, target: 'enemy' })] });
  expect(getProjectBurn(s, 0)).toBe(7);
});

test('calcBurn doubles salary under audit unless Fin VP owns it (rules.md §3)', () => {
  const salary = vp('hr'); // $4
  const s = mkState({ company: [salary] });
  expect(calcBurn(s, 0)).toBe(4 + 2); // 2 alive → +2 duel panic

  s.players[0].auditThisTurn = true;
  expect(calcBurn(s, 0)).toBe(8 + 2); // doubled

  // Fin VP immunity — owns Fin VP → no doubling.
  s.players[0].company.push(vp('fin'));
  expect(calcBurn(s, 0)).toBe(8 + 2); // 4 + 4 = 8 (NOT doubled)
});

test('calcBurn: project burn is not doubled by audit', () => {
  const s = mkState({
    company: [staff('eng', 3)], auditThisTurn: true, // salary 3 → ×2 = 6
    projects: [proj({ subtype: 'tech', reqSkill: 3, burn: 5, reward: 0, target: 'self' })],
  });
  expect(calcBurn(s, 0)).toBe(6 + 5 + 2);
});

test('calcBurn: audit doubles VP+staff only, never consultants (rules.md §1.4)', () => {
  const s = mkState({ company: [staff('eng', 2), consultant(4)], auditThisTurn: true });
  expect(calcBurn(s, 0)).toBe(4 + 4 + 2); // staff ×2, consultant untouched
});

test('calcBurn: Finance staff offsets project burn + consultant salaries (rules.md §1.2)', () => {
  // fin2 (salary 2, still in the VP+staff pool) + bad project burn 3 → bucket 3-2 = 1.
  const s = mkState({
    company: [vp('hr'), staff('fin', 2)],
    projects: [proj({ subtype: 'bad', reqSkill: 9, burn: 3, reward: 0, target: 'enemy' })],
  });
  expect(calcBurn(s, 0)).toBe(4 + 2 + 1 + 2);

  // Offset floors at $0 for the project+consultant bucket.
  const s2 = mkState({ company: [staff('fin', 5)], projects: [proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 0, target: 'self' })] });
  expect(calcBurn(s2, 0)).toBe(5 + 2); // fin5 salary + max(0, 1-5) = 5

  // Audit doubles the whole VP+staff pool (finance staff included), BEFORE the
  // offset which only touches the project+consultant bucket.
  const s3 = mkState({
    company: [staff('eng', 2), staff('fin', 1)],
    projects: [proj({ subtype: 'bad', reqSkill: 9, burn: 3, reward: 0, target: 'enemy' })],
    auditThisTurn: true,
  });
  expect(calcBurn(s3, 0)).toBe(6 + 2 + 2); // (2+1) ×2 = 6; bucket 3-1 = 2
});

test('calcBurn: MIN_BURN floor + duel panic only when exactly 2 alive', () => {
  const s = mkState(); // empty boards, both alive
  expect(calcBurn(s, 0)).toBe(2 + 2); // floor + panic
  s.players[1].alive = false; // 1 alive → panic off, floor stays
  expect(calcBurn(s, 0)).toBe(2);
  const s3 = mkState();
  s3.players.push(basePlayer({ alive: true })); // 3 alive → no panic
  expect(calcBurn(s3, 0)).toBe(2);
});

test('isStrictLowestCash: strict only, ties excluded, dead ignored', () => {
  const s = mkState({ cash: 30 }, { cash: 50 });
  expect(isStrictLowestCash(s, 0)).toBe(true);
  expect(isStrictLowestCash(s, 1)).toBe(false);
  s.players[1].cash = 30; // tie → nobody is strictly lowest
  expect(isStrictLowestCash(s, 0)).toBe(false);
  s.players[1].cash = 10;
  s.players[1].alive = false; // dead players don't count
  expect(isStrictLowestCash(s, 0)).toBe(true);
});

test('bailoutAmount: $10M base + $2M per finance skill point', () => {
  const s = mkState();
  expect(bailoutAmount(s, 0)).toBe(10);
  s.players[0].company = [staff('fin', 2)];
  expect(bailoutAmount(s, 0)).toBe(10 + 4);
});

test('burnoutReq: 10% discount per fin skill, floored at 50%', () => {
  const p = proj({ subtype: 'bad', reqSkill: 10, burn: 4, reward: 0, target: 'enemy' });
  const s = mkState();
  expect(burnoutReq(s, 0, p)).toBe(10); // no fin skill
  s.players[0].company = [staff('fin', 3)];
  expect(burnoutReq(s, 0, p)).toBe(7); // ceil(10 × 0.7)
  s.players[0].company = [staff('fin', 3), staff('fin', 3)];
  expect(burnoutReq(s, 0, p)).toBe(5); // floored at 50%
});

test('feudFeasible: needs BOTH a VP and a consultant in your own company', () => {
  expect(feudFeasible(mkState({ company: [vp('hr'), consultant(4)] }), 0)).toBe(true);
  expect(feudFeasible(mkState({ company: [vp('hr')] }), 0)).toBe(false); // no consultant
  expect(feudFeasible(mkState({ company: [consultant(4)] }), 0)).toBe(false); // no VP
});

test('canDiscard: once per turn, needs a hand card', () => {
  const s = mkState({ hand: [action('audit')] });
  expect(canDiscard(s, 0)).toBe(true);
  s.players[0].discardedThisTurn = true;
  expect(canDiscard(s, 0)).toBe(false);
  s.players[0].discardedThisTurn = false;
  s.players[0].hand = [];
  expect(canDiscard(s, 0)).toBe(false);
});

test('badAbandonCost / canAbandonBad: pay 2×burn, bad projects only', () => {
  const bad = proj({ subtype: 'bad', reqSkill: 9, burn: 5, reward: 0, target: 'enemy' });
  const tech = proj({ subtype: 'tech', reqSkill: 3, burn: 5, reward: 0, target: 'self' });
  const s = mkState({ cash: 9 });
  expect(badAbandonCost(bad)).toBe(10);
  expect(canAbandonBad(s, 0, bad)).toBe(false); // cash 9 < 10
  s.players[0].cash = 10;
  expect(canAbandonBad(s, 0, bad)).toBe(true);
  expect(canAbandonBad(s, 0, tech)).toBe(false); // not a bad project
});

test('burnBreakdown exposes floor & panic; sums to calcBurn', () => {
  const s = mkState({ company: [vp('hr')] });
  const bd = burnBreakdown(s, 0);
  expect(bd.salary).toBe(4);
  expect(bd.floor).toBe(0); // base 4 ≥ MIN_BURN
  expect(bd.panic).toBe(2); // 2 alive → duel panic
  expect(bd.salary + bd.ops + bd.floor + bd.panic).toBe(calcBurn(s, 0));
  // Empty board: the MIN_BURN floor shows up on its own (no panic with 1 alive).
  const s1 = mkState();
  s1.players[1].alive = false;
  const bd1 = burnBreakdown(s1, 0);
  expect(bd1.floor).toBe(2);
  expect(bd1.panic).toBe(0);
});

test('canHire: vp limit per dept, staff free, others no', () => {
  const s = mkState({ company: [vp('hr')] });
  expect(canHire(s, 0, vp('hr'))).toBe(false); // dept held
  expect(canHire(s, 0, vp('fin'))).toBe(true);
  expect(canHire(s, 0, staff('eng', 1))).toBe(true);
  expect(canHire(s, 0, proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 0, target: 'self' }))).toBe(false);
  expect(canHire(s, 0, action('audit'))).toBe(false);
});

test('canPlayCard dispatches per kind', () => {
  const s = mkState({ company: [vp('eng')] }, { company: [staff('mkt', 1)] });
  expect(canPlayCard(s, 0, vp('eng'))).toBe(false); // dept held
  expect(canPlayCard(s, 0, vp('fin'))).toBe(true);
  expect(canPlayCard(s, 0, staff('eng', 2))).toBe(true);
  // House rule: assignment has NO VP gate — every project starts freely.
  expect(canPlayCard(s, 0, proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 0, target: 'self' }))).toBe(true);
  expect(canPlayCard(s, 0, proj({ subtype: 'market', reqSkill: 2, burn: 1, reward: 8, target: 'self' }))).toBe(true); // no Sales VP needed
  expect(canPlayCard(s, 0, proj({ subtype: 'bad', reqSkill: 9, burn: 4, reward: 0, target: 'enemy' }))).toBe(true); // bad: no VP needed
  expect(canPlayCard(s, 0, consultant(3))).toBe(false);
});

test('projectBurnOf: Eng VP halves tech burn (min $1M); bad never discounted', () => {
  const s = mkState({ company: [vp('eng')] });
  const tech3 = proj({ subtype: 'tech', reqSkill: 2, burn: 3, reward: 0, target: 'self' });
  const tech1 = proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 0, target: 'self' });
  const bad = proj({ subtype: 'bad', reqSkill: 9, burn: 5, reward: 0, target: 'enemy' });
  expect(projectBurnOf(s, 0, tech3)).toBe(1); // 3/2 floored
  expect(projectBurnOf(s, 0, tech1)).toBe(1); // min $1M
  expect(projectBurnOf(s, 0, bad)).toBe(5); // foe attacks keep full burn
  expect(projectBurnOf(mkState(), 0, tech3)).toBe(3); // no Eng VP
});

test('projectReward: matching VP adds +50% (floored); others untouched', () => {
  const s = mkState({ company: [vp('eng'), vp('sales')] });
  const tech = proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 10, target: 'self' });
  const market = proj({ subtype: 'market', reqSkill: 2, burn: 1, reward: 7, target: 'self' });
  const bad = proj({ subtype: 'bad', reqSkill: 9, burn: 4, reward: 0, target: 'enemy' });
  expect(projectReward(s, 0, tech)).toBe(15); // 10 × 1.5
  expect(projectReward(s, 0, market)).toBe(10); // floor(7 × 1.5)
  expect(projectReward(s, 0, bad)).toBe(0); // bad pays nothing
  expect(projectReward(mkState(), 0, tech)).toBe(10); // no VP
});

test('validLayoffTargets requires the actor HR VP and lists all own members', () => {
  expect(validLayoffTargets(mkState({ company: [staff('eng', 1)] }), 0)).toEqual([]);
  const s = mkState({ company: [vp('hr'), staff('eng', 1), consultant(4)] });
  expect(validLayoffTargets(s, 0)).toHaveLength(3);
});

test('validPoachTargets: HR VP is a shield (must fall first), costs cash', () => {
  // Foe has HR VP → only the HR VP itself is poachable (shield rule).
  const blocked = mkState({}, { company: [vp('hr'), staff('eng', 1)] });
  const refs = validPoachTargets(blocked, 0);
  expect(refs).toHaveLength(1);
  expect(refs[0].index).toBe(0); // the HR VP
  // ...but only if the poacher can afford it ($4M); no HR dept slot needed
  // because the VP is DISCARDED, not stolen.
  const broke = mkState({ cash: 2 }, { company: [vp('hr'), staff('eng', 1)] });
  expect(validPoachTargets(broke, 0)).toEqual([]);
  const hrHolder = mkState({ company: [vp('hr')] }, { company: [vp('hr'), staff('eng', 1)] });
  expect(validPoachTargets(hrHolder, 0)).toHaveLength(1); // breaking the shield works anyway

  // Foe unprotected: staff always (if affordable); VP only if actor lacks its
  // dept; consultants never.
  const s = mkState({ company: [vp('eng')] }, { company: [staff('mkt', 2), vp('eng'), vp('sales'), consultant(3)] });
  const refs2 = validPoachTargets(s, 0);
  expect(refs2).toHaveLength(2); // mkt staff + sales VP (actor lacks sales)
  expect(refs2.every((r) => r.player === 1)).toBe(true);
});

test('validResignTargets: HR VP must fall first; consultants excluded', () => {
  const shielded = validResignTargets(mkState({}, { company: [vp('hr'), staff('eng', 1)] }), 0);
  expect(shielded).toHaveLength(1);
  expect(shielded[0].index).toBe(0); // the HR VP (no cash cost for resign)
  const s = mkState({}, { company: [staff('eng', 1), vp('eng'), consultant(2)] });
  expect(validResignTargets(s, 0)).toHaveLength(2); // staff + vp, not consultant
});

test('validReleaseTargets requires Eng/Sales VP and only lists OWN projects (rules.md §1.4)', () => {
  // No VP → empty
  const noVp = mkState({ projects: [proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 0, target: 'self' })] });
  expect(validReleaseTargets(noVp, 0)).toEqual([]);

  const s = mkState(
    { company: [vp('eng')], projects: [proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 0, target: 'self' })] },
    { projects: [proj({ subtype: 'bad', reqSkill: 9, burn: 4, reward: 0, target: 'enemy' })] },
  );
  const refs = validReleaseTargets(s, 0);
  expect(refs).toHaveLength(1); // own project only — foe's bad project NOT releasable
  expect(refs[0]).toEqual({ player: 0, zone: 'projects', index: 0 });

  // Sales VP unlocks the same scope.
  const s2 = mkState({ company: [vp('sales')], projects: [proj({ subtype: 'market', reqSkill: 2, burn: 1, reward: 8, target: 'self' })] });
  expect(validReleaseTargets(s2, 0)).toHaveLength(1);
});

test('canCompleteProject: skill alone decides; market cash needs Sales VP', () => {
  // Tech completes on engineer skill alone — NO VP required (rules.md §3
  // phase 2: the VP unlocks assignment, not completion).
  const withEng = mkState({ company: [vp('eng'), staff('eng', 3)] });
  const tech3 = proj({ subtype: 'tech', reqSkill: 3, burn: 1, reward: 0, target: 'self' });
  expect(canCompleteProject(withEng, 0, tech3).ok).toBe(true);
  const tech4 = proj({ subtype: 'tech', reqSkill: 4, burn: 1, reward: 0, target: 'self' });
  expect(canCompleteProject(withEng, 0, tech4).ok).toBe(false);

  // VP-less company with enough staff still completes.
  const noVp = mkState({ company: [staff('eng', 9)] });
  expect(canCompleteProject(noVp, 0, tech3).ok).toBe(true);

  // Market: skill gates completion; Sales VP gates cashing out.
  const withSales = mkState({ company: [vp('sales'), staff('mkt', 2)] });
  const market2 = proj({ subtype: 'market', reqSkill: 2, burn: 1, reward: 8, target: 'self' });
  expect(canCompleteProject(withSales, 0, market2)).toEqual({ ok: true, canCash: true });
  // Skill met but no Sales VP → completes without cash.
  expect(canCompleteProject(mkState({ company: [staff('mkt', 2)] }), 0, market2)).toEqual({
    ok: true,
    canCash: false,
  });
  // Sales VP alone (no skill) → not completable.
  expect(canCompleteProject(mkState({ company: [vp('sales')] }), 0, market2).ok).toBe(false);
});
