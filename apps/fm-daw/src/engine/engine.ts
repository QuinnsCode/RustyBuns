// The TypeScript engine: 12 tracks, each either 4-operator FM or the analog
// voice (detuned saws, pulses or a seven-saw supersaw + sub, a wavefolder, an
// SVF, ladder or vowel filter, filter envelope, LFO, glide, drive), with a pitch
// envelope and noise, a chorus per track, then the master safety chain. native/crates/fm_daw mirrors it line for
// line (same order of operations, f64 inside, f32 out), so the golden test can
// hold the two to the same output. render() allocates nothing.
//
// Master chain, in order: DC blocker, smoothed master gain, NaN guard (a bad
// voice resets the engine and outputs silence), peak limiter with instant
// attack at CEILING, then a hard clamp at CEILING. Nothing leaves louder than
// -1 dBFS, whatever the patch.
import { TRACKS, OPS, NPARAMS, VOICES, CEILING, MOD_DEPTH, FB_DEPTH, P, LFO_DIVS, BEND_RANGE, clampParam } from "./params.ts";

const LN_1000TH = Math.log(0.001); // "decay" = time to fall 60 dB
const GAIN_SMOOTH = 0.002;
const MASTER_SMOOTH = 0.0005;
const SILENT = 1e-5;
const TAU = 2 * Math.PI;
const CARRIERS = [[1, 0, 0, 0], [1, 0, 1, 0], [1, 0, 0, 0], [1, 1, 1, 1]];
const MAX_CUTOFF = 0.45; // of the sample rate
const VIB_FADE = 0.3;
const SQRT2 = Math.SQRT2; // the track filters' damping: Butterworth, no peak
// Vowel filter formants (F1, F2 in Hz), swept in this order by the cutoff: oo, oh, ah, eh, ee.
const VOWEL_F1 = [300, 570, 730, 530, 270];
const VOWEL_F2 = [870, 840, 1090, 1840, 2290];
// The bucket-brigade chorus: one delay line per track, a triangle LFO, the wet
// signal added on the left and subtracted on the right. Per mode: LFO Hz and
// the delay's sweep in ms (the figures published for the 80s polysynth circuit).
const CH_LEN = 4096; // a power of two past 5.35 ms at 384 kHz
const CH_RATE = [0, 0.513, 0.863, 9.75];
const CH_MIN = [0, 1.66, 1.66, 3.22];
const CH_MAX = [0, 5.35, 5.35, 3.56];
const CH_WET = 0.8;
const CH_TONE = 7000; // Hz: the wet path's one-pole low-pass, the bucket brigade's darkness
// The supersaw, from Adam Szabo's "How to Emulate the Super Saw" (2010): each
// saw's frequency offset at full detune, and his fitted detune curve (x^11 down
// to x^0) that keeps the knob's first half subtle. Start phases are fixed
// rather than random so the two engines stay bit for bit.
const SS_OFF = [-0.11002313, -0.06288439, -0.01952356, 0, 0.01991221, 0.06216538, 0.10745242];
const SS_PHASE = [0.11, 0.53, 0.29, 0, 0.83, 0.47, 0.67];
const SS_CURVE = [10028.7312891634, -50818.8652045924, 111363.4808729368, -138150.6761080548, 106649.6679158292,
  -53046.9642751875, 17019.951858008, -3425.0836591318, 404.2703938388, -24.1878824391, 0.6717417634, 0.0030115596];
const SAWS = 7;

/** Trapezoidal SVF coefficients [a1, a2, a3] for cutoff 20 Hz * 2^(10 x). */
function svfCoefs(x: number, sr: number, out: Float64Array, at: number) {
  const fc = Math.min(20 * Math.pow(2, 10 * x), MAX_CUTOFF * sr);
  const g = Math.tan((Math.PI * fc) / sr);
  const a1 = 1 / (1 + g * (g + SQRT2));
  out[at] = a1; out[at + 1] = g * a1; out[at + 2] = g * g * a1;
}    // seconds for an analog note's vibrato to come in, as a player's would

/** A naive saw with PolyBLEP smoothing at the wrap: cheap, and no aliasing fizz. */
function saw(ph: number, dt: number): number {
  let y = 2 * ph - 1;
  if (ph < dt) { const x = ph / dt; y -= x + x - x * x - 1; }
  else if (ph > 1 - dt) { const x = (ph - 1) / dt; y -= x * x + x + x + 1; }
  return y;
}

