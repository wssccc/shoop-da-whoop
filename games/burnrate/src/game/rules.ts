// Pure rule functions: no mutation, no DOM, single-argument over `GameState`.
//
// These are the tests' primary targets — every legality/valuation question
// ("can I play this?", "what's my burn?", "who can I poach?") lives here. The
// engine delegates to them so UI, AI and tests all agree on one rulebook.
//
// Multiplayer: players are indexed `PlayerId`s (0 = human). "Opponents" means
// all *alive* players except `player`.
//
// Rulebook baseline: `rules.md`. Several old-prototype bugs are corrected here:
//   * calcBurn composes salary×audit-malus + project burn correctly.
//   * isConsultant is a real runtime card kind, not a stray boolean.
//   * target legality (poach/resign) honours HR-VP protection per rules.md.
//   * layoff/release honour their VP prerequisites per rules.md (not the impl's
//     looser ad-hoc conditions).

import type { ActionAct } from './constants';
import {
    ABANDON_BAD_MULTIPLIER,
    BAILOUT_BASE,
    BAILOUT_PER_FIN_SKILL,
    BURNOUT_DISCOUNT_FLOOR,
    BURNOUT_DISCOUNT_PER_FIN,
    DUEL_BURN_EXTRA,
    HAND_SIZE,
    MIN_BURN,
    VP_REWARD_BONUS,
} from './constants';
import type {
    Card,
    Dept,
    GameState,
    PlayerId,
    PlayerState,
    ProjectCard,
    Role,
    StaffCard,
    TargetRef,
} from './types';

/** All alive players except `player`. */
export function opponents(state: GameState, player: PlayerId): PlayerId[] {
  return state.players
    .map((_, id) => id)
    .filter((id) => id !== player && state.players[id].alive);
}

/** True if exactly one opponent remains (the old 1v1 situation). */
export function singleOpponent(state: GameState, player: PlayerId): PlayerId | null {
  const foes = opponents(state, player);
  return foes.length === 1 ? foes[0] : null;
}

/** Next alive player in round-robin order after `player` (wrapping). */
export function nextAlive(state: GameState, player: PlayerId): PlayerId {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const id = (player + step) % n;
    if (state.players[id].alive) return id;
  }
  return player; // no one else alive — caller should have ended the game
}

/** True if only one player is still alive. */
export function lastStanding(state: GameState): PlayerId | null {
  const alive = state.players
    .map((p, id) => (p.alive ? id : -1))
    .filter((id) => id >= 0);
  return alive.length === 1 ? alive[0] : null;
}

// ---- Board queries --------------------------------------------------------

/** True if `player` currently has the VP of `dept` on their board. */
export function hasVP(state: GameState, player: PlayerId, dept: Dept): boolean {
  return playerOf(state, player).company.some((c) => c.kind === 'vp' && c.dept === dept);
}

/** Sum of all `role` skill levels among `player`'s staff. */
export function getSkill(state: GameState, player: PlayerId, role: Role): number {
  return playerOf(state, player).company
    .filter((c): c is StaffCard => c.kind === 'staff' && c.role === role)
    .reduce((sum, c) => sum + c.skill, 0);
}

/** Total salary outlay: VPs ($4 each) + staff. Doubled under Audit unless the
 *  player owns a Finance VP (rules.md §3 phase 3). Consultants are excluded —
 *  they are a separate "hidden overhead" line (rules.md §1.4 Audit). */
export function getSalaryOutlay(state: GameState, player: PlayerId): number {
  return playerOf(state, player).company.reduce(
    (sum, c) => sum + (c.kind === 'vp' || c.kind === 'staff' ? c.salary : 0),
    0,
  );
}

/** Total consultant salaries — the "hidden overhead" line that Audit does NOT
 *  double but Finance staff skill offsets (rules.md §1.2). */
export function getConsultantOutlay(state: GameState, player: PlayerId): number {
  return playerOf(state, player).company.reduce(
    (sum, c) => sum + (c.kind === 'consultant' ? c.salary : 0),
    0,
  );
}

/** Per-project burn: with the Engineering VP on the board, tech projects burn
 *  at half rate (floored, min $1M) — the VP's "special skill". Bad projects
 *  (foe attacks) never get the discount. */
export function projectBurnOf(state: GameState, player: PlayerId, proj: ProjectCard): number {
  if (proj.subtype === 'tech' && hasVP(state, player, 'eng')) {
    return Math.max(1, Math.floor(proj.burn / 2));
  }
  return proj.burn;
}

