//! A speaker box from its build plan, the Rust side of `packages/gear/src/enclosure.ts`: the same encoded plan
//! (`encodePlan` there) becomes the same sections, walls, response curve and filter. A sealed box is a 2nd-order
//! high-pass, a vented one Small's 4th order with leakage QL 7 split into two sections by Durand-Kerner, a pipe the
//! driver on an open back plus three quarter-wave peaks. Each wall is a band-pass at its (1,1) plate mode taken away
//! from the cone (it moves out when the cone moves in). test/enclosure.test.ts holds the two sides together.

const C: f64 = 343.0;
const RHO: f64 = 1.204;
const QL: f64 = 7.0;
const PI: f64 = std::f64::consts::PI;

/// (b2 s^2 + b1 s + b0) / (s^2 + a1 s + a0).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Section { pub b2: f64, pub b1: f64, pub b0: f64, pub a1: f64, pub a0: f64 }

#[derive(Clone, Copy, Debug)]
pub struct Wall { pub hz: f64, pub leak: f64, pub q: f64 }

#[derive(Clone, Debug)]
pub struct Design { pub series: Vec<Section>, pub walls: Vec<Wall>, pub tune: f64, pub q: f64 }

fn panel_mode(density: f64, e: f64, nu: f64, h: f64, a: f64, b: f64) -> f64 {
    let d = (e * h.powi(3)) / (12.0 * (1.0 - nu.powi(2)));
    (PI / 2.0) * (d / (density * h)).sqrt() * (1.0 / (a * a) + 1.0 / (b * b))
}

/// Roots of a monic polynomial (leading 1 left out), as `roots` in enclosure.ts.
fn roots(c: &[f64]) -> Vec<(f64, f64)> {
    let n = c.len();
    let mut z: Vec<(f64, f64)> = (0..n).map(|k| {
        let t = (2.0 * PI * k as f64) / n as f64 + 0.4;
        (0.9 * t.cos(), 0.9 * t.sin())
    }).collect();
    let eval = |(x, y): (f64, f64)| {
        let (mut re, mut im) = (1.0, 0.0);
        for &k in c { let nr = re * x - im * y + k; let ni = re * y + im * x; re = nr; im = ni; }
        (re, im)
    };
    for _ in 0..500 {
        let mut moved: f64 = 0.0;
        for i in 0..n {
            let (mut dr, mut di) = (1.0, 0.0);
            for j in 0..n {
                if i == j { continue; }
                let (ar, ai) = (z[i].0 - z[j].0, z[i].1 - z[j].1);
                let nr = dr * ar - di * ai; let ni = dr * ai + di * ar; dr = nr; di = ni;
            }
            let (pr, pi) = eval(z[i]);
            let den = dr * dr + di * di;
            let qr = (pr * dr + pi * di) / den; let qi = (pi * dr - pr * di) / den;
            z[i] = (z[i].0 - qr, z[i].1 - qi);
            moved = moved.max(qr.abs() + qi.abs());
        }
        if moved < 1e-14 { break; }
    }
    z
}

fn quartic_sections(c: [f64; 4], w0: f64) -> Vec<Section> {
    let mut z = roots(&c);
    z.sort_by(|p, q| p.1.total_cmp(&q.1).then(p.0.total_cmp(&q.0)));
    [(z[0], z[3]), (z[1], z[2])].iter().map(|&(p, q)| {
        let sum = p.0 + q.0; let prod = p.0 * q.0 - p.1 * q.1;
        Section { b2: 1.0, b1: 0.0, b0: 0.0, a1: -sum * w0, a0: prod * w0 * w0 }
    }).collect()
}

