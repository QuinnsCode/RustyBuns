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

test("a being held sacred is never a fighter", () => {
  expect([...sacredIds]).toContain("skinwalker");
  for (const c of ROSTER) expect(sacredIds.has(c.id)).toBe(false);
});
