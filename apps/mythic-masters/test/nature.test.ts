import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import coarse from "../src/world/coarse.json";
import { newJourney, mend, wound } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { FLORA, KINDS, TURF } from "../src/world/flora.ts";
import { bare, BIRDS, birdAt, daylight, FLIGHT, flocksNear, flushHeading, FORAGE, FORAGE_MEND, forageNear, landing, pick, REGROW, weather, wind } from "../src/world/nature.ts";
import { arenaOf, buildWorld, CELL, depthAt, detailAt, dry, groundFrom, heightAt, openRegions, ownerAt, refine, regionAt, riverAt, spawn, waterAt } from "../src/world/world.ts";
import { POIS } from "../src/world/poi.ts";
import { TRAILS, WORLD } from "../src/world/trail.ts";

const w = buildWorld(coarse);
for (const g of REGIONS) refine(w, g.n, groundFrom(readFileSync(new URL(`../public/ground/${g.n}.bin`, import.meta.url))));
const open = openRegions(new Set([1, 2, 3, 4, 5, 6, 7, 8]));

describe("a bigger, rougher world", () => {
  test("a region is an hour's walk across, and the mountains are ridged and rough where the plains roll", () => {
    expect(CELL).toBe(6400); // at a jackalope's 7 m/s walk, a quarter of an hour; the continent 77 km, hours
    const range = (n: number) => { const a = arenaOf(REGIONS[n - 1]!), ds = Array.from({ length: 400 }, (_, i) => detailAt(w, a.x + 300 + i * 4, a.z + 300, 20)); return Math.max(...ds) - Math.min(...ds); };
    expect(range(13)).toBeGreaterThan(range(8) * 2); // the Andes against the Ozark plains
    expect(range(8)).toBeGreaterThan(1);
  });
});

describe("rivers", () => {
  test("rivers wind through the Pine Barrens: a narrow channel cut below its banks with water over the middle, and nothing stands in one", () => {
    let land = 0, wet = 0, deep = 0;
    for (let z = 0; z < CELL; z += 20) for (let x = 3 * CELL; x < 4 * CELL; x += 20) {
      if (ownerAt(x, z) !== 1 || heightAt(w, x, z) < 0.3) continue;
      land++;
      const d = depthAt(w, x, z);
      if (d > 0) { wet++; expect(riverAt(x, z)).toBeGreaterThan(0.3); expect(waterAt(w, x, z)).toBeGreaterThan(0); expect(dry(w, x, z)).toBe(false); }
      if (d > 1) deep++;
    }
    // A few streams, not a marsh: under 2% of the land is under river water, and some of it is more than a metre deep.
    expect(wet / land).toBeGreaterThan(0.001); expect(wet / land).toBeLessThan(0.02); expect(deep).toBeGreaterThan(0);
    // The sea is water at 0 wherever no river runs, and the bank beside a river stands dry.
    expect(waterAt(w, 3 * CELL + 100, 100)).toBe(0);
    // Stones and places are laid on the bundled coarse ground (WORLD), and stay out of its rivers.
    for (const t of TRAILS.values()) for (const s of t.stones) expect(dry(WORLD, s.x, s.z)).toBe(true);
    for (const ps of POIS.values()) for (const p of ps) expect(dry(WORLD, p.x, p.z)).toBe(true);
  });
});

describe("the weather", () => {
  test("it never rains in the desert, it rains in the rainforest, snow only where it is cold, mist in the wet lowlands at dawn", () => {
    const hours = Array.from({ length: 300 }, (_, i) => i * 37);
    expect(hours.every((t) => weather(t, "desert").rain === 0)).toBe(true);
    expect(hours.some((t) => weather(t, "rainforest").rain > 0.5)).toBe(true);
    expect(hours.every((t) => weather(t, "rainforest").snow === 0 && weather(t, "tundra").rain === 0)).toBe(true);
    expect(hours.some((t) => weather(t, "tundra").snow > 0.5)).toBe(true);
    expect(weather(0, "swamp", 6.5).mist).toBeGreaterThan(0.7);
    expect(weather(0, "swamp", 14).mist).toBe(0);
    expect(weather(0, "desert", 6.5).mist).toBeLessThan(0.3);
  });
});