/// `designFrom` in enclosure.ts. None when the plan is cut short.
pub fn design(x: &[f64]) -> Option<Design> {
    if x.len() < 13 { return None; }
    let (kind, fs, qts, vas, vb, tune0, lining) = (x[0], x[1], x[2], x[3], x[4], x[5], x[6]);
    let (density, e, nu, eta, h, n) = (x[7], x[8], x[9], x[10], x[11], x[12] as usize);
    if x.len() < 13 + 2 * n || fs <= 0.0 || qts <= 0.0 || vb <= 0.0 || eta <= 0.0 { return None; }
    let ws = 2.0 * PI * fs;
    let (series, tune, q) = if kind == 0.0 {
        let r = (1.0 + vas / vb).sqrt(); let wc = ws * r; let q = qts * r;
        (vec![Section { b2: 1.0, b1: 0.0, b0: 0.0, a1: wc / q, a0: wc * wc }], fs * r, q)
    } else if kind == 1.0 {
        let hh = tune0 / fs; let al = vas / vb; let sh = hh.sqrt(); let w0 = (ws * 2.0 * PI * tune0).sqrt();
        let a1 = (QL + hh * qts) / (sh * QL * qts);
        let a2 = (hh + (al + 1.0 + hh * hh) * qts * QL) / (hh * qts * QL);
        let a3 = (hh * QL + qts) / (sh * QL * qts);
        (quartic_sections([a1, a2, a3, 1.0], w0), tune0, qts)
    } else {
        let wp = 2.0 * PI * tune0;
        let mut s = vec![Section { b2: 1.0, b1: 0.0, b0: 0.0, a1: ws / qts, a0: ws * ws }];
        for k in 0..3 {
            let kf = k as f64;
            let w = wp * (2.0 * kf + 1.0);
            let gain = (10.0 / (2.0 * kf + 1.0)) * (1.0 - lining);
            let aa = 10f64.powf(gain / 40.0); let qq = 1.4 + 1.8 * kf;
            s.push(Section { b2: 1.0, b1: (aa * w) / qq, b0: w * w, a1: w / (aa * qq), a0: w * w });
        }
        (s, tune0, qts)
    };
    let walls = (0..n).map(|i| {
        let (a, b) = (x[13 + 2 * i], x[14 + 2 * i]);
        let hz = panel_mode(density, e, nu, h, a, b); let w = 2.0 * PI * hz;
        let leak = (0.656 * a * b * RHO * C.powi(2)) / (eta * w * w * density * h * vb);
        Wall { hz, leak, q: 1.0 / eta }
    }).collect();
    Some(Design { series, walls, tune, q })
}

fn at(s: &Section, w: f64) -> (f64, f64) {
    let nr = s.b0 - s.b2 * w * w; let ni = s.b1 * w; let dr = s.a0 - w * w; let di = s.a1 * w;
    let den = dr * dr + di * di;
    ((nr * dr + ni * di) / den, (ni * dr - nr * di) / den)
}

fn wall_section(p: &Wall) -> Section {
    let w0 = 2.0 * PI * p.hz;
    Section { b2: 0.0, b1: w0 / p.q, b0: 0.0, a1: w0 / p.q, a0: w0 * w0 }
}

/// `curveOf` in enclosure.ts: dB at each frequency.
pub fn curve(d: &Design, freqs: &[f64], out: &mut [f64]) {
    for (f, o) in freqs.iter().zip(out.iter_mut()) {
        let w = 2.0 * PI * f;
        let (mut re, mut im) = (1.0, 0.0);
        for s in &d.series { let (a, b) = at(s, w); let nr = re * a - im * b; im = re * b + im * a; re = nr; }
        let (mut wr, mut wi) = (1.0, 0.0);
        for p in &d.walls { let (a, b) = at(&wall_section(p), w); wr -= p.leak * a; wi -= p.leak * b; }
        let tr = re * wr - im * wi; let ti = re * wi + im * wr;
        *o = 10.0 * (tr * tr + ti * ti + 1e-30).log10();
    }
}

type Biquad = [f64; 5];

fn bilinear(s: &Section, sr: f64) -> Biquad {
    let w0 = s.a0.max(1e-9).sqrt().min(PI * sr * 0.9);
    let k = w0 / (w0 / (2.0 * sr)).tan(); let k2 = k * k;
    let a0 = k2 + s.a1 * k + s.a0;
    [
        (s.b2 * k2 + s.b1 * k + s.b0) / a0, (2.0 * (s.b0 - s.b2 * k2)) / a0, (s.b2 * k2 - s.b1 * k + s.b0) / a0,
        (2.0 * (s.a0 - k2)) / a0, (k2 - s.a1 * k + s.a0) / a0,
    ]
}

/// `BoxFilter` in enclosure.ts.
pub struct BoxFilter { series: Vec<Biquad>, walls: Vec<Biquad>, leaks: Vec<f64>, s: Vec<f64>, w: Vec<f64> }

impl BoxFilter {
    pub fn new(d: &Design, sr: f64) -> Self {
        let series: Vec<Biquad> = d.series.iter().map(|s| bilinear(s, sr)).collect();
        let walls: Vec<Biquad> = d.walls.iter().map(|p| bilinear(&wall_section(p), sr)).collect();
        let (ns, nw) = (series.len(), walls.len());
        BoxFilter { series, walls, leaks: d.walls.iter().map(|p| p.leak).collect(), s: vec![0.0; 2 * ns], w: vec![0.0; 2 * nw] }
    }

