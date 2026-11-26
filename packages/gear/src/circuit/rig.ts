// A guitar rig: circuits in a row (pedals, tube stages, tone stack), run 4×
// oversampled so the clipping's harmonics don't fold back down as fizz, then the
// push-pull power stage (power.ts) and a speaker cabinet's impulse response heard
// through a mic (cab.ts). Between the preamp and the power stage sits the effects
// loop: machines (machines.ts) at the output rate, as on a real amp's send and
// return. The chain is in slots (a pedalboard's): each slot runs as its own stage over
// a block, timed (`loads`), and from the first stereo slot on every stage runs once per side.
// `Rig` streams block by block (the amp page's audio thread runs it); `runRig` does a whole buffer at once.
import { Circuit, type Netlist } from "./mna.ts";
import { Convolver, cabIR, type Mic } from "./cab.ts";
import { butter8, chain, type Biquad } from "./filters.ts";
import { DEFAULT_POWER, PushPull, type Fault, type PowerSpec, type Trem } from "./power.ts";
import { machine, type LoopSpec, type Machine, type MachineCircuits } from "./machines.ts";

/**
 * What moves one of a circuit's `VarR` controls, once a sample: an LFO (`hz`), or the link's own output
 * swing times `sens` (an envelope: a compressor's LED, an auto-wah). It runs 0 to 1, is mapped onto
 * `from`..`to` (default 0..1), raised to `pow` (a lamp's light climbs faster than its current), then
 * through each `lag`, `[rise, fall]` in seconds: a lamp heating and cooling, an LDR that darkens fast and
 * recovers slowly. Those lags, not the LFO, are where an optical effect's sound comes from.
 */
export interface Mod { ctl: string; hz?: number; sens?: number; from?: number; to?: number; pow?: number; lag?: [number, number][] }

/** A link in the rig: a circuit, with an optional volume pot (0 to 1) ahead of it, and what moves its controls. */
export interface Link { net: Netlist; gain?: number; mods?: Mod[] }

/** A `Mod` running on one circuit at the rig's sample rate. Q Builder's bench steps one too, so its scope sees the LFO move. */
export class ModRun {
  phase = 0;
  private ys: Float64Array;
  private coef: [number, number][];
  readonly slot: number;
  constructor(readonly m: Mod, circuit: Circuit, sampleRate: number) {
    this.slot = circuit.controlSlot(m.ctl);
    const a = (sec: number) => (sec > 0 ? 1 - Math.exp(-1 / (sec * sampleRate)) : 1);
    this.coef = (m.lag ?? []).map(([up, down]) => [a(up), a(down)]);
    this.ys = new Float64Array(this.coef.length).fill(this.shape(0));
  }
  private shape(raw: number): number {
    const { from = 0, to = 1, pow = 1 } = this.m;
    const v = from + (to - from) * Math.min(1, Math.max(0, raw));
    return pow === 1 ? v : v ** pow;
  }
  /** The value at rest (before a sample has run). */
  get rest(): number { return this.ys.length ? this.ys[this.ys.length - 1] : this.shape(0); }
  /** One sample: `swing` is the link's last output swing in volts. */
  step(swing: number, sampleRate: number): number {
    const m = this.m;
    let raw = 0;
    if (m.hz) {
      raw = 0.5 - 0.5 * Math.cos(this.phase);
      this.phase += (2 * Math.PI * m.hz) / sampleRate;
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
    } else raw = swing * (m.sens ?? 1);
    let y = this.shape(raw);
    for (let k = 0; k < this.coef.length; k++) {
      const prev = this.ys[k];
      y = this.ys[k] = prev + (y > prev ? this.coef[k][0] : this.coef[k][1]) * (y - prev);
    }
    return y;
  }
}

/**
 * One slot on the board: the next `links` links (oversampled, any blends among them), or a machine at the
 * output rate. A `stereo` machine makes two sides out of one: it and everything after it runs once per side,
 * the right side's copy of it a half turn of its LFO behind (Q Bucket's chorus, wide).
 */
export type Slot = { links: number } | { machine: LoopSpec; stereo?: boolean };

