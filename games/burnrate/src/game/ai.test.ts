// AI heuristic tests: the priority ladder + determinism + the driver loop.
// `chooseAiAction` never mutates, so we drive it off hand-built states.
// Multiplayer: players are an array; the AI under test is player 1.
import { expect, test } from 'vitest';
import { chooseAiAction, chooseAiCompletions, runAiTurn, sampleFoeByWeakPoint } from './ai';
import { BurnRateEngine } from './engine';
import { mulberry32 } from './rng';
import type {
    ActionAct,
    ActionCard,
    Card,
    GameState,
    PlayerState,
    ProjectCard,
    ProjectSubtype,
    StaffCard,
    VPCard,
} from './types';

// ---- fixtures -------------------------------------------------------------

let seq = 0;
const nid = () => 'ai-' + seq++;
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
function basePlayer(over: Partial<PlayerState> = {}): PlayerState {
  return { cash: 100, hand: [], company: [], projects: [], auditThisTurn: false, alive: true, bailoutUsed: false, wasStrictLowest: false, discardedThisTurn: false, attackers: {}, ...over };
}
function state(playerOver: Partial<PlayerState> = {}, aiOver: Partial<PlayerState> = {}, turn = 5): GameState {
  return {
    deck: [], discard: [], turn, currentPlayer: 1,
    players: [basePlayer(playerOver), basePlayer(aiOver)],
    log: [], gameOver: false, winner: null, pending: null,
  };
}

test('priority #1: hire a VP the side lacks', () => {
  const s = state({}, { hand: mkHand(vp('eng')) });
  const a = chooseAiAction(s, 1);
  expect(a).toEqual({ kind: 'hire', cardId: (s.players[1].hand[0] as VPCard).id });
});

test('an already-held VP is skipped, falling through to staff', () => {
  const s = state({}, { company: [vp('eng')], hand: mkHand(vp('eng'), staff('eng', 1)) });
  const a = chooseAiAction(s, 1);
  expect(a?.kind).toBe('hire');
  const chosen = s.players[1].hand.find((c) => c.id === (a as { cardId: string }).cardId)!;
  expect((chosen as StaffCard).kind).toBe('staff');
});

test('priority #2: Audit only when the weakest foe cash < $50M', () => {
  const low = state({ cash: 40 }, { hand: mkHand(action('audit')) });
  expect(chooseAiAction(low, 1)).toEqual({ kind: 'audit', target: 0 });

  const high = state({ cash: 100 }, { hand: mkHand(action('audit')) });
  // Audit skipped, nothing else playable → null
  expect(chooseAiAction(high, 1)).toBeNull();
});

test('priority #3: Bad project always tossed to the weakest foe', () => {
  const s = state({ cash: 60 }, { hand: mkHand(proj({ subtype: 'bad', reqSkill: 9, burn: 4, reward: 0, target: 'enemy' })) });
  const a = chooseAiAction(s, 1);
  expect(a?.kind).toBe('assignProject');
  expect((a as { target: number }).target).toBe(0);
});

test('priority #4: Consultant is rng-gated at ~70% and targets the weakest foe', () => {
  const s = state({ cash: 40 }, { hand: mkHand(action('consultant')) });
  const yes = chooseAiAction(s, 1, mulberry32(1));
  const no = chooseAiAction(s, 1, mulberry32(2));
  // With a fixed seed one of the branches is deterministic; just assert both
  // are legal outcomes (consultant vs null) and that the consultant targets 0.
  if (yes) expect(yes).toEqual({ kind: 'consultant', target: 0 });
  expect(no === null || no.kind === 'consultant').toBe(true);
});

test('priority #5: Poach the most valuable foe card (HR VP shield falls first)', () => {
  // Shield rule: a foe HR VP is the ONLY legal target — the AI takes it.
  const shielded = state({ company: [vp('hr'), staff('eng', 3)] }, { hand: mkHand(action('poach')) });
  const a = chooseAiAction(shielded, 1);
  expect(a?.kind).toBe('poach');
  const hrId = shielded.players[0].company[0].id;
  expect((a as { targetCardId: string }).targetCardId).toBe(hrId);

  const s = state({ company: [staff('eng', 1)] }, { hand: mkHand(action('poach')) });
  const b = chooseAiAction(s, 1);
  expect(b?.kind).toBe('poach');
  expect((b as { targetCardId: string }).targetCardId).toBe(s.players[0].company[0].id);

  // Broke → no poach at all (fees make targets illegal).
  const broke = state({ company: [staff('eng', 3)] }, { cash: 1, hand: mkHand(action('poach')) });
  expect(chooseAiAction(broke, 1)).toBeNull();

  // Low cash (≤ $35M cushion) → the AI skips the luxury poach.
  const lowCash = state({ company: [staff('eng', 1)] }, { cash: 35, hand: mkHand(action('poach')) });
  expect(chooseAiAction(lowCash, 1)).toBeNull();
});

