// Master tempo (key lock) for a QDJ deck: the track plays faster or slower at its own pitch. deck-worklet.ts runs it;
// it is plain arithmetic, so a test can play a tone through it without a browser. It is a WSOLA time-stretch:
// windowed frames of the track at its own pitch, laid half over each other, one hop of output per frame, each frame
// taken from where the deck is now (so a stretched deck stays on the same beat as an unstretched one) but nudged by
// up to SEEK samples to where its sound best continues the last frame, so the overlaps add up without beating.
// No Web Audio or DOM in here.

/** A frame's length and the hop between frames, output samples (about 43 and 21 ms at 48 kHz). */
export const FRAME = 2048;
export const HOP = FRAME / 2;
/** How far either way a frame may move to fit the last one, source samples (about 8 ms at 48 kHz). */
export const SEEK = 384;

/** A periodic Hann window: two of them half over each other add up to exactly one. */
const HANN = Float32Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME));

/** The track as the stretch reads it: channel `c` at `s` seconds into the track (loops already wrapped), 0 off the ends. */
export type Read = (c: number, s: number) => number;

export class Stretch {
  private readonly ola: Float32Array[];
  private readonly ready: Float32Array[];
  private readonly want = new Float32Array(HOP / 8);
  /** Where the last frame started in the track, seconds; NaN: no last frame (start fresh). */
  private last = NaN;
  /** How far into the ready hop the output is. */
  private at = HOP;
  constructor(readonly chans: number, readonly outRate: number, readonly srcRate: number) {
    this.ola = Array.from({ length: chans }, () => new Float32Array(FRAME));
    this.ready = Array.from({ length: chans }, () => new Float32Array(HOP));
  }
  /** Start fresh: the next frame starts where it is told, with nothing laid over it. */
  reset() { this.last = NaN; this.at = HOP; for (const o of this.ola) o.fill(0); }
  /**
   * The next output sample into `out` (one value per channel). `pos` says where the deck is in the track (seconds)
   * at an output sample `k` ahead of now; it is asked only when a new frame starts.
   */
  next(out: Float32Array, read: Read, pos: (k: number) => number) {
    if (this.at >= HOP) { this.frame(read, pos(0)); this.at = 0; }
    for (let c = 0; c < this.chans; c++) out[c] = this.ready[c]![this.at]!;
    this.at++;
  }
  private frame(read: Read, nominal: number) {
    const dt = 1 / this.outRate, cont = this.last + HOP * dt;
    // a jump (a seek, a hot cue, a loop's wrap) starts again where it lands: the window's overlap crossfades it
    const start = Number.isNaN(cont) || Math.abs(nominal - cont) > 0.05 ? nominal : this.fit(read, nominal, cont);
    for (let c = 0; c < this.chans; c++) {
      const o = this.ola[c]!;
      for (let i = 0; i < FRAME; i++) o[i]! += HANN[i]! * read(c, start + i * dt);
      this.ready[c]!.set(o.subarray(0, HOP));
      o.copyWithin(0, HOP); o.fill(0, HOP);
    }
    this.last = start;
  }
  /** The start near `nominal` whose first half sounds most like the last frame's natural continuation from `cont`. */
  private fit(read: Read, nominal: number, cont: number): number {
    const dt = 1 / this.outRate, ds = 1 / this.srcRate, w = this.want, step = 8;
    for (let i = 0; i < w.length; i++) w[i] = read(0, cont + i * step * dt);
    const score = (d: number) => {
      let xy = 0, yy = 1e-9;
      const s = nominal + d * ds;
      for (let i = 0; i < w.length; i++) { const y = read(0, s + i * step * dt); xy += w[i]! * y; yy += y * y; }
      return xy / Math.sqrt(yy);
    };
    let best = 0, top = -Infinity;
    for (let d = -SEEK; d <= SEEK; d += 4) { const v = score(d); if (v > top) { top = v; best = d; } }
    const coarse = best;
    for (let d = coarse - 3; d <= coarse + 3; d++) { const v = score(d); if (v > top) { top = v; best = d; } }
    return nominal + best * ds;
  }
}