    pub fn process(&mut self, buf: &mut [f32]) {
        for v in buf.iter_mut() {
            let mut x = *v as f64;
            for (k, q) in self.series.iter().enumerate() {
                let y = q[0] * x + self.s[2 * k];
                self.s[2 * k] = q[1] * x - q[3] * y + self.s[2 * k + 1];
                self.s[2 * k + 1] = q[2] * x - q[4] * y;
                x = y;
            }
            let mut out = x;
            for (k, q) in self.walls.iter().enumerate() {
                let y = q[0] * x + self.w[2 * k];
                self.w[2 * k] = q[1] * x - q[3] * y + self.w[2 * k + 1];
                self.w[2 * k + 1] = q[2] * x - q[4] * y;
                out -= self.leaks[k] * y;
            }
            *v = out as f32;
        }
    }
}

/// # Safety
/// `plan`/`len` must point at `len` f64s (an `fm_alloc_f64` buffer). Null when the plan doesn't read.
#[no_mangle]
pub unsafe extern "C" fn fm_box_new(sample_rate: f64, plan: *const f64, len: u32) -> *mut BoxFilter {
    if plan.is_null() || !(8000.0..=384000.0).contains(&sample_rate) { return std::ptr::null_mut(); }
    match design(std::slice::from_raw_parts(plan, len as usize)) {
        Some(d) => Box::into_raw(Box::new(BoxFilter::new(&d, sample_rate))),
        None => std::ptr::null_mut(),
    }
}

/// # Safety
/// `b` must come from `fm_box_new`, once.
#[no_mangle]
pub unsafe extern "C" fn fm_box_free(b: *mut BoxFilter) { if !b.is_null() { drop(Box::from_raw(b)); } }

/// # Safety
/// `buf` must hold `frames` f32s (an `fm_alloc` buffer).
#[no_mangle]
pub unsafe extern "C" fn fm_box_process(b: *mut BoxFilter, buf: *mut f32, frames: u32) {
    let Some(b) = b.as_mut() else { return };
    if buf.is_null() { return; }
    b.process(std::slice::from_raw_parts_mut(buf, frames as usize));
}

/// The response in dB at `n` frequencies into `out`. 0 when the plan doesn't read.
///
/// # Safety
/// `plan` holds `len` f64s; `freqs` and `out` hold `n` each.
#[no_mangle]
pub unsafe extern "C" fn fm_box_curve(plan: *const f64, len: u32, freqs: *const f64, out: *mut f64, n: u32) -> u32 {
    if plan.is_null() || freqs.is_null() || out.is_null() { return 0; }
    let Some(d) = design(std::slice::from_raw_parts(plan, len as usize)) else { return 0 };
    curve(&d, std::slice::from_raw_parts(freqs, n as usize), std::slice::from_raw_parts_mut(out, n as usize));
    1
}

#[cfg(test)]
mod tests {
    use super::*;

    // A 12" (Fs 24.2, Qts 0.39, Vas 84.1 L) in 35 L sealed: Qtc 0.39 sqrt(1 + 84.1/35) = 0.72, fc 44.6 Hz.
    fn sub() -> Vec<f64> { vec![0.0, 24.2, 0.39, 0.0841, 0.035, 0.0, 0.0, 750.0, 4.0e9, 0.25, 0.03, 0.019, 1.0, 0.34, 0.34] }

    #[test]
    fn sealed_lands_on_the_textbook_numbers() {
        let d = design(&sub()).unwrap();
        assert!((d.q - 0.7187).abs() < 1e-3, "{}", d.q);
        assert!((d.tune - 44.6).abs() < 0.1, "{}", d.tune);
        let mut out = [0.0; 2];
        curve(&Design { walls: vec![], ..d.clone() }, &[d.tune, 2000.0], &mut out);
        // A 2nd-order high-pass is 20 log10(Q) at its own resonance.
        assert!((out[0] - 20.0 * d.q.log10()).abs() < 1e-9, "{:?}", out);
        assert!(out[1].abs() < 0.01);
    }

    #[test]
    fn a_vented_box_splits_into_two_real_sections() {
        let x = vec![1.0, 56.0, 0.52, 0.00453, 0.0044, 60.0, 0.0, 750.0, 4.0e9, 0.25, 0.03, 0.0127, 0.0];
        let d = design(&x).unwrap();
        assert_eq!(d.series.len(), 2);
        for s in &d.series { assert!(s.a0 > 0.0 && s.a1 > 0.0, "{:?}", s); }
        let mut out = [0.0; 1];
        curve(&d, &[5.0], &mut out);
        assert!(out[0] < -60.0, "24 dB an octave below tuning: {}", out[0]);
    }

    #[test]
    fn the_filter_stays_finite_and_a_short_plan_is_refused() {
        let d = design(&sub()).unwrap();
        let mut f = BoxFilter::new(&d, 48000.0);
        let mut buf = vec![0f32; 4800]; buf[0] = 1.0;
        f.process(&mut buf);
        assert!(buf.iter().all(|v| v.is_finite()));
        assert!(design(&sub()[..10]).is_none());
    }
}
