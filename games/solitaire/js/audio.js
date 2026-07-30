// Tiny WebAudio "chiptune" sound effects — no external assets, all synthesised.

let ctx = null;
let master = null; // shared master gain (headroom before the limiter)
let muted = false;

export const Audio = {
  setMuted(m) { muted = !!m; },
  getMuted() { return muted; },

  _ctx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      // Master bus: voices -> per-tone gain -> master gain -> limiter -> out.
      // The compressor soft-clips when an auto-move cascade stacks many voices
      // at once (otherwise their gains sum >1.0 and clip digitally = "pop/pop").
      master = ctx.createGain();
      master.gain.value = 0.6; // leave headroom for concurrent oscillators
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -8;
      limiter.knee.value = 8;
      limiter.ratio.value = 10;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.12;
      master.connect(limiter).connect(ctx.destination);
    }
    return ctx;
  },

  // Browsers require a user gesture before audio can play, and iOS Safari will
  // additionally suspend the context after backgrounding / long silences. Try
  // `resume()` liberally (even from non-"suspended" states like the iOS-only
  // "interrupted") and swallow rejection — it is a cheap no-op on engines that
  // don't need it and a lifesaver on those that do.
  resume() {
    const c = this._ctx();
    if (!c) return;
    // Some Safari versions reject a synchronous resume() fired the instant the
    // tab regains focus but accept it one event loop later, so retry on a microtask.
    const tryResume = () => { try { const p = c.resume(); if (p && typeof p.then === 'function') p.catch(() => {}); } catch (_) {} };
    tryResume();
    setTimeout(tryResume, 0);
  },

  tone(freq, dur = 0.08, type = 'sine', gain = 0.08, delay = 0) {
    const c = this._ctx();
    if (!c || muted) return;
    // If the context is not actively running (iOS Safari suspends it after the
    // tab is backgrounded or a long silence), DO NOT schedule these nodes now.
    // Oscillators queued against a suspended graph never fire and pile up until
    // the context resumes, which on long sessions can exhaust resources. Kick a
    // resume() instead and drop this one sound — subsequent calls are fine once
    // the user's next gesture has unlocked the context.
    if (c.state !== 'running') {
      this.resume();
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
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    // Free the nodes once the voice ends (no stop() transient this way).
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (_) {} };
  },

  move() { this.tone(520, 0.05, 'triangle', 0.05); },
  place() { this.tone(330, 0.06, 'sine', 0.06); },
  foundation() { this.tone(660, 0.06, 'triangle', 0.06); this.tone(880, 0.09, 'sine', 0.05, 0.04); },
  dragon() { this.tone(180, 0.18, 'sawtooth', 0.05); this.tone(120, 0.22, 'sine', 0.05, 0.05); },
  flower() { this.tone(740, 0.08, 'sine', 0.06); this.tone(988, 0.1, 'sine', 0.05, 0.05); },
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.07, i * 0.12)); },
  error() { this.tone(150, 0.12, 'square', 0.05); },
};

// Re-arm the AudioContext when the tab becomes visible again. iOS Safari parks
// the context on background and never auto-resumes, leaving the page "alive but
// silent" until the next explicit user gesture — `visibilitychange`/`pageshow`
// happen exactly when the user focuses back on the page, so we resume there.
if (typeof document !== 'undefined') {
  const _autoResume = () => Audio.resume();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) _autoResume(); });
  window.addEventListener('pageshow', _autoResume);
}
