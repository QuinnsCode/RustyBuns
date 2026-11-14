// Shape: the master EQ. Up to eight bands in series (low cut, shelves, bells,
// notch, band pass, high cut), each a trapezoidal state-variable filter
// (Andrew Simper's linear trap SVF), which stays stable and click-free while
// its frequency, gain and Q move, unlike a direct-form biquad.
//
// Why these choices:
// - Series, not parallel: each band filters the output of the last, so their
//   phase shifts add up but never cancel each other into ripples. The order of
//   bands doesn't change the sound (they're linear), only rounding.
// - Minimum phase, zero latency: a filter that bends the level also bends the
//   phase near its corner. A steep cut rotates it most (a 48 dB/oct cut turns a
//   full 360 degrees around its corner). The page draws that curve too.
// - Steep cuts are Butterworth stacks: an order-N cut is N/2 second-order
//   sections with the Butterworth Q of each (plus a one-pole when N is odd), so
//   the passband stays flat. Q above 0.707 lifts only the sharpest section,
//   which puts a resonant bump at the corner without a dent before it.
// - 3 and 9 dB/oct are half orders: no finite filter falls at exactly 3 dB/oct,
//   so a chain of seven first-order shelves, poles and zeros interleaved a
//   factor of 3 apart, stands in for sqrt(s / (s + F)). It stays within 0.06 dB
//   of the real thing for eight octaves past the corner. 9 is that chain plus a
//   one-pole. Both put -3 dB at the corner, like every other slope.
// - Every frequency is prewarped (tan), so a corner lands where it's drawn.
//   Bells go further: the bilinear transform squeezes a high bell narrow (a
//   15 kHz bell at 48 kHz), so a bell's biquad is matched to its analog shape
//   (Vicanek, "Matched Second Order Digital Filters", 2016) and mapped back
//   onto the SVF. Shelves and cuts still cramp a little near Nyquist; the page
//   draws the real digital response, so what you see is what you hear.
// - Listening to a band: one more slot after the bands (index BANDS) is a band
//   pass the page turns on while a dot is held, to hear only that range.
//
// The TypeScript twin is src/engine/eq.ts, the same arithmetic in the same
// order. Parameters glide over ~20 ms; turning a band on or off crossfades it.
// Ends in a peak limiter and a clamp at CEILING: a boost adds level, and
// nothing leaves louder than -1 dBFS. No allocation in process().

use crate::CEILING;
use std::f64::consts::PI;

pub const BANDS: usize = 8;
/// Most second-order sections in one band: a 96 dB/oct cut.
const SECS: usize = 8;
/// Most first-order sections: the half-order chain and a one-pole (9 dB/oct).
const FOS: usize = 8;
const HALF_N: usize = 7;
/// The chain's top pole, as a fraction of F (fitted to sqrt(s / (s + F))), and each shelf's floor, 1/sqrt(3).
const HALF_A: f64 = 0.77;
const HALF_G: f64 = 0.5773502691896258;
/// F for -3 dB at the corner, per half order: sqrt(2^(1/m) - 1) for m = 1/2 and 3/2 (times the corner on a low cut, divided into it on a high cut).
const HALF_F: [f64; 2] = [1.7320508075688772, 0.7664209365408798];
pub const BELL: u32 = 0;
pub const LOW_SHELF: u32 = 1;
pub const HIGH_SHELF: u32 = 2;
pub const LOW_CUT: u32 = 3;
pub const HIGH_CUT: u32 = 4;
pub const NOTCH: u32 = 5;
pub const BAND_PASS: u32 = 6;
/// Frames between coefficient updates while parameters glide.
const BLOCK: usize = 16;
const GLIDE_S: f64 = 0.02;
const BUTTERWORTH_Q: f64 = std::f64::consts::FRAC_1_SQRT_2;

#[derive(Clone, Copy, Default)]
struct Sec { a1: f64, a2: f64, a3: f64, m0: f64, m1: f64, m2: f64 }