export interface RigSpec {
  /** Volts at the input for a full-scale sample: a guitar pickup peaks around 0.1 to 1 V. */
  inputVolts: number;
  links: Link[];
  /** Power-stage drive, the Master (0 for no power amp: a pedal into a desk). */
  power: number;
  /** The output tubes, the supply and what is on the speaker jack (`DEFAULT_POWER` if left out). */
  output?: PowerSpec;
  /** The cabinet, heard through a mic here; null for none (a pedal into a desk). */
  cab: Mic | null;
  /** How loud the noisy resistors hiss (each `Circuit`'s `noise`); 0 or left out is silent. */
  noise?: number;
  /** The effects loop, in order: machines between the last link and the power stage. Left out when `slots` is set. */
  loop?: LoopSpec[];
  /** Links run side by side instead of one after another (a splitter's sides), each blended back in (`Blend`). */
  blends?: Blend[];
  /** The tubes and op-amp inside the loop's machines, if not the ones `machines.ts` writes. */
  machines?: MachineCircuits;
  /** The chain in slots, taking `links` in order; left out, every link is one slot and each `loop` machine one after it. */
  slots?: Slot[];
  /**
   * The slot the effects loop starts at (the one after the amp's): from it on the signal runs padded down to
   * line level (÷ `LOOP_VOLTS`), and comes back up before the power stage. Left out: no loop (1 without `slots`).
   */
  send?: number;
  /**
   * Part of a rig cut at a link (`splitRig`), to run on another thread: `"in"` takes the oversampled volts a part
   * before it hands over (`n × oversample` a block, resting at `inRest`) in place of the jack; `"out"` stops after its
   * links and hands their oversampled volts on (no power stage, loop or cab). `"both"` is a part in the middle.
   */
  tap?: "in" | "out" | "both";
  /** With `tap: "in"`: the volts the part ahead rests at when this one is built (its `outRest`). */
  inRest?: number;
}

/**
 * Links side by side: from link `at`, `lanes[k]` links in a row make side k, every side is fed the same
 * signal, and their swings are summed back, side k times `mix[k]`. A side of 0 links is the dry signal.
 * `{ at: 0, lanes: [1, 1], mix: [0.5, 0.5] }` is the first two links in parallel, half of each.
 * A blend stays inside one slot.
 */
export interface Blend { at: number; lanes: number[]; mix: number[] }

export interface RigRun {
  out: Float32Array;
  /** Samples (at the oversampled rate) where a circuit's Newton solve gave up. */
  misses: number;
  /** Average Newton iterations per circuit step. */
  iterationsPerStep: number;
}

/** About the most volts the power stage puts across the speaker: a pair's ceiling, give or take a quad's extra. */
export const POWER_VOLTS = 40;
/** The loop's send pads the preamp's swing (about 125 V at the most) down to line level by this, and the return brings it back. */
export const LOOP_VOLTS = 100;

/** Each `Pot` part's turn, in netlist order (what `setPot` numbers them by). */
const potTurns = (net: Netlist): number[] => net.parts.flatMap((p) => (p.kind === "Pot" ? [p.at ?? 0.5] : []));
/** What a slot of links is built from, pots, volume pots and blend mixes left out: those are turned, not rebuilt. */
const linksKey = (links: Link[], blends: Blend[]) =>
  JSON.stringify([links.map((l) => [{ ...l.net, parts: l.net.parts.map((p) => (p.kind === "Pot" ? { ...p, at: 0 } : p)) }, l.mods ?? []]), blends.map((b) => [b.at, b.lanes])]);
// An AudioWorklet has no `performance`; Date.now's whole milliseconds average out over a report.
const now: () => number = typeof performance === "undefined" ? () => Date.now() : () => performance.now();

/** A slot of links, oversampled with filters of its own. With `amp`, the power stage runs inside its oversampling too. */
class LinkStage {
  circuits: Circuit[];
  gains: number[];
  mods: ModRun[][];
  /** Each link's biggest swing over the last sample's oversampled steps: what an envelope `Mod` reads. */
  private swing: Float64Array;
  /** Each link's resting output voltage. */
  private rest: number[] = [];
  /** The link whose resting output each link's input rests at: -1 is the slot's input (resting at `inRest`), -2 a blend's sum (0 V). */
  private feed: Int32Array;
  /** Each circuit's work at the last `work` call. */
  private worked: Float64Array;
  /** The blend each link starts, or -1. */
  private blendAt: Int32Array;
  blends: Blend[];
  peaks: Float64Array;
  private up: Biquad[];
  private down: Biquad[];
  steps = 0;