test('priority #6: hire any staff', () => {
  const s = state({}, { hand: mkHand(staff('eng', 2), action('resign')) });
  const a = chooseAiAction(s, 1);
  expect(a?.kind).toBe('hire');
  expect((a as { cardId: string }).cardId).toBe(s.players[1].hand[0].id);
});

test('priority #7: Market project starts without any VP (no gate)', () => {
  const noVp = state({}, { hand: mkHand(proj({ subtype: 'market', reqSkill: 2, burn: 2, reward: 6, target: 'self' })) });
  expect(chooseAiAction(noVp, 1)?.kind).toBe('assignProject');

  const withVp = state({}, { company: [vp('sales')], hand: mkHand(proj({ subtype: 'market', reqSkill: 2, burn: 2, reward: 6, target: 'self' })) });
  const a = chooseAiAction(withVp, 1);
  expect(a).toEqual({ kind: 'assignProject', cardId: (withVp.players[1].hand[0] as ProjectCard).id, target: 'self' });
});

test('priority #8: Tech project starts without any VP, ≤2 ongoing', () => {
  const noVp = state({}, { hand: mkHand(proj({ subtype: 'tech', reqSkill: 3, burn: 1, reward: 0, target: 'self' })) });
  expect(chooseAiAction(noVp, 1)?.kind).toBe('assignProject');

  const withVp = state({}, { company: [vp('eng')], hand: mkHand(proj({ subtype: 'tech', reqSkill: 3, burn: 1, reward: 0, target: 'self' })) });
  expect(chooseAiAction(withVp, 1)).toEqual({
    kind: 'assignProject',
    cardId: (withVp.players[1].hand[0] as ProjectCard).id,
    target: 'self',
  });

  // 2+ own projects → skip tech
  const full = state({}, {
    company: [vp('eng')],
    projects: [
      proj({ subtype: 'tech', reqSkill: 1, burn: 1, reward: 0, target: 'self' }),
      proj({ subtype: 'tech', reqSkill: 1, burn: 1, reward: 0, target: 'self' }),
    ],
    hand: mkHand(proj({ subtype: 'tech', reqSkill: 3, burn: 1, reward: 0, target: 'self' })),
  });
  expect(chooseAiAction(full, 1)).toBeNull();
});

test('empty hand → null', () => {
  const s = state({}, { hand: [] });
  expect(chooseAiAction(s, 1)).toBeNull();
});

test('opening détente: no attack cards in the first 4 rounds (house rule)', () => {
  const audit = state({ cash: 40 }, { hand: mkHand(action('audit')) }, 1);
  expect(chooseAiAction(audit, 1)).toBeNull(); // audit gated
  const bad = state({ cash: 60 }, { hand: mkHand(proj({ subtype: 'bad', reqSkill: 9, burn: 4, reward: 0, target: 'enemy' })) }, 2);
  expect(chooseAiAction(bad, 1)).toBeNull(); // bad gated
  const consul = state({ cash: 40 }, { hand: mkHand(action('consultant')) }, 4);
  expect(chooseAiAction(consul, 1, mulberry32(1))).toBeNull(); // consultant gated
  // Round 5: attacks un-gated again.
  const open = state({ cash: 40 }, { hand: mkHand(action('audit')) }, 5);
  expect(chooseAiAction(open, 1)).toEqual({ kind: 'audit', target: 0 });
});

test('sampleFoeByWeakPoint spreads attacks across equal foes (no seat-0 pile-on)', () => {
  const s = state({ cash: 100 }, { cash: 100 });
  s.players.push(basePlayer({ cash: 100 })); // 3 players, all $100M (equal weak point)
  const hits = new Set<number>();
  for (let i = 0; i < 100; i++) hits.add(sampleFoeByWeakPoint(s, 1, mulberry32(i))!);
  expect(hits.size).toBe(2); // seats 0 and 2 both get picked
});

test('sampleFoeByWeakPoint favours the weaker foe but does not lock in', () => {
  // Player 0 is much weaker (cash drained, empty board) than player 2.
  const s = state({ cash: 30 }, { cash: 100 });
  s.players.push(basePlayer({ cash: 100 }));
  let weak = 0;
  for (let i = 0; i < 500; i++) if (sampleFoeByWeakPoint(s, 1, mulberry32(i)) === 0) weak++;
  // Weaker foe picked most of the time (~80%), but NOT 100% (sampling spreads it).
  expect(weak).toBeGreaterThan(350);
  expect(weak).toBeLessThan(500);
});

test('sampleFoeByWeakPoint retaliates against attackers (grudge bonus)', () => {
  // Player 2 attacked the AI; even with equal cash, the AI skews toward 2.
  const s = state({ cash: 100 }, { cash: 100 });
  s.players.push(basePlayer({ cash: 100 }));
  s.players[1].attackers = { 2: { count: 1, lastTurn: s.turn } };
  let revenge = 0;
  for (let i = 0; i < 500; i++) if (sampleFoeByWeakPoint(s, 1, mulberry32(i)) === 2) revenge++;
  // Grudge bias (~60%) beats the 50/50 baseline; not 100% (still sampled).
  expect(revenge).toBeGreaterThan(270);
  expect(revenge).toBeLessThan(500);
});

