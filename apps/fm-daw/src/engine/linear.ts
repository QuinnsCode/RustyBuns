// Shape in linear phase: an FIR built from the same curve the page draws, run
// with FFT convolution. Every frequency comes out late by the same amount, so a
// steep cut turns no phase at all (the Phase curve goes flat); the price is a
// fixed delay, `latency` frames, which the bounce trims and recording makes up for.
//
// The kernel: Shape's level sampled on N FFT bins (zero phase), turned into an
// impulse, centred at N/2 and Hann-windowed. N is about 0.17 s, so the bins sit
// ~6 Hz apart: a steep cut or a narrow notch below ~60 Hz comes out a little
// softer than drawn. The convolution is uniformly partitioned overlap-save with
// blocks of B frames, both channels packed into one complex FFT (left real, right
// imaginary; the kernel is real, so they never mix). A new curve is a new kernel,
// crossfaded in over one block. No allocation in process().
import { EQ_BANDS, responseInto, type EqBand, type EqDoc, type EqListen, type EqStage } from "./eq.ts";
import { CEILING } from "./params.ts";

/** In-place radix-2 complex FFT of a fixed power-of-two size. */
export class Fft {
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  constructor(readonly n: number) {
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = r; }
    this.cos = new Float64Array(n >> 1); this.sin = new Float64Array(n >> 1);
    for (let i = 0; i < n >> 1; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / n); this.sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  }
  /** Forward transform; `inverse` conjugates the twiddles (unscaled: divide by n yourself). */
  run(re: Float64Array, im: Float64Array, inverse = false) {
    const n = this.n, rev = this.rev, sg = inverse ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k++) {
          const wr = this.cos[k * step], wi = sg * this.sin[k * step];
          const a = s + k, b = a + half;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }
}

/** Block size of the convolution, frames. */
export const LINEAR_BLOCK = 256;
/** Kernel taps at this rate: a power of two near 0.17 s. */
export const kernelLength = (sr: number) => Math.max(1024, 2 ** Math.round(Math.log2(sr * 0.17)));
/** Frames a linear-phase Shape holds the mix back: half the kernel, plus one block of buffering. */
export const linearLatency = (sr: number) => kernelLength(sr) / 2 + LINEAR_BLOCK;

/** Builds kernels for one rate. Owns its scratch, so a redesign on the audio thread allocates nothing. */
export class KernelDesigner {
  readonly n: number;
  private readonly fft: Fft;
  private readonly freqs: Float64Array;
  private readonly db: Float64Array; private readonly deg: Float64Array;
  private readonly bd: Float64Array; private readonly bp: Float64Array;
  private readonly re: Float64Array; private readonly im: Float64Array;
  constructor(readonly sr: number) {
    const n = (this.n = kernelLength(sr)), h = (n >> 1) + 1;
    this.fft = new Fft(n);
    this.freqs = Float64Array.from({ length: h }, (_, k) => (k * sr) / n);
    this.db = new Float64Array(h); this.deg = new Float64Array(h); this.bd = new Float64Array(h); this.bp = new Float64Array(h);
    this.re = new Float64Array(n); this.im = new Float64Array(n);
  }
  /** The kernel for this doc into `out` (n taps), centred on tap n/2. */
  design(doc: EqDoc, out: Float64Array) {
    const n = this.n, h = n >> 1, re = this.re, im = this.im;
    responseInto(doc, this.sr, this.freqs, this.db, this.deg, this.bd, this.bp);
    for (let k = 0; k <= h; k++) {
      const m = Math.pow(10, this.db[k] / 20);
      re[k] = m; im[k] = 0;
      if (k > 0 && k < h) { re[n - k] = m; im[n - k] = 0; }
    }
    this.fft.run(re, im, true);
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      out[i] = (re[(i - h + n) % n] / n) * w;
    }
  }
}

/** The kernel Shape would play in linear phase (for tests and the curious). */
export function linearKernel(doc: EqDoc, sr: number) {
  const d = new KernelDesigner(sr), out = new Float64Array(d.n);
  d.design(doc, out);
  return out;
}

