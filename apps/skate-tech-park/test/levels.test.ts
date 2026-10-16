// Journeys over the park levels: each loads, spawns on flat ground, and every named gap can be cleared
// by driving the sim along a scripted line.
import { expect, test } from "bun:test";
import { LEVELS, needsStartScreen, pick } from "../src/levels/index.ts";
import { trackRun } from "../src/levels/goals.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { IDLE, SCALE, start, step } from "../src/sim.ts";

// m/s held into a gap: at SCALE 1 the board clears all four at 27 (Glacier Point only from 26 to 28); a bigger board hangs longer, so the same line needs less speed
const LINE = 27 / Math.sqrt(SCALE);
const parks = LEVELS.filter((l) => l.id !== "plaza").map((l) => l.load() as ParkLevel);
const park = (id: string) => parks.find((l) => l.id === id)!;

/** Drives from a spawn, steering at a gap's launch and tapping jump at its lip, feeding the tracker. */
function drive(level: ParkLevel, spawn: string, seconds: number, gapName?: string) {
  const sp = level.spawns.find((p) => p.name === spawn)!, g = level.gaps.find((x) => x.name === gapName);
  const s = start(sp.x, sp.z, sp.yaw, level), run = trackRun(level);
  for (let i = 0; i < seconds * 60; i++) {
    const aim = g ? Math.atan2(g.a.x - s.x, g.a.z - s.z) : s.yaw, err = Math.atan2(Math.sin(aim - s.yaw), Math.cos(aim - s.yaw));
    const along = g ? (s.x - g.a.x) * Math.sin(s.yaw) + (s.z - g.a.z) * Math.cos(s.yaw) : -99;
    step(s, { ...IDLE, throttle: s.speed < LINE ? 1 : -1, boost: s.speed < LINE - 2, steer: s.air ? 0 : Math.max(-1, Math.min(1, err * 3)), jump: along > 3 && along < 8 && !s.air }, level);
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

test("the named gaps are cleared by driving at the launch and jumping at the lip", () => {
  for (const [id, spawn, name] of [["el-capitan", "car", "Boulder Gap"], ["old-faithful", "vent line", "Geyser Hop"], ["mariposa-grove", "clearing", "Fallen Giant"], ["glacier-point", "car", "Glacier Point Gap"]] as const) {
    const { s, run } = drive(park(id), spawn, 10, name);
    expect(run.gaps.get(name)).toBe(1);
    expect(s.score).toBeGreaterThanOrEqual(park(id).gaps.find((g) => g.name === name)!.bonus);
    expect(run.bestCombo).toBeGreaterThan(0);
  }
});

test("El Capitan's talus is a quarter pipe: driving at the wall climbs it", () => {
  const l = park("el-capitan"), { s, run } = drive(l, "wall run", 8);
  const goal = l.goals.find((g) => g.kind === "climb")!;
  expect(run.done(goal)).toBe(true);
  expect(s.y).toBeGreaterThan(l.height(36, 120) + 20);
});

test("kit parts lie on the ground: a rail on the grove's hillside slopes with it, and pickups ride the line", () => {
  const l = park("mariposa-grove");
  const bar = l.rails.find((r) => r.kind === "rail")!;
  expect(Math.abs((bar.y2 ?? bar.y) - bar.y)).toBeGreaterThan(1);
  const { run } = drive(l, "grove road", 8);
  expect(run.collected.size).toBeGreaterThan(0);
});

test("the start screen shows until a level is chosen, and a query picks its level", () => {
  expect(needsStartScreen("")).toBe(true);
  expect(needsStartScreen("?level=glacier-point")).toBe(false);
  expect(needsStartScreen("?showroom")).toBe(false);
  expect(pick("?level=glacier-point").id).toBe("glacier-point");
  expect(pick("?level=nowhere").id).toBe("plaza");
  expect(LEVELS.map((l) => l.id)).toEqual(["plaza", "el-capitan", "glacier-point", "old-faithful", "mariposa-grove"]);
});
