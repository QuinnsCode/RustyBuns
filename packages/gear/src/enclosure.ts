// Speaker boxes from their build plans: the driver's Thiele-Small numbers, the box it goes in (sealed, vented or a
// quarter-wave pipe), the cut list it is built from, and what the walls do. The same plan is the 3D model
// (`cabinet` in @rustybuns/models/speaker) and the sound: `boxCurve` is the response in dB, `BoxFilter` plays audio
// through it, and FM DAW's Rust engine (native/crates/fm_daw/src/enclosure.rs) runs the same math from `encodePlan`.
//
// The low end is the textbook models: a sealed box is a 2nd-order high-pass at fc and Qtc, a vented box Small's
// 4th-order high-pass with leakage QL (1973), a pipe the driver on an open back plus the mouth's quarter-wave peaks.
// The walls: each panel is a simply supported plate whose (1,1) mode is driven by the box's inside pressure, so its
// output against the cone's is 0.656 A rho c^2 / (eta w^2 m Vb) at resonance, a band-pass of Q 1/eta, out of phase
// with the cone. Bracing cuts the long span. Typical material numbers, not measured ones (`MATERIALS`).

/** Air at 20 C: speed of sound (m/s) and density (kg/m3). */
export const AIR = { c: 343, rho: 1.204 } as const;

/** A driver's small-signal numbers. Lengths in metres, volumes in m3, area in m2. */
export interface Driver {
  id: string;
  name: string;
  /** Free-air resonance, Hz. */
  fs: number;
  qts: number;
  /** Air volume with the same compliance as the suspension, m3. */
  vas: number;
  /** Cone area, m2. */
  sd: number;
  /** One-way linear excursion, m. */
  xmax: number;
  /** DC resistance, ohms. */
  re: number;
  /** dB SPL at 2.83 V, 1 m. */
  sens: number;
  /** Outer diameter of the frame, m (the hole is cut a little smaller: `cutout`). */
  dia: number;
  cutout: number;
  /** Where its numbers come from. */
  from: string;
}

export interface Material {
  id: string;
  name: string;
  /** kg/m3. */
  density: number;
  /** Young's modulus, Pa. */
  e: number;
  poisson: number;
  /** Loss factor: how fast a wall stops ringing (Q = 1 / eta). */
  eta: number;
  /** A colour for the model, hex. */
  color: number;
}

/** Typical numbers for the sheet goods boxes are built from. Wood varies board to board; these are middles. */
export const MATERIALS: readonly Material[] = [
  { id: "mdf", name: "MDF", density: 750, e: 4.0e9, poisson: 0.25, eta: 0.03, color: 0xb08a62 },
  { id: "birch-ply", name: "Baltic birch plywood", density: 680, e: 7.0e9, poisson: 0.3, eta: 0.015, color: 0xe2c896 },
  { id: "particleboard", name: "Particleboard", density: 650, e: 3.0e9, poisson: 0.25, eta: 0.03, color: 0xc7a77c },
  { id: "pine", name: "Solid pine", density: 500, e: 9.0e9, poisson: 0.35, eta: 0.01, color: 0xe8c07a },
  { id: "hdf", name: "HDF", density: 900, e: 5.0e9, poisson: 0.25, eta: 0.025, color: 0x6b4a2f },
  { id: "acrylic", name: "Acrylic", density: 1190, e: 3.2e9, poisson: 0.37, eta: 0.03, color: 0xcfe8ef },
  { id: "aluminium", name: "Aluminium plate", density: 2700, e: 69e9, poisson: 0.33, eta: 0.0005, color: 0xb9bec4 },
  { id: "concrete", name: "Cast concrete", density: 2300, e: 30e9, poisson: 0.2, eta: 0.01, color: 0x9a9893 },
  { id: "damped-mdf", name: "MDF, two layers with damping glue", density: 760, e: 4.0e9, poisson: 0.25, eta: 0.15, color: 0x8c6a48 },
];

export function material(id: string): Material {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`no material ${id}`);
  return m;
}

/** A sealed box, a vented box with its ports, or a folded quarter-wave pipe and its mouth. */
export type Alignment =
  | { kind: "sealed" }
  | { kind: "vented"; ports: { dia: number; length: number; count: number } }
  | { kind: "pipe"; length: number; mouth: number; lining: number };