  /**
   * `inRest`: the volts this slot's input rests at, 0 but for a part of a split rig, which takes the part ahead's
   * oversampled volts as they are (`run`'s `tapIn`).
   */
  constructor(readonly key: string, links: Link[], blends: Blend[], private sampleRate: number, private oversample: number, noise: number, public inRest = 0) {
    const hi = sampleRate * oversample, n = links.length;
    this.worked = new Float64Array(n);
    this.gains = links.map((l) => l.gain ?? 1);
    this.circuits = links.map((l) => new Circuit(l.net, hi));
    for (const c of this.circuits) c.noise = noise;
    this.mods = links.map((l, i) => this.startMods(i, l.mods));
    this.swing = new Float64Array(n);
    this.blends = blends.map((b) => ({ ...b }));
    this.blendAt = new Int32Array(n).fill(-1);
    this.feed = new Int32Array(n);
    // Who feeds whom: one after another, except inside a blend, where each side starts from what fed the blend.
    for (let i = 0, prev = -1; i < n; ) {
      const b = this.blends.findIndex((x) => x.at === i);
      if (b < 0) { this.feed[i] = prev; prev = i++; continue; }
      const bl = this.blends[b];
      if (bl.mix.length !== bl.lanes.length) throw new Error(`blend at link ${i}: ${bl.lanes.length} sides, ${bl.mix.length} mixes`);
      this.blendAt[i] = b;
      let j = i;
      for (const len of bl.lanes) for (let k = 0; k < len; k++, j++) this.feed[j] = k ? j - 1 : prev;
      if (j > n || j === i) throw new Error(`blend at link ${i} runs to link ${j} of ${n}`);
      prev = -2;
      i = j;
    }
    // Rest state, stage by stage: each one's input is what feeds it at rest.
    this.circuits.forEach((c, i) => this.rest.push(c.settle(this.restIn(i))));
    this.peaks = new Float64Array(n);
    this.up = butter8(0.45 * sampleRate, hi);
    this.down = butter8(0.45 * sampleRate, hi);
  }

  /** The same circuits at new turns: pots glide there, volume pots and blends are just set. */
  retune(links: Link[], blends: Blend[], noise: number): this {
    links.forEach((l, i) => { this.gains[i] = l.gain ?? 1; potTurns(l.net).forEach((at, p) => this.circuits[i].setPot(p, at)); });
    blends.forEach((b, i) => this.setMix(i, b.mix));
    this.setNoise(noise);
    return this;
  }
  setMix(b: number, mix: number[]): void { const bl = this.blends[b]; if (bl && mix.length === bl.lanes.length) this.blends[b] = { ...bl, mix }; }
  setNoise(n: number): void { for (const c of this.circuits) c.noise = n; }
  setLink(i: number, net: Netlist, mods: Mod[] | undefined, noise: number): void {
    const c = new Circuit(net, this.sampleRate * this.oversample);
    c.noise = noise;
    const old = this.mods[i];
    this.circuits[i] = c;
    this.mods[i] = this.startMods(i, mods);
    this.mods[i].forEach((m, k) => { if (old[k]) m.phase = old[k].phase; });
    this.rest[i] = c.settle(this.restIn(i));
  }

  /** The voltage link `i`'s input rests at. */
  private restIn(i: number): number { const f = this.feed[i]; return f === -1 ? this.inRest : f < 0 ? 0 : this.rest[f]; }

  /** The volts the slot's last link rests at (0 after a blend's sum, `inRest` with no links): what a part after it takes as its `inRest`. */
  get outRest(): number {
    const n = this.circuits.length;
    if (!n) return this.inRest;
    return this.blends.some((b) => b.at + b.lanes.reduce((a, l) => a + l, 0) === n) ? 0 : this.rest[n - 1];
  }

  /** Each link's work (multiply-adds) since the last call. */
  work(): number[] { return this.circuits.map((c, i) => { const w = c.work - this.worked[i]; this.worked[i] = c.work; return w; }); }

  /** One oversampled step of link `i`: `x` in, resting at `r`, through its volume pot. */
  private stepLink(i: number, x: number, r: number): number {
    // A volume pot after the coupling cap: it scales the swing, not the resting voltage.
    const y = this.circuits[i].step(r + (x - r) * this.gains[i]);
    const sw = Math.abs(y - this.rest[i]);
    if (sw > this.peaks[i]) this.peaks[i] = sw;
    if (sw > this.swing[i]) this.swing[i] = sw;
    return y;
  }

  /** Link `i`'s mods, each control set to its resting value. */
  private startMods(i: number, mods: Mod[] = []): ModRun[] {
    const c = this.circuits[i];
    return mods.map((m) => {
      const r = new ModRun(m, c, this.sampleRate);
      if (r.slot < 0) throw new Error(`no part listens to control "${m.ctl}"`);
      c.setCtl(r.slot, r.rest);
      return r;
    });
  }

