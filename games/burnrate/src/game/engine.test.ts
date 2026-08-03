// BurnRateEngine controller tests (multiplayer-adapted).
// A fixed-seed rng makes every roll reproducible (bug fix #2/#5).
import { expect, test } from 'vitest';
import { BurnRateEngine } from './engine';
import { mulberry32 } from './rng';
import { createInitialState } from './state';
import type {
    ActionAct,
    ActionCard,
    Card,
    PlayerState,
    ProjectCard,
    ProjectSubtype,
    StaffCard,
    VPCard,
} from './types';

// ---- fixtures -------------------------------------------------------------

let seq = 0;
const nid = () => 'e' + seq++;
function vp(dept: VPCard['dept']): VPCard {
  return { id: nid(), name: dept + 'VP', kind: 'vp', dept, salary: 4, desc: '' };
}
function staff(role: StaffCard['role'], skill: number): StaffCard {
  return { id: nid(), name: role + skill, kind: 'staff', role, skill, salary: skill, desc: '' };
}
function proj(p: { subtype: ProjectSubtype; reqSkill: number; burn: number; reward: number; target: 'self' | 'enemy' }): ProjectCard {
  return { id: nid(), name: 'p', kind: 'project', desc: '', ...p };
}
function action(act: ActionAct): ActionCard {
  return { id: nid(), name: act, kind: 'action', act, desc: '' };
}
function mkHand(...cards: Card[]): Card[] {
  return cards;
}
function makePlayer(over: Partial<PlayerState> = {}): PlayerState {
  return { cash: 100, hand: [], company: [], projects: [], auditThisTurn: false, alive: true, bailoutUsed: false, wasStrictLowest: false, discardedThisTurn: false, ...over };
}

// ---- tests ----------------------------------------------------------------

test('newGame deals 6 cards each, $100M, leaving the rest in the deck', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  expect(e.state.players).toHaveLength(2);
  expect(e.state.players[0].hand).toHaveLength(6);
  expect(e.state.players[1].hand).toHaveLength(6);
  expect(e.state.players[0].cash).toBe(100);
  expect(e.state.players[1].cash).toBe(100);
  expect(e.state.deck.length).toBe(156 - 12);
  expect(e.state.currentPlayer).toBe(0);
});

test('newGame supports 3-5 players', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(4);
  expect(e.state.players).toHaveLength(4);
  expect(e.state.players.every((p) => p.hand.length === 6)).toBe(true);
  expect(e.state.deck.length).toBe(156 - 24);
});

// ---- Opening dice roll (who moves first) --------------------------------

/** Engine whose d6 rolls come from a script (bypasses the deck build's rng
 *  consumption, so roll values are exactly controllable). */
class ScriptedEngine extends BurnRateEngine {
  private readonly script: number[];
  private readonly fallback: number;
  private i = 0;
  constructor(script: number[], fallback = 6) {
    super({ rng: mulberry32(5) });
    this.script = script;
    this.fallback = fallback;
  }
  protected override rollD6(): number {
    return this.script[this.i++] ?? this.fallback;
  }
}

test('rollFirst: seeded rng yields a deterministic outcome', () => {
  const a = new BurnRateEngine({ rng: mulberry32(42) });
  const b = new BurnRateEngine({ rng: mulberry32(42) });
  const ra = a.rollFirst(4);
  const rb = b.rollFirst(4);
  expect(ra).toEqual(rb);
  expect(ra.winner).toBeGreaterThanOrEqual(0);
  expect(ra.winner).toBeLessThan(4);
  expect(ra.rounds.length).toBeGreaterThan(0);
  ra.rounds.forEach((r) => {
    expect(r.values.length).toBe(r.players.length);
    r.values.forEach((v) => expect(v).toBeGreaterThanOrEqual(1));
    r.values.forEach((v) => expect(v).toBeLessThanOrEqual(6));
  });
});

test('rollFirst: tie leaders re-roll until a unique winner emerges', () => {
  // Round 1: everyone rolls 6 (tie); round 2: player 0 rolls 6 vs 5 → p0 wins.
  const e = new ScriptedEngine([6, 6, 6, 5]);
  const out = e.rollFirst(2);
  expect(out.rounds).toHaveLength(2);
  expect(out.rounds[0].players).toEqual([0, 1]);
  expect(out.rounds[0].values).toEqual([6, 6]);
  expect(out.rounds[1].players).toEqual([0, 1]);
  expect(out.rounds[1].values).toEqual([6, 5]);
  expect(out.winner).toBe(0);
});

