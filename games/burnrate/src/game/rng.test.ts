// Smoke test for the seeded PRNG — also validates the vitest+TS toolchain.
import { expect, test } from 'vitest';
import { mulberry32 } from './rng';

test('mulberry32 is deterministic for a fixed seed', () => {
  const a = mulberry32(12345);
  const b = mulberry32(12345);
  const seqA = Array.from({ length: 5 }, a);
  const seqB = Array.from({ length: 5 }, b);
  expect(seqA).toEqual(seqB);
  seqA.forEach((v) => expect(v).toBeGreaterThanOrEqual(0).and.toBeLessThan(1));
});

test('different seeds diverge', () => {
  const a = mulberry32(1)();
  const b = mulberry32(2)();
  expect(a).not.toBe(b);
});
