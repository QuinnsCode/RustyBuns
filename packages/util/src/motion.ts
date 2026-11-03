// Motion for scenes and HUDs: things that slide in, hold, and slide out on a clock. Pure functions of time,
// so a game's director, its tests and a screenshot all see the same frame; the page turns the numbers into
// transforms (translate, scale, opacity), which every browser draws on the GPU without a repaint.
import { clamp } from "./index.ts";

/** Eased 0..1 for `u` in 0..1 (clamped): slow out, slow in. */
export const smoothstep = (u: number) => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

/** Eased 0..1 for `u` in 0..1 (clamped): fast out, a soft stop. The one for things sliding into place. */
export const easeOut = (u: number) => 1 - (1 - clamp(u, 0, 1)) ** 3;

/** Eased 0..1 between seconds `from` and `to` of a clock `t`: 0 before, 1 after. */
export const span = (t: number, from: number, to: number, ease = smoothstep) => ease((t - from) / (to - from || 1));

/**
 * How far in something is at second `t` of a scene: in over [inAt, inAt + inFor], held, out over
 * [outAt, outAt + outFor]. 0 is off stage, 1 is in place. With no outAt it stays.
 */
export function inOut(t: number, o: { inAt?: number; inFor?: number; outAt?: number; outFor?: number }): number {
  const { inAt = 0, inFor = 0.4, outAt = Infinity, outFor = 0.4 } = o;
  return Math.min(span(t, inAt, inAt + inFor, easeOut), 1 - span(t, outAt, outAt + outFor));
}

/** `v` stepped toward `want` at `rate` per second: a value that follows another without jumping. */
export const follow = (v: number, want: number, rate: number, dt: number) => v + clamp(want - v, -rate * dt, rate * dt);
