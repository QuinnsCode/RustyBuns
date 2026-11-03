// The sim steps at a fixed 60 Hz but the screen draws whenever it likes (120 and 144 Hz displays, uneven
// frames), so drawing the last step as it stands makes the board and camera stutter. Draw the pose a
// fraction of the way from the previous step to the latest instead.
import { shownYaw, type State } from "../sim.ts";

export type Pose = Pick<State, "x" | "y" | "z" | "yaw">;

/** A move this long in one step is a reset or a shove, not motion: never smear it across frames. */
const JUMP = 3;

/** A pose to draw; a sim state mid-revert shows its board part way round. */
export const poseOf = (s: Pose & Partial<Pick<State, "revert" | "revertDir">>): Pose =>
  ({ x: s.x, y: s.y, z: s.z, yaw: s.revert !== undefined && s.revertDir !== undefined ? shownYaw({ yaw: s.yaw, revert: s.revert, revertDir: s.revertDir }) : s.yaw });

/** The pose `a` (0..1) of the way from `from` to `to`, turning the short way round. */
export function between(from: Pose, state: Pose & Partial<Pick<State, "revert" | "revertDir">>, a: number): Pose {
  const to = poseOf(state);
  if (Math.hypot(to.x - from.x, to.z - from.z, to.y - from.y) > JUMP) return to;
  const turn = Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
  return { x: from.x + (to.x - from.x) * a, y: from.y + (to.y - from.y) * a, z: from.z + (to.z - from.z) * a, yaw: from.yaw + turn * a };
}
