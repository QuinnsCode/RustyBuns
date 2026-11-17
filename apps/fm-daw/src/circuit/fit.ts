// Profiling, offline: fit an amp's part values to a recording of it. The amp's
// topology (which stages, which caps exist) stays fixed; the fit moves the
// resistors and capacitors you could swap with a soldering iron, plus the
// power stage's drive, until our render matches the recording. Then the parts
// snap to values you can buy (E24) and a last pass nudges each one a step up
// or down while that helps. What comes out is an `AmpDef`: `buildRig` turns
// it into netlists, so the profile is a circuit, not a black box.
// ANALOG.md section 6; the first step is fitting our own amps back to themselves.
import { mulberry32 } from "@rustybuns/util";
import { Fft } from "../engine/linear.ts";
import { buildRig, type AmpDef, type Knobs } from "./amps.ts";
import { runRig } from "@rustybuns/gear/circuit";

export const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];
export const E24 = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91];

/** The buyable value `steps` away from the one nearest `v` (0 is the nearest itself), on a log scale. */
export function eValue(v: number, steps = 0, series = E24): number {
  const decade = Math.floor(Math.log10(v)) - 1;
  const m = v / 10 ** decade;
  const near = series.reduce((best, s, i) => (Math.abs(Math.log(s / m)) < Math.abs(Math.log(series[best] / m)) ? i : best), 0);
  // 10 rounds up to the next decade's 10, so 9.6k lands on 10k, not 91 of this decade.
  const top = Math.abs(Math.log(100 / m)) < Math.abs(Math.log(series[near] / m));
  const k = (top ? series.length : near) + steps + series.length * 4;
  const d = decade + Math.floor(k / series.length) - 4;
  return Number((series[k % series.length] * 10 ** d).toPrecision(3));
}

/** One value the fit moves. `part` ones are real parts and snap to E24; the power drive doesn't. */
export interface Value { name: string; value: number; part: boolean }

/** An amp's movable values, in a fixed order: each stage's rk, ck (when it has one) and cc, the tone stack's four, the power drive. */
export function valuesOf(amp: AmpDef): Value[] {
  const out: Value[] = [];
  amp.stages.forEach((s, i) => {
    out.push({ name: `V${i + 1} rk`, value: s.rk, part: true });
    if (s.ck > 0) out.push({ name: `V${i + 1} ck`, value: s.ck, part: true });
    out.push({ name: `V${i + 1} cc`, value: s.cc ?? 22e-9, part: true });
  });
  const t = amp.tone;
  out.push(
    { name: "tone slope", value: t.slope ?? 33e3, part: true },
    { name: "tone cTreble", value: t.cTreble ?? 470e-12, part: true },
    { name: "tone cBass", value: t.cBass ?? 22e-9, part: true },
    { name: "tone cMid", value: t.cMid ?? 22e-9, part: true },
    { name: "power", value: amp.power, part: false },
  );
  return out;
}

/** The amp with these values in (same order as `valuesOf`). */
export function withValues(amp: AmpDef, values: number[]): AmpDef {
  let j = 0;
  const stages = amp.stages.map((s) => {
    const rk = values[j++];
    const ck = s.ck > 0 ? values[j++] : 0;
    return { ...s, rk, ck, cc: values[j++] };
  });
  const tone = { ...amp.tone, slope: values[j++], cTreble: values[j++], cBass: values[j++], cMid: values[j++] };
  return { ...amp, stages, tone, power: values[j] };
}

/** A sine held long enough to settle; `window` is the steady stretch the harmonics are read from. */
export interface Tone { hz: number; level: number; start: number; window: number }

/** The test signal played through the amp: sines at several levels (how the harmonics grow), a log sweep and a noise burst (the spectrum). */
export interface Probe { signal: Float32Array; sampleRate: number; tones: Tone[] }

/**
 * The test signal. Each tone is 0.1 s and is read over its last 50 ms, which
 * holds a whole number of cycles of every frequency here, so a harmonic falls
 * on one bin. `short` halves the levels and frequencies tried, for a quick fit.
 */
