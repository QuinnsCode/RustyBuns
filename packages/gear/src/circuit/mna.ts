// A circuit simulator for audio: modified nodal analysis (MNA), capacitors as
// trapezoidal companions, Newton-Raphson every sample for the parts that bend
// (diodes, transistors, triodes, OTAs, op-amps at their rails).
//
// The speed trick: at a fixed sample rate everything linear (resistors, the
// capacitors' companions, sources, the op-amps' insides) is one constant
// matrix, inverted once. Each nonlinear part only touches a "port" (a pair of
// nodes: a diode's two legs, a triode's plate-cathode and grid-cathode), so
// Newton runs on those few port voltages, not the whole circuit: a 2×2 solve
// per iteration for a tube stage. That is the idea behind the K- and DK-methods
// of Borin, De Poli & Rocchesso (2000) and Yeh (2009), done straight on the MNA
// matrix. `settle` still solves the whole circuit, to find where the tubes rest.
//
// Parts whose value moves while it plays (a pot being turned, an LDR following its
// light) keep a fixed conductance in that matrix and a port for the difference, so
// turning one costs a port, never a new inversion.
//
// Sources: Ho, Ruehli & Brennan (1975) for MNA; Nagel's SPICE2 thesis (1975)
// for the junction limiting (pnjlim); Koren (1996) for the triode plate
// current; Cohen & Helie (2010) for the triode grid current; Ebers & Moll (1954)
// for the BJT; Shichman & Hodges (1968) for the JFET; the OTA is the bipolar
// differential pair's textbook law, Iabc·tanh(vd/2VT).

/** One part. Node names are free text; "gnd" (or "GND", "0") is ground. */
export type Part =
  /** A resistor. With `noisy`, it hisses: its thermal (Johnson) noise, scaled by the circuit's `noise`. */
  | { kind: "R"; a: string; b: string; ohms: number; noisy?: boolean }
  | { kind: "C"; a: string; b: string; farads: number }
  /** A DC supply, + at `a`. */
  | { kind: "V"; a: string; b: string; volts: number }
  /** A current source: `amps` out of `a`, through it, into `b`. `Circuit.push` sets it as it plays (TypeScript only). */
  | { kind: "I"; a: string; b: string; amps: number }
  /** A diode, anode `a`, cathode `k`. Defaults are a 1N4148-ish silicon diode. */
  | { kind: "D"; a: string; k: string; is?: number; n?: number }
  /**
   * An op-amp (TL072-ish gain and bandwidth) with its output swinging about ±`rail` volts around ground.
   * `rail: 0` leaves the rails off: a stage that never clips (an all-pass, a buffer) costs no Newton.
   */
  | { kind: "Opamp"; plus: string; minus: string; out: string; rail?: number }
  /**
   * A resistor something else moves: a light-dependent resistor under a lamp or LED, a JFET's channel
   * under its gate, a pot under a foot. Control `ctl` (0 to 1, set by `setCtl` or a rig's `Mod`)
   * sweeps it from `hi` ohms at 0 to `lo` at 1, on a log scale.
   */
  | { kind: "VarR"; a: string; b: string; ctl: string; hi: number; lo: number }
  /** A triode: plate, grid, cathode. A 12AX7 unless `tube` says otherwise. */
  | { kind: "Triode"; p: string; g: string; k: string; tube?: TubeName }
  /** An inductor, with its wire's resistance (`ohms`, default 1) in series. */
  | { kind: "L"; a: string; b: string; henries: number; ohms?: number }
  /**
   * A bipolar transistor (Ebers-Moll): NPN unless `pnp`, silicon unless `ge`. Germanium has a
   * lower knee and leaks: `leak` amps (ICBO) from collector to base, which the gain multiplies.
   */
  | { kind: "BJT"; c: string; b: string; e: string; pnp?: boolean; ge?: boolean; is?: number; bf?: number; br?: number; leak?: number }
  /**
   * A JFET (square law with a triode region): N-channel unless `p`. `vp` is the size of the
   * pinch-off voltage (default 2 V), `idss` the drain current at vgs = 0 (3 mA).
   */
  | { kind: "JFET"; d: string; g: string; s: string; p?: boolean; idss?: number; vp?: number; lambda?: number }
  /** A pot, `a` to wiper `w` to `b`: `at` (0 to 1, default 0.5) is the wiper's travel from `a`. `Circuit.setPot` turns it. */
  | { kind: "Pot"; a: string; w: string; b: string; ohms: number; at?: number; taper?: Taper }
  /**
   * An LDR from `a` to `b`, lit by an LED from `la` to `lk` (or with `lamp`, a filament of that
   * many ohms). It reads `lit` ohms with 10 mA in the LED (40 mA in a lamp), `dark` in the dark, and
   * its light comes up in `rise` seconds and dies away in `fall`, the slow, lopsided part.
   */
  | { kind: "LDR"; a: string; b: string; la: string; lk: string; dark?: number; lit?: number; rise?: number; fall?: number; lamp?: number }
  /** An OTA: Iabc·tanh((v+ − v−)/2VT) out of `out`, where Iabc is the current into `abc` (a junction to ground). */
  | { kind: "OTA"; plus: string; minus: string; out: string; abc: string };

/** How a pot's resistance follows its travel: straight, audio (log, 10% at half way) or reverse audio. */
export type Taper = "lin" | "log" | "rlog";

/** A circuit with one input (driven by an ideal voltage source) and one output node. */
export interface Netlist { parts: Part[]; input: string; output: string }

