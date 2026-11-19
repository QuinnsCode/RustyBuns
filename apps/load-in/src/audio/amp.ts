// The guitarist's amp at the show, and the guitar baked through it. At soundcheck you stand at the amp and set its five
// knobs (Gain, Bass, Mid, Treble, Master, 0 to 10); `bakeGuitar` runs the guitar's clean stem (stems.ts, a DI) through
// the amp's circuit (packages/gear `@rustybuns/gear/circuit`): three 12AX7 stages with the Gain pot ahead of the
// second, the passive bass/mid/treble stack, a push-pull power stage and a closed-back 4x12 heard through a mic. The
// netlists are the same textbook stages as FM DAW's triode and tone boards (apps/fm-daw/circuits), written as parts
// here so Load In doesn't import another app. It is heavy (a Newton solve per tube per sample, four times
// oversampled), so the page runs it in a worker (amp-worker.ts). Plain data, no DOM.
import { DEFAULT_MIC, type Netlist, type RigSpec, runRig } from "@rustybuns/gear/circuit";
import { clamp } from "@rustybuns/util";
import { Bad, type Guard, type Of, int, num, obj } from "@rustybuns/util/guard";

export const AMP_KNOBS = ["gain", "bass", "mid", "treble", "master"] as const;
export type AmpKnob = (typeof AMP_KNOBS)[number];
export type AmpKnobs = Record<AmpKnob, number>;

const knob = num(0, 10);
/** The five knobs, as they go to the worker. */
export const AmpKnobs = obj({ gain: knob, bass: knob, mid: knob, treble: knob, master: knob });

/** The sample rate the show's stems are made and baked at, whatever the page's audio runs at. */
export const BAKE_RATE = 48000;
/** The page to the worker: bake every song's guitar through these knobs (ask `id`; a later ask drops this one). */
export const BakeAsk = obj({ id: int(0, Number.MAX_SAFE_INTEGER), knobs: AmpKnobs });
export type BakeAsk = Of<typeof BakeAsk>;
const samples: Guard<Float32Array<ArrayBuffer>> = (v) => {
  if (!(v instanceof Float32Array)) throw new Bad("samples, as a Float32Array");
  return new Float32Array(v);
};
/** The worker to the page: song `song`'s guitar, baked, for ask `id`, at `BAKE_RATE`. */
export const BakeReply = obj({ id: int(0, Number.MAX_SAFE_INTEGER), song: int(0, 99), data: samples });
export type BakeReply = Of<typeof BakeReply>;

/** The amp as the guitarist walks on with it: a crunch, mids up. */
export const newAmp = (): AmpKnobs => ({ gain: 6, bass: 5, mid: 6, treble: 6, master: 5 });

/** Turn one knob by `by`, kept on the panel's 0 to 10. */
export function turnKnob(a: AmpKnobs, knob: AmpKnob, by: number): void {
  a[knob] = clamp(Math.round((a[knob] + by) * 2) / 2, 0, 10);
}

/** One 12AX7 stage: coupling cap and grid leak, grid stopper, plate load from B+, cathode resistor and bypass cap. */
function triode(rk: number, ck: number, cc = 22e-9): Netlist {
  return {
    input: "in",
    output: "plate",
    parts: [
      { kind: "C", a: "in", b: "g0", farads: cc },
      { kind: "R", a: "g0", b: "gnd", ohms: 1e6 },
      { kind: "R", a: "g0", b: "grid", ohms: 68e3 },
      { kind: "Triode", p: "plate", g: "grid", k: "cath" },
      { kind: "R", a: "cath", b: "gnd", ohms: rk },
      ...(ck > 0 ? [{ kind: "C" as const, a: "cath", b: "gnd", farads: ck }] : []),
      { kind: "R", a: "bplus", b: "plate", ohms: 100e3 },
      { kind: "V", a: "bplus", b: "gnd", volts: 300 },
    ],
  };
}

/** The passive tone stack: the treble pot's two halves at the output, the bass and mid pots log taper. Knobs 0 to 10. */
function toneStack(bass: number, mid: number, treble: number): Netlist {
  const pot = (k: number) => clamp(k / 10, 0.001, 0.999);
  const tr = pot(treble), b = pot(bass) ** 2, m = pot(mid) ** 2;
  return {
    input: "in",
    output: "out",
    parts: [
      { kind: "C", a: "in", b: "t", farads: 470e-12 },
      { kind: "R", a: "t", b: "out", ohms: (1 - tr) * 220e3 },
      { kind: "R", a: "out", b: "low", ohms: tr * 220e3 },
      { kind: "R", a: "in", b: "slope", ohms: 33e3 },
      { kind: "C", a: "slope", b: "low", farads: 22e-9 },
      { kind: "C", a: "slope", b: "mid", farads: 22e-9 },
      { kind: "R", a: "low", b: "mid", ohms: b * 1e6 },
      { kind: "R", a: "mid", b: "gnd", ohms: m * 25e3 },
      { kind: "R", a: "out", b: "gnd", ohms: 1e6 },
    ],
  };
}

/** The Gain knob's pot: log taper, never quite off. */
const gainPot = (gain: number) => 0.02 + 0.98 * (gain / 10) ** 2;

/** The amp at these knobs, as a rig. */
export function ampRig(k: AmpKnobs): RigSpec {
  return {
    inputVolts: 0.5,
    links: [
      { net: triode(2.7e3, 0.68e-6), gain: 1 },
      { net: triode(10e3, 0), gain: gainPot(k.gain) },
      { net: triode(820, 0.68e-6), gain: 0.8 },
      { net: toneStack(k.bass, k.mid, k.treble) },
    ],
    power: 1.5 * (0.25 + 0.15 * k.master),
    output: { pairs: 1, sag: 250, load: 8 },
    cab: DEFAULT_MIC,
  };
}

const rms = (x: Float32Array) => {
  let s = 0;
  for (const v of x) s += v * v;
  return Math.sqrt(s / Math.max(1, x.length));
};

/** How much of the loop's end runs through the amp ahead of it, seconds: the tubes and caps settle in that. */
const PRE_ROLL = 0.5;

/**
 * The guitar's stem (a loop, at `rate`) baked through the amp at these knobs, looping as cleanly as it came in: the
 * loop's last half second goes in first and is dropped, so the amp has settled and the cab's tail wraps round the seam.
 * It comes back at the stem's own RMS, so the desk's dB for the guitar mean the same baked or not.
 */
export function bakeGuitar(di: Float32Array, rate: number, k: AmpKnobs): Float32Array<ArrayBuffer> {
  const n = di.length, pre = Math.min(n, Math.round(PRE_ROLL * rate)), run = new Float32Array(pre + n);
  run.set(di.subarray(n - pre), 0);
  run.set(di, pre);
  const { out } = runRig(ampRig(k), run, rate);
  const baked = new Float32Array(out.subarray(pre));
  const scale = rms(di) / (rms(baked) || 1);
  for (let s = 0; s < n; s++) baked[s] = (baked[s] ?? 0) * scale;
  return baked;
}