/// A first-order TPT section: G = g / (1 + g), out = lp * low + hp * high.
#[derive(Clone, Copy, Default)]
struct Fo { g: f64, lp: f64, hp: f64 }

#[derive(Clone, Copy, Default)]
struct Band {
    kind: u32,
    /// Cuts: the slope in half orders (3 dB/oct each). Others: 0.
    order: usize,
    on: bool,
    // targets and the gliding values: log2 Hz, dB, ln Q, crossfade 0..1
    f: f64, g: f64, q: f64,
    f_now: f64, g_now: f64, q_now: f64,
    mix: f64,
    secs: [Sec; SECS],
    nsec: usize,
    fos: [Fo; FOS],
    nfo: usize,
    // state per channel: [ic1, ic2] per section, and one per first-order section
    s: [[[f64; 2]; SECS]; 2],
    p: [[f64; FOS]; 2],
}

pub struct Eq {
    sr: f64,
    /// The bands, then the listen band.
    bands: [Band; BANDS + 1],
    glide: f64,
    lim_env: f64,
    lim_rel: f64,
    tick: usize,
}

fn clampf(v: f64, lo: f64, hi: f64, dflt: f64) -> f64 { if v.is_finite() { v.max(lo).min(hi) } else { dflt } }

/// A cut's slope in half orders (3 dB/oct each), 1..32. Only 3 and 9 dB/oct are half orders; 15 and up round to whole ones.
pub fn order_of(slope: f64) -> usize {
    let h = clampf((slope / 3.0).round(), 1.0, 32.0, 4.0) as usize;
    if h % 2 == 1 && h > 3 { h + 1 } else { h }
}

fn fo(g: f64, lp: f64, hp: f64) -> Fo { Fo { g: g / (1.0 + g), lp, hp } }

fn sec(g: f64, k: f64, m0: f64, m1: f64, m2: f64) -> Sec {
    let a1 = 1.0 / (1.0 + g * (g + k));
    let a2 = g * a1;
    Sec { a1, a2, a3: g * a2, m0, m1, m2 }
}

/// A bell matched to its analog shape up to Nyquist (Vicanek 2016): poles by impulse
/// invariance, zeros fitted so the level is right at DC, the centre and Nyquist, then the
/// biquad mapped back onto the SVF so it still glides. w0 = 2 pi fc / sr, k = 1 / (Q sqrt(G)), G linear gain.
fn bell(w0: f64, k: f64, gl: f64) -> Sec {
    let z = k / 2.0;
    let e = (-z * w0).exp();
    let a1 = if z <= 1.0 { -2.0 * e * ((1.0 - z * z).sqrt() * w0).cos() } else { -2.0 * e * ((z * z - 1.0).sqrt() * w0).cosh() };
    let a2 = e * e;
    let (d0, d2) = (1.0 + a1 + a2, 1.0 - a1 + a2);
    let (big_a0, big_a1, big_a2) = (d0 * d0, d2 * d2, -4.0 * a2);
    let sn = (w0 / 2.0).sin();
    let p1 = sn * sn;
    let p0 = 1.0 - p1;
    let p2 = 4.0 * p0 * p1;
    let r1 = (big_a0 * p0 + big_a1 * p1 + big_a2 * p2) * gl * gl;
    let r2 = (-big_a0 + big_a1 + 4.0 * (p0 - p1) * big_a2) * gl * gl;
    let big_b0 = big_a0;
    let big_b2 = (r1 - r2 * p1 - big_b0) / (4.0 * p1 * p1);
    let big_b1 = r2 + big_b0 + 4.0 * (p1 - p0) * big_b2;
    let (s0, s1) = (big_b0.sqrt(), big_b1.max(0.0).sqrt());
    let w = 0.5 * (s0 + s1);
    let b0 = 0.5 * (w + (w * w + big_b2).max(0.0).sqrt());
    let b1 = 0.5 * (s0 - s1);
    let b2 = -big_b2 / (4.0 * b0);
    // H(z) to the SVF's m0 + (m1 s + m2) / (s^2 + k s + 1) through z = (1 + g s) / (1 - g s)
    let g = (d0 / d2).sqrt();
    let kk = (2.0 * (1.0 - a2)) / (d2 * g);
    let (n2, n1, n0) = ((b0 - b1 + b2) / d2, (2.0 * (b0 - b2)) / d2, (b0 + b1 + b2) / d2);
    sec(g, kk, n2, n1 / g - n2 * kk, n0 / (g * g) - n2)
}

