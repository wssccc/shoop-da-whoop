// Tiny WebAudio "chiptune" sound effects — no external assets, all synthesised.
//
// Faithful port of solitaire's useAudio.ts with the iOS-Safari suspended-state
// guards preserved (see /memories/ios-webaudio-suspended-leak.md): never
// schedule voices against a suspended context (they pile up), resume()
// liberally, and auto-resume when the tab becomes visible again.

import { useDocumentVisibility } from '@vueuse/core';
import { watch } from 'vue';

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null; // shared master gain (headroom before the limiter)
let muted = false;

function getAudioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  return (
    // compat/compat flags BOTH AudioContext and webkitAudioContext here as
    // "unsupported on iOS 13.0-13.1". That is a false positive: this is pure
    // feature detection — we only read whichever constructor exists, then
    // `new` the resolved ctor below. Runtime is safe down to iOS 13. Block
    // disable (not next-line) so both referenced lines are covered.
    /* eslint-disable compat/compat */
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
    /* eslint-enable compat/compat */
  );
}

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  const AC = getAudioContextCtor();
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.6; // headroom for concurrent oscillators
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -8;
  limiter.knee.value = 8;
  limiter.ratio.value = 10;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.12;
  master.connect(limiter).connect(ctx.destination);
  return ctx;
}

export function setMuted(m: boolean): void {
  muted = !!m;
}
export function getMuted(): boolean {
  return muted;
}

export function resume(): void {
  const c = ensureCtx();
  if (!c) return;
  // Some Safari versions reject a synchronous resume() fired the instant the
  // tab regains focus but accept it one event loop later, so retry on a tick.
  const tryResume = () => {
    try {
      const p = c.resume();
      if (p && typeof p.then === 'function') p.catch(() => {});
    } catch {
      /* ignore */
    }
  };
  tryResume();
  setTimeout(tryResume, 0);
}

export function tone(
  freq: number,
  dur = 0.08,
  type: OscillatorType = 'sine',
  gain = 0.08,
  delay = 0,
): void {
  const c = ensureCtx();
  if (!c || muted) return;
  // iOS Safari suspends the context after backgrounding / long silences: do
  // NOT queue nodes against a suspended graph (they never fire and pile up).
  // Kick a resume() and drop this one sound instead.
  if (c.state !== 'running') {
    resume();
    return;
  }
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  if (master) osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  osc.onended = () => {
    try {
      osc.disconnect();
      g.disconnect();
    } catch {
      /* ignore */
    }
  };
}

export const Audio = {
  setMuted,
  getMuted,
  resume,
  tone,
  /** Generic UI click. */
  click() {
    tone(700, 0.04, 'triangle', 0.04);
  },
  /** Card dealt / drawn into hand. */
  draw() {
    tone(440, 0.05, 'triangle', 0.05);
    tone(660, 0.07, 'sine', 0.04, 0.03);
  },
  /** Card played from hand (project/action). */
  play() {
    tone(520, 0.06, 'triangle', 0.06);
    tone(390, 0.08, 'sine', 0.05, 0.03);
  },
  /** Hire a staff/VP. */
  hire() {
    tone(523, 0.07, 'triangle', 0.06);
    tone(659, 0.09, 'sine', 0.05, 0.05);
  },
  /** Cash reward (project completed). */
  coin() {
    tone(880, 0.07, 'sine', 0.06);
    tone(1175, 0.1, 'sine', 0.05, 0.05);
  },
  /** Attack lands (bad project / poach / audit / consultant / resign). */
  attack() {
    tone(180, 0.12, 'sawtooth', 0.05);
    tone(140, 0.16, 'square', 0.04, 0.05);
  },
  /** Dice tumbling (each opening-roll round). */
  diceRoll() {
    tone(880, 0.03, 'square', 0.025);
    tone(660, 0.03, 'square', 0.02, 0.05);
    tone(990, 0.04, 'square', 0.02, 0.1);
  },
  /** Dice settle — the first player is revealed. */
  diceReveal() {
    tone(660, 0.12, 'triangle', 0.06);
    tone(880, 0.16, 'triangle', 0.06, 0.08);
    tone(1320, 0.22, 'triangle', 0.05, 0.16);
  },
  /** Burn settlement. */
  burn() {
    tone(220, 0.12, 'sine', 0.06);
    tone(165, 0.16, 'sine', 0.05, 0.06);
  },
  /** A player went bankrupt. */
  bankrupt() {
    tone(392, 0.18, 'sawtooth', 0.05);
    tone(262, 0.2, 'sawtooth', 0.05, 0.12);
    tone(196, 0.28, 'sawtooth', 0.05, 0.26);
  },
  /** Human victory jingle. */
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.07, i * 0.12));
  },
  /** Human loss — low, flat. */
  lose() {
    [330, 294, 262, 196].forEach((f, i) => tone(f, 0.18, 'triangle', 0.06, i * 0.14));
  },
  error() {
    tone(150, 0.12, 'square', 0.05);
  },
};
export type AudioApi = typeof Audio;

/**
 * Composable wrapping the singleton Audio with the iOS-friendly auto-resume
 * wiring. Call once from App setup.
 */
export function useAudio(): AudioApi {
  const visibility = useDocumentVisibility();
  watch(
    visibility,
    (v) => {
      if (v === 'visible') resume();
    },
    { flush: 'post' },
  );
  return Audio;
}
