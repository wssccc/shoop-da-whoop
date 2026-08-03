// `BurnRateEngine`: framework-agnostic game controller (multiplayer).
//
// Holds `GameState` + an injectable `Rng` + two assignable callbacks (`onLog`,
// `onGameOver`). No DOM, no timers, no UI types — the Vue layer wires this up
// exactly like solitaire's `SolitaireEngine` (assignable callbacks) and
// othello's `OthelloGame` (clone-and-replace updates).
//
// Multiplayer: players are `PlayerId` indices (0 = human). Bankruptcy removes
// a player from the rotation (`alive = false`); the last player standing wins.
// Target-requiring plays (audit / consultant / bad project) auto-resolve when
// only one opponent remains (the old 1v1 flow) and otherwise stash a pending
// target choice for the UI.

import { buildDeck } from './cards';
import {
    CONSULTANT_SALARY_MAX,
    CONSULTANT_SALARY_MIN,
    HAND_CAP,
    MAX_LOG,
    MIN_PLAYERS,
    START_CASH,
} from './constants';
import { mulberry32 } from './rng';
import {
    badAbandonCost,
    bailoutAmount,
    burnoutReq,
    calcBurn,
    canAbandonBad,
    canCompleteProject,
    canDiscard,
    canHire,
    getSkill,
    playerOf as getStatePlayer,
    hasVP,
    isStrictLowestCash,
    lastStanding,
    nextAlive,
    opponents,
    poachCost,
    projectReward,
    singleOpponent,
    validLayoffTargets,
    validPoachTargets,
    validReleaseTargets,
    validResignTargets,
    vpAlreadyHeld,
} from './rules';
import { cloneState, createInitialState, createPlayer, pushLog, sideName } from './state';
import type {
    ActionResult,
    AiAction,
    Card,
    ConsultantCard,
    DiceRollOutcome,
    DiceRound,
    GameState,
    HeadhunterChoice,
    LogType,
    PlayerId,
    PlayerState,
    ProjectCard,
    Rng,
    StaffCard,
    TargetRef,
    TurnResult,
} from './types';

/** Cap on opening-dice re-roll rounds (a constant-RNG stub must terminate). */
const MAX_DICE_ROUNDS = 10;

/** Headhunter's searchable categories: the 4 VP departments + 4 staff roles. */
const HEADHUNTER_KEYS = [
  'vp:hr',
  'vp:fin',
  'vp:sales',
  'vp:eng',
  'staff:eng',
  'staff:mkt',
  'staff:hr',
  'staff:fin',
] as const;

const HEADHUNTER_LABELS: Record<string, string> = {
  'vp:hr': 'HR 副总裁',
  'vp:fin': 'Finance 副总裁',
  'vp:sales': 'Sales 副总裁',
  'vp:eng': 'Engineering 副总裁',
  'staff:eng': '工程师',
  'staff:mkt': '营销人员',
  'staff:hr': 'HR 专员',
  'staff:fin': '财务专员',
};

function sameRef(a: TargetRef, b: TargetRef): boolean {
  return a.player === b.player && a.zone === b.zone && a.index === b.index;
}

export interface EngineCallbacks {
  onLog?: (msg: string, type: LogType) => void;
  onGameOver?: (winner: PlayerId) => void;
}

export interface EngineOptions {
  rng?: Rng;
}

export interface OkResult {
  ok: boolean;
  reason?: string;
}

export class BurnRateEngine {
  state: GameState;
  protected readonly rng: Rng;
  private consultantSeq = 0;

  /** UI/thunk-side observers. Assign directly (mirrors solitaire). */
  onLog: (msg: string, type: LogType) => void = () => {};
  onGameOver: (winner: PlayerId) => void = () => {};

  constructor(options: EngineOptions = {}, callbacks: EngineCallbacks = {}) {
    this.rng = options.rng ?? mulberry32((Math.random() * 0xffffffff) >>> 0);
    this.onLog = callbacks.onLog ?? (() => {});
    this.onGameOver = callbacks.onGameOver ?? (() => {});
    this.state = createInitialState({ rng: this.rng });
  }

  /** Brand-new game: shuffled deck (rebuilt with the engine's rng),
   *  `START_CASH` each, six-card starting hands. `opts.firstPlayer` picks who
   *  moves first — the UI pre-rolls it with `rollFirst` so the dice animation
   *  can play out to a known result; when omitted the human (player 0) starts
   *  (legacy behaviour kept for tests). */
  newGame(playerCount: number = MIN_PLAYERS, opts: { firstPlayer?: PlayerId } = {}): void {
    this.state.deck = buildDeck({ rng: this.rng });
    this.state.discard = [];
    this.state.turn = 1;
    this.state.currentPlayer = opts.firstPlayer ?? 0;
    this.state.gameOver = false;
    this.state.winner = null;
    this.state.pending = null;
    this.state.log = [];
    this.state.players = Array.from({ length: playerCount }, () => createPlayer());
    for (let i = 0; i < playerCount; i++) this.drawToSix(i);
    this.log(`🎮 游戏开始！${playerCount} 人各 ${START_CASH}M 初始资金`, 'good');
    if (opts.firstPlayer !== undefined) {
      this.log(`🎲 ${sideName(opts.firstPlayer)} 掷骰胜出，先手！`, 'good');
    }
  }

  /** Swap in a previously persisted state (localStorage resume). Deep-cloned
   *  so the caller's copy stays untouched; future random rolls keep using this
   *  engine's injected rng. */
  restore(state: GameState): void {
    this.state = cloneState(state);
  }