impl Band {
    /// Fills secs/nsec/pole from the gliding values.
    fn design(&mut self, sr: f64) {
        let fc = (2.0f64).powf(self.f_now).min(0.49 * sr);
        let w = ((PI * fc) / sr).tan();
        let q = self.q_now.exp();
        let a = (10.0f64).powf(self.g_now / 40.0);
        self.nfo = 0;
        self.nsec = 1;
        match self.kind {
            LOW_SHELF => { let g = w / a.sqrt(); let k = 1.0 / q; self.secs[0] = sec(g, k, 1.0, k * (a - 1.0), a * a - 1.0); }
            HIGH_SHELF => { let g = w * a.sqrt(); let k = 1.0 / q; self.secs[0] = sec(g, k, a * a, k * (1.0 - a) * a, 1.0 - a * a); }
            NOTCH => { let k = 1.0 / q; self.secs[0] = sec(w, k, 1.0, -k, 0.0); }
            BAND_PASS => { let k = 1.0 / q; self.secs[0] = sec(w, k, 0.0, k, 0.0); }
            LOW_CUT | HIGH_CUT => {
                let low = self.kind == LOW_CUT;
                let (pl, ph) = if low { (0.0, 1.0) } else { (1.0, 0.0) };
                let h = self.order;
                if h % 2 == 0 {
                    let n = h / 2;
                    self.nsec = n / 2;
                    for i in 0..self.nsec {
                        let theta = ((2 * i + 1) as f64 * PI) / (2 * n) as f64;
                        let mut qs = 1.0 / (2.0 * theta.cos());
                        // the last section is the sharpest: it carries the resonance
                        if i + 1 == self.nsec { qs *= q / BUTTERWORTH_Q; }
                        let k = 1.0 / qs;
                        self.secs[i] = if low { sec(w, k, 1.0, -k, -1.0) } else { sec(w, k, 0.0, 0.0, 1.0) };
                    }
                    if n % 2 == 1 { self.fos[0] = fo(w, pl, ph); self.nfo = 1; }
                } else {
                    // a half order: the shelf chain at F, plus a one-pole there for 9 dB/oct.
                    // A high cut is the low cut mirrored about F: poles at F^2 / p, each shelf lp + g hp.
                    self.nsec = 0;
                    let wf = if low { w * HALF_F[h / 2] } else { w / HALF_F[h / 2] };
                    if h == 3 { self.fos[0] = fo(wf, pl, ph); self.nfo = 1; }
                    let mut p = HALF_A * wf;
                    for _ in 0..HALF_N {
                        let i = self.nfo;
                        self.fos[i] = if low { fo(p, HALF_G, 1.0) } else { fo((wf * wf) / p, 1.0, HALF_G) };
                        self.nfo += 1;
                        p /= 3.0;
                    }
                }
            }
            _ => { self.secs[0] = bell((2.0 * PI * fc) / sr, 1.0 / (q * a), a * a); }
        }
    }

    #[inline]
    fn run(&mut self, ch: usize, x: f64) -> f64 {
        let mut y = x;
        for i in 0..self.nfo {
            let c = &self.fos[i];
            let s = &mut self.p[ch][i];
            let v = (y - *s) * c.g;
            let lp = v + *s;
            *s = lp + v;
            y = c.lp * lp + c.hp * (y - lp);
        }
        for i in 0..self.nsec {
            let c = &self.secs[i];
            let s = &mut self.s[ch][i];
            let v3 = y - s[1];
            let v1 = c.a1 * s[0] + c.a2 * v3;
            let v2 = s[1] + c.a2 * s[0] + c.a3 * v3;
            s[0] = 2.0 * v1 - s[0];
            s[1] = 2.0 * v2 - s[1];
            y = c.m0 * y + c.m1 * v1 + c.m2 * v2;
        }
        x + (y - x) * self.mix
    }