/** One driver on the front baffle, its centre from the baffle's bottom-left corner (outside), m. */
export interface Mount {
  driver: Driver;
  at: [number, number];
  /** A tweeter or other driver the low-end math leaves out (the crossover hands it the top). */
  top?: boolean;
}

/** One build plan: outside sizes, wall thickness and material, what is mounted, and how the box loads the woofer. */
export interface Plan {
  id: string;
  name: string;
  what: string;
  /** Outside width, height, depth, m. */
  size: [number, number, number];
  /** Wall thickness, m. */
  wall: number;
  material: string;
  drivers: Mount[];
  alignment: Alignment;
  /** Braces across each pair of walls: each one splits that wall's long span. */
  braces: number;
  /** A vent's centre on the baffle (vented) or the mouth's on the back (pipe), from the bottom-left, m. */
  opening?: [number, number];
  /** What the plan is built from, and what we changed. */
  from: string;
}

/** The low-end woofer: the first driver that is not a top. */
export const woofer = (p: Plan): Driver => (p.drivers.find((m) => !m.top) ?? p.drivers[0]).driver;

/** Inside air: the inner box less the drivers, the port tubes and the braces (each about 2% of the air). Pipe plans count the pipe. */
export function netVolume(p: Plan): number {
  const [w, h, d] = p.size, t = p.wall;
  let v = (w - 2 * t) * (h - 2 * t) * (d - 2 * t);
  // A driver takes about 0.18 of its cone area times its diameter (basket and magnet); a dome tweeter next to nothing.
  for (const m of p.drivers) v -= m.top ? 0.0001 : 0.18 * m.driver.sd * m.driver.dia;
  const a = p.alignment;
  if (a.kind === "vented") v -= a.ports.count * Math.PI * (a.ports.dia / 2 + 0.003) ** 2 * a.ports.length;
  v *= 1 - 0.02 * p.braces;
  return v;
}

/** A vent's tuning: the port's air mass on the box's air spring, ends corrected by 0.732 of a diameter (one flanged end, one free). */
export function portTuning(vb: number, dia: number, length: number, count = 1): number {
  const sp = count * Math.PI * (dia / 2) ** 2, leff = length + 0.732 * dia;
  return (AIR.c / (2 * Math.PI)) * Math.sqrt(sp / (vb * leff));
}

/** The port length that tunes `vb` to `fb` (the inverse of `portTuning`). */
export function portLength(vb: number, fb: number, dia: number, count = 1): number {
  const sp = count * Math.PI * (dia / 2) ** 2;
  return sp * (AIR.c / (2 * Math.PI * fb)) ** 2 / vb - 0.732 * dia;
}

/** Peak air speed in the port at its tuning with the cone at Xmax, m/s. Over about 17 m/s (5% of c) a port chuffs. */
export function portSpeed(d: Driver, fb: number, dia: number, count = 1): number {
  return (d.sd * d.xmax * 2 * Math.PI * fb) / (count * Math.PI * (dia / 2) ** 2);
}

/** A sealed box's Q and resonance: the box's air stiffens the suspension by 1 + Vas / Vb. */
export function sealed(d: Driver, vb: number): { qtc: number; fc: number; f3: number } {
  const r = Math.sqrt(1 + d.vas / vb), qtc = d.qts * r, fc = d.fs * r;
  const q2 = 1 / (qtc * qtc);
  // |H|^2 = x^2 / ((1 - x)^2 + x / Q^2) = 1/2 with x = (f3 / fc)^2: x^2 + (2 - 1/Q^2) x - 1 = 0.
  const a = (2 - q2) / 2, x = -a + Math.sqrt(a * a + 1);
  return { qtc, fc, f3: fc * Math.sqrt(x) };
}

/** A quarter-wave pipe's first resonance: c / 4L with the mouth's end correction (0.6 of its equivalent radius). */
export function pipeTuning(length: number, mouth: number): number {
  return AIR.c / (4 * (length + 0.6 * Math.sqrt(mouth / Math.PI)));
}

/** One wall: its free spans inside the box, m. */
export interface Panel {
  id: string;
  a: number;
  b: number;
}

/** The six walls' free spans, the long span of each cut by the braces. Front and back, the two sides, top and bottom. */
export function panels(p: Plan): Panel[] {
  const [w, h, d] = p.size, t = p.wall;
  const iw = w - 2 * t, ih = h - 2 * t, id = d - 2 * t, n = p.braces + 1;
  const cut = (a: number, b: number): [number, number] => (a >= b ? [a / n, b] : [a, b / n]);
  const rows: [string, number, number][] = [["front", iw, ih], ["back", iw, ih], ["left", id, ih], ["right", id, ih], ["top", iw, id], ["bottom", iw, id]];
  return rows.map(([id, a, b]) => { const [x, y] = cut(a, b); return { id, a: x, b: y }; });
}

