// Speakers that hang: where each box of a line array sits once its splays are set, what a splay calculator would set
// them to for a room. Angles in radians, pitch positive up (as `Source.pitch`), yaw as
// `Source.yaw` (0 faces +z).
import type { Vec3 } from "./sound.ts";

/** One box of a hang: its centre and the way its face points down. */
export type BoxPose = { centre: Vec3; pitch: number };

/** The heaviest angle a pin sets between two boxes, degrees; pins step a whole degree at a time. */
export const MAX_SPLAY_DEG = 10;

/**
 * A column of `n` boxes `boxH` tall under a frame at `top`: the top box faces `tilt`, and each box below turns down by
 * its splay to the one above (`splays[k]` is the angle between box k and box k + 1). The column hinges at the fronts.
 */
export function arrayPoses(top: Vec3, yaw: number, tilt: number, splays: readonly number[], n: number, boxH: number): BoxPose[] {
  const out: BoxPose[] = [], fx = Math.sin(yaw), fz = Math.cos(yaw);
  let p = { ...top }, a = tilt;
  for (let k = 0; k < n; k++) {
    if (k > 0) a -= splays[k - 1] ?? 0;
    // The box's own down: straight down when it faces level, swinging back as it faces the floor.
    const down = { x: Math.sin(a) * fx, y: -Math.cos(a), z: Math.sin(a) * fz };
    out.push({ centre: { x: p.x + (down.x * boxH) / 2, y: p.y + (down.y * boxH) / 2, z: p.z + (down.z * boxH) / 2 }, pitch: a });
    p = { x: p.x + down.x * boxH, y: p.y + down.y * boxH, z: p.z + down.z * boxH };
  }
  return out;
}

/** Pitch from `from` to `to`: up positive. */
const pitchTo = (from: Vec3, to: Vec3) => Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const along = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s, z: a.z + (b.z - a.z) * s });

/**
 * The splay calculator: a hang of `n` boxes under `top` covering the audience from the back seat `far` to the front
 * seat `near` (ears, along a straight rake between them). The top box aims at the back; the boxes below aim at seats
 * nearer and nearer, spaced so each covers a like share of the distance in proportion (half the distance, twice the
 * angle), which is what keeps the back as loud as the front. Whole degrees, as the pins set them.
 */
export function splayCalc(top: Vec3, yaw: number, n: number, boxH: number, far: Vec3, near: Vec3): { tilt: number; splays: number[] } {
  const deg = (r: number) => Math.round((r * 180) / Math.PI);
  let tilt = 0, splays: number[] = Array(Math.max(0, n - 1)).fill(0);
  // Two passes: aim from the frame, then again from where the boxes ended up.
  for (let pass = 0; pass < 2; pass++) {
    const poses = arrayPoses(top, yaw, (tilt * Math.PI) / 180, splays.map((s) => (s * Math.PI) / 180), n, boxH);
    const aims = poses.map((b, k) => {
      const dFar = dist(b.centre, far), dNear = dist(b.centre, near);
      const want = n === 1 ? dFar : dFar * (dNear / dFar) ** (k / (n - 1));
      // The seat on the rake that far away (the distance falls from far to near), by halving.
      let lo = 0, hi = 1;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (dist(b.centre, along(far, near, mid)) > want) lo = mid; else hi = mid; }
      return pitchTo(b.centre, along(far, near, (lo + hi) / 2));
    });
    tilt = deg(aims[0] ?? 0);
    let at = tilt;
    splays = aims.slice(1).map((a) => {
      const s = Math.max(0, Math.min(MAX_SPLAY_DEG, at - deg(a)));
      at -= s;
      return s;
    });
  }
  return { tilt, splays };
}