    fn clear(&mut self) { self.s = [[[0.0; 2]; SECS]; 2]; self.p = [[0.0; FOS]; 2]; }
}

impl Eq {
    pub fn new(sr: f64) -> Eq {
        Eq {
            sr,
            bands: [Band::default(); BANDS + 1],
            glide: 1.0 - (-(BLOCK as f64) / (GLIDE_S * sr)).exp(),
            lim_env: 0.0,
            lim_rel: (-1.0 / (0.1 * sr)).exp(),
            tick: 0,
        }
    }

    /// One band's settings: kind (BELL..BAND_PASS), Hz, dB, Q, cut slope in dB/oct, on. Slot BANDS is the listen band.
    pub fn set_band(&mut self, i: usize, kind: u32, freq: f64, gain: f64, q: f64, slope: f64, on: bool) {
        if i > BANDS { return; }
        let sr = self.sr;
        let b = &mut self.bands[i];
        let kind = if kind <= BAND_PASS { kind } else { BELL };
        let order = if kind == LOW_CUT || kind == HIGH_CUT { order_of(slope) } else { 0 };
        let was_off = !b.on && b.mix == 0.0;
        if kind != b.kind || order != b.order { b.clear(); }
        b.kind = kind;
        b.order = order;
        b.on = on;
        b.f = clampf(freq, 20.0, 20000.0, 1000.0).log2();
        b.g = clampf(gain, -30.0, 30.0, 0.0);
        b.q = clampf(q, 0.1, 18.0, BUTTERWORTH_Q).ln();
        if was_off { b.f_now = b.f; b.g_now = b.g; b.q_now = b.q; b.clear(); }
        b.design(sr);
    }

    pub fn reset(&mut self) {
        for b in self.bands.iter_mut() { b.clear(); b.mix = if b.on { 1.0 } else { 0.0 }; }
        self.lim_env = 0.0;
    }

    fn live(&self) -> bool { self.bands.iter().any(|b| b.on || b.mix > 0.0) }

