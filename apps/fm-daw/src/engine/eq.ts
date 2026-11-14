// Shape: the master EQ. The design notes (why SVFs, why series, the phase a
// steep cut costs) are at the top of its Rust half, native/crates/fm_daw/src/eq.rs.
// This file is its TypeScript twin, the same arithmetic in the same order, so
// both run when the Rust engine is or isn't loaded; plus the band model the
// project saves, and `response()`, the exact curve the page draws.
//
// It runs after either engine and before Squash: corrective EQ first, then
// compression. No allocation in process().
import { bool, num, obj, oneOf, type Guard } from "@rustybuns/util/guard";
import { CEILING } from "./params.ts";

export const EQ_BANDS = 8;
export const EQ_KINDS = ["bell", "lowShelf", "highShelf", "lowCut", "highCut", "notch", "bandPass"] as const;
export type EqKind = (typeof EQ_KINDS)[number];
/** Cut slopes, dB per octave: 6 per Butterworth order. */
export const EQ_SLOPES = [6, 12, 18, 24, 36, 48, 72, 96] as const;
export const EQ_LIMITS = { f: [20, 20000], g: [-30, 30], q: [0.1, 18] } as const;
/** kind, Hz, dB (bells and shelves), Q (width, or resonance on cuts and shelves), dB/oct (cuts), on. */
export interface EqBand { kind: EqKind; f: number; g: number; q: number; slope: number; on: boolean }
/** A fixed slot per band, so removing one never slides the others into its place mid-groove. */
export type EqDoc = (EqBand | null)[];

export const flatEq = (): EqDoc => Array.from({ length: EQ_BANDS }, () => null);
export const hasGain = (k: EqKind) => k === "bell" || k === "lowShelf" || k === "highShelf";
export const isCut = (k: EqKind) => k === "lowCut" || k === "highCut";

const BAND: Guard<EqBand> = obj({
  kind: oneOf(EQ_KINDS, "bell"), f: num(...EQ_LIMITS.f, 1000), g: num(...EQ_LIMITS.g, 0), q: num(...EQ_LIMITS.q, Math.SQRT1_2),
  slope: num(6, 96, 12), on: bool(true),
});
/** Anything to EQ_BANDS slots: a band each, or null. Old projects have none: flat. */
export function sanitizeEq(x: unknown): EqDoc {
  const got: unknown[] = Array.isArray(x) ? x.slice(0, EQ_BANDS) : [];
  return flatEq().map((_, i) => { const v = got[i]; return typeof v === "object" && v ? BAND(v) : null; });
}

/** The audio side: TsEq here, WasmEq (src/engine/wasm.ts) for the Rust half. */
export interface EqStage {
  set(doc: EqDoc): void;
  process(buf: Float32Array, frames: number): void;
  reset(): void;
  free?(): void;
}

/**
 * Hands each slot to `setBand` (index, kind number, Hz, dB, Q, slope, on). An empty
 * slot keeps its last settings and turns off, so it fades out instead of jumping.
 */
export function sendEq(doc: EqDoc, last: EqBand[], setBand: (i: number, kind: number, f: number, g: number, q: number, slope: number, on: boolean) => void) {
  for (let i = 0; i < EQ_BANDS; i++) {
    const b = doc[i];
    if (b) last[i] = b;
    const s = last[i];
    if (!s) continue;
    setBand(i, EQ_KINDS.indexOf(s.kind), s.f, s.g, s.q, s.slope, !!b && b.on);
  }
}

// ---- the filters: line for line with eq.rs ----

const BELL = 0, LOW_SHELF = 1, HIGH_SHELF = 2, LOW_CUT = 3, HIGH_CUT = 4, NOTCH = 5, BAND_PASS = 6;
const SECS = 8;
const BLOCK = 16;
const GLIDE_S = 0.02;
const BW_Q = Math.SQRT1_2;
const clampf = (v: number, lo: number, hi: number, d: number) => (Number.isFinite(v) ? Math.min(Math.max(v, lo), hi) : d);
export const orderOf = (slope: number) => clampf(Math.round(slope / 6), 1, 16, 2);

class Band {
  kind = BELL; order = 0; on = false;
  f = 0; g = 0; q = 0; fNow = 0; gNow = 0; qNow = 0; mix = 0;
  /** per section: a1 a2 a3 m0 m1 m2 */
  readonly c = new Float64Array(SECS * 6);
  nsec = 0;
  pole = 0;
  /** per channel, per section: ic1 ic2 */
  readonly s = new Float64Array(2 * SECS * 2);
  readonly p = new Float64Array(2);

  private sec(i: number, g: number, k: number, m0: number, m1: number, m2: number) {
    const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, o = i * 6;
    this.c[o] = a1; this.c[o + 1] = a2; this.c[o + 2] = g * a2; this.c[o + 3] = m0; this.c[o + 4] = m1; this.c[o + 5] = m2;
  }

