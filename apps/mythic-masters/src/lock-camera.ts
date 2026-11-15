// Where the lock camera (the one players fight in) stands: over your shoulder, never straight behind.
import type { V3 } from "./sim.ts";

/** The least swing off the line to them, to the fighter's right. */
const SWING = 0.5;
/** The most: past this the shot turns side-on and the controls stop feeling like "forward is at them". */
const MOST = 1.1;

/** How far apart (radians, seen from `cam` on the ground plane) the two bodies' edges are; below 0 they overlap. */
export function lockGap(cam: { x: number; z: number }, me: V3, them: V3, rMe: number, rThem: number) {
  const ax = me.x - cam.x, az = me.z - cam.z, bx = them.x - cam.x, bz = them.z - cam.z;
  const da = Math.hypot(ax, az) || 1e-6, db = Math.hypot(bx, bz) || 1e-6;
  const apart = Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (da * db))));
  return apart - Math.asin(Math.min(1, rMe / da)) - Math.asin(Math.min(1, rThem / db));
}

/** Swung off the line to them by the least angle that keeps your own body clear of theirs on screen, so the near
 * fighter never covers the target, rising when even the widest swing can't. Bodies are wider than their hurtbox (arms, tails, fur), so each radius is padded. */
export function lockCamera(me: V3, them: V3, back: number, lift: number, rMe: number, rThem: number) {
  const line = Math.atan2(them.z - me.z, them.x - me.x) + Math.PI;
  const at = (s: number) => ({ x: me.x + Math.cos(line + s) * back, z: me.z + Math.sin(line + s) * back });
  let s = SWING;
  while (s < MOST && lockGap(at(s), me, them, rMe * 1.2, rThem * 0.5) < 0) s += 0.05;
  const c = at(Math.min(s, MOST));
  // still overlapping at the widest swing (they stand toe to toe): rise to look down past your shoulder at them
  const short = Math.max(0, -lockGap(c, me, them, rMe * 1.2, rThem * 0.5));
  return { x: c.x, y: me.y + lift + short * back * 1.5, z: c.z };
}
