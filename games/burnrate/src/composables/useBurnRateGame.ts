// Central state orchestrator — mirrors solitaire's `useSolitaireGame` pattern:
// `shallowRef` holds the engine state, an `afterChange()` hook re-publishes
// state + persists, and exposed actions wrap the framework-agnostic engine.
//
// Multiplayer: players are `PlayerId` indices (0 = human). Each AI slot has a
// configured difficulty; `phase` is the current player index ('over' at end).
// When the human goes bankrupt the game keeps running for the AIs — the UI can
// offer accelerated spectating via `startSpectate`.
//
// Vue's reactivity only sees the top-level `state` ref reassignment; the
// engine mutates IN PLACE, so we re-publish a new top-level object each change
// (a shallow spread) to trigger shallowRef + the v-for/computed re-evaluations.

import type { GameStats } from '@burnrate/game/achievements';
import { chooseAiCompletions, createAiAdapter, makeAiContext } from '@burnrate/game/ai';
import { AI_TIME_LIMIT_MS, HAND_CAP } from '@burnrate/game/constants';
import { BurnRateEngine, type OkResult } from '@burnrate/game/engine';
import { defaultRng } from '@burnrate/game/rng';
import { calcBurn, hasVP } from '@burnrate/game/rules';
import type {
    AiAction,
    AiDifficulty,
    Card,
    DiceRollOutcome,
    GameState,
    HeadhunterChoice,
    LogType,
    PendingTarget,
    PlayerId,
    TargetRef,
    TurnResult,
} from '@burnrate/game/types';
import { Storage } from '@burnrate/storage';
import { computed, reactive, ref, shallowRef } from 'vue';
import MctsWorker from '../game/ai/mcts/mcts.worker.ts?worker';
import { Audio, setMuted as audioSetMuted } from './useAudio';

function sameRef(a: TargetRef, b: TargetRef): boolean {
  return a.player === b.player && a.zone === b.zone && a.index === b.index;
}

export interface GameSetup {
  playerCount: number;
  /** Difficulty per AI slot (length = playerCount - 1). */
  difficulties: AiDifficulty[];
}

export interface GameOverInfo {
  winner: PlayerId;
  stats: GameStats;
}