  /**
   * `n` samples in place: volts in, the swing out (around 0). A split rig's parts hand over at the oversampled
   * rate instead: `tapIn` is read in place of `buf` (its volts as they are, resting at `inRest`), and `tapOut`
   * gets the last link's volts before the downsampling, `buf` left as it was.
   */
  run(buf: Float64Array, n: number, amp: PushPull | null, power: number, tapIn?: Float32Array | Float64Array, tapOut?: Float32Array | Float64Array): void {
    const { circuits, rest, up, down, oversample, mods, swing, sampleRate, blendAt, blends } = this;
    const count = circuits.length, powered = !!amp && power > 0;
    for (let s = 0; s < n; s++) {
      let acc = 0;
      for (let i = 0; i < mods.length; i++) {
        for (const m of mods[i]) circuits[i].setCtl(m.slot, m.step(swing[i], sampleRate));
        swing[i] = 0;
      }
      const v = buf[s] * oversample;
      for (let k = 0; k < oversample; k++) {
        // Zero-stuffed upsampling: the sample, then silence, smoothed by the low-pass (×oversample keeps the level).
        let x = tapIn ? tapIn[s * oversample + k] : chain(up, k === 0 ? v : 0);
        // `xr` is the voltage `x` rests at: the last link's resting output, or 0 after a blend's sum.
        let xr = this.inRest;
        for (let i = 0; i < count; ) {
          const b = blendAt[i];
          if (b < 0) { x = this.stepLink(i, x, xr); xr = rest[i++]; continue; }
          const { lanes, mix } = blends[b];
          let sum = 0;
          for (let l = 0; l < lanes.length; l++) {
            let y = x, yr = xr;
            for (const end = i + lanes[l]; i < end; i++) { y = this.stepLink(i, y, yr); yr = rest[i]; }
            sum += mix[l] * (y - yr);
          }
          x = sum; xr = 0;
        }
        if (tapOut) { tapOut[s * oversample + k] = x; continue; }
        x -= xr;
        if (powered && amp) x = amp.step(x, power);
        acc = chain(down, x);
      }
      if (!tapOut) buf[s] = acc;
    }
    this.steps += n * oversample * count;
  }
  get misses(): number { return this.circuits.reduce((s, c) => s + c.misses, 0); }
  get iterations(): number { return this.circuits.reduce((s, c) => s + c.iterations, 0); }
}

/** A machine as a slot, at the output rate. */
class MachineStage {
  readonly key: string;
  constructor(readonly m: Machine) { this.key = `machine:${m.kind}`; }
  run(buf: Float64Array, n: number): void { const m = this.m; for (let s = 0; s < n; s++) buf[s] = m.run(buf[s]); }
  get misses(): number { return this.m.misses; }
}

type Stage = LinkStage | MachineStage;

/** The power stage after a loop: the return back up to the oversampled rate, so it runs there as without one. */
class PowerStage {
  private up: Biquad[];
  private down: Biquad[];
  constructor(sampleRate: number, private oversample: number) {
    const hi = sampleRate * oversample;
    this.up = butter8(0.45 * sampleRate, hi);
    this.down = butter8(0.45 * sampleRate, hi);
  }
  run(buf: Float64Array, n: number, amp: PushPull, power: number): void {
    const { up, down, oversample } = this;
    for (let s = 0; s < n; s++) {
      let acc = buf[s];
      for (let k = 0; k < oversample; k++) {
        const z = chain(up, k === 0 ? acc * oversample : 0);
        acc = chain(down, amp.step(z, power));
      }
      buf[s] = acc;
    }
  }
}

/** One side's end of the rig: its power tubes, their filters, its cab. */
interface Side { amp: PushPull; power: PowerStage; cab: Convolver | null }

/**
 * A rig that streams: `process` a block at a time, and turn its knobs between
 * blocks. `setGain` is a volume pot (free), `setPot` turns a pot inside a circuit (free too), `setLink` swaps one circuit for
 * another with new part values (one matrix inversion and a rest solve), `setPower`
 * drives the power stage, `setTrem` turns its bias tremolo, `setLoad` plugs a speaker in or pulls it out, `setMic`
 * moves the mic on the cab. Build one with `prev` and every slot it still has carries over (a tape keeps its echoes,
 * a tube its state): a reordered board is a new rig without a gap in the sound.
 */
export class Rig {
  private left: Stage[] = [];
  /** Each slot's right-side copy, from the first stereo slot on. */
  private right: (Stage | null)[] = [];
  private split: number;
  private send: number;
  /** Links are numbered across the slots: each one's slot and its place in it. */
  private linkAt: [number, number][] = [];
  /** Blends likewise. */
  private blendAt: [number, number][] = [];
  private sides: Side[];
  /** Milliseconds each slot ran since the last `loads`, then the power stage and cab. */
  private ms: Float64Array;
  private bufL = new Float64Array(128);
  private bufR = new Float64Array(128);
  private inputVolts: number;
  private power: number;
  private noise: number;
  private legacy: boolean;
  private sampleRateHi: number;
  private outKey: string;
  private tapIn: boolean;
  private tapOut: boolean;
  private machines: MachineCircuits;
  /** Samples through the power stage and cab since the last `work`. */
  private backSamples = 0;

