// The gear a stage needs between the guitar and the desk: a DI box and one console channel.
// Our own topologies, op-amps only (the transistor parts of #4826 can take over the DI's
// buffer later without changing what it does).
//
// The line: guitar -> DI (a buffer and an inverter: hot and cold) -> XLR -> the console's
// balanced receiver -> its preamp -> Shape EQ -> fader. The DI's thru jack also feeds the
// guitar amp, and that is where the hum comes from: the amp's mains earth and the console's
// are two outlets apart, a fraction of a volt of mains between them. With the DI's ground
// tied to pin 1, that voltage pushes a current round amp -> thru shield -> DI -> XLR shield ->
// console, and the console lands pin 1 on its signal ground (the "pin 1 problem"), so the
// current's drop on that trace is in the audio. Lifting the DI's ground breaks the loop: the
// DI then rides on the amp's earth, which the balanced pair carries as common mode and the
// receiver throws away.
//
// The solver drives one input, so the hum is a second run of the same circuit with the
// mains between the earths as its input and the guitar silent. Below the rails everything
// here is linear, so the two runs add up to the line.
import { Circuit, type Netlist, type Part } from "./mna.ts";
import { TsEq, type EqDoc } from "../engine/eq.ts";

const R = (a: string, b: string, ohms: number): Part => ({ kind: "R", a, b, ohms });
const C = (a: string, b: string, farads: number): Part => ({ kind: "C", a, b, farads });

/** Mains hum: the voltage between two outlets' earths, and its frequency. */
export const HUM = { volts: 0.3, hz: 60 };

export interface LineSpec {
  /** The DI's ground lift: true breaks pin 1 from the DI's ground. */
  lift?: boolean;
  /** Whether the DI's thru runs to an earthed amp (that makes the loop). */
  thru?: boolean;
  /** The console preamp's gain knob, 0 to 1: ×1 to ×31 (0 to 30 dB). */
  gain?: number;
  /** Which source drives the run: the guitar, or the mains between the two earths. */
  drive?: "guitar" | "hum";
}

/**
 * The line from the guitar to the console preamp's output, as one netlist. Nodes: `G` the
 * guitar's pickup, `ig` the DI's ground (its jacks' sleeves), `EARTH` the guitar amp's chassis,
 * `sg` the console's signal ground, `gnd` the console's chassis.
 */
export function stageLine(s: LineSpec = {}): Netlist {
  const hum = s.drive === "hum";
  const gain = Math.min(Math.max(s.gain ?? 0.2, 0), 1);
  const parts: Part[] = [
    // The guitar: a pickup behind 10k, its sleeve on the DI's ground. Silent on the hum run.
    R("G", "tip", 10e3),
    ...(hum ? [R("G", "ig", 1)] : []),
    // The DI: 1M in, a follower for hot and a unity inverter for cold, 100 ohms out each.
    C("tip", "inp", 100e-9), R("inp", "ig", 1e6),
    { kind: "Opamp", plus: "inp", minus: "hot", out: "hot", rail: 8 },
    R("hot", "inv", 10e3), R("inv", "cold", 10e3),
    { kind: "Opamp", plus: "ig", minus: "inv", out: "cold", rail: 8 },
    R("hot", "xh", 100), R("cold", "xc", 100),
    // The ground lift: a closed switch, or 1k (so the DI's circuit keeps a ground, but no loop current to speak of).
    R("ig", "p1", s.lift ? 1e3 : 0.05),
    // The XLR: 20 m of pair and shield.
    R("xh", "ch", 1), R("xc", "cc", 1), R("p1", "sg", 0.5),
    // The console: pin 1 on its signal ground, which reaches chassis through a trace.
    R("sg", "gnd", 0.05),
    // Its receiver: a unity difference amp on 10k resistors, referenced to signal ground.
    R("ch", "rp", 10e3), R("rp", "sg", 10e3), R("cc", "rn", 10e3), R("rn", "rx", 10e3),
    { kind: "Opamp", plus: "rp", minus: "rn", out: "rx", rail: 12 },
    // Its preamp: non-inverting, ×1 to ×31, rolled off above the audio band.
    { kind: "Opamp", plus: "rx", minus: "pn", out: "OUT", rail: 12 },
    R("OUT", "pn", gain * 30e3 + 1), C("OUT", "pn", 10e-12), R("pn", "sg", 1e3),
  ];
  if (s.thru) {
    // The thru cable to the amp, and the amp's 1M input. The amp's chassis is on mains earth.
    parts.push(R("tip", "ampIn", 0.5), R("ampIn", "EARTH", 1e6), R("ig", "EARTH", 0.3));
    // Two outlets' earths: the hum run drives EARTH, the guitar run ties it to the console's.
    if (!hum) parts.push(R("EARTH", "gnd", 0.1));
    else parts.push(R("EARTH", "gnd", 1e9));
  }
  return { input: hum ? "EARTH" : "G", output: "OUT", parts };
}

