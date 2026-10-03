//! FM DAW engine. Mirrors src/engine/engine.ts line for line (f64 inside, f32
//! out) so the golden test can hold both to the same output.
//!
//! One crate, two builds: a cdylib for the desktop host (bun:ffi, used by the
//! golden test and the host benchmark) and wasm32-unknown-unknown for the
//! AudioWorklet, where it renders live audio. Both use the same `extern "C"`
//! surface; the wasm build adds fm_alloc/fm_dealloc so JS can own buffers in
//! linear memory.
//!
//! `fm_render` is the hot path: no allocation, no locks.

use std::f64::consts::PI;

pub const TRACKS: usize = 8;
pub const OPS: usize = 4;
pub const NPARAMS: usize = 34;
pub const VOICES: usize = 8;
pub const CEILING: f64 = 0.891;
pub const MOD_DEPTH: f64 = 1.5;
pub const FB_DEPTH: f64 = 0.4;

const P_ALGO: usize = 24;
const P_FEEDBACK: usize = 25;
const P_PITCH_AMT: usize = 26;
const P_PITCH_DECAY: usize = 27;
const P_NOISE: usize = 28;
const P_NOISE_DECAY: usize = 29;
const P_NOISE_TONE: usize = 30;
const P_GAIN: usize = 31;
const P_PAN: usize = 32;
const P_VEL: usize = 33;

const OP_RANGES: [(f64, f64); 6] = [(0.25, 16.0), (0.0, 1.0), (0.0005, 4.0), (0.005, 8.0), (0.0, 1.0), (0.005, 8.0)];
const TAIL_RANGES: [(f64, f64); 10] = [
    (0.0, 3.0), (0.0, 1.0), (0.0, 48.0), (0.005, 2.0), (0.0, 1.0),
    (0.005, 2.0), (0.0, 1.0), (0.0, 1.0), (-1.0, 1.0), (0.0, 1.0),
];

fn range(i: usize) -> (f64, f64) {
    if i < OPS * 6 { OP_RANGES[i % 6] } else { TAIL_RANGES[i - OPS * 6] }
}

fn clamp_param(i: usize, v: f64) -> f64 {
    let (lo, hi) = range(i);
    if v.is_finite() { v.max(lo).min(hi) } else { lo }
}

const CARRIERS: [[u8; 4]; 4] = [[1, 0, 0, 0], [1, 0, 1, 0], [1, 0, 0, 0], [1, 1, 1, 1]];
const GAIN_SMOOTH: f64 = 0.002;
const MASTER_SMOOTH: f64 = 0.0005;
const SILENT: f64 = 1e-5;
const TAU: f64 = 2.0 * PI;

fn decay_coef(seconds: f64, sr: f64) -> f64 { ((0.001f64).ln() / (seconds * sr)).exp() }

#[derive(Clone, Copy, Default)]
struct Voice {
    active: bool, gate: bool, id: u32, born: f64,
    freq: f64, amp: f64, pitch_env: f64, noise_env: f64, noise_lp: f64,
    fb1: f64, fb2: f64,
    phase: [f64; OPS], env: [f64; OPS], stage: [u8; OPS],
}

#[derive(Clone, Copy)]
struct Track {
    params: [f64; NPARAMS],
    atk_inc: [f64; OPS], dec_coef: [f64; OPS], rel_coef: [f64; OPS],
    pitch_coef: f64, noise_coef: f64, pan_l: f64, pan_r: f64,
    muted: bool, gain_now: f64,
    voices: [Voice; VOICES],
}

impl Default for Track {
    fn default() -> Track {
        Track {
            params: [0.0; NPARAMS],
            atk_inc: [0.0; OPS], dec_coef: [0.0; OPS], rel_coef: [0.0; OPS],
            pitch_coef: 0.0, noise_coef: 0.0, pan_l: 0.0, pan_r: 0.0,
            muted: false, gain_now: 0.0,
            voices: [Voice::default(); VOICES],
        }
    }
}

