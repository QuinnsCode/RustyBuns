// The TS engine: same algorithms, same order of operations as the Rust crate,
// so both paths produce the same audio (golden test) and the race is fair.
// Typed arrays, no allocation in render().
import { VERSION, TRACK_FIELDS } from "./song.ts";

const MAX_VOICES = 16, MAX_UNISON = 8, MAX_DELAY_S = 2;
const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

function blep(t: number, dt: number): number {
  if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
  return 0;
}

interface Track {
  wave: number; unison: number; detune: number;
  attack: number; decay: number; sustain: number; release: number;
  cutoff: number; reso: number; envMod: number; gain: number;
  panL: number; panR: number;
  delayLen: number; delayFb: number; delayMix: number;
  notes: Float64Array; count: number; next: number;
  // voice state, struct-of-arrays
  active: Uint8Array; start: Float64Array; end: Float64Array; freq: Float64Array; vel: Float64Array;
  relLevel: Float64Array; phase: Float64Array; ic1: Float64Array; ic2: Float64Array;
  delay: Float64Array; delayPos: number;
}

export class TsEngine {
  readonly sampleRate: number;
  private tracks: Track[] = [];
  private pos = 0;
  readonly totalFrames: number;

  constructor(song: Float32Array) {
    if (song.length < 3 || song[0] !== VERSION) throw new Error("bad song header");
    const sr = (this.sampleRate = song[1]);
    const nTracks = song[2];
    let i = 3, total = 0;
    for (let ti = 0; ti < nTracks; ti++) {
      if (i + TRACK_FIELDS + 1 > song.length) throw new Error("truncated track");
      const p = (k: number) => song[i + k];
      const pan = clamp(p(10), -1, 1);
      const angle = ((pan + 1) * Math.PI) / 4;
      const delayLen = clamp(Math.round(p(11) * sr), 1, Math.floor(MAX_DELAY_S * sr));
      const release = Math.max(p(6), 0.001);
      const count = song[i + TRACK_FIELDS];
      const base = i + TRACK_FIELDS + 1;
      if (base + count * 4 > song.length) throw new Error("truncated notes");
      const notes = new Float64Array(song.subarray(base, base + count * 4));
      for (let k = 0; k < count; k++) total = Math.max(total, notes[k * 4] + notes[k * 4 + 1] + release * sr);
      this.tracks.push({
        wave: Math.trunc(p(0)), unison: clamp(Math.trunc(p(1)), 1, MAX_UNISON), detune: p(2),
        attack: Math.max(p(3), 0.0005), decay: Math.max(p(4), 0.0005), sustain: p(5), release,
        cutoff: p(7), reso: clamp(p(8), 0, 0.98), envMod: p(9), gain: p(12),
        panL: Math.cos(angle), panR: Math.sin(angle),
        delayLen, delayFb: clamp(p(13), 0, 0.95), delayMix: p(14),
        notes, count, next: 0,
        active: new Uint8Array(MAX_VOICES), start: new Float64Array(MAX_VOICES), end: new Float64Array(MAX_VOICES),
        freq: new Float64Array(MAX_VOICES), vel: new Float64Array(MAX_VOICES), relLevel: new Float64Array(MAX_VOICES),
        phase: new Float64Array(MAX_VOICES * MAX_UNISON), ic1: new Float64Array(MAX_VOICES), ic2: new Float64Array(MAX_VOICES),
        delay: new Float64Array(delayLen), delayPos: 0,
      });
      i = base + count * 4;
    }
    this.totalFrames = Math.ceil(total + sr);
  }

  /** Interleaved stereo into `out` (length >= frames * 2). Returns frames written. */
  render(out: Float32Array, frames: number): number {
    const sr = this.sampleRate;
    const n = Math.min(frames, Math.max(this.totalFrames - this.pos, 0), out.length >> 1);
    for (let f = 0; f < n; f++) {
      const s = this.pos + f;
      let l = 0, r = 0;
      for (const t of this.tracks) {
        while (t.next < t.count && t.notes[t.next * 4] <= s) {
          const o = t.next * 4;
          t.next++;
          let slot = 0, oldest = Infinity;
          for (let vi = 0; vi < MAX_VOICES; vi++) {
            if (!t.active[vi]) { slot = vi; break; }
            if (t.start[vi] < oldest) { oldest = t.start[vi]; slot = vi; }
          }
          t.active[slot] = 1; t.start[slot] = s; t.end[slot] = s + t.notes[o + 1];
          t.freq[slot] = 440 * Math.pow(2, (t.notes[o + 2] - 69) / 12);
          t.vel[slot] = t.notes[o + 3]; t.relLevel[slot] = 0; t.ic1[slot] = 0; t.ic2[slot] = 0;
          for (let u = 0; u < MAX_UNISON; u++) t.phase[slot * MAX_UNISON + u] = u < t.unison ? (u * 0.618034) % 1 : 0;
        }
        let mono = 0;
        const norm = 1 / Math.sqrt(t.unison);
        for (let vi = 0; vi < MAX_VOICES; vi++) {
          if (!t.active[vi]) continue;
          const age = (s - t.start[vi]) / sr;
          let env: number;
          if (s < t.end[vi]) {
            env = age < t.attack ? age / t.attack
              : age < t.attack + t.decay ? 1 - ((1 - t.sustain) * (age - t.attack)) / t.decay
              : t.sustain;
            t.relLevel[vi] = env;
          } else {
            const rel = (s - t.end[vi]) / sr;
            env = t.relLevel[vi] * (1 - rel / t.release);
            if (env <= 0) { t.active[vi] = 0; continue; }
          }
          let osc = 0;
          const pb = vi * MAX_UNISON;
          for (let u = 0; u < t.unison; u++) {
            const cents = t.unison > 1 ? t.detune * (u / (t.unison - 1) - 0.5) * 2 : 0;
            const dt = (t.freq[vi] * Math.pow(2, cents / 1200)) / sr;
            const p = t.phase[pb + u];
            if (t.wave === 0) osc += 2 * p - 1 - blep(p, dt);
            else if (t.wave === 1) { let q = p + 0.5; if (q >= 1) q -= 1; osc += (p < 0.5 ? 1 : -1) + blep(p, dt) - blep(q, dt); }
            else osc += Math.sin(2 * Math.PI * p);
            let np = p + dt;
            if (np >= 1) np -= 1;
            t.phase[pb + u] = np;
          }
          osc *= norm;
          const fc = Math.min(t.cutoff * (1 + t.envMod * env), sr * 0.45);
          const g = Math.tan((Math.PI * fc) / sr);
          const k = 2 - 2 * t.reso;
          const a1 = 1 / (1 + g * (g + k)), a2 = g * a1, a3 = g * a2;
          const ic1 = t.ic1[vi], ic2 = t.ic2[vi];
          const v3 = osc - ic2;
          const v1 = a1 * ic1 + a2 * v3;
          const v2 = ic2 + a2 * ic1 + a3 * v3;
          t.ic1[vi] = 2 * v1 - ic1;
          t.ic2[vi] = 2 * v2 - ic2;
          mono += v2 * env * t.vel[vi];
        }
        mono *= t.gain;
        const y = t.delay[t.delayPos];
        t.delay[t.delayPos] = mono + y * t.delayFb;
        if (++t.delayPos >= t.delayLen) t.delayPos = 0;
        const wet = mono + y * t.delayMix;
        l += wet * t.panL;
        r += wet * t.panR;
      }
      out[f * 2] = Math.tanh(l * 0.8);
      out[f * 2 + 1] = Math.tanh(r * 0.8);
    }
    this.pos += n;
    return n;
  }
}