export interface FmEngine {
  setParam(track: number, index: number, value: number): void;
  setMute(track: number, muted: boolean): void;
  setMaster(gain: number): void;
  /** Beats per minute, for tempo-synced LFOs. */
  setTempo(bpm: number): void;
  /**
   * Where the transport is, in beats; the sequencer sends it every tick while
   * playing. Synced LFOs that don't restart on notes take their phase from it,
   * so they sit on the grid. In between it runs on at the tempo.
   */
  setBeat(beats: number): void;
  /** Pitch bend for a track's sounding and future notes, in semitones (clamped to BEND_RANGE). */
  setBend(track: number, semitones: number): void;
  noteOn(track: number, id: number, midi: number, velocity: number): void;
  noteOff(track: number, id: number): void;
  allOff(): void;
  panic(): void;
  click(accent: boolean): void;
  /**
   * Interleaved stereo into `out` (length >= frames * 2). With `send`, also
   * the Space send bus: each track times its SEND, after pan and master.
   */
  render(out: Float32Array, frames: number, send?: Float32Array): void;
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
  // analog voice, per track
  private readonly detUp = new Float64Array(TRACKS);
  private readonly fAtkInc = new Float64Array(TRACKS);
  private readonly fDecCoef = new Float64Array(TRACKS);
  private readonly glideCoef = new Float64Array(TRACKS);
  private readonly driveG = new Float64Array(TRACKS);
  private readonly driveNorm = new Float64Array(TRACKS);
  private readonly lfoPhase = new Float64Array(TRACKS);
  private readonly lastFreq = new Float64Array(TRACKS);
  private readonly bendMul = new Float64Array(TRACKS).fill(1);
  private tempo = 120;
  private beat = 0;
  // supersaw, per track: detune spread, centre and side gains, a level trim
  private readonly ssDet = new Float64Array(TRACKS);
  private readonly ssC = new Float64Array(TRACKS);
  private readonly ssS = new Float64Array(TRACKS);
  private readonly ssN = new Float64Array(TRACKS);
  // chorus: a delay line per track, its LFO phase and wet low-pass state; one write head for all
  private readonly chBuf = new Float64Array(TRACKS * CH_LEN);
  private readonly chPh = new Float64Array(TRACKS);
  private readonly chLp = new Float64Array(TRACKS);
  private chW = 0;
  private readonly chK: number;
  // track filters: on flags, coefficients [a1, a2, a3] per track, state [ic1, ic2]
  private readonly lpOn = new Uint8Array(TRACKS);
  private readonly hpOn = new Uint8Array(TRACKS);
  private readonly lpK = new Float64Array(TRACKS * 3);
  private readonly hpK = new Float64Array(TRACKS * 3);
  private readonly lpS = new Float64Array(TRACKS * 2);
  private readonly hpS = new Float64Array(TRACKS * 2);
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
  private readonly freqNow = new Float64Array(TRACKS * VOICES);
  private readonly saw1 = new Float64Array(TRACKS * VOICES);
  private readonly saw2 = new Float64Array(TRACKS * VOICES);
  private readonly subPh = new Float64Array(TRACKS * VOICES);
  private readonly ic1 = new Float64Array(TRACKS * VOICES);
  private readonly ic2 = new Float64Array(TRACKS * VOICES);
  // the ladder's last two stages, or the vowel filter's second formant
  private readonly ic3 = new Float64Array(TRACKS * VOICES);
  private readonly ic4 = new Float64Array(TRACKS * VOICES);
  private readonly fEnv = new Float64Array(TRACKS * VOICES);
  private readonly fStage = new Uint8Array(TRACKS * VOICES);
  private readonly vel = new Float64Array(TRACKS * VOICES);
  // the supersaw's seven phases: [(track * VOICES + v) * SAWS + i]
  private readonly ssPh = new Float64Array(TRACKS * VOICES * SAWS);
  private readonly age = new Float64Array(TRACKS * VOICES);
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
    this.chK = 1 - Math.exp((-TAU * CH_TONE) / sampleRate);
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
    else if (i === P.DETUNE) {
      this.detUp[t] = Math.pow(2, (v * 0.5) / 12);
      let d = 0;
      for (let c = 0; c < SS_CURVE.length; c++) d = d * v + SS_CURVE[c];
      this.ssDet[t] = d;
    }
    else if (i === P.SUPER) {
      const c = -0.55366 * v + 0.99785, sd = -0.73764 * v * v + 1.2841 * v + 0.044372;
      this.ssC[t] = c; this.ssS[t] = sd;
      // the saws' phases don't line up, so they add like noise: by RMS, trimmed to the two-saw level
      this.ssN[t] = 0.7 / Math.sqrt(c * c + 6 * sd * sd);
    }
    else if (i === P.FENV_ATTACK) this.fAtkInc[t] = 1 / (v * sr);
    else if (i === P.FENV_DECAY) this.fDecCoef[t] = decayCoef(v, sr);
    else if (i === P.GLIDE) this.glideCoef[t] = v > 0 ? Math.exp(-1 / (v * sr)) : 0;
    else if (i === P.HICUT) { this.lpOn[t] = v > 0.001 ? 1 : 0; svfCoefs(1 - v, sr, this.lpK, t * 3); }
    else if (i === P.LOCUT) { this.hpOn[t] = v > 0.001 ? 1 : 0; svfCoefs(v, sr, this.hpK, t * 3); }
    else if (i === P.DRIVE) { this.driveG[t] = 1 + 6 * v; this.driveNorm[t] = 1 / Math.tanh(1 + 6 * v); }
  }

  setMute(track: number, muted: boolean) { if (track >= 0 && track < TRACKS) this.muted[track | 0] = muted ? 1 : 0; }

  setMaster(gain: number) { this.masterTarget = Number.isFinite(gain) ? Math.min(Math.max(gain, 0), 1) : 0; }

  setTempo(bpm: number) { this.tempo = Number.isFinite(bpm) ? Math.min(Math.max(bpm, 20), 400) : 120; }

  setBeat(beats: number) { if (Number.isFinite(beats)) this.beat = Math.min(Math.max(beats, 0), 1e6); }

  setBend(track: number, semitones: number) {
    if (!(track >= 0 && track < TRACKS)) return;
    const s = Number.isFinite(semitones) ? Math.min(Math.max(semitones, -BEND_RANGE), BEND_RANGE) : 0;
    this.bendMul[track | 0] = Math.pow(2, s / 12);
  }

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
    this.freqNow[k] = this.glideCoef[t] > 0 && this.lastFreq[t] > 0 ? this.lastFreq[t] : this.freq[k];
    this.lastFreq[t] = this.freq[k];
    this.saw1[k] = 0; this.saw2[k] = 0.5; this.subPh[k] = 0;
    for (let i = 0; i < SAWS; i++) this.ssPh[k * SAWS + i] = SS_PHASE[i];
    this.ic1[k] = 0; this.ic2[k] = 0; this.ic3[k] = 0; this.ic4[k] = 0; this.fEnv[k] = 0; this.fStage[k] = 0;
    if (this.params[p + P.LFO_RETRIG] >= 0.5) this.lfoPhase[t] = 0;
    this.amp[k] = 1 - vs + vs * vel;
    this.vel[k] = vel; this.age[k] = 0;
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
    this.lpS.fill(0); this.hpS.fill(0);
    this.chBuf.fill(0); this.chLp.fill(0);
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

  render(out: Float32Array, frames: number, send?: Float32Array) {
    const n = Math.min(frames, out.length >> 1, send ? send.length >> 1 : Infinity);
    const sr = this.sr;
    const beatInc = this.tempo / 60 / sr;
    for (let f = 0; f < n; f++) {
      let l = 0, r = 0, sl = 0, sr2 = 0;
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
        // the LFO runs for every track, every frame, so it's free-running across
        // notes; a synced one that doesn't restart on notes follows the transport
        const sync = this.params[p + P.LFO_SYNC] | 0;
        if (sync > 0 && this.params[p + P.LFO_RETRIG] < 0.5) { const q = this.beat / LFO_DIVS[sync]; this.lfoPhase[t] = q - Math.floor(q); }
        const lph = this.lfoPhase[t], shape = this.params[p + P.LFO_SHAPE] | 0;
        const lfo = shape === 0 ? Math.sin(TAU * lph) : shape === 1 ? 1 - 4 * Math.abs(lph - 0.5) : shape === 2 ? 1 - 2 * lph : lph < 0.5 ? 1 : -1;
        const rate = sync > 0 ? this.tempo / 60 / LFO_DIVS[sync] : this.params[p + P.LFO_RATE];
        let lp = this.lfoPhase[t] + rate / sr;
        lp -= Math.floor(lp);
        this.lfoPhase[t] = lp;
        const analog = this.params[p + P.MODE] >= 0.5;
        const vibAmt = this.params[p + P.LFO_PITCH];
        const velTone = this.params[p + P.VEL_TONE];
        const cutOct = this.params[p + P.CUTOFF] * 10 + this.params[p + P.LFO_CUT] * 4 * lfo;
        const fenvOct = this.params[p + P.FENV_AMT] * 6;
        const k2 = 2 - 1.8 * this.params[p + P.RES]; // resonance tops out near Q 5, musical not screaming
        const sub = this.params[p + P.SUB];
        const drive = this.params[p + P.DRIVE] > 0;
        const ftype = this.params[p + P.FILTER] | 0;
        const wave = this.params[p + P.WAVE];
        const supersaw = this.params[p + P.SUPER] > 0;
        const fold = this.params[p + P.FOLD];
        const pw = 0.5 - 0.45 * this.params[p + P.PWM] * (0.5 + 0.5 * lfo);
        const kq = 3.9 * this.params[p + P.RES]; // ladder feedback: self-oscillation starts at 4
        const kv = 0.5 - 0.4 * this.params[p + P.RES]; // vowel band-pass damping: Q 2 to 10
        const bend = this.bendMul[t];
        const fmWob = 1 + this.params[p + P.LFO_CUT] * lfo; // FM: the LFO moves modulation depth
        let mono = 0;
        for (let v = 0; v < VOICES; v++) {
          const k = t * VOICES + v;
          if (!this.active[k]) continue;
          const pm = pitchAmt > 0 ? Math.pow(2, (pitchAmt * this.pitchEnv[k]) / 12) : 1;
          this.pitchEnv[k] *= this.pitchCoef[t];
          if (analog) {
            const target = this.freq[k];
            this.freqNow[k] = target + (this.freqNow[k] - target) * this.glideCoef[t];
            const fade = Math.min(this.age[k] / VIB_FADE, 1);
            this.age[k] += 1 / sr;
            const vib = vibAmt > 0 ? Math.pow(2, (lfo * vibAmt * 0.5 * fade) / 12) : 1;
            const base = this.freqNow[k] * pm * vib * bend;
            // amp envelope: operator 1's
            const oi = k * OPS, ti = t * OPS;
            let e = this.env[oi];
            const st = this.stage[oi];
            let attacking = false;
            if (st === 0) {
              e += this.atkInc[ti];
              if (e >= 1) { e = 1; this.stage[oi] = 1; }
              attacking = true;
            } else if (st === 1) {
              const s = this.params[p + P.sustain(0)];
              e = s + (e - s) * this.decCoef[ti];
            } else e *= this.relCoef[ti];
            this.env[oi] = e;
            // filter envelope: attack, then decay to nothing
            let fe = this.fEnv[k];
            if (this.fStage[k] === 0) {
              fe += this.fAtkInc[t];
              if (fe >= 1) { fe = 1; this.fStage[k] = 1; }
            } else fe *= this.fDecCoef[t];
            this.fEnv[k] = fe;
            // oscillators
            const dt1 = (base * this.detUp[t]) / sr, dt2 = base / this.detUp[t] / sr;
            let s1 = saw(this.saw1[k], dt1), s2 = saw(this.saw2[k], dt2);
            let ss = 0;
            if (supersaw) {
              // seven saws spread by the detune curve, the centre one against the six around it
              for (let i = 0; i < SAWS; i++) {
                const o = k * SAWS + i, dt = (base * (1 + SS_OFF[i] * this.ssDet[t])) / sr;
                ss += saw(this.ssPh[o], dt) * (i === 3 ? this.ssC[t] : this.ssS[t]);
                let w = this.ssPh[o] + dt; w -= Math.floor(w); this.ssPh[o] = w;
              }
              ss *= this.ssN[t];
            } else if (wave > 0) {
              // a pulse is a saw minus a saw shifted by the width
              let w = this.saw1[k] + pw; w -= Math.floor(w);
              s1 -= saw(w, dt1) * wave;
              w = this.saw2[k] + pw; w -= Math.floor(w);
              s2 -= saw(w, dt2) * wave;
            }
            let q = this.saw1[k] + dt1; q -= Math.floor(q); this.saw1[k] = q;
            q = this.saw2[k] + dt2; q -= Math.floor(q); this.saw2[k] = q;
            const sv = Math.sin(TAU * this.subPh[k]) * sub;
            q = this.subPh[k] + (base * 0.5) / sr; q -= Math.floor(q); this.subPh[k] = q;
            let x = (supersaw ? ss : (s1 + s2) * 0.5) + sv;
            // noise goes into the filter here (bow and breath), held by the amp envelope
            if (noise > 0) {
              const nl = this.noiseLp[k] + tone * (this.nextNoise() - this.noiseLp[k]);
              this.noiseLp[k] = nl;
              x += nl * noise;
            }
            // wavefolder: a sine fold, the textbook West Coast shaper; past +-1 the wave turns back on itself
            if (fold > 0) x = Math.sin(x * (1 + 6 * fold) * Math.PI * 0.5);
            // resonant low-pass: a trapezoidal state-variable filter, stable at any cutoff
            const velOct = velTone * 3 * (2 * this.vel[k] - 1);
            const oct = cutOct + fenvOct * fe + velOct;
            let f2: number;
            if (ftype === 2) {
              // vowel: two formant band-passes, their centres slid along the vowel table by the cutoff
              const pos = Math.min(Math.max(oct / 10, 0), 1) * 4;
              const vi = Math.min(Math.floor(pos), 3), fr = pos - vi;
              const fa = Math.min(VOWEL_F1[vi] * Math.pow(VOWEL_F1[vi + 1] / VOWEL_F1[vi], fr), MAX_CUTOFF * sr);
              const fb = Math.min(VOWEL_F2[vi] * Math.pow(VOWEL_F2[vi + 1] / VOWEL_F2[vi], fr), MAX_CUTOFF * sr);
              let g = Math.tan((Math.PI * fa) / sr);
              let a1 = 1 / (1 + g * (g + kv)), a2 = g * a1, a3 = g * a2;
              let v3 = x - this.ic2[k];
              const b1 = a1 * this.ic1[k] + a2 * v3;
              let v2 = this.ic2[k] + a2 * this.ic1[k] + a3 * v3;
              this.ic1[k] = 2 * b1 - this.ic1[k];
              this.ic2[k] = 2 * v2 - this.ic2[k];
              g = Math.tan((Math.PI * fb) / sr);
              a1 = 1 / (1 + g * (g + kv)); a2 = g * a1; a3 = g * a2;
              v3 = x - this.ic4[k];
              const b2 = a1 * this.ic3[k] + a2 * v3;
              v2 = this.ic4[k] + a2 * this.ic3[k] + a3 * v3;
              this.ic3[k] = 2 * b2 - this.ic3[k];
              this.ic4[k] = 2 * v2 - this.ic4[k];
              f2 = (b1 + 0.7 * b2) * kv * 2.5;
            } else {
              const fc = Math.min(Math.max(20 * Math.pow(2, oct), 20), MAX_CUTOFF * sr);
              const g = Math.tan((Math.PI * fc) / sr);
              if (ftype === 1) {
                // ladder: four zero-delay one-poles, the feedback solved, then tanh on the input
                const G = g / (1 + g), H = 1 - G;
                const S = G * G * G * H * this.ic1[k] + G * G * H * this.ic2[k] + G * H * this.ic3[k] + H * this.ic4[k];
                const u = Math.tanh((x * (1 + 0.5 * kq) - kq * S) / (1 + kq * G * G * G * G));
                let vv = (u - this.ic1[k]) * G; const y1 = vv + this.ic1[k]; this.ic1[k] = y1 + vv;
                vv = (y1 - this.ic2[k]) * G; const y2 = vv + this.ic2[k]; this.ic2[k] = y2 + vv;
                vv = (y2 - this.ic3[k]) * G; const y3 = vv + this.ic3[k]; this.ic3[k] = y3 + vv;
                vv = (y3 - this.ic4[k]) * G; f2 = vv + this.ic4[k]; this.ic4[k] = f2 + vv;
              } else {
                const a1 = 1 / (1 + g * (g + k2)), a2 = g * a1, a3 = g * a2;
                const v3 = x - this.ic2[k];
                const v1 = a1 * this.ic1[k] + a2 * v3;
                f2 = this.ic2[k] + a2 * this.ic1[k] + a3 * v3;
                this.ic1[k] = 2 * v1 - this.ic1[k];
                this.ic2[k] = 2 * f2 - this.ic2[k];
              }
            }
            const y = drive ? Math.tanh(f2 * this.driveG[t]) * this.driveNorm[t] : f2;
            mono += y * e * this.params[p + P.level(0)] * this.amp[k];
            if (!attacking && e < SILENT) this.active[k] = 0;
            continue;
          }
          const base = this.freq[k] * pm * bend;
          const mv = (1 + velTone * (2 * this.vel[k] - 1)) * fmWob;
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
            mod *= mv;
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
        if (this.lpOn[t]) {
          const c = t * 3, z = t * 2;
          const v3 = mono - this.lpS[z + 1];
          const v1 = this.lpK[c] * this.lpS[z] + this.lpK[c + 1] * v3;
          const v2 = this.lpS[z + 1] + this.lpK[c + 1] * this.lpS[z] + this.lpK[c + 2] * v3;
          this.lpS[z] = 2 * v1 - this.lpS[z];
          this.lpS[z + 1] = 2 * v2 - this.lpS[z + 1];
          mono = v2;
        }
        if (this.hpOn[t]) {
          const c = t * 3, z = t * 2;
          const v3 = mono - this.hpS[z + 1];
          const v1 = this.hpK[c] * this.hpS[z] + this.hpK[c + 1] * v3;
          const v2 = this.hpS[z + 1] + this.hpK[c + 1] * this.hpS[z] + this.hpK[c + 2] * v3;
          this.hpS[z] = 2 * v1 - this.hpS[z];
          this.hpS[z + 1] = 2 * v2 - this.hpS[z + 1];
          mono = mono - SQRT2 * v1 - v2;
        }
        mono *= this.gainNow[t];
        const cb = t * CH_LEN;
        this.chBuf[cb + this.chW] = mono;
        let ml: number, mr: number;
        const cm = this.params[p + P.CHORUS] | 0;
        if (cm > 0) {
          const cp = this.chPh[t];
          const tri = 1 - 4 * Math.abs(cp - 0.5);
          let q = cp + CH_RATE[cm] / sr; q -= Math.floor(q); this.chPh[t] = q;
          const d = (CH_MIN[cm] + (CH_MAX[cm] - CH_MIN[cm]) * (0.5 + 0.5 * tri)) * sr * 0.001;
          const rp = this.chW - d + CH_LEN;
          const ri = Math.floor(rp), fr = rp - ri;
          const i0 = ri >= CH_LEN ? ri - CH_LEN : ri, i1 = i0 + 1 === CH_LEN ? 0 : i0 + 1;
          const raw = this.chBuf[cb + i0] + (this.chBuf[cb + i1] - this.chBuf[cb + i0]) * fr;
          const wet = this.chLp[t] + this.chK * (raw - this.chLp[t]);
          this.chLp[t] = wet;
          ml = (mono + wet * CH_WET) * this.panL[t];
          mr = (mono - wet * CH_WET) * this.panR[t];
        } else { ml = mono * this.panL[t]; mr = mono * this.panR[t]; }
        l += ml;
        r += mr;
        const sa = this.params[p + P.SEND];
        sl += ml * sa;
        sr2 += mr * sa;
      }
      this.chW = this.chW + 1 === CH_LEN ? 0 : this.chW + 1;
      this.beat += beatInc;
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
      if (send) {
        const a = sl * this.master, b = sr2 * this.master;
        const ok = Number.isFinite(a) && Number.isFinite(b);
        send[f * 2] = ok ? Math.min(Math.max(a, -1), 1) : 0;
        send[f * 2 + 1] = ok ? Math.min(Math.max(b, -1), 1) : 0;
      }
    }
  }

  meter(out: Float32Array) {
    out[0] = this.peakL; out[1] = this.peakR; out[2] = this.minGain; out[3] = this.nans;
    this.peakL = 0; this.peakR = 0; this.minGain = 1;
  }
}
