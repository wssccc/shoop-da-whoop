import { Page } from '@playwright/test';

/**
 * Inject a realistic localStorage save for the KeyFlow Vue app before any
 * page script runs. Single-user mode: seeds `keyflow_profile_v2` (one
 * profile object with `introDone: true`) so the app boots straight to the
 * Main Menu and the Reports screens have data to render.
 */
const SAVE: Record<string, unknown> = {
  keyflow_profile_v2: JSON.stringify({
    name: 'Zoe',
    date: '08-23-26',
    experience: 'two-finger',
    speedGoal: 45,
    practiceGoal: 30,
    accuracyGoal: 90,
    drills: 10,
    wpm: 32,
    acc: 94,
    totalMin: 42,
    totalWeeks: 3,
    weeklyWpm: Array.from({ length: 52 }, () => 0),
    weeklyAcc: Array.from({ length: 52 }, () => 0),
    weeklyMinutes: Array.from({ length: 52 }, () => 0),
    keyStats: Array.from({ length: 64 }, () => ({ attempts: 0, correct: 0, errors: 0, elapsedMs: 0 })),
    sessionLog: [
      { date: '08-20-26', kind: 'lesson', wpm: 30, acc: 93, minutes: 10 },
      { date: '08-22-26', kind: 'lesson', wpm: 32, acc: 94, minutes: 10 },
    ],
    currentKeyIndex: 7,
    shiftIntroDone: false,
    created: 1_750_000_000,
    lastSession: 1_750_000_000,
    introDone: true,
  }),
};

/** Make a shallow copy so page script mutation never leaks into later saves. */
function cloneSave(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(SAVE)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'object') out[k] = JSON.stringify(v);
  }
  return out;
}

/**
 * Pre-load saved state. Optionally seed a fresh empty save by passing
 * `empty: true`, useful for testing the registration/boot path.
 */
export async function seedSave(page: Page, opts: { empty?: boolean } = {}): Promise<void> {
  await page.addInitScript(
    ({ save, empty }) => {
      if (!empty) {
        for (const [k, v] of Object.entries(save)) {
          localStorage.setItem(k, v);
        }
      } else {
        const keys = Object.keys(save);
        for (const k of keys) localStorage.removeItem(k);
      }
    },
    { save: cloneSave(), empty: !!opts.empty },
  );
}

/** Press a single key destined for the typing/alpha surfaces. */
export async function pressKey(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
}