export function probe(sampleRate = 24000, short = false): Probe {
  const hzs = short ? [120, 960] : [120, 480, 1440];
  const levels = short ? [0.02, 0.1, 0.5] : [0.01, 0.04, 0.15, 0.6];
  const tone = Math.round(sampleRate * 0.1), window = Math.round(sampleRate * 0.05);
  const sweep = Math.round(sampleRate * (short ? 0.15 : 0.25)), noise = Math.round(sampleRate * (short ? 0.1 : 0.15));
  const signal = new Float32Array(hzs.length * levels.length * tone + sweep + noise);
  const tones: Tone[] = [];
  let at = 0;
  for (const level of levels) for (const hz of hzs) {
    for (let i = 0; i < tone; i++) signal[at + i] = level * Math.sin((2 * Math.PI * hz * i) / sampleRate);
    tones.push({ hz, level, start: at + tone - window, window });
    at += tone;
  }
  const f0 = 40, f1 = 8000, T = sweep / sampleRate, k = Math.log(f1 / f0);
  for (let i = 0; i < sweep; i++) signal[at + i] = 0.3 * Math.sin(((2 * Math.PI * f0 * T) / k) * (Math.exp((k * i) / sweep) - 1));
  at += sweep;
  const rand = mulberry32(4830);
  for (let i = 0; i < noise; i++) signal[at + i] = 0.1 * (rand() * 2 - 1);
  return { signal, sampleRate, tones };
}

/**
 * What a recording is scored on: each tone's first five harmonics in dB and
 * their phases, and log spectra at three frame sizes. A harmonic's phase is
 * taken against the fundamental's (φh − h·φ1), so a delay (a mic a foot from
 * the speaker) doesn't change it, but which way a stage clips does.
 */
export interface Features { harmonics: number[][]; phases: number[][]; spectra: Float64Array[] }

const FRAMES = [256, 1024, 4096];

export function features(out: Float32Array, p: Probe): Features {
  const phases: number[][] = [];
  const harmonics = p.tones.map((t) => {
    const amps: number[] = [], ph: number[] = [];
    for (let h = 1; h <= 5; h++) {
      // One DFT bin at the harmonic, over the steady window.
      const w = (2 * Math.PI * t.hz * h) / p.sampleRate;
      let re = 0, im = 0;
      for (let i = 0; i < t.window; i++) { const x = out[t.start + i]; re += x * Math.cos(w * i); im -= x * Math.sin(w * i); }
      amps.push(20 * Math.log10((2 * Math.hypot(re, im)) / t.window + 1e-9));
      ph.push(Math.atan2(im, re) - h * (ph.length ? ph[0] : 0));
    }
    phases.push(ph);
    return amps;
  });
  const spectra = FRAMES.map((n) => {
    const fft = new Fft(n), hop = n / 2, frames = Math.max(1, Math.floor((out.length - n) / hop) + 1);
    const mags = new Float64Array(frames * (n / 2));
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let f = 0; f < frames; f++) {
      for (let i = 0; i < n; i++) { re[i] = (out[f * hop + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)); im[i] = 0; }
      fft.run(re, im);
      for (let b = 0; b < n / 2; b++) mags[f * (n / 2) + b] = Math.hypot(re[b], im[b]);
    }
    return mags;
  });
  return { harmonics, phases, spectra };
}

/**
 * How far a render is from the target, about 0 for a match: the mean log
 * spectral distance (multi-resolution, quiet bins floored 60 dB under the
 * loudest) plus the harmonics' mean squared dB error over 100 (each floored
 * 80 dB under that tone's fundamental, so hiss-level harmonics don't count),
 * plus 1 − cos of each harmonic's phase error, for the ones above that floor.
 */