test('rollFirst: only the tied leaders re-roll', () => {
  // Round 1: p0=6, p1=6, p2=3 → only 0 and 1 re-roll; round 2: p0=2, p1=4.
  const e = new ScriptedEngine([6, 6, 3, 2, 4]);
  const out = e.rollFirst(3);
  expect(out.rounds[0].players).toEqual([0, 1, 2]);
  expect(out.rounds[0].values).toEqual([6, 6, 3]);
  expect(out.rounds[1].players).toEqual([0, 1]);
  expect(out.rounds[1].values).toEqual([2, 4]);
  expect(out.winner).toBe(1);
});

test('rollFirst: degenerate RNG caps the re-roll rounds', () => {
  // A constant roll ties forever — the engine must terminate and pick a
  // leader rather than hang.
  const e = new ScriptedEngine([], 6);
  const out = e.rollFirst(2);
  expect(out.rounds.length).toBeLessThanOrEqual(10);
  expect(out.winner).toBe(0);
});

test('newGame honors the pre-rolled first player', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(4, { firstPlayer: 3 });
  expect(e.state.currentPlayer).toBe(3);
  expect(e.state.log[0].msg).toContain('掷骰胜出');
});

test('newGame without firstPlayer keeps the human starting (legacy)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(3);
  expect(e.state.currentPlayer).toBe(0);
});

test('hireCard respects the per-department VP limit', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand(vp('eng'));
  p.company = [vp('eng')];
  expect(e.hireCard(p.hand[0].id, 0).ok).toBe(false);
});

test('assignProject routes bad→enemy (auto in 1v1), tech/market→self — no VP gate', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  const bad = proj({ subtype: 'bad', reqSkill: 9, burn: 4, reward: 0, target: 'enemy' });
  const tech = proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 0, target: 'self' });
  p.hand = mkHand(bad, tech);

  expect(e.assignProject(bad.id, 0).status).toBe('done');
  expect(e.state.players[1].projects).toHaveLength(1);
  expect(e.state.players[0].projects).toHaveLength(0);

  // House rule: assignment needs NO VP — anyone can start a tech project.
  expect(e.assignProject(tech.id, 0).status).toBe('done');
  expect(e.state.players[0].projects).toHaveLength(1);
});

test('assigning projects to self needs no VP (house rule); bad still goes to foes', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  const market = proj({ subtype: 'market', reqSkill: 2, burn: 1, reward: 8, target: 'self' });
  const tech = proj({ subtype: 'tech', reqSkill: 3, burn: 1, reward: 0, target: 'self' });
  p.hand = mkHand(market, tech);
  // No VP at all: both start fine.
  expect(e.assignProject(market.id, 0).status).toBe('done');
  expect(e.assignProject(tech.id, 0).status).toBe('done');
  expect(e.state.players[0].projects).toHaveLength(2);
});

test('multi-foe bad project awaits a target choice then lands on the pick', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(3); // human + AI 1 + AI 2
  const p = e.state.players[0];
  const bad = proj({ subtype: 'bad', reqSkill: 9, burn: 4, reward: 0, target: 'enemy' });
  p.hand = mkHand(bad);

  const r = e.assignProject(bad.id, 0);
  expect(r.status).toBe('awaitTarget');
  expect(r.playerChoices).toEqual([1, 2]);
  expect(e.state.pending?.kind).toBe('target');
  // pick AI 2
  const res = e.selectTarget({ player: 2, zone: 'company', index: 0 });
  expect(res.ok).toBe(true);
  expect(e.state.players[2].projects).toHaveLength(1);
  expect(e.state.players[0].hand).toHaveLength(0);
});

test('completeProject pays rewards on skill alone — no VP required', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  // No VP at all: engineer skill alone completes the tech project.
  p.company = [staff('eng', 2)];
  const tech = proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 10, target: 'self' });
  p.projects = [tech];
  const cashBefore = p.cash;
  expect(e.completeProject(0, 0).ok).toBe(true);
  expect(p.cash).toBe(cashBefore + 10);
  expect(p.projects).toHaveLength(0);

  // skill too low
  p.projects = [proj({ subtype: 'tech', reqSkill: 9, burn: 1, reward: 0, target: 'self' })];
  expect(e.completeProject(0, 0).ok).toBe(false);
});

test('market project completes without Sales VP but pays no cash', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.company = [staff('mkt', 2)];
  const market = proj({ subtype: 'market', reqSkill: 2, burn: 1, reward: 8, target: 'self' });
  p.projects = [market];
  const cashBefore = p.cash;
  expect(e.completeProject(0, 0).ok).toBe(true);
  expect(p.cash).toBe(cashBefore); // no Sales VP → completes but no cash
  expect(p.projects).toHaveLength(0);

  // With a Sales VP the same project cashes out — with the +50% bonus.
  p.company = [staff('mkt', 2), vp('sales')];
  p.projects = [proj({ subtype: 'market', reqSkill: 2, burn: 1, reward: 8, target: 'self' })];
  const cash2 = p.cash;
  expect(e.completeProject(0, 0).ok).toBe(true);
  expect(p.cash).toBe(cash2 + 12); // 8 × 1.5 (Sales VP reward bonus)
});

