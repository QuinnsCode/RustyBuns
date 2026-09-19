//! Motion MIDI engine. Mirrors src/engine/engine.ts line for line (f64 inside,
//! f32 out) so the golden test can hold both to the same output.
//!
//! Song layout (Float32Array, built by src/engine/song.ts):
//!   [version, sample_rate, track_count,
//!    per track: TRACK_FIELDS params, note_count, note_count * [start, len, midi, vel]]
//! start/len are in samples (exact in f32 up to ~6 min at 44.1k).
//!
//! `render` is the only hot path: no allocation, no locks. Bounce calls it in a
//! loop; live playback (slice 2) calls the same function from an audio thread.

use std::f64::consts::PI;

pub const VERSION: f32 = 1.0;
pub const TRACK_FIELDS: usize = 15;
pub const MAX_VOICES: usize = 16;
pub const MAX_UNISON: usize = 8;
const MAX_DELAY_S: f64 = 2.0;

#[derive(Clone, Copy)]
struct Note { start: f64, len: f64, midi: f64, vel: f64 }

#[derive(Clone, Copy, Default)]
struct Voice {
    active: bool,
    start: f64, end: f64, freq: f64, vel: f64,
    release_level: f64,
    phase: [f64; MAX_UNISON],
    ic1: f64, ic2: f64,
}

struct Track {
    wave: u32, unison: usize, detune: f64,
    attack: f64, decay: f64, sustain: f64, release: f64,
    cutoff: f64, reso: f64, env_mod: f64, gain: f64,
    pan_l: f64, pan_r: f64,
    delay_len: usize, delay_fb: f64, delay_mix: f64,
    notes: Vec<Note>, next: usize,
    voices: [Voice; MAX_VOICES],
    delay: Vec<f64>, delay_pos: usize,
}

pub struct Engine { sr: f64, tracks: Vec<Track>, pos: u64, total: u64 }

#[inline]
fn blep(t: f64, dt: f64) -> f64 {
    if t < dt { let x = t / dt; x + x - x * x - 1.0 }
    else if t > 1.0 - dt { let x = (t - 1.0) / dt; x * x + x + x + 1.0 }
    else { 0.0 }
}

