// Discriminated-union card model + game state for Burn Rate (multiplayer).
//
// Everything here is plain, serialisable data — no functions, no DOM. The pure
// rule functions (`rules.ts`) and the `BurnRateEngine` controller operate on
// `GameState`; the UI layer only reads/writes these shapes.
//
// Multiplayer model: `players` is an array indexed by `PlayerId` (0 = the
// human, 1..n-1 = AI). `currentPlayer`/`winner` are indices into it.

import type { ActionAct } from './constants';

/** Source of randomness. Injecting it (e.g. a seeded `mulberry32`) makes the
 *  whole engine deterministic and unit-testable. */
export type Rng = () => number;

export type Dept = 'hr' | 'fin' | 'sales' | 'eng';
export type Role = 'eng' | 'mkt' | 'hr' | 'fin';
export type ProjectSubtype = 'tech' | 'bad' | 'market';

/** Player identity: index into `GameState.players`. 0 = the human; the rest
 *  are AI slots. */
export type PlayerId = number;

// ---- Opening dice roll (who moves first) ---------------------------------

/** One round of the opening dice roll. `players` are the participants of this
 *  round (everyone initially, only the tied leaders afterwards); `values` are
 *  their face-up d6 results, aligned by index. */
export interface DiceRound {
  players: PlayerId[];
  values: number[];
}

/** Full outcome of the opening dice roll, including every tie re-roll round.
 *  The winner (sole highest of the final round) goes first. Produced by the
 *  engine with the injected RNG so the UI can play the animation out to a
 *  known result. */
export interface DiceRollOutcome {
  winner: PlayerId;
  rounds: DiceRound[];
}

// `ActionAct` lives in constants.ts so the deck composition and the action
// type stay in sync; re-exported here for ergonomic single-import usage.

// ---- Card discriminated union --------------------------------------------

export interface BaseCard {
  id: string;
  name: string;
}

export interface VPCard extends BaseCard {
  kind: 'vp';
  dept: Dept;
  salary: number;
  desc: string;
}

export interface StaffCard extends BaseCard {
  kind: 'staff';
  role: Role;
  skill: number;
  salary: number;
  desc: string;
}

export interface ProjectCard extends BaseCard {
  kind: 'project';
  subtype: ProjectSubtype;
  /** Whose project area this card is legally assigned to. 'enemy' means "an
   *  opponent" — the concrete target player is chosen at play time. */
  target: 'self' | 'enemy';
  /** Total skill required to complete it. */
  reqSkill: number;
  /** Cash burned per round while it sits unfinished. */
  burn: number;
  /** One-shot cash reward on completion (projects with no reward use 0). */
  reward: number;
  desc: string;
}

export interface ActionCard extends BaseCard {
  kind: 'action';
  act: ActionAct;
  desc: string;
}

/** Runtime-generated parasite card created by the Consultant action. Never
 *  printed in the deck; only ever lives in a player's `company`. */
export interface ConsultantCard extends BaseCard {
  kind: 'consultant';
  salary: number;
  desc: string;
}

export type Card = VPCard | StaffCard | ProjectCard | ActionCard | ConsultantCard;

// ---- Player & game state --------------------------------------------------

/** One entry in a player's revenge ledger: how many times an attacker hit
 *  them, and on which turn (for exponential decay on read). */
export interface AttackerRecord {
  count: number;
  lastTurn: number;
}

export interface PlayerState {
  cash: number;
  hand: Card[];
  /** Board area holding hired VPs, staff and parasites (consultants). */
  company: Card[];
  projects: ProjectCard[];
  /** Set by an opponent's Audit; doubles salary burn this round unless the
   *  player owns a Finance VP. Reset after their burn is settled. */
  auditThisTurn: boolean;
  /** False once this player goes bankrupt; they are skipped for the rest of
   *  the game. The last player standing wins. */
  alive: boolean;
  /** One-time emergency bailout already used (cash ≤ 0 refunded once to
   *  `BAILOUT_BASE + 2×finSkill`). */
  bailoutUsed: boolean;
  /** Was ever the strictly-lowest cash among alive players (achievement
   *  tracking + comeback telemetry). */
  wasStrictLowest: boolean;
  /** True once this player used their one free hand-discard this turn
   *  (house rule: 1 discard per turn, no compensation). Reset at their
   *  next turn start. */
  discardedThisTurn: boolean;
  /** Revenge ledger: per-attacker {count, lastTurn}. Drives the AI's
   *  grudge bonus so it retaliates against players who attacked it,
   *  instead of piling on the weakest seat. `count` is stored already
   *  decayed to `lastTurn`; reads apply further decay for elapsed rounds. */
  attackers: Record<PlayerId, AttackerRecord>;
}

export type LogType = 'info' | 'good' | 'attack';
export interface LogEntry {
  msg: string;
  type: LogType;
}

export interface GameState {
  deck: Card[];
  discard: Card[];
  turn: number;
  currentPlayer: PlayerId;
  players: PlayerState[];
  log: LogEntry[];
  gameOver: boolean;
  winner: PlayerId | null;
  /** Non-null while a player is mid-resolution of a card that needs a choice
   *  (target selection or headhunter pick). Null once resolved. */
  pending: PendingRequest | null;
}

