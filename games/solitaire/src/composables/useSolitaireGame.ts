// Central state orchestrator — mirrors othello's `useOthelloGame` pattern:
// `shallowRef` holds the engine state, an `afterChange()` hook re-publishes
// state + persists + checks win, and exposed actions wrap the framework-agnostic engine.
//
// Vue's reactivity only sees the top-level `state` ref reassignment; deep
// mutation happens inside the engine and we re-publish a new state object each
// time (so shallowRef is correct — see memories/othello-vue-migration.md).
//
// Action-unit executor: 收龙 and every auto-move cascade are ONE model — the
// engine generates + applies a unit (beginUnit → stepUnit* → endUnit, see
// engine.ts) and consumeUnit() animates each step with a single FLIP, then
// asks for the next. Each step is applied only AFTER the animation layer has
// seen the card at its current spot (the DOM still renders the pre-commit
// layout until nextTick), so data and display stay in lockstep — nothing
// can vanish while other cards fly (the old commit-then-fly "数字牌消失"
// bug is structurally impossible here).

import { SolitaireEngine, type UnitAction } from '@solitaire/game/engine';
import * as Rules from '@solitaire/game/rules';
import { fromLayout } from '@solitaire/game/state';
import type {
  Card,
  CardColor,
  DestDescriptor,
  MoveResult,
} from '@solitaire/game/types';
import { winGifFor } from '@solitaire/lib/winGif';
import { Storage } from '@solitaire/storage';
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import {
  FLIP_SETTLE_MS,
  FLY_MS,
  STAGGER_MS,
  flyCardHome,
  flyCardTo,
} from './animateAutoMoves';
import { Audio, getMuted as audioGetMuted, setMuted as audioSetMuted } from './useAudio';

