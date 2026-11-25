import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../src/journey.ts";
import { POIS } from "../src/world/poi.ts";
import { cleared, inBuilding, lineDist, PINE_N, PUDDLES, RUTS, SIGHTS } from "../src/world/pines.ts";
import { newTrek, TRAILS, trek } from "../src/world/trail.ts";
import { spawn, type Walker } from "../src/world/world.ts";
import { DAY, weather } from "../src/world/nature.ts";

const trail = TRAILS.get(PINE_N)!;

describe("the Pine Barrens' landmarks", () => {
  test("Batsto, Atsion Lake, the fire tower and the bogs stand by their own sections, off the trail and clear of the other places", () => {
    expect(SIGHTS.map((s) => [s.id, s.k])).toEqual([["batsto", 0], ["atsion", 2], ["fire-tower", 4], ["bogs", 6]]);
    for (const s of SIGHTS) {
      const stone = trail.stones[s.k]!;
      expect([s.id, Math.hypot(s.x - stone.x, s.z - stone.z) < 250]).toEqual([s.id, true]);
      expect([s.id, lineDist(trail.pts, s.x, s.z) > s.r]).toEqual([s.id, true]);
      expect(POIS.get(PINE_N)!.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > s.r)).toBe(true);
      // the trees stand back from it
      expect(cleared(s.x, s.z)).toBe(true);
    }
    expect(cleared(trail.stones[2]!.x, trail.stones[2]!.z)).toBe(false);
    expect(PUDDLES.length).toBeGreaterThan(40);
    // two wheel ruts run the length of the sand road: a stretch every few metres on each side
    expect(RUTS.length).toBeGreaterThan((trail.length / 3) * 1.5);
    // Atsion's white cedars stand round its lake, none in the water
    const atsion = SIGHTS.find((s) => s.id === "atsion")!, lake = atsion.parts.find((p) => p.kind === "lake")!, cedars = atsion.parts.filter((p) => p.kind === "cedar");
    expect(cedars.length).toBeGreaterThan(20);
    const co = Math.cos(lake.yaw), sn = Math.sin(lake.yaw);
    const ring = (p: { x: number; z: number }) => { const dx = p.x - lake.x, dz = p.z - lake.z; return Math.hypot((dx * co - dz * sn) / (lake.w / 2), (dx * sn + dz * co) / (lake.d / 2)); };
    for (const c of cedars) expect(ring(c)).toBeGreaterThan(1);
    // and its sedge lines the waterline, a little in and a little out, all round but the beach
    const sedge = atsion.parts.filter((p) => p.kind === "sedge");
    expect(sedge.length).toBeGreaterThan(60);
    for (const s of sedge) { expect(ring(s)).toBeGreaterThan(0.9); expect(ring(s)).toBeLessThan(1.1); }
  });

  test("walking at Batsto's mansion, you stop at its wall", () => {
    const batsto = SIGHTS.find((s) => s.id === "batsto")!, house = batsto.parts.find((p) => p.kind === "mansion")!;
    // from its side (its own +x), the tower being on its front
    const sx = Math.cos(house.yaw), sz = -Math.sin(house.yaw), me: Walker = { ...spawn(PINE_N), x: house.x + 20 * sx, z: house.z + 20 * sz }, t = newTrek(me);
    for (let i = 0; i < 80; i++) trek(me, t, -0.4 * sx, -0.4 * sz, new Set(), () => SECTIONS, inBuilding);
    const d = Math.hypot(me.x - house.x, me.z - house.z);
    expect(d).toBeGreaterThan(house.w / 2);
    expect(d).toBeLessThan(house.w / 2 + 2);
  });

  test("on some evenings a thunderstorm rolls in at dusk, and it is gone by night", () => {
    const days = Array.from({ length: 20 }, (_, i) => i * DAY);
    const stormy = days.filter((t) => weather(t, "pine-barrens", 19.5).rain > 0.9);
    expect(stormy.length).toBeGreaterThan(2);
    expect(stormy.length).toBeLessThan(16);
    for (const t of stormy) expect(weather(t, "pine-barrens", 22).rain).toBeLessThan(weather(t, "pine-barrens", 19.5).rain);
  });
});