  constructor(spec: RigSpec, readonly sampleRate = 48000, readonly oversample = 4, prev?: Rig) {
    this.sampleRateHi = sampleRate * oversample;
    this.inputVolts = spec.inputVolts;
    this.power = spec.power;
    this.noise = spec.noise ?? 0;
    this.legacy = !spec.slots;
    this.machines = spec.machines ?? {};
    const slots: Slot[] = spec.slots ?? [{ links: spec.links.length }, ...(spec.loop ?? []).map((m) => ({ machine: m }))];
    this.send = spec.slots ? spec.send ?? slots.length : 1;
    const used = slots.reduce((n, s) => n + ("links" in s ? s.links : 0), 0);
    if (used !== spec.links.length) throw new Error(`the slots hold ${used} links, the rig has ${spec.links.length}`);
    const st = slots.findIndex((s) => "machine" in s && s.stereo);
    this.split = st < 0 ? slots.length : st;
    this.tapIn = spec.tap === "in" || spec.tap === "both";
    this.tapOut = spec.tap === "out" || spec.tap === "both";
    if (this.tapIn && !("links" in (slots[0] ?? {}))) throw new Error("a part that takes a hand-over starts with links");
    if (this.tapOut && !("links" in (slots[slots.length - 1] ?? {}))) throw new Error("a part that hands over ends with links");
    // What the last rig had, to carry over: each stage once, by what it was built from.
    const same = prev && prev.sampleRate === sampleRate && prev.oversample === oversample;
    const pool = same ? prev.left.map((s, i) => ({ s, r: prev.right[i] })) : [];
    const take = (key: string) => { const at = pool.findIndex((p) => p.s.key === key); return at < 0 ? null : pool.splice(at, 1)[0]; };
    let li = 0;
    slots.forEach((sl, i) => {
      const stereo = i >= this.split;
      if ("links" in sl) {
        const links = spec.links.slice(li, li + sl.links);
        const all = spec.blends ?? [];
        const blends = all.filter((b) => b.at >= li && b.at < li + sl.links).map((b) => ({ ...b, at: b.at - li }));
        all.forEach((b) => { if (b.at >= li && b.at < li + sl.links) this.blendAt.push([i, this.blendAt.filter(([k]) => k === i).length]); });
        for (let k = 0; k < sl.links; k++) this.linkAt.push([i, k]);
        li += sl.links;
        // A split part's hand-over ends are their own stages: built resting at what the part ahead rests at.
        const taps = i === 0 && this.tapIn, inRest = taps ? spec.inRest ?? 0 : 0;
        const key = `${linksKey(links, blends)}${taps ? `|in${inRest}` : ""}${i === slots.length - 1 && this.tapOut ? "|out" : ""}`;
        const make = () => new LinkStage(key, links, blends, sampleRate, oversample, this.noise, inRest);
        const old = take(key);
        const l = old?.s instanceof LinkStage ? old.s.retune(links, blends, this.noise) : make();
        const r = !stereo ? null : old?.r instanceof LinkStage ? old.r.retune(links, blends, this.noise) : make();
        this.left.push(l); this.right.push(r);
        return;
      }
      const sp = sl.machine;
      const make = (turn: boolean) => { const m = machine(sp, sampleRate, this.machines); if (turn) m.turn?.(Math.PI); return new MachineStage(m); };
      const old = take(`machine:${sp.kind}`);
      const reuse = (s: Stage | null | undefined) => (s instanceof MachineStage ? (s.m.set(sp), s) : null);
      this.left.push(reuse(old?.s) ?? make(false));
      this.right.push(stereo ? reuse(old?.r) ?? make(i === this.split) : null);
    });
    this.ms = new Float64Array(this.left.length + 1);
    const ir = spec.cab ? cabIR(spec.cab, sampleRate) : null;
    const out = spec.output ?? DEFAULT_POWER;
    // The same power tubes carry over too (their sag, the tremolo's phase), just replugged and retuned.
    this.outKey = JSON.stringify([out.pairs, out.sag]);
    const keep = same && prev.outKey === this.outKey ? prev.sides : [];
    const side = (k: number): Side => {
      const old = keep[k];
      if (!old) return { amp: new PushPull(out, this.sampleRateHi), power: new PowerStage(sampleRate, oversample), cab: ir ? new Convolver(ir) : null };
      old.amp.setLoad(out.load);
      old.amp.setTrem(out.trem);
      if (!ir) old.cab = null; else if (old.cab) old.cab.set(ir); else old.cab = new Convolver(ir);
      return old;
    };
    this.sides = this.split < slots.length ? [side(0), side(1)] : [side(0)];
  }

