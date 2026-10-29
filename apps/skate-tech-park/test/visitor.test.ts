// The front door of a park (visitor.ts): the welcome center gap clears, the grand staircase climbs onto the roof,
// and the trail is a line the rider can chain from its trailhead.
import { expect, setDefaultTimeout, test } from "bun:test";
import { trackRun } from "../src/levels/goals.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { IDLE, start, step } from "../src/sim.ts";
import { level } from "./parks.ts";

setDefaultTimeout(60000);

const FRONT_DOORS = [["yosemite-falls", "Visitor Center Gap", "Falls Trail"], ["old-faithful", "Visitor Center Gap", "Geyser Trail"], ["mariposa-grove", "Welcome Center Gap", "Grove Trail"]] as const;

/** Rides from a spawn, steering at a point and holding a speed, popping when it is `jumpAlong` metres past the target if given. */
function ride(l: ParkLevel, spawn: string, to: { x: number; z: number }, o: { seconds: number; speed: number; jumpAlong?: [number, number] }) {
  const sp = l.spawns.find((p) => p.name === spawn)!, s = start(sp.x, sp.z, sp.yaw, l), run = trackRun(l), world = { ...l, obstacles: l.trees };
  let top = s.y;
  for (let i = 0; i < o.seconds * 60; i++) {
    const err = Math.atan2(Math.sin(Math.atan2(to.x - s.x, to.z - s.z) - s.yaw), Math.cos(Math.atan2(to.x - s.x, to.z - s.z) - s.yaw)), along = (s.x - to.x) * Math.sin(s.yaw) + (s.z - to.z) * Math.cos(s.yaw); // how far past the target, along the heading
    step(s, { ...IDLE, throttle: s.speed < o.speed ? 1 : -1, boost: !s.air && s.speed < o.speed, steer: s.air ? 0 : Math.max(-1, Math.min(1, err * 3)), jump: !!o.jumpAlong && !s.air && along > o.jumpAlong[0] && along < o.jumpAlong[1] }, world);
    run.update(s); top = Math.max(top, s.y);
  }
  if (process.env.DEBUG) console.log(spawn, o.speed, "top", top.toFixed(2), "targetH", l.height(to.x, to.z).toFixed(2), s.x.toFixed(1), s.z.toFixed(1), s.y.toFixed(1), s.speed.toFixed(1), [...run.gaps]);
  return { s, run, top };
}

for (const [id, gapName, trail] of FRONT_DOORS) {
  test(`${id}: the front door's gap clears over the welcome center and the staircase climbs onto its roof`, async () => {
    const l = (await level(id)) as ParkLevel, g = l.gaps.find((x) => x.name === gapName)!;
    for (const speed of [28, 32]) {
      const { run } = ride(l, `${gapName} run`, g.a, { seconds: 20, speed, jumpAlong: [3, 8] });
      expect(run.gaps.get(gapName)).toBeGreaterThanOrEqual(1);
    }
    const roof = l.pieces.find((p) => p.kind === "box" && p.look?.kind === "block" && p.w === 26)!;
    const { top } = ride(l, "staircase", roof, { seconds: 12, speed: 12 });
    expect(top).toBeGreaterThan(l.height(roof.x, roof.z) - 0.5); // got up onto it
    expect(l.goals.some((x) => x.kind === "line" && x.name === trail)).toBe(true);
  });
}

for (const [id, , trail] of FRONT_DOORS) {
  test(`${id}: the trail is ridden from its trailhead beat by beat, and skipping the middle does not finish it`, async () => {
    const l = (await level(id)) as ParkLevel, route = l.routes.find((r) => r.name === trail)!, goal = l.goals.find((g) => g.kind === "line" && g.name === trail)!;
    const go = (points: typeof route.points) => {
      const sp = l.spawns.find((p) => p.name === "trailhead")!, s = start(sp.x, sp.z, sp.yaw, l), run = trackRun(l), world = { ...l, obstacles: l.trees };
      for (const to of points) for (let i = 0; i < 20 * 60; i++) {
        const aim = Math.atan2(to.x - s.x, to.z - s.z), err = Math.atan2(Math.sin(aim - s.yaw), Math.cos(aim - s.yaw));
        step(s, { ...IDLE, throttle: s.speed < 12 ? 1 : 0, steer: Math.max(-1, Math.min(1, err * 3)), jump: !s.air && s.speed > 8 && Math.abs(Math.hypot(to.x - s.x, to.z - s.z) - (to.r + 2)) < 1.5 }, world);
        run.update(s);
        if (Math.hypot(to.x - s.x, to.z - s.z) < 3) break;
      }
      return run;
    };
    expect(route.points.length).toBe(4);
    expect(go(route.points).done(goal)).toBe(true);
    expect(go([route.points[0]!, route.points[3]!]).done(goal)).toBe(false);
  });
}
