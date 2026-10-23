// A park laid out from a survey of its ground (scripts/survey.ts prints the plan): a street line down a flat
// bench, a sky rail down another, a bowl on level ground, a kicker on the lip of a drop with its landing named,
// and a spawn on level ground facing the signature spot. The plainer parks are just this plan; the others add
// sites of their own (`extra`) or replace parts of the layout.
import type { Spawn } from "../level.ts";
import { type ParkSpec, type Site } from "./park.ts";
import { parkRow } from "./parks.ts";
import { bowl, flatBar, funbox, hip, kicker, quarterPipe, skyRail, stairSet, type At } from "./pieces.ts";

export type Plan = {
  /** A flat run of 150 m or more: the street line starts here and heads along `yaw` (radians, 0 is +z, 1.571 is +x). */
  street: Required<At>;
  /** Another flat run for the sky rail, clear of the street. */
  sky: Required<At>;
  /** Centre of a level disc 44 m across. */
  bowl: { x: number; z: number };
  /** A launch on the lip of a drop, where the run-in starts and where the flight lands. */
  gap: { at: Required<At>; run: { x: number; z: number }; land: { x: number; z: number }; rb: number; min: number };
  /** Level ground to spawn on, a good way from the spot but facing it. */
  view: { x: number; z: number };
};

const ahead = (s: Required<At>, d: number, side = 0): Required<At> => ({ x: s.x + Math.sin(s.yaw) * d + Math.cos(s.yaw) * side, z: s.z + Math.cos(s.yaw) * d - Math.sin(s.yaw) * side, yaw: s.yaw });

/** Metres from the signature spot inside which a park's own kit counts as "at the spot", so it needs no plaza of its own. */
const SPOT_CLEAR = 60;
/** The plan's kit by sample point: the street line, the bowl, the gap's run, flight and landing, the sky rail. */
const planPoints = (p: Plan) => {
  const along = (a: { x: number; z: number }, b: { x: number; z: number }) => Array.from({ length: 9 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / 8, z: a.z + ((b.z - a.z) * i) / 8 }));
  return [...Array.from({ length: 9 }, (_, i) => ahead(p.street, i * 19)), p.bowl, ...along(p.gap.run, p.gap.land), ...Array.from({ length: 9 }, (_, i) => ahead(p.sky, 70 + i * 12.5 - 50))];
};

export function streetPark(id: string, plan: Plan, o: { gap: string; spot?: boolean; spawns?: Spawn[]; extra?: Site[]; sites?: Site[]; goals?: ParkSpec["goals"]; blurb?: string } & Partial<ParkSpec>): ParkSpec {
  const row = parkRow(id), { street: S, sky, gap } = plan;
  const { gap: gapName, spot, spawns, extra = [], sites, goals, blurb, ...rest } = o;
  const facing = Math.atan2(-plan.view.x, -plan.view.z);
  // the signature spot gets a small plaza on a levelled shelf, unless the survey already put kit within reach of it
  const at: Required<At> = { x: 0, z: 0, yaw: facing }, plaza = spot ?? planPoints(plan).every((q) => Math.hypot(q.x, q.z) > SPOT_CLEAR);
  return {
    id, name: row.name, blurb: blurb ?? row.blurb, zone: id, weather: row.weather, biome: row.biome, ...(row.relief ? { relief: row.relief } : {}), fill: { lines: 8 },
    sites: sites ?? [
      { parts: [flatBar(ahead(S, 30), { len: 14 }), stairSet(ahead(S, 55), { w: 8, steps: 6, rise: 0.25, run: 0.9 })] },
      { parts: [funbox(ahead(S, 85), { w: 10, d: 24, h: 1.2, ramp: 7 }), hip(ahead(S, 112), { w: 12, d: 12, h: 2.4 })] },
      { parts: [quarterPipe(ahead(S, 138), { w: 14, d: 7, h: 3.6 })] },
      { parts: [bowl({ x: plan.bowl.x, z: plan.bowl.z, yaw: S.yaw }, { w: 34, d: 24, h: 2.6, deck: 3, name: `${row.name} bowl` })] },
      { parts: [kicker(gap.at, { w: 12, d: 16, h: 3.5, curve: 1.5, name: gapName })] },
      // not possible: a bar on stilts that climbs away from the ground
      { parts: [skyRail(ahead(sky, 70), { len: 100, y: 1.6, y2: 21.6 })] },
      ...(plaza ? [{ pad: { x: 0, z: 0, r: 26 }, parts: [flatBar(ahead(at, -14), { len: 12 }), stairSet(ahead(at, 4), { w: 8, steps: 6, rise: 0.25, run: 0.9 }), quarterPipe(ahead(at, 20), { w: 14, d: 7, h: 3.6 })] }] : []),
      ...extra,
    ],
    gaps: [{ name: gapName, a: { x: gap.at.x, z: gap.at.z }, b: gap.land, r: 16, rb: gap.rb, bonus: 3500, min: gap.min }],
    spawns: spawns ?? [
      { name: "street line", ...ahead(S, 0) },
      { name: "view", x: plan.view.x, z: plan.view.z, yaw: facing },
      { name: `${gapName} run`, x: gap.run.x, z: gap.run.z, yaw: gap.at.yaw },
      { name: "sky rail", ...ahead(sky, 0) },
    ],
    goals: goals ?? [{ kind: "score", target: 3000 }, { kind: "combo", target: 1200 }, { kind: "gap", name: gapName }, { kind: "collect", count: 5 }],
    pickups: [20, 45, 70, 95, 120].map((d) => ({ ...ahead(S, d), lift: 1.4 })),
    ...rest,
  };
}