  private each(i: number, f: (s: LinkStage, k: number) => void): void {
    const at = this.linkAt[i];
    if (!at) return;
    for (const s of [this.left[at[0]], this.right[at[0]]]) if (s instanceof LinkStage) f(s, at[1]);
  }
  /** The volume pot ahead of link `i`, 0 to 1. */
  setGain(i: number, g: number): void { this.each(i, (s, k) => { s.gains[k] = g; }); }
  /** Pot `pot` (in netlist order) of link `i`, 0 to 1: it glides there over about 10 ms. */
  setPot(i: number, pot: number, at: number): void { this.each(i, (s, k) => s.circuits[k]?.setPot(pot, at)); }
  setPower(p: number): void { this.power = p; }
  /** How much of each side blend `b` sums back (a split's Blend knob). */
  setMix(b: number, mix: number[]): void {
    const at = this.blendAt[b];
    if (at) for (const s of [this.left[at[0]], this.right[at[0]]]) if (s instanceof LinkStage) s.setMix(at[1], mix);
  }
  /** The bias tremolo on the power tubes (rate in Hz, depth 0 to 1), or none. The LFO keeps its phase. */
  setTrem(t?: Trem): void { for (const s of this.sides) s.amp.setTrem(t); }
  /** Ohms on the speaker jack, 0 for nothing plugged in. Play through an open jack and the amp blows (`fault`). */
  setLoad(ohms: number): void { for (const s of this.sides) s.amp.setLoad(ohms); }
  /** The mic moves on the cab (and a rig built without a cab gets one). */
  setMic(mic: Mic): void { this.setCab(cabIR(mic, this.sampleRate)); }
  /** A cab's impulse response at the rig's sample rate, measured or made: in place of the mic's. */
  setCab(ir: Float64Array): void { for (const s of this.sides) { if (s.cab) s.cab.set(ir); else s.cab = new Convolver(ir); } }
  setNoise(n: number): void { this.noise = n; for (const s of [...this.left, ...this.right]) if (s instanceof LinkStage) s.setNoise(n); }

  /**
   * On a rig built without `slots`: the loop becomes `specs`. A machine already in it keeps its state (its tape,
   * its springs) and just turns its knobs.
   */
  setLoop(specs: LoopSpec[]): void {
    if (!this.legacy) throw new Error("a rig built in slots changes its loop with a new rig (`prev`)");
    const old = this.left.slice(1).flatMap((s) => (s instanceof MachineStage ? [s] : []));
    this.left = [this.left[0], ...specs.map((sp) => {
      const at = old.findIndex((s) => s.m.kind === sp.kind);
      if (at < 0) return new MachineStage(machine(sp, this.sampleRate, this.machines));
      const [s] = old.splice(at, 1);
      s.m.set(sp);
      return s;
    })];
    this.right = this.left.map(() => null);
    this.split = this.left.length;
    this.ms = new Float64Array(this.left.length + 1);
  }

  /** Link `i` becomes `net` (same input and output roles), starting from its rest state. An LFO keeps its phase. */
  setLink(i: number, net: Netlist, mods?: Mod[]): void { this.each(i, (s, k) => s.setLink(k, net, mods, this.noise)); }

  /** The machine in slot `i` turns its knobs (both sides of it): it keeps its state. Another kind of machine is a new rig. */
  setMachine(i: number, spec: LoopSpec): void {
    for (const s of [this.left[i], this.right[i]]) if (s instanceof MachineStage && s.m.kind === spec.kind) s.m.set(spec);
  }

  /**
   * `n` samples from `input` (full scale ±1) to `output` (volts at the speaker). With `outputR`, the right
   * side goes there: a copy of the left until a stereo slot. A part of a split rig (`tap`) takes and hands on
   * `n × oversample` oversampled volts instead.
   */
  process(input: Float32Array | Float64Array, output: Float32Array | Float64Array, n = this.tapIn ? input.length / this.oversample : input.length, outputR?: Float32Array | Float64Array): void {
    if (this.bufL.length < n) { this.bufL = new Float64Array(n); this.bufR = new Float64Array(n); }
    const { left, right, ms, sides, split, send, power, tapIn, tapOut } = this, L = this.bufL, R = this.bufR, count = left.length;
    if (!tapIn) for (let s = 0; s < n; s++) L[s] = input[s] * this.inputVolts;
    const looped = send < count;
    // Links last and no loop after them: the power stage runs inside their oversampling, no second pair of filters.
    const fold = !looped && !tapOut && left[count - 1] instanceof LinkStage;
    let t = now();
    for (let i = 0; i < count; i++) {
      if (i === split) R.set(L.subarray(0, n));
      if (i === send) for (const b of i >= split ? [L, R] : [L]) for (let s = 0; s < n; s++) b[s] /= LOOP_VOLTS;
      const f = fold && i === count - 1;
      const tin = tapIn && i === 0 ? input : undefined, tout = tapOut && i === count - 1 ? output : undefined;
      const l = left[i], r = right[i];
      if (l instanceof LinkStage) l.run(L, n, f ? sides[0].amp : null, power, tin, tout); else l.run(L, n);
      if (r instanceof LinkStage) r.run(R, n, f ? sides[1].amp : null, power); else r?.run(R, n);
      const t2 = now();
      ms[i] += t2 - t;
      t = t2;
    }
    if (tapOut) return;
    this.backSamples += n;
    sides.forEach((side, k) => {
      const b = k ? R : L;
      if (looped) for (let s = 0; s < n; s++) b[s] *= LOOP_VOLTS;
      if (!fold && power > 0) side.power.run(b, n, side.amp, power);
      const cab = side.cab;
      if (cab) for (let s = 0; s < n; s++) b[s] = cab.run(b[s]);
    });
    for (let s = 0; s < n; s++) output[s] = L[s];
    if (outputR) { const b = sides.length > 1 ? R : L; for (let s = 0; s < n; s++) outputR[s] = b[s]; }
    ms[count] += now() - t;
  }

