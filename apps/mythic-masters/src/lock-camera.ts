// Where the lock camera (the one players fight in) stands: over your shoulder, never straight behind.
import type { V3 } from "./sim.ts";

type Body = { radius: number; height: number };

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

/** How fast the side camera may turn round the two (rad/s): `close` when they stand within `near` m of each other (centre
 * to centre), up to `far` by `apart` m. Close skirmisher exchanges whip the line between them through half a turn in a few
 * tenths (p99 3 to 9 rad/s in bot fights, #6042 round 13) and the camera swung with it, cutting one body off the frame. */
export const SIDE_TURN = { close: 1.2, far: 4, near: 3.5, apart: 8, lag: 0.5 } as const;

/** The side camera's line (radians, from you to them) a frame of `dt` s later: `want` turned toward, no faster than SIDE_TURN allows at `d` m apart. */
export function sideTurn(line: number, want: number, d: number, dt: number) {
  const k = Math.max(0, Math.min(1, (d - SIDE_TURN.near) / (SIDE_TURN.apart - SIDE_TURN.near)));
  const most = (SIDE_TURN.close + (SIDE_TURN.far - SIDE_TURN.close) * k) * dt, gap = Math.atan2(Math.sin(want - line), Math.cos(want - line));
  // never more than `lag` behind: further, and the camera looks along the line and the near body hides the other
  return want - Math.max(-SIDE_TURN.lag, Math.min(SIDE_TURN.lag, gap - Math.max(-most, Math.min(most, gap))));
}

/** Swung off the line to them by the least angle that keeps your own body clear of theirs on screen, so the near
 * fighter never covers the target, rising when even the widest swing can't. Bodies are wider than their hurtbox (arms, tails, fur), so each radius is padded. */
export function lockCamera(me: V3, them: V3, mine: Body, theirs: Body) {
  const rMe = mine.radius, rThem = theirs.radius, tall = Math.max(mine.height, theirs.height);
  const d = Math.hypot(them.x - me.x, them.z - me.z), over = Math.max(0, them.y - me.y);
  // Close over your shoulder, sized to the bodies and the gap: the fighters fill the frame, not the grass. Pulls back as
  // they part (or a flyer climbs) so the other never leaves the view.
  const back = 1.4 + rMe * 1.2 + tall * 0.55 + d * 0.4 + over * 0.3, lift = 0.5 + tall * 0.42 + over * 0.5;
  const line = Math.atan2(them.z - me.z, them.x - me.x) + Math.PI;
  const at = (s: number) => ({ x: me.x + Math.cos(line + s) * back, z: me.z + Math.sin(line + s) * back });
  let s = SWING;
  while (s < MOST && lockGap(at(s), me, them, rMe * 1.2, rThem * 0.5) < 0) s += 0.05;
  const c = at(Math.min(s, MOST));
  // still overlapping at the widest swing (they stand toe to toe): rise to look down past your shoulder at them
  const short = Math.max(0, -lockGap(c, me, them, rMe * 1.2, rThem * 0.5));
  return { x: c.x, y: me.y + lift + short * back * 1.5, z: c.z };
}
