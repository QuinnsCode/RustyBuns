//! Someone else's sound, played on the beat it was stamped with (src/engine/remote.ts mirrors this bit for bit).
//!
//! Slices of a player's guitar arrive over the sesh with the beat each one starts on, on the shared clock
//! (src/clock.ts). They go into a ring a few seconds long, the jitter buffer: a slice only has to arrive before
//! its beat comes round, however unevenly the network brings them. Each output frame asks for the sample its beat
//! names, so the sound lands on the beat to the sample, whatever this sound card's clock does. The stamps also say
//! how fast the far end's sound card really runs: samples per beat is fitted to them, a very small resample
//! (at most MAX_DRIFT either way) that keeps the two cards from drifting apart. A stamp that doesn't fit the line
//! (the far end stopped, started again, or its clock jumped) starts the line over.

/// Samples kept: 2.7 s at 24 kHz, more than a slice's worst lateness at the desk; a loop late, the page holds
/// each slice until shortly before its beat.
pub const RING: usize = 1 << 16;
/// A stamp further than this from where the line says (in samples: 2 ms at 24 kHz) starts the line over.
pub const TOL: f64 = 48.0;
/// The far end's sound card may run this much fast or slow (0.5 %); real ones are within 0.01 %.
pub const MAX_DRIFT: f64 = 0.005;
/// Stamps closer than this to the line's start (beats) say nothing yet about the rate.
pub const MIN_SPAN: f64 = 1.0;
/// Frames a sample is counted late for: past the newest by up to this many, the next slice is overdue.
pub const LATE_WINDOW: f64 = 4800.0;

pub struct Remote {
    ring: Vec<f32>,
    written: f64,
    has: bool,
    anchor_idx: f64,
    anchor_beat: f64,
    spb: f64,
    nominal: f64,
    late: u32,
}

impl Remote {
    /// `nominal`: samples a beat at the sesh's tempo (TAKE_RATE * 60 / bpm).
    pub fn new(nominal: f64) -> Self {
        Remote { ring: vec![0.0; RING], written: 0.0, has: false, anchor_idx: 0.0, anchor_beat: 0.0, spb: nominal, nominal, late: 0 }
    }

    /// A new tempo: the next slice starts the line over.
    pub fn set_nominal(&mut self, nominal: f64) {
        if nominal == self.nominal { return; }
        self.nominal = nominal;
        self.spb = nominal;
        self.has = false;
    }

    /// A slice starting on `beat`.
    pub fn push(&mut self, beat: f64, samples: &[f32]) {
        let idx = self.written;
        if self.has {
            let expected = self.anchor_beat + (idx - self.anchor_idx) / self.spb;
            let err = (beat - expected) * self.spb;
            if err.abs() > TOL {
                self.anchor(idx, beat);
            } else if beat - self.anchor_beat > MIN_SPAN {
                let slope = (idx - self.anchor_idx) / (beat - self.anchor_beat);
                self.spb = slope.max(self.nominal * (1.0 - MAX_DRIFT)).min(self.nominal * (1.0 + MAX_DRIFT));
            }
        } else {
            self.anchor(idx, beat);
        }
        let w = self.written as usize;
        for (i, s) in samples.iter().enumerate() {
            self.ring[(w + i) % RING] = *s;
        }
        self.written += samples.len() as f64;
    }

    fn anchor(&mut self, idx: f64, beat: f64) {
        self.has = true;
        self.anchor_idx = idx;
        self.anchor_beat = beat;
        self.spb = self.nominal;
    }

    /// Add `out.len()` frames of the sound into mono `out`: frame f is heard on beat `beat0 + f * bpf`.
    pub fn mix(&mut self, out: &mut [f32], beat0: f64, bpf: f64, gain: f64) {
        if !self.has { return; }
        let oldest = self.written - RING as f64;
        let last = self.written - 1.0;
        for (f, o) in out.iter_mut().enumerate() {
            let b = beat0 + f as f64 * bpf;
            let x = self.anchor_idx + (b - self.anchor_beat) * self.spb;
            if x < 0.0 || x < oldest { continue; }
            if x >= last {
                if x < last + LATE_WINDOW { self.late += 1; }
                continue;
            }
            let j = x.floor();
            let fr = x - j;
            let a = self.ring[(j as usize) % RING] as f64;
            let c = self.ring[(j as usize + 1) % RING] as f64;
            *o = (*o as f64 + (a + (c - a) * fr) * gain) as f32;
        }
    }

    /// Frames that wanted sound not here yet.
    pub fn late(&self) -> u32 { self.late }
    /// Samples a beat the line plays at: the far end's sound card, fitted from its stamps.
    pub fn spb(&self) -> f64 { self.spb }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_slice_lands_on_its_beat_and_a_fast_card_is_followed() {
        let nominal = 12000.0; // 120 bpm at 24 kHz
        let mut r = Remote::new(nominal);
        // the far end runs 0.1 % fast: each 2400-sample slice spans a little less of a beat
        let ramp: Vec<f32> = (0..2400).map(|i| i as f32 / 2400.0).collect();
        for k in 0..20 {
            r.push(100.0 + k as f64 * 2400.0 / (nominal * 1.001), &ramp);
        }
        assert!((r.spb() / nominal - 1.001).abs() < 1e-6);
        let mut out = vec![0f32; 1];
        r.mix(&mut out, 100.0 + 0.5 * 2400.0 / (nominal * 1.001), 0.0, 1.0);
        assert!((out[0] - 0.5).abs() < 1e-3);
    }
}