export function getProjectBurn(state: GameState, player: PlayerId): number {
  return playerOf(state, player).projects.reduce(
    (sum, p) => sum + projectBurnOf(state, player, p),
    0,
  );
}

/** Completion reward with the matching-VP bonus (+50%, floored): Engineering
 *  VP boosts tech projects, Sales VP boosts market projects. Bad projects pay
 *  nothing either way. */
export function projectReward(state: GameState, player: PlayerId, proj: ProjectCard): number {
  const matched =
    (proj.subtype === 'tech' && hasVP(state, player, 'eng')) ||
    (proj.subtype === 'market' && hasVP(state, player, 'sales'));
  return matched ? Math.floor(proj.reward * VP_REWARD_BONUS) : proj.reward;
}

/** Burn split into the lines shown in the UI: `salary` (VP+staff, doubled
 *  under Audit without a Finance VP), `ops` (unfinished projects +
 *  consultants, offset by Finance staff skill, floored at 0), `floor` (the
 *  MIN_BURN operating overhead top-up) and `panic` (the endgame "market
 *  panic" while exactly two companies are fighting). Sums to calcBurn. */
export function burnBreakdown(
  state: GameState,
  player: PlayerId,
): { salary: number; ops: number; floor: number; panic: number } {
  const p = playerOf(state, player);
  let salary = getSalaryOutlay(state, player);
  if (p.auditThisTurn && !hasVP(state, player, 'fin')) salary *= 2;
  let ops = getProjectBurn(state, player) + getConsultantOutlay(state, player);
  const finSkill = getSkill(state, player, 'fin');
  if (finSkill > 0) ops = Math.max(0, ops - finSkill);
  // Fixed costs: every company pays MIN_BURN even with an empty board (kills
  // the 0-burn immortal endgame), plus the two-player "market panic" extra.
  const base = salary + ops;
  const floor = Math.max(0, MIN_BURN - base);
  const panic = aliveCount(state) === 2 ? DUEL_BURN_EXTRA : 0;
  return { salary, ops, floor, panic };
}

export function calcBurn(state: GameState, player: PlayerId): number {
  const { salary, ops, floor, panic } = burnBreakdown(state, player);
  return salary + ops + floor + panic;
}

// ---- Playability house rules ---------------------------------------------

/** Number of alive players. */
export function aliveCount(state: GameState): number {
  return state.players.filter((p) => p.alive).length;
}

/** True when `player` is the strictly-lowest cash among *alive* players — ties
 *  don't count (gates the comeback draw bonus; nobody qualifies at game start
 *  when everyone holds $100M). */
export function isStrictLowestCash(state: GameState, player: PlayerId): boolean {
  const me = playerOf(state, player);
  if (!me.alive) return false;
  // Strictly lowest ⇔ no *other* alive player holds ≤ my cash.
  return !state.players.some((pl, id) => id !== player && pl.alive && pl.cash <= me.cash);
}

/** One-time bailout refund on first bankruptcy: base + $2M per finance-skill
 *  point on the board (finance staff negotiate a bigger emergency round). */
export function bailoutAmount(state: GameState, player: PlayerId): number {
  return BAILOUT_BASE + BAILOUT_PER_FIN_SKILL * getSkill(state, player, 'fin');
}

/** Cash valve: abandon one of your own bad projects for 2× its burn. */
export function badAbandonCost(proj: ProjectCard): number {
  return proj.burn * ABANDON_BAD_MULTIPLIER;
}

/** 画大饼: discounted engineer requirement (ceil) — each finance-skill point
 *  cuts the bar by 10%, floored at 50% of the original. */
export function burnoutReq(state: GameState, player: PlayerId, proj: ProjectCard): number {
  const discount = Math.max(
    BURNOUT_DISCOUNT_FLOOR,
    1 - getSkill(state, player, 'fin') * BURNOUT_DISCOUNT_PER_FIN,
  );
  return Math.ceil(proj.reqSkill * discount);
}

/** May `player` pay to abandon this bad project right now? */
export function canAbandonBad(state: GameState, player: PlayerId, proj: ProjectCard): boolean {
  return proj.subtype === 'bad' && playerOf(state, player).cash >= badAbandonCost(proj);
}

