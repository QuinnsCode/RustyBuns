//! FM DAW engine: each track is 4-op FM or the analog voice (detuned saws,
//! pulses or a supersaw + sub, wavefolder, resonant filters, filter envelope,
//! LFO, glide, drive). Mirrors
//! src/engine/engine.ts line for line (f64 inside, f32
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

pub const TRACKS: usize = 12;
pub const OPS: usize = 4;
pub const NPARAMS: usize = 60;
pub const BEND_RANGE: f64 = 12.0;
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
const P_MODE: usize = 34;
const P_DETUNE: usize = 35;
const P_SUB: usize = 36;
const P_CUTOFF: usize = 37;
const P_RES: usize = 38;
const P_FENV_AMT: usize = 39;
const P_FENV_ATTACK: usize = 40;
const P_FENV_DECAY: usize = 41;
const P_LFO_RATE: usize = 42;
const P_LFO_CUT: usize = 43;
const P_LFO_PITCH: usize = 44;
const P_GLIDE: usize = 45;
const P_DRIVE: usize = 46;
const P_SEND: usize = 47;
const P_VEL_TONE: usize = 48;
const P_HICUT: usize = 49;
const P_LOCUT: usize = 50;
const P_FILTER: usize = 51;
const P_WAVE: usize = 52;
const P_PWM: usize = 53;
const P_LFO_SHAPE: usize = 54;
const P_LFO_SYNC: usize = 55;
const P_LFO_RETRIG: usize = 56;
const P_CHORUS: usize = 57;
const P_SUPER: usize = 58;
const P_FOLD: usize = 59;

const OP_RANGES: [(f64, f64); 6] = [(0.25, 16.0), (0.0, 1.0), (0.0005, 4.0), (0.005, 8.0), (0.0, 1.0), (0.005, 8.0)];
const TAIL_RANGES: [(f64, f64); 36] = [
    (0.0, 3.0), (0.0, 1.0), (0.0, 48.0), (0.005, 2.0), (0.0, 1.0),
    (0.005, 2.0), (0.0, 1.0), (0.0, 1.0), (-1.0, 1.0), (0.0, 1.0),
    // analog: mode, detune, sub, cutoff, res, fenv amt/attack/decay, lfo rate/cut/pitch, glide, drive
    (0.0, 1.0), (0.0, 1.0), (0.0, 1.0), (0.0, 1.0), (0.0, 1.0),
    (-1.0, 1.0), (0.0005, 4.0), (0.005, 8.0), (0.02, 20.0), (0.0, 1.0),
    (0.0, 1.0), (0.0, 1.0), (0.0, 1.0),
    (0.0, 1.0), // send to Space
    (0.0, 1.0), // velocity to tone
    (0.0, 1.0), // hi-cut
    (0.0, 1.0), // low-cut
    (0.0, 2.0), // filter: 0 SVF, 1 ladder, 2 vowel
    (0.0, 1.0), // wave: saw..pulse
    (0.0, 1.0), // LFO to pulse width
    (0.0, 3.0), // LFO shape
    (0.0, 8.0), // LFO sync
    (0.0, 1.0), // LFO retrigger
    (0.0, 3.0), // chorus mode
    (0.0, 1.0), // supersaw mix: 0 off
    (0.0, 1.0), // wavefolder
];