pub struct Engine {
    sr: f64,
    tracks: [Track; TRACKS],
    births: f64,
    rng: u32,
    click_env: f64, click_phase: f64, click_freq: f64, click_coef: f64,
    dc_xl: f64, dc_yl: f64, dc_xr: f64, dc_yr: f64, dc_r: f64,
    master_target: f64, master: f64,
    lim_env: f64, lim_rel: f64,
    peak_l: f64, peak_r: f64, min_gain: f64, nans: f64,
}

impl Engine {
    pub fn new(sr: f64) -> Engine {
        let mut e = Engine {
            sr,
            tracks: [Track::default(); TRACKS],
            births: 0.0,
            rng: 0x9e3779b9,
            click_env: 0.0, click_phase: 0.0, click_freq: 0.0, click_coef: decay_coef(0.04, sr),
            dc_xl: 0.0, dc_yl: 0.0, dc_xr: 0.0, dc_yr: 0.0, dc_r: 1.0 - (TAU * 10.0) / sr,
            master_target: 0.25, master: 0.25,
            lim_env: 0.0, lim_rel: (-1.0 / (0.1 * sr)).exp(),
            peak_l: 0.0, peak_r: 0.0, min_gain: 1.0, nans: 0.0,
        };
        for t in 0..TRACKS { for i in 0..NPARAMS { e.set_param(t, i, 0.0); } }
        e
    }

    pub fn set_param(&mut self, t: usize, i: usize, value: f64) {
        if t >= TRACKS || i >= NPARAMS { return; }
        let v = clamp_param(i, value);
        let sr = self.sr;
        let tr = &mut self.tracks[t];
        tr.params[i] = v;
        if i < OPS * 6 {
            let (op, f) = (i / 6, i % 6);
            if f == 2 { tr.atk_inc[op] = 1.0 / (v * sr); }
            else if f == 3 { tr.dec_coef[op] = decay_coef(v, sr); }
            else if f == 5 { tr.rel_coef[op] = decay_coef(v, sr); }
        } else if i == P_PITCH_DECAY { tr.pitch_coef = decay_coef(v, sr); }
        else if i == P_NOISE_DECAY { tr.noise_coef = decay_coef(v, sr); }
        else if i == P_PAN {
            let angle = ((v + 1.0) * PI) / 4.0;
            tr.pan_l = angle.cos();
            tr.pan_r = angle.sin();
        }
    }

    pub fn set_mute(&mut self, t: usize, muted: bool) { if t < TRACKS { self.tracks[t].muted = muted; } }

    pub fn set_master(&mut self, gain: f64) { self.master_target = if gain.is_finite() { gain.max(0.0).min(1.0) } else { 0.0 }; }

    pub fn note_on(&mut self, t: usize, id: u32, midi: f64, velocity: f64) {
        if t >= TRACKS || !midi.is_finite() || !velocity.is_finite() { return; }
        self.births += 1.0;
        let births = self.births;
        let tr = &mut self.tracks[t];
        let mut slot = 0;
        let mut oldest = f64::INFINITY;
        for v in 0..VOICES {
            if !tr.voices[v].active { slot = v; break; }
            if tr.voices[v].born < oldest { oldest = tr.voices[v].born; slot = v; }
        }
        let vel = velocity.max(0.0).min(1.0);
        let vs = tr.params[P_VEL];
        let vo = &mut tr.voices[slot];
        vo.active = true; vo.gate = true; vo.id = id;
        vo.born = births;
        vo.freq = 440.0 * (2.0f64).powf((midi.max(0.0).min(127.0) - 69.0) / 12.0);
        vo.amp = 1.0 - vs + vs * vel;
        vo.pitch_env = 1.0; vo.noise_env = 1.0; vo.noise_lp = 0.0;
        vo.fb1 = 0.0; vo.fb2 = 0.0;
        vo.phase = [0.0; OPS]; vo.env = [0.0; OPS]; vo.stage = [0; OPS];
    }

