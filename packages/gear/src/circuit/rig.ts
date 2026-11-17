// A guitar rig: circuits in a row (pedals, tube stages, tone stack), run 4×
// oversampled so the clipping's harmonics don't fold back down as fizz, then the
// push-pull power stage (power.ts) and a speaker cabinet's impulse response heard
// through a mic (cab.ts). Between the preamp and the power stage sits the effects
// loop: machines (machines.ts) at the output rate, as on a real amp's send and
// return. `Rig` streams block by block (the amp
// page's audio thread runs it); `runRig` does a whole buffer at once.
import { Circuit, type Netlist } from "./mna.ts";
import { Convolver, cabIR, type Mic } from "./cab.ts";
import { butter8, chain, type Biquad } from "./filters.ts";
import { DEFAULT_POWER, PushPull, type Fault, type PowerSpec, type Trem } from "./power.ts";
import { machine, type LoopSpec, type Machine } from "./machines.ts";

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

/** A `Mod` running on one circuit at the rig's sample rate. */
class ModRun {
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
  /** The effects loop, in order: machines between the last link and the power stage. */
  loop?: LoopSpec[];
  /** Links run side by side instead of one after another (a splitter's sides), each blended back in (`Blend`). */
  blends?: Blend[];
}

/**
 * Links side by side: from link `at`, `lanes[k]` links in a row make side k, every side is fed the same
 * signal, and their swings are summed back, side k times `mix[k]`. A side of 0 links is the dry signal.
 * `{ at: 0, lanes: [1, 1], mix: [0.5, 0.5] }` is the first two links in parallel, half of each.
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

/**
 * A rig that streams: `process` a block at a time, and turn its knobs between
 * blocks. `setGain` is a volume pot (free), `setPot` turns a pot inside a circuit (free too), `setLink` swaps one circuit for
 * another with new part values (one matrix inversion and a rest solve), `setPower`
 * drives the power stage, `setTrem` turns its bias tremolo, `setLoad` plugs a speaker in or pulls it out, `setMic`
 * moves the mic on the cab.
 */
export class Rig {
  private circuits: Circuit[];
  private gains: number[];
  private mods: ModRun[][];
  /** Each link's biggest swing over the last sample's oversampled steps: what an envelope `Mod` reads. */
  private swing: Float64Array;
  /** Each link's resting output voltage. */
  private rest: number[] = [];
  /** The link whose resting output each link's input rests at, or -1 for 0 V (the jack, or a blend's sum). */
  private feed: Int32Array;
  /** The blend each link starts, or -1. */
  private blendAt: Int32Array;
  private blends: Blend[];
  private peaks: Float64Array;
  private up: Biquad[];
  private down: Biquad[];
  private amp: PushPull;
  private cab: Convolver | null;
  private inputVolts: number;
  private power: number;
  private noise: number;
  private steps = 0;
  private loop: Machine[] = [];
  // The return back up to the oversampled rate, so the power stage runs there as without a loop.
  private up2: Biquad[];
  private down2: Biquad[];

