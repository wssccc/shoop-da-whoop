// Solitaire SFX pipeline — render the oscillator-synthesised sounds to MP3
// (offline, deterministic, no external assets). Run: npm run sfx
//
// Envelope params mirror the original tone() in
// games/solitaire/src/composables/useAudio.ts: 6ms linear attack ->
// exponentialRamp to 0.0001 over dur, +20ms tail. Output is peak-normalised
// to -3 dBFS (the raw tone() gains peak ~-26 dBFS — inaudible offline).
import ffmpegPath from 'ffmpeg-static';
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SR = 44100;
const ATTACK = 0.006;
const OUT_DIR = path.join(process.cwd(), 'public/sfx');

// --- WebAudio-compatible waveforms ---
function wave(type, phase) {
  switch (type) {
    case 'sine':
      return Math.sin(2 * Math.PI * phase);
    case 'triangle':
      return (2 / Math.PI) * Math.asin(Math.sin(2 * Math.PI * phase));
    case 'square':
      return Math.sign(Math.sin(2 * Math.PI * phase));
    case 'sawtooth':
      return 2 * (phase - Math.floor(phase + 0.5));
    default:
      throw new Error('unknown wave type: ' + type);
  }
}

// Envelope: linear attack 0->gain over ATTACK, then exponential decay
// gain -> 0.0001 over `dur` (WebAudio exponentialRamp semantics).
function env(t, dur, gain) {
  if (t <= 0) return 0;
  if (t < ATTACK) return gain * (t / ATTACK);
  const dt = t - ATTACK;
  if (dt >= dur) return 0;
  return gain * Math.pow(0.0001 / gain, dt / dur);
}

// One voice = one tone() call from the original useAudio.ts. `deal` is new:
// a light two-note "flip" (440 + 660) designed for the dealing fly-in.
const SFX = {
  move: [{ freq: 520, dur: 0.05, type: 'triangle', gain: 0.05, delay: 0 }],
  place: [{ freq: 330, dur: 0.06, type: 'sine', gain: 0.06, delay: 0 }],
  foundation: [
    { freq: 660, dur: 0.06, type: 'triangle', gain: 0.06, delay: 0 },
    { freq: 880, dur: 0.09, type: 'sine', gain: 0.05, delay: 0.04 },
  ],
  dragon: [
    // Light single-note ring in the flower/foundation chime family — a
    // clean 988 Hz sine with a faint 494 Hz undertone: crisp and quiet,
    // clearly distinct from the flat error buzz.
    { freq: 988, dur: 0.07, type: 'sine', gain: 0.045, delay: 0 },
    { freq: 494, dur: 0.05, type: 'sine', gain: 0.02, delay: 0.02 },
  ],
  flower: [
    { freq: 740, dur: 0.08, type: 'sine', gain: 0.06, delay: 0 },
    { freq: 988, dur: 0.1, type: 'sine', gain: 0.05, delay: 0.05 },
  ],
  win: [523, 659, 784, 1047].map((f, i) => ({
    freq: f,
    dur: 0.2,
    type: 'triangle',
    gain: 0.07,
    delay: i * 0.12,
  })),
  error: [{ freq: 100, dur: 0.15, type: 'triangle', gain: 0.05, delay: 0 }],
  // Flight "whoosh" — an arch chirp (fast up-glide 200→600, then a fall-back
  // 600→300) for every airborne card during the deal: springy and quiet,
  // clearly lighter than the board's own sounds.
  whoosh: [
    { freq: 200, freqEnd: 600, dur: 0.06, type: 'sine', gain: 0.045, delay: 0 },
    { freq: 600, freqEnd: 300, dur: 0.08, type: 'sine', gain: 0.035, delay: 0.055 },
  ],
};

function render(name) {
  return renderVoices(SFX[name]);
}

// One or more oscillator voices, each optionally gliding freq→freqEnd.
function renderVoices(voices) {
  const total = Math.max(...voices.map((v) => v.delay + v.dur)) + 0.03;
  const n = Math.ceil(total * SR);
  const samples = new Float64Array(n);
  for (const v of voices) {
    const start = Math.round(v.delay * SR);
    const dur = v.dur;
    const f0 = v.freq;
    const f1 = v.freqEnd ?? f0; // optional pitch glide
    let phase = 0;
    for (let i = start; i < n; i++) {
      const t = (i - start) / SR;
      phase += (f0 + ((f1 - f0) * t) / dur) / SR;
      const g = env(t, dur, v.gain);
      if (g <= 0) continue;
      samples[i] += wave(v.type, phase) * g;
    }
  }
  return samples;
}

function writeWav(file, samples, scale) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * scale));
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  writeFileSync(file, buf);
}

mkdirSync(OUT_DIR, { recursive: true });

for (const name of Object.keys(SFX)) {
  const wav = path.join(OUT_DIR, `${name}.wav`);
  const mp3 = path.join(OUT_DIR, `${name}.mp3`);
  const samples = render(name);
  // Normalise peak to -3 dBFS so all files share one loudness.
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  writeWav(wav, samples, 0.7 / peak);
  const r = spawnSync(
    ffmpegPath,
    ['-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '160k', '-ac', '1', mp3],
    { stdio: 'pipe' },
  );
  unlinkSync(wav); // intermediate WAV is not committed
  if (r.status !== 0) {
    console.error(r.stderr.toString());
    process.exit(1);
  }
  console.log(`${name} -> ${mp3} (${statSync(mp3).size} bytes)`);
}
