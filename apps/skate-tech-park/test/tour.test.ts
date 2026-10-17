// The home page's camera: every park gets a tour that never jumps, never dips into the ground, and ends on its highest point.
import { expect, test } from "bun:test";
import { LEVELS, tourPick } from "../src/levels/index.ts";
import { STOP_SECONDS, tourShot, tourStops } from "../src/render/tour.ts";

test("every park's tour is one smooth loop above the ground that climbs to the top", () => {
  for (const entry of LEVELS.filter((l) => l.id !== "plaza")) {
    const level = entry.load(), stops = tourStops(level), loop = stops.length * STOP_SECONDS;
    expect(stops.length).toBeGreaterThan(1);
    const top = stops[stops.length - 1]!;
    expect(top.peak).toBe(true);
    let prev = tourShot(level, stops, 0);
    for (let t = 0.25; t <= loop + 0.25; t += 0.25) {
      const s = tourShot(level, stops, t);
      expect(Math.hypot(s.pos[0] - prev.pos[0], s.pos[2] - prev.pos[2])).toBeLessThan(20); // a quarter second moves the camera tens of metres at most, never a cut
      expect(s.pos[1]).toBeGreaterThan(level.height(s.pos[0], s.pos[2]));
      prev = s;
    }
    const again = tourShot(level, stops, loop);
    expect(again.pos[0]).toBeCloseTo(tourShot(level, stops, 0).pos[0], 3); // it loops
  }
});

test("the home page flies over a park of the visitor's choosing, else any park but the plaza", () => {
  expect(tourPick("?tour=half-dome").id).toBe("half-dome");
  expect(tourPick("?tour=plaza", () => 0).id).toBe("el-capitan");
  expect(new Set(Array.from({ length: 40 }, (_, i) => tourPick("", () => i / 40).id)).has("plaza")).toBe(false);
});