impl Engine {
    pub fn new(song: &[f32]) -> Result<Engine, &'static str> {
        if song.len() < 3 || song[0] != VERSION { return Err("bad song header"); }
        let sr = song[1] as f64;
        let n_tracks = song[2] as usize;
        let mut i = 3;
        let mut tracks = Vec::with_capacity(n_tracks);
        let mut total: f64 = 0.0;
        for _ in 0..n_tracks {
            if i + TRACK_FIELDS + 1 > song.len() { return Err("truncated track"); }
            let p = |k: usize| song[i + k] as f64;
            let pan = p(10).clamp(-1.0, 1.0);
            let angle = (pan + 1.0) * PI / 4.0;
            let delay_len = ((p(11) * sr).round() as usize).clamp(1, (MAX_DELAY_S * sr) as usize);
            let release = p(6).max(0.001);
            let n_notes = song[i + TRACK_FIELDS] as usize;
            let base = i + TRACK_FIELDS + 1;
            if base + n_notes * 4 > song.len() { return Err("truncated notes"); }
            let mut notes = Vec::with_capacity(n_notes);
            for k in 0..n_notes {
                let o = base + k * 4;
                let n = Note { start: song[o] as f64, len: song[o + 1] as f64, midi: song[o + 2] as f64, vel: song[o + 3] as f64 };
                total = total.max(n.start + n.len + release * sr);
                notes.push(n);
            }
            tracks.push(Track {
                wave: p(0) as u32,
                unison: (p(1) as usize).clamp(1, MAX_UNISON),
                detune: p(2),
                attack: p(3).max(0.0005), decay: p(4).max(0.0005), sustain: p(5), release,
                cutoff: p(7), reso: p(8).clamp(0.0, 0.98), env_mod: p(9), gain: p(12),
                pan_l: angle.cos(), pan_r: angle.sin(),
                delay_len, delay_fb: p(13).clamp(0.0, 0.95), delay_mix: p(14),
                notes, next: 0,
                voices: [Voice::default(); MAX_VOICES],
                delay: vec![0.0; delay_len], delay_pos: 0,
            });
            i = base + n_notes * 4;
        }
        // One second of tail for delays to ring out.
        let total = (total + sr).ceil() as u64;
        Ok(Engine { sr, tracks, pos: 0, total })
    }

    pub fn total_frames(&self) -> u64 { self.total }

    /// Writes interleaved stereo into `out` (len >= frames * 2). Returns frames written.
    pub fn render(&mut self, out: &mut [f32], frames: usize) -> usize {
        let sr = self.sr;
        let n = frames.min((self.total - self.pos.min(self.total)) as usize).min(out.len() / 2);
        for f in 0..n {
            let s = (self.pos + f as u64) as f64;
            let mut l = 0.0f64;
            let mut r = 0.0f64;
            for t in self.tracks.iter_mut() {
                // Note-ons due at this sample.
                while t.next < t.notes.len() && t.notes[t.next].start <= s {
                    let note = t.notes[t.next];
                    t.next += 1;
                    let mut slot = 0;
                    let mut oldest = f64::INFINITY;
                    for (vi, v) in t.voices.iter().enumerate() {
                        if !v.active { slot = vi; break; }
                        if v.start < oldest { oldest = v.start; slot = vi; }
                    }
                    let mut v = Voice {
                        active: true, start: s, end: s + note.len,
                        freq: 440.0 * 2f64.powf((note.midi - 69.0) / 12.0),
                        vel: note.vel, ..Voice::default()
                    };
                    for u in 0..t.unison { v.phase[u] = ((u as f64) * 0.618034).fract(); }
                    t.voices[slot] = v;
                }
                let mut mono = 0.0f64;
                let norm = 1.0 / (t.unison as f64).sqrt();
                for v in t.voices.iter_mut() {
                    if !v.active { continue; }
                    // Envelope.
                    let age = (s - v.start) / sr;
                    let env;
                    if s < v.end {
                        env = if age < t.attack { age / t.attack }
                            else if age < t.attack + t.decay { 1.0 - (1.0 - t.sustain) * (age - t.attack) / t.decay }
                            else { t.sustain };
                        v.release_level = env;
                    } else {
                        let rel = (s - v.end) / sr;
                        env = v.release_level * (1.0 - rel / t.release);
                        if env <= 0.0 { v.active = false; continue; }
                    }
                    // Oscillators.
                    let mut osc = 0.0f64;
                    for u in 0..t.unison {
                        let cents = if t.unison > 1 { t.detune * ((u as f64) / ((t.unison - 1) as f64) - 0.5) * 2.0 } else { 0.0 };
                        let dt = v.freq * 2f64.powf(cents / 1200.0) / sr;
                        let p = v.phase[u];
                        osc += match t.wave {
                            0 => 2.0 * p - 1.0 - blep(p, dt),
                            1 => { let mut q = p + 0.5; if q >= 1.0 { q -= 1.0; }
                                   (if p < 0.5 { 1.0 } else { -1.0 }) + blep(p, dt) - blep(q, dt) }
                            _ => (2.0 * PI * p).sin(),
                        };
                        let mut np = p + dt;
                        if np >= 1.0 { np -= 1.0; }
                        v.phase[u] = np;
                    }
                    osc *= norm;
                    // Lowpass (TPT SVF), cutoff follows the envelope.
                    let fc = (t.cutoff * (1.0 + t.env_mod * env)).min(sr * 0.45);
                    let g = (PI * fc / sr).tan();
                    let k = 2.0 - 2.0 * t.reso;
                    let a1 = 1.0 / (1.0 + g * (g + k));
                    let a2 = g * a1;
                    let a3 = g * a2;
                    let v3 = osc - v.ic2;
                    let v1 = a1 * v.ic1 + a2 * v3;
                    let v2 = v.ic2 + a2 * v.ic1 + a3 * v3;
                    v.ic1 = 2.0 * v1 - v.ic1;
                    v.ic2 = 2.0 * v2 - v.ic2;
                    mono += v2 * env * v.vel;
                }
                mono *= t.gain;
                // Delay.
                let y = t.delay[t.delay_pos];
                t.delay[t.delay_pos] = mono + y * t.delay_fb;
                t.delay_pos += 1;
                if t.delay_pos >= t.delay_len { t.delay_pos = 0; }
                let wet = mono + y * t.delay_mix;
                l += wet * t.pan_l;
                r += wet * t.pan_r;
            }
            out[f * 2] = (l * 0.8).tanh() as f32;
            out[f * 2 + 1] = (r * 0.8).tanh() as f32;
        }
        self.pos += n as u64;
        n
    }
}

// ---- C ABI for bun:ffi. The caller owns `song` and `out`; Rust owns the engine.

/// # Safety
/// `song` must point to `len` readable f32s. Returns null on a malformed song.
#[no_mangle]
pub unsafe extern "C" fn mm_new(song: *const f32, len: usize) -> *mut Engine {
    if song.is_null() { return std::ptr::null_mut(); }
    match Engine::new(std::slice::from_raw_parts(song, len)) {
        Ok(e) => Box::into_raw(Box::new(e)),
        Err(_) => std::ptr::null_mut(),
    }
}

/// # Safety
/// `h` must come from `mm_new` and not be freed.
#[no_mangle]
pub unsafe extern "C" fn mm_total_frames(h: *const Engine) -> f64 {
    if h.is_null() { 0.0 } else { (*h).total_frames() as f64 }
}

/// # Safety
/// `out` must point to `len` writable f32s (interleaved stereo).
#[no_mangle]
pub unsafe extern "C" fn mm_render(h: *mut Engine, out: *mut f32, len: usize) -> u32 {
    if h.is_null() || out.is_null() { return 0; }
    let buf = std::slice::from_raw_parts_mut(out, len);
    (*h).render(buf, len / 2) as u32
}

/// # Safety
/// `h` must come from `mm_new`; it is invalid afterwards.
#[no_mangle]
pub unsafe extern "C" fn mm_free(h: *mut Engine) {
    if !h.is_null() { drop(Box::from_raw(h)); }
}
