// A web effect's return into the mix (#5551): each inserted track's sound, back from its Insert (src/ui/wam.ts), panned
// by the track's PAN, under the master, and that times its SEND into the Space bus. The track left the engine's sum
// at its tap (after its fader, mono), so the fader is already in it: the return only adds what the tap dropped.
// The audio thread mixes the page's returns here (src/engine/worklet.ts) and the bounce mixes the offline ones
// (src/engine/offline.ts), so both pan and send the same.
import type { Strip } from "./plugin-route.ts";

/** How fast the pan follows its slider, per sample (as a plugin track's strip), so a move doesn't click. */
const SMOOTH = 0.002;

/** The pan law of a plugin track's strip (src/engine/plugin-route.ts): at centre both sides come as they are. */
export function panGains(pan: number): [number, number] {
  const angle = ((Math.max(-1, Math.min(1, pan || 0)) + 1) * Math.PI) / 4;
  return [Math.SQRT2 * Math.cos(angle), Math.SQRT2 * Math.sin(angle)];
}

export class InsertReturns {
  private pans = new Map<number, [number, number]>();

  /**
   * Adds track `t`'s return into `out` (interleaved stereo), `frames` long: `l` and `r` its two sides (one for a mono
   * effect), from `from`. `strip.gain` is the master here (the fader is in the tap); `send`, the Space bus, when given.
   */
  mix(t: number, l: Float32Array, r: Float32Array, from: number, out: Float32Array, frames: number, strip: Pick<Strip, "gain" | "pan" | "send" | "duck">, send?: Float32Array) {
    const [tl, tr] = panGains(strip.pan(t)), g0 = strip.gain(t), sa = strip.send(t), duck = strip.duck?.(t);
    let p = this.pans.get(t);
    if (!p) this.pans.set(t, (p = [tl, tr]));
    for (let f = 0; f < frames; f++) {
      p[0] += (tl - p[0]) * SMOOTH;
      p[1] += (tr - p[1]) * SMOOTH;
      const g = duck ? g0 * duck[f] : g0;
      const a = (l[from + f] ?? 0) * p[0] * g, c = (r[from + f] ?? 0) * p[1] * g;
      out[2 * f] += a;
      out[2 * f + 1] += c;
      if (send) { send[2 * f] += a * sa; send[2 * f + 1] += c * sa; }
    }
  }

  /** A track's Insert came off: its pan starts where the slider sits next time. */
  drop(t: number) { this.pans.delete(t); }
}

/** Interleaved stereo as its two sides. */
export function sides(pcm: Float32Array): [Float32Array, Float32Array] {
  const n = pcm.length >> 1, l = new Float32Array(n), r = new Float32Array(n);
  for (let f = 0; f < n; f++) { l[f] = pcm[2 * f]; r[f] = pcm[2 * f + 1]; }
  return [l, r];
}
