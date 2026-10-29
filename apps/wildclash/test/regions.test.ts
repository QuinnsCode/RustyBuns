import { expect, test } from "bun:test";
import { REGIONS, sacredIds } from "../src/regions.ts";
import { ROSTER } from "../src/roster.ts";

test("the route: 8 playable, 8 high level, 48 coming soon, and only the 16 built ones have an arena", () => {
  expect(REGIONS.map((r) => r.n)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
  const count = (t: string) => REGIONS.filter((r) => r.tier === t).length;
  expect([count("playable"), count("high-level"), count("coming-soon")]).toEqual([8, 8, 48]);
  for (const r of REGIONS) expect(!!r.skin).toBe(r.tier !== "coming-soon");
  expect(REGIONS[0]).toMatchObject({ name: "Pine Barrens", block: "North America", folklore: [{ id: "jersey-devil", sacred: false }] });
  expect(REGIONS[63]!.block).toBe("Asia");
});

test("every built region has a source-checked lore page, and only the built ones", () => {
  for (const r of REGIONS) {
    expect(!!r.lore).toBe(!!r.skin);
    if (r.lore) for (const v of [r.lore.legend, r.lore.from, r.lore.sacred, ...r.lore.sources]) expect(v.length).toBeGreaterThan(10);
  }
});

test("a being held sacred is never a fighter", () => {
  expect([...sacredIds]).toEqual(expect.arrayContaining(["skinwalker", "feathered-serpent", "alux", "ukuku", "encantado"]));
  for (const c of ROSTER) expect(sacredIds.has(c.id)).toBe(false);
});