/** A wall's (1,1) mode, Hz: f = (pi/2) sqrt(D / (rho h)) (1/a^2 + 1/b^2), D = E h^3 / 12 (1 - nu^2). */
export function panelMode(m: Material, h: number, a: number, b: number): number {
  const dRig = (m.e * h ** 3) / (12 * (1 - m.poisson ** 2));
  return (Math.PI / 2) * Math.sqrt(dRig / (m.density * h)) * (1 / (a * a) + 1 / (b * b));
}

/** Mass law: how many dB a wall of surface mass `m` (kg/m2) holds back at `f` Hz, above its own resonance. */
export const massLaw = (surfaceMass: number, f: number): number => 20 * Math.log10(f * surfaceMass) - 47;

/** How long a wall rings after it is struck: T60 = 2.2 / (eta f), seconds. */
export const ringTime = (m: Material, f: number): number => 2.2 / (m.eta * f);

/** What a wall sends out at its (1,1) mode against the cone, as a pressure ratio: 0.656 A rho c^2 / (eta w^2 m Vb). */
export function panelLeak(m: Material, h: number, a: number, b: number, vb: number): number {
  const f = panelMode(m, h, a, b), w = 2 * Math.PI * f;
  return (0.656 * a * b * AIR.rho * AIR.c ** 2) / (m.eta * w * w * m.density * h * vb);
}

/** An analog section: (b2 s^2 + b1 s + b0) / (s^2 + a1 s + a0). */
export interface Section {
  b2: number;
  b1: number;
  b0: number;
  a1: number;
  a0: number;
}

/** What the plan does, ready to hear: the woofer's sections in series, and each wall's band-pass to take away. */
export interface Design {
  series: Section[];
  walls: { id: string; hz: number; leak: number; q: number; ring: number }[];
  vb: number;
  /** The box's tuning: fc sealed, fb vented, the pipe's first mode. */
  tune: number;
  /** Sealed Qtc, or the driver's Qts. */
  q: number;
  /** Where the vent's air goes too fast (> 17 m/s at Xmax), m/s, or 0. */
  portSpeed: number;
}

/** A plan's physics as plain numbers, in the order the Rust port reads them. */
export function encodePlan(p: Plan): Float64Array {
  const d = woofer(p), m = material(p.material), a = p.alignment, vb = netVolume(p);
  const kind = a.kind === "sealed" ? 0 : a.kind === "vented" ? 1 : 2;
  const tune = a.kind === "vented" ? portTuning(vb, a.ports.dia, a.ports.length, a.ports.count) : a.kind === "pipe" ? pipeTuning(a.length, a.mouth) : 0;
  const lining = a.kind === "pipe" ? a.lining : 0;
  const walls = panels(p);
  const head = [kind, d.fs, d.qts, d.vas, vb, tune, lining, m.density, m.e, m.poisson, m.eta, p.wall, walls.length];
  return Float64Array.from([...head, ...walls.flatMap((w) => [w.a, w.b])]);
}

/** Leakage of a vented box: a QL of 7 is a well-built box with a little lining. */
const QL = 7;

/** Roots of a monic polynomial (coefficients highest power first, leading 1 left out) by Durand-Kerner. */
function roots(c: number[]): [number, number][] {
  const n = c.length;
  const z: [number, number][] = Array.from({ length: n }, (_, k) => {
    const r = 0.9, t = (2 * Math.PI * k) / n + 0.4;
    return [r * Math.cos(t), r * Math.sin(t)];
  });
  const evalAt = ([x, y]: [number, number]): [number, number] => {
    let re = 1, im = 0;
    for (const k of c) { const nr = re * x - im * y + k, ni = re * y + im * x; re = nr; im = ni; }
    return [re, im];
  };
  for (let it = 0; it < 500; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let dr = 1, di = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const ar = z[i][0] - z[j][0], ai = z[i][1] - z[j][1], nr = dr * ar - di * ai, ni = dr * ai + di * ar;
        dr = nr; di = ni;
      }
      const [pr, pi] = evalAt(z[i]), den = dr * dr + di * di;
      const qr = (pr * dr + pi * di) / den, qi = (pi * dr - pr * di) / den;
      z[i] = [z[i][0] - qr, z[i][1] - qi];
      moved = Math.max(moved, Math.abs(qr) + Math.abs(qi));
    }
    if (moved < 1e-14) break;
  }
  return z;
}

