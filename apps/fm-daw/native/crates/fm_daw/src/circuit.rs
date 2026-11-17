//! The circuit amp in Rust: packages/gear/src/circuit/mna.ts (the solver) and rig.ts
//! (the oversampler), power.ts (the push-pull power stage) and cab.ts (the cabinet's
//! convolution; its impulse response is made on the TypeScript side), step for step, f64 inside,
//! so test/circuit.test.ts can hold both to the same output.
//!
//! The netlist comes in already numbered (`encodeNetlist` in mna.ts): node names
//! are the TypeScript side's business, so both sides number nodes the same way.
//! Layout: `[nodes, input, output, parts]`, then `PART` f64s per part:
//! `[kind, n0, n1, n2, n3, v0, v1, v2, v3, v4, v5, flag]`, node −1 is ground.
//!   0 R: a b, ohms, flag noisy      1 C: a b, farads       2 V: a b, volts
//!   3 D: a k, is n                  4 Opamp: plus minus out hidden, rail   5 Triode: p g k
//!   6 L: a b, henries wire-ohms     7 BJT: c b e, is bf br leak, flag pnp
//!   8 JFET: d g s, idss vp lambda, flag p-channel    9 Pot: a w b, ohms at taper
//!   10 LDR: a b la lk, dark lit rise fall lamp       11 OTA: plus minus out abc

use std::f64::consts::{PI, SQRT_2};

pub const PART: usize = 12;
const FLAG: usize = 11;
const VT: f64 = 0.02585;
const GMIN: f64 = 1e-12;
const OPAMP_A0: f64 = 2e5;
const OPAMP_GBW: f64 = 3e6;
const OPAMP_R0: f64 = 1e6;
const MU: f64 = 100.0;
const EX: f64 = 1.4;
const KG1: f64 = 1060.0;
const KP: f64 = 600.0;
const KVB: f64 = 300.0;
const GG: f64 = 6.062e-4;
const CG: f64 = 13.9;
const XI: f64 = 1.354;
const IG0: f64 = 3.917e-8;
const JUNCTION_IS: f64 = 1e-14;
const LED_IS: f64 = 1e-18;
const LED_N: f64 = 2.0;
const LED_FULL: f64 = 0.01;
const LAMP_FULL: f64 = 0.04;
const LDR_GAMMA: f64 = 0.75;
const POT_GLIDE: f64 = 0.01;

/// A pot's travel through its taper (0 linear, 1 log, 2 reverse log): the share between `a` and the wiper.
fn taper(kind: f64, at: f64) -> f64 {
    if kind == 1.0 { (81f64.powf(at) - 1.0) / 80.0 } else if kind == 2.0 { 1.0 - (81f64.powf(1.0 - at) - 1.0) / 80.0 } else { at }
}

// The tube model's curves from tables (#4599). A Newton step is one long chain of
// dependent math (exp, log1p, log, exp for the plate, the same again for the grid), and
// the CPU waits on each link. A table lookup and a short cubic is a much shorter link
// than libm's exp or log, in wasm or native. mna.ts keeps Math.exp and Math.log; these
// agree with them within 1e-7 (softplus near -8) and 1e-9 (the powers), and the amp
// with mna.ts well inside test/circuit.test.ts's bound.

/// A smooth curve on [lo, hi] as cubic Hermite pieces: its value and slope at x.
struct Curve { lo: f64, scale: f64, last: usize, c: Vec<[f64; 4]> }

impl Curve {
    /// `f` gives the value and slope at a point; `steps` pieces across [lo, hi].
    fn new(lo: f64, hi: f64, steps: usize, f: impl Fn(f64) -> (f64, f64)) -> Curve {
        let h = (hi - lo) / steps as f64;
        let c = (0..steps).map(|i| {
            let ((y0, d0), (y1, d1)) = (f(lo + i as f64 * h), f(lo + (i + 1) as f64 * h));
            let (d0, d1) = (d0 * h, d1 * h);
            [y0, d0, 3.0 * (y1 - y0) - 2.0 * d0 - d1, 2.0 * (y0 - y1) + d0 + d1]
        }).collect();
        Curve { lo, scale: 1.0 / h, last: steps - 1, c }
    }
    #[inline]
    fn at(&self, x: f64) -> (f64, f64) {
        let t = (x - self.lo) * self.scale;
        let i = (t as usize).min(self.last); // `as` clamps a negative t to 0
        let s = t - i as f64;
        let [a, b, c, d] = self.c[i];
        (a + s * (b + s * (c + s * d)), (b + s * (2.0 * c + s * 3.0 * d)) * self.scale)
    }
}

/// x^p for x > 0, and its slope: x = m·2^e, m in [1, 2), so x^p = m^p (a curve) · 2^(pe) (a list).
struct Power { p: f64, mant: Curve, two: Vec<f64> }

impl Power {
    fn new(p: f64) -> Power {
        Power {
            p,
            mant: Curve::new(1.0, 2.0, 64, |m| (m.powf(p), p * m.powf(p - 1.0))),
            two: (0..2046).map(|e| (p * (e as f64 - 1022.0)).exp2()).collect(),
        }
    }
    /// x^p; 0 below the normal range (a tube current that small is none).
    #[inline]
    fn at(&self, x: f64) -> f64 {
        let bits = x.to_bits();
        let e = (bits >> 52) as usize; // biased exponent: 0 is subnormal, x > 0 so no sign bit
        if e == 0 || e > 2046 { return if e == 0 { 0.0 } else { x.powf(self.p) }; }
        let m = f64::from_bits((bits & 0x000f_ffff_ffff_ffff) | 0x3ff0_0000_0000_0000);
        self.mant.at(m).0 * self.two[e - 1]
    }
}

/// softplus ln(1 + e^x) and its slope, the sigmoid: a curve on [−8, 8], and past it one
/// exp and three terms of the series, which are exact to 1e-14 out there.
#[inline]
fn softplus(t: &Tables, x: f64) -> (f64, f64) {
    if x < -8.0 {
        let e = x.exp();
        (e * (1.0 - e * (0.5 - e / 3.0)), e / (1.0 + e))
    } else if x > 8.0 {
        let e = (-x).exp();
        (x + e * (1.0 - e * (0.5 - e / 3.0)), 1.0 / (1.0 + e))
    } else {
        t.softplus.at(x)
    }
}

