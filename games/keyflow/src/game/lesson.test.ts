import { describe, expect, it } from 'vitest';
import { LESSON_KEY_ORDER } from './constants';
import {
    analyzeKeys,
    computeAccuracy,
    computeLifetimeWpm,
    computeWpm,
    createRng,
    genLessonText,
    isMastered,
    keyAcc,
    keyClass,
    keyClassBreakdown,
    keyWpm,
    masteredSet,
    pickFocusKey,
    shouldAdvance,
    updateFrequency,
} from './lesson';
import type { KeyStats } from './types';

const stats = (over: Partial<KeyStats> = {}): KeyStats => ({
  attempts: 0,
  correct: 0,
  errors: 0,
  elapsedMs: 0,
  ...over,
});

describe('WPM/accuracy formulas', () => {
  it('computeWpm = (correct+errors-2*lines)/5/min', () => {
    // 50 chars, 2 lines, 1 min → (50-4)/5 = 9.2 → 9
    expect(computeWpm(50, 0, 2, 60000)).toBe(9);
    // 100 chars, 0 lines, 2 min → 10
    expect(computeWpm(100, 0, 0, 120000)).toBe(10);
  });

  it('computeWpm returns 0 when elapsed is zero or chars negative', () => {
    expect(computeWpm(50, 0, 0, 0)).toBe(0);
    expect(computeWpm(0, 0, 10, 60000)).toBe(0); // negative chars clamped
  });

  it('computeAccuracy = correct/(correct+errors)*100', () => {
    expect(computeAccuracy(8, 2)).toBe(80);
    expect(computeAccuracy(10, 0)).toBe(100);
    expect(computeAccuracy(0, 0)).toBe(100); // no keys → 100%
  });

  it('computeLifetimeWpm penalizes errors', () => {
    // 100 chars, 90 correct, 10 errors, 10 min → (100+90-20)/5/10 = 3.4 → 3
    expect(computeLifetimeWpm(100, 90, 10, 10)).toBe(3);
    expect(computeLifetimeWpm(100, 90, 10, 0)).toBe(0);
  });
});

describe('per-key stats', () => {
  it('keyAcc / keyWpm derive from KeyStats', () => {
    const s = stats({ correct: 8, errors: 2, elapsedMs: 60000 });
    expect(keyAcc(s)).toBe(80);
    expect(keyWpm(s)).toBe(2); // 8/5/1min = 1.6 → 2
  });

  it('isMastered requires attempts>=30, acc>=80, wpm>=15', () => {
    // 30 correct in 2 min = 3 WPM < 15 → not mastered
    const slow = stats({ attempts: 30, correct: 30, errors: 0, elapsedMs: 120000 });
    expect(isMastered(slow)).toBe(false);
    // 30 correct in 20s = 18 WPM ≥ 15 → mastered
    const fast = stats({ attempts: 30, correct: 30, errors: 0, elapsedMs: 20000 });
    expect(isMastered(fast)).toBe(true);
    const few = stats({ attempts: 29, correct: 29, errors: 0, elapsedMs: 20000 });
    expect(isMastered(few)).toBe(false); // 29 attempts < 30
    const lowAcc = stats({ attempts: 30, correct: 20, errors: 10, elapsedMs: 20000 });
    expect(isMastered(lowAcc)).toBe(false); // acc 67% < 80%
  });

  it('masteredSet builds from keyStats array', () => {
    const ks = LESSON_KEY_ORDER.split('').map((_, i) =>
      i === 0 ? stats({ attempts: 30, correct: 30, errors: 0, elapsedMs: 20000 }) : stats(),
    );
    const m = masteredSet(ks);
    expect(m.has('a')).toBe(true);
    expect(m.has('s')).toBe(false);
  });
});

describe('focus key & advancement (engine semantics)', () => {
  it('pickFocusKey prefers unmastered home keys', () => {
    const m = new Set(['a', 's', 'd']);
    const key = pickFocusKey(7, m); // lesson 1 keys: asdfjkl;
    expect(key).toBe('f'); // first unmastered home key
  });

  it('pickFocusKey falls back to first unmastered key', () => {
    const m = new Set(['a', 's', 'd', 'f', 'j', 'k', 'l', ';']);
    const key = pickFocusKey(10, m); // keys: asdfjkl;eit
    expect(key).toBe('e');
  });

  it('pickFocusKey returns null when all mastered', () => {
    const m = new Set('asdfjkl;eit'.split(''));
    expect(pickFocusKey(10, m)).toBeNull();
  });

  it('shouldAdvance when fewer than 4 keys unmastered', () => {
    const m = new Set('asdfjkl;'.split('')); // 8/8 mastered
    expect(shouldAdvance(7, m)).toBe(true);
    const m2 = new Set('asdfjkl'.split('')); // 7/8 mastered → 1 unmastered
    expect(shouldAdvance(7, m2)).toBe(true);
    const m3 = new Set('asdf'.split('')); // 4 unmastered → not yet
    expect(shouldAdvance(7, m3)).toBe(false);
  });
});