test('Eng VP halves tech burn and boosts tech reward +50% (house rule)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand();
  const tech = proj({ subtype: 'tech', reqSkill: 2, burn: 5, reward: 10, target: 'self' });
  p.projects = [tech];
  // No Eng VP: full burn.
  e.endTurn(0);
  expect(p.cash).toBe(100 - (5 + 2)); // burn 5 + duel panic (2 alive)
  // With Eng VP: tech burns at half (5 → 2), reward ×1.5 (10 → 15).
  const e2 = new BurnRateEngine({ rng: mulberry32(6) });
  e2.newGame(2);
  const q = e2.state.players[0];
  q.hand = mkHand();
  q.company = [vp('eng'), staff('eng', 2)]; // eng skill 2 meets reqSkill 2
  const tech2 = proj({ subtype: 'tech', reqSkill: 2, burn: 5, reward: 10, target: 'self' });
  q.projects = [tech2];
  e2.endTurn(0);
  expect(q.cash).toBe(100 - (Math.max(1, Math.floor(5 / 2)) + 4 + 2 + 2)); // halved burn + VP + eng salary + panic
  const cashBefore = q.cash;
  expect(e2.completeProject(0, 0).ok).toBe(true);
  expect(q.cash).toBe(cashBefore + 15); // 10 × 1.5
});

test('projects auto-complete the moment a hire meets their skill (no VP)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  const tech = proj({ subtype: 'tech', reqSkill: 3, burn: 1, reward: 10, target: 'self' });
  p.projects = [tech];
  p.hand = mkHand(staff('eng', 3)); // VP-less hire that meets reqSkill
  const cashBefore = p.cash;
  expect(e.hireCard(p.hand[0].id, 0).ok).toBe(true);
  expect(p.projects).toHaveLength(0); // auto-completed on hire
  expect(p.cash).toBe(cashBefore + 10);
});

test('projects auto-complete at the next mover\'s action phase (endTurn)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const foe = e.state.players[1];
  foe.company = [staff('eng', 5)]; // no VP — skill is enough
  foe.projects = [proj({ subtype: 'tech', reqSkill: 4, burn: 1, reward: 10, target: 'self' })];
  const foeCash = foe.cash;
  const res = e.endTurn(0);
  expect(res.nextPlayer).toBe(1);
  expect(foe.projects).toHaveLength(0); // completed at the start of their turn
  expect(foe.cash).toBe(foeCash + 10);
});

test('REGRESSION #1: player Audit consumes player hand (not ai hand)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  e.state.players[0].hand = mkHand(action('audit'));
  e.state.players[1].hand = [];
  expect(e.playAction(e.state.players[0].hand[0].id, 0).status).toBe('done');
  expect(e.state.players[0].hand).toHaveLength(0);
  expect(e.state.players[1].hand).toHaveLength(0);
  expect(e.state.players[1].auditThisTurn).toBe(true);
});

test('REGRESSION #1: AI Audit consumes AI hand (impl spliced player hand)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  e.state.players[1].hand = mkHand(action('audit'));
  e.state.players[0].hand = [];
  expect(e.applyAiAction({ kind: 'audit', target: 0 }, 1).ok).toBe(true);
  expect(e.state.players[1].hand).toHaveLength(0);
  expect(e.state.players[0].auditThisTurn).toBe(true);
});

test('Audit is nullified by the foe Finance VP', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  e.state.players[0].hand = mkHand(action('audit'));
  e.state.players[1].company = [vp('fin')];
  expect(e.playAction(e.state.players[0].hand[0].id, 0).status).toBe('done');
  expect(e.state.players[1].auditThisTurn).toBe(false);
});

test('REGRESSION #1+#2: AI Consultant lands on the PLAYER and rolls a salary', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  e.state.players[1].hand = mkHand(action('consultant'));
  e.state.players[0].company = [];
  expect(e.applyAiAction({ kind: 'consultant', target: 0 }, 1).ok).toBe(true);
  const c = e.state.players[0].company[0];
  expect(c.kind).toBe('consultant');
  expect(c.salary).toBeGreaterThanOrEqual(3);
  expect(c.salary).toBeLessThanOrEqual(5);
});

test('REGRESSION #2: consultant salary is reproducible under a fixed rng', () => {
  const roll = () => {
    const e = new BurnRateEngine({ rng: mulberry32(42) });
    e.newGame(2);
    e.state.players[1].hand = mkHand(action('consultant'));
    e.applyAiAction({ kind: 'consultant', target: 0 }, 1);
    return (e.state.players[0].company[0] as { salary: number }).salary;
  };
  expect(roll()).toBe(roll());
});