struct Tables { softplus: Curve, plate: Power, grid: Power }

fn tables() -> &'static Tables {
    static T: std::sync::OnceLock<Tables> = std::sync::OnceLock::new();
    T.get_or_init(|| Tables {
        softplus: Curve::new(-8.0, 8.0, 1024, |x| (x.exp().ln_1p(), 1.0 / (1.0 + (-x).exp()))),
        plate: Power::new(EX),
        grid: Power::new(XI - 1.0),
    })
}

fn pnjlim(v: f64, vold: f64, nvt: f64, vcrit: f64) -> f64 {
    if v > vcrit && (v - vold).abs() > 2.0 * nvt {
        if vold > 0.0 {
            let arg = 1.0 + (v - vold) / nvt;
            return if arg > 0.0 { vold + nvt * arg.ln() } else { vcrit };
        }
        return nvt * (v / nvt).ln();
    }
    v
}

/// Solves A x = b in place (n×n inside a row stride of `m`), partial pivoting. False if singular.
fn solve(a: &mut [f64], b: &mut [f64], n: usize, m: usize) -> bool {
    for c in 0..n {
        let mut p = c;
        let mut best = a[c * m + c].abs();
        for r in c + 1..n {
            let v = a[r * m + c].abs();
            if v > best { best = v; p = r; }
        }
        if best < 1e-300 { return false; }
        if p != c {
            for k in c..n { a.swap(c * m + k, p * m + k); }
            b.swap(c, p);
        }
        let inv = 1.0 / a[c * m + c];
        for r in c + 1..n {
            let f = a[r * m + c] * inv;
            if f == 0.0 { continue; }
            for k in c + 1..n { a[r * m + k] -= f * a[c * m + k]; }
            b[r] -= f * b[c];
        }
    }
    for r in (0..n).rev() {
        let mut s = b[r];
        for k in r + 1..n { s -= a[r * m + k] * b[k]; }
        b[r] = s / a[r * m + r];
    }
    true
}

struct Cap { a: usize, b: usize, g: f64, v: f64, i: f64, ieq: f64 }
struct Hiss { a: usize, b: usize, sigma: f64 }
struct Diode { port: usize, is: f64, nvt: f64 }
struct Junction { port: usize, nvt: f64, vcrit: f64 }
struct Triode { pk: usize, gk: usize }
struct Inductor { a: usize, b: usize, gl: f64, rw: f64, g: f64, v: f64, i: f64, ieq: f64 }
struct Bjt { be: usize, bc: usize, is: f64, bf: f64, br: f64, leak: f64 }
struct Jfet { ds: usize, gs: usize, beta: f64, vp: f64, lambda: f64 }
struct Ota { vd: usize, abc: usize, out: usize }
struct VRes { port: usize, g0: f64, g: f64 }
struct Pot { r1: usize, r2: usize, ohms: f64, taper: f64, at: f64, to: f64 }
struct Ldr { r: usize, led: Option<usize>, la: usize, lk: usize, lamp: f64, dark: f64, lit: f64, up: f64, down: f64, light: f64 }

/// The parts with ports, for `currents` (split from `Circuit` so the solver's buffers can be borrowed beside them).
#[derive(Default)]
struct Ports { diodes: Vec<Diode>, triodes: Vec<Triode>, bjts: Vec<Bjt>, jfets: Vec<Jfet>, otas: Vec<Ota>, vres: Vec<VRes> }

pub struct Circuit {
    size: usize,
    m: usize,
    pub misses: u64,
    pub iterations: u64,
    pub noise: f64,
    seed: u32,
    base_dc: Vec<f64>,
    x: Vec<f64>,
    out: usize,
    in_row: usize,
    supplies: Vec<(usize, f64)>,
    caps: Vec<Cap>,
    hiss: Vec<Hiss>,
    pa: Vec<usize>,
    pb: Vec<usize>,
    poff: Vec<f64>,
    ports: Ports,
    junctions: Vec<Junction>,
    inds: Vec<Inductor>,
    pots: Vec<Pot>,
    pot_glide: f64,
    ldrs: Vec<Ldr>,
    i_now: Vec<f64>,
    k: usize,
    ainv: Vec<f64>,
    w: Vec<f64>,
    h: Vec<f64>,
    z: Vec<f64>,
    v: Vec<f64>,
    v_new: Vec<f64>,
    ip: Vec<f64>,
    j: Vec<f64>,
    f: Vec<f64>,
    jf: Vec<f64>,
    p: Vec<f64>,
}

