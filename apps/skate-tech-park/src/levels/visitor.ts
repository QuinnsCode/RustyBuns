// A national park's front door, built from the kit: a car park to run in from, a welcome center to gap over or climb
// onto by its grand staircase, benches and a picnic table on the plaza, and a trailhead whose trail is a line of
// benches, boardwalk, manual pads and stairs leading off into the park. Everything is laid out in one local frame
// (local +z is the heading) so the whole area can be turned to fit whatever flat ground a park has.
import type { Spawn } from "../level.ts";
import { type Goal, type Site } from "./park.ts";
import { line } from "./lines.ts";
import { piece, type Look } from "../level.ts";
import { type At, bar, box, downLedge, gap, join, parkBench, part, type Part, picnicTable, stairSet, toWorld, K, L } from "./pieces.ts";

const E = Math.PI / 2;
const BLOCK: Look = { kind: "block" };

/** A building to gap over or ride across: a flat roof with a ledge along both long edges to grind. */
export const lodge = (at: At, o: { w?: number; d?: number; h?: number; name?: string } = {}): Part => {
  const { name = "welcome center", w = 26, d = 16, h = 3.24 } = o;
  return part({
    pieces: [{ ...piece("box", name, at.x, at.z, at.yaw ?? 0, w, d, h, h), look: BLOCK }],
    rails: [-d / 2, d / 2].map((lz) => bar("ledge", at, -w / 2, lz, w / 2, lz, h)),
  });
};

export const ROOF = 3.24;

/** What `visitorArea` hands a park: its sites, the spawns that reach them and the goals that name them. */
export type Visitor = { sites: Site[]; spawns: Spawn[]; goals: Goal[]; gap: string; trail: string };

/**
 * Lays the front door of a park at `at` (the middle of the car park's far end: the area runs 150 m ahead of it).
 * - local z -40: a kicker, 28 m of air, and a landing, with the welcome center standing in the void.
 * - to the west: the grand staircase up onto the roof, a ledge falling away down either side.
 * - on the plaza: two benches and a picnic table, on a flat shelf cut for it.
 * - to the east: the trailhead (a map to grind) and the trail, a line leading away north.
 */
export function visitorArea(at: Required<At>, o: { center: string; gap: string; trail: string }): Visitor {
  const w = (lx: number, lz: number, yaw = 0) => ({ ...toWorld(at, lx, lz), yaw: at.yaw + yaw });
  const launch = gap(w(0, -40), { name: o.gap, span: 28, h: 2.4, w: 8, landH: 1.4, landLen: 8, reach: 30, bonus: 1500 });
  const centre = w(0, -24);
  // 9 kit units of stairs are 18 treads of 0.18 m: exactly the roof's height, so the top tread meets the roof
  const stairs = stairSet(w(-19.9, -24, E), { w: 5, steps: 9, name: `${o.center} staircase` });
  const rails = [-6, 6].map((dz) => downLedge(w(-19.9, -24 - dz, -E), { len: 13.8 / L, w: 0.8, h: ROOF / K, h2: 0.1, name: "staircase ledge" }));
  const plaza = join(
    launch.launch, launch.landing, lodge(centre, { name: o.center }), stairs, ...rails,
    parkBench(w(-17, -2), { name: "plaza bench" }), parkBench(w(17, -2), { name: "plaza bench" }),
    picnicTable(w(24, -30, E), { name: "plaza table" }),
  );
  const trailStart = w(54, -66);
  const trailhead = join(box(w(61, -72), { w: 2.5, d: 1.8, h: 0.5, name: "trail map" }), parkBench(w(46, -76), { name: "trailhead bench" }), parkBench(w(68, -76), { name: "trailhead bench" }));
  const trail = line(trailStart, ["boardwalk", "bench", "manualPad", "stairs"], { name: o.trail });
  return {
    sites: [{ pad: { ...toWorld(at, 0, -24), r: 40 }, parts: [plaza] }, { parts: [trailhead, trail] }],
    spawns: [
      { name: `${o.gap} run`, ...toWorld(at, 0, -140), yaw: at.yaw },
      { name: "trailhead", ...toWorld(at, 54, -90), yaw: at.yaw },
      { name: "staircase", ...toWorld(at, -60, -24), yaw: at.yaw + E },
    ],
    goals: [{ kind: "gap", name: o.gap }, { kind: "line", name: o.trail }],
    gap: o.gap, trail: o.trail,
  };
}