test('Headhunter: search deck/discard for a category, card joins hand (rules.md §1.4)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  const deckBefore = e.state.deck.length;
  p.hand = mkHand(action('headhunter'));
  const r = e.playAction(p.hand[0].id, 0);
  expect(r.status).toBe('awaitPick');
  const choices = (r as { choices: { key: string; available: number }[] }).choices;
  expect(choices).toHaveLength(8); // 4 VP depts + 4 staff roles
  const staffEng = choices.find((c) => c.key === 'staff:eng');
  expect(staffEng!.available).toBeGreaterThan(0);
  // The headhunter card is consumed up front; nothing drawn yet.
  expect(p.hand).toHaveLength(0);
  expect(e.state.deck.length).toBe(deckBefore);

  expect(e.pickHeadhunter('staff:eng').ok).toBe(true);
  const gained = p.hand[p.hand.length - 1];
  expect(gained.kind).toBe('staff');
  expect((gained as { role: string }).role).toBe('eng');
  expect(e.state.discard.some((c) => c.kind === 'action' && c.act === 'headhunter')).toBe(true);
});

test('Headhunter: no recruitable card left anywhere → card spent, no pick', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  // Drain every VP/staff from deck + discard.
  e.state.deck = e.state.deck.filter((c) => c.kind !== 'vp' && c.kind !== 'staff');
  e.state.discard = e.state.discard.filter((c) => c.kind !== 'vp' && c.kind !== 'staff');
  p.hand = mkHand(action('headhunter'));
  const r = e.playAction(p.hand[0].id, 0);
  expect(r.status).toBe('done');
  expect(p.hand).toHaveLength(0);
  expect(e.state.discard.some((c) => c.kind === 'action' && c.act === 'headhunter')).toBe(true);
});

test('Headhunter: stale/unknown category is rejected', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  e.state.players[0].hand = mkHand(action('headhunter'));
  expect(e.playAction(e.state.players[0].hand[0].id, 0).status).toBe('awaitPick');
  expect(e.pickHeadhunter('vp:hr').ok).toBe(true); // valid pick clears pending
  expect(e.pickHeadhunter('vp:hr').ok).toBe(false); // nothing pending anymore
});

test('Poach moves a foe card for a fee; an HR VP shield must fall first', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const actor = e.state.players[0];
  const foe = e.state.players[1];
  actor.hand = mkHand(action('poach'));
  foe.company = [staff('mkt', 3)];

  const r = e.playAction(actor.hand[0].id, 0);
  expect(r.status).toBe('awaitTarget');
  expect(e.selectTarget({ player: 1, zone: 'company', index: 0 }).ok).toBe(true);
  expect(actor.company.some((c) => c.name === 'mkt3')).toBe(true);
  expect(actor.cash).toBe(100 - 3); // poach fee = staff skill
  expect(foe.company).toHaveLength(0);
  expect(actor.hand.some((c) => c.kind === 'action' && c.act === 'poach')).toBe(false);

  // Shield rule: the foe HR VP is the only target — taking it COSTS $4M and
  // DISCARDS the VP (breaking the shield, not stealing it).
  const e2 = new BurnRateEngine({ rng: mulberry32(5) });
  e2.newGame(2);
  e2.state.players[0].hand = mkHand(action('poach'));
  e2.state.players[1].company = [vp('hr'), staff('eng', 2)];
  const r2 = e2.playAction(e2.state.players[0].hand[0].id, 0);
  expect(r2.status).toBe('awaitTarget');
  expect(r2.targets).toHaveLength(1); // only the HR VP
  const hrCard = e2.state.players[1].company[0];
  expect(e2.selectTarget({ player: 1, zone: 'company', index: 0 }).ok).toBe(true);
  expect(e2.state.players[0].cash).toBe(100 - 4);
  expect(e2.state.players[0].company.some((c) => c.kind === 'vp' && c.dept === 'hr')).toBe(false); // not stolen
  expect(e2.state.discard).toContain(hrCard); // discarded instead
  expect(e2.state.players[1].company).toHaveLength(1); // eng2 stays behind

  // The shield also breaks when the poacher already holds an HR VP (the
  // discarded VP never collides with a dept slot).
  const e4 = new BurnRateEngine({ rng: mulberry32(5) });
  e4.newGame(2);
  e4.state.players[0].hand = mkHand(action('poach'));
  e4.state.players[0].company = [vp('hr')];
  e4.state.players[1].company = [vp('hr')];
  expect(e4.playAction(e4.state.players[0].hand[0].id, 0).status).toBe('awaitTarget');
  expect(e4.selectTarget({ player: 1, zone: 'company', index: 0 }).ok).toBe(true);
  expect(e4.state.players[1].company).toHaveLength(0);
  expect(e4.state.players[0].company).toHaveLength(1); // own HR VP untouched

  // Not enough cash → poach refused.
  const e3 = new BurnRateEngine({ rng: mulberry32(5) });
  e3.newGame(2);
  e3.state.players[0].cash = 2;
  e3.state.players[0].hand = mkHand(action('poach'));
  e3.state.players[1].company = [staff('eng', 3)];
  expect(e3.playAction(e3.state.players[0].hand[0].id, 0).status).toBe('invalid');
});

