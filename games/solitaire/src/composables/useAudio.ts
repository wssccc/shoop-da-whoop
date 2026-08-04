// Tiny WebAudio "chiptune" sound effects — no external assets, all synthesised.
//
// Faithful 1:1 port of the original audio.js with the iOS-Safari suspended-state
// guards preserved verbatim (see memories/ios-webaudio-suspended-leak.md).
// The auto-resume-on-visiblity wiring is delegated to `useAudio()` so VueUse
// `useDocumentVisibility` (rather than a raw `addEventListener`) drives it.

import { useDocumentVisibility } from '@vueuse/core';
import { watch } from 'vue';

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null; // shared master gain (headroom before the limiter)
let muted = false;

function getAudioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  return (
    // feature detection: read whichever AudioContext constructor exists.
    // compat/compat flags both names for iOS 13.0-13.1; runtime is safe (we
    // never `new` the bare global — always the resolved ctor). Block disable
    // so both referenced lines are covered.
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
  // Master bus: voices -> per-tone gain -> master gain -> limiter -> out.
  // The compressor soft-clips when an auto-move cascade stacks many voices at
  // once (otherwise their gains sum >1.0 and clip digitally = "pop/pop").
  master = ctx.createGain();
  master.gain.value = 0.6; // leave headroom for concurrent oscillators
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

/**
 * Browsers require a user gesture before audio can play, and iOS Safari will
 * additionally suspend the context after backgrounding / long silences. Try
 * `resume()` liberally (even from non-"suspended" states like the iOS-only
 * "interrupted") and swallow rejection.
 */
export function resume(): void {
  const c = ensureCtx();
  if (!c) return;
  // Some Safari versions reject a synchronous resume() fired the instant the
  // tab regains focus but accept it one event loop later, so retry on a microtask.
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
  // If the context is not actively running (iOS Safari suspends it after the
  // tab is backgrounded or a long silence), DO NOT schedule these nodes now.
  // Oscillators queued against a suspended graph never fire and pile up until
  // the context resumes, exhausting resources. Kick a resume() instead and
  // drop this one sound — subsequent calls are fine once the user's next
  // gesture has unlocked the context.
  if (c.state !== 'running') {
    resume();
    return;
  }
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  // Hard-reset gain to true 0 at t0 (a GainNode defaults to 1.0; without this
  // a scheduling race can leak the first audio block at full volume = click).
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  if (master) osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  // Free the nodes once the voice ends (no stop() transient this way).
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
  move() {
    tone(520, 0.05, 'triangle', 0.05);
  },
  place() {
    tone(330, 0.06, 'sine', 0.06);
  },
  foundation() {
    tone(660, 0.06, 'triangle', 0.06);
    tone(880, 0.09, 'sine', 0.05, 0.04);
  },
  dragon() {
    tone(180, 0.18, 'sawtooth', 0.05);
    tone(120, 0.22, 'sine', 0.05, 0.05);
  },
  flower() {
    tone(740, 0.08, 'sine', 0.06);
    tone(988, 0.1, 'sine', 0.05, 0.05);
  },
  win() {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, 'triangle', 0.07, i * 0.12));
  },
  error() {
    tone(150, 0.12, 'square', 0.05);
  },
};
export type AudioApi = typeof Audio;

/**
 * Composable wrapping the singleton Audio with the iOS-friendly auto-resume
 * wiring. Call once from App setup (further `Audio.*` use elsewhere needs no
 * re-registration).
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