/** Splits a 4th-order high-pass denominator into two high-pass sections: each root with its conjugate. */
function quarticSections(c: [number, number, number, number], w0: number): Section[] {
  const z = roots(c).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  // Sorted by imaginary part: the two negative ones first, so pair each with its mirror across the real axis.
  const pairs: [number, number][][] = [[z[0], z[3]], [z[1], z[2]]];
  return pairs.map(([p, q]) => {
    // (s - p)(s - q) with s in units of w0: s^2 - (p + q) s + p q, real when they are conjugates (or both real).
    const sum = p[0] + q[0], prod = p[0] * q[0] - p[1] * q[1];
    return { b2: 1, b1: 0, b0: 0, a1: -sum * w0, a0: prod * w0 * w0 };
  });
}

/** A plan's sections and walls from its encoded numbers (`encodePlan`): the Rust port reads the same array. */
export function designFrom(x: Float64Array): Design {
  const [kind, fs, qts, vas, vb, tune0, lining, density, e, poisson, eta, h, n] = x;
  const ws = 2 * Math.PI * fs;
  let series: Section[], tune = tune0, q = qts, speed = 0;
  if (kind === 0) {
    const r = Math.sqrt(1 + vas / vb), wc = ws * r;
    q = qts * r; tune = fs * r;
    series = [{ b2: 1, b1: 0, b0: 0, a1: wc / q, a0: wc * wc }];
  } else if (kind === 1) {
    const hh = tune0 / fs, al = vas / vb, sh = Math.sqrt(hh), w0 = Math.sqrt(ws * 2 * Math.PI * tune0);
    const a1 = (QL + hh * qts) / (sh * QL * qts), a2 = (hh + (al + 1 + hh * hh) * qts * QL) / (hh * qts * QL), a3 = (hh * QL + qts) / (sh * QL * qts);
    series = quarticSections([a1, a2, a3, 1], w0);
  } else {
    // The driver's back wave leaves by the mouth, a quarter wavelength late, so it adds near each odd mode. Lining (0..1) tames them.
    const wp = 2 * Math.PI * tune0, peaks: Section[] = [];
    for (let k = 0; k < 3; k++) {
      const w = wp * (2 * k + 1), gain = (10 / (2 * k + 1)) * (1 - lining), aa = 10 ** (gain / 40), qq = 1.4 + 1.8 * k;
      peaks.push({ b2: 1, b1: (aa * w) / qq, b0: w * w, a1: w / (aa * qq), a0: w * w });
    }
    series = [{ b2: 1, b1: 0, b0: 0, a1: ws / qts, a0: ws * ws }, ...peaks];
  }
  const m: Material = { id: "", name: "", density, e, poisson, eta, color: 0 };
  const walls: Design["walls"] = [];
  const names = ["front", "back", "left", "right", "top", "bottom"];
  for (let i = 0; i < n; i++) {
    const a = x[13 + 2 * i], b = x[14 + 2 * i], hz = panelMode(m, h, a, b);
    walls.push({ id: names[i] ?? `wall-${i}`, hz, leak: panelLeak(m, h, a, b, vb), q: 1 / eta, ring: ringTime(m, hz) });
  }
  return { series, walls, vb, tune, q, portSpeed: speed };
}

/** A plan's design, and whether its vent chuffs. */
export function design(p: Plan): Design {
  const d = designFrom(encodePlan(p)), a = p.alignment;
  if (a.kind === "vented") d.portSpeed = portSpeed(woofer(p), d.tune, a.ports.dia, a.ports.count);
  return d;
}

/** One section's complex gain at w rad/s. */
function at(s: Section, w: number): [number, number] {
  const nr = s.b0 - s.b2 * w * w, ni = s.b1 * w, dr = s.a0 - w * w, di = s.a1 * w, den = dr * dr + di * di;
  return [(nr * dr + ni * di) / den, (ni * dr - nr * di) / den];
}

