// Someone else's sound, played on the beat it was stamped with: native/crates/fm_daw/src/remote.rs line for line
// (f64 inside, f32 samples), so the TS engine and the wasm one put every sample in the same place. How it works is
// in the Rust file's top comment: a ring that is the jitter buffer, each output frame reading the sample its beat
// names, and samples per beat fitted to the stamps so the far end's sound card can't drift away.

export const RING = 1 << 16;
export const TOL = 48;
export const MAX_DRIFT = 0.005;
export const MIN_SPAN = 1;
export const LATE_WINDOW = 4800;

/** One player's sound coming in, in TS or in Rust: the worklet holds one per player. */
export interface RemoteLine {
  setNominal(spb: number): void;
  push(beat: number, samples: Float32Array): void;
  /** Add `frames` into mono `out`: frame f is heard on beat `beat0 + f * bpf`. */
  mix(out: Float32Array, frames: number, beat0: number, bpf: number, gain: number): void;
  readonly late: number;
  free?(): void;
}

export class TsRemote implements RemoteLine {
  private ring = new Float32Array(RING);
  private written = 0;
  private has = false;
  private anchorIdx = 0;
  private anchorBeat = 0;
  private nominal: number;
  spb: number;
  late = 0;
  constructor(nominal: number) { this.nominal = nominal; this.spb = nominal; }

  setNominal(nominal: number) {
    if (nominal === this.nominal) return;
    this.nominal = nominal;
    this.spb = nominal;
    this.has = false;
  }

  push(beat: number, samples: Float32Array) {
    const idx = this.written;
    if (this.has) {
      const expected = this.anchorBeat + (idx - this.anchorIdx) / this.spb;
      const err = (beat - expected) * this.spb;
      if (Math.abs(err) > TOL) this.anchor(idx, beat);
      else if (beat - this.anchorBeat > MIN_SPAN) {
        const slope = (idx - this.anchorIdx) / (beat - this.anchorBeat);
        this.spb = Math.min(Math.max(slope, this.nominal * (1 - MAX_DRIFT)), this.nominal * (1 + MAX_DRIFT));
      }
    } else this.anchor(idx, beat);
    for (let i = 0; i < samples.length; i++) this.ring[(idx + i) % RING] = samples[i];
    this.written += samples.length;
  }

  private anchor(idx: number, beat: number) {
    this.has = true;
    this.anchorIdx = idx;
    this.anchorBeat = beat;
    this.spb = this.nominal;
  }

  mix(out: Float32Array, frames: number, beat0: number, bpf: number, gain: number) {
    if (!this.has) return;
    const oldest = this.written - RING, last = this.written - 1;
    for (let f = 0; f < frames; f++) {
      const b = beat0 + f * bpf;
      const x = this.anchorIdx + (b - this.anchorBeat) * this.spb;
      if (x < 0 || x < oldest) continue;
      if (x >= last) { if (x < last + LATE_WINDOW) this.late++; continue; }
      const j = Math.floor(x), fr = x - j;
      const a = this.ring[j % RING], c = this.ring[(j + 1) % RING];
      out[f] = out[f] + (a + (c - a) * fr) * gain;
    }
  }
}