/// Beats per LFO cycle for LFO_SYNC 1..8 (params.ts LFO_DIVS).
const LFO_DIVS: [f64; 9] = [0.0, 4.0, 2.0, 1.0, 2.0 / 3.0, 0.5, 1.0 / 3.0, 0.25, 0.125];
const VOWEL_F1: [f64; 5] = [300.0, 570.0, 730.0, 530.0, 270.0];
const VOWEL_F2: [f64; 5] = [870.0, 840.0, 1090.0, 1840.0, 2290.0];
const CH_LEN: usize = 4096;
const CH_RATE: [f64; 4] = [0.0, 0.513, 0.863, 9.75];
const CH_MIN: [f64; 4] = [0.0, 1.66, 1.66, 3.22];
const CH_MAX: [f64; 4] = [0.0, 5.35, 5.35, 3.56];
const CH_WET: f64 = 0.8;
const CH_TONE: f64 = 7000.0;
/// The supersaw after Adam Szabo (engine.ts SS_*): offsets, fixed start phases, detune curve x^11..x^0.
const SS_OFF: [f64; 7] = [-0.11002313, -0.06288439, -0.01952356, 0.0, 0.01991221, 0.06216538, 0.10745242];
const SS_PHASE: [f64; 7] = [0.11, 0.53, 0.29, 0.0, 0.83, 0.47, 0.67];
const SS_CURVE: [f64; 12] = [10028.7312891634, -50818.8652045924, 111363.4808729368, -138150.6761080548, 106649.6679158292,
    -53046.9642751875, 17019.951858008, -3425.0836591318, 404.2703938388, -24.1878824391, 0.6717417634, 0.0030115596];
const SAWS: usize = 7;

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
const MAX_CUTOFF: f64 = 0.45;
const VIB_FADE: f64 = 0.3;
const SQRT2: f64 = std::f64::consts::SQRT_2;

/// Trapezoidal SVF coefficients [a1, a2, a3] for cutoff 20 Hz * 2^(10 x).
fn svf_coefs(x: f64, sr: f64) -> [f64; 3] {
    let fc = (20.0 * (2.0f64).powf(10.0 * x)).min(MAX_CUTOFF * sr);
    let g = ((PI * fc) / sr).tan();
    let a1 = 1.0 / (1.0 + g * (g + SQRT2));
    [a1, g * a1, g * g * a1]
}

#[inline]
fn svf(k: &[f64; 3], s: &mut [f64; 2], x: f64) -> (f64, f64) {
    let v3 = x - s[1];
    let v1 = k[0] * s[0] + k[1] * v3;
    let v2 = s[1] + k[1] * s[0] + k[2] * v3;
    s[0] = 2.0 * v1 - s[0];
    s[1] = 2.0 * v2 - s[1];
    (v1, v2)
}

/// A naive saw with PolyBLEP smoothing at the wrap.
#[inline]
fn saw(ph: f64, dt: f64) -> f64 {
    let mut y = 2.0 * ph - 1.0;
    if ph < dt { let x = ph / dt; y -= x + x - x * x - 1.0; }
    else if ph > 1.0 - dt { let x = (ph - 1.0) / dt; y -= x * x + x + x + 1.0; }
    y
}

fn decay_coef(seconds: f64, sr: f64) -> f64 { ((0.001f64).ln() / (seconds * sr)).exp() }

#[derive(Clone, Copy, Default)]
struct Voice {
    active: bool, gate: bool, id: u32, born: f64,
    freq: f64, amp: f64, pitch_env: f64, noise_env: f64, noise_lp: f64,
    fb1: f64, fb2: f64,
    phase: [f64; OPS], env: [f64; OPS], stage: [u8; OPS],
    freq_now: f64, saw1: f64, saw2: f64, sub_ph: f64, ic1: f64, ic2: f64, ic3: f64, ic4: f64, f_env: f64, f_stage: u8,
    vel: f64, age: f64,
    ss_ph: [f64; SAWS],
}

#[derive(Clone, Copy)]
struct Track {
    params: [f64; NPARAMS],
    atk_inc: [f64; OPS], dec_coef: [f64; OPS], rel_coef: [f64; OPS],
    pitch_coef: f64, noise_coef: f64, pan_l: f64, pan_r: f64,
    muted: bool, gain_now: f64,
    det_up: f64, f_atk_inc: f64, f_dec_coef: f64, glide_coef: f64, drive_g: f64, drive_norm: f64,
    lfo_phase: f64, last_freq: f64, bend_mul: f64, ch_ph: f64, ch_lp: f64,
    lp_on: bool, hp_on: bool, lp_k: [f64; 3], hp_k: [f64; 3], lp_s: [f64; 2], hp_s: [f64; 2],
    ss_det: f64, ss_c: f64, ss_s: f64, ss_n: f64,
    voices: [Voice; VOICES],
}

