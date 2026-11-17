// Walking a room on foot, pure: a body on the floor pushed out of the walls and whatever stands in the way.
// Q Studio's gear room (../room/room.ts) and the jam room (./jam.ts) both walk with it (from PR #4985).
import { clamp } from "@rustybuns/util";

/** A box on the floor seen from above: its middle, half its width and depth, and how far it is turned. */
export type Rect = { cx: number; cz: number; hw: number; hd: number; turn: number };

/** Push a body of `radius` at `p` out of every rect, then keep it inside a room `halfW` by `halfD` from the middle. */
export function pushOut(p: { x: number; z: number }, solids: readonly Rect[], halfW: number, halfD: number, radius: number) {
  for (const s of solids) {
    const c = Math.cos(s.turn), sn = Math.sin(s.turn), dx = p.x - s.cx, dz = p.z - s.cz;
    const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
    const px = clamp(lx, -s.hw, s.hw), pz = clamp(lz, -s.hd, s.hd);
    let ox = lx - px, oz = lz - pz;
    const dist = Math.hypot(ox, oz);
    if (dist >= radius) continue;
    if (dist < 1e-6) { // inside: out the nearest side
      const ex = s.hw - Math.abs(lx), ez = s.hd - Math.abs(lz);
      [ox, oz] = ex < ez ? [Math.sign(lx) || 1, 0] : [0, Math.sign(lz) || 1];
    } else { ox /= dist; oz /= dist; }
    const lx2 = px + ox * radius, lz2 = pz + oz * radius;
    p.x = s.cx + lx2 * c + lz2 * sn;
    p.z = s.cz - lx2 * sn + lz2 * c;
  }
  p.x = clamp(p.x, -halfW + radius, halfW - radius);
  p.z = clamp(p.z, -halfD + radius, halfD - radius);
}