/** Poaching costs cash: $1M per staff skill point, $4M for a VP. */
export function poachCost(card: Card): number {
  return card.kind === 'vp' ? card.salary : card.kind === 'staff' ? card.skill : 0;
}

/** Free hand discard (house rule): allowed once per turn, any hand card, no
 *  compensation — a release valve for dead cards like duplicate VPs. */
export function canDiscard(state: GameState, player: PlayerId): boolean {
  const p = playerOf(state, player);
  return !p.discardedThisTurn && p.hand.length > 0;
}

// ---- Legality -------------------------------------------------------------

/** VP hiring limit: at most one VP per department (rules.md §1.1). */
export function vpAlreadyHeld(state: GameState, player: PlayerId, dept: Dept): boolean {
  return hasVP(state, player, dept);
}

/** May `card` be hired into `player`'s company right now? */
export function canHire(state: GameState, player: PlayerId, card: Card): boolean {
  if (card.kind === 'staff') return true;
  if (card.kind === 'vp') return !vpAlreadyHeld(state, player, card.dept);
  return false;
}

/** Brief "is this card in hand even playable / assignable" check used by UI
 *  highlight. Full target legality is resolved in the target validators below. */
export function canPlayCard(state: GameState, player: PlayerId, card: Card): boolean {
  switch (card.kind) {
    case 'vp':
      return canHire(state, player, card);
    case 'staff':
      return true;
    case 'project':
      // House rule: assignment has NO VP gate — any player can start any
      // project (tech/market on their own board, bad on foes). The matching
      // VP only adds bonuses (Eng: tech burn half + reward +50%; Sales:
      // market reward +50% + cashing out).
      return true;
    case 'action':
      return canPlayAction(state, player, card.act);
    case 'consultant':
      return false; // parasites are never in a hand
  }
}

/** Highest-level action playability. For target-requiring actions this simply
 *  forwards to the full target validators (which honour HR-VP protection, VP
 *  prerequisites and target availability), so UI highlight and engine agree. */
export function canPlayAction(state: GameState, player: PlayerId, act: ActionAct): boolean {
  switch (act) {
    case 'audit':
    case 'consultant':
      // Need at least one alive opponent to aim at.
      return opponents(state, player).length > 0;
    case 'headhunter':
      return true;
    case 'layoff':
      return validLayoffTargets(state, player).length > 0;
    case 'poach':
      return validPoachTargets(state, player).length > 0;
    case 'resign':
      return validResignTargets(state, player).length > 0;
    case 'release':
      return validReleaseTargets(state, player).length > 0;
    default:
      return false;
  }
}


export interface CompletionResult {
  ok: boolean;
  reason?: string;
}

export interface CompletionResult {
  ok: boolean;
  reason?: string;
  /** Market projects: whether a Sales VP is on the board to convert the
   *  completed project into cash. Completing never needs a VP (rules.md §3
   *  phase 2) — the VP only gates *cashing out* the market reward. */
  canCash?: boolean;
}

/** Can `player` complete `project` right now? **Skill alone decides** — no VP
 *  is required to complete (rules.md §3 phase 2: the VP unlocks assignment,
 *  not completion). Tech/bad need engineer skill; market needs marketing
 *  skill, and `canCash` reports whether a Sales VP is present to convert the
 *  market reward into cash (absent it, the project still completes and stops
 *  burning, but pays nothing). */
export function canCompleteProject(
  state: GameState,
  player: PlayerId,
  project: ProjectCard,
): CompletionResult {
  if (project.subtype === 'tech' || project.subtype === 'bad') {
    const skill = getSkill(state, player, 'eng');
    if (skill < project.reqSkill)
      return { ok: false, reason: `工程技能不足 (${skill}/${project.reqSkill})` };
    return { ok: true };
  }
  // market
  const skill = getSkill(state, player, 'mkt');
  if (skill < project.reqSkill)
    return { ok: false, reason: `营销技能不足 (${skill}/${project.reqSkill})` };
  return { ok: true, canCash: hasVP(state, player, 'sales') };
}

// ---- Target resolution ----------------------------------------------------
//
// Each validator returns the concrete `TargetRef`s a UI may present, already
// filtering out rule-illegal picks (HR-VP protection, VP dept collision,
// consultant immunity, VP prerequisites…). An empty list means the action can't
// resolve and the engine treats it as `invalid`. Refs are zone-agnostic
// `{ player, zone, index }` so the UI can resolve them against any player.

