// A rig split across threads (#4948): the audio thread plays the first part of the chain, each worker the next,
// and they hand blocks on through rings in a SharedArrayBuffer. Each hand-over is one block late (128 samples,
// 2.7 ms at 48 kHz), so with every part inside its budget the sound is the one-thread rig's, a block later per
// hop. No DOM and no Bun here: the worklet (worklet.ts), the workers (part-worker.ts) and the tests run it.
import { FULL_SCALE, Scoped, applySettings, type Live } from "./live.ts";
import type { ToAmp } from "./messages.ts";

/** Samples in a block: the audio thread's render quantum, the only size a split plays. */
export const BLOCK = 128;
/** Blocks a ring holds: a part more than this many behind skips ahead to the newest. */
export const SLOTS = 8;
/** A frame's header: its number, the settings version it was played with, and the volts its part rests at. */
const HEAD = 3;
/** Widest frame: a block at 4× oversampling. */
const WIDTH = BLOCK * 4;

/** One hand-over between threads: frames written by one part and read by the next. */
export class Ring {
  readonly ctrl: Int32Array;
  readonly data: Float64Array;
  constructor(readonly sab: SharedArrayBuffer) {
    this.ctrl = new Int32Array(sab, 0, 1);
    this.data = new Float64Array(sab, 8);
  }
  static make(): Ring { return new Ring(new SharedArrayBuffer(8 + 8 * SLOTS * (HEAD + WIDTH))); }
  /** Frames written so far. */
  get written(): number { return Atomics.load(this.ctrl, 0); }
  private at(frame: number): number { return (frame % SLOTS) * (HEAD + WIDTH); }

  write(frame: number, version: number, rest: number, src: Float64Array, n: number): void {
    const o = this.at(frame), d = this.data;
    d[o] = frame; d[o + 1] = version; d[o + 2] = rest;
    d.set(src.subarray(0, n), o + HEAD);
    Atomics.store(this.ctrl, 0, frame + 1);
    Atomics.notify(this.ctrl, 0);
  }

  /** Frame `frame` into `dst` (`n` samples) with its version and rest, or null if it isn't there (not yet, or gone). */
  read(frame: number, dst: Float64Array, n: number): { version: number; rest: number } | null {
    const o = this.at(frame), d = this.data;
    if (this.written <= frame || d[o] !== frame) return null;
    const version = d[o + 1], rest = d[o + 2];
    dst.set(d.subarray(o + HEAD, o + HEAD + n));
    // Overwritten while it was copied (the reader is a whole ring behind): gone.
    return this.written - frame < SLOTS && d[o] === frame ? { version, rest } : null;
  }

  /** Waits (a worker, or a test) until frame `frame` is written or `ms` runs out. */
  wait(frame: number, ms: number): void {
    const end = Date.now() + ms;
    for (let w = this.written; w <= frame && Date.now() < end; w = this.written) Atomics.wait(this.ctrl, 0, w, end - Date.now());
  }
}

/** How a thread's work and load are reported: each `REPORT_EVERY` seconds. */
export const REPORT_EVERY = 1 / 30;

/**
 * The audio thread's side: the whole rig, or with rings and cuts, its first part. `block` plays one block and
 * gives back the rig's volts, the last part's from `hops` blocks ago when split (silence while it hasn't come).
 */
export class Head {
  live: Live | null = null;
  bypass = false;
  version = 0;
  cuts: number[] = [];
  /** The scope, if it is on a link this thread plays. */
  readonly scope = new Scoped();
  /** Blocks the last part's frame didn't come back in time (each played as silence). */
  late = 0;
  private pending: Extract<ToAmp, { t: "set" }> | null = null;
  private last: Extract<ToAmp, { t: "set" }> | null = null;
  /** Whether the rig playing was built as the first part of a split. */
  private builtSplit = false;
  private rings: Ring[] = [];
  private frame = 0;
  private tap = new Float64Array(WIDTH);
  /** The last part's frame: the left side's block, then the right's (a copy until a stereo slot). */
  private back = new Float64Array(2 * BLOCK);
  private out = new Float32Array(BLOCK);

  constructor(readonly sampleRate: number) {}

  /** Settings to apply at the start of the next block (only the newest of several). */
  set(m: Extract<ToAmp, { t: "set" }>): void { this.pending = m; }
  /** The rings the parts hand over on, one per part (the last comes back here), or null for one thread. */
  connect(rings: SharedArrayBuffer[] | null): void { this.rings = rings ? rings.map((r) => new Ring(r)) : []; this.frame = 0; }
  /** Blocks of delay the split adds. */
  get hops(): number { return this.split ? this.cuts.length : 0; }
  get scale(): number { return this.live?.scale ?? FULL_SCALE; }
  private get split(): boolean { return this.cuts.length > 0 && this.rings.length === this.cuts.length + 1; }

