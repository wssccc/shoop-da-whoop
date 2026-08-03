// Deck construction tests. Covers rules.md §1 composition + the bug-fix #5
// (deck randomness is rng-injected, hence fully reproducible).
import { expect, test } from 'vitest';
import { buildDeck } from './cards';
import { DECK_COUNTS, VP_SALARY } from './constants';
import { mulberry32 } from './rng';
import type { Card } from './types';

function classify(deck: Card[]) {
  const t = {
    vp: 0, staff: 0, project: 0, action: 0,
    dept: { hr: 0, fin: 0, sales: 0, eng: 0 } as Record<string, number>,
    tech: 0, bad: 0, market: 0,
    act: {
      layoff: 0, poach: 0, consultant: 0, headhunter: 0, release: 0, audit: 0, resign: 0,
    } as Record<string, number>,
  };
  for (const c of deck) {
    if (c.kind === 'vp') { t.vp++; t.dept[c.dept]++; expect(c.salary).toBe(VP_SALARY); }
    else if (c.kind === 'staff') t.staff++;
    else if (c.kind === 'action') {
      t.action++;
      t.act[c.act]++;
    }
    else if (c.kind === 'project') {
      t.project++;
      if (c.subtype === 'tech') t.tech++;
      else if (c.subtype === 'bad') t.bad++;
      else t.market++;
    }
  }
  return t;
}

test('buildDeck produces exactly 156 cards across the rules.md composition', () => {
  const deck = buildDeck();
  expect(deck.length).toBe(156);
  const t = classify(deck);
  expect(t.vp).toBe(16);
  expect(t.staff).toBe(40);
  expect(t.project).toBe(40);
  expect(t.action).toBe(60);
  expect(t.dept).toEqual({ hr: 4, fin: 4, sales: 4, eng: 4 });
  expect(t.tech).toBe(DECK_COUNTS.project.tech); // 20
  expect(t.bad).toBe(DECK_COUNTS.project.bad); // 12
  expect(t.market).toBe(DECK_COUNTS.project.market); // 8
  expect(t.act).toEqual({
    layoff: 12, poach: 10, consultant: 10, headhunter: 8, release: 8, audit: 6, resign: 6,
  });
});

test('every card id is unique within a built deck', () => {
  const deck = buildDeck();
  const ids = deck.map((c) => c.id);
  expect(new Set(ids).size).toBe(deck.length);
});

test('engineer skill distribution matches rules.md (8/5/3/...)', () => {
  const deck = buildDeck();
  const eng = deck.filter((c): c is Extract<Card, { kind: 'staff' }> =>
    c.kind === 'staff' && c.role === 'eng');
  const bySkill = (s: number) => eng.filter((c) => c.skill === s).length;
  expect(bySkill(1)).toBe(8);
  expect(bySkill(2)).toBe(5);
  expect(bySkill(3)).toBe(3);
});

test('project stat rolls stay inside rules.md ranges', () => {
  const deck = buildDeck();
  for (const c of deck) {
    if (c.kind !== 'project') continue;
    if (c.subtype === 'tech') {
      expect(c.reqSkill).toBeGreaterThanOrEqual(2);
      expect(c.reqSkill).toBeLessThanOrEqual(6);
      expect(c.burn).toBeGreaterThanOrEqual(1);
      expect(c.burn).toBeLessThanOrEqual(3);
      expect(c.target).toBe('self');
    } else if (c.subtype === 'bad') {
      expect(c.reqSkill).toBeGreaterThanOrEqual(8);
      expect(c.reqSkill).toBeLessThanOrEqual(10);
      expect(c.burn).toBeGreaterThanOrEqual(3);
      expect(c.burn).toBeLessThanOrEqual(6);
      expect(c.reward).toBe(0);
      expect(c.target).toBe('enemy');
    } else {
      expect(c.reqSkill).toBeGreaterThanOrEqual(2);
      expect(c.reqSkill).toBeLessThanOrEqual(4);
      expect(c.reward).toBeGreaterThanOrEqual(5);
      expect(c.reward).toBeLessThanOrEqual(15);
      expect(c.burn).toBeGreaterThanOrEqual(1);
      expect(c.burn).toBeLessThanOrEqual(2); // market burns $1M-$2M (rules.md §1.3)
      expect(c.target).toBe('self');
    }
  }
});

test('buildDeck is deterministic for a fixed rng seed', () => {
  const snapshot = (deck: Card[]) =>
    deck.map((c) => ({ id: c.id, kind: c.kind, ...(c as Record<string, unknown>) }));
  const a = snapshot(buildDeck({ rng: mulberry32(7) }));
  const b = snapshot(buildDeck({ rng: mulberry32(7) }));
  expect(a).toEqual(b);
});

test('different seeds (usually) diverge', () => {
  const a = buildDeck({ rng: mulberry32(1) }).map((c) => c.id).join(',');
  const b = buildDeck({ rng: mulberry32(999) }).map((c) => c.id).join(',');
  expect(a).not.toEqual(b);
});