test('Resign drops a foe card; the HR VP shield must fall first (no fee)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  e.state.players[0].hand = mkHand(action('resign'));
  e.state.players[1].company = [staff('eng', 2)];
  const r = e.playAction(e.state.players[0].hand[0].id, 0);
  expect(r.status).toBe('awaitTarget');
  expect(e.selectTarget({ player: 1, zone: 'company', index: 0 }).ok).toBe(true);
  expect(e.state.players[1].company).toHaveLength(0);

  // Shield: only the HR VP can be resigned, and it works.
  const e2 = new BurnRateEngine({ rng: mulberry32(5) });
  e2.newGame(2);
  e2.state.players[0].hand = mkHand(action('resign'));
  e2.state.players[1].company = [vp('hr'), staff('eng', 1)];
  const r2 = e2.playAction(e2.state.players[0].hand[0].id, 0);
  expect(r2.status).toBe('awaitTarget');
  expect(r2.targets).toHaveLength(1);
  expect(e2.selectTarget({ player: 1, zone: 'company', index: 0 }).ok).toBe(true);
  expect(e2.state.players[1].company).toHaveLength(1); // staff behind the fallen shield
});

test('high exec feud layoff: 1 VP + 1 consultant implode together, no HR VP needed', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand(action('layoff'));
  const hrVp = vp('eng');
  const con = { id: 'c1', name: '高价顾问', kind: 'consultant' as const, salary: 4, desc: '' };
  p.company = [hrVp, con, staff('eng', 2)];
  // No HR VP at all — the feud is the only layoff path available.
  const r = e.startFeudLayoff(0);
  expect(r.status).toBe('awaitTarget');
  const r2 = e.playAction(p.hand[0].id, 0);
  expect(r2.status).toBe('invalid'); // plain layoff still needs HR VP
  // Pick the VP + consultant (indices 0 and 1).
  expect(e.selectTargets([
    { player: 0, zone: 'company', index: 1 }, // consultant
    { player: 0, zone: 'company', index: 0 }, // VP
  ]).ok).toBe(true);
  expect(p.company).toHaveLength(1); // eng2 stays
  expect(e.state.discard).toContain(hrVp); // VP discarded, consultant silently gone
  expect(e.state.pending).toBeNull();
  // Wrong combo (2 VPs) is refused.
  const e2 = new BurnRateEngine({ rng: mulberry32(5) });
  e2.newGame(2);
  const p2 = e2.state.players[0];
  p2.company = [vp('eng'), vp('fin'), { id: 'c2', name: '顾问', kind: 'consultant' as const, salary: 5, desc: '' }];
  const r3 = e2.startFeudLayoff(0);
  expect(r3.status).toBe('awaitTarget');
  expect(e2.selectTargets([
    { player: 0, zone: 'company', index: 0 },
    { player: 0, zone: 'company', index: 1 }, // two VPs — no consultant picked
  ]).ok).toBe(false);
  expect(p2.company).toHaveLength(3); // nothing removed
});

test('Layoff needs HR VP and removes parasites silently', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  e.state.players[0].hand = mkHand(action('layoff'));
  e.state.players[0].company = [vp('hr'), staff('eng', 1)];
  const r = e.playAction(e.state.players[0].hand[0].id, 0);
  expect(r.status).toBe('awaitTarget');
  expect(e.selectTarget({ player: 0, zone: 'company', index: 1 }).ok).toBe(true);
  expect(e.state.players[0].company).toHaveLength(1);

  const e2 = new BurnRateEngine({ rng: mulberry32(5) });
  e2.newGame(2);
  const p = e2.state.players[0];
  p.hand = mkHand(action('layoff'));
  const parasite = { id: 'con-1', name: '顾问', kind: 'consultant' as const, salary: 4, desc: '' };
  p.company = [vp('hr'), parasite];
  const r2 = e2.playAction(p.hand[0].id, 0);
  expect(r2.status).toBe('awaitTarget');
  expect(e2.selectTarget({ player: 0, zone: 'company', index: 1 }).ok).toBe(true);
  expect(p.company).toHaveLength(1); // HR VP remains
  expect(e2.state.discard.some((c) => c.id === 'con-1')).toBe(false); // parasite not a deck card
});