describe("the day", () => {
  test("the sun climbs to noon and sets; the night is dark but never black, and the haze draws in", () => {
    const noon = daylight(0, 12), dusk = daylight(0, 18.3), night = daylight(0, 1);
    expect(noon.sun[1]).toBeGreaterThan(0.9);
    expect(noon.night).toBe(0);
    expect(dusk.sun[1]).toBeLessThan(0.1);
    expect(night.sun[1]).toBeLessThan(0);
    expect(night.night).toBe(1);
    expect(night.sunlight).toBeGreaterThan(0.1);
    expect(night.ambient).toBeLessThan(noon.ambient);
    expect(night.fogFar).toBeLessThan(noon.fogFar);
    expect(daylight(0).hour).toBe(8);
    for (let t = 0; t < 600; t += 7) { const v = wind(t); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
  });
});

describe("wild food", () => {
  test("every biome grows one thing; the Pine Barrens' patches are blueberries on dry ground, picked once, and they feed the line-up", () => {
    for (const g of REGIONS) expect(FORAGE[g.biome]).toBeDefined();
    const me = spawn(1), near = forageNear(w, me.x, me.z, 400, open);
    expect(near.length).toBeGreaterThan(2);
    for (const p of near) { expect(p.name).toBe("Highbush blueberries"); expect(heightAt(w, p.x, p.z)).toBeGreaterThan(0.5); expect(regionAt(p.x, p.z)?.n).toBe(1); }
    // Nothing grows on ground you can't walk yet.
    expect(forageNear(w, arenaOf(REGIONS[2]!).x, arenaOf(REGIONS[2]!).z, 400, openRegions(new Set()))).toEqual([]);
    const picked = new Map<string, number>(), p = near[0]!;
    expect(pick(p, picked, 10)).toBe(true);
    expect(bare(p, picked, 11)).toBe(true);
    expect(pick(p, picked, 11)).toBe(false);
    expect(pick(p, picked, 10 + REGROW)).toBe(true);
    // A quarter of their health back to whoever is hurt, and a downed one gets up.
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    wound(j.party[0]!, 0.5); wound(j.party[1]!, 0);
    expect(mend(j, FORAGE_MEND)).toBe(2);
    expect(j.party.map((m) => m.hp)).toEqual([0.75, 0.25, undefined]);
  });
});

describe("birds", () => {
  test("crows roost in the pines; walk into them and they fly off away from you, and settle further on", () => {
    const me = spawn(1), flocks = flocksNear(w, me.x, me.z, 500, open);
    expect(flocks.length).toBeGreaterThan(1);
    const f = flocks[0]!;
    expect(f.kind).toBe("crows");
    expect(f.n).toBeGreaterThanOrEqual(BIRDS.crows.n[0]);
    // Roosting: on the ground, each a step or two from the others.
    const down = birdAt(f, 0, null, 0, 0);
    expect(down.down).toBe(true); expect(down.h).toBe(0); expect(Math.hypot(down.dx, down.dz)).toBeLessThan(5);
    // Flushed from the south-west: they fly north-east, up and then down.
    const from = { x: f.x - 10, z: f.z - 10 }, heading = flushHeading(f, from);
    expect(Math.cos(heading)).toBeGreaterThan(0); expect(Math.sin(heading)).toBeGreaterThan(0);
    const mid = birdAt(f, 0, BIRDS.crows.air / 2, heading, 3);
    expect(mid.down).toBe(false); expect(mid.h).toBeGreaterThan(4);
    expect(Math.hypot(mid.dx, mid.dz)).toBeGreaterThan(10);
    const landed = birdAt(f, 0, BIRDS.crows.air + 1, heading, 9), roost = landing(f, heading);
    expect(landed.down).toBe(true);
    expect(Math.hypot(f.x + landed.dx - roost.x, f.z + landed.dz - roost.z)).toBeLessThan(5);
    expect(Math.hypot(roost.x - f.x, roost.z - f.z)).toBeCloseTo(FLIGHT, 5);
    // Next time, the flock is where it landed.
    const again = flocksNear(w, roost.x, roost.z, 30, open, new Map([[f.id, roost]]));
    expect(again.find((g) => g.id === f.id)).toMatchObject({ x: roost.x, z: roost.z });
  });
});

describe("what grows", () => {
  test("every biome's plants are kinds we draw, their shares add up, and every biome has grass", () => {
    for (const g of REGIONS) {
      const spec = FLORA[g.biome], sum = spec.kinds.reduce((a, k) => a + k[1], 0);
      expect(spec.kinds.every((k) => (KINDS as readonly string[]).includes(k[0]) && k[2] <= k[3])).toBe(true);
      expect(Math.abs(sum - 1)).toBeLessThan(0.06);
      expect(TURF[g.biome].cover).toBeGreaterThan(0);
    }
  });
});