// ---- Target selection (poach / resign / layoff / release / bad-project) ---

export interface TargetRef {
  player: PlayerId;
  zone: 'company' | 'projects';
  index: number;
}

export interface PendingTarget {
  kind: 'target';
  /** Action being resolved. 'assignBad' = choosing who receives a bad project;
   *  'audit'/'consultant' = choosing who gets hit. 'layoffFeud' = the "high
   *  exec feud" layoff mode (pick 1 VP + 1 consultant, no HR VP needed). */
  act: 'layoff' | 'layoffFeud' | 'poach' | 'resign' | 'release' | 'assignBad' | 'audit' | 'consultant';
  actor: PlayerId;
  /** The action card in hand awaiting consumption (null for assignBad —
   *  projects are consumed directly). */
  cardId: string | null;
  targets: TargetRef[];
  /** How many targets must be picked before the action resolves. Layoff's
   *  bulk pick = 1 + HR skill; everything else picks exactly 1. */
  pickCount?: number;
  /** For player-choosing actions ('assignBad'/'audit'/'consultant'): the
   *  candidate opponent ids, in the same order as `targets`. */
  playerChoices?: PlayerId[];
}

/** One selectable headhunter category: a VP department or a staff role. */
export interface HeadhunterChoice {
  /** 'vp:<dept>' or 'staff:<role>'. */
  key: string;
  /** Display label, e.g. "HR 副总裁" / "工程师员工". */
  label: string;
  /** Cards of this category remaining in deck + discard (0 = unavailable). */
  available: number;
}

export interface PendingHeadhunter {
  kind: 'headhunter';
  actor: PlayerId;
  /** The headhunter action card in hand awaiting consumption. */
  cardId: string;
  /** The 8 categories the actor may search (deck first, then discard). */
  choices: HeadhunterChoice[];
}

export type PendingRequest = PendingTarget | PendingHeadhunter;

// ---- Player-facing action result -----------------------------------------

export type ActionResult =
  | { status: 'done' }
  | {
      status: 'awaitTarget';
      act: PendingTarget['act'];
      targets: TargetRef[];
      playerChoices?: PlayerId[];
      pickCount?: number;
    }
  | { status: 'awaitPick'; choices: HeadhunterChoice[] }
  | { status: 'invalid'; reason: string };

// ---- AI decisions (pure, no mutation) ------------------------------------

/** A single AI-decided play. `target` is the opponent `PlayerId` for the
 *  targeting actions; `assignProject.target` is 'self' for tech/market or the
 *  opponent id for bad projects. */
export type AiAction =
  | { kind: 'hire'; cardId: string }
  | { kind: 'assignProject'; cardId: string; target: 'self' | PlayerId }
  | { kind: 'audit'; target: PlayerId }
  | { kind: 'consultant'; target: PlayerId }
  | { kind: 'poach'; targetCardId: string }
  /** Pay 2×burn to abandon one of your own bad projects (cash valve). */
  | { kind: 'abandonBad'; cardId: string }
  /** 画大饼: sacrifice the listed engineers to clear a bad project. */
  | { kind: 'burnoutBad'; cardId: string; engineerIds: string[] }
  /** Free hand discard (house rule: once per turn, no compensation). */
  | { kind: 'discard'; cardId: string };

export interface TurnResult {
  /** True if the acting player went bankrupt this turn. */
  bankrupt: boolean;
  winner: PlayerId | null;
  nextPlayer: PlayerId;
}

// ---- AI adapter contract (strategy abstraction) ---------------------------

export type AiKind = 'random' | 'heuristic' | 'mcts';

/** Player-facing difficulty ladder; maps onto (algorithm, budget). */
export type AiDifficulty = 'easy' | 'normal' | 'hard' | 'expert';

/** Per-decision context handed to an AI adapter. `rng` must be the *engine's*
 *  injected rng (or a deterministic stand-in) so MCTS sampling / consultant
 *  rolls stay reproducible. */
export interface AiContext {
  rng: Rng;
  /** MCTS iteration budget for the current decision (ignored by others). */
  budget: number;
  /** Soft wall-clock cap per decision, safety net only. */
  timeLimitMs: number;
}

/**
 * Strategy abstraction over the AI decision loop. Adapters are pure: they only
 * *inspect* state and return an action; the engine applies it via
 * `applyAiAction`. `chooseCompletions` is optional (heuristic keeps its greedy
 * completion pass; MCTS delegates to the same greedy pass).
 */
export interface AiAdapter {
  readonly kind: AiKind;
  readonly difficulty: AiDifficulty;
  /** Next play for `player`, or null when nothing is worth doing. */
  chooseAction(state: GameState, player: PlayerId, ctx: AiContext): AiAction | null;
  /** Board indices of `player`'s completable projects, high→low (default:
   *  greedy pass shared by all adapters). */
  chooseCompletions?(state: GameState, player: PlayerId): number[];
}
