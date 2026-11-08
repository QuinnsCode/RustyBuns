import { expect, test } from "bun:test";
import { ALL_SKINS, fightSkin, REGIONS, sacredIds } from "../src/regions.ts";
import { ROSTER } from "../src/roster.ts";
import { POCKETS, roomAt } from "../src/pockets.ts";
import { ARENA } from "../src/sim.ts";

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

test("every playable region's mythic fights in its own lair, every other fight in the open", () => {
  for (const g of REGIONS.filter((r) => r.tier === "playable")) {
    const lair = fightSkin(g, "mythic");
    expect(lair).toBe(`${g.id}-lair`);
    expect(ALL_SKINS[lair]).toMatchObject({ pocket: lair, ground: ALL_SKINS[g.id]!.ground });
    for (const kind of ["keeper", "wild"] as const) expect(fightSkin(g, kind)).toBe(g.id);
  }
  expect(fightSkin(REGIONS.find((r) => r.tier === "high-level")!, "mythic")).toBe(REGIONS.find((r) => r.tier === "high-level")!.id);
  expect(fightSkin(REGIONS.find((r) => !r.skin)!, "mythic")).toBe("stadium");
});

test("a lair's rooms open off its wall without running into each other", () => {
  for (const p of Object.values(POCKETS)) {
    const wall = ARENA.radius + p.walls.out, at = p.rooms.map((m) => ({ m, ...roomAt(m, wall) }));
    for (const [i, a] of at.entries()) for (const b of at.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(a.m.r + b.m.r);
  }
});
