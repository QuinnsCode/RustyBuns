// A circuit simulator for audio: modified nodal analysis (MNA), capacitors as
// trapezoidal companions, Newton-Raphson every sample for the parts that bend
// (diodes, triodes, op-amps at their rails).
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
// Sources: Ho, Ruehli & Brennan (1975) for MNA; Nagel's SPICE2 thesis (1975)
// for the junction limiting (pnjlim); Koren (1996) for the triode plate
// current; Cohen & Helie (2010) for the triode grid current.

/** One part. Node names are free text; "gnd" (or "GND", "0") is ground. */
export type Part =
  /** A resistor. With `noisy`, it hisses: its thermal (Johnson) noise, scaled by the circuit's `noise`. */
  | { kind: "R"; a: string; b: string; ohms: number; noisy?: boolean }
  | { kind: "C"; a: string; b: string; farads: number }
  /** A DC supply, + at `a`. */
  | { kind: "V"; a: string; b: string; volts: number }
  /** A diode, anode `a`, cathode `k`. Defaults are a 1N4148-ish silicon diode. */
  | { kind: "D"; a: string; k: string; is?: number; n?: number }
  /** An op-amp (TL072-ish gain and bandwidth) with its output swinging about ±`rail` volts around ground. */
  | { kind: "Opamp"; plus: string; minus: string; out: string; rail?: number }
  /** A 12AX7 triode: plate, grid, cathode. */
  | { kind: "Triode"; p: string; g: string; k: string };

/** A circuit with one input (driven by an ideal voltage source) and one output node. */
export interface Netlist { parts: Part[]; input: string; output: string }

