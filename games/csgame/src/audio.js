// audio.js — Web Audio synth (no external files). Pure procedural SFX.

import { S, resumeAudio } from './state.js';

export function setupAudio() {
  try {
    // Web Audio landed in Safari/iOS 14.5; on 13.x we fall back to the
    // vendor-prefixed `webkitAudioContext`. eslint-plugin-compat can't see
    // that fallback and flags the bare global, so the compat rule is scoped
    // off just for this constructor — verified equivalent to the audio
    // shims used in the burnrate / solitaire games.
    /* eslint-disable compat/compat */
    const AC = window.AudioContext || window.webkitAudioContext;
    S.audio = { ctx: new AC() };
    /* eslint-enable compat/compat */
  } catch (e) { S.audio = null; }
}
function playShot() {
  if (!S.audio) return; resumeAudio();
  const ctx = S.audio.ctx, t = ctx.currentTime;
  // noise burst
  const len = 0.18;
  const buf = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
  }
  const src = ctx.createBufferSource(); src.buffer = buf;
  const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 2400;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
  src.connect(filt); filt.connect(g); g.connect(ctx.destination); src.start(t); src.stop(t + len);
  // low thump
  const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.setValueAtTime(140, t); osc.frequency.exponentialRampToValueAtTime(60, t + 0.1);
  const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.35, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  osc.connect(g2); g2.connect(ctx.destination); osc.start(t); osc.stop(t + 0.12);
}
function playDryFire() {
  if (!S.audio) return; resumeAudio();
  const ctx = S.audio.ctx, t = ctx.currentTime;
  const osc = ctx.createOscillator(); osc.type = 'square'; osc.frequency.value = 800;
  const g = ctx.createGain(); g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.05);
}
function playHit(headshot) {
  if (!S.audio) return; resumeAudio();
  const ctx = S.audio.ctx, t = ctx.currentTime;
  const osc = ctx.createOscillator(); osc.type = 'triangle';
  osc.frequency.setValueAtTime(headshot ? 1400 : 900, t); osc.frequency.exponentialRampToValueAtTime(400, t + 0.06);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.18, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.09);
}
function playReload() {
  if (!S.audio) return; resumeAudio();
  const ctx = S.audio.ctx, t = ctx.currentTime;
  [0, 0.4, 1.0].forEach((d, i) => {
    const osc = ctx.createOscillator(); osc.type = 'square';
    osc.frequency.value = 300 + i * 80;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, t + d);
    g.gain.linearRampToValueAtTime(0.12, t + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.08);
    osc.connect(g); g.connect(ctx.destination);
    osc.start(t + d); osc.stop(t + d + 0.09);
  });
}

export const Audio = { playShot, playDryFire, playHit, playReload };
