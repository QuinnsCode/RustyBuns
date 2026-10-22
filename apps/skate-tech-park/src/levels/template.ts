// A park laid out from a survey of its ground (scripts/survey.ts prints the plan): a street line down a flat
// bench, a sky rail down another, a bowl on level ground, a kicker on the lip of a drop with its landing named,
// and a spawn on level ground facing the signature spot. The plainer parks are just this plan; the others add
// sites of their own (`extra`) or replace parts of the layout.
import type { Spawn } from "../level.ts";
import { type ParkSpec, type PeakModel, type Site, TERRAIN_SCALE } from "./park.ts";
import { parkRow } from "./parks.ts";
import { bowl, flatBar, funbox, gap as kitGap, hip, kicker, quarterPipe, skyRail, stairSet, type At } from "./pieces.ts";

export type Plan = {
  /** A flat run of 150 m or more: the street line starts here and heads along `yaw` (radians, 0 is +z, 1.571 is +x). */
  street: Required<At>;
  /** Another flat run for the sky rail, clear of the street. */
  sky: Required<At>;
  /** Centre of a level disc 44 m across. */
  bowl: { x: number; z: number };
  /** A launch on the lip of a drop, where the run-in starts and where the flight lands; or, on ground with no drop, `built`: a flat run (70 m or more) to lay a kit gap on. */
  gap: { at: Required<At>; run: { x: number; z: number }; land: { x: number; z: number }; rb: number; min: number } | { built: Required<At> };
  /** Level ground to spawn on, a good way from the spot but facing it. */
  view: { x: number; z: number };
};

const ahead = (s: Required<At>, d: number, side = 0): Required<At> => ({ x: s.x + Math.sin(s.yaw) * d + Math.cos(s.yaw) * side, z: s.z + Math.cos(s.yaw) * d - Math.sin(s.yaw) * side, yaw: s.yaw });

/**
 * A far landmark (a model from blender/landmark.py) straight ahead of the view spawn, past the park's edge, its long
 * side (the model's +x) toward the park so its toe meets the edge the way half-dome.ts has it. `y` is the ground at that edge.
 */
export const farPeak = (view: { x: number; z: number }, o: { model: PeakModel; tall: number; y: number }) => {
  const len = Math.hypot(view.x, view.z), ox = -view.x / len, oz = -view.z / len, D = 1000 / TERRAIN_SCALE + 1.5 * o.tall + 4;
  return { kind: "peak" as const, model: o.model, x: Math.round(ox * D), y: o.y, z: Math.round(oz * D), tall: o.tall, yaw: Math.round(Math.atan2(oz, -ox) * 1000) / 1000 };
};

export function streetPark(id: string, plan: Plan, o: { gap: string; peak?: { model: PeakModel; tall: number; y: number }; spawns?: Spawn[]; extra?: Site[]; sites?: Site[]; goals?: ParkSpec["goals"]; blurb?: string } & Partial<ParkSpec>): ParkSpec {
  const row = parkRow(id), { street: S, sky } = plan;
  const { gap: gapName, spawns, extra = [], sites, goals, blurb, peak, ...rest } = o;
  // a drop in the ground (a kicker on its lip, the gap's flight and landing as data), or, where the ground is level, a kit gap with its landing on a flat pad
  const natural = "built" in plan.gap ? undefined : plan.gap, built = "built" in plan.gap ? plan.gap.built : undefined;
  const made = built && kitGap(ahead(built, 60), { name: gapName, span: 30, h: 2.4, w: 8, landH: 2, landLen: 14, reach: 75, bonus: 3500 });
  const launch: Site[] = made ? [{ parts: [made.launch, made.landing], pad: { ...ahead(built!, 83), r: 52 } }] : [{ parts: [kicker(natural!.at, { w: 12, d: 16, h: 3.5, curve: 1.5, name: gapName })] }];
  const run = natural?.run ?? ahead(built!, 0), runYaw = natural?.at.yaw ?? built!.yaw;
  const facing = Math.atan2(-plan.view.x, -plan.view.z);
  return {
    id, name: row.name, blurb: blurb ?? row.blurb, zone: id, weather: row.weather, biome: row.biome, ...(row.relief ? { relief: row.relief } : {}), fill: { lines: 8 },
    sites: sites ?? [
      { parts: [flatBar(ahead(S, 30), { len: 14 }), stairSet(ahead(S, 55), { w: 8, steps: 6, rise: 0.25, run: 0.9 })] },
      { parts: [funbox(ahead(S, 85), { w: 10, d: 24, h: 1.2, ramp: 7 }), hip(ahead(S, 112), { w: 12, d: 12, h: 2.4 })] },
      { parts: [quarterPipe(ahead(S, 138), { w: 14, d: 7, h: 3.6 })] },
      { parts: [bowl({ x: plan.bowl.x, z: plan.bowl.z, yaw: S.yaw }, { w: 34, d: 24, h: 2.6, deck: 3, name: `${row.name} bowl` })] },
      ...launch,
      // not possible: a bar on stilts that climbs away from the ground
      { parts: [skyRail(ahead(sky, 70), { len: 100, y: 1.6, y2: 21.6 })] },
      ...extra,
    ],
    gaps: natural ? [{ name: gapName, a: { x: natural.at.x, z: natural.at.z }, b: natural.land, r: 16, rb: natural.rb, bonus: 3500, min: natural.min }] : [],
    spawns: spawns ?? [
      { name: "street line", ...ahead(S, 0) },
      { name: "view", x: plan.view.x, z: plan.view.z, yaw: facing },
      { name: `${gapName} run`, x: run.x, z: run.z, yaw: runYaw },
      { name: "sky rail", ...ahead(sky, 0) },
    ],
    goals: goals ?? [{ kind: "score", target: 3000 }, { kind: "combo", target: 1200 }, { kind: "gap", name: gapName }, { kind: "collect", count: 5 }],
    ...(peak ? { landmarks: [farPeak(plan.view, peak)] } : {}),
    pickups: [20, 45, 70, 95, 120].map((d) => ({ ...ahead(S, d), lift: 1.4 })),
    ...rest,
  };
}
