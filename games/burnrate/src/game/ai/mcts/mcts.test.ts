// MCTS core tests: action-space enumeration, world sampling consistency,
// determinism under a fixed seed, and smoke-search legality.
import { expect, test } from 'vitest';
import { findBestAction, legalActions, sampleWorld } from '../../ai';
import { BurnRateEngine } from '../../engine';
import { mulberry32 } from '../../rng';
import { cloneState } from '../../state';
import type { AiAction, GameState, PlayerId } from '../../types';

function freshGame(playerCount = 2): GameState {
  const e = new BurnRateEngine({ rng: mulberry32(11) });
  e.newGame(playerCount);
  return e.state;
}

// ---- legalActions ---------------------------------------------------------

test('legalActions covers every playable kind and expands targets per foe', () => {
  const s = freshGame(3);
  const me = s.players[0];
  const { vp, staff, proj, action } = buildCards();
  me.hand = [vp('hr'), staff('eng', 2), proj('bad'), action('audit'), action('consultant'), action('poach')];
  s.players[1].company = [staff('mkt', 2), staff('mkt', 1)];
  s.players[2].company = [staff('eng', 3)];

  const moves = legalActions(s, 0);
  const kinds = new Set(moves.map((m) => m.kind));
  expect(kinds.has('hire')).toBe(true);
  expect(kinds.has('assignProject')).toBe(true);
  expect(kinds.has('audit')).toBe(true);
  expect(kinds.has('consultant')).toBe(true);
  expect(kinds.has('poach')).toBe(true);
  // target expansion: bad→2 foes, audit→2, consultant→2, poach→3 victims
  const audits = moves.filter((m) => m.kind === 'audit');
  expect(audits).toHaveLength(2);
  const poaches = moves.filter((m) => m.kind === 'poach');
  expect(poaches).toHaveLength(3);
  // hand's headhunter is NOT in the AI action space
  const others = moves.filter((m) => m.kind !== 'hire' && m.kind !== 'assignProject' && m.kind !== 'audit' && m.kind !== 'consultant' && m.kind !== 'poach');
  expect(others).toHaveLength(0);
});

test('legalActions: a foe HR VP is poachable (shield falls first)', () => {
  const s = freshGame(2);
  const me = s.players[0];
  const { action } = buildCards();
  me.hand = [action('poach')];
  const hr = makeVp('hr');
  s.players[1].company = [hr, makeStaff('eng', 2)];
  const actions = legalActions(s, 0);
  expect(actions).toHaveLength(1); // only the HR VP may be poached
  expect((actions[0] as { targetCardId: string }).targetCardId).toBe(hr.id);
});

// ---- sampleWorld ----------------------------------------------------------

test('sampleWorld keeps card counts and never duplicates ids', () => {
  const s = freshGame(3);
  const world = sampleWorld(s, mulberry32(3), 0);
  expect(world.players[1].hand).toHaveLength(s.players[1].hand.length);
  expect(world.players[2].hand).toHaveLength(s.players[2].hand.length);
  // The sampled deck loses exactly the cards re-dealt into hidden hands.
  const hidden = s.players[1].hand.length + s.players[2].hand.length;
  expect(world.deck).toHaveLength(s.deck.length - hidden);
  expect(world.players[0].hand.map((c) => c.id)).toEqual(s.players[0].hand.map((c) => c.id));

  const ids = new Set<string>();
  const all = [
    ...world.players.flatMap((p) => [...p.hand, ...p.company, ...p.projects]),
    ...world.deck,
    ...world.discard,
  ];
  for (const c of all) {
    expect(ids.has(c.id)).toBe(false);
    ids.add(c.id);
  }
});

test('sampleWorld does not mutate the source state', () => {
  const s = freshGame(3);
  const before = cloneState(s);
  sampleWorld(s, mulberry32(3), 0);
  expect(s).toEqual(before);
});

// ---- findBestAction -------------------------------------------------------

test('findBestAction is deterministic under a fixed seed', () => {
  const s = freshGame(2);
  const rng = mulberry32(1234);
  const a1 = findBestAction(s, 1, { iterations: 80, depth: 6, timeLimitMs: 2000 }, mulberry32(1234));
  const a2 = findBestAction(s, 1, { iterations: 80, depth: 6, timeLimitMs: 2000 }, mulberry32(1234));
  expect(a1).toEqual(a2);
  void rng;
});

test('findBestAction returns a legal action (or null on empty hand)', () => {
  const s = freshGame(2);
  const a = findBestAction(s, 1, { iterations: 60, depth: 6, timeLimitMs: 2000 }, mulberry32(7));
  if (a !== null) {
    expect(legalActions(s, 1).some((m) => JSON.stringify(m) === JSON.stringify(a))).toBe(true);
  }
  const empty = cloneState(s);
  empty.players[1].hand = [];
  expect(findBestAction(empty, 1, { iterations: 20, depth: 6, timeLimitMs: 1000 }, mulberry32(7))).toBeNull();
});

test('findBestAction works in a 4-player game', () => {
  const s = freshGame(4);
  const a = findBestAction(s, 2, { iterations: 60, depth: 6, timeLimitMs: 2000 }, mulberry32(9));
  if (a !== null) {
    expect(legalActions(s, 2).some((m) => JSON.stringify(m) === JSON.stringify(a))).toBe(true);
  }
});

// ---- helpers --------------------------------------------------------------

function buildCards() {
  let seq = 0;
  const id = () => 'm' + seq++;
  return {
    vp: (dept: 'hr' | 'fin' | 'sales' | 'eng') => ({ id: id(), name: dept, kind: 'vp' as const, dept, salary: 4, desc: '' }),
    staff: (role: 'eng' | 'mkt' | 'hr' | 'fin', skill: number) => ({ id: id(), name: role, kind: 'staff' as const, role, skill, salary: skill, desc: '' }),
    proj: (subtype: 'tech' | 'bad' | 'market') => ({ id: id(), name: subtype, kind: 'project' as const, subtype, target: (subtype === 'bad' ? 'enemy' : 'self') as 'self' | 'enemy', reqSkill: 2, burn: 2, reward: 4, desc: '' }),
    action: (act: 'audit' | 'consultant' | 'poach' | 'headhunter') => ({ id: id(), name: act, kind: 'action' as const, act, desc: '' }),
  };
}
function makeVp(dept: 'hr' | 'fin' | 'sales' | 'eng') {
  return { id: 'mv-' + dept, name: dept, kind: 'vp' as const, dept, salary: 4, desc: '' };
}
function makeStaff(role: 'eng' | 'mkt' | 'hr' | 'fin', skill: number) {
  return { id: 'ms-' + role + skill, name: role, kind: 'staff' as const, role, skill, salary: skill, desc: '' };
}

// silence unused-import warnings for type-only helpers
export type { AiAction, GameState, PlayerId };
