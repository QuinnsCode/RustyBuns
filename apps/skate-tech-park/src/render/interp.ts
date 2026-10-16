// The sim steps at a fixed 60 Hz but the screen draws whenever it likes (120 and 144 Hz displays, uneven
// frames), so drawing the last step as it stands makes the board and camera stutter. Draw the pose a
// fraction of the way from the previous step to the latest instead.
import type { State } from "../sim.ts";

export type Pose = Pick<State, "x" | "y" | "z" | "yaw">;

/** A move this long in one step is a reset or a shove, not motion: never smear it across frames. */
const JUMP = 3;

export const poseOf = (s: Pose): Pose => ({ x: s.x, y: s.y, z: s.z, yaw: s.yaw });

/** The pose `a` (0..1) of the way from `from` to `to`, turning the short way round. */
export function between(from: Pose, to: Pose, a: number): Pose {
  if (Math.hypot(to.x - from.x, to.z - from.z, to.y - from.y) > JUMP) return poseOf(to);
  const turn = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
  return { x: from.x + (to.x - from.x) * a, y: from.y + (to.y - from.y) * a, z: from.z + (to.z - from.z) * a, yaw: from.yaw + turn * a };
}