impl Circuit {
    /// A netlist (see the module doc) compiled for one sample rate; None if it's malformed or singular.
    pub fn new(desc: &[f64], sample_rate: f64) -> Option<Circuit> {
        if desc.len() < 4 { return None; }
        let node_count = desc[0] as usize;
        let parts = desc[3] as usize;
        if desc.len() != 4 + parts * PART || desc[1] < 0.0 || desc[2] < 0.0 { return None; }
        let part = |i: usize| &desc[4 + i * PART..4 + (i + 1) * PART];
        let mut branches = 1;
        for i in 0..parts {
            let k = part(i)[0] as u32;
            if k > 11 { return None; }
            if k == 2 || k == 4 { branches += 1; }
        }
        let n = node_count + branches;
        let m = n + 1;
        // Ground (−1) and anything out of range land on the unread index n.
        let g = |v: f64| -> Option<usize> {
            if v < 0.0 { Some(n) } else if (v as usize) < node_count { Some(v as usize) } else { None }
        };
        let mut tr = vec![0.0; m * m];
        let mut dc = vec![0.0; m * m];
        fn both(tr: &mut [f64], dc: &mut [f64], m: usize, r: usize, c: usize, v: f64) { tr[r * m + c] += v; dc[r * m + c] += v; }
        fn conductance(base: &mut [f64], m: usize, a: usize, b: usize, v: f64) {
            base[a * m + a] += v; base[b * m + b] += v; base[a * m + b] -= v; base[b * m + a] -= v;
        }
        for i in 0..node_count { both(&mut tr, &mut dc, m, i, i, GMIN); }
        let mut row = node_count;
        let t = 1.0 / sample_rate;
        let mut c = Circuit {
            size: n, m, misses: 0, iterations: 0, noise: 0.0, seed: 0x9e3779b9,
            base_dc: Vec::new(), x: vec![0.0; m], out: desc[2] as usize, in_row: 0,
            supplies: Vec::new(), caps: Vec::new(), hiss: Vec::new(),
            pa: Vec::new(), pb: Vec::new(), poff: Vec::new(), ports: Ports::default(), junctions: Vec::new(),
            inds: Vec::new(), pots: Vec::new(), pot_glide: 1.0 - (-t / POT_GLIDE).exp(), ldrs: Vec::new(), i_now: Vec::new(),
            k: 0, ainv: Vec::new(), w: Vec::new(), h: Vec::new(), z: vec![0.0; m],
            v: Vec::new(), v_new: Vec::new(), ip: Vec::new(), j: Vec::new(), f: Vec::new(), jf: Vec::new(), p: Vec::new(),
        };
        if c.out >= node_count || desc[1] as usize >= node_count { return None; }
        fn source(tr: &mut [f64], dc: &mut [f64], m: usize, row: &mut usize, a: usize, b: usize) -> usize {
            let j = *row; *row += 1;
            both(tr, dc, m, a, j, 1.0); both(tr, dc, m, b, j, -1.0); both(tr, dc, m, j, a, 1.0); both(tr, dc, m, j, b, -1.0);
            j
        }
        fn port(c: &mut Circuit, a: usize, b: usize, off: f64) -> usize { c.pa.push(a); c.pb.push(b); c.poff.push(off); c.pa.len() - 1 }
        fn junction(c: &mut Circuit, port: usize, is: f64, nvt: f64) {
            c.junctions.push(Junction { port, nvt, vcrit: nvt * (nvt / (SQRT_2 * is)).ln() });
        }
        fn diode(c: &mut Circuit, a: usize, k: usize, off: f64, is: f64, nf: f64) -> usize {
            let nvt = nf * VT;
            let at = port(c, a, k, off);
            c.ports.diodes.push(Diode { port: at, is, nvt });
            junction(c, at, is, nvt);
            at
        }
        fn moving(c: &mut Circuit, tr: &mut [f64], dc: &mut [f64], m: usize, a: usize, b: usize, g0: f64) -> usize {
            conductance(tr, m, a, b, g0); conductance(dc, m, a, b, g0);
            let at = port(c, a, b, 0.0);
            c.ports.vres.push(VRes { port: at, g0, g: g0 });
            c.ports.vres.len() - 1
        }
        c.in_row = source(&mut tr, &mut dc, m, &mut row, desc[1] as usize, n);
        for i in 0..parts {
            let p = part(i);
            let kind = p[0] as u32;
            let (a, b) = (g(p[1])?, g(p[2])?);
            let flag = p[FLAG] != 0.0;
            match kind {
                0 => {
                    conductance(&mut tr, m, a, b, 1.0 / p[5]); conductance(&mut dc, m, a, b, 1.0 / p[5]);
                    if flag { c.hiss.push(Hiss { a, b, sigma: (((4.0 * 1.380649e-23 * 300.0) / p[5]) * (sample_rate / 2.0)).sqrt() }); }
                }
                1 => {
                    let gc = (2.0 * p[5]) / t;
                    conductance(&mut tr, m, a, b, gc);
                    c.caps.push(Cap { a, b, g: gc, v: 0.0, i: 0.0, ieq: 0.0 });
                }
                2 => { let r = source(&mut tr, &mut dc, m, &mut row, a, b); c.supplies.push((r, p[5])); }
                3 => { diode(&mut c, a, b, 0.0, p[5], p[6]); }
                4 => {
                    let (plus, minus, out, hid) = (a, b, g(p[3])?, g(p[4])?);
                    let gm = OPAMP_A0 / OPAMP_R0;
                    let c0 = OPAMP_A0 / (2.0 * PI * OPAMP_GBW * OPAMP_R0);
                    both(&mut tr, &mut dc, m, hid, plus, -gm); both(&mut tr, &mut dc, m, hid, minus, gm);
                    conductance(&mut tr, m, hid, n, 1.0 / OPAMP_R0 + (2.0 * c0) / t); conductance(&mut dc, m, hid, n, 1.0 / OPAMP_R0);
                    c.caps.push(Cap { a: hid, b: n, g: (2.0 * c0) / t, v: 0.0, i: 0.0, ieq: 0.0 });
                    let vr = p[5] - 0.5;
                    diode(&mut c, hid, n, vr, 2.52e-9, 1.752); diode(&mut c, n, hid, vr, 2.52e-9, 1.752);
                    let j = row; row += 1;
                    both(&mut tr, &mut dc, m, out, j, 1.0); both(&mut tr, &mut dc, m, j, out, 1.0); both(&mut tr, &mut dc, m, j, hid, -1.0);
                }
                5 => {
                    let k = g(p[3])?;
                    let pk = port(&mut c, a, k, 0.0);
                    let gk = port(&mut c, b, k, 0.0);
                    c.ports.triodes.push(Triode { pk, gk });
                }
                6 => {
                    let (gl, rw) = (t / (2.0 * p[5]), p[6].max(1e-3));
                    let gi = gl / (1.0 + rw * gl);
                    conductance(&mut tr, m, a, b, gi); conductance(&mut dc, m, a, b, 1.0 / rw);
                    c.inds.push(Inductor { a, b, gl, rw, g: gi, v: 0.0, i: 0.0, ieq: 0.0 });
                }
                7 => {
                    let (col, base, em) = (a, b, g(p[3])?);
                    let be = if flag { port(&mut c, em, base, 0.0) } else { port(&mut c, base, em, 0.0) };
                    let bc = if flag { port(&mut c, col, base, 0.0) } else { port(&mut c, base, col, 0.0) };
                    junction(&mut c, be, p[5], VT); junction(&mut c, bc, p[5], VT);
                    c.ports.bjts.push(Bjt { be, bc, is: p[5], bf: p[6], br: p[7], leak: p[8] });
                }
                8 => {
                    let (dr, gate, src) = (a, b, g(p[3])?);
                    let gs = if flag { diode(&mut c, src, gate, 0.0, JUNCTION_IS, 1.0) } else { diode(&mut c, gate, src, 0.0, JUNCTION_IS, 1.0) };
                    let ds = if flag { port(&mut c, src, dr, 0.0) } else { port(&mut c, dr, src, 0.0) };
                    c.ports.jfets.push(Jfet { ds, gs, beta: p[5] / (p[6] * p[6]), vp: p[6], lambda: p[7] });
                }
                9 => {
                    let (ohms, at, tp) = (p[5], p[6], p[7]);
                    let w = taper(tp, at);
                    let r1 = moving(&mut c, &mut tr, &mut dc, m, a, b, 1.0 / (ohms * w).max(1.0));
                    let r2 = moving(&mut c, &mut tr, &mut dc, m, b, g(p[3])?, 1.0 / (ohms * (1.0 - w)).max(1.0));
                    c.pots.push(Pot { r1, r2, ohms, taper: tp, at, to: at });
                }
                10 => {
                    let (la, lk) = (g(p[3])?, g(p[4])?);
                    let (dark, lit, rise, fall, lamp) = (p[5], p[6], p[7], p[8], p[9]);
                    let led = if lamp > 0.0 {
                        conductance(&mut tr, m, la, lk, 1.0 / lamp); conductance(&mut dc, m, la, lk, 1.0 / lamp);
                        None
                    } else { Some(diode(&mut c, la, lk, 0.0, LED_IS, LED_N)) };
                    let r = moving(&mut c, &mut tr, &mut dc, m, a, b, 1.0 / (dark * lit).sqrt());
                    c.ldrs.push(Ldr { r, led, la, lk, lamp, dark, lit, up: 1.0 - (-t / rise).exp(), down: 1.0 - (-t / fall).exp(), light: 0.0 });
                }
                _ => {
                    let (out, abc) = (g(p[3])?, g(p[4])?);
                    let vd = port(&mut c, a, b, 0.0);
                    let abc = diode(&mut c, abc, n, 0.0, JUNCTION_IS, 1.0);
                    let out = port(&mut c, n, out, 0.0);
                    c.ports.otas.push(Ota { vd, abc, out });
                }
            }
        }
        if row != n { return None; }
        let kk = c.pa.len();
        c.k = kk;
        // Invert the transient matrix once, column by column.
        let mut ainv = vec![0.0; m * m];
        let mut a = vec![0.0; m * m];
        let mut col = vec![0.0; m];
        for j in 0..n {
            a.copy_from_slice(&tr);
            col.fill(0.0); col[j] = 1.0;
            if !solve(&mut a, &mut col, n, m) { return None; }
            ainv[j * m..j * m + n].copy_from_slice(&col[..n]);
        }
        let mut w = vec![0.0; m * kk];
        let mut h = vec![0.0; kk * kk];
        for k in 0..kk { for r in 0..n { w[k * m + r] = ainv[c.pa[k] * m + r] - ainv[c.pb[k] * m + r]; } }
        for j in 0..kk { for k in 0..kk { h[j * kk + k] = w[k * m + c.pa[j]] - w[k * m + c.pb[j]]; } }
        c.ainv = ainv; c.w = w; c.h = h; c.base_dc = dc;
        c.v = vec![0.0; kk]; c.v_new = vec![0.0; kk]; c.ip = vec![0.0; kk]; c.p = vec![0.0; kk];
        c.j = vec![0.0; kk * kk]; c.f = vec![0.0; kk]; c.jf = vec![0.0; kk * kk]; c.i_now = vec![0.0; kk];
        Some(c)
    }