export function distance(a: Features, target: Features): number {
  let spec = 0;
  target.spectra.forEach((t, k) => {
    const c = a.spectra[k];
    let top = 0;
    for (const v of t) if (v > top) top = v;
    const floor = top * 1e-3 + 1e-12;
    let s = 0;
    for (let i = 0; i < t.length; i++) s += Math.abs(Math.log10((c[i] + floor) / (t[i] + floor)));
    spec += s / t.length;
  });
  let harm = 0, n = 0, phase = 0, np = 0;
  target.harmonics.forEach((t, k) => {
    const floor = t[0] - 80;
    t.forEach((db, h) => {
      const d = Math.max(a.harmonics[k][h], floor) - Math.max(db, floor);
      harm += d * d; n++;
      if (h > 0 && db > floor) { phase += 1 - Math.cos(a.phases[k][h] - target.phases[k][h]); np++; }
    });
  });
  return spec / FRAMES.length + harm / n / 100 + (np ? phase / np : 0);
}

/** The front panel a profile is played at; noise off, so two renders of the same circuit match exactly. */
export const FIT_KNOBS = (amp: AmpDef): Knobs => ({ ...amp.knobs, noise: 0 });

/**
 * The tone-knob settings a profile records after the amp's own, one take each:
 * bass up with treble down, then treble up with bass down, mid swung the other
 * way each time. At one setting the tone stack's four parts trade off against
 * each other; more settings pull them apart (#4943). The player turns the
 * knobs between takes; gain and master stay put.
 */
export const TONE_SETTINGS: Pick<Knobs, "bass" | "mid" | "treble">[] = [
  { bass: 10, mid: 2, treble: 1 },
  { bass: 1, mid: 10, treble: 10 },
];

/**
 * One recording of the probe through the amp, and the knobs it was played at.
 * `anyLevel`: the recording's level means nothing (a real capture, where the
 * interface's input gain sets it), so each render is scaled to its loudness
 * before scoring. Our own renders keep their level, which holds the power drive.
 */
export interface Take { knobs: Knobs; recording: Float32Array; anyLevel?: boolean }

const rms = (x: Float32Array) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length) + 1e-12; };

/** A take worked out once for a whole fit: its knobs, features, and the loudness a render is scaled to (0: left as is). */
export interface Target { knobs: Knobs; f: Features; level: number }

/** The front panels of a profile's takes: the amp's own, then each of `settings`. */
export function takeKnobs(amp: AmpDef, settings = TONE_SETTINGS): Knobs[] {
  const own = FIT_KNOBS(amp);
  return [own, ...settings.map((t) => ({ ...own, ...t }))];
}

/** Our own amp's takes, rendered: what a fit back to itself is scored against. */
export function selfTakes(amp: AmpDef, p: Probe, settings = TONE_SETTINGS): Take[] {
  return takeKnobs(amp, settings).map((knobs) => ({ knobs, recording: render(amp, p, knobs) }));
}

/** The tone stack's values, and V1's coupling cap that trades off against them: what the second stage of `fit` moves alone. */
export const TONE_PARTS = ["tone slope", "tone cTreble", "tone cBass", "tone cMid", "V1 cc"];

/** Each take's knobs and features, worked out once for a whole fit. */
export function targetsOf(takes: Take[], p: Probe): Target[] {
  return takes.map((t) => ({ knobs: t.knobs, f: features(t.recording, p), level: t.anyLevel ? rms(t.recording) : 0 }));
}

/** An amp's mean distance from the takes, each rendered at that take's knobs. */
export function takesDistance(amp: AmpDef, p: Probe, targets: Target[]): number {
  return targets.reduce((sum, t) => {
    const out = render(amp, p, t.knobs);
    if (t.level) { const g = t.level / rms(out); for (let i = 0; i < out.length; i++) out[i] *= g; }
    return sum + distance(features(out, p), t.f);
  }, 0) / targets.length;
}

/** Plays the probe through an amp at 2× oversampling (fitting speed; the amp page runs 4×). */
export function render(amp: AmpDef, p: Probe, knobs = FIT_KNOBS(amp)): Float32Array {
  return runRig(buildRig(amp, knobs), p.signal, p.sampleRate, 2).out;
}