test('Layoff bulk pick: one card cuts 1 + HR skill targets (rules.md §1.2)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand(action('layoff'));
  p.company = [vp('hr'), staff('eng', 1), staff('eng', 2), staff('mkt', 1)];
  const r = e.playAction(p.hand[0].id, 0);
  expect(r.status).toBe('awaitTarget');
  expect((r as { pickCount?: number }).pickCount).toBe(1); // 1 + HR skill 0

  // HR skill 2 → bulk 3; capped by company size.
  p.company = [vp('hr'), staff('eng', 1), staff('hr', 2), staff('eng', 2), staff('mkt', 1)];
  const r2 = e.playAction(p.hand[0].id, 0);
  expect((r2 as { pickCount?: number }).pickCount).toBe(3);

  // A single pick is rejected for bulk actions.
  expect(e.selectTarget({ player: 0, zone: 'company', index: 1 }).ok).toBe(false);
  // Duplicates are rejected too.
  expect(
    e.selectTargets([
      { player: 0, zone: 'company', index: 1 },
      { player: 0, zone: 'company', index: 1 },
      { player: 0, zone: 'company', index: 2 },
    ]).ok,
  ).toBe(false);
  // Exactly pickCount distinct legal refs resolves the whole batch.
  expect(
    e.selectTargets([
      { player: 0, zone: 'company', index: 1 },
      { player: 0, zone: 'company', index: 2 },
      { player: 0, zone: 'company', index: 3 },
    ]).ok,
  ).toBe(true);
  expect(p.company).toHaveLength(2); // vp('hr') + the leftover staff
  expect(p.hand.some((c) => c.kind === 'action' && c.act === 'layoff')).toBe(false); // consumed
});

test('Release needs Eng/Sales VP and only hits YOUR OWN board (rules.md §1.4)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand(action('release'));
  p.company = [vp('eng')];
  p.projects = [proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 0, target: 'self' })];
  e.state.players[1].projects = [proj({ subtype: 'bad', reqSkill: 9, burn: 4, reward: 0, target: 'enemy' })];
  const r = e.playAction(p.hand[0].id, 0);
  expect(r.status).toBe('awaitTarget');
  expect((r as { targets: { player: number }[] }).targets.map((t) => t.player)).toEqual([0]);
  expect(e.selectTarget({ player: 0, zone: 'projects', index: 0 }).ok).toBe(true);
  expect(p.projects).toHaveLength(0);
  expect(e.state.players[1].projects).toHaveLength(1); // foe's bad project untouched
});

test('REGRESSION #7: discardAndDraw requires Fin VP and exchanges N for N', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand(staff('eng', 1), staff('eng', 2));
  expect(e.discardAndDraw([p.hand[0].id], 0).ok).toBe(false); // no Fin VP

  p.company = [vp('fin')];
  const deckBefore = e.state.deck.length;
  const r = e.discardAndDraw([p.hand[0].id], 0);
  expect(r.ok).toBe(true);
  expect(p.hand).toHaveLength(2); // 1 discarded, 1 drawn
  expect(e.state.deck.length).toBe(deckBefore - 1);
});

test('REGRESSION #6: endTurn refills the NEW mover, not the side that ended', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p0 = e.state.players[0];
  const p1 = e.state.players[1];
  p0.hand = mkHand(staff('eng', 1));
  p1.hand = mkHand(staff('eng', 2));
  const res = e.endTurn(0);
  expect(res.bankrupt).toBe(false);
  expect(res.nextPlayer).toBe(1);
  expect(e.state.currentPlayer).toBe(1);
  expect(p1.hand.length).toBeGreaterThan(1); // refilled to 6
  expect(p0.hand).toHaveLength(1); // untouched
  expect(e.state.turn).toBe(1); // round only increments back at player 0
});

test('endTurn doubles burn under audit then clears the flag; increments turn on 1→0', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand();
  p.company = [vp('hr')]; // $4
  p.auditThisTurn = true;
  e.endTurn(0);
  expect(p.cash).toBe(100 - (8 + 2)); // doubled + 2-player panic
  expect(p.auditThisTurn).toBe(false);

  // second endTurn (AI) back to player 0 → turn increments
  const res = e.endTurn(1);
  expect(res.nextPlayer).toBe(0);
  expect(e.state.turn).toBe(2);
});

test('endTurn bankruptcy fires onGameOver and declares the survivor', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  let winner: number | null = null;
  e.onGameOver = (w) => { winner = w; };
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand();
  p.cash = 3;
  p.company = [staff('eng', 4)]; // burn 4 → bankrupt
  p.bailoutUsed = true; // bailout already spent — real bankruptcy now
  const res = e.endTurn(0);
  expect(res.bankrupt).toBe(true);
  expect(e.state.players[0].alive).toBe(false);
  expect(e.state.gameOver).toBe(true);
  expect(e.state.winner).toBe(1);
  expect(winner).toBe(1);
});