/** The box's response in dB at each frequency: the sections in series, times one less the walls' band-passes. */
export function curveOf(d: Design, freqs: ArrayLike<number>): Float64Array {
  const out = new Float64Array(freqs.length);
  for (let i = 0; i < freqs.length; i++) {
    const w = 2 * Math.PI * freqs[i];
    let re = 1, im = 0;
    for (const s of d.series) { const [a, b] = at(s, w); const nr = re * a - im * b; im = re * b + im * a; re = nr; }
    let wr = 1, wi = 0;
    for (const p of d.walls) {
      const w0 = 2 * Math.PI * p.hz, [a, b] = at({ b2: 0, b1: w0 / p.q, b0: 0, a1: w0 / p.q, a0: w0 * w0 }, w);
      wr -= p.leak * a; wi -= p.leak * b;
    }
    const tr = re * wr - im * wi, ti = re * wi + im * wr;
    out[i] = 10 * Math.log10(tr * tr + ti * ti + 1e-30);
  }
  return out;
}

/** `curveOf(design(p), freqs)`. */
export const boxCurve = (p: Plan, freqs: ArrayLike<number>): Float64Array => curveOf(design(p), freqs);

/** Log-spaced frequencies, `n` of them from `lo` to `hi` Hz. */
export const logFreqs = (lo: number, hi: number, n: number): Float64Array =>
  Float64Array.from({ length: n }, (_, i) => lo * (hi / lo) ** (i / (n - 1)));

/** The frequency where the curve first rises to `db` (default -3) below its level at 1 kHz walls aside, from below. */
export function lowCut(d: Design, db = -3): number {
  const f = logFreqs(5, 1000, 600), c = curveOf({ ...d, walls: [] }, f), ref = c[c.length - 1];
  for (let i = 0; i < f.length; i++) if (c[i] - ref >= db) return f[i];
  return f[f.length - 1];
}

/** A digital biquad: b0..b2 over 1, a1, a2. */
type Biquad = [number, number, number, number, number];

/** The bilinear transform of an analog section, warped to land true at its own natural frequency. */
export function bilinear(s: Section, sr: number): Biquad {
  const w0 = Math.min(Math.sqrt(Math.max(s.a0, 1e-9)), Math.PI * sr * 0.9), k = w0 / Math.tan(w0 / (2 * sr)), k2 = k * k;
  const a0 = k2 + s.a1 * k + s.a0;
  return [
    (s.b2 * k2 + s.b1 * k + s.b0) / a0, (2 * (s.b0 - s.b2 * k2)) / a0, (s.b2 * k2 - s.b1 * k + s.b0) / a0,
    (2 * (s.a0 - k2)) / a0, (k2 - s.a1 * k + s.a0) / a0,
  ];
}

/** Audio through a plan's box: the woofer's sections in series, then each wall's ring taken away (out of phase). */
export class BoxFilter {
  private readonly series: Biquad[];
  private readonly walls: Biquad[];
  private readonly leaks: number[];
  private readonly s: Float64Array;
  private readonly w: Float64Array;

  constructor(d: Design, readonly sampleRate = 48000) {
    this.series = d.series.map((s) => bilinear(s, sampleRate));
    this.walls = d.walls.map((p) => { const w0 = 2 * Math.PI * p.hz; return bilinear({ b2: 0, b1: w0 / p.q, b0: 0, a1: w0 / p.q, a0: w0 * w0 }, sampleRate); });
    this.leaks = d.walls.map((p) => p.leak);
    this.s = new Float64Array(this.series.length * 2);
    this.w = new Float64Array(this.walls.length * 2);
  }

  /** In place, transposed direct form II. */
  process(buf: Float32Array | Float64Array): void {
    const { series, walls, leaks, s, w } = this;
    for (let i = 0; i < buf.length; i++) {
      let x = buf[i];
      for (let k = 0; k < series.length; k++) {
        const [b0, b1, b2, a1, a2] = series[k], y = b0 * x + s[2 * k];
        s[2 * k] = b1 * x - a1 * y + s[2 * k + 1]; s[2 * k + 1] = b2 * x - a2 * y; x = y;
      }
      let out = x;
      for (let k = 0; k < walls.length; k++) {
        const [b0, b1, b2, a1, a2] = walls[k], y = b0 * x + w[2 * k];
        w[2 * k] = b1 * x - a1 * y + w[2 * k + 1]; w[2 * k + 1] = b2 * x - a2 * y; out -= leaks[k] * y;
      }
      buf[i] = out;
    }
  }

  reset(): void { this.s.fill(0); this.w.fill(0); }
}
