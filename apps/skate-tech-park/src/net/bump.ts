// Running into another rider's board. Each page runs its own half: when your board overlaps a ghost it is
// pushed out and its speed along the line between them is reversed with a little give; the other rider's
// page does the same from its side, so together they bounce. A room in PvE mode never calls this.
import type { Rider } from "./room.ts";

/** Each board counts as a disc this wide (a deck is 4.4 m long and 1.25 m wide). */
export const BOARD_R = 1.5;
const SAME_HEIGHT = 1.2;

type Body = { x: number; y: number; z: number; vx: number; vz: number; yaw: number; speed: number; air: boolean; grind: number };

/** True if it hit something. */
export function bump(s: Body, others: Pick<Rider, "pose">[]): boolean {
  let hit = false;
  for (const o of others) {
    const n = o.pose?.n;
    if (!n || Math.abs(n[1]! - s.y) > SAME_HEIGHT) continue;
    let dx = s.x - n[0]!, dz = s.z - n[2]!;
    const d = Math.hypot(dx, dz);
    if (d >= BOARD_R * 2) continue;
    if (d < 1e-3) { dx = Math.sin(s.yaw); dz = Math.cos(s.yaw); } else { dx /= d; dz /= d; }
    const push = (BOARD_R * 2 - d) / 2;
    s.x += dx * push; s.z += dz * push;
    const vn = s.vx * dx + s.vz * dz;
    const kick = vn < 0 ? -vn * 1.4 : 0;           // approaching: bounce off with some give
    s.vx += dx * (kick + 1); s.vz += dz * (kick + 1); // and always a small shove, so a parked board gets moved
    if (!s.air && s.grind < 0) s.speed = s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);
    hit = true;
  }
  return hit;
}