    pub fn note_off(&mut self, t: usize, id: u32) {
        if t >= TRACKS { return; }
        for vo in self.tracks[t].voices.iter_mut() {
            if vo.active && vo.gate && vo.id == id { vo.gate = false; vo.stage = [2; OPS]; }
        }
    }

    pub fn all_off(&mut self) {
        for tr in self.tracks.iter_mut() {
            for vo in tr.voices.iter_mut() {
                if vo.active && vo.gate { vo.gate = false; vo.stage = [2; OPS]; }
            }
        }
    }

    pub fn panic(&mut self) {
        for tr in self.tracks.iter_mut() {
            for vo in tr.voices.iter_mut() { vo.active = false; vo.gate = false; vo.env = [0.0; OPS]; }
        }
        self.click_env = 0.0;
        self.dc_xl = 0.0; self.dc_yl = 0.0; self.dc_xr = 0.0; self.dc_yr = 0.0;
        self.lim_env = 0.0;
    }

    pub fn click(&mut self, accent: bool) {
        self.click_freq = if accent { 1760.0 } else { 1320.0 };
        self.click_env = 0.3;
        self.click_phase = 0.0;
    }

    #[inline]
    fn next_noise(&mut self) -> f64 {
        let mut x = self.rng;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.rng = x;
        (x as f64 / 4294967296.0) * 2.0 - 1.0
    }

