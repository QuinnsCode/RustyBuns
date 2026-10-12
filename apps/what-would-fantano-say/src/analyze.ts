// What the critic "hears": a handful of numbers from the decoded song, worked out in
// the browser. Pure and FFT-free, so it's fast on a phone and bun tests it with
// synthetic signals. The audio itself never leaves the page.

export interface Features {
  durationSec: number;
  /** Whole-song RMS level, dBFS. Modern masters sit around -8; quiet ones under -16. */
  loudnessDb: number;
  /** Spread between the loud and quiet parts (dB). Under ~5 is a brickwall master. */
  dynamicsDb: number;
  /** Estimated tempo, 60–200. */
  bpm: number;
  /** How regular the beat is, 0–1. High is a steady groove, low is free-form or ambient. */
  pulse: number;
  /** Share of energy under ~150 Hz, 0–1. */
  bass: number;
  /** Zero-crossing rate scaled to 0–1. A rough stand-in for how bright or noisy it is. */
  brightness: number;
  /** Share of the song that's near silence, 0–1. */
  silence: number;
}

const FRAME = 512;          // ~23 ms at 22 kHz: the onset envelope's hop
const BLOCK = 16;           // frames per ~0.37 s loudness block, for the dynamics
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** Mono samples in -1..1 at `rate` Hz. */
export function analyze(samples: Float32Array, rate: number): Features {
  const frames = Math.floor(samples.length / FRAME);
  if (frames < 8) throw new Error("too short to judge");

  // Per-frame RMS, a one-pole low-pass at 150 Hz for the bass share, and zero crossings.
  const rms = new Float32Array(frames);
  const a = Math.exp((-2 * Math.PI * 150) / rate);
  let lp = 0, total = 0, low = 0, crossings = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * FRAME; i < (f + 1) * FRAME; i++) {
      const x = samples[i]!;
      sum += x * x;
      lp = (1 - a) * x + a * lp;
      low += lp * lp;
      if (i > 0 && (x >= 0) !== (samples[i - 1]! >= 0)) crossings++;
    }
    total += sum;
    rms[f] = Math.sqrt(sum / FRAME);
  }

  // Dynamics and silence on ~0.4 s blocks, so a drum hit doesn't count as "dynamic".
  const blocks: number[] = [];
  for (let b = 0; b + BLOCK <= frames; b += BLOCK) {
    let s = 0;
    for (let f = b; f < b + BLOCK; f++) s += rms[f]! * rms[f]!;
    blocks.push(db(Math.sqrt(s / BLOCK)));
  }
  if (!blocks.length) blocks.push(db(Math.sqrt(total / (frames * FRAME))));
  const levels = blocks.sort((x, y) => x - y);
  const silent = levels.filter((l) => l < -50).length;
  const audible = levels.slice(silent);

  const { bpm, pulse } = tempo(rms, rate / FRAME);
  const zcr = crossings / (frames * FRAME);
  return {
    durationSec: round(samples.length / rate, 1),
    loudnessDb: round(db(Math.sqrt(total / (frames * FRAME))), 1),
    dynamicsDb: audible.length ? round(audible[Math.floor(audible.length * 0.95)]! - audible[Math.floor(audible.length * 0.1)]!, 1) : 0,
    bpm,
    pulse,
    bass: total > 0 ? round(Math.min(1, low / total), 2) : 0,
    // Zero crossings a second, so it reads the same at any sample rate. Most music sits
    // around 500–3000; hiss and cymbals go higher.
    brightness: round(Math.min(1, (zcr * rate) / 4410), 2),
    silence: round(silent / levels.length, 2),
  };
}

/**
 * Tempo from the onset envelope (rises in frame energy), autocorrelated over 60–200 BPM.
 * `fps` is envelope frames a second. Returns the best lag's BPM and how far its peak
 * stands out (the pulse).
 */
export function tempo(rms: Float32Array, fps: number): { bpm: number; pulse: number } {
  const onset = new Float32Array(rms.length);
  for (let i = 1; i < rms.length; i++) onset[i] = Math.max(0, rms[i]! - rms[i - 1]!);
  // Blur it a frame each way, so a beat that falls between two frames still lines up.
  for (let pass = 0; pass < 2; pass++) {
    let prev = 0;
    for (let i = 0; i < onset.length; i++) {
      const cur = onset[i]!;
      onset[i] = (prev + 2 * cur + (onset[i + 1] ?? 0)) / 4;
      prev = cur;
    }
  }
  const mean = onset.reduce((s, x) => s + x, 0) / onset.length;
  for (let i = 0; i < onset.length; i++) onset[i]! -= mean;

  const corr = (lag: number) => {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i]! * onset[i - lag]!;
    return s / (onset.length - lag);
  };
  const zero = corr(0);
  if (zero <= 0) return { bpm: 120, pulse: 0 };

  // Weight each lag by a log-normal prior around 120 BPM: a click at 150 also repeats at
  // 75, and this is what picks the 150 people would tap.
  const minLag = Math.max(1, Math.floor((fps * 60) / 200));
  const maxLag = Math.min(onset.length - 1, Math.ceil((fps * 60) / 60));
  let best = minLag, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const score = corr(lag) * Math.exp(-0.5 * Math.log2((fps * 60) / lag / 120) ** 2);
    if (score > bestScore) { bestScore = score; best = lag; }
  }
  // Refine to a fractional lag with a parabola through the neighbours.
  const [l, c, r] = [corr(best - 1), corr(best), corr(best + 1)];
  const shift = l - 2 * c + r === 0 ? 0 : (0.5 * (l - r)) / (l - 2 * c + r);
  const bpm = (60 * fps) / (best + Math.max(-0.5, Math.min(0.5, shift)));
  return { bpm: Math.round(Math.max(60, Math.min(200, bpm))), pulse: round(Math.max(0, Math.min(1, c / zero)), 2) };
}

const round = (x: number, places: number) => Math.round(x * 10 ** places) / 10 ** places;