  /** Each link's biggest swing (volts) since the last call, then cleared: what lights its tube. */
  levels(): number[] {
    const out: number[] = [];
    this.left.forEach((s, i) => {
      if (!(s instanceof LinkStage)) return;
      const r = this.right[i];
      s.peaks.forEach((p, k) => out.push(r instanceof LinkStage ? Math.max(p, r.peaks[k]) : p));
      s.peaks.fill(0);
      if (r instanceof LinkStage) r.peaks.fill(0);
    });
    return out;
  }
  /** Milliseconds each slot took since the last call (both its sides), then one more for the power stage and cab; then cleared. */
  loads(): number[] {
    const out = Array.from(this.ms);
    this.ms.fill(0);
    return out;
  }
  /** Two sides from a stereo slot on. */
  get stereo(): boolean { return this.sides.length > 1; }

  /**
   * The work each link did since the last call, then cleared, in multiply-adds (a step's matrix work plus each
   * Newton iteration's, both sides of a stereo slot), and the power stage's, machines' and cab's after it as one
   * more: what `splitRig` cuts by.
   */
  work(): number[] {
    const out: number[] = [];
    this.left.forEach((s, i) => {
      if (!(s instanceof LinkStage)) return;
      const r = this.right[i], w = s.work(), wr = r instanceof LinkStage ? r.work() : [];
      w.forEach((x, k) => out.push(x + (wr[k] ?? 0)));
    });
    const s = this.backSamples, count = this.left.length, machines = this.left.filter((x) => x instanceof MachineStage).length;
    this.backSamples = 0;
    // A butterworth pair is 4 biquads each way, the push-pull about as much again, then the cab's taps.
    const fold = this.send >= count && this.left[count - 1] instanceof LinkStage;
    const os = this.oversample * (!fold && this.power > 0 ? 2 : 1);
    out.push(this.sides.length * s * (os * (this.power > 0 ? 80 : 40) + (this.sides[0].cab?.taps ?? 0) + 400 * machines));
    return out;
  }

  /** The volts the input rests at: 0 at the jack, or what the part ahead of this one rests at (`outRest`). */
  get inRest(): number { const s = this.left[0]; return this.tapIn && s instanceof LinkStage ? s.inRest : 0; }
  set inRest(v: number) { const s = this.left[0]; if (this.tapIn && s instanceof LinkStage) s.inRest = v; }
  /** The volts the rig's last link rests at, what a part after it (`tap: "in"`) takes as its `inRest`. */
  get outRest(): number { const s = this.left[this.left.length - 1]; return s instanceof LinkStage ? s.outRest : 0; }

  /** What broke, if something did: `"open-load"` is played through with nothing on the speaker jack. */
  get fault(): Fault | null { return this.sides[0].amp.fault; }
  /** The power supply now, volts: it sags under a loud chord. */
  get supply(): number { return this.sides[0].amp.supply; }
  /** The power tubes' grid bias now, volts: it swings colder with the bias tremolo. */
  get bias(): number { return this.sides[0].amp.bias; }
  private get stages(): Stage[] { return [...this.left, ...this.right.flatMap((s) => (s ? [s] : []))]; }
  get misses(): number { return this.stages.reduce((s, x) => s + x.misses, 0); }
  get iterationsPerStep(): number {
    const links = this.stages.flatMap((s) => (s instanceof LinkStage ? [s] : []));
    return links.reduce((s, x) => s + x.iterations, 0) / Math.max(1, links.reduce((s, x) => s + x.steps, 0));
  }
}

/** The slot each link sits in. */
const slotOfLink = (slots: readonly Slot[]): number[] => slots.flatMap((s, i) => ("links" in s ? Array.from({ length: s.links }, () => i) : []));

/**
 * Where a rig can be cut: before any link that isn't inside a blend's sides, and after the last one (`splitRig`).
 * On a rig in slots, only where what comes before the cut is mono and ahead of the loop: the part handing over
 * ends with links, at the oversampled rate.
 */