    pub fn render(&mut self, out: &mut [f32], frames: usize) {
        let n = frames.min(out.len() / 2);
        let sr = self.sr;
        for f in 0..n {
            let (mut l, mut r) = (0.0f64, 0.0f64);
            for t in 0..TRACKS {
                let gain_target = if self.tracks[t].muted { 0.0 } else { self.tracks[t].params[P_GAIN] };
                self.tracks[t].gain_now += (gain_target - self.tracks[t].gain_now) * GAIN_SMOOTH;
                let algo = self.tracks[t].params[P_ALGO] as usize;
                let carriers = CARRIERS[algo];
                let nc = (carriers[0] + carriers[1] + carriers[2] + carriers[3]) as f64;
                let fb_amt = self.tracks[t].params[P_FEEDBACK] * FB_DEPTH;
                let pitch_amt = self.tracks[t].params[P_PITCH_AMT];
                let noise = self.tracks[t].params[P_NOISE];
                let tone = 0.05 + 0.95 * self.tracks[t].params[P_NOISE_TONE];
                let mut mono = 0.0;
                for v in 0..VOICES {
                    if !self.tracks[t].voices[v].active { continue; }
                    let pm = if pitch_amt > 0.0 {
                        (2.0f64).powf((pitch_amt * self.tracks[t].voices[v].pitch_env) / 12.0)
                    } else { 1.0 };
                    let pitch_coef = self.tracks[t].pitch_coef;
                    self.tracks[t].voices[v].pitch_env *= pitch_coef;
                    let base = self.tracks[t].voices[v].freq * pm;
                    let (mut o3, mut o2, mut o1) = (0.0f64, 0.0f64, 0.0f64);
                    let mut carrier_sum = 0.0;
                    let mut loudest = 0.0;
                    let mut attacking = false;
                    {
                        let tr = &mut self.tracks[t];
                        let vo = &mut tr.voices[v];
                        for op in (0..OPS).rev() {
                            let mut e = vo.env[op];
                            let st = vo.stage[op];
                            if st == 0 {
                                e += tr.atk_inc[op];
                                if e >= 1.0 { e = 1.0; vo.stage[op] = 1; }
                                attacking = true;
                            } else if st == 1 {
                                let s = tr.params[op * 6 + 4];
                                e = s + (e - s) * tr.dec_coef[op];
                            } else { e *= tr.rel_coef[op]; }
                            vo.env[op] = e;
                            let m = if op == 3 { (vo.fb1 + vo.fb2) * 0.5 * fb_amt }
                                else if algo == 0 { (if op == 2 { o3 } else if op == 1 { o2 } else { o1 }) * MOD_DEPTH }
                                else if algo == 1 { if op == 2 { o3 * MOD_DEPTH } else if op == 0 { o1 * MOD_DEPTH } else { 0.0 } }
                                else if algo == 2 { if op == 0 { (o1 + o2 + o3) * MOD_DEPTH } else { 0.0 } }
                                else { 0.0 };
                            let ph = vo.phase[op];
                            let y = (TAU * (ph + m)).sin() * e * tr.params[op * 6 + 1];
                            let mut np = ph + (base * tr.params[op * 6]) / sr;
                            np -= np.floor();
                            vo.phase[op] = np;
                            if op == 3 { vo.fb2 = vo.fb1; vo.fb1 = y; o3 = y; }
                            else if op == 2 { o2 = y; }
                            else if op == 1 { o1 = y; }
                            if carriers[op] == 1 { carrier_sum += y; if e > loudest { loudest = e; } }
                        }
                    }
                    let mut ns = 0.0;
                    if noise > 0.0 {
                        let nz = self.next_noise();
                        let noise_coef = self.tracks[t].noise_coef;
                        let vo = &mut self.tracks[t].voices[v];
                        let lp = vo.noise_lp + tone * (nz - vo.noise_lp);
                        vo.noise_lp = lp;
                        ns = lp * vo.noise_env * noise;
                        vo.noise_env *= noise_coef;
                        if vo.noise_env > loudest { loudest = vo.noise_env; }
                    }
                    let vo = &mut self.tracks[t].voices[v];
                    mono += (carrier_sum / nc + ns) * vo.amp;
                    if !attacking && loudest < SILENT { vo.active = false; }
                }
                let tr = &self.tracks[t];
                mono *= tr.gain_now;
                l += mono * tr.pan_l;
                r += mono * tr.pan_r;
            }
            if self.click_env > SILENT {
                let c = (TAU * self.click_phase).sin() * self.click_env;
                self.click_phase += self.click_freq / sr;
                self.click_phase -= self.click_phase.floor();
                self.click_env *= self.click_coef;
                l += c; r += c;
            }
            let yl = l - self.dc_xl + self.dc_r * self.dc_yl;
            self.dc_xl = l; self.dc_yl = yl;
            let yr = r - self.dc_xr + self.dc_r * self.dc_yr;
            self.dc_xr = r; self.dc_yr = yr;
            self.master += (self.master_target - self.master) * MASTER_SMOOTH;
            l = yl * self.master; r = yr * self.master;
            if !l.is_finite() || !r.is_finite() {
                self.nans += 1.0;
                self.panic();
                l = 0.0; r = 0.0;
            }
            let pk = l.abs().max(r.abs());
            self.lim_env = if pk > self.lim_env { pk } else { pk + (self.lim_env - pk) * self.lim_rel };
            let g = if self.lim_env > CEILING { CEILING / self.lim_env } else { 1.0 };
            if g < self.min_gain { self.min_gain = g; }
            l = (l * g).max(-CEILING).min(CEILING);
            r = (r * g).max(-CEILING).min(CEILING);
            if l.abs() > self.peak_l { self.peak_l = l.abs(); }
            if r.abs() > self.peak_r { self.peak_r = r.abs(); }
            out[f * 2] = l as f32;
            out[f * 2 + 1] = r as f32;
        }
    }

    pub fn meter(&mut self, out: &mut [f32]) {
        if out.len() < 4 { return; }
        out[0] = self.peak_l as f32; out[1] = self.peak_r as f32;
        out[2] = self.min_gain as f32; out[3] = self.nans as f32;
        self.peak_l = 0.0; self.peak_r = 0.0; self.min_gain = 1.0;
    }
}

// ---- C ABI: bun:ffi on the host, WebAssembly exports in the AudioWorklet ----

