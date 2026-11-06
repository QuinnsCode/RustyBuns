import { expect, test } from "bun:test";
import { ALL_SKINS, fightSkin, REGIONS, sacredIds } from "../src/regions.ts";
import { ROSTER } from "../src/roster.ts";

test("the route is numbered in order, and only the built regions have an arena", () => {
  expect(REGIONS.map((r) => r.n)).toEqual(REGIONS.map((_, i) => i + 1));
  for (const r of REGIONS) expect(!!r.skin).toBe(r.tier !== "coming-soon");
});

test("every built region has a source-checked lore page, and only the built ones", () => {
  for (const r of REGIONS) {
    expect(!!r.lore).toBe(!!r.skin);
    if (r.lore) for (const v of [r.lore.legend, r.lore.from, r.lore.sacred, ...r.lore.sources]) expect(v.length).toBeGreaterThan(10);
  }
});

// Each fighter being a folk beast of its own region is roster.test.ts's job.
test("a being held sacred is never a fighter", () => {
  expect([...sacredIds]).toEqual(expect.arrayContaining(["skinwalker", "feathered-serpent", "alux", "ukuku", "encantado", "yacumama"]));
  for (const c of ROSTER) expect(sacredIds.has(c.id)).toBe(false);
});

test("the Pine Barrens' mythic fights in its lair, every other fight in the open", () => {
  const at = (id: string) => REGIONS.find((r) => r.id === id)!;
  const soon = REGIONS.find((r) => !r.skin)!;
  for (const [g, kind, skin] of [
    [at("pine-barrens"), "mythic", "pine-barrens-lair"],
    [at("pine-barrens"), "keeper", "pine-barrens"],
    [at("pine-barrens"), "wild", "pine-barrens"],
    [at("appalachian-hollows"), "mythic", "appalachian-hollows"],
    [soon, "mythic", "stadium"],
  ] as const) expect(fightSkin(g, kind)).toBe(skin);
  expect(ALL_SKINS["pine-barrens-lair"]).toMatchObject({ pocket: "pine-barrens-lair", ground: ALL_SKINS["pine-barrens"]!.ground });
});