test('multiplayer bankruptcy skips the dead; last standing wins', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(3);
  const p1 = e.state.players[1];
  p1.hand = mkHand();
  p1.cash = 2;
  p1.company = [staff('eng', 3)]; // burn 3 → bankrupt
  p1.bailoutUsed = true; // bailout already spent
  const res = e.endTurn(0); // human ends → AI 1's turn
  expect(res.nextPlayer).toBe(1);
  const res2 = e.endTurn(1); // AI 1 burns out
  expect(res2.bankrupt).toBe(true);
  expect(e.state.players[1].alive).toBe(false);
  expect(e.state.gameOver).toBe(false); // AI 2 still alive
  expect(res2.nextPlayer).toBe(2);
});

test('endTurn after bankruptcy still refills the successor to six (bug fix)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(3);
  const p1 = e.state.players[1];
  p1.hand = mkHand();
  p1.cash = 2;
  p1.company = [staff('eng', 3)]; // burn 3 → bankrupt
  p1.bailoutUsed = true;
  // The successor (player 2) has a met-skill project pending and a short hand.
  const p2 = e.state.players[2];
  p2.hand = mkHand(staff('eng', 1));
  p2.company = [staff('eng', 2)];
  p2.projects = [proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 10, target: 'self' })];
  const res = e.endTurn(1); // AI 1 burns out → hand off to player 2
  expect(res.bankrupt).toBe(true);
  expect(e.state.currentPlayer).toBe(2);
  // Phase 1 of the successor's turn must still run: refill to 6…
  expect(p2.hand).toHaveLength(6);
  // …and their action phase opens with the auto-completion.
  expect(p2.projects).toHaveLength(0);
});

test('bailout: first cash ≤ 0 refunds once (10 + 2×fin), second time bankrupts', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand();
  p.cash = 3;
  p.company = [staff('fin', 2), staff('eng', 4)]; // burn 6 (+3 panic) → bankrupt without bailout
  const res = e.endTurn(0);
  expect(res.bankrupt).toBe(false); // bailed out instead
  expect(p.alive).toBe(true);
  expect(p.bailoutUsed).toBe(true);
  expect(p.cash).toBe(10 + 4); // $2M per finance skill point
  // Second time at ≤ 0 → real bankruptcy.
  p.cash = 3;
  const res2 = e.endTurn(0);
  expect(res2.bankrupt).toBe(true);
  expect(p.alive).toBe(false);
});

test('abandonBad: pay 2×burn to clear your own bad project (cash valve)', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand();
  const bad = proj({ subtype: 'bad', reqSkill: 9, burn: 5, reward: 0, target: 'enemy' });
  p.projects = [bad];
  p.cash = 9;
  expect(e.abandonBad(bad.id, 0).ok).toBe(false); // 9 < 10
  p.cash = 15;
  const r = e.abandonBad(bad.id, 0);
  expect(r.ok).toBe(true);
  expect(p.cash).toBe(5);
  expect(p.projects).toHaveLength(0);
  expect(e.state.discard).toContain(bad);
});

test('burnoutBad: sacrifice engineers (discounted by fin skill) to clear a bad project', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand();
  const bad = proj({ subtype: 'bad', reqSkill: 10, burn: 4, reward: 0, target: 'enemy' });
  p.projects = [bad];
  const fin = staff('fin', 2); // req = ceil(10 × 0.8) = 8
  const a = staff('eng', 3);
  const b = staff('eng', 3);
  const c = staff('eng', 2);
  p.company = [fin, a, b, c];
  expect(e.burnoutBad(bad.id, [a.id, b.id], 0).ok).toBe(false); // 6 < 8
  const r = e.burnoutBad(bad.id, [a.id, b.id, c.id], 0);
  expect(r.ok).toBe(true);
  expect(p.company).toHaveLength(1); // only the finance staff stays
  expect(p.projects).toHaveLength(0);
  expect(e.state.discard).toContain(bad);
  expect(e.state.discard).toContain(a);
  // Non-bad projects are not burnout-able.
  const tech = proj({ subtype: 'tech', reqSkill: 3, burn: 1, reward: 10, target: 'self' });
  p.projects = [tech];
  expect(e.burnoutBad(tech.id, [], 0).ok).toBe(false);
});

test('discardCard: free once-per-turn discard, reset next turn', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  const hrVp = vp('hr');
  const engVp = vp('eng');
  p.hand = mkHand(hrVp, engVp);
  // First discard works and marks the turn.
  const r = e.discardCard(hrVp.id, 0);
  expect(r.ok).toBe(true);
  expect(p.hand).toHaveLength(1);
  expect(p.discardedThisTurn).toBe(true);
  expect(e.state.discard).toContain(hrVp);
  // Second discard in the same turn is refused.
  expect(e.discardCard(engVp.id, 0).ok).toBe(false);
  // Card not in hand is refused.
  p.discardedThisTurn = false;
  expect(e.discardCard('nope', 0).ok).toBe(false);
  // Next turn start re-arms the free discard.
  p.hand = mkHand(engVp);
  e.endTurn(0);
  const p1 = e.state.players[1];
  p1.hand = mkHand();
  e.endTurn(1);
  expect(p.discardedThisTurn).toBe(false);
  expect(e.discardCard(engVp.id, 0).ok).toBe(true);
});