impl Default for Track {
    fn default() -> Track {
        Track {
            params: [0.0; NPARAMS],
            atk_inc: [0.0; OPS], dec_coef: [0.0; OPS], rel_coef: [0.0; OPS],
            pitch_coef: 0.0, noise_coef: 0.0, pan_l: 0.0, pan_r: 0.0,
            muted: false, gain_now: 0.0,
            det_up: 0.0, f_atk_inc: 0.0, f_dec_coef: 0.0, glide_coef: 0.0, drive_g: 0.0, drive_norm: 0.0,
            lfo_phase: 0.0, last_freq: 0.0, bend_mul: 1.0, ch_ph: 0.0, ch_lp: 0.0,
            lp_on: false, hp_on: false, lp_k: [0.0; 3], hp_k: [0.0; 3], lp_s: [0.0; 2], hp_s: [0.0; 2],
            ss_det: 0.0, ss_c: 0.0, ss_s: 0.0, ss_n: 0.0,
            voices: [Voice::default(); VOICES],
        }
    }
}

pub struct Engine {
    sr: f64,
    tracks: [Track; TRACKS],
    births: f64,
    rng: u32,
    tempo: f64,
    beat: f64,
    ch_buf: Vec<f64>, ch_w: usize, ch_k: f64,
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
            tempo: 120.0,
            beat: 0.0,
            ch_buf: vec![0.0; TRACKS * CH_LEN], ch_w: 0, ch_k: 1.0 - ((-TAU * CH_TONE) / sr).exp(),
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
        else if i == P_DETUNE {
            tr.det_up = (2.0f64).powf((v * 0.5) / 12.0);
            let mut d = 0.0;
            for c in SS_CURVE.iter() { d = d * v + c; }
            tr.ss_det = d;
        }
        else if i == P_SUPER {
            let c = -0.55366 * v + 0.99785;
            let sd = -0.73764 * v * v + 1.2841 * v + 0.044372;
            tr.ss_c = c; tr.ss_s = sd;
            tr.ss_n = 0.7 / (c * c + 6.0 * sd * sd).sqrt();
        }
        else if i == P_FENV_ATTACK { tr.f_atk_inc = 1.0 / (v * sr); }
        else if i == P_FENV_DECAY { tr.f_dec_coef = decay_coef(v, sr); }
        else if i == P_GLIDE { tr.glide_coef = if v > 0.0 { (-1.0 / (v * sr)).exp() } else { 0.0 }; }
        else if i == P_HICUT { tr.lp_on = v > 0.001; tr.lp_k = svf_coefs(1.0 - v, sr); }
        else if i == P_LOCUT { tr.hp_on = v > 0.001; tr.hp_k = svf_coefs(v, sr); }
        else if i == P_DRIVE { tr.drive_g = 1.0 + 6.0 * v; tr.drive_norm = 1.0 / (1.0 + 6.0 * v).tanh(); }
    }

    pub fn set_mute(&mut self, t: usize, muted: bool) { if t < TRACKS { self.tracks[t].muted = muted; } }

    pub fn set_master(&mut self, gain: f64) { self.master_target = if gain.is_finite() { gain.max(0.0).min(1.0) } else { 0.0 }; }

    pub fn set_tempo(&mut self, bpm: f64) { self.tempo = if bpm.is_finite() { bpm.max(20.0).min(400.0) } else { 120.0 }; }

    pub fn set_beat(&mut self, beats: f64) { if beats.is_finite() { self.beat = beats.max(0.0).min(1e6); } }

    pub fn set_bend(&mut self, t: usize, semitones: f64) {
        if t >= TRACKS { return; }
        let s = if semitones.is_finite() { semitones.max(-BEND_RANGE).min(BEND_RANGE) } else { 0.0 };
        self.tracks[t].bend_mul = (2.0f64).powf(s / 12.0);
    }

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
        let freq = 440.0 * (2.0f64).powf((midi.max(0.0).min(127.0) - 69.0) / 12.0);
        let freq_now = if tr.glide_coef > 0.0 && tr.last_freq > 0.0 { tr.last_freq } else { freq };
        tr.last_freq = freq;
        if tr.params[P_LFO_RETRIG] >= 0.5 { tr.lfo_phase = 0.0; }
        let vo = &mut tr.voices[slot];
        vo.active = true; vo.gate = true; vo.id = id;
        vo.born = births;
        vo.freq = freq;
        vo.freq_now = freq_now;
        vo.saw1 = 0.0; vo.saw2 = 0.5; vo.sub_ph = 0.0;
        vo.ss_ph = SS_PHASE;
        vo.ic1 = 0.0; vo.ic2 = 0.0; vo.ic3 = 0.0; vo.ic4 = 0.0; vo.f_env = 0.0; vo.f_stage = 0;
        vo.amp = 1.0 - vs + vs * vel;
        vo.vel = vel; vo.age = 0.0;
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
        for tr in self.tracks.iter_mut() { tr.lp_s = [0.0; 2]; tr.hp_s = [0.0; 2]; tr.ch_lp = 0.0; }
        for x in self.ch_buf.iter_mut() { *x = 0.0; }
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

    /// Interleaved stereo into `out`; with `send`, also the Space send bus
    /// (each track times its SEND, after pan and master).
    pub fn render(&mut self, out: &mut [f32], mut send: Option<&mut [f32]>, frames: usize) {
        let mut n = frames.min(out.len() / 2);
        if let Some(s) = send.as_deref() { n = n.min(s.len() / 2); }
        let sr = self.sr;
        let beat_inc = self.tempo / 60.0 / sr;
        for f in 0..n {
            let (mut l, mut r) = (0.0f64, 0.0f64);
            let (mut sl, mut sr2) = (0.0f64, 0.0f64);
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
                {
                    let beat = self.beat;
                    let tr = &mut self.tracks[t];
                    let sync = tr.params[P_LFO_SYNC] as usize;
                    if sync > 0 && tr.params[P_LFO_RETRIG] < 0.5 { let q = beat / LFO_DIVS[sync]; tr.lfo_phase = q - q.floor(); }
                }
                let lph = self.tracks[t].lfo_phase;
                let shape = self.tracks[t].params[P_LFO_SHAPE] as usize;
                let lfo = if shape == 0 { (TAU * lph).sin() } else if shape == 1 { 1.0 - 4.0 * (lph - 0.5).abs() }
                    else if shape == 2 { 1.0 - 2.0 * lph } else if lph < 0.5 { 1.0 } else { -1.0 };
                {
                    let tempo = self.tempo;
                    let tr = &mut self.tracks[t];
                    let sync = tr.params[P_LFO_SYNC] as usize;
                    let rate = if sync > 0 { tempo / 60.0 / LFO_DIVS[sync] } else { tr.params[P_LFO_RATE] };
                    let mut lp = tr.lfo_phase + rate / sr;
                    lp -= lp.floor();
                    tr.lfo_phase = lp;
                }
                let analog = self.tracks[t].params[P_MODE] >= 0.5;
                let vib_amt = self.tracks[t].params[P_LFO_PITCH];
                let vel_tone = self.tracks[t].params[P_VEL_TONE];
                let cut_oct = self.tracks[t].params[P_CUTOFF] * 10.0 + self.tracks[t].params[P_LFO_CUT] * 4.0 * lfo;
                let fenv_oct = self.tracks[t].params[P_FENV_AMT] * 6.0;
                let k2 = 2.0 - 1.8 * self.tracks[t].params[P_RES];
                let sub = self.tracks[t].params[P_SUB];
                let drive = self.tracks[t].params[P_DRIVE] > 0.0;
                let ftype = self.tracks[t].params[P_FILTER] as usize;
                let wave = self.tracks[t].params[P_WAVE];
                let supersaw = self.tracks[t].params[P_SUPER] > 0.0;
                let fold = self.tracks[t].params[P_FOLD];
                let pw = 0.5 - 0.45 * self.tracks[t].params[P_PWM] * (0.5 + 0.5 * lfo);
                let kq = 3.9 * self.tracks[t].params[P_RES];
                let kv = 0.5 - 0.4 * self.tracks[t].params[P_RES];
                let bend = self.tracks[t].bend_mul;
                let fm_wob = 1.0 + self.tracks[t].params[P_LFO_CUT] * lfo;
                let mut mono = 0.0;
                for v in 0..VOICES {
                    if !self.tracks[t].voices[v].active { continue; }
                    let pm = if pitch_amt > 0.0 {
                        (2.0f64).powf((pitch_amt * self.tracks[t].voices[v].pitch_env) / 12.0)
                    } else { 1.0 };
                    let pitch_coef = self.tracks[t].pitch_coef;
                    self.tracks[t].voices[v].pitch_env *= pitch_coef;
                    if analog {
                        let nz = if noise > 0.0 { self.next_noise() } else { 0.0 };
                        let (y, e, attacking) = {
                            let tr = &mut self.tracks[t];
                            let vo = &mut tr.voices[v];
                            let target = vo.freq;
                            vo.freq_now = target + (vo.freq_now - target) * tr.glide_coef;
                            let fade = (vo.age / VIB_FADE).min(1.0);
                            vo.age += 1.0 / sr;
                            let vib = if vib_amt > 0.0 { (2.0f64).powf((lfo * vib_amt * 0.5 * fade) / 12.0) } else { 1.0 };
                            let base = vo.freq_now * pm * vib * bend;
                            let mut e = vo.env[0];
                            let st = vo.stage[0];
                            let mut attacking = false;
                            if st == 0 {
                                e += tr.atk_inc[0];
                                if e >= 1.0 { e = 1.0; vo.stage[0] = 1; }
                                attacking = true;
                            } else if st == 1 {
                                let s = tr.params[4];
                                e = s + (e - s) * tr.dec_coef[0];
                            } else { e *= tr.rel_coef[0]; }
                            vo.env[0] = e;
                            let mut fe = vo.f_env;
                            if vo.f_stage == 0 {
                                fe += tr.f_atk_inc;
                                if fe >= 1.0 { fe = 1.0; vo.f_stage = 1; }
                            } else { fe *= tr.f_dec_coef; }
                            vo.f_env = fe;
                            let dt1 = (base * tr.det_up) / sr;
                            let dt2 = base / tr.det_up / sr;
                            let mut s1 = saw(vo.saw1, dt1);
                            let mut s2 = saw(vo.saw2, dt2);
                            let mut ss = 0.0;
                            if supersaw {
                                for i in 0..SAWS {
                                    let dt = (base * (1.0 + SS_OFF[i] * tr.ss_det)) / sr;
                                    ss += saw(vo.ss_ph[i], dt) * (if i == 3 { tr.ss_c } else { tr.ss_s });
                                    let mut w = vo.ss_ph[i] + dt; w -= w.floor(); vo.ss_ph[i] = w;
                                }
                                ss *= tr.ss_n;
                            } else if wave > 0.0 {
                                let mut w = vo.saw1 + pw; w -= w.floor();
                                s1 -= saw(w, dt1) * wave;
                                w = vo.saw2 + pw; w -= w.floor();
                                s2 -= saw(w, dt2) * wave;
                            }
                            let mut q = vo.saw1 + dt1; q -= q.floor(); vo.saw1 = q;
                            q = vo.saw2 + dt2; q -= q.floor(); vo.saw2 = q;
                            let sv = (TAU * vo.sub_ph).sin() * sub;
                            q = vo.sub_ph + (base * 0.5) / sr; q -= q.floor(); vo.sub_ph = q;
                            let mut x = (if supersaw { ss } else { (s1 + s2) * 0.5 }) + sv;
                            if noise > 0.0 {
                                let nl = vo.noise_lp + tone * (nz - vo.noise_lp);
                                vo.noise_lp = nl;
                                x += nl * noise;
                            }
                            if fold > 0.0 { x = (x * (1.0 + 6.0 * fold) * PI * 0.5).sin(); }
                            let vel_oct = vel_tone * 3.0 * (2.0 * vo.vel - 1.0);
                            let oct = cut_oct + fenv_oct * fe + vel_oct;
                            let f2;
                            if ftype == 2 {
                                let pos = (oct / 10.0).max(0.0).min(1.0) * 4.0;
                                let vi = (pos.floor() as usize).min(3);
                                let fr = pos - vi as f64;
                                let fa = (VOWEL_F1[vi] * (VOWEL_F1[vi + 1] / VOWEL_F1[vi]).powf(fr)).min(MAX_CUTOFF * sr);
                                let fb = (VOWEL_F2[vi] * (VOWEL_F2[vi + 1] / VOWEL_F2[vi]).powf(fr)).min(MAX_CUTOFF * sr);
                                let mut g = ((PI * fa) / sr).tan();
                                let mut a1 = 1.0 / (1.0 + g * (g + kv));
                                let mut a2 = g * a1;
                                let mut a3 = g * a2;
                                let mut v3 = x - vo.ic2;
                                let b1 = a1 * vo.ic1 + a2 * v3;
                                let mut v2 = vo.ic2 + a2 * vo.ic1 + a3 * v3;
                                vo.ic1 = 2.0 * b1 - vo.ic1;
                                vo.ic2 = 2.0 * v2 - vo.ic2;
                                g = ((PI * fb) / sr).tan();
                                a1 = 1.0 / (1.0 + g * (g + kv)); a2 = g * a1; a3 = g * a2;
                                v3 = x - vo.ic4;
                                let b2 = a1 * vo.ic3 + a2 * v3;
                                v2 = vo.ic4 + a2 * vo.ic3 + a3 * v3;
                                vo.ic3 = 2.0 * b2 - vo.ic3;
                                vo.ic4 = 2.0 * v2 - vo.ic4;
                                f2 = (b1 + 0.7 * b2) * kv * 2.5;
                            } else {
                                let fc = (20.0 * (2.0f64).powf(oct)).max(20.0).min(MAX_CUTOFF * sr);
                                let g = ((PI * fc) / sr).tan();
                                if ftype == 1 {
                                    let gg = g / (1.0 + g);
                                    let h = 1.0 - gg;
                                    let s = gg * gg * gg * h * vo.ic1 + gg * gg * h * vo.ic2 + gg * h * vo.ic3 + h * vo.ic4;
                                    let u = ((x * (1.0 + 0.5 * kq) - kq * s) / (1.0 + kq * gg * gg * gg * gg)).tanh();
                                    let mut vv = (u - vo.ic1) * gg; let y1 = vv + vo.ic1; vo.ic1 = y1 + vv;
                                    vv = (y1 - vo.ic2) * gg; let y2 = vv + vo.ic2; vo.ic2 = y2 + vv;
                                    vv = (y2 - vo.ic3) * gg; let y3 = vv + vo.ic3; vo.ic3 = y3 + vv;
                                    vv = (y3 - vo.ic4) * gg; f2 = vv + vo.ic4; vo.ic4 = f2 + vv;
                                } else {
                                    let a1 = 1.0 / (1.0 + g * (g + k2));
                                    let a2 = g * a1;
                                    let a3 = g * a2;
                                    let v3 = x - vo.ic2;
                                    let v1 = a1 * vo.ic1 + a2 * v3;
                                    f2 = vo.ic2 + a2 * vo.ic1 + a3 * v3;
                                    vo.ic1 = 2.0 * v1 - vo.ic1;
                                    vo.ic2 = 2.0 * f2 - vo.ic2;
                                }
                            }
                            let y = if drive { (f2 * tr.drive_g).tanh() * tr.drive_norm } else { f2 };
                            (y, e, attacking)
                        };
                        let level = self.tracks[t].params[1];
                        let vo = &mut self.tracks[t].voices[v];
                        mono += y * e * level * vo.amp;
                        if !attacking && e < SILENT { vo.active = false; }
                        continue;
                    }
                    let base = self.tracks[t].voices[v].freq * pm * bend;
                    let mv = (1.0 + vel_tone * (2.0 * self.tracks[t].voices[v].vel - 1.0)) * fm_wob;
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
                            let m = m * mv;
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
                let tr = &mut self.tracks[t];
                if tr.lp_on { let k = tr.lp_k; let (_, low) = svf(&k, &mut tr.lp_s, mono); mono = low; }
                if tr.hp_on { let k = tr.hp_k; let (band, low) = svf(&k, &mut tr.hp_s, mono); mono = mono - SQRT2 * band - low; }
                mono *= tr.gain_now;
                let cb = t * CH_LEN;
                let cw = self.ch_w;
                self.ch_buf[cb + cw] = mono;
                let cm = tr.params[P_CHORUS] as usize;
                let (ml, mr);
                if cm > 0 {
                    let cp = tr.ch_ph;
                    let tri = 1.0 - 4.0 * (cp - 0.5).abs();
                    let mut q = cp + CH_RATE[cm] / sr; q -= q.floor(); tr.ch_ph = q;
                    let d = (CH_MIN[cm] + (CH_MAX[cm] - CH_MIN[cm]) * (0.5 + 0.5 * tri)) * sr * 0.001;
                    let rp = cw as f64 - d + CH_LEN as f64;
                    let rf = rp.floor();
                    let fr = rp - rf;
                    let ri = rf as usize;
                    let i0 = if ri >= CH_LEN { ri - CH_LEN } else { ri };
                    let i1 = if i0 + 1 == CH_LEN { 0 } else { i0 + 1 };
                    let raw = self.ch_buf[cb + i0] + (self.ch_buf[cb + i1] - self.ch_buf[cb + i0]) * fr;
                    let wet = tr.ch_lp + self.ch_k * (raw - tr.ch_lp);
                    tr.ch_lp = wet;
                    ml = (mono + wet * CH_WET) * tr.pan_l;
                    mr = (mono - wet * CH_WET) * tr.pan_r;
                } else { ml = mono * tr.pan_l; mr = mono * tr.pan_r; }
                l += ml;
                r += mr;
                let sa = tr.params[P_SEND];
                sl += ml * sa;
                sr2 += mr * sa;
            }
            self.ch_w = if self.ch_w + 1 == CH_LEN { 0 } else { self.ch_w + 1 };
            self.beat += beat_inc;
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
            if let Some(s) = send.as_deref_mut() {
                let a = sl * self.master;
                let b = sr2 * self.master;
                let ok = a.is_finite() && b.is_finite();
                s[f * 2] = if ok { a.max(-1.0).min(1.0) as f32 } else { 0.0 };
                s[f * 2 + 1] = if ok { b.max(-1.0).min(1.0) as f32 } else { 0.0 };
            }
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
pub extern "C" fn fm_set_tempo(e: *mut Engine, bpm: f64) { with!(e, e.set_tempo(bpm)) }
#[no_mangle]
pub extern "C" fn fm_set_beat(e: *mut Engine, beats: f64) { with!(e, e.set_beat(beats)) }
#[no_mangle]
pub extern "C" fn fm_set_bend(e: *mut Engine, track: u32, semitones: f64) { with!(e, e.set_bend(track as usize, semitones)) }
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
/// `out`, and `send` unless null, must point to at least `frames * 2` f32s.
#[no_mangle]
pub unsafe extern "C" fn fm_render(e: *mut Engine, out: *mut f32, send: *mut f32, frames: u32) {
    if out.is_null() { return; }
    let buf = std::slice::from_raw_parts_mut(out, frames as usize * 2);
    let snd = if send.is_null() { None } else { Some(std::slice::from_raw_parts_mut(send, frames as usize * 2)) };
    with!(e, e.render(buf, snd, frames as usize))
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
        e.render(&mut out, None, 512);
        assert!(out.iter().all(|x| *x == 0.0));
        for t in 0..TRACKS {
            e.set_param(t, P_GAIN, 1e9);
            e.set_param(t, 1, 1.0);
            e.set_param(t, P_FEEDBACK, 1.0);
            for k in 0..VOICES as u32 { e.note_on(t, k, 30.0 + k as f64, 1.0); }
        }
        e.set_master(1.0);
        for _ in 0..200 { e.render(&mut out, None, 512); assert!(out.iter().all(|x| x.abs() as f64 <= CEILING + 1e-6)); }
    }
}
