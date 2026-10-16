// Space: a shared reverb and tempo-synced ping-pong delay after the engine.
// It runs in TypeScript after either engine (worklet and bounce alike), so the
// Rust/TS parity of the engine itself is untouched.
//
// The send is high-passed (~280 Hz) so kick and sub stay dry while hats,
// snares, leads and pads float. The reverb is the classic Schroeder/Moorer
// layout Freeverb made famous (8 damped combs into 4 allpasses per side; the
// algorithm is public domain). The delay feeds the reverb, so echoes smear
// into the tail. The wet signal is widened (side boosted) and slowly rotated
// across the field, so the space moves around a dry centre that stays put:
// kick, snare and a centred lead hit in mono while the tails swirl. Then its own peak limiter and a hard clamp at CEILING: the
// wet signal adds level, and nothing leaves louder than -1 dBFS.
// No allocation in process().
import { CEILING } from "./params.ts";

const COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
const ALLPASSES = [556, 441, 341, 225];
const SPREAD = 23;
const ROOM = 0.9;     // comb feedback: a long, soft tail
const DAMP = 0.45;    // high cut inside the combs
// Delay feedback climbs with the amount, up to the edge of running away; a
// soft saturator in the loop compresses the repeats so they never do.
const DELAY_FB_LO = 0.32, DELAY_FB_HI = 0.78;
// Tape wobble on the delay time: the repeats bend in pitch a little.
const WOW_HZ = 0.31, WOW_S = 0.0022;
const WET = 0.55;     // reverb + delay level at amount 1
const MAX_DELAY_S = 1.2;
const WIDTH = 1.6;     // side gain on the wet signal
const SWIRL_HZ = 0.07; // one slow turn of the wet field every ~14 s
const SWIRL = 0.7;     // radians either way

export class Space {
  private amount = 0;
  private amountNow = 0;
  private readonly sr: number;
  private readonly comb: Float64Array[] = [];
  private readonly combIdx = new Int32Array(16);
  private readonly combLp = new Float64Array(16);
  private readonly ap: Float64Array[] = [];
  private readonly apIdx = new Int32Array(8);
  private readonly dl: Float64Array;
  private readonly dr: Float64Array;
  private dIdx = 0;
  private dLen = 1;
  private wow = 0; private readonly wowInc: number; private readonly wowDepth: number;
  private dLpL = 0; private dLpR = 0;
  private hpL = 0; private hpR = 0; private hpXL = 0; private hpXR = 0;
  private readonly hpA: number;
  private limEnv = 0; private readonly limRel: number;
  private swirl = 0; private readonly swirlInc: number;

  constructor(sampleRate: number) {
    this.sr = sampleRate;
    const k = sampleRate / 44100;
    for (let side = 0; side < 2; side++) {
      for (const n of COMBS) this.comb.push(new Float64Array(Math.round((n + side * SPREAD) * k)));
      for (const n of ALLPASSES) this.ap.push(new Float64Array(Math.round((n + side * SPREAD) * k)));
    }
    const max = Math.ceil(MAX_DELAY_S * sampleRate);
    this.dl = new Float64Array(max);
    this.dr = new Float64Array(max);
    this.hpA = Math.exp((-2 * Math.PI * 280) / sampleRate);
    this.limRel = Math.exp(-1 / (0.1 * sampleRate));
    this.swirlInc = (2 * Math.PI * SWIRL_HZ) / sampleRate;
    this.wowInc = (2 * Math.PI * WOW_HZ) / sampleRate;
    this.wowDepth = WOW_S * sampleRate;
    this.setTempo(120);
  }

  /** 0 is dry (and costs nothing once the tail has died), 1 is drenched. */
  setAmount(a: number) { this.amount = Number.isFinite(a) ? Math.min(Math.max(a, 0), 1) : 0; }

  /** The delay is a dotted eighth: the liquid, rolling echo. */
  setTempo(bpm: number) {
    const b = Number.isFinite(bpm) && bpm > 0 ? bpm : 120;
    this.dLen = Math.min(Math.max(this.wowDepth + 2, Math.round((60 / b) * 0.75 * this.sr)), this.dl.length - this.wowDepth - 2);
  }

