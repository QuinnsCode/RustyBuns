// Journeys over single park levels. The per-park loops (every park loads, every gap clears, every sky rail rides)
// are in test/lines.ts, ridden a part at a time by test/levels-<n>.test.ts.
import { expect, setDefaultTimeout, test } from "bun:test";
import { LEVELS, needsStartScreen, pick } from "../src/levels/index.ts";
import { trackRun } from "../src/levels/goals.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { IDLE, start, step } from "../src/sim.ts";
import { drive } from "./lines.ts";
import { build, level } from "./parks.ts";

setDefaultTimeout(60000);
const ids = ["el-capitan", "mariposa-grove", "half-dome", "old-faithful", "glacier-point"];
const parks = (await Promise.all(ids.map((id) => level(id)))) as ParkLevel[];
const park = (id: string) => parks.find((l) => l.id === id)!;

test("El Capitan's talus is a quarter pipe: driving at the wall climbs it", () => {
  const l = park("el-capitan"), { s, run } = drive(l, "wall view", 16); // across the meadow, three times as wide as it was
  const goal = l.goals.find((g) => g.kind === "climb")!;
  expect(run.done(goal)).toBe(true);
  const sp = l.spawns.find((p) => p.name === "wall view")!;
  expect(s.y).toBeGreaterThan(l.height(sp.x, sp.z) + 20);
});

test("kit parts lie on the ground: a rail on the grove's hillside slopes with it, and pickups ride the line", () => {
  const l = park("mariposa-grove");
  const bar = l.rails.find((r) => r.kind === "rail")!;
  expect(Math.abs((bar.y2 ?? bar.y) - bar.y)).toBeGreaterThan(1);
  const { run } = drive(l, "grove road", 8, undefined, 27, l.pickups[0]); // steer at the first ring, as a player would
  expect(run.collected.size).toBeGreaterThan(0);
});

test("the start screen shows until a level is chosen, and a query picks its level", () => {
  expect(needsStartScreen("")).toBe(false); // a bare address opens the title screen first
  expect(needsStartScreen("?mode=single")).toBe(true); // the mode chosen there, no level yet: pick a park
  expect(needsStartScreen("?level=glacier-point")).toBe(false);
  expect(needsStartScreen("?showroom")).toBe(false);
  expect(pick("?level=glacier-point").id).toBe("glacier-point");
  expect(pick("?level=nowhere").id).toBe("el-capitan");
});

test("a short hop onto the boulder is not the Boulder Gap", () => {
  const { run } = drive(park("el-capitan"), "street line", 10, "Boulder Gap", 14);
  expect(run.gaps.size).toBe(0);
});

test("Half Dome's east shoulder is a natural ramp: driving up it climbs the dome", () => {
  const l = park("half-dome"), { run } = drive(l, "dome run", 12, "Half Dome Face");
  expect(run.done(l.goals.find((g) => g.kind === "climb")!)).toBe(true);
});

test("a straight run rolls up the stairs and over the funbox", () => {
  const l = park("old-faithful"), sp = l.spawns.find((p) => p.name === "boardwalk")!, along = (p: { x: number; z: number }) => (p.x - sp.x) * Math.sin(sp.yaw) + (p.z - sp.z) * Math.cos(sp.yaw);
  const funbox = l.pieces.find((p) => p.name === "funbox" && Math.abs((p.x - sp.x) * Math.cos(sp.yaw) - (p.z - sp.z) * Math.sin(sp.yaw)) < 2)!;
  const { s } = drive(l, "boardwalk", 14, undefined, 27, { x: sp.x + Math.sin(sp.yaw) * 500, z: sp.z + Math.cos(sp.yaw) * 500 });
  expect(along(s)).toBeGreaterThan(along(funbox) + funbox.d / 2); // past the stair set and the funbox on its line, not stopped at the first riser
});

test("?real rides the terrain at full height: taller ground, and climb goals scale with it", async () => {
  const e = LEVELS.find((l) => l.id === "half-dome")!;
  const friendly = (await build(e)) as ParkLevel, real = (await build(e, true)) as ParkLevel;
  expect(real.ground.height(0, 0) + real.ground.height(60, 60)).toBeGreaterThan(friendly.ground.height(0, 0) + friendly.ground.height(60, 60));
  const m = (l: ParkLevel) => (l.goals.find((g) => g.kind === "climb") as { metres: number }).metres;
  expect(m(real)).toBeGreaterThan(m(friendly));
});

test("a line is placed beat by beat and its goal completes when the rider rides it through, and not when they skip a beat", () => {
  const level = park("glacier-point"), route = level.routes.find((r) => r.name === "plateau line")!;
  expect(route.points.length).toBe(5);
  const goal = level.goals.find((g) => g.kind === "line")!;
  const ride = (points: { x: number; z: number; r: number }[]) => {
    const first = points[0]!, s = start(first.x, first.z + 14, Math.PI, level), run = trackRun(level);
    for (const to of points) for (let i = 0; i < 20 * 60; i++) {
      const err = Math.atan2(Math.sin(Math.atan2(to.x - s.x, to.z - s.z) - s.yaw), Math.cos(Math.atan2(to.x - s.x, to.z - s.z) - s.yaw));
      step(s, { ...IDLE, throttle: s.speed < 12 ? 1 : 0, steer: Math.max(-1, Math.min(1, err * 3)), jump: !s.air && s.speed > 8 && Math.abs(Math.hypot(to.x - s.x, to.z - s.z) - (to.r + 1)) < 1.5 }, { ...level, obstacles: level.trees }); // pops onto each beat, before the nose meets its side
      run.update(s);
      if (Math.hypot(to.x - s.x, to.z - s.z) < 3) break;
    }
    return run;
  };
  expect(ride(route.points).done(goal)).toBe(true);
  expect(ride([route.points[0]!, route.points[4]!]).done(goal)).toBe(false);
});

test("Old Faithful starts facing the geyser and the bowl: riding straight from spawn reaches the bowl's rim, and the plume stands in the view", () => {
  const l = park("old-faithful"), sp = l.spawns[0]!, plume = l.landmarks.find((m) => m.kind === "plume")!;
  const bowl = l.pieces.reduce((a, p) => (Math.hypot(p.x - plume.x, p.z - plume.z) < Math.hypot(a.x - plume.x, a.z - plume.z) ? p : a));
  const bearing = (x: number, z: number) => Math.abs(Math.atan2(Math.sin(Math.atan2(x - sp.x, z - sp.z) - sp.yaw), Math.cos(Math.atan2(x - sp.x, z - sp.z) - sp.yaw)));
  const rise = (x: number, z: number, y: number) => Math.atan2(y - (l.height(sp.x, sp.z) + 1.5), Math.hypot(x - sp.x, z - sp.z));
  expect(bearing(plume.x, plume.z)).toBeLessThan(0.2);
  expect(Math.hypot(plume.x - sp.x, plume.z - sp.z)).toBeLessThan(110); // near enough to read, not a speck on the horizon
  expect(rise(plume.x, plume.z, l.height(plume.x, plume.z) + plume.tall)).toBeLessThan((66 / 2) * Math.PI / 180); // its top inside the 66 degree lens
  const s = start(sp.x, sp.z, sp.yaw, l);
  let reached = false;
  for (let i = 0; i < 20 * 60 && !reached; i++) { step(s, { ...IDLE, throttle: 1, boost: true }, { ...l, obstacles: l.trees }); reached = Math.hypot(s.x - bowl.x, s.z - bowl.z) < 40; }
  expect(reached).toBe(true);
});

