// Scenario links land where a hands-on check starts: the right park, a rail or a wall dead ahead.
import { expect, setDefaultTimeout, test } from "bun:test";
import { allParks, sample } from "./parks.ts";
import { LEVELS } from "../src/levels/index.ts";
import { DT, IDLE, start, step } from "../src/sim.ts";
import { linkOf, scenarioOf, spotFor } from "../src/scenario.ts";

setDefaultTimeout(60_000);

test("a link carries the scenario and the page reads it back", () => {
  const link = linkOf({ level: "el-capitan", spawn: "vert", quality: "low", controls: "touch", weak: true, fps: true });
  expect(link).toBe("?level=el-capitan&spawn=vert&quality=low&controls=touch&weak&fps");
  expect(scenarioOf(link)).toEqual({ controls: "touch", weak: 45, fps: true });
  expect(scenarioOf("?weak=300&controls=tablet")).toEqual({ controls: null, weak: 200, fps: true });
  expect(scenarioOf("")).toEqual({ controls: null, weak: 0, fps: false });
});

test("every park is one link away, and a rail, a balance bar and a vert wall are found and ridden to on sampled parks", async () => {
  expect(LEVELS.filter((l) => l.id !== "plaza").length).toBeGreaterThanOrEqual(63);
  const parks = await allParks(), ids = new Set(sample(LEVELS).map((e) => e.id));
  let walls = 0;
  for (const l of parks.filter((p) => ids.has(LEVELS.find((e) => e.name === p.name)!.id))) {
    for (const k of ["rail", "balance"] as const) {
      const at = spotFor(l, k);
      if (!at) continue;
      const s = start(at.x, at.z, at.yaw, l);
      const ahead = (r: { a: { x: number; z: number } }) => (r.a.x - s.x) * Math.sin(s.yaw) + (r.a.z - s.z) * Math.cos(s.yaw);
      expect(l.rails.some((r) => r.kind !== "coping" && Math.abs(ahead(r) - 14) < 0.5 && Math.hypot(r.a.x - s.x, r.a.z - s.z) < 14.5)).toBe(true); // a bar starts dead ahead
    }
    const wall = spotFor(l, "vert");
    if (!wall) continue;
    walls++;
    const s = Object.assign(start(wall.x, wall.z, wall.yaw, l), { speed: 14 }), ground = s.y; // rolling in, as a rider drops in
    let top = ground;
    for (let i = 0; i < 4 / DT; i++) { step(s, { ...IDLE, throttle: 1 }, l); top = Math.max(top, s.y); }
    expect(top).toBeGreaterThan(ground + 1); // rolling straight on runs up the wall
  }
  expect(walls).toBeGreaterThan(0);
});