/** A sine's level in dB after a circuit settles: the second half of `seconds`. */
function levelDb(net: Netlist, sr: number, hz: number, volts: number, seconds = 0.2): number {
  const c = new Circuit(net, sr);
  const rest = c.settle(0);
  let lo = Infinity, hi = -Infinity;
  const n = Math.round(sr * seconds);
  for (let i = 0; i < n; i++) {
    const o = c.step(volts * Math.sin((2 * Math.PI * hz * i) / sr)) - rest;
    if (i > n / 2) { lo = Math.min(lo, o); hi = Math.max(hi, o); }
  }
  return 20 * Math.log10(Math.max((hi - lo) / 2, 1e-12));
}

/**
 * A line check: what a roadie hears on the desk with the guitar playing a 200 mV note, and
 * with it silent. `hum` is the mains in dB (volts), `signal` the note, `clear` the gap between.
 */
export function lineCheck(s: Omit<LineSpec, "drive"> = {}, sr = 48000): { signal: number; hum: number; clear: number } {
  const signal = levelDb(stageLine({ ...s, drive: "guitar" }), sr, 440, 0.2);
  const hum = s.thru ? levelDb(stageLine({ ...s, drive: "hum" }), sr, HUM.hz, HUM.volts) : -240;
  return { signal, hum, clear: signal - hum };
}

/**
 * One console channel, streaming: the line (DI, receiver, preamp) as a circuit, the hum run
 * beside it when the DI's thru makes a loop, then Shape EQ, then the fader.
 */
export class ConsoleChannel {
  private line: Circuit;
  private hum: Circuit | null;
  private rest: number;
  private humRest: number;
  private eq: TsEq;
  private buf = new Float64Array(0);
  private t = 0;
  /** The fader, dB: 0 is unity, -Infinity is down. */
  fader = 0;

  constructor(readonly sampleRate: number, readonly spec: Omit<LineSpec, "drive"> = {}) {
    this.line = new Circuit(stageLine({ ...spec, drive: "guitar" }), sampleRate);
    this.rest = this.line.settle(0);
    this.hum = spec.thru ? new Circuit(stageLine({ ...spec, drive: "hum" }), sampleRate) : null;
    this.humRest = this.hum?.settle(0) ?? 0;
    this.eq = new TsEq(sampleRate);
  }

  setEq(doc: EqDoc) { this.eq.set(doc); }

  /** Guitar volts in, the channel's output volts back (mono). */
  process(input: Float32Array): Float32Array {
    const n = input.length;
    if (this.buf.length < n * 2) this.buf = new Float64Array(n * 2);
    const w = (2 * Math.PI * HUM.hz) / this.sampleRate;
    for (let i = 0; i < n; i++) {
      let v = this.line.step(input[i]) - this.rest;
      if (this.hum) v += this.hum.step(HUM.volts * Math.sin(w * this.t++)) - this.humRest;
      this.buf[i * 2] = v; this.buf[i * 2 + 1] = v;
    }
    if (this.eq.live()) this.eq.insert(this.buf, n);
    const g = this.fader === -Infinity ? 0 : 10 ** (this.fader / 20);
    return Float32Array.from({ length: n }, (_, i) => this.buf[i * 2] * g);
  }
}
