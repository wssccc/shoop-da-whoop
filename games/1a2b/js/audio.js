// Tiny WebAudio "chiptune" sound effects — no external assets, all synthesised.
// Same architecture as solitaire's audio.js: lazy shared AudioContext, master
// gain (headroom) → limiter → out, per-tone oscillator+gain with an envelope.

let ctx = null;
let master = null;
let muted = false;

export const Audio = {
  setMuted(m) { muted = !!m; },
  getMuted() { return muted; },

  _ctx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
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
    }
    return ctx;
  },

  // Browsers require a user gesture before audio can play.
  resume() {
    const c = this._ctx();
    if (c && c.state === 'suspended') c.resume();
  },

  tone(freq, dur = 0.08, type = 'sine', gain = 0.08, delay = 0) {
    const c = this._ctx();
    if (!c || muted) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    // Hard-reset gain to true 0 at t0 to avoid a scheduling-race click.
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch (_) {} };
  },

  // A short upward whoosh to signal a freshly drawn secret.
  newgame() {
    this.tone(330, 0.06, 'triangle', 0.05);
    this.tone(440, 0.08, 'triangle', 0.05, 0.05);
    this.tone(587, 0.1, 'sine', 0.05, 0.1);
  },
  // Laconic "shot landed" blip for a submitted guess.
  submit() { this.tone(520, 0.06, 'square', 0.05); this.tone(392, 0.07, 'sine', 0.05, 0.03); },
  // Triumph: ascending C-E-G-C, the SHOOP DA WHOOP moment.
  win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.07, i * 0.12)); },
  // Low dull buzz for an invalid move.
  error() { this.tone(150, 0.12, 'square', 0.05); },
};