export function cutPoints(spec: Pick<RigSpec, "links" | "blends" | "slots" | "send">): number[] {
  const inside = (c: number) => (spec.blends ?? []).some((b) => c > b.at && c < b.at + b.lanes.reduce((a, l) => a + l, 0));
  const slots = spec.slots, of = slots ? slotOfLink(slots) : [];
  const st = slots ? slots.findIndex((s) => "machine" in s && s.stereo) : -1;
  const before = slots ? Math.min(spec.send ?? slots.length, st < 0 ? slots.length : st) : Infinity;
  return Array.from({ length: spec.links.length }, (_, i) => i + 1).filter((c) => !inside(c) && (!slots || of[c - 1] < before));
}

/**
 * A rig cut into parts that run one after another on their own threads: part k has links `cuts[k-1]` up to
 * `cuts[k]`, hands its oversampled volts to part k+1 (`tap`), and only the last has the power stage, loop and cab.
 * Played block by block with each hand-over a block late, the last part's output is the whole rig's, that late
 * (to the bit when the cut is inside a slot; between two slots the hand-over skips their resampling filters).
 * On a rig in slots, a machine goes with the part its place falls in, the ones after the last link with the last.
 */
export function splitRig(spec: RigSpec, cuts: readonly number[]): RigSpec[] {
  const ok = cutPoints(spec);
  for (const c of cuts) if (!ok.includes(c)) throw new Error(`no cut at link ${c}: inside a blend or past the end`);
  if (cuts.some((c, i) => i && c <= cuts[i - 1])) throw new Error("cuts out of order");
  const edges = [0, ...cuts, spec.links.length];
  return edges.slice(1).map((end, k): RigSpec => {
    const from = edges[k], first = k === 0, last = k === edges.length - 2;
    const blends = (spec.blends ?? []).filter((b) => b.at >= from && b.at < end).map((b) => ({ ...b, at: b.at - from }));
    const tap = first ? (last ? undefined : "out") : last ? "in" : "both";
    const part: RigSpec = { ...spec, links: spec.links.slice(from, end), blends, tap, ...(last ? {} : { cab: null, loop: [] }) };
    if (!spec.slots) return part;
    // The slots holding this part's links (a slot cut in two goes to both), and the machines whose place falls in it.
    const slots: Slot[] = [], was: number[] = [];
    let li = 0;
    spec.slots.forEach((sl, i) => {
      const at = li, here = (at >= from && at < end) || (last && at === end);
      if ("links" in sl) {
        li += sl.links;
        const a = Math.max(at, from), b = Math.min(li, end);
        if (b > a || (!sl.links && here)) { slots.push({ links: Math.max(0, b - a) }); was.push(i); }
      } else if (here) { slots.push(sl); was.push(i); }
    });
    // A part taking a hand-over starts with links, if none: a slot of no links takes it and downsamples it.
    if (!first && !("links" in (slots[0] ?? {}))) { slots.unshift({ links: 0 }); was.unshift(-1); }
    const send = spec.send === undefined ? -1 : was.findIndex((i) => i >= (spec.send ?? 0));
    return { ...part, slots, send: send < 0 ? undefined : send };
  });
}

/**
 * Cuts that share `work` (each link's, then the back end's: `Rig.work`) out across `parts` threads with the
 * busiest one as light as it can be, only at `cutPoints`. Fewer parts than asked when there aren't enough cuts.
 */
export function planCuts(work: readonly number[], parts: number, points: readonly number[]): number[] {
  // work[i] for link i; the back end rides with the last part.
  const n = work.length - 1;
  const sum = (a: number, b: number) => { let s = 0; for (let i = a; i < b; i++) s += work[i]; return s + (b === n ? work[n] : 0); };
  let best: number[] = [], bestMax = sum(0, n);
  const walk = (from: number, left: number, cuts: number[], max: number) => {
    if (max >= bestMax) return;
    if (left === 0) { const m = Math.max(max, sum(from, n)); if (m < bestMax) { bestMax = m; best = cuts; } return; }
    for (const c of points) if (c > from) walk(c, left - 1, [...cuts, c], Math.max(max, sum(from, c)));
  };
  for (let k = Math.min(parts, points.length + 1) - 1; k >= 1; k--) { walk(0, k, [], 0); if (best.length) break; }
  return best;
}

/** Runs a mono buffer through a rig. Each call starts from the rig's resting state. */
export function runRig(spec: RigSpec, input: Float32Array, sampleRate = 48000, oversample = 4): RigRun {
  const rig = new Rig(spec, sampleRate, oversample);
  const out = new Float32Array(input.length);
  rig.process(input, out);
  return { out, misses: rig.misses, iterationsPerStep: rig.iterationsPerStep };
}
