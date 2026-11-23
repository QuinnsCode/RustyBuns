// What a linear circuit does to the volts on its inputs, worked out once from its netlist: nodal analysis on the
// resistors, the pots where they stand, the supplies and ideal op-amps (the inputs equal, no current in), with every
// capacitor open. Each output's voltage is then `gain · inputs + offset`. A mixer that is all resistors and op-amps
// mixes with exactly that (FM DAW's sound wall does), and a summer's output (a knob and a CV into an op-amp, onto an
// exponential converter's base) reads its control voltage off it, no sample-by-sample solve needed. A part that bends
// (a diode, a transistor, an OTA) isn't linear, and is refused by name.
import { potShare, type Netlist, type Part } from "./mna.ts";

const GROUND = new Set(["gnd", "GND", "0"]);
type Linear = Extract<Part, { kind: "R" | "Pot" | "V" | "I" | "Opamp" }>;
const isLinear = (p: Part): p is Linear => p.kind === "R" || p.kind === "Pot" || p.kind === "V" || p.kind === "I" || p.kind === "Opamp";

/** Each output's voltage as `gain[o][i] · inputs[i] + offset[o]`. */
export interface Gains { inputs: string[]; outputs: string[]; gain: number[][]; offset: number[] }

/** Solves A x = B for several right-hand sides at once (A is n×n, B n×k, both row-major), in place; B becomes x. */
function solveMany(A: Float64Array, B: Float64Array, n: number, k: number): void {
  for (let c = 0; c < n; c++) {
    let p = c, best = Math.abs(A[c * n + c]);
    for (let r = c + 1; r < n; r++) { const v = Math.abs(A[r * n + c]); if (v > best) { best = v; p = r; } }
    if (best < 1e-300) throw new Error("singular: a node with no path to ground, or an op-amp with no feedback");
    if (p !== c) {
      for (let j = 0; j < n; j++) { const t = A[c * n + j]; A[c * n + j] = A[p * n + j]; A[p * n + j] = t; }
      for (let j = 0; j < k; j++) { const t = B[c * k + j]; B[c * k + j] = B[p * k + j]; B[p * k + j] = t; }
    }
    for (let r = c + 1; r < n; r++) {
      const f = A[r * n + c] / A[c * n + c];
      if (f === 0) continue;
      for (let j = c; j < n; j++) A[r * n + j] -= f * A[c * n + j];
      for (let j = 0; j < k; j++) B[r * k + j] -= f * B[c * k + j];
    }
  }
  for (let r = n - 1; r >= 0; r--) for (let j = 0; j < k; j++) {
    let s = B[r * k + j];
    for (let c = r + 1; c < n; c++) s -= A[r * n + c] * B[c * k + j];
    B[r * k + j] = s / A[r * n + r];
  }
}

/**
 * The gains from `inputs` (nodes driven by ideal sources) to `outputs` (nodes read), and the offsets the supplies
 * give. An input or output that isn't on any part reads as a gain of 0. Throws on a part that isn't linear.
 */
export function gains(net: Pick<Netlist, "parts">, inputs: string[], outputs: string[]): Gains {
  const nodes = new Map<string, number>();
  const node = (name: string) => { if (GROUND.has(name)) return -1; let i = nodes.get(name); if (i === undefined) nodes.set(name, (i = nodes.size)); return i; };
  const parts: Linear[] = [];
  for (const p of net.parts) {
    if (p.kind === "C") continue;
    if (!isLinear(p)) throw new Error(`a ${p.kind} isn't linear: this solve takes resistors, pots, supplies and op-amps`);
    parts.push(p);
  }
  for (const p of parts) {
    if (p.kind === "Opamp") { node(p.plus); node(p.minus); node(p.out); }
    else if (p.kind === "Pot") { node(p.a); node(p.w); node(p.b); }
    else { node(p.a); node(p.b); }
  }
  const driven = inputs.filter((i) => nodes.has(i));
  const branches = parts.filter((p) => p.kind === "V" || p.kind === "Opamp").length + driven.length;
  const N = nodes.size, n = N + branches, k = inputs.length + 1;
  const A = new Float64Array(n * n), B = new Float64Array(n * k);
  const add = (r: number, c: number, v: number) => { if (r >= 0 && c >= 0) A[r * n + c] += v; };
  const conduct = (a: number, b: number, g: number) => { add(a, a, g); add(b, b, g); add(a, b, -g); add(b, a, -g); };
  for (let i = 0; i < N; i++) add(i, i, 1e-12);
  let row = N;
  /** A source holding node a at node b plus whatever its right-hand side says. */
  const source = (a: number, b: number) => { const j = row++; add(a, j, 1); add(b, j, -1); add(j, a, 1); add(j, b, -1); return j; };
  for (const p of parts) {
    if (p.kind === "R") conduct(node(p.a), node(p.b), 1 / p.ohms);
    else if (p.kind === "Pot") {
      const t = potShare(p);
      conduct(node(p.a), node(p.w), 1 / Math.max(p.ohms * t, 1e-3));
      conduct(node(p.w), node(p.b), 1 / Math.max(p.ohms * (1 - t), 1e-3));
    } else if (p.kind === "V") B[source(node(p.a), node(p.b)) * k + inputs.length] = p.volts;
    else if (p.kind === "I") {
      const a = node(p.a), b = node(p.b);
      if (a >= 0) B[a * k + inputs.length] -= p.amps;
      if (b >= 0) B[b * k + inputs.length] += p.amps;
    } else if (p.kind === "Opamp") {
      // Ideal: its output's current is whatever it takes (column j at the output node), and its row says v+ = v−.
      const j = row++, out = node(p.out);
      add(out, j, 1);
      add(j, node(p.plus), 1); add(j, node(p.minus), -1);
    }
  }
  for (const name of driven) B[source(node(name), -1) * k + inputs.indexOf(name)] = 1;
  solveMany(A, B, n, k);
  const read = (o: string, j: number) => { const i = nodes.get(o); return i === undefined ? 0 : B[i * k + j]; };
  return {
    inputs, outputs,
    gain: outputs.map((o) => inputs.map((_, j) => read(o, j))),
    offset: outputs.map((o) => read(o, inputs.length)),
  };
}