test('discardToCap: explicit picks first, then auto-discard lowest-value to 8', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  const eng1 = staff('eng', 1);
  const eng2 = staff('eng', 2);
  const eng3 = staff('eng', 3);
  const aud = action('audit');
  const head = action('headhunter');
  const lay = action('layoff');
  const hrVp = vp('hr');
  const techA = proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 6, target: 'self' });
  const techB = proj({ subtype: 'tech', reqSkill: 6, burn: 3, reward: 20, target: 'self' });
  const bad = proj({ subtype: 'bad', reqSkill: 9, burn: 4, reward: 0, target: 'enemy' });
  p.hand = [eng1, eng2, eng3, aud, head, lay, hrVp, techA, techB, bad]; // 10 cards
  e.discardToCap([], 0);
  expect(p.hand).toHaveLength(8);
  expect(p.hand).toContain(eng3); // highest skill kept
  expect(p.hand).toContain(techB); // best intrinsic value kept
  expect(p.hand).not.toContain(aud); // zero-value actions go first
  expect(p.hand).not.toContain(head);
  // Explicit picks remove first (human override), then auto-trim still applies.
  p.hand = [eng1, eng2, eng3, aud, head, lay, hrVp, techA, techB, bad];
  e.discardToCap([aud.id, head.id, lay.id], 0);
  expect(p.hand).toHaveLength(7);
  expect(p.hand).not.toContain(aud);
  expect(p.hand).not.toContain(head);
  expect(p.hand).not.toContain(lay);
});

test('comeback draw: strictly-lowest refills to 7, ties get 6', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(3);
  const [p0, p1, p2] = e.state.players;
  for (const p of [p0, p1, p2]) p.hand = mkHand(staff('eng', 1));
  p0.cash = 40; p1.cash = 30; p2.cash = 50;
  e.endTurn(2); // P0's turn starts — P0(40) not the lowest
  expect(p0.hand).toHaveLength(6);
  e.endTurn(0); // P1's turn — strictly lowest(30) → refills to 7
  expect(p1.hand).toHaveLength(7);
  expect(p1.wasStrictLowest).toBe(true);
  e.endTurn(1); // P2's turn — 50 not lowest → 6
  expect(p2.hand).toHaveLength(6);

  // Ties never trigger the bonus.
  const e2 = new BurnRateEngine({ rng: mulberry32(6) });
  e2.newGame(3);
  const [q0, , q2] = e2.state.players;
  for (const p of e2.state.players) p.hand = mkHand(staff('eng', 1));
  q0.cash = 50; q2.cash = 50;
  e2.endTurn(2); // P2 burns 2 → 48; P0 tied with P1 at 50 → no bonus
  expect(q0.hand).toHaveLength(6);
  expect(q0.wasStrictLowest).toBe(false);
});

test('restore() swaps in a deep-cloned saved state and stays playable', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const snapshot = createInitialState({ rng: mulberry32(9) });
  snapshot.players[1].hand = mkHand(vp('sales'));
  e.restore(snapshot);
  expect(e.state.players[1].hand[0].kind).toBe('vp');
  expect(e.state.players).not.toBe(snapshot.players); // deep clone
  // playable afterwards
  expect(e.hireCard(e.state.players[1].hand[0].id, 1).ok).toBe(true);
});

test('cancelPending() aborts a target selection without consuming the card', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(2);
  const p = e.state.players[0];
  p.hand = mkHand(action('poach'));
  e.state.players[1].company = [staff('mkt', 2)];
  const r = e.playAction(p.hand[0].id, 0);
  expect(r.status).toBe('awaitTarget');
  expect(e.state.pending?.kind).toBe('target');
  e.cancelPending();
  expect(e.state.pending).toBeNull();
  expect(p.hand).toHaveLength(1); // card kept
});

test('multi-foe audit/consultant await a target pick', () => {
  const e = new BurnRateEngine({ rng: mulberry32(5) });
  e.newGame(3);
  const p = e.state.players[0];
  p.hand = mkHand(action('audit'));
  const r = e.playAction(p.hand[0].id, 0);
  expect(r.status).toBe('awaitTarget');
  expect((r as { playerChoices: number[] }).playerChoices).toEqual([1, 2]);
  expect(e.selectTarget({ player: 2, zone: 'company', index: 0 }).ok).toBe(true);
  expect(e.state.players[2].auditThisTurn).toBe(true);
  expect(e.state.players[1].auditThisTurn).toBe(false);
});