    fn gauss(&mut self) -> f64 {
        let mut s = self.seed;
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
        let u1 = (s as f64 + 1.0) / 4294967297.0;
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
        let u2 = s as f64 / 4294967296.0;
        self.seed = s;
        (-2.0 * u1.ln()).sqrt() * (2.0 * PI * u2).cos()
    }

    fn currents(ps: &Ports, poff: &[f64], kk: usize, v: &[f64], i: &mut [f64], jm: &mut [f64]) {
        for d in &ps.diodes {
            let vd = v[d.port] - poff[d.port];
            let e = (vd / d.nvt).min(80.0).exp();
            i[d.port] = d.is * (e - 1.0);
            jm[d.port * kk + d.port] = (d.is * e) / d.nvt + GMIN;
        }
        let tb = tables();
        for t in &ps.triodes {
            let (vpk, vgk) = (v[t.pk], v[t.gk]);
            let s = (KVB + vpk * vpk).sqrt();
            let u = KP * (1.0 / MU + vgk / s);
            let (l, sg) = softplus(tb, u);
            let e1 = (vpk / KP) * l;
            let (mut ip, mut gm, mut gp) = (0.0, 0.0, 0.0);
            if e1 > 0.0 {
                ip = tb.plate.at(e1) / KG1;
                let dip = (EX * ip) / e1;
                gm = dip * ((vpk * sg) / s);
                gp = dip * (l / KP - (vpk * vpk * vgk * sg) / (s * s * s));
            }
            i[t.pk] = ip;
            jm[t.pk * kk + t.pk] = gp + GMIN;
            jm[t.pk * kk + t.gk] = gm;
            if vgk < -1.0 {
                i[t.gk] = IG0;
                jm[t.gk * kk + t.gk] = GMIN;
            } else {
                let (spc, sgc) = softplus(tb, CG * vgk);
                let sp = spc / CG;
                let pw = tb.grid.at(sp);
                i[t.gk] = GG * pw * sp + IG0;
                jm[t.gk * kk + t.gk] = GG * XI * pw * sgc + GMIN;
            }
        }
        for q in &ps.bjts {
            let (vbe, vbc) = (v[q.be], v[q.bc]);
            let ef = (vbe / VT).min(80.0).exp();
            let er = (vbc / VT).min(80.0).exp();
            let (gf, gr, th) = ((q.is * ef) / VT, (q.is * er) / VT, (vbc / VT).tanh());
            i[q.be] = q.is * (ef - er) + (q.is / q.bf) * (ef - 1.0);
            jm[q.be * kk + q.be] = gf * (1.0 + 1.0 / q.bf) + GMIN;
            jm[q.be * kk + q.bc] = -gr;
            i[q.bc] = (q.is / q.br) * (er - 1.0) - q.is * (ef - er) + q.leak * th;
            jm[q.bc * kk + q.be] = -gf;
            jm[q.bc * kk + q.bc] = gr * (1.0 + 1.0 / q.br) + (q.leak * (1.0 - th * th)) / VT + GMIN;
        }
        for f in &ps.jfets {
            let (vds, vgs) = (v[f.ds], v[f.gs]);
            let rev = vds < 0.0;
            let og = (if rev { vgs - vds } else { vgs }) + f.vp;
            let od = if rev { -vds } else { vds };
            let (mut id, mut dg, mut dd) = (0.0, 0.0, 0.0);
            if og > 0.0 {
                let l = 1.0 + f.lambda * od;
                if od < og {
                    let q = 2.0 * og * od - od * od;
                    id = f.beta * q * l; dg = 2.0 * f.beta * od * l; dd = 2.0 * f.beta * (og - od) * l + f.beta * q * f.lambda;
                } else {
                    id = f.beta * og * og * l; dg = 2.0 * f.beta * og * l; dd = f.beta * og * og * f.lambda;
                }
            }
            i[f.ds] = if rev { -id } else { id };
            jm[f.ds * kk + f.ds] = (if rev { dg + dd } else { dd }) + GMIN;
            jm[f.ds * kk + f.gs] = if rev { -dg } else { dg };
        }
        for o in &ps.otas {
            let ib = i[o.abc];
            let iabc = if ib > 0.0 { ib } else { 0.0 };
            let th = (v[o.vd] / (2.0 * VT)).tanh();
            i[o.vd] = 0.0;
            i[o.out] = iabc * th;
            jm[o.out * kk + o.vd] = (iabc * (1.0 - th * th)) / (2.0 * VT);
            jm[o.out * kk + o.abc] = if ib > 0.0 { jm[o.abc * kk + o.abc] * th } else { 0.0 };
        }
        for r in &ps.vres {
            let dg = r.g - r.g0;
            i[r.port] = dg * v[r.port];
            jm[r.port * kk + r.port] = dg;
        }
    }