describe('frequency table (engine semantics)', () => {
  it('correct typing grows frequency slowly', () => {
    const freq = new Array(LESSON_KEY_ORDER.length).fill(0);
    updateFrequency(freq, 'a', true, 20);
    expect(freq[0]).toBe(1); // (0>>5)+0+1
    updateFrequency(freq, 'a', true, 20);
    expect(freq[0]).toBe(2);
  });

  it('errors boost frequency heavily', () => {
    const freq = new Array(LESSON_KEY_ORDER.length).fill(0);
    updateFrequency(freq, 'a', false, 20);
    // (2040/20)*3 = 306.6 → 306
    expect(freq[0]).toBeGreaterThan(300);
  });

  it('unknown keys are ignored', () => {
    const freq = new Array(LESSON_KEY_ORDER.length).fill(0);
    updateFrequency(freq, '~', false, 20);
    expect(freq.every(v => v === 0)).toBe(true);
  });
});

describe('lesson text generation', () => {
  it('generates only chars from the current key set', () => {
    const rng = createRng(42);
    const lines = genLessonText(7, 3, new Array(LESSON_KEY_ORDER.length).fill(0), { rng });
    const allowed = new Set('asdfjkl; ');
    for (const line of lines) {
      for (const ch of line) expect(allowed.has(ch)).toBe(true);
    }
  });

  it('returns the requested number of lines', () => {
    const rng = createRng(1);
    const lines = genLessonText(7, 5, new Array(LESSON_KEY_ORDER.length).fill(0), { rng });
    expect(lines.length).toBe(5);
  });

  it('is deterministic with a seeded rng', () => {
    const freq = new Array(LESSON_KEY_ORDER.length).fill(0);
    const a = genLessonText(7, 2, freq, { rng: createRng(7) });
    const b = genLessonText(7, 2, freq, { rng: createRng(7) });
    expect(a).toEqual(b);
  });

  it('uppercase mode produces uppercase letters', () => {
    const rng = createRng(3);
    const lines = genLessonText(20, 2, new Array(LESSON_KEY_ORDER.length).fill(0), { rng, uppercase: true });
    expect(/[A-Z]/.test(lines.join(''))).toBe(true);
  });

  it('keypad mode uses only keypad chars', () => {
    const rng = createRng(5);
    const lines = genLessonText(0, 2, new Array(LESSON_KEY_ORDER.length).fill(0), { rng, keypad: true });
    const allowed = new Set('4567891230.+ ');
    for (const line of lines) {
      for (const ch of line) expect(allowed.has(ch)).toBe(true);
    }
  });

  it('weighted generation favors high-frequency keys', () => {
    const rng = createRng(9);
    const freq = new Array(LESSON_KEY_ORDER.length).fill(0);
    freq[0] = 0xff; // 'a' heavily weighted
    const text = genLessonText(7, 10, freq, { rng }).join('');
    const countA = (text.match(/a/g) ?? []).length;
    const countS = (text.match(/s/g) ?? []).length;
    expect(countA).toBeGreaterThan(countS);
  });
});

describe('analyzeKeys (per-key WPM)', () => {
  it('ranks keys by per-key WPM', () => {
    const deltas = {
      a: { correct: 10, errors: 0 },
      s: { correct: 5, errors: 5 },
      d: { correct: 2, errors: 0 },
    };
    const { bestKeys, weakKeys, keysAbove } = analyzeKeys(deltas, 60000);
    expect(bestKeys).toContain('a');
    expect(weakKeys).toContain('s');
    expect(keysAbove).toBeGreaterThanOrEqual(0);
  });
});

describe('key class breakdown (progress report)', () => {
  it('classifies keys as letter/number/symbol', () => {
    expect(keyClass('a')).toBe('letter');
    expect(keyClass('5')).toBe('number');
    expect(keyClass(';')).toBe('symbol');
  });

  it('aggregates per-class average WPM and Keys Above N', () => {
    // 64 项 keyStats：a(letter) 快、5(number) 快、;(symbol) 慢
    const ks = LESSON_KEY_ORDER.split('').map((_, i) => stats());
    ks[0] = stats({ attempts: 30, correct: 30, errors: 0, elapsedMs: 20000 }); // a: 18 WPM
    ks[37] = stats({ attempts: 30, correct: 30, errors: 0, elapsedMs: 20000 }); // 4: 18 WPM
    ks[7] = stats({ attempts: 30, correct: 5, errors: 25, elapsedMs: 20000 }); // ;: 3 WPM
    const b = keyClassBreakdown(ks);
    expect(b.letter).toBe(18);
    expect(b.number).toBe(18);
    expect(b.symbol).toBe(3);
    expect(b.keysAbove).toBe(2);
  });
});