  design(sr: number) {
    const fc = Math.min(Math.pow(2, this.fNow), 0.49 * sr);
    const w = Math.tan((Math.PI * fc) / sr);
    const q = Math.exp(this.qNow);
    const a = Math.pow(10, this.gNow / 40);
    this.pole = 0;
    this.nsec = 1;
    switch (this.kind) {
      case LOW_SHELF: { const g = w / Math.sqrt(a), k = 1 / q; this.sec(0, g, k, 1, k * (a - 1), a * a - 1); break; }
      case HIGH_SHELF: { const g = w * Math.sqrt(a), k = 1 / q; this.sec(0, g, k, a * a, k * (1 - a) * a, 1 - a * a); break; }
      case NOTCH: { const k = 1 / q; this.sec(0, w, k, 1, -k, 0); break; }
      case BAND_PASS: { const k = 1 / q; this.sec(0, w, k, 0, k, 0); break; }
      case LOW_CUT: case HIGH_CUT: {
        const n = this.order, low = this.kind === LOW_CUT;
        this.nsec = n >> 1;
        for (let i = 0; i < this.nsec; i++) {
          const theta = ((2 * i + 1) * Math.PI) / (2 * n);
          let qs = 1 / (2 * Math.cos(theta));
          if (i + 1 === this.nsec) qs *= q / BW_Q;
          const k = 1 / qs;
          if (low) this.sec(i, w, k, 1, -k, -1); else this.sec(i, w, k, 0, 0, 1);
        }
        if (n % 2 === 1) this.pole = w / (1 + w);
        break;
      }
      default: { const k = 1 / (q * a); this.sec(0, w, k, 1, k * (a * a - 1), 0); }
    }
  }

  run(ch: number, x: number): number {
    let y = x;
    if (this.pole > 0) {
      const v = (y - this.p[ch]) * this.pole;
      const lp = v + this.p[ch];
      this.p[ch] = lp + v;
      y = this.kind === LOW_CUT ? y - lp : lp;
    }
    const c = this.c, s = this.s;
    for (let i = 0; i < this.nsec; i++) {
      const o = i * 6, j = (ch * SECS + i) * 2;
      const v3 = y - s[j + 1];
      const v1 = c[o] * s[j] + c[o + 1] * v3;
      const v2 = s[j + 1] + c[o + 1] * s[j] + c[o + 2] * v3;
      s[j] = 2 * v1 - s[j];
      s[j + 1] = 2 * v2 - s[j + 1];
      y = c[o + 3] * y + c[o + 4] * v1 + c[o + 5] * v2;
    }
    return x + (y - x) * this.mix;
  }

  clear() { this.s.fill(0); this.p.fill(0); }
}

export class TsEq implements EqStage {
  private readonly bands = Array.from({ length: EQ_BANDS }, () => new Band());
  private readonly last: EqBand[] = [];
  private readonly glide: number;
  private readonly limRel: number;
  private limEnv = 0;
  private tick = 0;

  constructor(private readonly sr: number) {
    this.glide = 1 - Math.exp(-BLOCK / (GLIDE_S * sr));
    this.limRel = Math.exp(-1 / (0.1 * sr));
  }

  set(doc: EqDoc) { sendEq(doc, this.last, (i, k, f, g, q, sl, on) => this.setBand(i, k, f, g, q, sl, on)); }

  setBand(i: number, kind: number, freq: number, gain: number, q: number, slope: number, on: boolean) {
    if (i < 0 || i >= EQ_BANDS) return;
    const b = this.bands[i];
    const k = kind >= 0 && kind <= BAND_PASS ? kind : BELL;
    const order = k === LOW_CUT || k === HIGH_CUT ? orderOf(slope) : 2;
    const wasOff = !b.on && b.mix === 0;
    if (k !== b.kind || order !== b.order) b.clear();
    b.kind = k; b.order = order; b.on = on;
    b.f = Math.log2(clampf(freq, 20, 20000, 1000));
    b.g = clampf(gain, -30, 30, 0);
    b.q = Math.log(clampf(q, 0.1, 18, BW_Q));
    if (wasOff) { b.fNow = b.f; b.gNow = b.g; b.qNow = b.q; b.clear(); }
    b.design(this.sr);
  }

  reset() {
    for (const b of this.bands) { b.clear(); b.mix = b.on ? 1 : 0; }
    this.limEnv = 0;
  }

