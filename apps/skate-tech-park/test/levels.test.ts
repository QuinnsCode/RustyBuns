// Journeys over the park levels: each loads, spawns on flat ground, and every named gap can be cleared
// by driving the sim along a scripted line.
import { expect, test } from "bun:test";
import { LEVELS, needsStartScreen, pick } from "../src/levels/index.ts";
import { trackRun } from "../src/levels/goals.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { DECK } from "../src/models.ts";
import { IDLE, start, step } from "../src/sim.ts";

// m/s held into a gap: every gap clears at any of these (a ramp's launch does not scale with the board, so the line is not divided by SCALE)
const SPEEDS = [24, 27, 32];
const parks = LEVELS.filter((l) => l.id !== "plaza").map((l) => l.load() as ParkLevel);
const park = (id: string) => parks.find((l) => l.id === id)!;

/** Drives from a spawn, steering at a gap's launch and tapping jump at its lip, feeding the tracker. */
function drive(level: ParkLevel, spawn: string, seconds: number, gapName?: string, line = 27, target?: { x: number; z: number }) {
  const sp = level.spawns.find((p) => p.name === spawn)!, g = level.gaps.find((x) => x.name === gapName);
  const s = start(sp.x, sp.z, sp.yaw, level), run = trackRun(level);
  level = { ...level, obstacles: level.trees }; // these lines ride gaps and pickups, not rail posts: a handrail on the spawn line is in the way, not the point
  for (let i = 0; i < seconds * 60; i++) {
    const to = g?.a ?? target, aim = to ? Math.atan2(to.x - s.x, to.z - s.z) : s.yaw, err = Math.atan2(Math.sin(aim - s.yaw), Math.cos(aim - s.yaw));
    const along = g ? (s.x - g.a.x) * Math.sin(s.yaw) + (s.z - g.a.z) * Math.cos(s.yaw) : -99;
    step(s, { ...IDLE, throttle: s.speed < line ? 1 : -1, boost: !s.air && s.speed < line, steer: s.air ? 0 : Math.max(-1, Math.min(1, err * 3)), jump: along > 3 && along < 8 && !s.air }, level);
    run.update(s);
  }
  return { s, run };
}