#[no_mangle]
pub extern "C" fn fm_new(sample_rate: f64) -> *mut Engine {
    if !(sample_rate >= 8000.0 && sample_rate <= 384000.0) { return std::ptr::null_mut(); }
    Box::into_raw(Box::new(Engine::new(sample_rate)))
}

/// # Safety
/// `e` must come from `fm_new` and not be used after this call.
#[no_mangle]
pub unsafe extern "C" fn fm_free(e: *mut Engine) { if !e.is_null() { drop(Box::from_raw(e)); } }

macro_rules! with {
    ($e:ident, $body:expr) => { if let Some($e) = unsafe { $e.as_mut() } { $body } };
}

#[no_mangle]
pub extern "C" fn fm_set_param(e: *mut Engine, track: u32, index: u32, value: f64) { with!(e, e.set_param(track as usize, index as usize, value)) }
#[no_mangle]
pub extern "C" fn fm_set_mute(e: *mut Engine, track: u32, muted: u32) { with!(e, e.set_mute(track as usize, muted != 0)) }
#[no_mangle]
pub extern "C" fn fm_set_master(e: *mut Engine, gain: f64) { with!(e, e.set_master(gain)) }
#[no_mangle]
pub extern "C" fn fm_note_on(e: *mut Engine, track: u32, id: u32, midi: f64, velocity: f64) { with!(e, e.note_on(track as usize, id, midi, velocity)) }
#[no_mangle]
pub extern "C" fn fm_note_off(e: *mut Engine, track: u32, id: u32) { with!(e, e.note_off(track as usize, id)) }
#[no_mangle]
pub extern "C" fn fm_all_off(e: *mut Engine) { with!(e, e.all_off()) }
#[no_mangle]
pub extern "C" fn fm_panic(e: *mut Engine) { with!(e, e.panic()) }
#[no_mangle]
pub extern "C" fn fm_click(e: *mut Engine, accent: u32) { with!(e, e.click(accent != 0)) }

/// # Safety
/// `out` must point to at least `frames * 2` f32s.
#[no_mangle]
pub unsafe extern "C" fn fm_render(e: *mut Engine, out: *mut f32, frames: u32) {
    if out.is_null() { return; }
    let buf = std::slice::from_raw_parts_mut(out, frames as usize * 2);
    with!(e, e.render(buf, frames as usize))
}

/// # Safety
/// `out` must point to at least 4 f32s.
#[no_mangle]
pub unsafe extern "C" fn fm_meter(e: *mut Engine, out: *mut f32) {
    if out.is_null() { return; }
    let buf = std::slice::from_raw_parts_mut(out, 4);
    with!(e, e.meter(buf))
}

/// Buffers in wasm linear memory for the worklet. Unused on the host.
#[no_mangle]
pub extern "C" fn fm_alloc(len: u32) -> *mut f32 {
    let mut v = vec![0f32; len as usize].into_boxed_slice();
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `p`/`len` must come from one `fm_alloc` call.
#[no_mangle]
pub unsafe extern "C" fn fm_dealloc(p: *mut f32, len: u32) {
    if !p.is_null() { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(p, len as usize))); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn silent_until_gain_set_and_never_past_ceiling() {
        let mut e = Engine::new(48000.0);
        let mut out = vec![0f32; 1024];
        e.note_on(0, 1, 60.0, 1.0);
        e.render(&mut out, 512);
        assert!(out.iter().all(|x| *x == 0.0));
        for t in 0..TRACKS {
            e.set_param(t, P_GAIN, 1e9);
            e.set_param(t, 1, 1.0);
            e.set_param(t, P_FEEDBACK, 1.0);
            for k in 0..VOICES as u32 { e.note_on(t, k, 30.0 + k as f64, 1.0); }
        }
        e.set_master(1.0);
        for _ in 0..200 { e.render(&mut out, 512); assert!(out.iter().all(|x| x.abs() as f64 <= CEILING + 1e-6)); }
    }
}