    fn limit(junctions: &[Junction], poff: &[f64], v: &mut [f64], old: &[f64]) {
        for d in junctions {
            let off = poff[d.port];
            v[d.port] = pnjlim(v[d.port] - off, old[d.port] - off, d.nvt, d.vcrit) + off;
        }
    }

    /// Turns pot `i` (in netlist order) to `at`, 0 to 1 (mna.ts `setPot`): it glides there over about 10 ms.
    pub fn set_pot(&mut self, i: usize, at: f64) {
        if let Some(p) = self.pots.get_mut(i) { p.to = at.clamp(0.0, 1.0); }
    }

    fn turn_pots(&mut self, share: f64) {
        for p in &mut self.pots {
            if p.at == p.to { continue; }
            p.at += (p.to - p.at) * share;
            if (p.to - p.at).abs() < 1e-6 { p.at = p.to; }
            let t = taper(p.taper, p.at);
            self.ports.vres[p.r1].g = 1.0 / (p.ohms * t).max(1.0);
            self.ports.vres[p.r2].g = 1.0 / (p.ohms * (1.0 - t)).max(1.0);
        }
    }

    /// Each LDR's light `share` of the way to what its source gives now (None: at its own pace up or down).
    fn light(&mut self, share: Option<f64>) {
        for d in &mut self.ldrs {
            let target = match d.led {
                Some(k) => self.i_now[k].max(0.0) / LED_FULL,
                None => { let a = (self.x[d.la] - self.x[d.lk]) / d.lamp / LAMP_FULL; a * a }
            };
            d.light += (target - d.light) * share.unwrap_or(if target > d.light { d.up } else { d.down });
            self.ports.vres[d.r].g = 1.0 / d.dark + d.light.powf(LDR_GAMMA) / d.lit;
        }
    }

    /// The resting state with `vin` on the input (mna.ts `settle`); the output's volts. None if singular.
    pub fn settle(&mut self, vin: f64) -> Option<f64> {
        let (m, n, kk) = (self.m, self.size, self.k);
        let mut a = vec![0.0; m * m];
        let mut b = vec![0.0; m];
        let mut old = vec![0.0; kk];
        self.x.fill(0.0); self.v.fill(0.0);
        self.turn_pots(1.0);
        for d in &mut self.ldrs { d.light = 0.0; self.ports.vres[d.r].g = 1.0 / d.dark; }
        let passes = if self.ldrs.is_empty() { 10 } else { 11 };
        for s in 1..=passes {
            for it in 0..200 {
                a.copy_from_slice(&self.base_dc); b.fill(0.0);
                b[self.in_row] = vin;
                for &(row, volts) in &self.supplies { b[row] = (volts * s.min(10) as f64) / 10.0; }
                old.copy_from_slice(&self.v);
                for k in 0..kk { self.v[k] = self.x[self.pa[k]] - self.x[self.pb[k]]; }
                if it > 0 { Self::limit(&self.junctions, &self.poff, &mut self.v, &old); }
                self.j.fill(0.0);
                Self::currents(&self.ports, &self.poff, kk, &self.v, &mut self.ip, &mut self.j);
                let (pa, pb) = (&self.pa, &self.pb);
                for j in 0..kk {
                    let mut rest = self.ip[j];
                    for k in 0..kk {
                        let jk = self.j[j * kk + k];
                        if jk == 0.0 { continue; }
                        rest -= jk * self.v[k];
                        a[pa[j] * m + pa[k]] += jk; a[pa[j] * m + pb[k]] -= jk; a[pb[j] * m + pa[k]] -= jk; a[pb[j] * m + pb[k]] += jk;
                    }
                    b[pa[j]] -= rest; b[pb[j]] += rest;
                }
                if !solve(&mut a, &mut b, n, m) { return None; }
                let mut done = true;
                for i in 0..n {
                    if (b[i] - self.x[i]).abs() > 1e-9 + 1e-9 * b[i].abs() { done = false; }
                    self.x[i] = b[i];
                }
                self.x[n] = 0.0;
                if done { break; }
            }
            if !self.ldrs.is_empty() {
                for k in 0..kk { self.v[k] = self.x[self.pa[k]] - self.x[self.pb[k]]; }
                self.j.fill(0.0);
                Self::currents(&self.ports, &self.poff, kk, &self.v, &mut self.i_now, &mut self.j);
                self.light(Some(1.0));
            }
        }
        for k in 0..kk { self.v[k] = self.x[self.pa[k]] - self.x[self.pb[k]]; }
        for c in &mut self.caps { c.v = self.x[c.a] - self.x[c.b]; c.i = 0.0; }
        for l in &mut self.inds { l.v = self.x[l.a] - self.x[l.b]; l.i = l.v / l.rw; }
        Some(self.x[self.out])
    }