test("every park loads with finite ground, goals and spawns on rideable ground inside its bounds", () => {
  for (const l of parks) {
    expect(l.goals.length).toBeGreaterThanOrEqual(3);
    expect(l.goals.length).toBeLessThanOrEqual(5);
    expect(l.spawns.length).toBeGreaterThan(0);
    for (const sp of l.spawns) {
      expect(sp.x).toBeGreaterThan(l.bounds.minX);
      expect(sp.x).toBeLessThan(l.bounds.maxX);
      expect(sp.z).toBeGreaterThan(l.bounds.minZ);
      expect(sp.z).toBeLessThan(l.bounds.maxZ);
      const h = l.height(sp.x, sp.z);
      expect(Number.isFinite(h)).toBe(true);
      for (const [dx, dz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) expect(Math.abs(l.height(sp.x + dx!, sp.z + dz!) - h)).toBeLessThan(0.75); // rideable: under a 0.5 slope
    }
    for (const g of l.gaps) expect(g.bonus).toBeGreaterThan(0);
    for (const g of l.goals) if (g.kind === "gap") expect(l.gaps.map((x) => x.name)).toContain(g.name);
    for (const p of l.pickups) expect(Number.isFinite(p.y)).toBe(true);
  }
});

test("the named gaps are cleared at any speed from 24 to 32 by driving at the launch and jumping at the lip, and a hop onto the obstacle does not count", () => {
  for (const [id, spawn, name] of [["el-capitan", "street line", "Boulder Gap"], ["old-faithful", "vent line", "Geyser Hop"], ["mariposa-grove", "clearing", "Fallen Giant"], ["glacier-point", "plateau", "Glacier Point Gap"], ["half-dome", "dome run", "Half Dome Face"], ["yosemite-falls", "shelf", "Upper Fall"], ["yosemite-falls", "valley line", "Valley Hop"], ["grand-prismatic", "street line", "Sinter Jump"], ["grand-canyon", "rim line", "Canyon Drop"]] as const) {
    for (const line of SPEEDS) {
      const { s, run } = drive(park(id), spawn, 20, name, line);
      expect(run.gaps.get(name)).toBeGreaterThanOrEqual(1);
      expect(s.score).toBeGreaterThanOrEqual(park(id).gaps.find((g) => g.name === name)!.bonus);
      expect(run.bestCombo).toBeGreaterThan(0);
    }
  }
}, 30000);

test("El Capitan's talus is a quarter pipe: driving at the wall climbs it", () => {
  const l = park("el-capitan"), { s, run } = drive(l, "wall view", 8);
  const goal = l.goals.find((g) => g.kind === "climb")!;
  expect(run.done(goal)).toBe(true);
  expect(s.y).toBeGreaterThan(l.height(36, 120) + 20);
});

test("kit parts lie on the ground: a rail on the grove's hillside slopes with it, and pickups ride the line", () => {
  const l = park("mariposa-grove");
  const bar = l.rails.find((r) => r.kind === "rail")!;
  expect(Math.abs((bar.y2 ?? bar.y) - bar.y)).toBeGreaterThan(1);
  const { run } = drive(l, "grove road", 8, undefined, 27, l.pickups[0]); // steer at the first ring, as a player would
  expect(run.collected.size).toBeGreaterThan(0);
});

test("the start screen shows until a level is chosen, and a query picks its level", () => {
  expect(needsStartScreen("")).toBe(true);
  expect(needsStartScreen("?level=glacier-point")).toBe(false);
  expect(needsStartScreen("?showroom")).toBe(false);
  expect(pick("?level=glacier-point").id).toBe("glacier-point");
  expect(pick("?level=nowhere").id).toBe("el-capitan");
  expect(LEVELS.map((l) => l.id)).toEqual(["plaza", "el-capitan", "glacier-point", "old-faithful", "mariposa-grove", "half-dome", "yosemite-falls", "grand-prismatic", "grand-canyon"]);
});

test("a short hop onto the boulder is not the Boulder Gap", () => {
  const { run } = drive(park("el-capitan"), "street line", 10, "Boulder Gap", 14);
  expect(run.gaps.size).toBe(0);
});

test("Half Dome's east shoulder is a natural ramp: driving up it climbs the dome", () => {
  const l = park("half-dome"), { run } = drive(l, "dome run", 12, "Half Dome Face");
  expect(run.done(l.goals.find((g) => g.kind === "climb")!)).toBe(true);
});

test("every park has a sky rail: a long bar on stilts you can ride from its kicker, steep or shallow, climbing away from the ground", () => {
  for (const l of parks) {
    const sp = l.spawns.find((p) => p.name === "sky rail")!, bar = l.rails.find((r) => Math.abs((r.y2 ?? r.y) - r.y) > 10)!;
    expect(sp).toBeDefined();
    expect(bar).toBeDefined();
    const s = start(sp.x, sp.z, sp.yaw, l);
    let ground = 0, top = 0;
    for (let i = 0; i < 12 * 60; i++) {
      const lip = (s.x - bar.a.x) * Math.sin(s.yaw) + (s.z - bar.a.z) * Math.cos(s.yaw);
      const len = Math.hypot(bar.b.x - bar.a.x, bar.b.z - bar.a.z), ux = (bar.b.x - bar.a.x) / len, uz = (bar.b.z - bar.a.z) / len, ahead = (s.x - bar.a.x) * ux + (s.z - bar.a.z) * uz + 6, to = { x: bar.a.x + ux * ahead, z: bar.a.z + uz * ahead }, err = Math.atan2(Math.sin(Math.atan2(to.x - s.x, to.z - s.z) - s.yaw), Math.cos(Math.atan2(to.x - s.x, to.z - s.z) - s.yaw));
      step(s, { ...IDLE, throttle: s.speed < 30 ? 1 : -1, boost: !s.air && s.speed < 30, steer: s.air ? 0 : Math.max(-1, Math.min(1, err * 8)), jump: lip > -3 && lip < -1.5 && !s.air }, l);
      if (s.grind >= 0) ground++;
      top = Math.max(top, s.y);
    }
    expect([l.id, ground > 60]).toEqual([l.id, true]);
    expect(top - l.height(bar.a.x, bar.a.z)).toBeGreaterThan(4);
  }
});

test("the kit is toy-sized beside the deck: every piece is wider than the board, and a straight run rolls up the stairs and over the funbox", () => {
  for (const l of parks) for (const p of l.pieces) expect(Math.min(p.w, p.d)).toBeGreaterThan(DECK.width);
  const { s } = drive(park("old-faithful"), "boardwalk", 9, undefined, 27, { x: 40, z: 20 });
  expect(s.x).toBeGreaterThan(0); // past the stair set at -100 and the funbox at -70, not stopped at the first riser
});

test("?real rides the terrain at full height: taller ground, and climb goals scale with it", () => {
  const e = LEVELS.find((l) => l.id === "half-dome")!;
  const friendly = e.load() as ParkLevel, real = e.load(true) as ParkLevel;
  expect(real.ground.height(0, 0) + real.ground.height(60, 60)).toBeGreaterThan(friendly.ground.height(0, 0) + friendly.ground.height(60, 60));
  const m = (l: ParkLevel) => (l.goals.find((g) => g.kind === "climb") as { metres: number }).metres;
  expect(m(real)).toBeGreaterThan(m(friendly));
});

test("a park runs edge to edge of its terrain, and a rider driving at the barrier is stopped by it", () => {
  for (const l of parks) {
    expect(l.bounds.maxX - l.bounds.minX).toBeGreaterThan(600);
    const sp = l.spawns[0]!, s = start(sp.x, sp.z, sp.yaw, { ...l, obstacles: [] });
    for (let i = 0; i < 60 * 40; i++) step(s, { ...IDLE, throttle: 1, boost: true }, { ...l, obstacles: [] });
    expect(s.x).toBeGreaterThanOrEqual(l.bounds.minX);
    expect(s.x).toBeLessThanOrEqual(l.bounds.maxX);
    expect(s.z).toBeGreaterThanOrEqual(l.bounds.minZ);
    expect(s.z).toBeLessThanOrEqual(l.bounds.maxZ);
  }
}, 30000);