export function useSolitaireGame() {
  const engine = new SolitaireEngine();
  const state = shallowRef(engine.state);
  const wins = ref(Storage.getWins());
  /** The celebration gif for the current win — hash-picked from the LAST
   *  collected card when onWin fires (see src/lib/winGif.ts). Defaults to
   *  2.gif until a win records a card. */
  const winGif = ref('/images/2.gif');
  const muted = ref(Storage.getMuted());
  /** Set true after a win; UI overlays reset to false on new game. */
  const won = ref(false);
  /** Set true once the dealing animation starts; UI clears it when finished. */
  const justDealt = ref(false);
  /**
   * True while an action unit is being consumed (收龙 flight, the post-move
   * cascade, or the post-deal settle) — the drag guard, undo and hint ignore
   * the board until the last card lands. Replaces the old `collecting` +
   * `autoMovingIds` pair: with the executor, one flag covers every flight.
   */
  const busy = ref(false);
  /**
   * A win detected while a unit is still being consumed. The overlay must
   * wait until every card has landed — otherwise the "恭喜通关" dialog pops
   * mid-animation over flying cards. `onWin` only records the flag (+ bumps
   * the persisted counter); `flushWinIfIdle()` — called by the consume
   * settle and the no-animation paths — releases `won` once nothing is
   * airborne.
   */
  let pendingWin = false;
  /** Set by newGame() to abort the running consumption (board is replaced). */
  let consumeCanceled = false;
  /** The in-flight consumption promise (re-entrancy guard for consumeUnit). */
  let consumePromise: Promise<void> | null = null;

  /**
   * Busy watchdog: if `busy` stays true longer than any legitimate flight
   * chain (worst case ~40 steps × 200ms stagger + 400ms landing ≈ 8s), force-
   * release it so the action buttons can never be wedged by a hung
   * animation chain (covers paths the consumeUnit guard can't see).
   */
  let busyWatchdog = 0;
  watch(busy, (v) => {
    if (busyWatchdog) {
      clearTimeout(busyWatchdog);
      busyWatchdog = 0;
    }
    if (!v) return;
    busyWatchdog = window.setTimeout(() => {
      if (busy.value) {
        // eslint-disable-next-line no-console
        console.error('[solitaire] busy watchdog fired — force releasing busy');
        busy.value = false;
      }
    }, 15_000);
  });

  // Boot: restore any in-progress save, then collapse the safe auto-moves.
  const saved = Storage.loadGame();
  if (saved) {
    engine.setState(
      fromLayout({
        tableau: saved.tableau,
        freeCells: saved.freeCells,
        foundations: saved.foundations,
        flowerSlot: saved.flowerSlot,
        history: saved.history ?? [],
      }),
    );
    engine.applyAutoMoves(); // no-animation convergence (boot / restore)
    state.value = engine.getState();
  }

  // Wire engine callbacks. Sounds are routed to the singleton Audio; a win
  // bumps the persisted win counter and flags `won` for the overlay.
  engine.onSound = (name) => {
    switch (name) {
      case 'move':
        Audio.move();
        break;
      case 'place':
        Audio.place();
        break;
      case 'foundation':
        Audio.foundation();
        break;
      case 'flower':
        Audio.flower();
        break;
      case 'dragon':
        Audio.dragon();
        break;
      case 'win':
        Audio.win();
        break;
    }
  };
  engine.onWin = (lastCard) => {
    wins.value += 1;
    Storage.setWins(wins.value);
    // Pick the celebration gif NOW — the last collected card is final at
    // detection time, and the reveal only ever shows this value.
    winGif.value = winGifFor(lastCard);
    // Never reveal the overlay here: a win that lands mid-flight (the last
    // auto-moved card reaching its foundation IS the win) must wait for the
    // flight to settle so the dialog appears after the animation. The
    // no-flight paths call flushWinIfIdle() right after the move.
    pendingWin = true;
  };

  // Sync the persisted mute flag into the singleton.
  audioSetMuted(audioGetMuted());
  if (muted.value) audioSetMuted(true);

  // Computed-from-state.value so they re-evaluate when we re-publish a new top-level state object.
  const canUndo = computed(() => state.value.history.length > 0);
  const dragonReadyColor = computed<CardColor | null>(() =>
    Rules.readyDragonColor(state.value),
  );

  /** Re-publish state as a NEW top-level object reference (shallow clone).
   *
   *  The engine mutates the game state IN PLACE (`splice`/`pop`/array index
   *  assignment on the same object), so just reassigning `state.value = engine.getState()`
   *  shares the same reference and Vue's shallowRef sees no change → no re-render.
   *  A shallow spread produces a new top-level object every change, which
   *  triggers shallowRef + the v-for / computed re-evaluations above.
   *  (Inner arrays still share reference; v-for detects length/key changes.) */
  function afterChange(): void {
    publish();
    persist();
  }

  /** Re-publish state as a NEW top-level object reference → Vue re-renders
   *  the board with the engine's CURRENT state. Does NOT persist: the action
   *  unit executor calls this once per step (each card must render into its
   *  destination slot before flyCardTo tweens it home) while persisting once
   *  per UNIT (see consumeUnit's finally) to keep unit atomicity. */
  function publish(): void {
    state.value = { ...engine.getState() };
  }

  /** Persist the current state (undo stack included). */
  function persist(): void {
    Storage.saveGame(state.value);
  }

  /**
   * Apply the engine's auto-move cascade to convergence with NO animation
   * and NO undo snapshot — used by the hint path to mirror the solver's
   * leading auto-moves (the solver collapses the initial flower/safe-number
   * cascade BEFORE the first user step; the engine must do the same or the
   * first step's from/to coordinates land on a stale board). The user step
   * that follows begins its own unit (beginUnit) whose snapshot captures
   * the post-cascade board, so undoing the hint reverts everything.
   */
  function applyAutoMoves(): void {
    if (busy.value || justDealt.value) return;
    // Open the undo unit BEFORE the cascade so the snapshot covers the
    // leading auto-moves too: the hint's user step (moveCardAnimated) sees
    // an open unit and reuses this snapshot (see engine.beginUnit), making
    // ONE undo revert the whole hint action — auto-moves included — exactly
    // like undoing a drag whose cascade also sits inside its unit.
    engine.beginUnit('move');
    engine.applyAutoMoves();
    publish();
  }

  function moveCard(run: Card[] | null, dest: DestDescriptor): MoveResult {
    // A unit is already being consumed (or the deal is still landing) — the
    // board is mid-animation and its state is about to settle; reject.
    if (busy.value || justDealt.value) return { ok: false, reason: 'busy' };

    engine.beginUnit('move'); // undo snapshot for the whole unit
    const result = engine.move(run, dest); // the user step only — no cascade
    if (!result.ok) {
      engine.abortUnit(); // pop the snapshot; nothing changed
      return result;
    }

    publish(); // render the user step into its destination (drag settle tweens from the parked spot)

    // No auto-move follows this step? Skip the lock entirely: nothing is
    // about to fly, and the drop settle tween only animates the dropped
    // run's own elements — another card can be dragged the very next frame
    // (a fast follow-up move never gets parked or swallowed). The win
    // reveal still waits for the settle tween to land (same timing as the
    // cascade path), and the unit settles synchronously (checkWin + persist
    // once per unit).
    if (!Rules.nextAutoMove(engine.getState())) {
      engine.endUnit(); // checkWin — a win lands mid-settle; overlay waits
      afterChange(); // persist once per unit
      setTimeout(() => flushWinIfIdle(), FLIP_SETTLE_MS);
      return result;
    }

    busy.value = true;
    // The dropped run is still settling (FLIP_SETTLE_MS) — start consuming
    // the cascade only after it lands, so the settle and the cascade's first
    // step never race over the same card's transform channel.
    setTimeout(() => void consumeUnit(), FLIP_SETTLE_MS);
    return result;
  }

  /**
   * Hint-path user move WITH a FLIP flight: same engine commit + unit
   * lifecycle as moveCard, but the run flies from its source slot to the
   * destination one card at a time (flyCardHome), then the auto-move
   * cascade continues as usual. The drag path can't share this — its settle
   * tween is owned by the drag controller (the run lands wherever the
   * pointer dropped it).
   */
  function moveCardAnimated(run: Card[] | null, dest: DestDescriptor): MoveResult {
    if (busy.value || justDealt.value) return { ok: false, reason: 'busy' };

    engine.beginUnit('move');
    const result = engine.move(run, dest);
    if (!result.ok) {
      engine.abortUnit();
      return result;
    }

    busy.value = true;
    // Engine applied the step — the DOM still renders the pre-commit layout
    // (nothing published yet): grab each card's source rect now, then
    // publish moves them into the destination slot (same lockstep rule as
    // consumeUnit).
    const fromRects = new Map<string, DOMRect | null>();
    for (const card of run ?? []) {
      const el = document.querySelector<HTMLElement>(
        `.card[data-id="${card.id}"]`,
      );
      fromRects.set(card.id, el ? el.getBoundingClientRect() : null);
    }
    publish();
    void (async () => {
      try {
        await nextTick(); // Vue renders the run into its destination slot
        const flights: Promise<void>[] = [];
        for (const card of run ?? []) {
          const el = document.querySelector<HTMLElement>(
            `.card[data-id="${card.id}"]`,
          );
          const fromRect = fromRects.get(card.id) ?? null;
          if (el && fromRect) {
            flights.push(flyCardHome(el, fromRect));
          }
          // Rect lost (theoretical) — the card is already rendered at its
          // destination; land it without a tween (nothing to clean up).
        }
        // Wait for the whole run to land before consuming the cascade, so the
        // first auto-move never races a still-flying card.
        await Promise.all(flights);
        void consumeUnit();
      } catch (err) {
        // The flight chain must never wedge `busy` — if anything above threw
        // (layout read, style write, nextTick), release the lock so the board
        // stays interactive; the engine unit is settled by consumeUnit's own
        // finally below only if it ran, so end the unit here instead.
        // eslint-disable-next-line no-console
        console.error('[solitaire] moveCardAnimated flight failed', err);
        engine.endUnit();
        busy.value = false;
        afterChange();
        flushWinIfIdle();
      }
    })();
    return result;
  }

  /** Collect dragons — auto-picks the first ready colour, or a caller-chosen
   *  one (the 💡 hint executes solver steps, which name the colour). Begins a
   *  收龙 unit (validation + undo snapshot only); the dragon steps and the
   *  auto-move cascade are consumed one at a time by consumeUnit(). */
  function collectDragons(color?: CardColor): boolean {
    const c = color ?? engine.dragonReady();
    if (!c) return false;
    if (busy.value || justDealt.value) return false;
    if (!engine.collectDragons(c)) return false; // beginUnit('dragon')
    busy.value = true;
    void consumeUnit(); // no settle to wait for — start right away
    return true;
  }

  /** Resolve the destination slot element for a unit step. */
  function resolveTarget(to: UnitAction['to']): HTMLElement | null {
    if (to.type === 'dragonpile') {
      return document.querySelector<HTMLElement>(
        `.slot.free-cell[data-slot="fc-${to.index}"]`,
      );
    }
    if (to.type === 'flower') {
      return document.querySelector<HTMLElement>('.slot.flower-slot');
    }
    if (to.type === 'foundation') {
      return document.querySelector<HTMLElement>(`.slot.foundation.c-${to.color}`);
    }
    return null; // unit steps never target columns / free cells
  }

  /**
   * The action-unit executor: consume every remaining step of the current
   * engine unit (dragon steps, then the auto-move cascade), animating each
   * card with a single FLIP. Steps interleave — a new step is generated +
   * applied every STAGGER_MS while the previous card is still airborne, so
   * the cadence matches the old flyCardsHome (320ms flight, 200ms between
   * take-offs).
   *
   * Lockstep guarantee: engine.stepUnit() mutates only the ENGINE state;
   * the DOM still shows the pre-step layout until the nextTick below, so the
   * card's rect is read while it still renders at its CURRENT spot — then
   * Vue moves it into the destination slot and flyCardTo tweens it home.
   */
  /** Hard cap on unit steps per consumption — a card can move to a foundation
   *  at most once and a dragon at most once, so a healthy cascade can never
   *  exceed ~40 steps; hitting this means the engine failed to converge and
   *  the while loop would otherwise spin forever, wedging `busy` and leaving
   *  every action button disabled. Breaking out still runs the finally below
   *  (busy release + endUnit + persist). */
  const MAX_UNIT_STEPS = 400;

  async function consumeUnit(): Promise<void> {
    if (consumePromise) return consumePromise;
    const p = (async () => {
      let guard = 0;
      try {
        let action: UnitAction | null;
        let flew = false;
        while (
          guard++ < MAX_UNIT_STEPS &&
          (action = engine.stepUnit()) !== null
        ) {
          flew = true;
          if (consumeCanceled) break;
          // Engine applied the step — the DOM still shows the pre-step
          // layout (nothing triggered a render yet): grab the card's current
          // (source) rect now.
          const el = document.querySelector<HTMLElement>(
            `.card[data-id="${action.id}"]`,
          );
          const fromRect = el ? el.getBoundingClientRect() : null;
          // Render THIS step: the card moves into its destination slot (v-for
          // key reuse keeps the element; cards from earlier steps keep their
          // in-flight inline transform untouched).
          publish();
          await nextTick(); // Vue renders the card into its destination slot
          const targetEl = resolveTarget(action.to);
          const el2 = document.querySelector<HTMLElement>(
            `.card[data-id="${action.id}"]`,
          );
          if (el2 && fromRect && targetEl) {
            // Interleave: start the flight without awaiting it — the next
            // step takes off after STAGGER_MS while this card is airborne.
            void flyCardTo(el2, fromRect, targetEl);
          } else if (el2 && targetEl) {
            // Rect was lost (theoretical) — land the card without a tween.
            el2.style.transition = '';
            el2.style.transform = '';
            el2.style.zIndex = '';
          }
          await new Promise((r) => setTimeout(r, STAGGER_MS));
        }
        if (guard > MAX_UNIT_STEPS) {
          // eslint-disable-next-line no-console
          console.error('[solitaire] consumeUnit guard exceeded — engine failed to converge; forced release');
        }
        // Only wait for the last card to land when there WAS a flight — an
        // empty cascade (a move with no auto-moves) has nothing airborne,
        // and the extra FLY_MS would just lengthen the input lock for no
        // reason (the drag guard releases on busy → false).
        if (flew) await new Promise((r) => setTimeout(r, FLY_MS + 60));
      } finally {
        // Release the busy flag BEFORE settling the win — flushWinIfIdle
        // only reveals a held-back win when nothing is busy.
        busy.value = false;
        if (consumeCanceled) {
          consumeCanceled = false; // newGame replaced the board — nothing to settle
        } else {
          engine.endUnit(); // checkWin — the board is fully settled now
          afterChange(); // persist ONCE per unit (unit atomicity: a refresh mid-flight reverts to the pre-unit state)
          flushWinIfIdle();
        }
      }
    })();
    // CRITICAL: the async IIFE above may complete SYNCHRONOUSLY (a cascade
    // with zero steps never awaits), which runs its `finally` BEFORE the
    // `consumePromise = p` assignment below — clearing the variable inside
    // the IIFE would then be a no-op and this finished promise would stay
    // latched forever, making every later consumeUnit() a RE-ENTER that
    // never releases `busy` (the "undo stuck" bug). Clean up from OUTSIDE
    // the IIFE instead, where the assignment has definitely happened.
    consumePromise = p;
    void p.finally(() => {
      if (consumePromise === p) consumePromise = null;
    });
    return consumePromise;
  }

  function undo(): boolean {
    if (busy.value) return false;
    const wasUndone = engine.undo();
    if (wasUndone) {
      // Close any unit left open by a failed hint step (the hint path opens
      // the unit BEFORE mirroring the solver's leading auto-moves; if the
      // following user step fails, the unit lingers). The restored board
      // predates that unit, so leaving it open would make the NEXT
      // beginUnit('move') reuse it without snapping a fresh undo snapshot —
      // that move would be impossible to undo. endUnit is a no-op when no
      // unit is open; its checkWin is safe here (a restored board is never
      // a winning one — wins can't be undone into).
      engine.endUnit();
      // The board is no longer in a winning state — drop any held-back win
      // AND hide the WinCard emblem (it was shown for the winning board).
      pendingWin = false;
      won.value = false;
      afterChange();
      // Undo is instant (no tween): strip any mid-settle inline transform /
      // transition the drag controller left on cards, so the restored layout
      // renders clean instead of cards hovering at a stale park position.
      document.querySelectorAll<HTMLElement>('#board .card').forEach((el) => {
        el.style.transition = '';
        el.style.transform = '';
      });
    }
    return wasUndone;
  }

  function newGame(): void {
    // A unit may still be consuming (the 新局 button stays enabled mid-
    // flight) — cancel it; the replaced board makes any further step moot.
    // Only set the flag when a consumption is ACTUALLY running: the flag
    // stays latched until the next consumeUnit settles, and an idle new
    // game must not swallow the post-deal settle's cascade (its consumeUnit
    // would see a stale true and skip every step).
    if (busy.value) consumeCanceled = true;
    engine.newGame();
    state.value = engine.getState();
    won.value = false;
    pendingWin = false;
    // Restart the dealing flow even when a deal is ALREADY playing (the 新局
    // button stays enabled mid-deal): the false→true transition re-fires
    // useDealing's watch, which bumps its deal generation and aborts the
    // superseded deal's timers. A bare `= true` on an already-true flag would
    // not re-fire the watch, and the replaced board would sit static — no
    // fly-in, no post-deal settle (and the old deal's timers would keep
    // yanking the new board's cards around).
    justDealt.value = false;
    justDealt.value = true;
    Storage.saveGame(state.value); // persist the fresh deal; reload should NOT revert to a stale save
  }

  /**
   * Reveal a win that was held back during unit consumption. Called from the
   * consume settle and the no-animation paths. The win counter is already
   * bumped (persisted) at detection time; this only reveals the overlay.
   */
  function flushWinIfIdle(): void {
    if (pendingWin && !busy.value) {
      pendingWin = false;
      won.value = true;
    }
  }

  /**
   * Collapse the safe auto-moves AFTER the dealing animation has finished
   * (post-deal settle): begins a unit and consumes the cascade with the same
   * executor — cards fly from their dealt spot to flower/foundation one at a
   * time. Resolves when the last card lands (a fresh deal could be an
   * instant win — endUnit checks it).
   */
  function settleAfterDeal(): Promise<void> {
    engine.beginUnit('move');
    busy.value = true;
    return consumeUnit();
  }

  function toggleMute(): void {
    muted.value = !muted.value;
    Storage.setMuted(muted.value);
    audioSetMuted(muted.value);
  }

  /** Compute legal drop targets for a candidate run from the current state. */
  function validDropTargets(run: Card[]): DestDescriptor[] {
    return Rules.validDropTargets(state.value, run);
  }
  function grabRun(cardId: string): Card[] | null {
    return Rules.grabRunFromTableau(state.value, cardId);
  }

  return {
    state,
    wins,
    winGif,
    muted,
    won,
    justDealt,
    /** True while an action unit (收龙 / cascade) is being consumed. */
    busy,
    canUndo,
    dragonReadyColor,
    moveCard,
    moveCardAnimated,
    collectDragons,
    applyAutoMoves,
    undo,
    newGame,
    settleAfterDeal,
    flushWinIfIdle,
    toggleMute,
    validDropTargets,
    grabRun,
    /** Engine instance — exposed for the drag controller & dealing composable. */
    engine,
  };
}

export type SolitaireGameApi = ReturnType<typeof useSolitaireGame>;
