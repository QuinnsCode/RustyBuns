import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import coarse from "../src/world/coarse.json";
import { newJourney, mend, wound } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { FLORA, GROWN, KINDS, LATER, TURF } from "../src/world/flora.ts";
import { existsSync } from "node:fs";
import { bare, FORAGE, FORAGE_MEND, forageNear, pick, REGROW, weather, wind } from "../src/world/nature.ts";
import { arenaOf, buildWorld, CELL, depthAt, detailAt, dry, groundFrom, heightAt, openRegions, ownerAt, refine, regionAt, riverAt, spawn, waterAt } from "../src/world/world.ts";
import { POIS } from "../src/world/poi.ts";
import { TRAILS, WORLD } from "../src/world/trail.ts";

const w = buildWorld(coarse);
for (const g of REGIONS) refine(w, g.n, groundFrom(readFileSync(new URL(`../public/ground/${g.n}.bin`, import.meta.url))));
const open = openRegions(new Set([1, 2, 3, 4, 5, 6, 7, 8]));

describe("a bigger, rougher world", () => {
  test("a region is an hour's walk across, and the mountains are ridged and rough where the plains roll", () => {
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

test("every plant grown in Blender has its spec and its model, and grows in its own biome; the later ones are some of them", () => {
  const where = Object.fromEntries(Object.entries(FLORA).map(([b, f]) => [b, f.kinds.map((k) => k[0])]));
  const rows = GROWN.map((id) => {
    const spec = JSON.parse(readFileSync(`${import.meta.dir}/../flora/${id}.json`, "utf8")) as { biome: string };
    return { id, model: existsSync(`${import.meta.dir}/../public/models/flora/${id}.glb`), planted: (where[spec.biome] ?? []).includes(id) };
  });
  expect(rows).toEqual(GROWN.map((id) => ({ id, model: true, planted: true })));
  expect(LATER.every((id) => GROWN.includes(id))).toBe(true);
});