export function validLayoffTargets(state: GameState, player: PlayerId): TargetRef[] {
  if (!hasVP(state, player, 'hr')) return [];
  const company = playerOf(state, player).company;
  return company.map((_, index) => ({ player, zone: 'company' as const, index }));
}

/** "High exec feud" layoff mode (house rule): when your own company holds at
 *  least one VP and one consultant, the Layoff card can cut ONE VP + ONE
 *  consultant together — they implode each other, no HR VP needed. The price
 *  is losing a VP, but it clears a parasite without waiting for HR. */
export function feudFeasible(state: GameState, player: PlayerId): boolean {
  const company = playerOf(state, player).company;
  return (
    company.some((c) => c.kind === 'vp') &&
    company.some((c) => c.kind === 'consultant')
  );
}

/** Poachable cards across all alive opponents.
 *
 *  Shield rule (house rule): a foe with an HR VP on the board can only be
 *  hit on that HR VP itself — the protector falls first, and taking it
 *  *discards* it (the poacher doesn't gain the VP, so no dept slot needed).
 *  Targets are further filtered by the poacher's VP-dept slot (for normal
 *  VPs) and by cash (every poach costs). */
export function validPoachTargets(state: GameState, player: PlayerId): TargetRef[] {
  const refs: TargetRef[] = [];
  const me = playerOf(state, player);
  for (const foe of opponents(state, player)) {
    const company = playerOf(state, foe).company;
    const hrIdx = company.findIndex((c) => c.kind === 'vp' && c.dept === 'hr');
    if (hrIdx >= 0) {
      // Shield: only the HR VP itself may be poached — it is then discarded
      // (no HR dept slot needed on the poacher's side), for $4M.
      const hr = company[hrIdx];
      if (me.cash >= poachCost(hr)) {
        refs.push({ player: foe, zone: 'company' as const, index: hrIdx });
      }
      continue;
    }
    company.forEach((c, index) => {
      if (c.kind === 'consultant') return;
      if (c.kind === 'staff') {
        if (me.cash >= poachCost(c)) refs.push({ player: foe, zone: 'company' as const, index });
      } else if (c.kind === 'vp' && !vpAlreadyHeld(state, player, c.dept)) {
        if (me.cash >= poachCost(c)) refs.push({ player: foe, zone: 'company' as const, index });
      }
    });
  }
  return refs;
}

/** Cards that can be forced to resign, across all alive opponents. Same
 *  shield rule as poaching (an HR VP must fall first) — but resignation
 *  costs no cash. */
export function validResignTargets(state: GameState, player: PlayerId): TargetRef[] {
  const refs: TargetRef[] = [];
  for (const foe of opponents(state, player)) {
    const company = playerOf(state, foe).company;
    const hrIdx = company.findIndex((c) => c.kind === 'vp' && c.dept === 'hr');
    if (hrIdx >= 0) {
      refs.push({ player: foe, zone: 'company' as const, index: hrIdx }); // shield falls first
      continue;
    }
    company.forEach((c, index) => {
      if (c.kind === 'consultant') return;
      refs.push({ player: foe, zone: 'company' as const, index });
    });
  }
  return refs;
}

/** Release may target any project on *your own* board only (rules.md §1.4:
 *  "废弃一个正在拖垮你公司的项目" — including bad projects dumped on you). */
export function validReleaseTargets(state: GameState, player: PlayerId): TargetRef[] {
  if (!hasVP(state, player, 'eng') && !hasVP(state, player, 'sales')) return [];
  return playerOf(state, player).projects.map((_, index) => ({
    player,
    zone: 'projects' as const,
    index,
  }));
}

/** Alive opponents a bad project may be dumped on (each maps to a dummy ref so
 *  the UI's target-selection machinery works uniformly). */
export function validBadTargets(state: GameState, player: PlayerId): { ids: PlayerId[]; refs: TargetRef[] } {
  const foes = opponents(state, player);
  return {
    ids: foes,
    refs: foes.map((foe) => ({ player: foe, zone: 'company' as const, index: 0 })),
  };
}

// ---- Small helpers --------------------------------------------------------

export function playerOf(state: GameState, id: PlayerId): PlayerState {
  return state.players[id];
}

export function isHandFull(state: GameState, player: PlayerId): boolean {
  return playerOf(state, player).hand.length >= HAND_SIZE;
}