  constructor(spec: RigSpec, readonly sampleRate = 48000, readonly oversample = 4) {
    const hi = sampleRate * oversample;
    this.inputVolts = spec.inputVolts;
    this.power = spec.power;
    this.gains = spec.links.map((l) => l.gain ?? 1);
    this.circuits = spec.links.map((l) => new Circuit(l.net, hi));
    this.noise = spec.noise ?? 0;
    for (const c of this.circuits) c.noise = this.noise;
    this.mods = spec.links.map((l, i) => this.startMods(i, l.mods));
    this.swing = new Float64Array(this.circuits.length);
    const n = this.circuits.length;
    this.blends = (spec.blends ?? []).map((b) => ({ ...b }));
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
      prev = -1;
      i = j;
    }
    // Rest state, stage by stage: each one's input is what feeds it at rest.
    this.circuits.forEach((c, i) => this.rest.push(c.settle(this.restIn(i))));
    this.peaks = new Float64Array(this.circuits.length);
    this.up = butter8(0.45 * sampleRate, hi);
    this.down = butter8(0.45 * sampleRate, hi);
    this.up2 = butter8(0.45 * sampleRate, hi);
    this.down2 = butter8(0.45 * sampleRate, hi);
    this.setLoop(spec.loop ?? []);
    this.amp = new PushPull(spec.output ?? DEFAULT_POWER, hi);
    this.cab = spec.cab ? new Convolver(cabIR(spec.cab, sampleRate)) : null;
  }

  /** The volume pot ahead of link `i`, 0 to 1. */
  setGain(i: number, g: number): void { this.gains[i] = g; }
  /** Pot `pot` (in netlist order) of link `i`, 0 to 1: it glides there over about 10 ms. */
  setPot(i: number, pot: number, at: number): void { this.circuits[i]?.setPot(pot, at); }
  setPower(p: number): void { this.power = p; }
  /** How much of each side blend `b` sums back (a split's Blend knob). */
  setMix(b: number, mix: number[]): void { const bl = this.blends[b]; if (bl && mix.length === bl.lanes.length) this.blends[b] = { ...bl, mix }; }
  /** The bias tremolo on the power tubes (rate in Hz, depth 0 to 1), or none. The LFO keeps its phase. */
  setTrem(t?: Trem): void { this.amp.setTrem(t); }
  /** Ohms on the speaker jack, 0 for nothing plugged in. Play through an open jack and the amp blows (`fault`). */
  setLoad(ohms: number): void { this.amp.setLoad(ohms); }
  /** The mic moves on the cab (and a rig built without a cab gets one). */
  setMic(mic: Mic): void { this.setCab(cabIR(mic, this.sampleRate)); }
  /** A cab's impulse response at the rig's sample rate, measured or made: in place of the mic's. */
  setCab(ir: Float64Array): void { if (this.cab) this.cab.set(ir); else this.cab = new Convolver(ir); }
  setNoise(n: number): void { this.noise = n; for (const c of this.circuits) c.noise = n; }

  /** The loop becomes `specs`: a machine already in it keeps its state (its tape, its springs) and just turns its knobs. */
  setLoop(specs: LoopSpec[]): void {
    const old = [...this.loop];
    this.loop = specs.map((sp) => {
      const at = old.findIndex((m) => m.kind === sp.kind);
      if (at < 0) return machine(sp, this.sampleRate);
      const [m] = old.splice(at, 1);
      m.set(sp);
      return m;
    });
  }

  /** Link `i` becomes `net` (same input and output roles), starting from its rest state. An LFO keeps its phase. */
  setLink(i: number, net: Netlist, mods?: Mod[]): void {
    const c = new Circuit(net, this.sampleRate * this.oversample);
    c.noise = this.noise;
    const old = this.mods[i];
    this.circuits[i] = c;
    this.mods[i] = this.startMods(i, mods);
    this.mods[i].forEach((m, k) => { if (old[k]) m.phase = old[k].phase; });
    this.rest[i] = c.settle(this.restIn(i));
  }

  /** The voltage link `i`'s input rests at. */
  private restIn(i: number): number { const f = this.feed[i]; return f < 0 ? 0 : this.rest[f]; }

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

  /** Mono `n` samples from `input` (full scale ±1) to `output` (volts at the speaker). */
  process(input: Float32Array, output: Float32Array, n = input.length): void {
    const { circuits, rest, up, down, up2, down2, amp, cab, oversample, mods, swing, sampleRate, loop, blendAt, blends } = this;
    const looped = loop.length > 0;
    const count = circuits.length;
    for (let s = 0; s < n; s++) {
      let acc = 0;
      for (let i = 0; i < mods.length; i++) {
        for (const m of mods[i]) circuits[i].setCtl(m.slot, m.step(swing[i], sampleRate));
        swing[i] = 0;
      }
      for (let k = 0; k < oversample; k++) {
        // Zero-stuffed upsampling: the sample, then silence, smoothed by the low-pass (×oversample keeps the level).
        let x = chain(up, k === 0 ? input[s] * this.inputVolts * oversample : 0);
        // `xr` is the voltage `x` rests at: the last link's resting output, or 0 after a blend's sum.
        let xr = 0;
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
        x -= xr;
        if (this.power > 0 && !looped) x = amp.step(x, this.power);
        acc = chain(down, x);
      }
      if (looped) {
        let y = acc / LOOP_VOLTS;
        for (const m of loop) y = m.run(y);
        acc = y * LOOP_VOLTS;
        if (this.power > 0) {
          for (let k = 0; k < oversample; k++) {
            const z = chain(up2, k === 0 ? acc * oversample : 0);
            acc = chain(down2, amp.step(z, this.power));
          }
        }
      }
      output[s] = cab ? cab.run(acc) : acc;
    }
    this.steps += n * oversample * circuits.length;
  }

  /** Each link's biggest swing (volts) since the last call, then cleared: what lights its tube. */
  levels(): number[] {
    const out = Array.from(this.peaks);
    this.peaks.fill(0);
    return out;
  }

  /** What broke, if something did: `"open-load"` is played through with nothing on the speaker jack. */
  get fault(): Fault | null { return this.amp.fault; }
  /** The power supply now, volts: it sags under a loud chord. */
  get supply(): number { return this.amp.supply; }
  /** The power tubes' grid bias now, volts: it swings colder with the bias tremolo. */
  get bias(): number { return this.amp.bias; }
  get misses(): number { return this.circuits.reduce((s, c) => s + c.misses, 0) + this.loop.reduce((s, m) => s + m.misses, 0); }
  get iterationsPerStep(): number { return this.circuits.reduce((s, c) => s + c.iterations, 0) / Math.max(1, this.steps); }
}

/** Runs a mono buffer through a rig. Each call starts from the rig's resting state. */
export function runRig(spec: RigSpec, input: Float32Array, sampleRate = 48000, oversample = 4): RigRun {
  const rig = new Rig(spec, sampleRate, oversample);
  const out = new Float32Array(input.length);
  rig.process(input, out);
  return { out, misses: rig.misses, iterationsPerStep: rig.iterationsPerStep };
}
