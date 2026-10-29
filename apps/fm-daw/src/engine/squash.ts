// Squash: the "over the top" multiband compressor on the master, written from
// the textbook design. Three bands split by Linkwitz-Riley crossovers (two
// Butterworth sections each, so the bands sum back flat), and on each band a
// compressor that works both ways: loud parts come down past one threshold,
// quiet ones (tails, breaths, the reverb under a chord) come up below another.
// Everything gets dense and in your face. Amount scales every band's gain move,
// so 0 is off and costs nothing.
//
// It runs in TypeScript after either engine and before Space (worklet and
// bounce alike), so Rust/TS parity is untouched, and ends in its own peak
// limiter and clamp at CEILING. No allocation in process().
import { CEILING } from "./params.ts";

/** Crossovers, Hz: lows below the first, highs above the second. */
const XO = [120, 2500];
// Per band: downward threshold, upward threshold (dB), attack and release (s).
const DOWN_DB = [-20, -18, -20];
const UP_DB = [-38, -40, -42];
const ATTACK = [0.02, 0.006, 0.003];
const RELEASE = [0.25, 0.12, 0.08];
const DOWN_RATIO = 4;
const UP_RATIO = 3;
/** The most a band is lifted, dB, at amount 1. */
const MAX_UP = 16;
/** Below this the band is silence, not a tail: no lift (keeps hiss down). */
const FLOOR_DB = -72;
/** Band gains after compression at amount 1, dB: the smile curve that makes it shine. */
const TILT_DB = [2, 0, 3];
const K = Math.SQRT2; // Butterworth damping

export class Squash {
  private amount = 0;
  private amountNow = 0;
  // crossover SVFs: coefs [a1, a2, a3] per crossover; states [ic1, ic2] per section per channel
  private readonly k = new Float64Array(6);
  private readonly s = new Float64Array(64);
  private readonly env = new Float64Array(3);
  private readonly bands = new Float64Array(6);
  private readonly atk = new Float64Array(3);
  private readonly rel = new Float64Array(3);
  private limEnv = 0;
  private readonly limRel: number;

  constructor(sampleRate: number) {
    for (let x = 0; x < 2; x++) {
      const g = Math.tan((Math.PI * XO[x]) / sampleRate);
      const a1 = 1 / (1 + g * (g + K));
      this.k[x * 3] = a1; this.k[x * 3 + 1] = g * a1; this.k[x * 3 + 2] = g * g * a1;
    }
    for (let b = 0; b < 3; b++) {
      this.atk[b] = 1 - Math.exp(-1 / (ATTACK[b] * sampleRate));
      this.rel[b] = 1 - Math.exp(-1 / (RELEASE[b] * sampleRate));
    }
    this.limRel = Math.exp(-1 / (0.1 * sampleRate));
  }

  /** 0 is off, 1 is the full squash. */
  setAmount(a: number) { this.amount = Number.isFinite(a) ? Math.min(Math.max(a, 0), 1) : 0; }

  reset() { this.s.fill(0); this.env.fill(0); this.limEnv = 0; }

  /** One SVF section (state slot `z`), crossover `x`: returns [band, low]; high is in - K*band - low. */
  private svf(x: number, z: number, v: number): number {
    const k = this.k, s = this.s, c = x * 3;
    const v3 = v - s[z + 1];
    const v1 = k[c] * s[z] + k[c + 1] * v3;
    const v2 = s[z + 1] + k[c + 1] * s[z] + k[c + 2] * v3;
    s[z] = 2 * v1 - s[z];
    s[z + 1] = 2 * v2 - s[z + 1];
    this.band = v1;
    return v2;
  }
  private band = 0;
  private lp(x: number, z: number, v: number) { return this.svf(x, z, this.svf(x, z + 2, v)); }
  private hp(x: number, z: number, v: number) {
    let low = this.svf(x, z + 2, v);
    const h1 = v - K * this.band - low;
    low = this.svf(x, z, h1);
    return h1 - K * this.band - low;
  }

  /** Squashes interleaved stereo `buf` in place. */
  process(buf: Float32Array, frames: number) {
    const n = Math.min(frames, buf.length >> 1);
    if (this.amount === 0 && this.amountNow < 1e-4) { this.amountNow = 0; return; }
    for (let f = 0; f < n; f++) {
      this.amountNow += (this.amount - this.amountNow) * 0.0005;
      const a = this.amountNow;
      let ol = 0, or = 0;
      // split each channel: low = LR4 low-pass at XO[0]; the rest splits at XO[1];
      // the low band goes through XO[1]'s allpass so all three stay in phase
      const bands = this.bands; // [low L, low R, mid L, mid R, high L, high R]
      for (let ch = 0; ch < 2; ch++) {
        const v = buf[f * 2 + ch], z = ch * 32;
        const l0 = this.lp(0, z, v);
        const rest = this.hp(0, z + 4, v);
        this.svf(1, z + 8, l0);
        bands[ch] = l0 - 2 * K * this.band;
        bands[2 + ch] = this.lp(1, z + 12, rest);
        bands[4 + ch] = this.hp(1, z + 16, rest);
      }
      for (let b = 0; b < 3; b++) {
        const bl = bands[b * 2], br = bands[b * 2 + 1];
        const pk = Math.max(Math.abs(bl), Math.abs(br));
        const e = this.env[b];
        this.env[b] = e + (pk > e ? this.atk[b] : this.rel[b]) * (pk - e);
        const db = 20 * Math.log10(this.env[b] + 1e-9);
        let move = TILT_DB[b];
        if (db > DOWN_DB[b]) move -= (db - DOWN_DB[b]) * (1 - 1 / DOWN_RATIO);
        else if (db < UP_DB[b] && db > FLOOR_DB) move += Math.min((UP_DB[b] - db) * (1 - 1 / UP_RATIO), MAX_UP);
        const g = Math.pow(10, (move * a) / 20);
        ol += bl * g; or += br * g;
      }
      if (!Number.isFinite(ol) || !Number.isFinite(or)) { this.reset(); ol = 0; or = 0; }
      const pk = Math.max(Math.abs(ol), Math.abs(or));
      this.limEnv = pk > this.limEnv ? pk : pk + (this.limEnv - pk) * this.limRel;
      const lim = this.limEnv > CEILING ? CEILING / this.limEnv : 1;
      buf[f * 2] = Math.min(Math.max(ol * lim, -CEILING), CEILING);
      buf[f * 2 + 1] = Math.min(Math.max(or * lim, -CEILING), CEILING);
    }
  }
}