/** Redesign no more often than every this many blocks while a band moves (automation, a drag). */
const REDESIGN_BLOCKS = 2;

export class LinearEq implements EqStage {
  readonly latency: number;
  private readonly B = LINEAR_BLOCK;
  private readonly M = 2 * LINEAR_BLOCK;
  private readonly parts: number;
  private readonly designer: KernelDesigner;
  private readonly fft: Fft;
  private readonly taps: Float64Array;
  /** Kernel partition spectra, now and next (crossfaded in), parts * M each. */
  private hRe: Float64Array; private hIm: Float64Array;
  private nRe: Float64Array; private nIm: Float64Array;
  /** Input spectra, newest at `slot`, parts * M. */
  private readonly xRe: Float64Array; private readonly xIm: Float64Array;
  private slot = 0;
  private readonly tRe: Float64Array; private readonly tIm: Float64Array;
  private readonly yRe: Float64Array; private readonly yIm: Float64Array;
  private readonly zRe: Float64Array; private readonly zIm: Float64Array;
  /** Last block in, and the block coming in; the block going out (interleaved). */
  private readonly prev: Float64Array; private readonly fill: Float64Array; private readonly outBuf: Float64Array;
  private at = 0;
  /** The bands plus the listen band: what the next kernel is built from. */
  private readonly heard: (EqBand | null)[] = Array.from({ length: EQ_BANDS + 1 }, () => null);
  private dirty = true;
  private since = REDESIGN_BLOCKS;
  private readonly limRel: number;
  private limEnv = 0;

  constructor(private readonly sr: number) {
    this.designer = new KernelDesigner(sr);
    const n = this.designer.n, M = this.M;
    this.parts = n / this.B;
    this.latency = linearLatency(sr);
    this.fft = new Fft(M);
    this.taps = new Float64Array(n);
    const z = () => new Float64Array(this.parts * M);
    this.hRe = z(); this.hIm = z(); this.nRe = z(); this.nIm = z(); this.xRe = z(); this.xIm = z();
    this.tRe = new Float64Array(M); this.tIm = new Float64Array(M);
    this.yRe = new Float64Array(M); this.yIm = new Float64Array(M);
    this.zRe = new Float64Array(M); this.zIm = new Float64Array(M);
    this.prev = new Float64Array(2 * this.B); this.fill = new Float64Array(2 * this.B); this.outBuf = new Float64Array(2 * this.B);
    this.limRel = Math.exp(-1 / (0.1 * sr));
    this.design(this.hRe, this.hIm);
  }

  set(doc: EqDoc) {
    for (let i = 0; i < EQ_BANDS; i++) this.heard[i] = doc[i] ?? null;
    this.dirty = true;
  }

  listen(b: EqListen | null) {
    this.heard[EQ_BANDS] = b ? { kind: "bandPass", f: b.f, g: 0, q: b.q, slope: 12, on: true } : null;
    this.dirty = true;
  }

  reset() {
    this.xRe.fill(0); this.xIm.fill(0); this.prev.fill(0); this.fill.fill(0); this.outBuf.fill(0);
    this.at = 0; this.limEnv = 0;
    this.design(this.hRe, this.hIm);
    this.dirty = false;
  }

  /** The kernel for what's heard now, as partition spectra into (re, im). */
  private design(re: Float64Array, im: Float64Array) {
    this.designer.design(this.heard, this.taps);
    const B = this.B, M = this.M, t = this.taps;
    for (let p = 0; p < this.parts; p++) {
      const r = this.tRe, i = this.tIm;
      for (let k = 0; k < M; k++) { r[k] = k < B ? t[p * B + k] : 0; i[k] = 0; }
      this.fft.run(r, i);
      re.set(r, p * M); im.set(i, p * M);
    }
  }