  /**
   * `n` samples of `input` through the rig, its volts into `output`. False when there's no rig to play (bypassed):
   * the caller plays the input dry. `wait` (ms, tests only) blocks for the last part's frame instead of dropping it.
   */
  block(input: Float32Array, output: Float32Array, n: number, wait = 0, outputR?: Float32Array): boolean {
    // New settings, or the rings came or went since the rig was built: build it (or its first part) again.
    const p = this.pending ?? (this.split !== this.builtSplit ? this.last : null);
    if (p) {
      this.pending = null;
      this.last = p;
      this.bypass = p.settings.bypass;
      this.version = p.v ?? 0;
      this.cuts = p.cuts ?? [];
      this.builtSplit = this.split;
      this.live = applySettings(p.settings, this.live, this.sampleRate, this.split ? { cuts: this.cuts, index: 0 } : undefined);
    }
    const rig = this.bypass ? null : this.live?.rig;
    if (!rig) return false;
    this.scope.keep(rig, this.split ? this.cuts : [], 0);
    if (!this.split) { rig.process(input, output, n, outputR); return true; }
    const silence = () => { output.fill(0, 0, n); outputR?.fill(0, 0, n); };
    if (n !== BLOCK) { silence(); this.late++; return true; }
    const f = this.frame++, os = rig.oversample;
    rig.process(input, this.tap, n);
    this.rings[0].write(f, this.version, rig.outRest, this.tap, n * os);
    const want = f - this.hops, last = this.rings[this.rings.length - 1];
    if (want < 0) { silence(); return true; }
    if (wait) last.wait(want, wait);
    if (!last.read(want, this.back, 2 * n)) { silence(); this.late++; return true; }
    // Through a Float32Array, as the one-thread rig writes it.
    this.out.set(this.back.subarray(0, n));
    output.set(this.out.subarray(0, n));
    if (outputR) { this.out.set(this.back.subarray(n, 2 * n)); outputR.set(this.out.subarray(0, n)); }
    return true;
  }
}

/** A worker's side: part `index` of the split rig, fed by ring `index - 1`, handing on to ring `index`. */
export class PartRunner {
  live: Live | null = null;
  private versions = new Map<number, Extract<ToAmp, { t: "set" }>>();
  private waiting: (() => void) | null = null;
  private version = -1;
  private next = 0;
  private tap = new Float64Array(WIDTH);
  private out = new Float64Array(WIDTH);
  private cuts: number[] = [];
  /** The scope, if it is on a link this part plays. */
  readonly scope = new Scoped();
  stopped = false;
  /** This thread's busy milliseconds and blocks since the last report. */
  busyMs = 0;
  blocks = 0;

  constructor(readonly index: number, private readonly rings: Ring[], readonly sampleRate: number, private readonly now: () => number) {}

  /** Settings, each kept by version until a frame played with it arrives. */
  set(m: Extract<ToAmp, { t: "set" }>): void {
    this.versions.set(m.v ?? 0, m);
    this.waiting?.();
  }

  private settings(v: number): Promise<Extract<ToAmp, { t: "set" }>> | Extract<ToAmp, { t: "set" }> {
    const m = this.versions.get(v);
    if (m) return m;
    return new Promise((done) => { this.waiting = () => { const x = this.versions.get(v); if (x) { this.waiting = null; done(x); } }; });
  }

  /** Plays frames as they come, until `stop`. */
  async run(): Promise<void> {
    const src = this.rings[this.index - 1], dst = this.rings[this.index];
    let busy = 0;
    while (!this.stopped) {
      const w = src.written;
      if (w <= this.next) { busy = 0; await Atomics.waitAsync(src.ctrl, 0, w, 250).value; continue; }
      // Behind and never waiting: let the thread's messages (settings, stop) and reports in now and then.
      if (++busy > 16) { busy = 0; await new Promise((r) => setTimeout(r, 0)); }
      if (w - this.next >= SLOTS) this.next = w - 1; // a ring behind: skip to the newest
      const f = this.next;
      const t0 = this.now();
      const got = src.read(f, this.tap, WIDTH);
      if (!got) { this.next = Math.max(f + 1, src.written - 1); continue; }
      if (got.version !== this.version) {
        const m = await this.settings(got.version);
        for (const v of this.versions.keys()) if (v < got.version) this.versions.delete(v);
        this.live = applySettings(m.settings, this.live, this.sampleRate, { cuts: m.cuts ?? [], index: this.index, inRest: got.rest });
        this.cuts = m.cuts ?? [];
        this.version = got.version;
      }
      const rig = this.live?.rig;
      if (!rig) { this.next = f + 1; continue; }
      this.scope.keep(rig, this.cuts, this.index);
      rig.inRest = got.rest;
      const last = this.index === this.rings.length - 1;
      // The last part hands back both sides, left then right; the others their oversampled volts.
      if (last) rig.process(this.tap, this.out.subarray(0, BLOCK), BLOCK, this.out.subarray(BLOCK, 2 * BLOCK));
      else rig.process(this.tap, this.out, BLOCK);
      dst.write(f, got.version, rig.outRest, this.out, last ? 2 * BLOCK : BLOCK * rig.oversample);
      this.next = f + 1;
      this.busyMs += this.now() - t0;
      this.blocks++;
    }
  }

  /** Share of the thread's time budget used since the last call, 0 to 1 (more when it can't keep up). */
  load(): number {
    const l = this.blocks ? this.busyMs / ((this.blocks * BLOCK * 1000) / this.sampleRate) : 0;
    this.busyMs = 0; this.blocks = 0;
    return l;
  }
}