    #[inline]
    fn add_col(z: &mut [f64], ainv: &[f64], m: usize, n: usize, j: usize, val: f64) {
        let o = j * m;
        for r in 0..n { z[r] += ainv[o + r] * val; }
    }

    /// One sample: `vin` volts on the input, the output's volts back.
    pub fn step(&mut self, vin: f64) -> f64 {
        let (m, n, kk) = (self.m, self.size, self.k);
        self.z.fill(0.0);
        if !self.pots.is_empty() { self.turn_pots(self.pot_glide); }
        Self::add_col(&mut self.z, &self.ainv, m, n, self.in_row, vin);
        for &(row, volts) in &self.supplies { Self::add_col(&mut self.z, &self.ainv, m, n, row, volts); }
        for c in &mut self.caps {
            c.ieq = c.g * c.v + c.i;
            if c.a < n { Self::add_col(&mut self.z, &self.ainv, m, n, c.a, c.ieq); }
            if c.b < n { Self::add_col(&mut self.z, &self.ainv, m, n, c.b, -c.ieq); }
        }
        for l in &mut self.inds {
            l.ieq = (l.i + l.gl * (l.v - l.rw * l.i)) / (1.0 + l.rw * l.gl);
            if l.a < n { Self::add_col(&mut self.z, &self.ainv, m, n, l.a, -l.ieq); }
            if l.b < n { Self::add_col(&mut self.z, &self.ainv, m, n, l.b, l.ieq); }
        }
        if self.noise > 0.0 {
            for h in 0..self.hiss.len() {
                let i = self.hiss[h].sigma * self.noise * self.gauss();
                let (a, b) = (self.hiss[h].a, self.hiss[h].b);
                if a < n { Self::add_col(&mut self.z, &self.ainv, m, n, a, i); }
                if b < n { Self::add_col(&mut self.z, &self.ainv, m, n, b, -i); }
            }
        }
        self.x.copy_from_slice(&self.z);
        if kk > 0 {
            for k in 0..kk { self.p[k] = self.z[self.pa[k]] - self.z[self.pb[k]]; }
            let mut it = 0u64;
            let mut converged = false;
            while it < 50 && !converged {
                self.j.fill(0.0);
                Self::currents(&self.ports, &self.poff, kk, &self.v, &mut self.ip, &mut self.j);
                for j in 0..kk {
                    let mut f = self.v[j] - self.p[j];
                    for k in 0..kk {
                        f += self.h[j * kk + k] * self.ip[k];
                        let mut s = if j == k { 1.0 } else { 0.0 };
                        for l in 0..kk { s += self.h[j * kk + l] * self.j[l * kk + k]; }
                        self.jf[j * kk + k] = s;
                    }
                    self.f[j] = -f;
                }
                if !solve(&mut self.jf, &mut self.f, kk, kk) { break; }
                converged = true;
                for k in 0..kk {
                    self.v_new[k] = self.v[k] + self.f[k];
                    if self.f[k].abs() > 1e-7 + 1e-7 * self.v[k].abs() { converged = false; }
                }
                Self::limit(&self.junctions, &self.poff, &mut self.v_new, &self.v);
                self.v.copy_from_slice(&self.v_new);
                it += 1;
            }
            self.iterations += it;
            if !converged {
                self.misses += 1;
                self.j.fill(0.0);
                Self::currents(&self.ports, &self.poff, kk, &self.v, &mut self.ip, &mut self.j);
                self.f.fill(0.0);
            }
            for k in 0..kk {
                let mut ik = self.ip[k];
                for l in 0..kk { ik += self.j[k * kk + l] * self.f[l]; }
                self.i_now[k] = ik;
                let o = k * m;
                for r in 0..n { self.x[r] -= self.w[o + r] * ik; }
            }
        } else {
            self.iterations += 1;
        }
        for c in &mut self.caps { c.v = self.x[c.a] - self.x[c.b]; c.i = c.g * c.v - c.ieq; }
        for l in &mut self.inds { l.v = self.x[l.a] - self.x[l.b]; l.i = l.g * l.v + l.ieq; }
        if !self.ldrs.is_empty() { self.light(None); }
        self.x[self.out]
    }
}

/// RBJ cookbook low-pass biquad, transposed direct form II (filters.ts `Biquad`; the oversampler only needs the low-pass).
#[derive(Clone, Copy)]
struct Biquad { b0: f64, b1: f64, b2: f64, a1: f64, a2: f64, z1: f64, z2: f64 }

impl Biquad {
    fn lp(hz: f64, q: f64, sr: f64) -> Biquad {
        let w = (2.0 * PI * hz) / sr;
        let cw = w.cos();
        let al = w.sin() / (2.0 * q);
        let a0 = 1.0 + al;
        let k = (1.0 - cw) / 2.0;
        Biquad { b0: k / a0, b1: (2.0 * k) / a0, b2: k / a0, a1: (-2.0 * cw) / a0, a2: (1.0 - al) / a0, z1: 0.0, z2: 0.0 }
    }
    #[inline]
    fn run(&mut self, x: f64) -> f64 {
        let y = self.b0 * x + self.z1;
        self.z1 = self.b1 * x - self.a1 * y + self.z2;
        self.z2 = self.b2 * x - self.a2 * y;
        y
    }
}

#[inline]
fn chain(fs: &mut [Biquad], mut x: f64) -> f64 { for f in fs { x = f.run(x); } x }

fn butter8(hz: f64, sr: f64) -> Vec<Biquad> {
    [0.5098, 0.6013, 0.9, 2.5629].iter().map(|&q| Biquad::lp(hz, q, sr)).collect()
}

// The push-pull power stage (power.ts `PushPull`, constant for constant).
const B_PLUS: f64 = 450.0;
const KNEE: f64 = 50.0;
const BIAS: f64 = -36.0;
const CUTOFF: f64 = -45.0;
const WIDTH: f64 = 3.0;
const K_PLATE: f64 = 6.6e-3;
const ZAA: f64 = 4300.0;
const TAP: f64 = 8.0;
const FLYBACK_AMPS: f64 = 0.1;
const GRID: f64 = 0.9;
const TREM_VOLTS: f64 = 8.0;

