import { expect, test } from "bun:test";
import { REGIONS, sacredIds } from "../src/regions.ts";
import { ROSTER } from "../src/roster.ts";

test("the route: 8 playable, 8 high level, 48 coming soon, and only the 16 built ones have an arena", () => {
  expect(REGIONS.map((r) => r.n)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
  const count = (t: string) => REGIONS.filter((r) => r.tier === t).length;
  expect([count("playable"), count("high-level"), count("coming-soon")]).toEqual([8, 8, 48]);
  for (const r of REGIONS) expect(!!r.skin).toBe(r.tier !== "coming-soon");
  expect(REGIONS[0]).toMatchObject({ name: "Pine Barrens", block: "North America", folklore: [{ id: "jersey-devil", sacred: false }] });
  const blocks = Object.entries(Object.groupBy(REGIONS, (r) => r.block)).map(([b, rs]) => [b, rs!.length]);
  expect(blocks).toEqual([["North America", 8], ["Central and South America", 8], ["Africa", 12], ["Europe", 16], ["Japan", 8], ["Asia", 8], ["Oceania", 4]]);
});

test("every built region has a source-checked lore page, and only the built ones", () => {
  for (const r of REGIONS) {
    expect(!!r.lore).toBe(!!r.skin);
    if (r.lore) for (const v of [r.lore.legend, r.lore.from, r.lore.sacred, ...r.lore.sources]) expect(v.length).toBeGreaterThan(10);
  }
});

test("every fighter is a folk beast from a region, and a being held sacred is never one", () => {
  const folk = new Set(REGIONS.flatMap((r) => r.folklore.filter((b) => !b.sacred).map((b) => b.id)));
  for (const c of ROSTER) expect(folk.has(c.id)).toBe(true);
  expect([...sacredIds]).toEqual(expect.arrayContaining(["skinwalker", "feathered-serpent", "alux", "ukuku", "encantado", "yacumama"]));
  for (const c of ROSTER) expect(sacredIds.has(c.id)).toBe(false);
});
