// The TypeScript engine: 8 tracks of 4-operator FM with a pitch envelope and
// noise, then the master safety chain. native/crates/fm_daw mirrors it line for
// line (same order of operations, f64 inside, f32 out), so the golden test can
// hold the two to the same output. render() allocates nothing.
//
// Master chain, in order: DC blocker, smoothed master gain, NaN guard (a bad
// voice resets the engine and outputs silence), peak limiter with instant
// attack at CEILING, then a hard clamp at CEILING. Nothing leaves louder than
// -1 dBFS, whatever the patch.
import { TRACKS, OPS, NPARAMS, VOICES, CEILING, MOD_DEPTH, FB_DEPTH, P, clampParam } from "./params.ts";

const LN_1000TH = Math.log(0.001); // "decay" = time to fall 60 dB
const GAIN_SMOOTH = 0.002;
const MASTER_SMOOTH = 0.0005;
const SILENT = 1e-5;
const TAU = 2 * Math.PI;
const CARRIERS = [[1, 0, 0, 0], [1, 0, 1, 0], [1, 0, 0, 0], [1, 1, 1, 1]];

export interface FmEngine {
  setParam(track: number, index: number, value: number): void;
  setMute(track: number, muted: boolean): void;
  setMaster(gain: number): void;
  noteOn(track: number, id: number, midi: number, velocity: number): void;
  noteOff(track: number, id: number): void;
  allOff(): void;
  panic(): void;
  click(accent: boolean): void;
  /** Interleaved stereo into `out` (length >= frames * 2). */
  render(out: Float32Array, frames: number): void;
  /** [peakL, peakR, lowest limiter gain, NaN resets] since the last call. */
  meter(out: Float32Array): void;
  free?(): void;
}

const decayCoef = (seconds: number, sr: number) => Math.exp(LN_1000TH / (seconds * sr));