#[inline]
fn softplus_exact(x: f64) -> f64 { if x > 30.0 { x } else { x.exp().ln_1p() } }
#[inline]
fn plate(g: f64) -> f64 {
    let gg = g - softplus_exact(g);
    K_PLATE * softplus_exact((gg - CUTOFF) / WIDTH).powf(1.5)
}

/// Output tubes in push-pull, the supply that sags under them, the output transformer and the speaker on it.
pub struct PushPull {
    pairs: f64, sag: f64, load: f64, draw: f64, idle: f64,
    attack: f64, release: f64, hp_x: f64, hp_y: f64, lp: f64, hp_a: f64, lp_a: f64,
    /// The bias tremolo: its rate (Hz), depth (0 to 1), and the LFO's phase (radians).
    trem_hz: f64, trem_depth: f64, phase: f64, sample_rate: f64,
    pub supply: f64,
    /// 0 fine, 1 played through an open speaker jack.
    pub fault: u32,
}

impl PushPull {
    pub fn new(pairs: f64, sag: f64, load: f64, sample_rate: f64) -> PushPull {
        let idle = plate(BIAS);
        PushPull {
            pairs, sag, load, draw: 2.0 * idle * pairs, idle,
            attack: 1.0 - (-1.0 / (0.015 * sample_rate)).exp(), release: 1.0 - (-1.0 / (0.12 * sample_rate)).exp(),
            hp_x: 0.0, hp_y: 0.0, lp: 0.0,
            hp_a: (-2.0 * PI * 35.0 / sample_rate).exp(), lp_a: (-2.0 * PI * 9000.0 / sample_rate).exp(),
            trem_hz: 0.0, trem_depth: 0.0, phase: 0.0, sample_rate,
            supply: B_PLUS, fault: 0,
        }
    }
    pub fn set_load(&mut self, ohms: f64) { self.load = ohms; }
    /// The bias tremolo's rate and depth; depth 0 holds the bias still. The LFO keeps its phase.
    pub fn set_trem(&mut self, hz: f64, depth: f64) { self.trem_hz = hz.max(0.0); self.trem_depth = depth.clamp(0.0, 1.0); }

    #[inline]
    pub fn step(&mut self, x: f64, drive: f64) -> f64 {
        if self.fault != 0 { return 0.0; }
        let d = x * drive * GRID;
        let mut bias = BIAS;
        if self.trem_depth > 0.0 {
            bias -= self.trem_depth * TREM_VOLTS * (0.5 - 0.5 * self.phase.cos());
            self.phase += (2.0 * PI * self.trem_hz) / self.sample_rate;
            if self.phase > 2.0 * PI { self.phase -= 2.0 * PI; }
        }
        let (a, b) = (plate(bias + d), plate(bias - d));
        let n = self.pairs;
        let now = (a + b) * n;
        self.draw += (now - self.draw) * (if now > self.draw { self.attack } else { self.release });
        let supply = B_PLUS - self.sag * (self.draw - 2.0 * self.idle * n);
        self.supply = supply;
        let swing = (a - b) * n;
        if self.load <= 0.0 {
            if swing.abs() > FLYBACK_AMPS { self.fault = 1; }
            return 0.0;
        }
        let raw = (swing * (ZAA / n) * (self.load / TAP)) / 2.0;
        let ceiling = 2.0 * (supply - KNEE).max(1.0);
        let vp = ceiling * (raw / ceiling).tanh();
        let hp = self.hp_a * (self.hp_y + vp - self.hp_x);
        self.hp_x = vp; self.hp_y = hp;
        self.lp = hp + self.lp_a * (self.lp - hp);
        self.lp / (ZAA / n / TAP).sqrt()
    }
}

/// Direct convolution with the history kept twice over (cab.ts `Convolver`).
pub struct Convolver { ir: Vec<f64>, buf: Vec<f64>, at: usize }

impl Convolver {
    pub fn new(ir: &[f64]) -> Convolver { Convolver { ir: ir.to_vec(), buf: vec![0.0; 2 * ir.len()], at: 0 } }
    pub fn set(&mut self, ir: &[f64]) {
        if ir.len() != self.ir.len() { self.buf = vec![0.0; 2 * ir.len()]; self.at = 0; }
        self.ir = ir.to_vec();
    }
    #[inline]
    pub fn run(&mut self, x: f64) -> f64 {
        let n = self.ir.len();
        if n == 0 { return x; }
        self.at = (if self.at == 0 { n } else { self.at }) - 1;
        let at = self.at;
        self.buf[at] = x; self.buf[at + n] = x;
        let mut y = 0.0;
        for (k, h) in self.ir.iter().zip(&self.buf[at..at + n]) { y += k * h; }
        y
    }
}

/// Circuits in a row, oversampled, then the power stage and the cabinet (rig.ts `Rig`).
/// The power stage starts as power.ts `DEFAULT_POWER` until `set_output`; no cab until `set_cab`.
pub struct Rig {
    circuits: Vec<Circuit>,
    gains: Vec<f64>,
    rest: Vec<f64>,
    peaks: Vec<f64>,
    up: Vec<Biquad>,
    down: Vec<Biquad>,
    amp: PushPull,
    cab: Option<Convolver>,
    input_volts: f64,
    power: f64,
    noise: f64,
    steps: u64,
    sample_rate: f64,
    oversample: usize,
}

impl Rig {
    pub fn new(sample_rate: f64, oversample: usize, input_volts: f64, power: f64, noise: f64) -> Rig {
        let hi = sample_rate * oversample as f64;
        Rig {
            circuits: Vec::new(), gains: Vec::new(), rest: Vec::new(), peaks: Vec::new(),
            up: butter8(0.45 * sample_rate, hi), down: butter8(0.45 * sample_rate, hi),
            amp: PushPull::new(1.0, 120.0, 8.0, hi), cab: None,
            input_volts, power, noise, steps: 0, sample_rate, oversample,
        }
    }

    fn build(&self, desc: &[f64], i: usize) -> Option<(Circuit, f64)> {
        let mut c = Circuit::new(desc, self.sample_rate * self.oversample as f64)?;
        c.noise = self.noise;
        let r = c.settle(if i > 0 { self.rest[i - 1] } else { 0.0 })?;
        Some((c, r))
    }

