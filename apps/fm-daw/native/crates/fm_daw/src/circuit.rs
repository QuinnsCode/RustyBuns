//! The circuit amp in Rust: src/circuit/mna.ts (the solver) and src/circuit/rig.ts
//! (the oversampler, the power stage and the cabinet), step for step, f64 inside,
//! so test/circuit.test.ts can hold both to the same output.
//!
//! The netlist comes in already numbered (`encodeNetlist` in mna.ts): node names
//! are the TypeScript side's business, so both sides number nodes the same way.
//! Layout: `[nodes, input, output, parts]`, then `PART` f64s per part:
//! `[kind, n0, n1, n2, n3, v0, v1, flag]`, node −1 is ground.
//!   R: a b . . ohms . noisy   C: a b . . farads   V: a b . . volts
//!   D: a k . . is n           Opamp: plus minus out hidden rail   Triode: p g k

use std::f64::consts::{PI, SQRT_2};

pub const PART: usize = 8;
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
struct Diode { port: usize, is: f64, nvt: f64, vcrit: f64 }
struct Triode { pk: usize, gk: usize }

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
    diodes: Vec<Diode>,
    triodes: Vec<Triode>,
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
            if k > 5 { return None; }
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
        let mut c = Circuit {
            size: n, m, misses: 0, iterations: 0, noise: 0.0, seed: 0x9e3779b9,
            base_dc: Vec::new(), x: vec![0.0; m], out: desc[2] as usize, in_row: 0,
            supplies: Vec::new(), caps: Vec::new(), hiss: Vec::new(),
            pa: Vec::new(), pb: Vec::new(), poff: Vec::new(), diodes: Vec::new(), triodes: Vec::new(),
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
        fn diode(c: &mut Circuit, a: usize, k: usize, off: f64, is: f64, nf: f64) {
            let nvt = nf * VT;
            let port = port(c, a, k, off);
            c.diodes.push(Diode { port, is, nvt, vcrit: nvt * (nvt / (SQRT_2 * is)).ln() });
        }
        let t = 1.0 / sample_rate;
        c.in_row = source(&mut tr, &mut dc, m, &mut row, desc[1] as usize, n);
        for i in 0..parts {
            let p = part(i);
            let kind = p[0] as u32;
            let (a, b) = (g(p[1])?, g(p[2])?);
            match kind {
                0 => {
                    conductance(&mut tr, m, a, b, 1.0 / p[5]); conductance(&mut dc, m, a, b, 1.0 / p[5]);
                    if p[7] != 0.0 { c.hiss.push(Hiss { a, b, sigma: (((4.0 * 1.380649e-23 * 300.0) / p[5]) * (sample_rate / 2.0)).sqrt() }); }
                }
                1 => {
                    let gc = (2.0 * p[5]) / t;
                    conductance(&mut tr, m, a, b, gc);
                    c.caps.push(Cap { a, b, g: gc, v: 0.0, i: 0.0, ieq: 0.0 });
                }
                2 => { let r = source(&mut tr, &mut dc, m, &mut row, a, b); c.supplies.push((r, p[5])); }
                3 => diode(&mut c, a, b, 0.0, p[5], p[6]),
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
                _ => {
                    let k = g(p[3])?;
                    let pk = port(&mut c, a, k, 0.0);
                    let gk = port(&mut c, b, k, 0.0);
                    c.triodes.push(Triode { pk, gk });
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
        c.j = vec![0.0; kk * kk]; c.f = vec![0.0; kk]; c.jf = vec![0.0; kk * kk];
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

    fn currents(diodes: &[Diode], triodes: &[Triode], poff: &[f64], kk: usize, v: &[f64], i: &mut [f64], jm: &mut [f64]) {
        for d in diodes {
            let vd = v[d.port] - poff[d.port];
            let e = (vd / d.nvt).min(80.0).exp();
            i[d.port] = d.is * (e - 1.0);
            jm[d.port * kk + d.port] = (d.is * e) / d.nvt + GMIN;
        }
        for t in triodes {
            let (vpk, vgk) = (v[t.pk], v[t.gk]);
            let s = (KVB + vpk * vpk).sqrt();
            let u = KP * (1.0 / MU + vgk / s);
            let eu = if u > 30.0 { 0.0 } else { u.exp() };
            let l = if u > 30.0 { u } else { eu.ln_1p() };
            let sg = if u > 30.0 { 1.0 } else { eu / (1.0 + eu) };
            let e1 = (vpk / KP) * l;
            let (mut ip, mut gm, mut gp) = (0.0, 0.0, 0.0);
            if e1 > 0.0 {
                ip = (EX * e1.ln()).exp() / KG1;
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
                let cv = CG * vgk;
                let eg = cv.exp();
                let sp = (if cv > 30.0 { cv } else { eg.ln_1p() }) / CG;
                let pw = ((XI - 1.0) * sp.ln()).exp();
                i[t.gk] = GG * pw * sp + IG0;
                jm[t.gk * kk + t.gk] = GG * XI * pw * (eg / (1.0 + eg)) + GMIN;
            }
        }
    }

    fn limit(diodes: &[Diode], poff: &[f64], v: &mut [f64], old: &[f64]) {
        for d in diodes {
            let off = poff[d.port];
            v[d.port] = pnjlim(v[d.port] - off, old[d.port] - off, d.nvt, d.vcrit) + off;
        }
    }

    /// The resting state with `vin` on the input (mna.ts `settle`); the output's volts. None if singular.
    pub fn settle(&mut self, vin: f64) -> Option<f64> {
        let (m, n, kk) = (self.m, self.size, self.k);
        let mut a = vec![0.0; m * m];
        let mut b = vec![0.0; m];
        let mut old = vec![0.0; kk];
        self.x.fill(0.0); self.v.fill(0.0);
        for s in 1..=10 {
            for it in 0..200 {
                a.copy_from_slice(&self.base_dc); b.fill(0.0);
                b[self.in_row] = vin;
                for &(row, volts) in &self.supplies { b[row] = (volts * s as f64) / 10.0; }
                old.copy_from_slice(&self.v);
                for k in 0..kk { self.v[k] = self.x[self.pa[k]] - self.x[self.pb[k]]; }
                if it > 0 { Self::limit(&self.diodes, &self.poff, &mut self.v, &old); }
                self.j.fill(0.0);
                Self::currents(&self.diodes, &self.triodes, &self.poff, kk, &self.v, &mut self.ip, &mut self.j);
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
        }
        for k in 0..kk { self.v[k] = self.x[self.pa[k]] - self.x[self.pb[k]]; }
        for c in &mut self.caps { c.v = self.x[c.a] - self.x[c.b]; c.i = 0.0; }
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
        Self::add_col(&mut self.z, &self.ainv, m, n, self.in_row, vin);
        for &(row, volts) in &self.supplies { Self::add_col(&mut self.z, &self.ainv, m, n, row, volts); }
        for c in &mut self.caps {
            c.ieq = c.g * c.v + c.i;
            if c.a < n { Self::add_col(&mut self.z, &self.ainv, m, n, c.a, c.ieq); }
            if c.b < n { Self::add_col(&mut self.z, &self.ainv, m, n, c.b, -c.ieq); }
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
                Self::currents(&self.diodes, &self.triodes, &self.poff, kk, &self.v, &mut self.ip, &mut self.j);
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
                Self::limit(&self.diodes, &self.poff, &mut self.v_new, &self.v);
                self.v.copy_from_slice(&self.v_new);
                it += 1;
            }
            self.iterations += it;
            if !converged {
                self.misses += 1;
                self.j.fill(0.0);
                Self::currents(&self.diodes, &self.triodes, &self.poff, kk, &self.v, &mut self.ip, &mut self.j);
                self.f.fill(0.0);
            }
            for k in 0..kk {
                let mut ik = self.ip[k];
                for l in 0..kk { ik += self.j[k * kk + l] * self.f[l]; }
                let o = k * m;
                for r in 0..n { self.x[r] -= self.w[o + r] * ik; }
            }
        } else {
            self.iterations += 1;
        }
        for c in &mut self.caps { c.v = self.x[c.a] - self.x[c.b]; c.i = c.g * c.v - c.ieq; }
        self.x[self.out]
    }
}

/// RBJ cookbook biquad, transposed direct form II (rig.ts `Biquad`).
#[derive(Clone, Copy)]
struct Biquad { b0: f64, b1: f64, b2: f64, a1: f64, a2: f64, z1: f64, z2: f64 }

#[derive(Clone, Copy)]
enum Kind { Lp, Hp, Peak }

impl Biquad {
    fn make(kind: Kind, hz: f64, q: f64, sr: f64, db: f64) -> Biquad {
        let w = (2.0 * PI * hz) / sr;
        let cw = w.cos();
        let al = w.sin() / (2.0 * q);
        let new = |b0, b1, b2, a1, a2| Biquad { b0, b1, b2, a1, a2, z1: 0.0, z2: 0.0 };
        if let Kind::Peak = kind {
            let a = 10f64.powf(db / 40.0);
            let a0 = 1.0 + al / a;
            return new((1.0 + al * a) / a0, (-2.0 * cw) / a0, (1.0 - al * a) / a0, (-2.0 * cw) / a0, (1.0 - al / a) / a0);
        }
        let a0 = 1.0 + al;
        let lp = matches!(kind, Kind::Lp);
        let k = if lp { (1.0 - cw) / 2.0 } else { (1.0 + cw) / 2.0 };
        let s = if lp { 1.0 } else { -1.0 };
        new(k / a0, (s * 2.0 * k) / a0, k / a0, (-2.0 * cw) / a0, (1.0 - al) / a0)
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
    [0.5098, 0.6013, 0.9, 2.5629].iter().map(|&q| Biquad::make(Kind::Lp, hz, q, sr, 0.0)).collect()
}

pub const POWER_VOLTS: f64 = 40.0;

/// Circuits in a row, oversampled, then the power stage and the cabinet (rig.ts `Rig`).
pub struct Rig {
    circuits: Vec<Circuit>,
    gains: Vec<f64>,
    rest: Vec<f64>,
    peaks: Vec<f64>,
    up: Vec<Biquad>,
    down: Vec<Biquad>,
    cab: Vec<Biquad>,
    input_volts: f64,
    power: f64,
    noise: f64,
    steps: u64,
    sample_rate: f64,
    oversample: usize,
}

impl Rig {
    pub fn new(sample_rate: f64, oversample: usize, input_volts: f64, power: f64, cab: bool, noise: f64) -> Rig {
        let hi = sample_rate * oversample as f64;
        let cab = if cab {
            vec![
                Biquad::make(Kind::Hp, 75.0, 0.7, sample_rate, 0.0), Biquad::make(Kind::Peak, 120.0, 1.0, sample_rate, 4.0),
                Biquad::make(Kind::Peak, 1800.0, 1.2, sample_rate, -3.0), Biquad::make(Kind::Peak, 3000.0, 1.2, sample_rate, 3.0),
                Biquad::make(Kind::Lp, 5000.0, 0.54, sample_rate, 0.0), Biquad::make(Kind::Lp, 5000.0, 1.31, sample_rate, 0.0),
            ]
        } else { Vec::new() };
        Rig {
            circuits: Vec::new(), gains: Vec::new(), rest: Vec::new(), peaks: Vec::new(),
            up: butter8(0.45 * sample_rate, hi), down: butter8(0.45 * sample_rate, hi), cab,
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
    pub fn set_power(&mut self, p: f64) { self.power = p; }
    pub fn set_noise(&mut self, n: f64) { self.noise = n; for c in &mut self.circuits { c.noise = n; } }

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
                if self.power > 0.0 { x = ((x * self.power) / POWER_VOLTS).tanh() * POWER_VOLTS; }
                acc = chain(&mut self.down, x);
            }
            io[s] = (if self.cab.is_empty() { acc } else { chain(&mut self.cab, acc) }) as f32;
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
    fn part(kind: f64, n: [f64; 4], v0: f64, v1: f64, flag: f64) -> [f64; PART] { [kind, n[0], n[1], n[2], n[3], v0, v1, flag] }

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
}
