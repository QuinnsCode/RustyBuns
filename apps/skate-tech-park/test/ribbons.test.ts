// Contour ribbons: they hold their height along the slope, stay off the hand-laid kit, and can be ridden end to end.
import { expect, test } from "bun:test";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { berm, extrude, mirror, trace } from "../src/levels/ribbons.ts";
import { IDLE, start, step } from "../src/sim.ts";

const parks = LEVELS.filter((l) => l.id !== "plaza").map((l) => l.load() as ParkLevel);

test("every park is filled with ribbons, each holding one height along the slope and clear of spawns", () => {
  for (const l of parks) {
    expect(l.ribbons.length).toBeGreaterThanOrEqual(3);
    for (const r of l.ribbons) {
      const ys = r.path.map((p) => l.ground.height(p.x, p.z));
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(1.5);
      for (const sp of l.spawns) for (const p of r.path) expect(Math.hypot(p.x - sp.x, p.z - sp.z)).toBeGreaterThan(14);
      for (const p of r.path) expect(p.x).toBeGreaterThan(l.bounds.minX);
    }
  }
});

test("a berm is a lip on the downhill side that tapers in and out, and mirror flips it", () => {
  const path = trace((_, z) => -0.3 * z, { x: 0, z: 0 }, { len: 60 }); // a plain hillside, downhill toward -z
  expect(path.length).toBeGreaterThan(10);
  const p = berm(), part = extrude(path, p);
  expect(part.pieces.length).toBe(path.length - 1);
  expect(part.rails.length).toBe(path.length - 1);
  expect(p.f(p.w * 0.3, 0)).toBeGreaterThan(p.f(-p.w * 0.3, 0));
  expect(mirror(p).f(-p.w * 0.3, 0)).toBeCloseTo(p.f(p.w * 0.3, 0));
});

test("a rider can follow a ribbon end to end without bailing", () => {
  const l = parks.find((x) => x.id === "el-capitan")!, r = l.ribbons.reduce((a, b) => (b.path.length > a.path.length ? b : a));
  const a = r.path[0]!, b = r.path[1]!;
  const s = start(a.x, a.z, Math.atan2(b.x - a.x, b.z - a.z), l);
  let i = 1, bails = 0;
  for (let t = 0; t < 60 * 90 && i < r.path.length; t++) {
    const to = r.path[Math.min(i + 1, r.path.length - 1)]!;
    if (Math.hypot(to.x - s.x, to.z - s.z) < 5) i++;
    const err = Math.atan2(Math.sin(Math.atan2(to.x - s.x, to.z - s.z) - s.yaw), Math.cos(Math.atan2(to.x - s.x, to.z - s.z) - s.yaw));
    step(s, { ...IDLE, throttle: s.speed < 8 ? 1 : 0, steer: Math.max(-1, Math.min(1, err * 3)) }, l);
    if (s.bail > 0) bails++;
  }
  expect(i).toBeGreaterThanOrEqual(r.path.length - 2);
  expect(bails).toBe(0);
});