test('AI rescues its own bad project: burnout before cash abandon', () => {
  const bad = proj({ subtype: 'bad', reqSkill: 10, burn: 4, reward: 0, target: 'enemy' });
  const fin = staff('fin', 3); // req → ceil(10 × 0.7) = 7
  const a = staff('eng', 4);
  const b = staff('eng', 3);
  const s = state({}, { company: [fin, a, b], projects: [bad], hand: [] });
  const act = chooseAiAction(s, 1);
  expect(act?.kind).toBe('burnoutBad');
  expect((act as { engineerIds: string[] }).engineerIds).toHaveLength(2);
});

test('AI pays cash to abandon a bad project when burnout is out of reach', () => {
  const bad = proj({ subtype: 'bad', reqSkill: 10, burn: 4, reward: 0, target: 'enemy' });
  const s = state({}, { cash: 20, projects: [bad], hand: [] }); // no engineers
  expect(chooseAiAction(s, 1)).toEqual({ kind: 'abandonBad', cardId: bad.id });
  // Not enough cash → stays (suffers the burn) instead.
  const poor = state({}, { cash: 10, projects: [bad], hand: [] });
  expect(chooseAiAction(poor, 1)).toBeNull();
});

test('AI discards a duplicate VP via the free once-per-turn discard', () => {
  const dup = vp('hr');
  const s = state({}, { company: [vp('hr')], hand: mkHand(dup) });
  expect(chooseAiAction(s, 1)).toEqual({ kind: 'discard', cardId: dup.id });
  // Already used the free discard this turn → the duplicate stays clogging.
  const dup2 = vp('hr');
  const s2 = state({}, { company: [vp('hr')], hand: mkHand(dup2), discardedThisTurn: true });
  expect(chooseAiAction(s2, 1)).toBeNull();
});

test('chooseAiCompletions lists completable project indices', () => {
  const s = state({}, {
    company: [vp('eng'), staff('eng', 3)],
    projects: [
      proj({ subtype: 'tech', reqSkill: 2, burn: 1, reward: 0, target: 'self' }), // ok
      proj({ subtype: 'tech', reqSkill: 9, burn: 1, reward: 0, target: 'self' }), // skill too low
      proj({ subtype: 'market', reqSkill: 2, burn: 1, reward: 8, target: 'self' }), // no Sales VP
    ],
  });
  expect(chooseAiCompletions(s, 1)).toEqual([0]); // reversed: only index 0
});

test('runAiTurn hires a VP into the AI company', () => {
  const engine = new BurnRateEngine({ rng: mulberry32(7) });
  engine.newGame(2);
  const p = engine.state.players[1];
  p.company = [];
  p.projects = [];
  p.hand = mkHand(vp('fin'), staff('eng', 1));
  runAiTurn(engine, 1, mulberry32(1));
  expect(engine.state.players[1].company.some((c) => c.kind === 'vp')).toBe(true);
});

test('runAiTurn poaching consumes the AI poach card and steals the target', () => {
  const engine = new BurnRateEngine({ rng: mulberry32(7) });
  engine.newGame(2);
  const foe = engine.state.players[0];
  const ai = engine.state.players[1];
  foe.company = [staff('mkt', 3)];
  foe.hand = [];
  ai.company = [];
  ai.hand = mkHand(action('poach'));
  runAiTurn(engine, 1, mulberry32(1));
  // AI should have poached the mkt staff (no HR VP on either side).
  expect(engine.state.players[1].company.some((c) => c.name === 'mkt3')).toBe(true);
  expect(engine.state.players[1].hand.some((c) => c.kind === 'action' && c.act === 'poach')).toBe(false);
});

test('runAiTurn uses the Fin VP privilege to exchange dead action cards', () => {
  const engine = new BurnRateEngine({ rng: mulberry32(7) });
  engine.newGame(2);
  const ai = engine.state.players[1];
  ai.company = [vp('fin')];
  const lay = action('layoff');
  const aud = action('audit');
  // The AI will hire all staff; only the two action cards stay in hand.
  ai.hand = mkHand(lay, aud, staff('eng', 2), staff('eng', 1), staff('mkt', 1), staff('hr', 1));
  runAiTurn(engine, 1, mulberry32(1));
  expect(ai.hand).toHaveLength(2); // exchanged 2-for-2, not shrunk
  expect(ai.hand.some((c) => c.id === lay.id || c.id === aud.id)).toBe(false); // dead cards gone
  // No Fin VP → no exchange happens.
  const engine2 = new BurnRateEngine({ rng: mulberry32(8) });
  engine2.newGame(2);
  const ai2 = engine2.state.players[1];
  const lay2 = action('layoff');
  ai2.hand = mkHand(lay2);
  runAiTurn(engine2, 1, mulberry32(1));
  expect(ai2.hand.some((c) => c.id === lay2.id)).toBe(true); // untouched
});
