// Solitaire e2e board helpers — DOM sampling, real-mouse drags and
// animation-settling assertions that the probe scripts used to do by hand.
import { expect, type Locator, type Page } from '@playwright/test';

/** Animation timings mirrored from the game (fly 320ms / stagger 200ms). */
export const FLY_MS = 320;
export const STAGGER_MS = 200;
export const FLIP_SETTLE_MS = 250;

export function card(page: Page, id: string): Locator {
  return page.locator(`.card[data-id="${id}"]`);
}

export function slot(page: Page, name: string): Locator {
  return page.locator(`.slot[data-slot="${name}"]`);
}

export interface CardSample {
  id: string;
  left: number;
  top: number;
  z: string;
  /** inline transform present? ('M' when the card is mid-flight) */
  flying: boolean;
}

/** Snapshot every card's rect + inline style (the probe dump format). */
export async function sampleBoard(page: Page): Promise<CardSample[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('#board .card')].map((c) => {
      const r = c.getBoundingClientRect();
      return {
        id: (c as HTMLElement).dataset.id ?? '',
        left: Math.round(r.left),
        top: Math.round(r.top),
        z: (c as HTMLElement).style.zIndex || '',
        flying: (c as HTMLElement).style.transform !== '',
      };
    }),
  );
}

/**
 * Wait until no card is mid-flight — i.e. every animation (fly / settle /
 * deal stagger) has landed and no inline style residue is left on the board.
 *
 * In-flight detection: `flip()` animates on the compositor — the inline
 * `transform` reads `''` while the card is airborne, so the ONLY reliable
 * marker is the z-lift (`IN_FLIGHT_Z` = 9000, cleared on landing). The deal
 * stagger keeps an inline transform while animating, hence the OR.
 *
 * NB: first waits ~300ms so a just-triggered executor has a chance to start
 * its first flight (polling immediately would see "no animation" and return
 * before anything moved), then polls for zero airborne cards.
 */
export async function expectSettled(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForTimeout(300);
  await expect
    .poll(async () => {
      const n = await page.evaluate(
        () =>
          [...document.querySelectorAll('#board .card')].filter((c) => {
            const s = (c as HTMLElement).style;
            return s.transform !== '' || s.zIndex === '9000';
          }).length,
      );
      return n;
    }, { timeout: timeoutMs, message: 'board never settled (cards still airborne)' })
    .toBe(0);
}

/**
 * Real-mouse drag from a card to a target slot centre, mirroring the probe
 * pattern: pointer down → N interpolated moves → up. When `viaGap` is true
 * the trajectory first passes through an illegal gap and only enters the
 * legal slot near the end (exercises highlight switching mid-drag).
 */
export async function dragCardTo(
  page: Page,
  srcId: string,
  targetSelector: string,
  { viaGap = false, steps = 60 }: { viaGap?: boolean; steps?: number } = {},
): Promise<void> {
  const src = await card(page, srcId).boundingBox();
  const dst = await page.locator(targetSelector).boundingBox();
  if (!src || !dst) throw new Error(`dragCardTo: missing rect for ${srcId} -> ${targetSelector}`);

  const sx = src.x + src.width / 2;
  const sy = src.y + src.height / 2;
  const tx = dst.x + dst.width / 2;
  const ty = dst.y + dst.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // viaGap: stay in the illegal gap for 70% of the path, enter the legal
    // zone only in the final 30%.
    const k = viaGap ? t * 0.7 : t;
    await page.mouse.move(sx + (tx - sx) * k, sy + (ty - sy) * k);
  }
  await page.mouse.up();
}

/**
 * Console-error sentinel. Install in `beforeEach`; call the returned check
 * at the end of the test. `whitelist` filters known-harmless page errors.
 */
export function watchConsoleErrors(
  page: Page,
  whitelist: RegExp[] = [],
): () => Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
  return async () => {
    const real = errors.filter((e) => !whitelist.some((re) => re.test(e)));
    expect(real, 'unexpected page/console errors:\n' + real.join('\n')).toEqual([]);
  };
}

/** Assert the exact set of card ids present on the board (nothing lost or ghosted). */
export async function expectCardIds(page: Page, ids: string[]): Promise<void> {
  const got = await page.evaluate(() =>
    [...document.querySelectorAll('#board .card')].map((c) => (c as HTMLElement).dataset.id ?? ''),
  );
  expect([...got].sort()).toEqual([...ids].sort());
}

/**
 * Instrument take-off order: capture `transitionstart` for transform
 * transitions of the flight duration (FLY_MS ± 10ms). Drag-drop settles and
 * the deal fly-in use different durations, so this filter isolates
 * executor flights. Install BEFORE the triggering interaction.
 */
export async function watchTakeOffs(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate((flyMs) => {
    const w = window as unknown as { __takeOffs?: string[] };
    w.__takeOffs = [];
    const onStart = (e: Event) => {
      const te = e as TransitionEvent;
      if (te.propertyName !== 'transform') return;
      const el = te.target;
      if (!(el instanceof HTMLElement)) return;
      const dur = parseFloat(getComputedStyle(el).transitionDuration);
      if (dur >= (flyMs - 10) / 1000 && dur <= (flyMs + 10) / 1000) {
        const id = el.dataset.id || '?';
        const list = w.__takeOffs!;
        if (!list.includes(id)) list.push(id);
      }
    };
    document.addEventListener('transitionstart', onStart, true);
  }, FLY_MS);
  return () => page.evaluate(() => (window as unknown as { __takeOffs?: string[] }).__takeOffs ?? []);
}
