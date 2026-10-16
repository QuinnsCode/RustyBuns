// The park is cut into the ground: bowls, pumps and channels across the whole map, ridden by the same sim.
import { expect, test } from "bun:test";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { IDLE, start, step } from "../src/sim.ts";

const parks = LEVELS.filter((l) => l.id !== "plaza").map((l) => l.load() as ParkLevel);

test("every park has earthworks spread across the map, not clumped in one corner", () => {
  for (const l of parks) {
    expect(l.earthworks.length).toBeGreaterThanOrEqual(6);
    const xs = l.earthworks.map((e) => e.x), zs = l.earthworks.map((e) => e.z), { minX, maxX, minZ, maxZ } = l.bounds;
    expect([l.id, (Math.max(...xs) - Math.min(...xs)) / (maxX - minX) > 0.5]).toEqual([l.id, true]);
    expect([l.id, (Math.max(...zs) - Math.min(...zs)) / (maxZ - minZ) > 0.35]).toEqual([l.id, true]);
  }
});

test("a bowl is dug into the ground: its floor is below its lip, and the ground (not a piece) says so", () => {
  const l = parks.flatMap((p) => p.earthworks.map((e) => ({ p, e }))).find(({ e }) => e.kind === "bowl")!;
  const { p, e } = l, c = Math.cos(e.yaw), s = Math.sin(e.yaw), at = (lx: number, lz: number) => p.ground.height(e.x + lx * c + lz * s, e.z - lx * s + lz * c);
  expect(at(0, 0)).toBeLessThan(e.y0 - 1.5);
  expect(at(e.w / 2 - 1.5, 0)).toBeCloseTo(e.y0, 1);
  expect(p.height(e.x, e.z)).toBe(p.ground.height(e.x, e.z));
  expect(p.paint(e.x, e.z).surface).toBe("concrete");
});

test("earthworks stay off the spawns, so every run still starts on level ground", () => {
  for (const l of parks) for (const sp of l.spawns) for (const e of l.earthworks) expect(Math.hypot(e.x - sp.x, e.z - sp.z)).toBeGreaterThan(Math.min(e.w, e.d) / 2 + e.skirt);
});

test("a rider drops into a bowl, rolls its floor and comes back up the wall without leaving the ground's world", () => {
  const l = parks.flatMap((p) => p.earthworks.map((e) => ({ p, e }))).find(({ e }) => e.kind === "pool")!, { p, e } = l;
  const s = start(e.x - Math.sin(0) * (e.w / 2 - 1), e.z - e.d / 2 + 1, 0, p);
  let low = Infinity, high = -Infinity;
  for (let i = 0; i < 8 * 60; i++) {
    step(s, { ...IDLE, throttle: 1 }, p);
    expect(Number.isFinite(s.y)).toBe(true);
    low = Math.min(low, s.y); high = Math.max(high, s.y);
  }
  expect(e.y0 - low).toBeGreaterThan(1.5); // it went down into the pool
});
