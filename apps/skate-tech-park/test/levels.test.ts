// Journeys over the park levels: each loads, spawns on flat ground, and every named gap can be cleared
// by driving the sim along a scripted line.
import { expect, test } from "bun:test";
import { LEVELS } from "../src/levels/index.ts";
import { trackRun } from "../src/levels/goals.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { IDLE, type Input, type Mode, start, step } from "../src/sim.ts";

const parks = LEVELS.filter((l) => l.id !== "plaza").map((l) => l.load() as ParkLevel);
const park = (id: string) => parks.find((l) => l.id === id)!;

/** Drives from a spawn, feeding the tracker, until `seconds` pass. */
function drive(level: ParkLevel, mode: Mode, spawn: string, seconds: number, input: (s: ReturnType<typeof start>) => Partial<Input>) {
  const sp = level.spawns.find((p) => p.name === spawn)!;
  const s = start(mode, sp.x, sp.z, sp.yaw, level), run = trackRun(level);
  for (let i = 0; i < seconds * 60; i++) {
    step(s, { ...IDLE, ...input(s) }, level);
    run.update(s);
  }
  return { s, run };
}

test("every park loads with finite ground, goals and spawns on flat ground inside its bounds", () => {
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
      for (const [dx, dz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) expect(Math.abs(l.height(sp.x + dx!, sp.z + dz!) - h)).toBeLessThan(0.3);
    }
    for (const g of l.gaps) expect(g.bonus).toBeGreaterThan(0);
    for (const g of l.goals) if (g.kind === "gap") expect(l.gaps.map((x) => x.name)).toContain(g.name);
    for (const p of l.pickups) expect(Number.isFinite(p.y)).toBe(true);
  }
});

test("the boulder gap in the meadow is cleared on a board, ollieing off the kicker", () => {
  const { s, run } = drive(park("el-capitan"), "skate", "skate", 12, (s) => ({ throttle: 1, jump: s.x > -1.5 && s.x < 0 }));
  expect(run.gaps.get("Boulder Gap")).toBe(1);
  expect(s.score).toBeGreaterThanOrEqual(600);
  expect(run.bestCombo).toBeGreaterThanOrEqual(600); // the gap bonus counts toward the combo
  expect(run.collected.size).toBeGreaterThan(0); // the pickups on the line
});

test("the roadster drops in, crosses the plateau and flies Glacier Point's void to the landing", () => {
  const { s, run } = drive(park("glacier-point"), "car", "rim deck", 12, () => ({ throttle: 1 }));
  expect(run.gaps.get("Glacier Point Gap")).toBe(1);
  expect(s.bail).toBe(0);
});

test("the vent in the geyser basin and the fallen giant in the grove are both hopped on a board", () => {
  for (const [id, name, line] of [["old-faithful", "Geyser Hop", { x: 14, z: 30 }], ["mariposa-grove", "Fallen Giant", { x: 12, z: 40 }]] as const) {
    const l = park(id), g = l.gaps.find((x) => x.name === name)!;
    const s = start("skate", line.x, line.z, Math.PI / 2, l), run = trackRun(l);
    for (let i = 0; i < 60 * 8; i++) {
      step(s, { ...IDLE, throttle: 1, jump: s.x > g.a.x + 0.5 && s.x < g.a.x + 2 }, l);
      run.update(s);
    }
    expect(run.gaps.get(name)).toBe(1);
  }
});