  // ---- Opening dice roll (who moves first) ------------------------------

  /** Roll the opening dice: every player rolls a d6, the sole highest roller
   *  goes first; tied leaders re-roll until a unique winner emerges. Uses the
   *  engine's injected RNG so the roll (and the whole game) stays
   *  deterministic and unit-testable. The UI pre-rolls with this, plays the
   *  dice animation out to the known result, then calls `newGame` with the
   *  winner as `firstPlayer`. */
  rollFirst(playerCount: number = MIN_PLAYERS): DiceRollOutcome {
    const rounds: DiceRound[] = [];
    let pool: PlayerId[] = Array.from({ length: playerCount }, (_, i) => i);
    let winner = pool[0] ?? 0;
    // A degenerate RNG (e.g. tests stubbing a constant roll) could tie
    // forever — cap the re-roll rounds and fall back to the first leader.
    let guard = MAX_DICE_ROUNDS;
    while (pool.length > 1 && guard-- > 0) {
      const values = pool.map(() => this.rollD6());
      rounds.push({ players: [...pool], values });
      const max = Math.max(...values);
      const leaders = pool.filter((_, i) => values[i] === max);
      if (leaders.length === 1) {
        winner = leaders[0];
        pool = [];
        break;
      }
      pool = leaders;
    }
    if (pool.length > 0) winner = pool[0];
    return { winner, rounds };
  }

  /** A d6 face value (1..6) from the injected RNG. */
  protected rollD6(): number {
    return Math.floor(this.rng() * 6) + 1;
  }

  // ---- Hiring & projects -------------------------------------------------

  hireCard(cardId: string, player: PlayerId = 0): OkResult {
    const p = this.player(player);
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return { ok: false, reason: '手牌中无此牌' };
    const card = p.hand[idx];
    if (!canHire(this.state, player, card)) {
      return { ok: false, reason: '该部门已有 VP 或不可雇佣' };
    }
    p.hand.splice(idx, 1);
    p.company.push(card);
    this.log(`✅ ${this.side(player)} 雇佣了 ${card.name}`, 'good');
    // New staff may have just met a project's skill requirement — projects
    // auto-complete the moment their skills are met (rules.md §3 phase 2).
    this.autoCompleteProjects(player);
    return { ok: true };
  }

  /** Assign a project card from hand. Tech/market go to self immediately; a
   *  bad project goes to an opponent — auto-resolving when only one opponent
   *  remains, otherwise stashing a pending target choice for the UI. */
  assignProject(cardId: string, player: PlayerId = 0): ActionResult {
    const p = this.player(player);
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return { status: 'invalid', reason: '手牌中无此牌' };
    const card = p.hand[idx];
    if (card.kind !== 'project') return { status: 'invalid', reason: '非项目牌' };

    if (card.target === 'self') {
      const r = this.assignProjectAs(cardId, player, player);
      return r.ok ? { status: 'done' } : { status: 'invalid', reason: r.reason ?? '无法执行' };
    }
    // bad project → pick a foe
    const foe = singleOpponent(this.state, player);
    if (foe !== null) {
      const r = this.assignProjectAs(cardId, player, foe);
      return r.ok ? { status: 'done' } : { status: 'invalid', reason: r.reason ?? '无法执行' };
    }
    const foes = opponents(this.state, player);
    if (foes.length === 0) return { status: 'invalid', reason: '没有可塞的对手' };
    this.state.pending = {
      kind: 'target',
      act: 'assignBad',
      actor: player,
      cardId: null,
      targets: foes.map((f) => ({ player: f, zone: 'company' as const, index: 0 })),
      playerChoices: foes,
    };
    return {
      status: 'awaitTarget',
      act: 'assignBad',
      targets: this.state.pending.targets,
      playerChoices: foes,
    };
  }

  /** Resolve a project already on `player`'s board. Completion needs skill
   *  alone — the VP requirement belongs to assignment (rules.md §3 phase 2).
   *  Market projects cash out only with a Sales VP on the board. */
  completeProject(index: number, player: PlayerId = 0): OkResult {
    const p = this.player(player);
    const proj = p.projects[index];
    if (!proj) return { ok: false, reason: '无此项目' };
    const check = canCompleteProject(this.state, player, proj);
    if (!check.ok) return { ok: false, reason: check.reason };
    this.finishProject(player, proj);
    return { ok: true };
  }

  /** Shared completion settlement: remove from the board, discard the card,
   *  pay the reward when eligible. A market project completed without a Sales
   *  VP still stops burning — it just never converts to cash. The matching VP
   *  (Eng→tech, Sales→market) multiplies the reward by VP_REWARD_BONUS. */
  protected finishProject(player: PlayerId, proj: ProjectCard): void {
    const p = this.player(player);
    const idx = p.projects.findIndex((x) => x.id === proj.id);
    if (idx >= 0) p.projects.splice(idx, 1);
    this.state.discard.push(proj);
    const cash = proj.subtype === 'market' && !hasVP(this.state, player, 'sales')
      ? 0
      : projectReward(this.state, player, proj);
    if (cash > 0) {
      p.cash += cash;
      this.log(`🎉 ${this.side(player)} 完成 ${proj.name}，获得 $${cash}M！`, 'good');
    } else if (proj.subtype === 'market') {
      this.log(`🎉 ${this.side(player)} 完成 ${proj.name}（无 Sales VP，未变现）`, 'info');
    } else {
      this.log(`🎉 ${this.side(player)} 完成 ${proj.name}！停止烧钱`, 'good');
    }
  }