const GROUND = new Set(["gnd", "GND", "0"]);
const VT = 0.02585; // thermal voltage at room temperature
const GMIN = 1e-12; // a whisper of conductance from every node to ground, so no node floats
// Op-amp: a TL072-ish open-loop gain and gain-bandwidth, and its hidden node's resistance.
const OPAMP_A0 = 2e5, OPAMP_GBW = 3e6, OPAMP_R0 = 1e6;
// 12AX7 (Koren): amplification, exponent, and fitted constants.
/** Koren's constants for each tube: amplification, exponent, and the fitted kg1, kp, kvb. */
export const TUBES = {
  "12AX7": { mu: 100, ex: 1.4, kg1: 1060, kp: 600, kvb: 300 },
  // Lower gain, more current: what drives a spring tank's transformer.
  "12AT7": { mu: 60, ex: 1.35, kg1: 460, kp: 300, kvb: 300 },
};
export type TubeName = keyof typeof TUBES;
// Grid current (Cohen & Helie).
const GG = 6.062e-4, CG = 13.9, XI = 1.354, IG0 = 3.917e-8;
// Transistors: a 2N3904-ish silicon one and an old germanium one (lower knee, ICBO leakage).
const SI = { is: 6.7e-15, bf: 200, br: 1, leak: 0 }, GE = { is: 1e-7, bf: 90, br: 2, leak: 5e-6 };
// A small-signal junction (JFET gate, OTA bias pin) and a red LED.
const JUNCTION_IS = 1e-14, LED_IS = 1e-18, LED_N = 2;
// An LDR's light against its source's current (10 mA in an LED, 40 mA in a lamp), and its law, R ∝ light^−γ.
const LED_FULL = 0.01, LAMP_FULL = 0.04, LDR_GAMMA = 0.75;
// A pot follows its knob over about 10 ms, so a jump is a quick glide, not a click.
const POT_GLIDE = 0.01;
const TAPERS: Taper[] = ["lin", "log", "rlog"];

/** A pot's travel through its taper: the share of its resistance between `a` and the wiper. */
function taper(kind: number, at: number): number {
  if (kind === 1) return (Math.pow(81, at) - 1) / 80;
  if (kind === 2) return 1 - (Math.pow(81, 1 - at) - 1) / 80;
  return at;
}

/** The share of a pot's resistance between its `a` leg and the wiper at travel `at` (0 to 1). */
export const potShare = (p: Extract<Part, { kind: "Pot" }>): number => taper(TAPERS.indexOf(p.taper ?? "lin"), p.at ?? 0.5);

/**
 * The netlist with every pot set where it stands, as two plain resistors (a to wiper, wiper to b). A circuit
 * whose knobs move seldom builds this again when one moves (`Circuit.adopt` keeps its sound going) instead
 * of paying two Newton ports a pot every sample.
 */
export function fixPots(net: Netlist): Netlist {
  const parts = net.parts.flatMap((p): Part[] => {
    if (p.kind !== "Pot") return [p];
    const t = potShare(p);
    return [{ kind: "R", a: p.a, b: p.w, ohms: Math.max(p.ohms * t, 1) }, { kind: "R", a: p.w, b: p.b, ohms: Math.max(p.ohms * (1 - t), 1) }];
  });
  return { ...net, parts };
}

/** A part's nodes in the order both solvers number them; `opamp` names an op-amp's hidden node. */
function legs(p: Part, opamp: number): string[] {
  switch (p.kind) {
    case "R": case "C": case "V": case "I": case "L": case "VarR": return [p.a, p.b];
    case "D": return [p.a, p.k];
    case "Opamp": return [p.plus, p.minus, p.out, `~${opamp}`];
    case "Triode": return [p.p, p.g, p.k];
    case "BJT": return [p.c, p.b, p.e];
    case "JFET": return [p.d, p.g, p.s];
    case "Pot": return [p.a, p.w, p.b];
    case "LDR": return [p.a, p.b, p.la, p.lk];
    case "OTA": return [p.plus, p.minus, p.out, p.abc];
  }
}

/** A part's kind number, values (defaults filled in) and flag, as the Rust layout carries them. */
function values(p: Part): [number, number[], number] {
  switch (p.kind) {
    case "R": return [0, [p.ohms], p.noisy ? 1 : 0];
    case "C": return [1, [p.farads], 0];
    case "V": return [2, [p.volts], 0];
    case "D": return [3, [p.is ?? 2.52e-9, p.n ?? 1.752], 0];
    case "Opamp": return [4, [p.rail ?? 4], 0];
    case "Triode": return [5, [], 0];
    case "L": return [6, [p.henries, Math.max(p.ohms ?? 1, 1e-3)], 0];
    case "BJT": { const d = p.ge ? GE : SI; return [7, [p.is ?? d.is, p.bf ?? d.bf, p.br ?? d.br, p.leak ?? d.leak], p.pnp ? 1 : 0]; }
    case "JFET": return [8, [p.idss ?? 3e-3, Math.abs(p.vp ?? 2), p.lambda ?? 0.01], p.p ? 1 : 0];
    case "Pot": return [9, [p.ohms, Math.min(1, Math.max(0, p.at ?? 0.5)), Math.max(0, TAPERS.indexOf(p.taper ?? "lin"))], 0];
    case "LDR": return [10, [p.dark ?? 1e6, p.lit ?? 1e3, p.rise ?? 0.0025, p.fall ?? 0.035, p.lamp ?? 0], 0];
    case "OTA": return [11, [], 0];
    case "VarR": return [12, [p.hi, p.lo], 0];
    case "I": return [13, [p.amps], 0];
  }
}


/** SPICE's junction limiting: keeps a Newton step from flying up the diode's exponential. */
function pnjlim(v: number, vold: number, nvt: number, vcrit: number): number {
  if (v > vcrit && Math.abs(v - vold) > 2 * nvt) {
    if (vold > 0) {
      const arg = 1 + (v - vold) / nvt;
      return arg > 0 ? vold + nvt * Math.log(arg) : vcrit;
    }
    return nvt * Math.log(v / nvt);
  }
  return v;
}

