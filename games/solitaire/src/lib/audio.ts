// Howler-backed SFX manager for Solitaire.
//
// Plain TS module — deliberately free of Vue imports so it can later move to
// shared/ verbatim. The iOS-Safari auto-resume wiring lives in the thin
// composable shell (useAudio.ts, driven by VueUse useDocumentVisibility);
// this module only owns the Howl instances, the mute state and the resume
// kick (see memories/ios-webaudio-suspended-leak.md for the source pattern).

import { Howl, Howler } from 'howler';

export type SfxName =
  | 'move'
  | 'place'
  | 'foundation'
  | 'flower'
  | 'dragon'
  | 'win'
  | 'error'
  | 'whoosh';

interface SfxDef {
  file: string;
  volume?: number;
}

// Files are peak-normalised to -3 dBFS by tools/audio/build-sfx.mjs (npm run
// sfx). Absolute paths follow the existing /images/ convention (base './' +
// domain-root hosting; dist/sfx is copied verbatim from public/).
const SFX: Record<SfxName, SfxDef> = {
  move: { file: '/sfx/move.mp3' },
  place: { file: '/sfx/place.mp3' },
  foundation: { file: '/sfx/foundation.mp3' },
  flower: { file: '/sfx/flower.mp3' },
  dragon: { file: '/sfx/dragon.mp3' },
  win: { file: '/sfx/win.mp3' },
  error: { file: '/sfx/error.mp3' },
  // Flight riffle — papery noise grains, low volume on purpose: dealing
  // fires one whoosh per card at ~45ms stagger, so stacked whooshes must
  // stay behind the board's own sounds.
  whoosh: { file: '/sfx/whoosh.mp3', volume: 0.45 },
};

const howls = new Map<SfxName, Howl>();
const loadFailures = new Set<SfxName>();
let muted = false;

/** Global output level — every file is normalised, so one number rules all. */
Howler.volume(0.8);

function howlFor(name: SfxName): Howl | null {
  let h = howls.get(name);
  if (h) return h;
  const def = SFX[name];
  if (!def) return null;
  h = new Howl({
    src: [def.file],
    volume: def.volume ?? 1,
    // A missing asset (offline build / stale deploy) must not spam the log.
    onloaderror: () => {
      if (loadFailures.has(name)) return;
      loadFailures.add(name);
      console.warn(`[audio] failed to load ${def.file}`);
    },
  });
  howls.set(name, h);
  return h;
}

/** Build (and start loading) every Howl — call once from the App shell. */
export function loadAll(): void {
  (Object.keys(SFX) as SfxName[]).forEach(howlFor);
}

function play(name: SfxName): void {
  // Mirrors the old tone() guard: nothing gets scheduled while muted.
  if (muted) return;
  // Lock-screen / backgrounding suspends the AudioContext (iOS keeps the
  // page "visible", so the visibility watcher never fires). Never schedule
  // onto a suspended graph — the buffer sources would pile up without ever
  // ending (see memories/ios-webaudio-suspended-leak.md). Resume and skip
  // this one; the next sound (post focus/pointerdown resume) will ring.
  const ctx = Howler.ctx;
  if (ctx && ctx.state !== 'running') {
    resume();
    return;
  }
  const h = howlFor(name);
  if (!h) return;
  h.play();
}

/**
 * iOS Safari suspends the AudioContext after backgrounding / long silences.
 * Resume liberally (even from the iOS-only "interrupted" state) and swallow
 * rejection. The double-kick (immediate + one tick later) covers Safari
 * builds that reject a resume() fired right after focus returns.
 */
export function resume(): void {
  const ctx = Howler.ctx;
  if (!ctx) return;
  const tryResume = () => {
    try {
      const p = ctx.resume();
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  };
  tryResume();
  setTimeout(tryResume, 0);
}

export function setMuted(m: boolean): void {
  muted = !!m;
  Howler.mute(muted);
}
export function getMuted(): boolean {
  return muted;
}

export const Audio = {
  resume,
  setMuted,
  getMuted,
  move() {
    play('move');
  },
  place() {
    play('place');
  },
  foundation() {
    play('foundation');
  },
  flower() {
    play('flower');
  },
  dragon() {
    play('dragon');
  },
  win() {
    play('win');
  },
  error() {
    play('error');
  },
  whoosh() {
    play('whoosh');
  },
};
export type AudioApi = typeof Audio;