    /// Appends a link (a circuit with a volume pot ahead of it), resting on the last link's output. Its index, or None.
    pub fn push(&mut self, desc: &[f64], gain: f64) -> Option<usize> {
        let i = self.circuits.len();
        let (c, r) = self.build(desc, i)?;
        self.circuits.push(c); self.rest.push(r); self.gains.push(gain); self.peaks.push(0.0);
        Some(i)
    }

    /// Link `i` becomes a new circuit, starting from its rest state. False if `i` or the netlist is bad.
    pub fn set_link(&mut self, i: usize, desc: &[f64]) -> bool {
        if i >= self.circuits.len() { return false; }
        match self.build(desc, i) {
            Some((c, r)) => { self.rest[i] = r; self.circuits[i] = c; true }
            None => false,
        }
    }

    pub fn set_gain(&mut self, i: usize, g: f64) { if let Some(x) = self.gains.get_mut(i) { *x = g; } }
    /// Turns pot `pot` (in netlist order) of link `i` to `at`, 0 to 1.
    pub fn set_pot(&mut self, i: usize, pot: usize, at: f64) { if let Some(c) = self.circuits.get_mut(i) { c.set_pot(pot, at); } }
    pub fn set_power(&mut self, p: f64) { self.power = p; }
    pub fn set_noise(&mut self, n: f64) { self.noise = n; for c in &mut self.circuits { c.noise = n; } }
    /// The power stage's parts, fresh (rig.ts builds it from `RigSpec.output` the same way).
    pub fn set_output(&mut self, pairs: f64, sag: f64, load: f64) {
        self.amp = PushPull::new(pairs, sag, load, self.sample_rate * self.oversample as f64);
    }
    pub fn set_load(&mut self, ohms: f64) { self.amp.set_load(ohms); }
    pub fn set_trem(&mut self, hz: f64, depth: f64) { self.amp.set_trem(hz, depth); }
    /// The cabinet's impulse response at the rig's sample rate; empty for no cab.
    pub fn set_cab(&mut self, ir: &[f64]) {
        match (&mut self.cab, ir.is_empty()) {
            (_, true) => self.cab = None,
            (Some(c), false) => c.set(ir),
            (None, false) => self.cab = Some(Convolver::new(ir)),
        }
    }
    pub fn fault(&self) -> u32 { self.amp.fault }
    pub fn supply(&self) -> f64 { self.amp.supply }

    /// Mono, in place: full scale ±1 in, volts at the speaker out (each sample is read before it is written).
    pub fn process(&mut self, io: &mut [f32]) {
        let n = io.len();
        if self.circuits.is_empty() { return; }
        let last = self.rest.len() - 1;
        let os = self.oversample;
        for s in 0..n {
            let mut acc = 0.0;
            for k in 0..os {
                let mut x = chain(&mut self.up, if k == 0 { io[s] as f64 * self.input_volts * os as f64 } else { 0.0 });
                for i in 0..self.circuits.len() {
                    let r = if i > 0 { self.rest[i - 1] } else { 0.0 };
                    x = self.circuits[i].step(r + (x - r) * self.gains[i]);
                    let swing = (x - self.rest[i]).abs();
                    if swing > self.peaks[i] { self.peaks[i] = swing; }
                }
                x -= self.rest[last];
                if self.power > 0.0 { x = self.amp.step(x, self.power); }
                acc = chain(&mut self.down, x);
            }
            io[s] = (match &mut self.cab { Some(c) => c.run(acc), None => acc }) as f32;
        }
        self.steps += (n * os * self.circuits.len()) as u64;
    }

    /// Each link's biggest swing since the last call, then cleared.
    pub fn levels(&mut self, out: &mut [f32]) {
        for (o, p) in out.iter_mut().zip(self.peaks.iter_mut()) { *o = *p as f32; *p = 0.0; }
    }
    pub fn links(&self) -> usize { self.circuits.len() }
    pub fn misses(&self) -> u64 { self.circuits.iter().map(|c| c.misses).sum() }
    pub fn iterations_per_step(&self) -> f64 {
        self.circuits.iter().map(|c| c.iterations).sum::<u64>() as f64 / (self.steps.max(1)) as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn part(kind: f64, n: [f64; 4], v0: f64, v1: f64, flag: f64) -> [f64; PART] { [kind, n[0], n[1], n[2], n[3], v0, v1, 0.0, 0.0, 0.0, 0.0, flag] }

    #[test]
    fn a_divider_halves_and_a_bad_netlist_is_refused() {
        // in -R- out -R- gnd
        let mut d = vec![2.0, 0.0, 1.0, 2.0];
        d.extend(part(0.0, [0.0, 1.0, 0.0, 0.0], 1e3, 0.0, 0.0));
        d.extend(part(0.0, [1.0, -1.0, 0.0, 0.0], 1e3, 0.0, 0.0));
        let mut c = Circuit::new(&d, 48000.0).unwrap();
        c.settle(0.0).unwrap();
        assert!((c.step(1.0) - 0.5).abs() < 1e-9);
        d[5] = 9.0; // a node that doesn't exist
        assert!(Circuit::new(&d, 48000.0).is_none());
        assert!(Circuit::new(&d[..7], 48000.0).is_none());
    }

    #[test]
    fn the_tube_tables_match_libm() {
        let t = tables();
        let rel = |a: f64, b: f64| ((a - b) / b).abs();
        // Across where the tubes play: u (plate) about -40..40, Cg·vgk -14..40.
        for i in 0..=8000 {
            let x = -40.0 + i as f64 * 0.01;
            let (l, sg) = softplus(t, x);
            assert!(rel(l, x.exp().ln_1p()) < 1e-7, "softplus({x})");
            assert!((sg - 1.0 / (1.0 + (-x).exp())).abs() < 1e-7, "sigmoid({x})");
        }
        // Plate E1 and the grid's softplus/Cg run from nearly nothing to tens of volts.
        for i in 0..=4000 {
            let x = 10f64.powf(-30.0 + i as f64 * 0.01);
            assert!(rel(t.plate.at(x), x.powf(EX)) < 1e-9, "x^1.4 at {x}");
            assert!(rel(t.grid.at(x), x.powf(XI - 1.0)) < 1e-9, "x^0.354 at {x}");
        }
        assert_eq!(t.plate.at(1e-310), 0.0);
    }
}