export function useBurnRateGame(initial: GameSetup | null = null) {
  const engine = new BurnRateEngine();
  const state = shallowRef<GameState>(engine.state);
  const wins = ref(Storage.getWins());
  const muted = ref(Storage.getMuted());

  /** True when a saved in-progress match exists (show the "continue" overlay). */
  const hasSave = ref(false);
  /** Whose turn it is (player index), or 'over'. Drives the AI-turn watcher. */
  const phase = ref<PlayerId | 'over'>(0);
  const won = ref(false);
  const lost = ref(false);
  /** True while the AI turn choreography runs (UI locked). */
  const aiBusy = ref(false);
  /** True while an MCTS search runs in the worker (show "thinking"). */
  const aiThinking = ref(false);
  /** True once the human is out but the AIs keep playing (spectate mode). */
  const spectate = ref(false);
  /** Difficulty configured per AI slot (slot i → index i-1). */
  const aiConfigs = ref<AiDifficulty[]>([]);
  /** Non-null while a target-requiring action awaits a pick. */
  const targeting = ref<TargetRef[] | null>(null);
  /** The action kind behind the pending target selection. */
  const targetingAct = ref<PendingTarget['act'] | null>(null);
  /** How many targets must be picked before the action resolves (layoff bulk
   *  pick = 1 + HR skill; 1 for everything else). */
  const targetingPickCount = ref(1);
  /** Targets already picked while a multi-pick (layoff) is pending. */
  const targetingSelected = ref<TargetRef[]>([]);
  /** For player-choosing actions (audit/consultant/bad project). */
  const targetChoices = ref<PlayerId[] | null>(null);
  /** Non-null while a headhunter category pick is pending. */
  const pendingPick = ref<HeadhunterChoice[] | null>(null);
  /** Turn-end confirm / discard-and-redraw mode. Every submit opens it. */
  const redrawOpen = ref(false);
  const redrawSelected = ref<string[]>([]);
  /** True while the new-deal fly-in runs (all Cards render noLayout). */
  const justDealt = ref(false);
  /** Card ids currently mid-flight (draw animations) — noLayout for those. */
  const animIds = ref<string[]>([]);
  /** AI hand card currently highlighted as "about to play". */
  const aiHighlightId = ref<string | null>(null);
  /** Last turn result (settlement animations). */
  const turnResult = ref<TurnResult | null>(null);
  /** Burn amounts settled last turn, per player. */
  const lastBurn = ref<number[]>([]);
  /** End-of-game payload for the achievements bridge. */
  const lastGameOver = ref<GameOverInfo | null>(null);
  /** Invalid-action toast text (auto-dismissed). */
  const invalidMsg = ref<string | null>(null);

  // Per-game counters assembled from engine.onLog messages (which the engine
  // generates with stable wording). '你' = human actions only.
  const stats = reactive({
    badAssigned: 0,
    projectsCompleted: 0,
    layoffs: 0,
    headhunters: 0,
    consultantsSent: 0,
    vpsHired: 0,
    poaches: 0,
    burnouts: 0,
  });
  let auditKillFlag = false;
  let invalidTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- Engine callbacks ---------------------------------------------

  engine.onLog = (msg: string, _type: LogType) => {
    if (msg.includes('烂尾') && msg.includes('塞给了 AI')) stats.badAssigned++;
    if (msg.includes('🎉 你') && msg.includes('完成')) stats.projectsCompleted++;
    if (msg.includes('✂️ 你')) stats.layoffs++;
    if (msg.includes('通过猎头') && msg.includes('🎯 你')) stats.headhunters++;
    if (msg.includes('高价顾问') && msg.includes('🎩 你')) stats.consultantsSent++;
    if (msg.includes('雇佣了') && msg.includes('副总裁') && msg.includes('✅ 你')) stats.vpsHired++;
    if (msg.includes('挖走') && msg.includes('🎯 你')) stats.poaches++;
    if (msg.includes('🥧 你')) stats.burnouts++;
  };
  engine.onGameOver = (winner: PlayerId) => {
    finishGame(winner);
  };

  // ---- MCTS worker (async search off the main thread) ----------------

  let mctsWorker: InstanceType<typeof MctsWorker> | null = null;
  let workerResolve: ((a: AiAction | null) => void) | null = null;
  let workerTimer: ReturnType<typeof setTimeout> | null = null;

  function ensureWorker(): InstanceType<typeof MctsWorker> {
    if (!mctsWorker) {
      mctsWorker = new MctsWorker();
      mctsWorker.onmessage = (e: MessageEvent<{ type: 'action'; action: AiAction | null }>) => {
        if (workerTimer) clearTimeout(workerTimer);
        workerTimer = null;
        aiThinking.value = false;
        const resolve = workerResolve;
        workerResolve = null;
        resolve?.(e.data.action);
      };
    }
    return mctsWorker;
  }

  /** Ask the worker for one MCTS decision. Times out to null (end the AI's
   *  turn) as a safety net. */
  function mctsStep(player: PlayerId, difficulty: AiDifficulty): Promise<AiAction | null> {
    return new Promise((resolve) => {
      aiThinking.value = true;
      ensureWorker().postMessage({
        type: 'chooseAction',
        state: state.value,
        player,
        difficulty,
        seed: (Math.random() * 0xffffffff) >>> 0,
      });
      workerResolve = resolve;
      workerTimer = setTimeout(() => {
        workerTimer = null;
        aiThinking.value = false;
        const r = workerResolve;
        workerResolve = null;
        r?.(null);
      }, AI_TIME_LIMIT_MS + 500);
    });
  }

  // ---- Boot ----------------------------------------------------------

  function startNewGame(setup: GameSetup, firstPlayer?: PlayerId): void {
    engine.newGame(setup.playerCount, { firstPlayer });
    aiConfigs.value = setup.difficulties.slice();
    resetRound();
    // Publish a NEW top-level object (shallow copy) so the shallowRef fires —
    // `engine.newGame` mutates `engine.state` in place (same reference), and
    // reassigning the same object would leave the always-mounted UI stale.
    state.value = { ...engine.state };
    Storage.saveGame(state.value, aiConfigs.value);
    hasSave.value = false;
    justDealt.value = true; // useDrawAnimations plays the fly-in
    // The human may not start — kick the AI choreography into gear so the
    // dice-determined first player actually acts (watched by useAiTurn).
    if (firstPlayer !== undefined && firstPlayer !== 0) phase.value = firstPlayer;
  }

  // A saved match exists → show the continue overlay (don't auto-resume).
  // Otherwise start immediately with the provided setup (or the 1v1 default).
  const saved = Storage.loadGame();
  if (saved) {
    hasSave.value = true;
    aiConfigs.value = saved.difficulties;
  } else {
    startNewGame(initial ?? { playerCount: 2, difficulties: ['normal'] });
  }

  // ---- Publishing & persistence --------------------------------------

  /** Re-publish state as a NEW top-level object reference (shallow clone) so
   *  shallowRef + v-for/computed re-evaluate, then persist. */
  function afterChange(): void {
    state.value = { ...engine.state };
    Storage.saveGame(state.value, aiConfigs.value);
  }

  // ---- Player actions -------------------------------------------------

  function playCard(card: Card): void {
    if (phase.value !== 0 || aiBusy.value || justDealt.value) return;
    if (card.kind === 'vp' || card.kind === 'staff') {
      const r = engine.hireCard(card.id, 0);
      if (r.ok) {
        Audio.hire();
        afterChange();
      } else fail(r);
    } else if (card.kind === 'project') {
      const r = engine.assignProject(card.id, 0);
      if (r.status === 'done') {
        Audio.play();
        afterChange();
      } else if (r.status === 'awaitTarget') {
        Audio.click();
        targeting.value = r.targets;
        targetingAct.value = r.act;
        targetChoices.value = r.playerChoices ?? null;
        targetingPickCount.value = r.pickCount ?? 1;
        targetingSelected.value = [];
        afterChange();
      } else {
        fail({ ok: false, reason: 'reason' in r ? r.reason : '无法执行' });
      }
    } else if (card.kind === 'action') {
      const r = engine.playAction(card.id, 0);
      if (r.status === 'done') {
        Audio.play();
        afterChange();
      } else if (r.status === 'awaitTarget') {
        Audio.click();
        targeting.value = r.targets;
        targetingAct.value = r.act;
        targetChoices.value = r.playerChoices ?? null;
        targetingPickCount.value = r.pickCount ?? 1;
        targetingSelected.value = [];
        afterChange();
      } else if (r.status === 'awaitPick') {
        Audio.click();
        pendingPick.value = r.choices;
        afterChange();
      } else {
        fail({ ok: false, reason: r.reason });
      }
    }
  }

  function fail(r: OkResult): void {
    Audio.error();
    invalidMsg.value = r.reason ?? '无法执行';
    if (invalidTimer) clearTimeout(invalidTimer);
    invalidTimer = setTimeout(() => {
      invalidMsg.value = null;
    }, 2600);
  }

  function dismissInvalid(): void {
    if (invalidTimer) clearTimeout(invalidTimer);
    invalidMsg.value = null;
  }

  /** Complete a project on `player`'s board (human path: click on own project). */
  function completeProject(index: number, player: PlayerId = 0): void {
    if (player === 0 && (phase.value !== 0 || aiBusy.value)) return;
    const r = engine.completeProject(index, player);
    if (r.ok) {
      Audio.coin();
      afterChange();
    } else fail(r);
  }

  function selectTarget(ref: TargetRef): void {
    if (!targeting.value) return;
    // Layoff bulk pick: collect until pickCount refs are chosen, then resolve
    // them in one engine call. Everything else resolves immediately.
    if (targetingPickCount.value > 1) {
      if (targetingSelected.value.some((s) => sameRef(s, ref))) return;
      const next = [...targetingSelected.value, ref];
      targetingSelected.value = next;
      if (next.length < targetingPickCount.value) {
        Audio.click();
        return;
      }
      const r = engine.selectTargets(next);
      clearTargeting();
      if (r.ok) {
        Audio.attack();
        afterChange();
      } else fail(r);
      return;
    }
    const r = engine.selectTarget(ref);
    clearTargeting();
    if (r.ok) {
      Audio.attack();
      afterChange();
    } else fail(r);
  }

  function clearTargeting(): void {
    targeting.value = null;
    targetingAct.value = null;
    targetChoices.value = null;
    targetingPickCount.value = 1;
    targetingSelected.value = [];
  }

  /** "High exec feud" layoff mode: pick 1 VP + 1 consultant of your own
   *  company to implode together (no HR VP needed). */
  function startFeudLayoff(): void {
    if (phase.value !== 0 || aiBusy.value) return;
    const r = engine.startFeudLayoff(0);
    if (r.status === 'awaitTarget') {
      targeting.value = r.targets;
      targetingAct.value = r.act;
      targetingPickCount.value = r.pickCount ?? 1;
      targetingSelected.value = [];
      Audio.click();
    } else if ('reason' in r) {
      fail({ ok: false, reason: r.reason });
    }
  }

  function cancelTargeting(): void {
    engine.cancelPending();
    clearTargeting();
    afterChange();
  }

  function pickHeadhunter(category: string): void {
    const r = engine.pickHeadhunter(category);
    pendingPick.value = null;
    if (r.ok) {
      Audio.draw();
      afterChange();
    } else fail(r);
  }

  // ---- Turn flow ------------------------------------------------------

  /** Ask to end the human's turn — always opens the confirm gate, where a
   *  Finance VP may additionally discard-and-redraw. Closing (cancelRedraw)
   *  aborts the submit entirely. */
  function askEndTurn(): void {
    if (phase.value !== 0 || aiBusy.value || justDealt.value) return;
    redrawOpen.value = true;
    redrawSelected.value = [];
  }

  /** Toggle a hand card for discard — meaningful with a Finance VP (free
   *  exchange) or whenever the hand exceeds the cap (forced trim). */
  function toggleRedraw(id: string): void {
    const overCap = (state.value.players[0]?.hand.length ?? 0) > HAND_CAP;
    if (!hasVP(state.value, 0, 'fin') && !overCap) return;
    const i = redrawSelected.value.indexOf(id);
    if (i >= 0) redrawSelected.value.splice(i, 1);
    else redrawSelected.value.push(id);
  }

  /** Confirm the turn end: optional Fin-VP exchange, then hand-cap trimming,
   *  then settle. With zero picks this is a plain "end turn" confirm. */
  function confirmRedraw(): void {
    redrawOpen.value = false;
    const ids = redrawSelected.value.slice();
    redrawSelected.value = [];
    if (ids.length && hasVP(state.value, 0, 'fin')) {
      engine.discardAndDraw(ids, 0); // Fin VP: exchange N for N
      engine.discardToCap([], 0); // then trim any surplus (auto fallback)
    } else {
      // Cap enforcement (or plain end): picked cards first, auto-trim the rest.
      engine.discardToCap(ids, 0);
    }
    afterChange();
    doEndTurn();
  }

  /** Abort the submit — nothing happens, the player keeps their turn. */
  function cancelRedraw(): void {
    redrawOpen.value = false;
    redrawSelected.value = [];
  }

  function doEndTurn(): void {
    const st = engine.state;
    // auditKill: the human's Audit bankrupts an opponent this same turn
    // (approximation: foe is audited, has no Fin VP, and the burn will zero
    // them). The foe must have spent their bailout — otherwise the emergency
    // financing refunds them and the Audit merely saves their life.
    auditKillFlag = st.players.some(
      (p, i) =>
        i !== 0 &&
        p.alive &&
        p.auditThisTurn &&
        !hasVP(st, i, 'fin') &&
        p.bailoutUsed &&
        calcBurn(st, i) >= p.cash,
    );
    lastBurn.value = st.players.map((_, i) => calcBurn(st, i));
    if (lastBurn.value.some((b) => b > 0)) Audio.burn();
    const res = engine.endTurn(0);
    turnResult.value = res;
    afterChange();
    if (!st.gameOver) phase.value = res.nextPlayer;
  }

  // ---- Bad-project rescue (house rules) --------------------------------

  /** Cash valve: pay 2×burn to abandon one of your own bad projects. */
  function abandonProject(cardId: string): OkResult {
    const r = engine.abandonBad(cardId, 0);
    if (r.ok) afterChange();
    return r;
  }

  /** 画大饼: sacrifice the listed engineers to clear a bad project. */
  function burnoutProject(cardId: string, engineerIds: string[]): OkResult {
    const r = engine.burnoutBad(cardId, engineerIds, 0);
    if (r.ok) afterChange();
    return r;
  }

  /** Free hand discard (house rule): once per turn, no compensation. */
  function discardCard(cardId: string): OkResult {
    const r = engine.discardCard(cardId, 0);
    if (r.ok) afterChange();
    return r;
  }

  /** Hand size vs the end-of-turn cap (8). */
  const handOverCap = computed(() => (state.value.players[0]?.hand.length ?? 0) > HAND_CAP);

  /** Explicit hand-cap discards (human picks first, engine auto-trims). */
  function discardForCap(ids: string[]): void {
    engine.discardToCap(ids, 0);
    afterChange();
  }

  function finishGame(winner: PlayerId): void {
    const isWin = winner === 0;
    won.value = isWin;
    lost.value = !isWin;
    phase.value = 'over';
    aiBusy.value = false;
    targeting.value = null;
    targetingAct.value = null;
    targetChoices.value = null;
    targetingPickCount.value = 1;
    targetingSelected.value = [];
    pendingPick.value = null;
    redrawOpen.value = false;
    if (isWin && !spectate.value) {
      wins.value += 1;
      Storage.setWins(wins.value);
      Audio.win();
    } else if (!spectate.value) {
      Audio.bankrupt();
    }
    const snap: GameStats = {
      wins: wins.value,
      won: isWin,
      finalCash: engine.state.players[0]?.cash ?? 0,
      badAssigned: stats.badAssigned,
      projectsCompleted: stats.projectsCompleted,
      layoffs: stats.layoffs,
      headhunters: stats.headhunters,
      consultantsSent: stats.consultantsSent,
      auditKill: auditKillFlag && isWin,
      vpsHired: stats.vpsHired,
      poaches: stats.poaches,
      bailoutUsed: engine.state.players[0]?.bailoutUsed ?? false,
      burnouts: stats.burnouts,
      wasStrictLowest: engine.state.players[0]?.wasStrictLowest ?? false,
    };
    lastGameOver.value = { winner, stats: snap };
    Storage.clearSave();
  }

  /** Enter accelerated spectate mode after the human went bankrupt (the AI
   *  players keep going until a final winner emerges). */
  function startSpectate(): void {
    spectate.value = true;
  }

  // ---- AI primitives (driven by useAiTurn) ---------------------------

  /** Difficulty configured for an AI slot (slot = player index - 1). */
  function difficultyOf(player: PlayerId): AiDifficulty {
    return aiConfigs.value[player - 1] ?? 'normal';
  }

  /** One AI play decision, possibly async (MCTS runs in the worker). */
  async function aiStep(player: PlayerId): Promise<AiAction | null> {
    const diff = difficultyOf(player);
    const adapter = createAiAdapter(diff);
    if (adapter.kind === 'mcts') return mctsStep(player, diff);
    return adapter.chooseAction(state.value, player, makeAiContext(diff, defaultRng));
  }

  function applyAiAction(action: AiAction, player: PlayerId): OkResult {
    const r = engine.applyAiAction(action, player);
    if (r.ok) afterChange();
    return r;
  }

  function aiCompletions(player: PlayerId): number[] {
    const diff = difficultyOf(player);
    const adapter = createAiAdapter(diff);
    return adapter.chooseCompletions?.(state.value, player) ?? chooseAiCompletions(state.value, player);
  }

  function completeProjectAi(index: number, player: PlayerId): void {
    const r = engine.completeProject(index, player);
    if (r.ok) afterChange();
  }

  function endAiTurn(player: PlayerId): void {
    const res = engine.endTurn(player);
    turnResult.value = res;
    afterChange();
    if (!engine.state.gameOver) phase.value = res.nextPlayer;
  }

  // ---- Lifecycle ------------------------------------------------------

  /** (Re)start with an explicit setup (StartScreen / new game). `firstPlayer`
   *  is the dice-determined starter (undefined = human starts, legacy). */
  function newGame(setup: GameSetup, firstPlayer?: PlayerId): void {
    startNewGame(setup, firstPlayer);
  }

  /** Pre-roll the opening dice for the UI's dice animation (deterministic via
   *  the engine's injected RNG). */
  function rollFirst(playerCount: number): DiceRollOutcome {
    return engine.rollFirst(playerCount);
  }

  function continueSaved(): void {
    const saved = Storage.loadGame();
    if (!saved) return;
    engine.restore(saved.state);
    state.value = { ...engine.state };
    hasSave.value = false;
    if (saved.state.gameOver) {
      // Defensive: a finished match shouldn't be persisted, but if it is,
      // replay the end-of-game flow.
      finishGame(saved.state.winner ?? 0);
      return;
    }
    phase.value = saved.state.currentPlayer;
    if (saved.state.currentPlayer === 0) {
      // Rebuild the pending UI state from a mid-resolution save.
      const pend = saved.state.pending;
      if (pend && pend.kind === 'target') {
        targeting.value = pend.targets;
        targetingAct.value = pend.act;
        targetChoices.value = pend.playerChoices ?? null;
        targetingPickCount.value = pend.pickCount ?? 1;
        targetingSelected.value = [];
      } else if (pend && pend.kind === 'headhunter') {
        pendingPick.value = pend.choices;
      }
    }
  }

  function resetRound(): void {
    won.value = false;
    lost.value = false;
    phase.value = 0;
    aiBusy.value = false;
    aiThinking.value = false;
    spectate.value = false;
    targeting.value = null;
    targetingAct.value = null;
    targetChoices.value = null;
    targetingPickCount.value = 1;
    targetingSelected.value = [];
    pendingPick.value = null;
    redrawOpen.value = false;
    redrawSelected.value = [];
    turnResult.value = null;
    lastBurn.value = [];
    lastGameOver.value = null;
    aiHighlightId.value = null;
    auditKillFlag = false;
    stats.badAssigned = 0;
    stats.projectsCompleted = 0;
    stats.layoffs = 0;
    stats.headhunters = 0;
    stats.consultantsSent = 0;
    stats.vpsHired = 0;
    stats.poaches = 0;
    stats.burnouts = 0;
  }

  function toggleMute(): void {
    muted.value = !muted.value;
    Storage.setMuted(muted.value);
    audioSetMuted(muted.value);
  }

  // ---- Computed --------------------------------------------------------

  const burnRates = computed(() =>
    state.value.players.map((_, i) => calcBurn(state.value, i)),
  );

  /** Human player convenience (the template reads `players[0]` directly, but
   *  this survives empty-state during construction). */
  const me = computed(() => state.value.players[0]);

  return {
    engine,
    state,
    wins,
    muted,
    hasSave,
    phase,
    won,
    lost,
    aiBusy,
    aiThinking,
    spectate,
    aiConfigs,
    targeting,
    targetingAct,
    targetingPickCount,
    targetingSelected,
    targetChoices,
    pendingPick,
    redrawOpen,
    redrawSelected,
    justDealt,
    animIds,
    aiHighlightId,
    turnResult,
    lastBurn,
    lastGameOver,
    invalidMsg,
    burnRates,
    me,
    newGame,
    rollFirst,
    continueSaved,
    startSpectate,
    playCard,
    completeProject,
    selectTarget,
    cancelTargeting,
    startFeudLayoff,
    pickHeadhunter,
    askEndTurn,
    toggleRedraw,
    confirmRedraw,
    cancelRedraw,
    abandonProject,
    burnoutProject,
    discardCard,
    handOverCap,
    discardForCap,
    aiStep,
    applyAiAction,
    aiCompletions,
    completeProjectAi,
    endAiTurn,
    toggleMute,
    dismissInvalid,
  };
}

export type BurnRateGameApi = ReturnType<typeof useBurnRateGame>;