const GROUND = new Set(["gnd", "GND", "0"]);
const VT = 0.02585; // thermal voltage at room temperature
const GMIN = 1e-12; // a whisper of conductance from every node to ground, so no node floats
// Op-amp: a TL072-ish open-loop gain and gain-bandwidth, and its hidden node's resistance.
const OPAMP_A0 = 2e5, OPAMP_GBW = 3e6, OPAMP_R0 = 1e6;
// 12AX7 (Koren): amplification, exponent, and fitted constants.
const MU = 100, EX = 1.4, KG1 = 1060, KP = 600, KVB = 300;
// Grid current (Cohen & Helie).
const GG = 6.062e-4, CG = 13.9, XI = 1.354, IG0 = 3.917e-8;


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
  private m: number;
  private nodes = new Map<string, number>();
  private baseDc: Float64Array;
  private x: Float64Array;
  private out: number;
  private inRow: number;
  private supplies: { row: number; volts: number }[] = [];
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
  private diodes: { port: number; is: number; nvt: number; vcrit: number }[] = [];
  private triodes: { pk: number; gk: number }[] = [];
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
    for (const p of net.parts) {
      if (p.kind === "R" || p.kind === "C" || p.kind === "V") { node(p.a); node(p.b); }
      else if (p.kind === "D") { node(p.a); node(p.k); }
      else if (p.kind === "Opamp") { node(p.plus); node(p.minus); node(p.out); node(`~${opamps++}`); }
      else { node(p.p); node(p.g); node(p.k); }
    }
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
    /** A diode whose voltage is read `off` volts below a−k: with k at ground, a clamp at `off`. */
    const diode = (a: number, k: number, off: number, is = 2.52e-9, nf = 1.752) => {
      const nvt = nf * VT;
      this.diodes.push({ port: port(a, k, off), is, nvt, vcrit: nvt * Math.log(nvt / (Math.SQRT2 * is)) });
    };
    const T = 1 / sampleRate;
    this.inRow = source(g(node(net.input)), n);
    opamps = 0;
    for (const p of net.parts) {
      if (p.kind === "R") {
        const a = g(node(p.a)), b = g(node(p.b));
        conductance(tr, a, b, 1 / p.ohms); conductance(dc, a, b, 1 / p.ohms);
        // Johnson noise as a current beside the resistor: sqrt(4kT/R · bandwidth), bandwidth = half the rate.
        if (p.noisy) this.hiss.push({ a, b, sigma: Math.sqrt(((4 * 1.380649e-23 * 300) / p.ohms) * (sampleRate / 2)) });
      } else if (p.kind === "C") {
        const a = g(node(p.a)), b = g(node(p.b)), gc = (2 * p.farads) / T;
        conductance(tr, a, b, gc); // open at DC: the dc matrix leaves it out
        this.caps.push({ a, b, g: gc, v: 0, i: 0, ieq: 0 });
      } else if (p.kind === "V") {
        this.supplies.push({ row: source(g(node(p.a)), g(node(p.b))), volts: p.volts });
      } else if (p.kind === "D") {
        diode(g(node(p.a)), g(node(p.k)), 0, p.is, p.n);
      } else if (p.kind === "Opamp") {
        // Input stage: gm·(v+ − v−) into a hidden node with R0 and C0 to ground
        // (open-loop gain A0 = gm·R0, one pole at GBW/A0). Two diodes clamp it near
        // the rails. Output: a unity buffer of the hidden node. A finite bandwidth
        // is also what keeps Newton calm: an ideal op-amp with a hard rail bounces.
        const hid = g(node(`~${opamps++}`)), plus = g(node(p.plus)), minus = g(node(p.minus)), out = g(node(p.out));
        const gm = OPAMP_A0 / OPAMP_R0, c0 = OPAMP_A0 / (2 * Math.PI * OPAMP_GBW * OPAMP_R0);
        both(hid, plus, -gm); both(hid, minus, gm);
        conductance(tr, hid, n, 1 / OPAMP_R0 + (2 * c0) / T); conductance(dc, hid, n, 1 / OPAMP_R0);
        this.caps.push({ a: hid, b: n, g: (2 * c0) / T, v: 0, i: 0, ieq: 0 });
        const vr = (p.rail ?? 4) - 0.5;
        diode(hid, n, vr); diode(n, hid, vr);
        const j = row++;
        both(out, j, 1); both(j, out, 1); both(j, hid, -1);
      } else {
        const p_ = g(node(p.p)), g_ = g(node(p.g)), k = g(node(p.k));
        this.triodes.push({ pk: port(p_, k, 0), gk: port(g_, k, 0) });
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
    this.J = new Float64Array(K * K); this.F = new Float64Array(K); this.JF = new Float64Array(K * K);
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
      const vpk = v[t.pk], vgk = v[t.gk];
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
  }

  /** Junction limiting on the diode ports: `v` is the new guess, `old` the last. */
  private limit(v: Float64Array, old: Float64Array): void {
    for (const d of this.diodes) {
      const off = this.poff[d.port];
      v[d.port] = pnjlim(v[d.port] - off, old[d.port] - off, d.nvt, d.vcrit) + off;
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
    for (let s = 1; s <= 10; s++) {
      for (let it = 0; it < 200; it++) {
        A.set(this.baseDc); b.fill(0);
        b[this.inRow] = vin;
        for (const sp of this.supplies) b[sp.row] = (sp.volts * s) / 10;
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
    }
    for (let k = 0; k < K; k++) v[k] = x[pa[k]] - x[pb[k]];
    for (const c of this.caps) { c.v = x[c.a] - x[c.b]; c.i = 0; }
    return x[this.out];
  }

  /** z += column j of A⁻¹, times `val`. */
  private addCol(j: number, val: number): void {
    const { z, Ainv, size: n } = this, o = j * this.m;
    for (let r = 0; r < n; r++) z[r] += Ainv[o + r] * val;
  }

  /** One sample: `vin` volts on the input, the output's volts back. */
  step(vin: number): number {
    const { m, size: n, K, Ainv, W, H, z, x, v, vNew, iP, J, F, JF, p, pa, pb } = this;
    // z = A⁻¹b: what the circuit would do if nothing bent. b is sparse, so add only its columns.
    z.fill(0);
    this.addCol(this.inRow, vin);
    for (const s of this.supplies) this.addCol(s.row, s.volts);
    for (const c of this.caps) {
      c.ieq = c.g * c.v + c.i;
      if (c.a < n) this.addCol(c.a, c.ieq);
      if (c.b < n) this.addCol(c.b, -c.ieq);
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
      if (!converged) { this.misses++; J.fill(0); this.currents(v, iP, J); F.fill(0); }
      // The currents at the final v: the last evaluation plus its slope times the last (tiny) step.
      for (let k = 0; k < K; k++) {
        let ik = iP[k];
        for (let l = 0; l < K; l++) ik += J[k * K + l] * F[l];
        const o = k * m;
        for (let r = 0; r < n; r++) x[r] -= W[o + r] * ik;
      }
    } else {
      this.iterations++;
    }
    for (const c of this.caps) { c.v = x[c.a] - x[c.b]; c.i = c.g * c.v - c.ieq; }
    return x[this.out];
  }
}