  /** Auto-complete every project on `player`'s board whose skill requirement
   *  is now met (rules.md §3 phase 2: completion is automatic — no VP needed).
   *  Runs when the board's skill set changes (hire / poach) and at the start
   *  of a mover's action phase (endTurn handoff). Returns the count done. */
  protected autoCompleteProjects(player: PlayerId): number {
    const projects = this.player(player).projects;
    let done = 0;
    for (let i = projects.length - 1; i >= 0; i--) {
      const proj = projects[i];
      if (!canCompleteProject(this.state, player, proj).ok) continue;
      this.finishProject(player, proj);
      done++;
    }
    return done;
  }

  // ---- Actions (player-facing) ------------------------------------------

  /** Initiate any action card. Audit/consultant resolve immediately against
   *  the sole opponent, or stash a target choice with several; the other
   *  target-requiring ones always stash a `PendingRequest` for the UI to
   *  resolve via `selectTarget` / `pickHeadhunter`. */
  playAction(cardId: string, player: PlayerId = 0): ActionResult {
    const p = this.player(player);
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return { status: 'invalid', reason: '手牌中无此牌' };
    const card = p.hand[idx];
    if (card.kind !== 'action') return { status: 'invalid', reason: '非行动牌' };

    switch (card.act) {
      case 'audit':
      case 'consultant': {
        const foe = singleOpponent(this.state, player);
        if (foe !== null) {
          const r = card.act === 'audit' ? this.doAudit(player, foe) : this.doConsultant(player, foe);
          return r.ok ? { status: 'done' } : { status: 'invalid', reason: r.reason ?? '无法执行' };
        }
        const foes = opponents(this.state, player);
        if (foes.length === 0) {
          return { status: 'invalid', reason: card.act === 'audit' ? '没有可审计的对手' : '没有可塞顾问的对手' };
        }
        this.state.pending = {
          kind: 'target',
          act: card.act,
          actor: player,
          cardId,
          targets: foes.map((f) => ({ player: f, zone: 'company' as const, index: 0 })),
          playerChoices: foes,
        };
        return {
          status: 'awaitTarget',
          act: card.act,
          targets: this.state.pending.targets,
          playerChoices: foes,
        };
      }
      case 'headhunter': {
        p.hand.splice(idx, 1);
        this.state.discard.push(card);
        const choices = this.headhunterChoices();
        if (choices.every((c) => c.available === 0)) {
          this.log('❌ 牌堆与弃牌堆中已无任何 VP 或员工可招募', 'info');
          return { status: 'done' };
        }
        this.state.pending = { kind: 'headhunter', actor: player, cardId: card.id, choices };
        return { status: 'awaitPick', choices };
      }
      case 'layoff': {
        const targets = validLayoffTargets(this.state, player);
        if (targets.length === 0) return { status: 'invalid', reason: '需要 HR VP，且公司区有成员' };
        // Bulk layoff: one card cuts 1 + HR skill targets (rules.md §1.2).
        const pickCount = Math.min(targets.length, 1 + getSkill(this.state, player, 'hr'));
        this.state.pending = {
          kind: 'target',
          act: 'layoff',
          actor: player,
          cardId,
          targets,
          pickCount,
        };
        return { status: 'awaitTarget', act: 'layoff', targets, pickCount };
      }
      case 'poach': {
        const targets = validPoachTargets(this.state, player);
        if (targets.length === 0) return { status: 'invalid', reason: '无可挖目标（现金不足或需先挖 HR VP）' };
        this.state.pending = { kind: 'target', act: 'poach', actor: player, cardId, targets };
        return { status: 'awaitTarget', act: 'poach', targets };
      }
      case 'resign': {
        const targets = validResignTargets(this.state, player);
        if (targets.length === 0) return { status: 'invalid', reason: '无可辞退目标（需先辞 HR VP）' };
        this.state.pending = { kind: 'target', act: 'resign', actor: player, cardId, targets };
        return { status: 'awaitTarget', act: 'resign', targets };
      }
      case 'release': {
        const targets = validReleaseTargets(this.state, player);
        if (targets.length === 0) return { status: 'invalid', reason: '需要 Eng/Sales VP，且有项目可废弃' };
        this.state.pending = { kind: 'target', act: 'release', actor: player, cardId, targets };
        return { status: 'awaitTarget', act: 'release', targets };
      }
      default:
        return { status: 'invalid', reason: '未知行动' };
    }
  }

  /** "High exec feud" layoff mode: pick ONE VP + ONE consultant of your own
   *  company — they implode together (both leave). House rule: this clears a
   *  consultant without needing an HR VP, at the cost of losing a VP. */
  startFeudLayoff(player: PlayerId = 0): ActionResult {
    const p = this.player(player);
    const vps: TargetRef[] = [];
    const consultants: TargetRef[] = [];
    p.company.forEach((c, index) => {
      if (c.kind === 'vp') vps.push({ player, zone: 'company' as const, index });
      else if (c.kind === 'consultant') consultants.push({ player, zone: 'company' as const, index });
    });
    if (vps.length === 0 || consultants.length === 0) {
      return { status: 'invalid', reason: '公司区需要同时有 VP 和顾问才能内斗' };
    }
    this.state.pending = {
      kind: 'target',
      act: 'layoffFeud',
      actor: player,
      cardId: null,
      targets: [...vps, ...consultants],
      pickCount: 2,
    };
    return {
      status: 'awaitTarget',
      act: 'layoffFeud',
      targets: this.state.pending.targets,
      pickCount: 2,
    };
  }

