// The park is cut into the ground: bowls, pumps and channels across the whole map, ridden by the same sim.
import { expect, setDefaultTimeout, test } from "bun:test";

setDefaultTimeout(60000); // seventy levels take a while on CI
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { IDLE, start, step } from "../src/sim.ts";
import { allParks } from "./parks.ts";
import { hillBank, hillHalf, hillPlane, hillQuarter, hillShelf, hillSnake, sculpt, WORKS, type Earthwork } from "../src/levels/earthworks.ts";

const parks = await allParks();

test("every park has earthworks spread across the map, not clumped in one corner", () => {
  for (const l of parks) {
    expect(l.earthworks.length).toBeGreaterThanOrEqual(3);
    if (l.earthworks.length < 8) continue; // the hand-laid parks (El Capitan, Old Faithful) leave little open ground; they only need a few
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

// A planar hillside of slope 0.3, rising toward `ASPECT`; a slope work laid on it is yawed so its +z is uphill.
const ASPECT = 0.6, SLOPE = 0.3, PLANE = (x: number, z: number) => 40 + SLOPE * (x * Math.sin(ASPECT) + z * Math.cos(ASPECT));
const hillside = { R: 500, height: PLANE };
const at = { x: 12, z: -20, yaw: ASPECT }, y0 = PLANE(at.x, at.z);
const family: [string, () => Earthwork | null][] = [
  ["quarter", () => hillQuarter(at, y0, SLOPE)], ["half pipe", () => hillHalf(at, y0, SLOPE)], ["bank", () => hillBank(at, y0, SLOPE)], ["hip", () => hillBank(at, y0, SLOPE, { hip: 0.5 })],
  ["snake", () => hillSnake(at, y0, SLOPE)], ["shelf", () => hillShelf(at, y0, SLOPE)],
];

for (const [name, make] of family) {
  test(`a hillside ${name} on a 0.3 slope is one continuous surface, with its lips at the hill's own height`, () => {
    const e = make()!, land = sculpt(hillside, [e]), r = e.reach, h = 0.1;
    expect(e.tilt).toBe(SLOPE);
    let worst = 0, cut = 0;
    for (let x = e.x - r; x < e.x + r; x += h) for (let z = e.z - r; z < e.z + r; z += h) {
      const v = land.height(x, z);
      worst = Math.max(worst, Math.abs(land.height(x + h, z) - v), Math.abs(land.height(x, z + h) - v));
      cut = Math.max(cut, Math.abs(v - PLANE(x, z)));
    }
    expect(worst).toBeLessThan(0.5); // no step anywhere across the footprint and its skirt
    expect(cut).toBeGreaterThan(1.2); // and it really moved the hill
    expect(e.rails.length).toBeGreaterThan(0);
    for (const rail of e.rails) for (const t of [0, 0.5, 1]) {
      const x = rail.a.x + (rail.b.x - rail.a.x) * t, z = rail.a.z + (rail.b.z - rail.a.z) * t;
      expect(Math.abs(land.height(x, z) - PLANE(x, z))).toBeLessThan(0.3); // the coping sits on the hill's own level
    }
  });
}

test("a hillside quarter is a wall below its lip and the hill above it", () => {
  const e = hillQuarter(at, y0, SLOPE), land = sculpt(hillside, [e]), up = { x: Math.sin(ASPECT), z: Math.cos(ASPECT) }, rail = e.rails[0]!;
  const mid = { x: (rail.a.x + rail.b.x) / 2, z: (rail.a.z + rail.b.z) / 2 };
  const along = (m: number) => land.height(mid.x + up.x * m, mid.z + up.z * m) - PLANE(mid.x + up.x * m, mid.z + up.z * m);
  expect(along(-2)).toBeLessThan(-0.8); // carved out below the lip
  expect(along(-5)).toBeLessThan(-0.5); // and the level floor under it
  expect(Math.abs(along(3))).toBeLessThan(0.3); // the hill behind it
});

test("the plane fit reads a hill's slope and which way is up", () => {
  const f = hillPlane(PLANE, 100, 50);
  expect(f.slope).toBeCloseTo(SLOPE, 3);
  expect(f.yaw).toBeCloseTo(ASPECT, 3);
  expect(f.off).toBeLessThan(1e-6);
});

test("a rider climbs a hillside quarter from the flat below, airs out of its lip and lands back on the hill", () => {
  const p = parks.find((l) => l.id === "half-dome")!, e = p.earthworks.find((w) => w.kind === "hillQuarter")!, up = { x: Math.sin(e.yaw), z: Math.cos(e.yaw) };
  const along = (x: number, z: number) => (x - e.x) * up.x + (z - e.z) * up.z, lipAt = along(e.rails[0]!.a.x, e.rails[0]!.a.z);
  const s = start(e.run!.from.x, e.run!.from.z, e.yaw, p);
  expect(along(s.x, s.z)).toBeLessThan(lipAt - 5); // starts in the run-in, below the wall
  let flew = false, landed = false;
  for (let i = 0; i < 10 * 60 && !landed; i++) {
    step(s, { ...IDLE, throttle: 1, boost: true }, p);
    expect(Number.isFinite(s.y)).toBe(true);
    if (s.air && along(s.x, s.z) > lipAt - 1) flew = true;
    if (flew && !s.air) landed = true;
  }
  expect(flew).toBe(true); // it left the lip
  expect(landed).toBe(true);
  expect(along(s.x, s.z)).toBeGreaterThan(lipAt); // over the lip, on the hill behind it
  expect(s.bail).toBe(0);
  expect(s.y - p.height(s.x, s.z)).toBeLessThan(0.5);
});

test("every park has a hillside cut within 60 m of a spawn, so a rider sees one from the start", () => {
  for (const l of parks) {
    const hills = l.earthworks.filter((e) => e.tilt);
    expect([l.id, l.spawns.some((sp) => hills.some((e) => Math.hypot(e.x - sp.x, e.z - sp.z) < 60))]).toEqual([l.id, true]);
  }
});

test("a snake run stays one surface on rough ground that strays a metre from its plane", () => {
  const rough = { R: 500, height: (x: number, z: number) => PLANE(x, z) + 0.9 * Math.sin(x / 7) * Math.cos(z / 9) }, e = hillSnake(at, y0, SLOPE), land = sculpt(rough, [e]), h = 0.1;
  let worst = 0;
  for (let x = e.x - e.reach; x < e.x + e.reach; x += h) for (let z = e.z - e.reach; z < e.z + e.reach; z += h) worst = Math.max(worst, Math.abs(land.height(x + h, z) - land.height(x, z)), Math.abs(land.height(x, z + h) - land.height(x, z)));
  expect(worst).toBeLessThan(0.5);
});

test("hillside cuts are capped per park and their kinds are evenly mixed", () => {
  for (const l of parks) {
    const hills = l.earthworks.filter((e) => e.tilt), kinds = ["hillQuarter", "hillHalf", "hillBank", "hillSnake", "hillShelf"].map((k) => hills.filter((e) => e.kind === k).length);
    expect([l.id, hills.length <= WORKS.hillMax]).toEqual([l.id, true]);
    if (hills.length >= 15) expect([l.id, Math.max(...kinds) - Math.min(...kinds) <= 3]).toEqual([l.id, true]);
  }
});
