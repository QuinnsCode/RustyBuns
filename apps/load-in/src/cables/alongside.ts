// Where a mains cord lies along a signal cable. Mains pushes a 60 Hz field into any line low enough to hear it (a mic,
// an instrument lead, the snake's pairs) when the two run side by side; crossing at a right angle couples almost
// nothing. So a crew runs power and signal apart, and crosses them square where they must meet. Speaker lines are high
// level and shrug it off. Plain numbers on the rope points (rope.ts), no three.js.
import type { CableKind } from "@rustybuns/gear";
import type { Vec } from "./rope.ts";

/** Within this far of a mains cord (metres, on the floor), heading the same way within ANGLE, for STRETCH_M or more: it hums. */
export const NEAR_M = 0.3;
export const STRETCH_M = 0.5;
const ANGLE = Math.PI / 6;

/** The cables low level enough to pick up the hum. */
export const SIGNAL: ReadonlySet<CableKind> = new Set(["xlr", "instrument", "multi"]);

type P = { x: number; z: number };
function nearest(p: P, a: P, b: P): { d: number; dx: number; dz: number } {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 0;
  return { d: Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)), dx, dz };
}

/**
 * The longest stretch of `signal` (metres) that lies along `power`: each step of it within NEAR_M of the cord and
 * pointing its way (either direction) within 30 degrees. A cord that only crosses it gives a step or two at most.
 */
export function alongside(signal: readonly Vec[], power: readonly Vec[]): number {
  const cos = Math.cos(ANGLE);
  let best = 0, run = 0;
  for (let i = 1; i < signal.length; i++) {
    const a = signal[i - 1]!, b = signal[i]!, sx = b.x - a.x, sz = b.z - a.z, len = Math.hypot(sx, sz);
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    let along = false;
    for (let j = 1; j < power.length && len > 0 && !along; j++) {
      const n = nearest(mid, power[j - 1]!, power[j]!), pl = Math.hypot(n.dx, n.dz);
      along = n.d <= NEAR_M && pl > 0 && Math.abs(sx * n.dx + sz * n.dz) / (len * pl) >= cos;
    }
    run = along ? run + len : 0;
    best = Math.max(best, run);
  }
  return best;
}

/** A cable with its key and, once it is out of the case, the points its rope lies on. */
export type Laid = { key: string; kind: CableKind; path?: readonly Vec[] };

/** Each signal cable that lies along a mains cord for STRETCH_M or more: which cord, and for how long (metres, one decimal). */
export function humming(runs: readonly Laid[]): Map<string, { power: string; m: number }> {
  const out = new Map<string, { power: string; m: number }>();
  const cords = runs.flatMap((r) => (r.kind === "power" && r.path?.length ? [{ key: r.key, path: r.path }] : []));
  for (const s of runs) {
    if (!SIGNAL.has(s.kind) || !s.path?.length) continue;
    for (const c of cords) {
      const m = alongside(s.path, c.path);
      if (m >= STRETCH_M && m > (out.get(s.key)?.m ?? 0)) out.set(s.key, { power: c.key, m: Math.round(m * 10) / 10 });
    }
  }
  return out;
}