  /** Resolve a pending target-requiring action with `ref` (UI click). */
  selectTarget(ref: TargetRef): OkResult {
    return this.selectTargets([ref]);
  }

  /** Resolve a pending target-requiring action with `refs`. Layoff's bulk pick
   *  sends `pickCount` refs in one call; every other action sends exactly one. */
  selectTargets(refs: TargetRef[]): OkResult {
    const pending = this.state.pending;
    if (!pending || pending.kind !== 'target') {
      return { ok: false, reason: '当前无待选目标' };
    }
    const pickCount = pending.pickCount ?? 1;
    if (refs.length !== pickCount) {
      return { ok: false, reason: `需要选择 ${pickCount} 个目标` };
    }
    if (refs.some((r, i) => refs.findIndex((x) => sameRef(x, r)) !== i)) {
      return { ok: false, reason: '目标重复' };
    }
    for (const ref of refs) {
      const legal = pending.targets.some(
        (t) => t.player === ref.player && t.zone === ref.zone && t.index === ref.index,
      );
      if (!legal) return { ok: false, reason: '非法目标' };
    }

    const actor = pending.actor;
    let result: OkResult = { ok: true };
    if (pending.act === 'layoff') {
      // Bulk layoff: splice from the highest index down so earlier removals
      // don't shift the remaining picks' positions.
      const mine = this.player(actor).company;
      const sorted = [...refs].sort((a, b) => b.index - a.index);
      for (const ref of sorted) {
        const target = mine[ref.index];
        if (!target) {
          result = { ok: false, reason: '无此目标' };
          break;
        }
        mine.splice(ref.index, 1);
        // Consultants are parasites (not real deck cards): drop them silently.
        if (target.kind !== 'consultant') this.state.discard.push(target);
        this.log(`✂️ ${this.side(actor)} 解雇了 ${target.name}`, 'good');
      }
    } else if (pending.act === 'layoffFeud') {
      // High exec feud: refs must be ONE VP + ONE consultant of our own board.
      const mine = this.player(actor).company;
      const cards = refs.map((r) => mine[r.index]);
      const hasVp = cards.some((c) => c && c.kind === 'vp');
      const hasConsultant = cards.some((c) => c && c.kind === 'consultant');
      if (cards.some((c) => !c) || !hasVp || !hasConsultant) {
        result = { ok: false, reason: '内斗需选择 1 个 VP 和 1 个顾问' };
      } else {
        const sorted = [...refs].sort((a, b) => b.index - a.index);
        const names: string[] = [];
        for (const ref of sorted) {
          const target = mine[ref.index];
          names.push(target.name);
          mine.splice(ref.index, 1);
          if (target.kind !== 'consultant') this.state.discard.push(target);
        }
        this.log(`🥊 ${this.side(actor)} 高层内斗：${names.join(' 与 ')} 同归于尽！`, 'attack');
      }
    } else if (refs.length === 1) {
      const ref = refs[0];
      switch (pending.act) {
        case 'poach': result = this.doPoachAt(actor, ref); break;
        case 'resign': result = this.doResignAt(actor, ref); break;
        case 'release': result = this.doReleaseAt(actor, ref); break;
        case 'assignBad': result = this.doAssignBad(actor, ref.player); break;
        case 'audit': result = this.doAudit(actor, ref.player); break;
        case 'consultant': result = this.doConsultant(actor, ref.player); break;
        default: result = { ok: false, reason: '未知行动' };
      }
    } else {
      return { ok: false, reason: '该行动仅支持单选' };
    }
    if (result.ok && pending.cardId) this.consumeCard(actor, pending.cardId);
    this.state.pending = null;
    return result;
  }

  /** Abort a pending target selection (UI cancel). The action card was never
   *  consumed, so it stays in the actor's hand untouched. */
  cancelPending(): void {
    this.state.pending = null;
  }

  /** Resolve a pending headhunter search: the first matching card leaves deck
   *  (preferred) or discard and joins the actor's hand (rules.md §1.4). */
  pickHeadhunter(category: string): OkResult {
    const pending = this.state.pending;
    if (!pending || pending.kind !== 'headhunter') {
      return { ok: false, reason: '当前无猎头待选' };
    }
    const choice = pending.choices.find((c) => c.key === category);
    if (!choice || choice.available <= 0) {
      return { ok: false, reason: '无效选项' };
    }
    const card = this.takeCategoryCard(category);
    if (!card) return { ok: false, reason: '该类卡牌已被拿光' };
    this.player(pending.actor).hand.push(card);
    this.log(`🎯 ${this.side(pending.actor)} 通过猎头招募了 ${card.name}`, 'good');
    this.state.pending = null;
    return { ok: true };
  }

