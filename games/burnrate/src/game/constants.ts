// Core numeric tunables for Burn Rate.
//
// Centralised so tests / AI / UI all share one source of truth. Values follow
// `rules.md` unless noted otherwise.

import type { AiDifficulty, AiKind } from './types';

/** Starting venture funding for each company. */
export const START_CASH = 100;

/** Hand size each player refills to at the start of their turn (phase 1). */
export const HAND_SIZE = 6;

/** Total cards in the 156-card deck (16 VP + 40 staff + 40 project + 60 action). */
export const DECK_TOTAL = 156;

/** Uniform salary for every VP, regardless of department. */
export const VP_SALARY = 4;

/** Consultant salary is rolled in this inclusive range (rules.md: $3M-$5M). */
export const CONSULTANT_SALARY_MIN = 3;
export const CONSULTANT_SALARY_MAX = 5;

/** Minimum burn every company pays each round — fixed operating overhead.
 *  Kills the "0-burn immortal" endgame stall (the last survivor with an empty
 *  board could otherwise never go bankrupt). */
export const MIN_BURN = 2;

/** Extra per-round burn while exactly two players are alive ("market panic"):
 *  guarantees the endgame resolves in bounded time even between two turtles.
 *  ($2M measured: 4-player games land at mean ~11-12 rounds, the consensus
 *  pacing target; $3M cut the tail too hard.) */
export const DUEL_BURN_EXTRA = 2;

/** One-time emergency bailout on the first time cash hits ≤ 0: cash is reset
 *  to `BAILOUT_BASE + BAILOUT_PER_FIN_SKILL × finSkill` (finance staff
 *  negotiate a bigger round). */
export const BAILOUT_BASE = 10;
export const BAILOUT_PER_FIN_SKILL = 2;

/** Hand cap at the end of your turn (rules.md: no hard hand limit — this is
 *  the new house rule): discard down to this after the Fin-VP redraw. */
export const HAND_CAP = 8;

/** Cash valve: abandon your own bad project by paying 2 × its burn, no
 *  Engineering VP needed ("pay to stop the bleed"). */
export const ABANDON_BAD_MULTIPLIER = 2;

/** 画大饼 (overpromise) burnout: sacrifice your own engineers to clear a bad
 *  project. Required skill = ceil(origReq × discount); the discount shrinks by
 *  `BURNOUT_DISCOUNT_PER_FIN` per finance-skill point, floored at
 *  `BURNOUT_DISCOUNT_FLOOR`. */
export const BURNOUT_DISCOUNT_PER_FIN = 0.1;
export const BURNOUT_DISCOUNT_FLOOR = 0.5;

/** Reward multiplier for completing a project while its matching VP is on the
 *  board (Eng → tech, Sales → market), floored. Assignment itself has NO VP
 *  gate — the VP only adds bonuses. */
export const VP_REWARD_BONUS = 1.5;

/** Opening détente: the AI plays no attack cards (audit / bad-project /
 *  consultant / resign) during the first N rounds. Fixes the "first mover
 *  spends first → becomes the group's weakest → gets ganged" death spiral and
 *  the all-equal-cash tie-blast at round 1. Rules unchanged for the human.
 *  (4 rounds measured: first-mover win rate 18.8% → ~24-25%, game length
 *  mean 8 → ~11-12 rounds.) */
export const AI_NO_ATTACK_ROUNDS = 4;

/** Cap on the rotating battle log (UI keeps only the most recent entries). */
export const MAX_LOG = 50;

/** All action-card verbs. Kept in constants (next to deck counts) so the
 *  composition table and the action type stay in sync. */
export type ActionAct =
  | 'layoff'
  | 'poach'
  | 'consultant'
  | 'headhunter'
  | 'release'
  | 'audit'
  | 'resign';

// --- Deck composition counts (mirror rules.md §1) --------------------------

export const DECK_COUNTS = {
  vp: { hr: 4, fin: 4, sales: 4, eng: 4 }, // 16
  staff: { eng1: 8, eng2: 5, eng3: 3, mkt1: 5, mkt2: 3, mkt3: 2, hr1: 4, hr2: 3, fin1: 4, fin2: 3 }, // 40
  project: { tech: 20, bad: 12, market: 8 }, // 40
  action: { layoff: 12, poach: 10, consultant: 10, headhunter: 8, release: 8, audit: 6, resign: 6 }, // 60
} as const;

// --- Multiplayer & AI tuning ----------------------------------------------

/** Table size: 2-5 players (0 = human, the rest are AI). */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;

/**
 * Difficulty ladder → (algorithm kind, MCTS iteration budget per play
 * decision). `easy` = pure random, `normal` = the heuristic ladder, `hard` /
 * `expert` = MCTS with increasing budgets (othello-scale, kept modest because
 * a Burn Rate simulation is heavier than a board move).
 */
export const AI_LEVELS: Record<
  AiDifficulty,
  { kind: AiKind; budget: number }
> = {
  easy: { kind: 'random', budget: 0 },
  normal: { kind: 'heuristic', budget: 0 },
  hard: { kind: 'mcts', budget: 300 },
  expert: { kind: 'mcts', budget: 1200 },
};

/** MCTS rollout truncation: simulate this many *plays* past the decision
 *  point, then fall back to the heuristic evaluation. */
export const MCTS_ROLLOUT_DEPTH = 10;

/** UCB1 exploration constant. */
export const MCTS_EXPLORATION_C = 1.414;

/** Safety net per AI decision (wall clock); adapters should finish well under
 *  this via their iteration budget. */
export const AI_TIME_LIMIT_MS = 3000;