export interface FitOptions {
  /** How far from the start each value may go, as a factor either way (3: room for a guess off by ×/÷ 2). */
  span?: number;
  generations?: number;
  /** Renders per generation. Fewer (CMA-ES would pick 11) settle on the wrong gain staging from a ×2 guess. */
  population?: number;
  seed?: number;
  /** Only these values move (by name); the rest stay as started. All of them when left out. */
  only?: string[];
  /**
   * Generations of a second search over `TONE_PARTS` alone, from where the
   * first one ended and inside ×/÷ 1.5 of it, with the gain staging held (0
   * skips it). Five values settle where thirteen don't. Default 40.
   */
  toneGenerations?: number;
  onGeneration?: (g: number, best: number) => void;
}

export interface FitResult {
  amp: AmpDef;
  values: Value[];
  /** The distance after the continuous fit, and after snapping to E24 and the step pass. */
  fitted: number;
  snapped: number;
  evaluations: number;
}

/**
 * Fits `start`'s values to recordings of `p` (`takes`, each at its own knobs;
 * the score is their mean). The search is separable CMA-ES over each value's
 * log, scaled to [0, 1] inside ×/÷ `span` of where it started; then a second,
 * smaller one over the tone stack alone (`toneGenerations`); then the parts
 * snap to E24, and each part is tried one step up and down while that lowers
 * the distance.
 */
export function fit(start: AmpDef, p: Probe, takes: Take[], opts: FitOptions = {}): FitResult {
  const span = opts.span ?? 3, seed = opts.seed ?? 1;
  const base = valuesOf(start);
  const free = base.map((v, i) => (opts.only && !opts.only.includes(v.name) ? -1 : i)).filter((i) => i >= 0);
  const wants = targetsOf(takes, p);
  let evaluations = 0;
  const score = (vals: number[]) => { evaluations++; return takesDistance(withValues(start, vals), p, wants); };
  const search = (from: number[], idx: number[], within: number, generations: number, s: number) => {
    const decode = (u: ArrayLike<number>) => {
      const vals = from.slice();
      idx.forEach((i, j) => { vals[i] = from[i] * within ** (2 * Math.min(1, Math.max(0, u[j])) - 1); });
      return vals;
    };
    const best = sepCmaEs(idx.length, (u) => {
      let out = 0;
      for (let j = 0; j < u.length; j++) { const c = Math.min(1, Math.max(0, u[j])); out += (u[j] - c) ** 2; }
      return score(decode(u)) + out;
    }, { generations, population: opts.population ?? 24, seed: s, onGeneration: opts.onGeneration });
    return { vals: decode(best.x), f: best.f };
  };
  let { vals, f: fitted } = search(base.map((v) => v.value), free, span, opts.generations ?? 90, seed);
  const tone = free.filter((i) => TONE_PARTS.includes(base[i].name));
  const toneGens = opts.toneGenerations ?? 40;
  if (tone.length && toneGens > 0) {
    const again = search(vals, tone, 1.5, toneGens, seed + 1);
    if (again.f < fitted) ({ vals, f: fitted } = again);
  }
  for (const i of free) if (base[i].part) vals[i] = eValue(vals[i]);
  let snapped = score(vals);
  for (let pass = 0, moved = true; moved && pass < 4; pass++) {
    moved = false;
    for (const i of free) {
      if (!base[i].part) continue;
      for (const s of [-1, 1]) {
        const tryVals = vals.slice();
        tryVals[i] = eValue(vals[i], s);
        const d = score(tryVals);
        if (d < snapped) { snapped = d; vals[i] = tryVals[i]; moved = true; }
      }
    }
  }
  return {
    amp: withValues(start, vals),
    values: base.map((v, i) => ({ ...v, value: vals[i] })),
    fitted, snapped, evaluations,
  };
}