/** Solves A x = b in place (A is n×n inside a row stride of `m`), partial pivoting. False if singular. */
function solve(A: Float64Array, b: Float64Array, n: number, m: number): boolean {
  for (let c = 0; c < n; c++) {
    let p = c, best = Math.abs(A[c * m + c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(A[r * m + c]); if (v > best) { best = v; p = r; } }
    if (best < 1e-300) return false;
    if (p !== c) {
      for (let k = c; k < n; k++) { const t = A[c * m + k]; A[c * m + k] = A[p * m + k]; A[p * m + k] = t; }
      const t = b[c]; b[c] = b[p]; b[p] = t;
    }
    const inv = 1 / A[c * m + c];
    for (let r = c + 1; r < n; r++) {
      const f = A[r * m + c] * inv;
      if (f === 0) continue;
      for (let k = c + 1; k < n; k++) A[r * m + k] -= f * A[c * m + k];
      b[r] -= f * b[c];
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r * m + k] * b[k];
    b[r] = s / A[r * m + r];
  }
  return true;
}

/**
 * A netlist as numbers for the Rust solver (native/crates/fm_daw/src/circuit.rs):
 * `[nodes, input, output, parts]`, then 12 per part, `[kind, n0, n1, n2, n3, v0 … v5, flag]`,
 * ground −1. Nodes are numbered in the order `Circuit` numbers them, defaults filled in.
 */
export function encodeNetlist(net: Netlist): Float64Array {
  const nodes = new Map<string, number>();
  const node = (name: string): number => {
    if (GROUND.has(name)) return -1;
    let i = nodes.get(name);
    if (i === undefined) { i = nodes.size; nodes.set(name, i); }
    return i;
  };
  const rows: number[][] = [];
  let opamps = 0;
  for (const p of net.parts) {
    if (p.kind === "VarR" || p.kind === "I" || (p.kind === "Opamp" && p.rail === 0)) {
      throw new Error(`the Rust solver has no ${p.kind === "Opamp" ? "rail-less op-amp" : p.kind === "I" ? "current source" : p.kind} yet`);
    }
    if (p.kind === "Triode" && (p.tube ?? "12AX7") !== "12AX7") throw new Error(`the Rust solver has only the 12AX7, not ${p.tube}`);
    const ns = legs(p, opamps).map(node), [kind, vals, flag] = values(p);
    if (p.kind === "Opamp") opamps++;
    rows.push([kind, ...ns, ...Array(4 - ns.length).fill(0), ...vals, ...Array(6 - vals.length).fill(0), flag]);
  }
  const at = (name: string) => {
    const i = nodes.get(name);
    if (i === undefined) throw new Error(`node "${name}" isn't on any part`);
    return i;
  };
  return Float64Array.from([nodes.size, at(net.input), at(net.output), rows.length, ...rows.flat()]);
}

/**
 * A netlist compiled for one sample rate. `settle()` once, then `step(vin)`
 * per sample for the output node's voltage. Ground is the extra index `n`:
 * stamps that land on it go to a row and column nothing reads, so no part
 * needs an "is this ground?" branch in the hot loop.
 */
export class Circuit {
  readonly size: number;
  /** Samples where Newton ran out of iterations (should stay 0). */
  misses = 0;
  /** Newton iterations taken, all samples together. */
  iterations = 0;
  /** About how many multiply-adds its steps took, all together: what a rig split across threads is cut by. */
  work = 0;
  private flat = 0;
  private m: number;
  private nodes = new Map<string, number>();
  private baseDc: Float64Array;
  private x: Float64Array;
  private out: number;
  private inRow: number;
  /** DC supplies: their branch row, volts, and the node they hold up when their other end is ground (else −2). */
  private supplies: { row: number; volts: number; node: number }[] = [];
  /** Current sources: amps out of node `a` into node `b` (ground is the unread index). */
  private sources: { a: number; b: number; amps: number }[] = [];
  private caps: { a: number; b: number; g: number; v: number; i: number; ieq: number }[] = [];
  private hiss: { a: number; b: number; sigma: number }[] = [];
  /**
   * How loud the noisy resistors hiss: 0 is silent, 1 is a perfect resistor's thermal
   * noise, and more is an old carbon one (their excess noise runs tens of dB above thermal).
   */
  noise = 0;
  private seed = 0x9e3779b9;
  /** A standard normal draw (Box-Muller on a xorshift stream, so a test hears the same hiss each run). */
  private gauss(): number {
    let s = this.seed;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const u1 = ((s >>> 0) + 1) / 4294967297;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; const u2 = (s >>> 0) / 4294967296;
    this.seed = s;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  // Ports: node pairs (pa, pb) whose voltage the nonlinear parts read, less `poff`.
  private pa: number[] = [];
  private pb: number[] = [];
  private poff: number[] = [];
  private diodes: { port: number; is: number; nvt: number }[] = [];
  /** Every pn junction's port, for the limiting: the diodes and both junctions of each BJT. */
  private junctions: { port: number; nvt: number; vcrit: number }[] = [];
  private triodes: ({ pk: number; gk: number } & (typeof TUBES)[TubeName])[] = [];
  /** Inductors: trapezoidal companion of L with the wire's \`rw\` in series (gl = T/2L, g the pair's conductance). */
  private inds: { a: number; b: number; gl: number; rw: number; g: number; v: number; i: number; ieq: number }[] = [];
  /** BJTs, NPN-wise: \`be\` carries Ie and reads vbe, \`bc\` carries −Ic and reads vbc (a PNP's ports are turned round). */
  private bjts: { be: number; bc: number; is: number; bf: number; br: number; leak: number }[] = [];
  /** JFETs, N-wise: \`ds\` carries the drain current, \`gs\` is the gate junction (and reads vgs). */
  private jfets: { ds: number; gs: number; beta: number; vp: number; lambda: number }[] = [];
  /** OTAs: \`vd\` reads the inputs, \`abc\` is the bias junction, \`out\` pushes the output current. */
  private otas: { vd: number; abc: number; out: number }[] = [];
  /** Resistances that move: \`g0\` sits in the inverted matrix, the port carries (g − g0)·v. */
  private vres: { port: number; g0: number; g: number }[] = [];
  private pots: { r1: number; r2: number; ohms: number; taper: number; at: number; to: number }[] = [];
  private potGlide: number;
  /** LDRs: \`led\` is the LED's port (−1 for a lamp across \`la\`–\`lk\`), \`light\` 1 at full current. */
  private ldrs: { r: number; led: number; la: number; lk: number; lamp: number; dark: number; lit: number; up: number; down: number; light: number }[] = [];
  /** Each port's current after the last step or settle (an LED's, for its LDR). */
  private iNow: Float64Array;
  /** `VarR`s: their `vres` index and the control slot they listen to, swept on a log scale from `hi`. */
  private varRs: { r: number; slot: number; lnHi: number; lnSpan: number }[] = [];
  private ctlSlots = new Map<string, number>();
  private K = 0;
  // Port-space Newton: the inverted linear matrix (column-major), W = A⁻¹U and H = VᵀA⁻¹U.
  private Ainv: Float64Array;
  private W: Float64Array;
  private H: Float64Array;
  private z: Float64Array;
  private v: Float64Array;
  private vNew: Float64Array;
  private iP: Float64Array;
  private J: Float64Array;
  private F: Float64Array;
  private JF: Float64Array;
  private p: Float64Array;

  constructor(net: Netlist, readonly sampleRate: number) {
    const node = (name: string): number => {
      if (GROUND.has(name)) return -1;
      let i = this.nodes.get(name);
      if (i === undefined) { i = this.nodes.size; this.nodes.set(name, i); }
      return i;
    };
    let opamps = 0;
    for (const p of net.parts) { for (const l of legs(p, opamps)) node(l); if (p.kind === "Opamp") opamps++; }
    if (!this.nodes.has(net.input)) throw new Error(`input node "${net.input}" isn't on any part`);
    if (!this.nodes.has(net.output)) throw new Error(`output node "${net.output}" isn't on any part`);
    const nodeCount = this.nodes.size;
    let branches = 1; // the input source
    for (const p of net.parts) if (p.kind === "V" || p.kind === "Opamp") branches++;
    const n = (this.size = nodeCount + branches);
    const m = (this.m = n + 1);
    const g = (i: number) => (i < 0 ? n : i); // ground → the unread index
    const tr = new Float64Array(m * m);
    const dc = (this.baseDc = new Float64Array(m * m));
    const both = (r: number, c: number, v: number) => { tr[r * m + c] += v; dc[r * m + c] += v; };
    const conductance = (base: Float64Array, a: number, b: number, v: number) => {
      base[a * m + a] += v; base[b * m + b] += v; base[a * m + b] -= v; base[b * m + a] -= v;
    };
    for (let i = 0; i < nodeCount; i++) both(i, i, GMIN);
    let row = nodeCount;
    const source = (a: number, b: number): number => {
      const j = row++;
      both(a, j, 1); both(b, j, -1); both(j, a, 1); both(j, b, -1);
      return j;
    };
    const port = (a: number, b: number, off: number) => { this.pa.push(a); this.pb.push(b); this.poff.push(off); return this.pa.length - 1; };
    const junction = (port: number, is: number, nvt: number) => { this.junctions.push({ port, nvt, vcrit: nvt * Math.log(nvt / (Math.SQRT2 * is)) }); };
    /** A diode whose voltage is read `off` volts below a−k: with k at ground, a clamp at `off`. Its port. */
    const diode = (a: number, k: number, off: number, is: number, nf: number) => {
      const nvt = nf * VT, at = port(a, k, off);
      this.diodes.push({ port: at, is, nvt });
      junction(at, is, nvt);
      return at;
    };
    /** A resistance that moves, starting at conductance `g0`. Its index in `vres`. */
    const moving = (a: number, b: number, g0: number) => {
      conductance(tr, a, b, g0); conductance(dc, a, b, g0);
      this.vres.push({ port: port(a, b, 0), g0, g: g0 });
      return this.vres.length - 1;
    };
    const T = 1 / sampleRate;
    this.potGlide = 1 - Math.exp(-T / POT_GLIDE);
    this.inRow = source(g(node(net.input)), n);
    opamps = 0;
    for (const p of net.parts) {
      const [a, b, c, d] = legs(p, opamps).map((l) => g(node(l)));
      const [, v] = values(p);
      if (p.kind === "R") {
        conductance(tr, a, b, 1 / p.ohms); conductance(dc, a, b, 1 / p.ohms);
        // Johnson noise as a current beside the resistor: sqrt(4kT/R · bandwidth), bandwidth = half the rate.
        if (p.noisy) this.hiss.push({ a, b, sigma: Math.sqrt(((4 * 1.380649e-23 * 300) / p.ohms) * (sampleRate / 2)) });
      } else if (p.kind === "C") {
        const gc = (2 * p.farads) / T;
        conductance(tr, a, b, gc); // open at DC: the dc matrix leaves it out
        this.caps.push({ a, b, g: gc, v: 0, i: 0, ieq: 0 });
      } else if (p.kind === "V") {
        this.supplies.push({ row: source(a, b), volts: p.volts, node: b === n ? a : -2 });
      } else if (p.kind === "I") {
        this.sources.push({ a, b, amps: p.amps });
      } else if (p.kind === "D") {
        diode(a, b, 0, v[0], v[1]);
      } else if (p.kind === "VarR") {
        let slot = this.ctlSlots.get(p.ctl);
        if (slot === undefined) { slot = this.ctlSlots.size; this.ctlSlots.set(p.ctl, slot); }
        this.varRs.push({ r: moving(a, b, 1 / p.hi), slot, lnHi: Math.log(p.hi), lnSpan: Math.log(p.lo / p.hi) });
      } else if (p.kind === "Opamp") {
        // Input stage: gm·(v+ − v−) into a hidden node with R0 and C0 to ground
        // (open-loop gain A0 = gm·R0, one pole at GBW/A0). Two diodes clamp it near
        // the rails. Output: a unity buffer of the hidden node. A finite bandwidth
        // is also what keeps Newton calm: an ideal op-amp with a hard rail bounces.
        opamps++;
        const [plus, minus, out, hid] = [a, b, c, d];
        const gm = OPAMP_A0 / OPAMP_R0, c0 = OPAMP_A0 / (2 * Math.PI * OPAMP_GBW * OPAMP_R0);
        both(hid, plus, -gm); both(hid, minus, gm);
        conductance(tr, hid, n, 1 / OPAMP_R0 + (2 * c0) / T); conductance(dc, hid, n, 1 / OPAMP_R0);
        this.caps.push({ a: hid, b: n, g: (2 * c0) / T, v: 0, i: 0, ieq: 0 });
        if (p.rail !== 0) {
          const vr = v[0] - 0.5;
          diode(hid, n, vr, 2.52e-9, 1.752); diode(n, hid, vr, 2.52e-9, 1.752);
        }
        const j = row++;
        both(out, j, 1); both(j, out, 1); both(j, hid, -1);
      } else if (p.kind === "Triode") {
        this.triodes.push({ pk: port(a, c, 0), gk: port(b, c, 0), ...TUBES[p.tube ?? "12AX7"] });
      } else if (p.kind === "L") {
        // Trapezoidal L with rw in series: i = g·v + ieq, g = gl/(1 + rw·gl). At DC, just rw.
        const gl = T / (2 * v[0]), rw = v[1], gi = gl / (1 + rw * gl);
        conductance(tr, a, b, gi); conductance(dc, a, b, 1 / rw);
        this.inds.push({ a, b, gl, rw, g: gi, v: 0, i: 0, ieq: 0 });
      } else if (p.kind === "BJT") {
        const [col, base, em] = [a, b, c], pnp = !!p.pnp;
        const be = pnp ? port(em, base, 0) : port(base, em, 0), bc = pnp ? port(col, base, 0) : port(base, col, 0);
        junction(be, v[0], VT); junction(bc, v[0], VT);
        this.bjts.push({ be, bc, is: v[0], bf: v[1], br: v[2], leak: v[3] });
      } else if (p.kind === "JFET") {
        const [dr, gate, src] = [a, b, c], pch = !!p.p;
        const gs = pch ? diode(src, gate, 0, JUNCTION_IS, 1) : diode(gate, src, 0, JUNCTION_IS, 1);
        const ds = pch ? port(src, dr, 0) : port(dr, src, 0);
        this.jfets.push({ ds, gs, beta: v[0] / (v[1] * v[1]), vp: v[1], lambda: v[2] });
      } else if (p.kind === "Pot") {
        const [ohms, at, tp] = v, t = taper(tp, at);
        const r1 = moving(a, b, 1 / Math.max(ohms * t, 1)), r2 = moving(b, c, 1 / Math.max(ohms * (1 - t), 1));
        this.pots.push({ r1, r2, ohms, taper: tp, at, to: at });
      } else if (p.kind === "LDR") {
        const [dark, lit, rise, fall, lamp] = v;
        let led = -1;
        if (lamp > 0) { conductance(tr, c, d, 1 / lamp); conductance(dc, c, d, 1 / lamp); }
        else led = diode(c, d, 0, LED_IS, LED_N);
        const r = moving(a, b, 1 / Math.sqrt(dark * lit));
        this.ldrs.push({ r, led, la: c, lk: d, lamp, dark, lit, up: 1 - Math.exp(-T / rise), down: 1 - Math.exp(-T / fall), light: 0 });
      } else {
        const vd = port(a, b, 0), abc = diode(d, n, 0, JUNCTION_IS, 1), out = port(n, c, 0);
        this.otas.push({ vd, abc, out });
      }
    }
    const K = (this.K = this.pa.length);
    this.x = new Float64Array(m);
    this.out = node(net.output);
    // Invert the transient matrix once, column by column.
    const Ainv = (this.Ainv = new Float64Array(m * m)), A = new Float64Array(m * m), col = new Float64Array(m);
    for (let j = 0; j < n; j++) {
      A.set(tr); col.fill(0); col[j] = 1;
      if (!solve(A, col, n, m)) throw new Error("singular circuit: a node with no path to ground?");
      Ainv.set(col.subarray(0, n), j * m); // column j of A⁻¹
    }
    const W = (this.W = new Float64Array(m * K)), H = (this.H = new Float64Array(K * K));
    for (let k = 0; k < K; k++) for (let r = 0; r < n; r++) W[k * m + r] = Ainv[this.pa[k] * m + r] - Ainv[this.pb[k] * m + r];
    for (let j = 0; j < K; j++) for (let k = 0; k < K; k++) H[j * K + k] = W[k * m + this.pa[j]] - W[k * m + this.pb[j]];
    this.z = new Float64Array(m);
    this.v = new Float64Array(K); this.vNew = new Float64Array(K); this.iP = new Float64Array(K); this.p = new Float64Array(K);
    this.J = new Float64Array(K * K); this.F = new Float64Array(K); this.JF = new Float64Array(K * K); this.iNow = new Float64Array(K);
    // A step adds a column of A⁻¹ per source and history current, then K port currents back; each Newton iteration is about K³.
    this.flat = n * (1 + this.supplies.length + 2 * this.sources.length + 2 * this.caps.length + 2 * this.inds.length + this.hiss.length + K);
  }

  /**
   * The supply on `node` (a "V" part from it to ground) as an input of its own: its slot for `drive`, or −1.
   * A circuit with several inputs (a mixer's channels, a filter's control current) drives them this way.
   */
  supplyAt(node: string): number {
    const i = this.nodes.get(node);
    return i === undefined ? -1 : this.supplies.findIndex((s) => s.node === i);
  }
  /** Sets supply `slot` (from `supplyAt`) to `volts` from the next step on. */
  drive(slot: number, volts: number): void { this.supplies[slot].volts = volts; }
  /** The current source into `node` (an "I" part), for `push`, or −1. */
  sourceInto(node: string): number {
    const i = this.nodes.get(node);
    return i === undefined ? -1 : this.sources.findIndex((s) => s.b === i);
  }
  /** Sets current source `slot` (from `sourceInto`) to `amps` from the next step on. */
  push(slot: number, amps: number): void { this.sources[slot].amps = amps; }

  /**
   * Carries on where `old` left off: its capacitors' and inductors' charge, the junctions' voltages and the LDRs'
   * light. For the same netlist with other values (a pot moved, `fixPots`), so a rebuild doesn't click.
   * False, and nothing taken, when the two aren't the same circuit.
   */
  adopt(old: Circuit): boolean {
    if (old.size !== this.size || old.K !== this.K || old.caps.length !== this.caps.length || old.inds.length !== this.inds.length || old.ldrs.length !== this.ldrs.length) return false;
    this.caps.forEach((c, i) => { c.v = old.caps[i].v; c.i = old.caps[i].i; });
    this.inds.forEach((l, i) => { l.v = old.inds[i].v; l.i = old.inds[i].i; });
    this.ldrs.forEach((d, i) => { d.light = old.ldrs[i].light; });
    this.v.set(old.v); this.x.set(old.x); this.iNow.set(old.iNow);
    return true;
  }

  /** The voltage on a named node after the last step (0 for ground or a name not in the circuit). */
  volts(name: string): number {
    const i = this.nodes.get(name);
    return i === undefined ? 0 : this.x[i];
  }

  /** Each part's current out of its ports at port voltages `v` into `i`, and their slopes into `J` (K×K). */
  private currents(v: Float64Array, i: Float64Array, J: Float64Array): void {
    const K = this.K;
    for (const d of this.diodes) {
      const vd = v[d.port] - this.poff[d.port];
      const e = Math.exp(Math.min(vd / d.nvt, 80));
      i[d.port] = d.is * (e - 1);
      J[d.port * K + d.port] = (d.is * e) / d.nvt + GMIN;
    }
    for (const t of this.triodes) {
      const vpk = v[t.pk], vgk = v[t.gk], { mu: MU, ex: EX, kg1: KG1, kp: KP, kvb: KVB } = t;
      // Plate current, Koren: E1 = vpk/kp · softplus(kp(1/mu + vgk/sqrt(kvb + vpk²))), Ip = E1^ex / kg1.
      const s = Math.sqrt(KVB + vpk * vpk), u = KP * (1 / MU + vgk / s);
      // softplus and its slope (a sigmoid) from one exp (this loop is the hot spot: transcendentals, not matrices).
      const eu = u > 30 ? 0 : Math.exp(u);
      const L = u > 30 ? u : Math.log1p(eu), sg = u > 30 ? 1 : eu / (1 + eu), e1 = (vpk / KP) * L;
      let ip = 0, gm = 0, gp = 0;
      if (e1 > 0) {
        ip = Math.exp(EX * Math.log(e1)) / KG1;
        const dIp = (EX * ip) / e1;
        gm = dIp * ((vpk * sg) / s);
        gp = dIp * (L / KP - (vpk * vpk * vgk * sg) / (s * s * s));
      }
      i[t.pk] = ip;
      J[t.pk * K + t.pk] = gp + GMIN;
      J[t.pk * K + t.gk] = gm;
      // Grid current, Cohen & Helie: Ig = Gg · (softplus(Cg vgk)/Cg)^xi + Ig0. Below −1 V it's
      // under a picoamp, which is most of the time on a biased grid, so skip the math there.
      if (vgk < -1) {
        i[t.gk] = IG0;
        J[t.gk * K + t.gk] = GMIN;
      } else {
        const cv = CG * vgk, eg = Math.exp(cv), sp = (cv > 30 ? cv : Math.log1p(eg)) / CG, pw = Math.exp((XI - 1) * Math.log(sp));
        i[t.gk] = GG * pw * sp + IG0;
        J[t.gk * K + t.gk] = GG * XI * pw * (eg / (1 + eg)) + GMIN;
      }
    }
    for (const q of this.bjts) {
      // Ebers-Moll (transport): Ic = Is(ef − er) − Is/βr·(er − 1), Ib = Is/βf·(ef − 1) + Is/βr·(er − 1),
      // and germanium's leakage from collector to base, smooth through vbc = 0.
      const vbe = v[q.be], vbc = v[q.bc];
      const ef = Math.exp(Math.min(vbe / VT, 80)), er = Math.exp(Math.min(vbc / VT, 80));
      const gf = (q.is * ef) / VT, gr = (q.is * er) / VT, th = Math.tanh(vbc / VT);
      i[q.be] = q.is * (ef - er) + (q.is / q.bf) * (ef - 1);
      J[q.be * K + q.be] = gf * (1 + 1 / q.bf) + GMIN;
      J[q.be * K + q.bc] = -gr;
      i[q.bc] = (q.is / q.br) * (er - 1) - q.is * (ef - er) + q.leak * th;
      J[q.bc * K + q.be] = -gf;
      J[q.bc * K + q.bc] = gr * (1 + 1 / q.br) + (q.leak * (1 - th * th)) / VT + GMIN;
    }
    for (const f of this.jfets) {
      // Shichman-Hodges, β = Idss/Vp²: cut off below pinch-off, a resistor that the gate sets
      // while vds is under the overdrive (the triode region), then a current source. Symmetric:
      // with vds < 0 the drain and source swap.
      const vds = v[f.ds], vgs = v[f.gs], rev = vds < 0;
      const og = (rev ? vgs - vds : vgs) + f.vp, od = rev ? -vds : vds;
      let id = 0, dg = 0, dd = 0;
      if (og > 0) {
        const l = 1 + f.lambda * od;
        if (od < og) {
          const q = 2 * og * od - od * od;
          id = f.beta * q * l; dg = 2 * f.beta * od * l; dd = 2 * f.beta * (og - od) * l + f.beta * q * f.lambda;
        } else {
          id = f.beta * og * og * l; dg = 2 * f.beta * og * l; dd = f.beta * og * og * f.lambda;
        }
      }
      i[f.ds] = rev ? -id : id;
      J[f.ds * K + f.ds] = (rev ? dg + dd : dd) + GMIN;
      J[f.ds * K + f.gs] = rev ? -dg : dg;
    }
    for (const o of this.otas) {
      // The bias junction's current (computed with the diodes above) sets the transconductance.
      const ib = i[o.abc], iabc = ib > 0 ? ib : 0, th = Math.tanh(v[o.vd] / (2 * VT));
      i[o.vd] = 0;
      i[o.out] = iabc * th;
      J[o.out * K + o.vd] = (iabc * (1 - th * th)) / (2 * VT);
      J[o.out * K + o.abc] = ib > 0 ? J[o.abc * K + o.abc] * th : 0;
    }
    for (const r of this.vres) {
      const dg = r.g - r.g0;
      i[r.port] = dg * v[r.port];
      J[r.port * K + r.port] = dg;
    }
  }

  /** Junction limiting on the pn-junction ports: `v` is the new guess, `old` the last. */
  private limit(v: Float64Array, old: Float64Array): void {
    for (const d of this.junctions) {
      const off = this.poff[d.port];
      v[d.port] = pnjlim(v[d.port] - off, old[d.port] - off, d.nvt, d.vcrit) + off;
    }
  }

  /** The names `VarR` parts listen to. */
  get controls(): string[] { return [...this.ctlSlots.keys()]; }

  /** Control `name` (0 to 1) for the `VarR`s on it; a slot from `controlSlot` skips the lookup. */
  setCtl(name: string | number, value: number): void {
    const slot = typeof name === "number" ? name : this.ctlSlots.get(name);
    if (slot === undefined) return;
    for (const r of this.varRs) if (r.slot === slot) this.vres[r.r].g = Math.exp(-(r.lnHi + value * r.lnSpan));
  }

  /** A control's slot for `setCtl` in a hot loop (−1 if no part listens to it). */
  controlSlot(name: string): number { return this.ctlSlots.get(name) ?? -1; }

  /** Turns pot `i` (in netlist order) to `at`, 0 to 1. It glides there over about 10 ms. */
  setPot(i: number, at: number): void {
    const p = this.pots[i];
    if (p) p.to = Math.min(1, Math.max(0, at));
  }

  /** Moves each pot's resistances `share` of the way to where its knob is (1: all the way). */
  private turnPots(share: number): void {
    for (const p of this.pots) {
      if (p.at === p.to) continue;
      p.at += (p.to - p.at) * share;
      if (Math.abs(p.to - p.at) < 1e-6) p.at = p.to;
      const t = taper(p.taper, p.at);
      this.vres[p.r1].g = 1 / Math.max(p.ohms * t, 1);
      this.vres[p.r2].g = 1 / Math.max(p.ohms * (1 - t), 1);
    }
  }

  /** Each LDR's light `share` of the way to what its source gives now (null: up or down at its own pace). */
  private light(share: number | null): void {
    const { x, iNow } = this;
    for (const d of this.ldrs) {
      const amps = d.led >= 0 ? Math.max(0, iNow[d.led]) / LED_FULL : (x[d.la] - x[d.lk]) / d.lamp / LAMP_FULL;
      const target = d.led >= 0 ? amps : amps * amps; // a lamp glows with the power in its filament
      d.light += (target - d.light) * (share ?? (target > d.light ? d.up : d.down));
      this.vres[d.r].g = 1 / d.dark + Math.pow(d.light, LDR_GAMMA) / d.lit;
    }
  }

  /**
   * Finds the resting state with `vin` on the input: capacitors open, supplies
   * brought up in ten steps so the tubes find their bias, the whole matrix
   * solved each Newton iteration. Call once before audio; returns the output's volts.
   */
  settle(vin = 0): number {
    const { m, size: n, K, pa, pb, x, v, iP, J } = this;
    const A = new Float64Array(m * m), b = new Float64Array(m), old = new Float64Array(K);
    x.fill(0); v.fill(0);
    this.turnPots(1);
    for (const d of this.ldrs) { d.light = 0; this.vres[d.r].g = 1 / d.dark; }
    // With LDRs, one more pass at full supply: each pass lights them from the one before.
    const passes = this.ldrs.length ? 11 : 10;
    for (let s = 1; s <= passes; s++) {
      for (let it = 0; it < 200; it++) {
        A.set(this.baseDc); b.fill(0);
        b[this.inRow] = vin;
        for (const sp of this.supplies) b[sp.row] = (sp.volts * Math.min(s, 10)) / 10;
        for (const c of this.sources) { const i = (c.amps * Math.min(s, 10)) / 10; if (c.a < n) b[c.a] -= i; if (c.b < n) b[c.b] += i; }
        old.set(v);
        for (let k = 0; k < K; k++) v[k] = x[pa[k]] - x[pb[k]];
        if (it > 0) this.limit(v, old);
        J.fill(0);
        this.currents(v, iP, J);
        // Each port's current, linearized: i ≈ i0 + J(v − v0), stamped between its nodes.
        for (let j = 0; j < K; j++) {
          let rest = iP[j];
          for (let k = 0; k < K; k++) {
            const jk = J[j * K + k];
            if (jk === 0) continue;
            rest -= jk * v[k];
            A[pa[j] * m + pa[k]] += jk; A[pa[j] * m + pb[k]] -= jk; A[pb[j] * m + pa[k]] -= jk; A[pb[j] * m + pb[k]] += jk;
          }
          b[pa[j]] -= rest; b[pb[j]] += rest;
        }
        if (!solve(A, b, n, m)) throw new Error("singular circuit: a node with no path to ground?");
        let done = true;
        for (let i = 0; i < n; i++) {
          if (Math.abs(b[i] - x[i]) > 1e-9 + 1e-9 * Math.abs(b[i])) done = false;
          x[i] = b[i];
        }
        x[n] = 0;
        if (done) break;
      }
      if (this.ldrs.length) {
        for (let k = 0; k < K; k++) v[k] = x[pa[k]] - x[pb[k]];
        J.fill(0);
        this.currents(v, this.iNow, J);
        this.light(1);
      }
    }
    for (let k = 0; k < K; k++) v[k] = x[pa[k]] - x[pb[k]];
    for (const c of this.caps) { c.v = x[c.a] - x[c.b]; c.i = 0; }
    for (const l of this.inds) { l.v = x[l.a] - x[l.b]; l.i = l.v / l.rw; }
    return x[this.out];
  }

  /** z += column j of A⁻¹, times `val`. */
  private addCol(j: number, val: number): void {
    const { z, Ainv, size: n } = this, o = j * this.m;
    for (let r = 0; r < n; r++) z[r] += Ainv[o + r] * val;
  }

  /** One sample: `vin` volts on the input, the output's volts back. */
  step(vin: number): number {
    const { m, size: n, K, W, H, z, x, v, vNew, iP, J, F, JF, p, pa, pb } = this;
    // z = A⁻¹b: what the circuit would do if nothing bent. b is sparse, so add only its columns.
    z.fill(0);
    if (this.pots.length) this.turnPots(this.potGlide);
    this.addCol(this.inRow, vin);
    for (const s of this.supplies) this.addCol(s.row, s.volts);
    for (const c of this.sources) { if (c.a < n) this.addCol(c.a, -c.amps); if (c.b < n) this.addCol(c.b, c.amps); }
    for (const c of this.caps) {
      c.ieq = c.g * c.v + c.i;
      if (c.a < n) this.addCol(c.a, c.ieq);
      if (c.b < n) this.addCol(c.b, -c.ieq);
    }
    for (const l of this.inds) {
      // The inductor's history: i_n = g·v_n + ieq, ieq = (i + gl·(v − rw·i)) / (1 + rw·gl) from the last sample.
      l.ieq = (l.i + l.gl * (l.v - l.rw * l.i)) / (1 + l.rw * l.gl);
      if (l.a < n) this.addCol(l.a, -l.ieq);
      if (l.b < n) this.addCol(l.b, l.ieq);
    }
    if (this.noise > 0) for (const r of this.hiss) {
      const i = r.sigma * this.noise * this.gauss();
      if (r.a < n) this.addCol(r.a, i);
      if (r.b < n) this.addCol(r.b, -i);
    }
    x.set(z);
    if (K > 0) {
      // Port voltages must satisfy v = p − H·i(v), p = Vᵀz. Newton on that, from last sample's v.
      for (let k = 0; k < K; k++) p[k] = z[pa[k]] - z[pb[k]];
      let it = 0, converged = false;
      for (; it < 50 && !converged; it++) {
        J.fill(0);
        this.currents(v, iP, J);
        for (let j = 0; j < K; j++) {
          let f = v[j] - p[j];
          for (let k = 0; k < K; k++) {
            f += H[j * K + k] * iP[k];
            let s = j === k ? 1 : 0;
            for (let l = 0; l < K; l++) s += H[j * K + l] * J[l * K + k];
            JF[j * K + k] = s;
          }
          F[j] = -f;
        }
        if (!solve(JF, F, K, K)) break;
        converged = true;
        for (let k = 0; k < K; k++) {
          vNew[k] = v[k] + F[k];
          if (Math.abs(F[k]) > 1e-7 + 1e-7 * Math.abs(v[k])) converged = false;
        }
        this.limit(vNew, v);
        v.set(vNew);
      }
      this.iterations += it;
      this.work += this.flat + it * K * K * (K + 1);
      if (!converged) { this.misses++; J.fill(0); this.currents(v, iP, J); F.fill(0); }
      // The currents at the final v: the last evaluation plus its slope times the last (tiny) step.
      for (let k = 0; k < K; k++) {
        let ik = iP[k];
        for (let l = 0; l < K; l++) ik += J[k * K + l] * F[l];
        this.iNow[k] = ik;
        const o = k * m;
        for (let r = 0; r < n; r++) x[r] -= W[o + r] * ik;
      }
    } else {
      this.iterations++;
      this.work += this.flat;
    }
    for (const c of this.caps) { c.v = x[c.a] - x[c.b]; c.i = c.g * c.v - c.ieq; }
    for (const l of this.inds) { l.v = x[l.a] - x[l.b]; l.i = l.g * l.v + l.ieq; }
    if (this.ldrs.length) this.light(null);
    return x[this.out];
  }
}