  /** Finance VP ability: discard N hand cards, draw N (rules.md §3 phase 4). */
  discardAndDraw(cardIds: string[], player: PlayerId = 0): OkResult {
    if (!hasVP(this.state, player, 'fin')) {
      return { ok: false, reason: '需要 Finance VP' };
    }
    const p = this.player(player);
    const toRemove: Card[] = [];
    for (const id of cardIds) {
      const i = p.hand.findIndex((c) => c.id === id);
      if (i < 0) return { ok: false, reason: `手牌中无 ${id}` };
      toRemove.push(p.hand.splice(i, 1)[0]);
    }
    for (const c of toRemove) this.state.discard.push(c);
    let drawn = 0;
    for (let i = 0; i < toRemove.length; i++) {
      const c = this.drawCard();
      if (!c) break;
      p.hand.push(c);
      drawn++;
    }
    this.log(`🔄 ${this.side(player)} 通过 Finance VP 弃 ${toRemove.length} 抽 ${drawn}`, 'info');
    return { ok: true };
  }

  // ---- AI primitive entrypoints -----------------------------------------

  /** Apply one AI-decided action. The AI driver loops `adapter.chooseAction`
   *  until it returns null, calling this each step. */
  applyAiAction(action: AiAction, player: PlayerId = 0): OkResult {
    switch (action.kind) {
      case 'hire':
        return this.hireCard(action.cardId, player);
      case 'assignProject':
        return this.assignProjectAs(action.cardId, player, action.target === 'self' ? player : action.target);
      case 'audit':
        return this.doAudit(player, action.target);
      case 'consultant':
        return this.doConsultant(player, action.target);
      case 'poach': {
        const res = this.doPoachById(player, action.targetCardId);
        if (res.ok) {
          // Consume the poach action card from hand.
          const i = this.indexOfAction(player, 'poach');
          if (i >= 0) {
            const [c] = this.player(player).hand.splice(i, 1);
            this.state.discard.push(c);
          }
        }
        return res;
      }
      case 'abandonBad':
        return this.abandonBad(action.cardId, player);
      case 'burnoutBad':
        return this.burnoutBad(action.cardId, action.engineerIds, player);
      case 'discard':
        return this.discardCard(action.cardId, player);
    }
  }

  // ---- Playability house-rule actions ----------------------------------

  /** Cash valve: pay 2×burn to abandon one of your own bad projects (house
   *  rule — no Engineering VP needed, just cash). */
  abandonBad(cardId: string, player: PlayerId = 0): OkResult {
    const p = this.player(player);
    const idx = p.projects.findIndex((pr) => pr.id === cardId);
    if (idx < 0) return { ok: false, reason: '项目不在公司区' };
    const proj = p.projects[idx];
    if (!canAbandonBad(this.state, player, proj)) {
      return { ok: false, reason: '现金不足或非烂尾项目' };
    }
    const cost = badAbandonCost(proj);
    p.cash -= cost;
    const [removed] = p.projects.splice(idx, 1);
    this.state.discard.push(removed);
    this.log(`🛑 ${this.side(player)} 支付 $${cost}M 止损，废弃了烂尾工程`, 'info');
    return { ok: true };
  }

  /** 画大饼: sacrifice own engineers to clear a bad project. Required total
   *  skill = ceil(origReq × discount); each finance-skill point on the board
   *  shrinks the discount (10% per point, floored at 50%). Engineers and the
   *  bad project go to the discard together. */
  burnoutBad(cardId: string, engineerIds: string[], player: PlayerId = 0): OkResult {
    const p = this.player(player);
    const idx = p.projects.findIndex((pr) => pr.id === cardId);
    if (idx < 0) return { ok: false, reason: '项目不在公司区' };
    const proj = p.projects[idx];
    if (proj.subtype !== 'bad') return { ok: false, reason: '仅限烂尾工程' };
    const req = burnoutReq(this.state, player, proj);
    const engineers = p.company.filter(
      (c): c is StaffCard => c.kind === 'staff' && c.role === 'eng',
    );
    const chosen = engineers.filter((c) => engineerIds.includes(c.id));
    if (chosen.length !== engineerIds.length) {
      return { ok: false, reason: '工程师选择无效' };
    }
    const total = chosen.reduce((s, c) => s + c.skill, 0);
    if (total < req) return { ok: false, reason: `工程师技能不足（需 ${req}）` };
    for (const c of chosen) {
      const i = p.company.indexOf(c);
      if (i >= 0) {
        const [gone] = p.company.splice(i, 1);
        this.state.discard.push(gone);
      }
    }
    const [removed] = p.projects.splice(idx, 1);
    this.state.discard.push(removed);
    this.log(
      `🥧 ${this.side(player)} 画大饼忽悠 ${chosen.length} 名工程师（${total} 技能）耗死在烂尾工程上`,
      'info',
    );
    return { ok: true };
  }

  /** Free hand discard (house rule): once per turn, any hand card, straight to
   *  the discard pile with no compensation. Releases dead cards like
   *  duplicate VPs. */
  discardCard(cardId: string, player: PlayerId = 0): OkResult {
    const p = this.player(player);
    if (!canDiscard(this.state, player)) {
      return { ok: false, reason: '本回合已弃过牌或手牌为空' };
    }
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return { ok: false, reason: '手牌中没有这张牌' };
    const [c] = p.hand.splice(idx, 1);
    this.state.discard.push(c);
    p.discardedThisTurn = true;
    this.log(`🗑️ ${this.side(player)} 弃置了 ${c.name}`, 'info');
    return { ok: true };
  }