/** Each part value moved by a random factor up to ×/÷ `spread`, then rounded to E24: a plausible wrong guess. */
export function scramble(amp: AmpDef, seed: number, spread = 2, only?: string[]): AmpDef {
  const rand = mulberry32(seed);
  return withValues(amp, valuesOf(amp).map((v) => {
    if (only && !only.includes(v.name)) return v.value;
    const f = spread ** (rand() * 2 - 1);
    return v.part ? eValue(v.value * f) : v.value * f;
  }));
}

/**
 * Separable CMA-ES (Ros & Hansen 2008): CMA-ES with a diagonal covariance, so
 * each generation costs O(n) instead of an eigen-decomposition. Minimises `f`
 * from the middle of [0, 1]^n with a step of 0.2.
 */
export function sepCmaEs(
  n: number, f: (x: Float64Array) => number,
  opts: { generations: number; population?: number; seed?: number; onGeneration?: (g: number, best: number) => void },
): { x: Float64Array; f: number } {
  const rand = mulberry32(opts.seed ?? 1);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const lambda = opts.population ?? 4 + Math.floor(3 * Math.log(n)), mu = lambda >> 1;
  const raw = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const sum = raw.reduce((a, b) => a + b, 0), w = raw.map((x) => x / sum);
  const mueff = 1 / w.reduce((a, b) => a + b * b, 0);
  const cs = (mueff + 2) / (n + mueff + 5);
  const ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
  const cc = (4 + mueff / n) / (n + 4 + (2 * mueff) / n);
  const sep = (n + 2) / 3;
  const c1 = Math.min(1, (sep * 2) / ((n + 1.3) ** 2 + mueff));
  const cmu = Math.min(1 - c1, (sep * 2 * (mueff - 2 + 1 / mueff)) / ((n + 2) ** 2 + mueff));
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  const m = new Float64Array(n).fill(0.5), C = new Float64Array(n).fill(1);
  const ps = new Float64Array(n), pc = new Float64Array(n);
  let sigma = 0.2;
  let best = { x: Float64Array.from(m), f: f(m) };
  for (let g = 0; g < opts.generations; g++) {
    const pop = Array.from({ length: lambda }, () => {
      const z = Float64Array.from({ length: n }, gauss);
      const x = Float64Array.from(z, (zi, j) => m[j] + sigma * Math.sqrt(C[j]) * zi);
      return { z, x, f: f(x) };
    }).sort((a, b) => a.f - b.f);
    if (pop[0].f < best.f) best = { x: Float64Array.from(pop[0].x), f: pop[0].f };
    const zw = new Float64Array(n), yw = new Float64Array(n), yy = new Float64Array(n);
    for (let i = 0; i < mu; i++) for (let j = 0; j < n; j++) {
      const y = Math.sqrt(C[j]) * pop[i].z[j];
      zw[j] += w[i] * pop[i].z[j]; yw[j] += w[i] * y; yy[j] += w[i] * y * y;
    }
    for (let j = 0; j < n; j++) { m[j] += sigma * yw[j]; ps[j] = (1 - cs) * ps[j] + Math.sqrt(cs * (2 - cs) * mueff) * zw[j]; }
    const psNorm = Math.hypot(...ps);
    const hsig = psNorm / Math.sqrt(1 - (1 - cs) ** (2 * (g + 1))) / chiN < 1.4 + 2 / (n + 1) ? 1 : 0;
    for (let j = 0; j < n; j++) {
      pc[j] = (1 - cc) * pc[j] + hsig * Math.sqrt(cc * (2 - cc) * mueff) * yw[j];
      C[j] = (1 - c1 - cmu) * C[j] + c1 * (pc[j] ** 2 + (1 - hsig) * cc * (2 - cc) * C[j]) + cmu * yy[j];
    }
    sigma *= Math.exp((cs / ds) * (psNorm / chiN - 1));
    opts.onGeneration?.(g, best.f);
    if (sigma * Math.sqrt(Math.max(...C)) < 1e-4) break;
  }
  return best;
}