  /** Sum of input spectra times kernel spectra into (yr, yi). */
  private mac(hr: Float64Array, hi: Float64Array, yr: Float64Array, yi: Float64Array) {
    const M = this.M, P = this.parts, xr = this.xRe, xi = this.xIm;
    yr.fill(0); yi.fill(0);
    for (let p = 0; p < P; p++) {
      const xo = ((this.slot - p + P) % P) * M, ho = p * M;
      for (let k = 0; k < M; k++) {
        const ar = xr[xo + k], ai = xi[xo + k], br = hr[ho + k], bi = hi[ho + k];
        yr[k] += ar * br - ai * bi;
        yi[k] += ar * bi + ai * br;
      }
    }
    this.fft.run(yr, yi, true);
  }

  /** One block in (`fill`), one block out (`outBuf`). */
  private block() {
    const B = this.B, M = this.M, r = this.tRe, i = this.tIm;
    for (let k = 0; k < B; k++) {
      r[k] = this.prev[k * 2]; i[k] = this.prev[k * 2 + 1];
      r[B + k] = this.fill[k * 2]; i[B + k] = this.fill[k * 2 + 1];
    }
    this.prev.set(this.fill);
    this.fft.run(r, i);
    this.slot = (this.slot + 1) % this.parts;
    this.xRe.set(r, this.slot * M); this.xIm.set(i, this.slot * M);
    this.since++;
    const fade = this.dirty && this.since >= REDESIGN_BLOCKS;
    this.mac(this.hRe, this.hIm, this.yRe, this.yIm);
    if (fade) {
      this.design(this.nRe, this.nIm);
      this.mac(this.nRe, this.nIm, this.zRe, this.zIm);
      const hr = this.hRe, hi = this.hIm;
      this.hRe = this.nRe; this.hIm = this.nIm; this.nRe = hr; this.nIm = hi;
      this.dirty = false;
      this.since = 0;
    }
    for (let k = 0; k < B; k++) {
      let l = this.yRe[B + k] / M, rr = this.yIm[B + k] / M;
      if (fade) {
        const w = (k + 0.5) / B;
        l += (this.zRe[B + k] / M - l) * w;
        rr += (this.zIm[B + k] / M - rr) * w;
      }
      this.outBuf[k * 2] = l; this.outBuf[k * 2 + 1] = rr;
    }
  }

  process(buf: Float32Array, frames: number) {
    const n = Math.min(frames, buf.length >> 1), B = this.B;
    for (let f = 0; f < n; f++) {
      const j = this.at * 2;
      const il = buf[f * 2], ir = buf[f * 2 + 1];
      this.fill[j] = Number.isFinite(il) ? il : 0; this.fill[j + 1] = Number.isFinite(ir) ? ir : 0;
      const l = this.outBuf[j], r = this.outBuf[j + 1];
      if (++this.at === B) { this.at = 0; this.block(); }
      const pk = Math.max(Math.abs(l), Math.abs(r));
      this.limEnv = pk > this.limEnv ? pk : pk + (this.limEnv - pk) * this.limRel;
      const lim = this.limEnv > CEILING ? CEILING / this.limEnv : 1;
      buf[f * 2] = Math.min(Math.max(l * lim, -CEILING), CEILING);
      buf[f * 2 + 1] = Math.min(Math.max(r * lim, -CEILING), CEILING);
    }
  }
}

/** A plain stereo delay (interleaved frames): Space's send, held back by as much as the linear EQ holds the mix. */
export class Delay {
  private readonly ring: Float32Array;
  private at = 0;
  constructor(readonly frames: number) { this.ring = new Float32Array(Math.max(1, frames) * 2); }
  process(buf: Float32Array, frames: number) {
    if (this.frames <= 0) return;
    const n = Math.min(frames, buf.length >> 1), ring = this.ring;
    for (let f = 0; f < n; f++) {
      const j = this.at * 2;
      const l = ring[j], r = ring[j + 1];
      ring[j] = buf[f * 2]; ring[j + 1] = buf[f * 2 + 1];
      buf[f * 2] = l; buf[f * 2 + 1] = r;
      if (++this.at === this.frames) this.at = 0;
    }
  }
  reset() { this.ring.fill(0); this.at = 0; }
}