  process(buf: Float32Array, frames: number) {
    const n = Math.min(frames, buf.length >> 1);
    if (!this.bands.some((b) => b.on || b.mix > 0)) { this.limEnv = 0; return; }
    for (let f = 0; f < n; f++) {
      if (this.tick === 0) {
        const c = this.glide;
        for (const b of this.bands) {
          const target = b.on ? 1 : 0;
          if (b.mix === target && b.fNow === b.f && b.gNow === b.g && b.qNow === b.q) continue;
          b.fNow += (b.f - b.fNow) * c;
          b.gNow += (b.g - b.gNow) * c;
          b.qNow += (b.q - b.qNow) * c;
          b.mix += (target - b.mix) * c;
          if (Math.abs(b.f - b.fNow) < 1e-6) b.fNow = b.f;
          if (Math.abs(b.g - b.gNow) < 1e-6) b.gNow = b.g;
          if (Math.abs(b.q - b.qNow) < 1e-6) b.qNow = b.q;
          if (Math.abs(target - b.mix) < 1e-4) { b.mix = target; if (!b.on) b.clear(); }
          b.design(this.sr);
        }
      }
      this.tick = (this.tick + 1) % BLOCK;
      let l = buf[f * 2], r = buf[f * 2 + 1];
      const dl = l, dr = r;
      for (const b of this.bands) {
        if (b.mix === 0) continue;
        l = b.run(0, l);
        r = b.run(1, r);
      }
      if (!Number.isFinite(l) || !Number.isFinite(r)) {
        for (const b of this.bands) b.clear();
        l = Number.isFinite(dl) ? dl : 0;
        r = Number.isFinite(dr) ? dr : 0;
      }
      const pk = Math.max(Math.abs(l), Math.abs(r));
      this.limEnv = pk > this.limEnv ? pk : pk + (this.limEnv - pk) * this.limRel;
      const lim = this.limEnv > CEILING ? CEILING / this.limEnv : 1;
      buf[f * 2] = Math.min(Math.max(l * lim, -CEILING), CEILING);
      buf[f * 2 + 1] = Math.min(Math.max(r * lim, -CEILING), CEILING);
    }
  }
}

// ---- the curve the page draws ----

/**
 * One band's exact digital response at each frequency: level in dB and phase in
 * degrees (-180..180). Each trapezoidal SVF section is
 *   H = m0 + (m1 s + m2) / (s^2 + k s + 1),  s = j tan(pi f / sr) / g,
 * and the one-pole of an odd-order cut is 1 / (1 + s) (or s / (1 + s) for a low cut),
 * so this is what process() does, cramping near Nyquist included.
 */
export function bandResponse(b: EqBand, sr: number, freqs: ArrayLike<number>, db: Float64Array, deg: Float64Array) {
  const band = new Band();
  band.kind = EQ_KINDS.indexOf(b.kind);
  band.order = isCut(b.kind) ? orderOf(b.slope) : 2;
  band.fNow = Math.log2(clampf(b.f, 20, 20000, 1000));
  band.gNow = clampf(b.g, -30, 30, 0);
  band.qNow = Math.log(clampf(b.q, 0.1, 18, BW_Q));
  band.design(sr);
  const c = band.c;
  for (let i = 0; i < freqs.length; i++) {
    const t = Math.tan((Math.PI * Math.min(freqs[i], 0.4999 * sr)) / sr);
    let re = 1, im = 0;
    const mul = (xr: number, xi: number) => { const r = re * xr - im * xi; im = re * xi + im * xr; re = r; };
    for (let k = 0; k < band.nsec; k++) {
      const o = k * 6, a1 = c[o], a2 = c[o + 1];
      // recover g and k from a1 = 1/(1+g(g+k)), a2 = g a1
      const g = a2 / a1, kk = (1 / a1 - 1) / g - g;
      const w = t / g; // s = j w
      const dr = 1 - w * w, di = kk * w; // s^2 + k s + 1
      const nr = c[o + 5], ni = c[o + 4] * w; // m1 s + m2
      const den = dr * dr + di * di;
      mul(c[o + 3] + (nr * dr + ni * di) / den, (ni * dr - nr * di) / den);
    }
    if (band.pole > 0) {
      const g = band.pole / (1 - band.pole), w = t / g, den = 1 + w * w;
      // 1/(1+jw) = (1 - jw)/den; jw/(1+jw) = (w^2 + jw)/den
      if (band.kind === LOW_CUT) mul((w * w) / den, w / den); else mul(1 / den, -w / den);
    }
    db[i] = 10 * Math.log10(Math.max(re * re + im * im, 1e-30));
    deg[i] = (Math.atan2(im, re) * 180) / Math.PI;
  }
}

/** The whole EQ: the sum of each band's dB and phase (bands in series multiply). */
export function response(doc: EqDoc, sr: number, freqs: ArrayLike<number>) {
  const db = new Float64Array(freqs.length), deg = new Float64Array(freqs.length);
  const bd = new Float64Array(freqs.length), bp = new Float64Array(freqs.length);
  for (const b of doc) {
    if (!b?.on) continue;
    bandResponse(b, sr, freqs, bd, bp);
    for (let i = 0; i < freqs.length; i++) { db[i] += bd[i]; deg[i] += bp[i]; }
  }
  for (let i = 0; i < freqs.length; i++) deg[i] = ((((deg[i] + 180) % 360) + 360) % 360) - 180;
  return { db, deg };
}