    /// Filters interleaved stereo `buf` in place.
    pub fn process(&mut self, buf: &mut [f32], frames: usize) {
        let n = frames.min(buf.len() / 2);
        if !self.live() { self.lim_env = 0.0; return; }
        let sr = self.sr;
        for f in 0..n {
            if self.tick == 0 {
                let c = self.glide;
                for b in self.bands.iter_mut() {
                    let target = if b.on { 1.0 } else { 0.0 };
                    if b.mix == target && b.f_now == b.f && b.g_now == b.g && b.q_now == b.q { continue; }
                    b.f_now += (b.f - b.f_now) * c;
                    b.g_now += (b.g - b.g_now) * c;
                    b.q_now += (b.q - b.q_now) * c;
                    b.mix += (target - b.mix) * c;
                    if (b.f - b.f_now).abs() < 1e-6 { b.f_now = b.f; }
                    if (b.g - b.g_now).abs() < 1e-6 { b.g_now = b.g; }
                    if (b.q - b.q_now).abs() < 1e-6 { b.q_now = b.q; }
                    if (target - b.mix).abs() < 1e-4 { b.mix = target; if !b.on { b.clear(); } }
                    b.design(sr);
                }
            }
            self.tick = (self.tick + 1) % BLOCK;
            let mut l = buf[f * 2] as f64;
            let mut r = buf[f * 2 + 1] as f64;
            let (dl, dr) = (l, r);
            for b in self.bands.iter_mut() {
                if b.mix == 0.0 { continue; }
                l = b.run(0, l);
                r = b.run(1, r);
            }
            if !l.is_finite() || !r.is_finite() {
                for b in self.bands.iter_mut() { b.clear(); }
                l = if dl.is_finite() { dl } else { 0.0 };
                r = if dr.is_finite() { dr } else { 0.0 };
            }
            let pk = l.abs().max(r.abs());
            self.lim_env = if pk > self.lim_env { pk } else { pk + (self.lim_env - pk) * self.lim_rel };
            let lim = if self.lim_env > CEILING { CEILING / self.lim_env } else { 1.0 };
            buf[f * 2] = (l * lim).max(-CEILING).min(CEILING) as f32;
            buf[f * 2 + 1] = (r * lim).max(-CEILING).min(CEILING) as f32;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Level of a steady sine after the EQ, dB relative to its input.
    fn gain_at(eq: &mut Eq, hz: f64) -> f64 {
        let sr = 48000.0;
        let mut buf = vec![0f32; 2 * 48000];
        let amp = 0.05;
        for f in 0..48000 { let v = (amp * (2.0 * PI * hz * f as f64 / sr).sin()) as f32; buf[f * 2] = v; buf[f * 2 + 1] = v; }
        eq.reset();
        eq.process(&mut buf, 48000);
        // RMS over the second half (the glide and ring-in are done), against the sine's own RMS
        let ms = buf[48000..].iter().map(|x| (*x as f64) * (*x as f64)).sum::<f64>() / 48000.0;
        10.0 * (ms / (amp * amp / 2.0)).log10()
    }

    #[test]
    fn a_high_bell_keeps_its_width_and_the_listen_band_plays_only_its_range() {
        // +12 dB at 15 kHz, Q 2: at 10 kHz the analog bell is +3.5 dB; the bilinear one was squeezed to +1.6
        let mut eq = Eq::new(48000.0);
        eq.set_band(0, BELL, 15000.0, 12.0, 2.0, 0.0, true);
        assert!((gain_at(&mut eq, 15000.0) - 12.0).abs() < 0.3);
        assert!(gain_at(&mut eq, 10000.0) > 3.0);
        let mut eq = Eq::new(48000.0);
        eq.set_band(BANDS, BAND_PASS, 1000.0, 0.0, 4.0, 12.0, true);
        assert!(gain_at(&mut eq, 1000.0).abs() < 0.3);
        assert!(gain_at(&mut eq, 100.0) < -25.0);
    }

    #[test]
    fn bells_shelves_and_cuts_land_where_set() {
        let cases: [(u32, f64, f64, f64, f64, f64, f64); 6] = [
            (BELL, 1000.0, 6.0, 1.0, 0.0, 1000.0, 6.0),
            (BELL, 1000.0, -12.0, 4.0, 0.0, 1000.0, -12.0),
            (LOW_SHELF, 200.0, -6.0, 0.707, 0.0, 30.0, -6.0),
            (HIGH_SHELF, 4000.0, 6.0, 0.707, 0.0, 16000.0, 6.0),
            (LOW_CUT, 100.0, 0.0, 0.707, 24.0, 100.0, -3.0),
            (HIGH_CUT, 2000.0, 0.0, 0.707, 48.0, 2000.0, -3.0),
        ];
        let cases: Vec<_> = cases.into_iter().chain([
            (LOW_CUT, 1000.0, 0.0, 0.707, 3.0, 1000.0, -3.0),
            (LOW_CUT, 1000.0, 0.0, 0.707, 3.0, 125.0, -11.4),
            (HIGH_CUT, 1000.0, 0.0, 0.707, 9.0, 1000.0, -3.0),
            (HIGH_CUT, 500.0, 0.0, 0.707, 9.0, 4000.0, -24.1),
        ]).collect();
        for (kind, f, g, q, slope, at, want) in cases {
            let mut eq = Eq::new(48000.0);
            eq.set_band(0, kind, f, g, q, slope, true);
            let got = gain_at(&mut eq, at);
            assert!((got - want).abs() < 0.6, "kind {kind} at {at} Hz: {got:.2} dB, want {want}");
        }
    }
}