  /** Discard down to HAND_CAP at the end of your turn (house rule): the given
   *  cardIds are removed first (the human's own picks), any surplus beyond the
   *  cap is auto-discarded lowest-value-first (AI / fallback policy). */
  discardToCap(cardIds: string[] = [], player: PlayerId = 0): void {
    const p = this.player(player);
    const idSet = new Set(cardIds);
    p.hand = p.hand.filter((c) => {
      if (idSet.has(c.id)) {
        this.state.discard.push(c);
        return false;
      }
      return true;
    });
    while (p.hand.length > HAND_CAP) {
      let worst = 0;
      for (let i = 1; i < p.hand.length; i++) {
        if (this.cardDiscardValue(p.hand[i]) < this.cardDiscardValue(p.hand[worst])) {
          worst = i;
        }
      }
      const [c] = p.hand.splice(worst, 1);
      this.state.discard.push(c);
    }
  }

  /** Keep-value used by the auto-discard fallback: staff skill, VP salary,
   *  project intrinsic value (reward − 2×burn), actions lowest (situational). */
  protected cardDiscardValue(c: Card): number {
    switch (c.kind) {
      case 'staff': return c.skill;
      case 'vp': return c.salary;
      case 'project': return Math.max(0, c.reward - 2 * c.burn);
      default: return 0;
    }
  }

  // ---- Turn flow --------------------------------------------------------

  /** End `player`'s turn: settle their burn, check bankruptcy, hand off to the
   *  next *alive* player (skipping the bankrupt) and refill the new mover to
   *  six (rules.md phase 1 of their turn). One full round = back to player 0.
   *
   *  The successor gets refilled even when the current player went bankrupt —
   *  rules.md phase 1 applies to every turn (bug fix: the old code skipped
   *  drawToSix/autoComplete on the bankrupt path, leaving the successor to
   *  open short-handed). */
  endTurn(player: PlayerId = 0): TurnResult {
    if (this.state.gameOver) {
      return { bankrupt: true, winner: this.state.winner, nextPlayer: this.state.currentPlayer };
    }
    this.settleBurn(player); // phase 3
    if (this.checkBankrupt(player)) {
      // Out of the rotation — hand off to the next *alive* player.
      const next = nextAlive(this.state, player);
      this.prepareNextTurn(next);
      return { bankrupt: true, winner: this.state.winner, nextPlayer: next };
    }
    // Phase 4: hand cap (the human's explicit picks were passed to
    // discardToCap before endTurn; this call is the auto fallback).
    this.discardToCap([], player);
    // Finance VP discard-and-redraw is opt-in via discardAndDraw before endTurn.
    const next = nextAlive(this.state, player);
    this.prepareNextTurn(next);
    return { bankrupt: false, winner: null, nextPlayer: next };
  }

  /** Advance to `next` mover: set currentPlayer, bump the round counter when
   *  the rotation wraps back to player 0, refill their hand (phase 1) and
   *  auto-complete any met-skill projects (rules.md §3 phase 2 — completion
   *  needs no VP). Skipped once the game is already over. */
  protected prepareNextTurn(next: PlayerId): void {
    if (this.state.gameOver) return; // winner decided — no refill needed
    this.state.currentPlayer = next;
    if (next === 0) this.state.turn++; // round complete after coming back to the human
    this.player(next).discardedThisTurn = false; // fresh turn: free discard re-armed
    this.drawToSix(next); // phase 1 of the new mover
    // Their action phase opens with any met-skill projects auto-completing.
    this.autoCompleteProjects(next);
  }

  // ---- Internals --------------------------------------------------------

  protected player(player: PlayerId): PlayerState {
    return getStatePlayer(this.state, player);
  }

  protected side(player: PlayerId): string {
    return sideName(player);
  }

  protected log(msg: string, type: LogType = 'info'): void {
    pushLog(this.state, msg, type);
    if (this.state.log.length > MAX_LOG) this.state.log.length = MAX_LOG;
    this.onLog(msg, type);
  }

  protected drawCard(): Card | null {
    if (this.state.deck.length === 0) {
      if (this.state.discard.length === 0) return null;
      // Rebuild & reshuffle the draw pile from the discard pile.
      const shuffled = this.state.discard.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      this.state.deck = shuffled;
      this.state.discard = [];
    }
    return this.state.deck.pop() ?? null;
  }

  protected drawToSix(player: PlayerId): void {
    const p = this.player(player);
    while (p.hand.length < 6) {
      const c = this.drawCard();
      if (!c) break;
      p.hand.push(c);
    }
    // Comeback draw (house rule): the strictly-lowest alive player refills to
    // seven instead of six. Flags the player for comeback telemetry/achievement.
    if (isStrictLowestCash(this.state, player)) {
      const c = this.drawCard();
      if (c) {
        p.hand.push(c);
        p.wasStrictLowest = true;
      }
    }
  }

