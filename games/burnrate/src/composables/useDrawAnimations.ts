// Draw / deal fly-in animations — drives the REAL cards with plain CSS
// transforms (no ghost clones), mirroring solitaire's `useDealing`:
//
//   1. Let Vue paint the cards at their final positions (Card renders with
//      noLayout so motion-v's layout FLIP never fights the hand-rolled flight).
//   2. Snap every card to the stock anchor (`#stock-anchor` in the topbar)
//      with transition:none, then force one style recalc so the browser
//      commits the snap as the CSS transition's start value.
//   3. Fly each card home, staggered.
//   4. Strip inline styles once everything has landed.
//
// Two triggers:
//   * newGame → both hands fly in from the stock (AI first, then the human).
//   * any human hand growth (turn refill, headhunter pick) → new tail cards
//     fly in from the stock.

import { nextTick, watch } from 'vue';
import type { BurnRateGameApi } from './useBurnRateGame';

const FLY_MS = 260;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const STAGGER_MS = 85;
/** In-flight cards stack above everything else. */
const FLY_Z = 9000;

interface FlyCard {
  id: string;
  el: HTMLElement;
  rect: DOMRect;
}

export function useDrawAnimations(game: BurnRateGameApi): void {
  let busy = false;

  // New game: fly both hands in from the stock.
  // immediate: covers the boot-time value (no-save path sets justDealt=true
  // inside useBurnRateGame, before this watch exists) — without it the flag
  // would stick at true and block playCard/endTurn forever.
  watch(
    game.justDealt,
    async (dealing) => {
      if (!dealing || busy) return;
      busy = true;
      try {
        await dealNewGame();
      } finally {
        busy = false;
        game.justDealt.value = false;
      }
    },
    { flush: 'post', immediate: true },
  );

  // Human hand growth (turn refill pushes to the tail; headhunter pick too).
  watch(
    () => game.state.value.players[0].hand.map((c) => c.id).join(','),
    async (ids, prev) => {
      if (!prev || game.justDealt.value || busy) return;
      const newIds = ids.split(',').filter((id) => !prev.split(',').includes(id));
      if (newIds.length === 0) return;
      await flyIn(newIds);
    },
    { flush: 'post' },
  );

  // ---- Helpers ----------------------------------------------------------

  async function dealNewGame(): Promise<void> {
    await nextTick();
    const pCards = collect('.hand-row .card');
    if (pCards.length === 0) return;
    snapToStock(pCards);
    await flyCards(pCards, STAGGER_MS);
    clearInline(pCards);
  }

  async function flyIn(ids: string[]): Promise<void> {
    // Mark these cards noLayout for the next render, then collect rects.
    game.animIds.value = [...game.animIds.value, ...ids];
    await nextTick();
    const cards = collect('.hand-row .card', ids);
    if (cards.length === 0) {
      releaseIds(ids);
      return;
    }
    snapToStock(cards);
    await flyCards(cards, STAGGER_MS);
    clearInline(cards);
    releaseIds(ids);
  }

  function releaseIds(ids: string[]): void {
    game.animIds.value = game.animIds.value.filter((x) => !ids.includes(x));
  }

  function collect(selector: string, onlyIds?: string[]): FlyCard[] {
    const out: FlyCard[] = [];
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
      const id = el.dataset.id;
      if (!id) return;
      if (onlyIds && !onlyIds.includes(id)) return;
      out.push({ id, el, rect: el.getBoundingClientRect() });
    });
    return out;
  }

  function snapToStock(cards: FlyCard[]): void {
    const stock = document.getElementById('stock-anchor');
    const sr = stock
      ? stock.getBoundingClientRect()
      : document.body.getBoundingClientRect();
    const sx = sr.left + sr.width / 2;
    const sy = sr.top + sr.height / 2;
    cards.forEach(({ el, rect }, i) => {
      el.style.transition = 'none';
      el.style.transform = `translate(${sx - (rect.left + rect.width / 2)}px, ${sy - (rect.top + rect.height / 2)}px)`;
      el.style.zIndex = String(5000 + i); // later cards stack on top at the stock
    });
    void document.body.offsetWidth; // commit the snap as the transition start
  }

  function flyCards(cards: FlyCard[], stagger: number): Promise<void> {
    return new Promise((resolve) => {
      const settleAt = FLY_MS + (cards.length - 1) * stagger + 60;
      cards.forEach(({ el }, i) => {
        const delay = i * stagger;
        const fly = () => {
          el.style.transition = `transform ${FLY_MS}ms ${EASE}`;
          el.style.transform = '';
          el.style.zIndex = String(FLY_Z); // in-flight card above everything else
          setTimeout(() => {
            el.style.zIndex = '';
          }, FLY_MS);
        };
        if (delay === 0) fly();
        else setTimeout(fly, delay);
      });
      setTimeout(resolve, settleAt);
    });
  }

  function clearInline(cards: FlyCard[]): void {
    for (const { el } of cards) {
      el.style.transition = '';
      el.style.transform = '';
      el.style.zIndex = '';
    }
  }
}