  reset() {
    for (const c of this.comb) c.fill(0);
    for (const a of this.ap) a.fill(0);
    this.combLp.fill(0); this.dl.fill(0); this.dr.fill(0);
    this.dLpL = 0; this.dLpR = 0; this.hpL = 0; this.hpR = 0; this.hpXL = 0; this.hpXR = 0; this.limEnv = 0;
  }

  /** In place on interleaved stereo. */
  process(buf: Float32Array, frames: number) {
    const n = Math.min(frames, buf.length >> 1);
    if (this.amount === 0 && this.amountNow < 1e-4) { this.amountNow = 0; return; }
    for (let f = 0; f < n; f++) {
      const l = buf[f * 2], r = buf[f * 2 + 1];
      this.amountNow += (this.amount - this.amountNow) * 0.0005;
      // one-pole high-pass on the send
      this.hpL = this.hpA * (this.hpL + l - this.hpXL); this.hpXL = l;
      this.hpR = this.hpA * (this.hpR + r - this.hpXR); this.hpXR = r;
      // ping-pong delay with a darkening loop
      this.wow += this.wowInc;
      if (this.wow > 2 * Math.PI) this.wow -= 2 * Math.PI;
      const D = this.dl.length;
      const back = this.dLen + Math.sin(this.wow) * this.wowDepth;
      const at = this.dIdx - back + D, i0 = Math.floor(at), fr = at - i0;
      const j0 = i0 % D, j1 = (i0 + 1) % D;
      const echoL = this.dl[j0] + (this.dl[j1] - this.dl[j0]) * fr;
      const echoR = this.dr[j0] + (this.dr[j1] - this.dr[j0]) * fr;
      this.dLpL += (echoR - this.dLpL) * 0.35;
      this.dLpR += (echoL - this.dLpR) * 0.35;
      const fb = DELAY_FB_LO + (DELAY_FB_HI - DELAY_FB_LO) * this.amountNow;
      this.dl[this.dIdx] = Math.tanh(this.hpL * 0.5 + this.dLpL * fb);
      this.dr[this.dIdx] = Math.tanh(this.hpR * 0.5 + this.dLpR * fb);
      this.dIdx = (this.dIdx + 1) % this.dl.length;
      // reverb: mono-ish input, stereo out from the spread
      const input = (this.hpL + this.hpR + echoL + echoR) * 0.015;
      let wl = 0, wr = 0;
      for (let c = 0; c < 16; c++) {
        const line = this.comb[c], i = this.combIdx[c];
        const y = line[i];
        this.combLp[c] = y * (1 - DAMP) + this.combLp[c] * DAMP;
        line[i] = input + this.combLp[c] * ROOM;
        this.combIdx[c] = i + 1 === line.length ? 0 : i + 1;
        if (c < 8) wl += y; else wr += y;
      }
      for (let a = 0; a < 8; a++) {
        const line = this.ap[a], i = this.apIdx[a];
        const b = line[i];
        if (a < 4) { line[i] = wl + b * 0.5; wl = b - wl; }
        else { line[i] = wr + b * 0.5; wr = b - wr; }
        this.apIdx[a] = i + 1 === line.length ? 0 : i + 1;
      }
      const g = this.amountNow * WET;
      const xl = wl + echoL * 0.6, xr = wr + echoR * 0.6;
      const mid = (xl + xr) * 0.5, side = (xl - xr) * 0.5 * WIDTH;
      this.swirl += this.swirlInc;
      if (this.swirl > 2 * Math.PI) this.swirl -= 2 * Math.PI;
      const a = Math.sin(this.swirl) * SWIRL, ca = Math.cos(a), sa = Math.sin(a);
      const sl = mid + side, sr = mid - side;
      let ol = l + (sl * ca - sr * sa) * g;
      let or = r + (sl * sa + sr * ca) * g;
      if (!Number.isFinite(ol) || !Number.isFinite(or)) { this.reset(); ol = Number.isFinite(l) ? l : 0; or = Number.isFinite(r) ? r : 0; }
      const pk = Math.max(Math.abs(ol), Math.abs(or));
      this.limEnv = pk > this.limEnv ? pk : pk + (this.limEnv - pk) * this.limRel;
      const lim = this.limEnv > CEILING ? CEILING / this.limEnv : 1;
      buf[f * 2] = Math.min(Math.max(ol * lim, -CEILING), CEILING);
      buf[f * 2 + 1] = Math.min(Math.max(or * lim, -CEILING), CEILING);
    }
  }
}