  protected consumeCard(player: PlayerId, cardId: string): void {
    const p = this.player(player);
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx >= 0) {
      const [card] = p.hand.splice(idx, 1);
      this.state.discard.push(card);
    }
  }

  protected settleBurn(player: PlayerId): number {
    const burn = calcBurn(this.state, player);
    if (burn > 0) {
      this.player(player).cash -= burn;
      this.log(
        `💸 ${this.side(player)} 本轮烧钱 $${burn}M，剩余 $${this.player(player).cash}M`,
        'info',
      );
    }
    this.player(player).auditThisTurn = false;
    return burn;
  }

  /** Mark `player` bankrupt (out of the rotation). Ends the game when only one
   *  player is left standing. Already-out players are ignored. The *first* time
   *  cash hits ≤ 0 an emergency bailout refunds them instead (one per player). */
  protected checkBankrupt(player: PlayerId): boolean {
    const p = this.player(player);
    if (!p.alive) return false; // already out of the rotation
    if (p.cash <= 0) {
      if (!p.bailoutUsed) {
        // One-time emergency financing — finance staff negotiate a bigger round.
        p.bailoutUsed = true;
        const refund = bailoutAmount(this.state, player);
        p.cash = refund;
        this.log(`🚑 ${this.side(player)} 触发紧急融资 $${refund}M，绝处逢生！`, 'good');
        return false;
      }
      this.player(player).alive = false;
      this.log(`💀 ${this.side(player)} 破产了！`, 'attack');
      const winner = lastStanding(this.state);
      if (winner !== null) {
        this.state.gameOver = true;
        this.state.winner = winner;
        this.log(`🏆 ${this.side(winner)} 是最后的赢家！`, 'good');
        this.onGameOver(winner);
      }
      return true;
    }
    return false;
  }

  // ---- Action primitives. audit/consultant consume their own action card;
  //      the do*At target ops do NOT (the player path consumes via pending, the
  //      AI path consumes in applyAiAction). -------------------------------

  protected doAudit(player: PlayerId, foe: PlayerId): OkResult {
    const idx = this.indexOfAction(player, 'audit');
    if (idx < 0) return { ok: false, reason: '手中无审计牌' };
    const p = this.player(player);
    const [card] = p.hand.splice(idx, 1);
    this.state.discard.push(card);
    if (hasVP(this.state, foe, 'fin')) {
      this.log(`🛡️ ${this.side(foe)} 有 Finance VP，审计无效`, 'info');
    } else {
      this.player(foe).auditThisTurn = true;
      this.log(`💥 ${this.side(player)} 审计了 ${this.side(foe)}，本轮薪水翻倍`, 'attack');
    }
    return { ok: true };
  }

  protected doConsultant(player: PlayerId, foe: PlayerId): OkResult {
    const idx = this.indexOfAction(player, 'consultant');
    if (idx < 0) return { ok: false, reason: '手中无顾问牌' };
    const p = this.player(player);
    const [card] = p.hand.splice(idx, 1);
    this.state.discard.push(card);
    const cost =
      CONSULTANT_SALARY_MIN +
      Math.floor(this.rng() * (CONSULTANT_SALARY_MAX - CONSULTANT_SALARY_MIN + 1));
    const consultant: ConsultantCard = {
      id: `consultant-${this.consultantSeq++}`,
      name: '高价顾问',
      kind: 'consultant',
      salary: cost,
      desc: `每轮索要 $${cost}M`,
    };
    this.player(foe).company.push(consultant);
    this.log(
      `🎩 ${this.side(player)} 塞给 ${this.side(foe)} 一个每轮 $${cost}M 的高价顾问！`,
      'attack',
    );
    return { ok: true };
  }

  /** Poach via a ref into the foe's company (player path). House rules: every
   *  poach costs cash (staff $1M/skill, VP $4M). An HR VP on the foe's board
   *  is a shield — only the HR VP itself may be taken, and it is DISCARDED
   *  (broken, not stolen: the poacher doesn't gain the VP). */
  protected doPoachAt(actor: PlayerId, ref: TargetRef): OkResult {
    const foe = ref.player;
    const foeCompany = this.player(foe).company;
    const target = foeCompany[ref.index];
    if (!target || target.kind === 'consultant') {
      return { ok: false, reason: '不能挖该目标' };
    }
    // Shield rule: with an HR VP on the board, ONLY the HR VP may be taken.
    const hrIdx = foeCompany.findIndex((c) => c.kind === 'vp' && c.dept === 'hr');
    if (hrIdx >= 0 && (target.kind !== 'vp' || target.dept !== 'hr')) {
      return { ok: false, reason: '需先挖掉对方的 HR VP' };
    }
    if (target.kind === 'vp' && target.dept === 'hr') {
      // Breaking the shield discards the HR VP — it never joins the poacher.
      const cost = poachCost(target);
      if (this.player(actor).cash < cost) return { ok: false, reason: '现金不足' };
      this.player(actor).cash -= cost;
      foeCompany.splice(ref.index, 1);
      this.state.discard.push(target);
      this.log(`🛡️ ${this.side(actor)} 花 $${cost}M 拆除了 ${this.side(foe)} 的 HR 副总裁（作废）！`, 'attack');
      return { ok: true };
    }
    if (target.kind === 'vp' && vpAlreadyHeld(this.state, actor, target.dept)) {
      return { ok: false, reason: '该部门已有 VP' };
    }
    const cost = poachCost(target);
    if (this.player(actor).cash < cost) return { ok: false, reason: '现金不足' };
    this.player(actor).cash -= cost;
    foeCompany.splice(ref.index, 1);
    this.player(actor).company.push(target);
    this.log(`🎯 ${this.side(actor)} 花 $${cost}M 从 ${this.side(foe)} 挖走了 ${target.name}！`, 'attack');
    // A poached engineer/marketer may have just completed a project for us.
    this.autoCompleteProjects(actor);
    return { ok: true };
  }

  /** Poach via an explicit card id (AI path). Searches every alive opponent.
   *  Returns ok=false if the card is not on any legal board. */
  protected doPoachById(actor: PlayerId, targetCardId: string): OkResult {
    for (const foe of opponents(this.state, actor)) {
      const idx = this.player(foe).company.findIndex((c) => c.id === targetCardId);
      if (idx >= 0) return this.doPoachAt(actor, { player: foe, zone: 'company', index: idx });
    }
    return { ok: false, reason: '目标不在场上' };
  }

  /** Bad project → dump it on `foe` (AI path / assignBad pending resolution). */
  protected doAssignBad(actor: PlayerId, foe: PlayerId): OkResult {
    const idx = this.player(actor).hand.findIndex(
      (c) => c.kind === 'project' && c.subtype === 'bad',
    );
    if (idx < 0) return { ok: false, reason: '手中无烂尾项目' };
    const [card] = this.player(actor).hand.splice(idx, 1);
    this.player(foe).projects.push(card as ProjectCard);
    this.log(`💣 ${this.side(actor)} 把 ${card.name} 塞给了 ${this.side(foe)}！`, 'attack');
    return { ok: true };
  }

  protected doLayoffAt(actor: PlayerId, ref: TargetRef): OkResult {
    if (!hasVP(this.state, actor, 'hr')) {
      return { ok: false, reason: '需要 HR VP 才能裁员' };
    }
    const mine = this.player(actor).company;
    const target = mine[ref.index];
    if (!target) return { ok: false, reason: '无此目标' };
    mine.splice(ref.index, 1);
    // Consultants are parasites (not real deck cards): drop them silently.
    if (target.kind !== 'consultant') this.state.discard.push(target);
    this.log(`✂️ ${this.side(actor)} 解雇了 ${target.name}`, 'good');
    return { ok: true };
  }

  protected doResignAt(actor: PlayerId, ref: TargetRef): OkResult {
    const foe = ref.player;
    const foeCompany = this.player(foe).company;
    const target = foeCompany[ref.index];
    if (!target || target.kind === 'consultant') {
      return { ok: false, reason: '无效目标' };
    }
    // Shield rule: an HR VP must be resigned first.
    const hrIdx = foeCompany.findIndex((c) => c.kind === 'vp' && c.dept === 'hr');
    if (hrIdx >= 0 && (target.kind !== 'vp' || target.dept !== 'hr')) {
      return { ok: false, reason: '需先辞掉对方的 HR VP' };
    }
    foeCompany.splice(ref.index, 1);
    this.state.discard.push(target);
    this.log(`👋 ${this.side(actor)} 迫使 ${target.name} 从 ${this.side(foe)} 辞职`, 'attack');
    return { ok: true };
  }

  protected doReleaseAt(actor: PlayerId, ref: TargetRef): OkResult {
    if (!hasVP(this.state, actor, 'eng') && !hasVP(this.state, actor, 'sales')) {
      return { ok: false, reason: '需要 Eng 或 Sales VP' };
    }
    const projects = this.player(ref.player).projects;
    const proj = projects[ref.index];
    if (!proj) return { ok: false, reason: '无此项目' };
    projects.splice(ref.index, 1);
    this.state.discard.push(proj);
    this.log(`🗑️ ${this.side(actor)} 废弃了 ${this.side(ref.player)} 的 ${proj.name}`, 'info');
    return { ok: true };
  }

  /** Direct project assignment to an explicit destination (AI path). House
   *  rule: assignment has NO VP gate — anyone can start any project on their
   *  own board; bad projects go to foes. The matching VP only adds bonuses
   *  (Eng: tech burn half + reward +50%; Sales: market reward +50%). */
  protected assignProjectAs(cardId: string, player: PlayerId, dest: PlayerId): OkResult {
    const p = this.player(player);
    const idx = p.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) return { ok: false, reason: '手牌中无此牌' };
    const card = p.hand[idx];
    if (card.kind !== 'project') return { ok: false, reason: '非项目牌' };
    p.hand.splice(idx, 1);
    this.player(dest).projects.push(card);
    if (dest !== player) {
      this.log(`💣 ${this.side(player)} 把 ${card.name} 塞给了 ${this.side(dest)}！`, 'attack');
    } else {
      this.log(`📋 ${this.side(player)} 启动了 ${card.name}`, 'info');
    }
    return { ok: true };
  }

  /** The 8 headhunter categories with remaining counts across deck + discard. */
  protected headhunterChoices(): HeadhunterChoice[] {
    const counts: Record<string, number> = {};
    for (const c of [...this.state.deck, ...this.state.discard]) {
      if (c.kind === 'vp') counts[`vp:${c.dept}`] = (counts[`vp:${c.dept}`] ?? 0) + 1;
      else if (c.kind === 'staff') counts[`staff:${c.role}`] = (counts[`staff:${c.role}`] ?? 0) + 1;
    }
    return HEADHUNTER_KEYS.map((key) => ({
      key,
      label: HEADHUNTER_LABELS[key],
      available: counts[key] ?? 0,
    }));
  }

  /** Take the first card of `category` from deck (preferred) else discard. */
  protected takeCategoryCard(category: string): Card | null {
    const [kind, key] = category.split(':') as [string, string];
    const match = (c: Card) =>
      kind === 'vp' ? c.kind === 'vp' && c.dept === key : c.kind === 'staff' && c.role === key;
    for (const pile of [this.state.deck, this.state.discard]) {
      const i = pile.findIndex(match);
      if (i >= 0) return pile.splice(i, 1)[0];
    }
    return null;
  }

  private indexOfAction(player: PlayerId, act: string): number {
    return this.player(player).hand.findIndex(
      (c) => c.kind === 'action' && c.act === act,
    );
  }
}
