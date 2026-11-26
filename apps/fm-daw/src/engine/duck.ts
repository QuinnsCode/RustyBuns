// The sidechain for a track's sound the engine doesn't play (#6158): its clips, a plugin's sound, a player's line.
// The engine ducks its own voices (engine.ts, DUCK_FROM and DUCK). Out here the track it ducks under is heard on
// its tap (a copy, after its Shape: (L+R)/√2, so a centred track reads as the engine's follower does), through the
// same follower, and each ducked track gets a gain a frame for the block. The audio thread (worklet.ts) and the
// bounce (offline.ts) both run it, so a bounce dips where playback does.
// Not yet: a track the engine doesn't play driving a duck (a recorded kick pumping the FM bass), #6215.
import { TRACKS, P, DUCK_ATTACK, DUCK_RELEASE, DUCK_SENS } from "./params.ts";

export class Ducks {
  private readonly atk: number;
  private readonly rel: number;
  private readonly env = new Float64Array(TRACKS);
  /** The track (0-based) each one ducks under, or -1, and how far. */
  private readonly from = new Int8Array(TRACKS).fill(-1);
  private readonly depth = new Float64Array(TRACKS);
  private gains: Float32Array[] = Array.from({ length: TRACKS }, () => new Float32Array(128));
  private level = new Float32Array(128);

  constructor(sampleRate: number) {
    this.atk = Math.exp(-1 / (DUCK_ATTACK * sampleRate));
    this.rel = Math.exp(-1 / (DUCK_RELEASE * sampleRate));
  }

  /** What each track ducks under, from its params as they play now; true when the tracks to tap changed. */
  set(param: (t: number, i: number) => number): boolean {
    let moved = false;
    for (let t = 0; t < TRACKS; t++) {
      const was = this.from[t], d = param(t, P.DUCK) || 0;
      const f = (param(t, P.DUCK_FROM) | 0) - 1;
      const from = f >= 0 && f < TRACKS && f !== t && d > 0 ? f : -1;
      if (from !== was) { moved = true; if (was >= 0 && !this.source(was)) this.env[was] = 0; }
      this.from[t] = from;
      this.depth[t] = d;
    }
    return moved;
  }

  get any() { return this.from.some((f) => f >= 0); }
  /** A track something ducks under: the engine taps a copy of it. */
  source(t: number) { return this.from.includes(t); }

  /** This block's duck for each ducked track, from the engine's taps (`taps[f * TRACKS + t]`). */
  run(taps: Float32Array, frames: number) {
    if (this.level.length < frames) { this.level = new Float32Array(frames); this.gains = this.gains.map(() => new Float32Array(frames)); }
    for (let s = 0; s < TRACKS; s++) {
      if (!this.source(s)) continue;
      let e = this.env[s];
      for (let f = 0; f < frames; f++) {
        const lvl = Math.abs(taps[f * TRACKS + s]) * Math.SQRT1_2;
        e = lvl + (e - lvl) * (lvl > e ? this.atk : this.rel);
        this.level[f] = Math.min(e * DUCK_SENS, 1);
      }
      this.env[s] = e;
      for (let t = 0; t < TRACKS; t++) {
        if (this.from[t] !== s) continue;
        const g = this.gains[t], d = this.depth[t];
        for (let f = 0; f < frames; f++) g[f] = 1 - d * this.level[f];
      }
    }
  }

  /** Track `t`'s gain a frame this block (after `run`), or undefined when it ducks under nothing. */
  gain(t: number): Float32Array | undefined { return t >= 0 && t < TRACKS && this.from[t] >= 0 ? this.gains[t] : undefined; }

  reset() { this.env.fill(0); }
}