export class TsEngine implements FmEngine {
  private readonly sr: number;
  private readonly params = new Float64Array(TRACKS * NPARAMS);
  // derived per track
  private readonly atkInc = new Float64Array(TRACKS * OPS);
  private readonly decCoef = new Float64Array(TRACKS * OPS);
  private readonly relCoef = new Float64Array(TRACKS * OPS);
  private readonly pitchCoef = new Float64Array(TRACKS);
  private readonly noiseCoef = new Float64Array(TRACKS);
  private readonly panL = new Float64Array(TRACKS);
  private readonly panR = new Float64Array(TRACKS);
  private readonly muted = new Uint8Array(TRACKS);
  private readonly gainNow = new Float64Array(TRACKS);
  // voices, struct of arrays: [track * VOICES + v]
  private readonly active = new Uint8Array(TRACKS * VOICES);
  private readonly gate = new Uint8Array(TRACKS * VOICES);
  private readonly vid = new Float64Array(TRACKS * VOICES);
  private readonly born = new Float64Array(TRACKS * VOICES);
  private readonly freq = new Float64Array(TRACKS * VOICES);
  private readonly amp = new Float64Array(TRACKS * VOICES);
  private readonly pitchEnv = new Float64Array(TRACKS * VOICES);
  private readonly noiseEnv = new Float64Array(TRACKS * VOICES);
  private readonly noiseLp = new Float64Array(TRACKS * VOICES);
  private readonly fb1 = new Float64Array(TRACKS * VOICES);
  private readonly fb2 = new Float64Array(TRACKS * VOICES);
  // operators: [(track * VOICES + v) * OPS + op]
  private readonly phase = new Float64Array(TRACKS * VOICES * OPS);
  private readonly env = new Float64Array(TRACKS * VOICES * OPS);
  private readonly stage = new Uint8Array(TRACKS * VOICES * OPS); // 0 attack, 1 decay/sustain, 2 release
  private births = 0;
  private rng = 0x9e3779b9;
  private clickEnv = 0; private clickPhase = 0; private clickFreq = 0; private readonly clickCoef: number;
  private dcXL = 0; private dcYL = 0; private dcXR = 0; private dcYR = 0; private readonly dcR: number;
  private masterTarget = 0.25; private master = 0.25;
  private limEnv = 0; private readonly limRel: number;
  private peakL = 0; private peakR = 0; private minGain = 1; private nans = 0;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    this.clickCoef = decayCoef(0.04, sampleRate);
    this.dcR = 1 - (TAU * 10) / sampleRate;
    this.limRel = Math.exp(-1 / (0.1 * sampleRate));
    for (let t = 0; t < TRACKS; t++) for (let i = 0; i < NPARAMS; i++) this.setParam(t, i, 0);
  }

  setParam(track: number, index: number, value: number) {
    if (!(track >= 0 && track < TRACKS && index >= 0 && index < NPARAMS)) return;
    const t = track | 0, i = index | 0;
    const v = clampParam(i, value);
    this.params[t * NPARAMS + i] = v;
    const sr = this.sr;
    if (i < OPS * 6) {
      const op = (i / 6) | 0, f = i % 6;
      if (f === 2) this.atkInc[t * OPS + op] = 1 / (v * sr);
      else if (f === 3) this.decCoef[t * OPS + op] = decayCoef(v, sr);
      else if (f === 5) this.relCoef[t * OPS + op] = decayCoef(v, sr);
    } else if (i === P.PITCH_DECAY) this.pitchCoef[t] = decayCoef(v, sr);
    else if (i === P.NOISE_DECAY) this.noiseCoef[t] = decayCoef(v, sr);
    else if (i === P.PAN) {
      const angle = ((v + 1) * Math.PI) / 4;
      this.panL[t] = Math.cos(angle);
      this.panR[t] = Math.sin(angle);
    }
  }

  setMute(track: number, muted: boolean) { if (track >= 0 && track < TRACKS) this.muted[track | 0] = muted ? 1 : 0; }

  setMaster(gain: number) { this.masterTarget = Number.isFinite(gain) ? Math.min(Math.max(gain, 0), 1) : 0; }

  noteOn(track: number, id: number, midi: number, velocity: number) {
    if (!(track >= 0 && track < TRACKS) || !Number.isFinite(midi) || !Number.isFinite(velocity)) return;
    const t = track | 0;
    let slot = 0, oldest = Infinity;
    for (let v = 0; v < VOICES; v++) {
      const k = t * VOICES + v;
      if (!this.active[k]) { slot = v; oldest = -1; break; }
      if (this.born[k] < oldest) { oldest = this.born[k]; slot = v; }
    }
    const k = t * VOICES + slot;
    const p = t * NPARAMS;
    const vel = Math.min(Math.max(velocity, 0), 1);
    const vs = this.params[p + P.VEL];
    this.active[k] = 1; this.gate[k] = 1; this.vid[k] = id;
    this.born[k] = ++this.births;
    this.freq[k] = 440 * Math.pow(2, (Math.min(Math.max(midi, 0), 127) - 69) / 12);
    this.amp[k] = 1 - vs + vs * vel;
    this.pitchEnv[k] = 1; this.noiseEnv[k] = 1; this.noiseLp[k] = 0;
    this.fb1[k] = 0; this.fb2[k] = 0;
    for (let op = 0; op < OPS; op++) {
      const o = k * OPS + op;
      this.phase[o] = 0; this.env[o] = 0; this.stage[o] = 0;
    }
  }

  noteOff(track: number, id: number) {
    if (!(track >= 0 && track < TRACKS)) return;
    const t = track | 0;
    for (let v = 0; v < VOICES; v++) {
      const k = t * VOICES + v;
      if (this.active[k] && this.gate[k] && this.vid[k] === id) this.release(k);
    }
  }

  allOff() { for (let k = 0; k < TRACKS * VOICES; k++) if (this.active[k] && this.gate[k]) this.release(k); }

  panic() {
    this.active.fill(0); this.gate.fill(0); this.env.fill(0);
    this.clickEnv = 0;
    this.dcXL = 0; this.dcYL = 0; this.dcXR = 0; this.dcYR = 0;
    this.limEnv = 0;
  }

  click(accent: boolean) { this.clickFreq = accent ? 1760 : 1320; this.clickEnv = 0.3; this.clickPhase = 0; }

  private release(k: number) {
    this.gate[k] = 0;
    for (let op = 0; op < OPS; op++) this.stage[k * OPS + op] = 2;
  }

  private nextNoise(): number {
    let x = this.rng;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.rng = x;
    return (x / 4294967296) * 2 - 1;
  }

  render(out: Float32Array, frames: number) {
    const n = Math.min(frames, out.length >> 1);
    const sr = this.sr;
    for (let f = 0; f < n; f++) {
      let l = 0, r = 0;
      for (let t = 0; t < TRACKS; t++) {
        const p = t * NPARAMS;
        const gainTarget = this.muted[t] ? 0 : this.params[p + P.GAIN];
        this.gainNow[t] += (gainTarget - this.gainNow[t]) * GAIN_SMOOTH;
        const algo = this.params[p + P.ALGO] | 0;
        const carriers = CARRIERS[algo];
        const nc = carriers[0] + carriers[1] + carriers[2] + carriers[3];
        const fbAmt = this.params[p + P.FEEDBACK] * FB_DEPTH;
        const pitchAmt = this.params[p + P.PITCH_AMT];
        const noise = this.params[p + P.NOISE];
        const tone = 0.05 + 0.95 * this.params[p + P.NOISE_TONE];
        let mono = 0;
        for (let v = 0; v < VOICES; v++) {
          const k = t * VOICES + v;
          if (!this.active[k]) continue;
          const pm = pitchAmt > 0 ? Math.pow(2, (pitchAmt * this.pitchEnv[k]) / 12) : 1;
          this.pitchEnv[k] *= this.pitchCoef[t];
          const base = this.freq[k] * pm;
          // operators 4..1 (indices 3..0); oN holds this sample's output of operator N+1
          let o3 = 0, o2 = 0, o1 = 0;
          let carrierSum = 0, loudest = 0, attacking = false;
          for (let op = OPS - 1; op >= 0; op--) {
            const oi = k * OPS + op, ti = t * OPS + op;
            // envelope
            let e = this.env[oi];
            const st = this.stage[oi];
            if (st === 0) {
              e += this.atkInc[ti];
              if (e >= 1) { e = 1; this.stage[oi] = 1; }
              attacking = true;
            } else if (st === 1) {
              const s = this.params[p + P.sustain(op)];
              e = s + (e - s) * this.decCoef[ti];
            } else e *= this.relCoef[ti];
            this.env[oi] = e;
            // modulation input for this operator
            let mod: number;
            if (op === 3) mod = (this.fb1[k] + this.fb2[k]) * 0.5 * fbAmt;
            else if (algo === 0) mod = (op === 2 ? o3 : op === 1 ? o2 : o1) * MOD_DEPTH;
            else if (algo === 1) mod = op === 2 ? o3 * MOD_DEPTH : op === 0 ? o1 * MOD_DEPTH : 0;
            else if (algo === 2) mod = op === 0 ? (o1 + o2 + o3) * MOD_DEPTH : 0;
            else mod = 0;
            const ph = this.phase[oi];
            const y = Math.sin(TAU * (ph + mod)) * e * this.params[p + P.level(op)];
            let np = ph + (base * this.params[p + P.ratio(op)]) / sr;
            np -= Math.floor(np);
            this.phase[oi] = np;
            if (op === 3) { this.fb2[k] = this.fb1[k]; this.fb1[k] = y; o3 = y; }
            else if (op === 2) o2 = y;
            else if (op === 1) o1 = y;
            if (carriers[op]) { carrierSum += y; if (e > loudest) loudest = e; }
          }
          let ns = 0;
          if (noise > 0) {
            const lp = this.noiseLp[k] + tone * (this.nextNoise() - this.noiseLp[k]);
            this.noiseLp[k] = lp;
            ns = lp * this.noiseEnv[k] * noise;
            this.noiseEnv[k] *= this.noiseCoef[t];
            if (this.noiseEnv[k] > loudest) loudest = this.noiseEnv[k];
          }
          mono += (carrierSum / nc + ns) * this.amp[k];
          if (!attacking && loudest < SILENT) this.active[k] = 0;
        }
        mono *= this.gainNow[t];
        l += mono * this.panL[t];
        r += mono * this.panR[t];
      }
      if (this.clickEnv > SILENT) {
        const c = Math.sin(TAU * this.clickPhase) * this.clickEnv;
        this.clickPhase += this.clickFreq / sr;
        this.clickPhase -= Math.floor(this.clickPhase);
        this.clickEnv *= this.clickCoef;
        l += c; r += c;
      }
      // DC blocker
      const yl = l - this.dcXL + this.dcR * this.dcYL;
      this.dcXL = l; this.dcYL = yl;
      const yr = r - this.dcXR + this.dcR * this.dcYR;
      this.dcXR = r; this.dcYR = yr;
      this.master += (this.masterTarget - this.master) * MASTER_SMOOTH;
      l = yl * this.master; r = yr * this.master;
      // NaN guard
      if (!Number.isFinite(l) || !Number.isFinite(r)) {
        this.nans++;
        this.panic();
        l = 0; r = 0;
      }
      // limiter: instant attack, 100 ms release
      const pk = Math.max(Math.abs(l), Math.abs(r));
      this.limEnv = pk > this.limEnv ? pk : pk + (this.limEnv - pk) * this.limRel;
      const g = this.limEnv > CEILING ? CEILING / this.limEnv : 1;
      if (g < this.minGain) this.minGain = g;
      l = Math.min(Math.max(l * g, -CEILING), CEILING);
      r = Math.min(Math.max(r * g, -CEILING), CEILING);
      if (Math.abs(l) > this.peakL) this.peakL = Math.abs(l);
      if (Math.abs(r) > this.peakR) this.peakR = Math.abs(r);
      out[f * 2] = l;
      out[f * 2 + 1] = r;
    }
  }

  meter(out: Float32Array) {
    out[0] = this.peakL; out[1] = this.peakR; out[2] = this.minGain; out[3] = this.nans;
    this.peakL = 0; this.peakR = 0; this.minGain = 1;
  }
}
