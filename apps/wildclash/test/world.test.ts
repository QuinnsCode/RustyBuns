import { describe, expect, test } from "bun:test";
import { SKINS } from "../src/arena.ts";
import ground from "../src/world/ground.json";
import { GRID, REGIONS, region } from "../src/world/regions.ts";
import { arenaOf, buildWorld, CELL, heightAt, spawn, walk, type WalkEvent, type Walker } from "../src/world/world.ts";

/** Walks in 1 m steps toward (tx, tz), or until blocked; every event on the way. */
function go(me: Walker, tx: number, tz: number, beaten: number[]): WalkEvent[] {
  const out: WalkEvent[] = [], won = new Set(beaten);
  for (let i = 0; i < 2000; i++) {
    const dx = tx - me.x, dz = tz - me.z, d = Math.hypot(dx, dz);
    if (d < 0.5) break;
    const ev = walk(me, dx / Math.max(1, d), dz / Math.max(1, d), won);
    out.push(...ev);
    if (ev.some((e) => e.kind === "blocked")) break;
  }
  return out;
}
const centre = (n: number) => arenaOf(region(n)!);

describe("the supercontinent", () => {
  test("64 regions on their own cells, 8 playable, 8 high level, 48 coming soon, each arena dry ground in a known skin", () => {
    expect(REGIONS.map((g) => g.n)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
    expect(new Set(REGIONS.map((g) => g.cell.join())).size).toBe(64);
    for (const g of REGIONS) expect(g.cell[0] < GRID.w && g.cell[1] < GRID.h && SKINS[g.skin] !== undefined).toBe(true);
    expect(["playable", "high", "soon"].map((t) => REGIONS.filter((g) => g.tier === t).length)).toEqual([8, 8, 48]);
    const w = buildWorld(ground);
    for (const g of REGIONS.filter((x) => x.tier !== "soon")) expect(heightAt(w, centre(g.n).x, centre(g.n).z)).toBeGreaterThan(0);
  });

  test("a walk: the Pine Barrens arena opens the road west, the deadly south warns you off, coming-soon stays shut", () => {
    const me = spawn(1);
    // West to the Great North Woods: closed until the Pine Barrens arena is won.
    const shut = go(me, centre(3).x, me.z, []);
    expect(shut.at(-1)).toMatchObject({ kind: "blocked", why: "locked", region: { n: 3 } });
    // The arena marker starts a fight, once.
    expect(go(me, centre(1).x, centre(1).z, []).filter((e) => e.kind === "arena").map((e) => e.kind === "arena" && e.region.n)).toEqual([1]);
    expect(walk(me, 0.1, 0, new Set()).some((e) => e.kind === "arena")).toBe(false);
    // Won: the road west opens.
    expect(go(me, centre(3).x, centre(3).z, [1])).toContainEqual({ kind: "enter", region: region(3)! });
    // East of the Pine Barrens is Iceland: on the map, coming soon.
    const east = spawn(1);
    expect(go(east, centre(1).x + CELL, east.z, [1]).at(-1)).toMatchObject({ kind: "blocked", why: "soon" });
    // Win the Bayou and the south opens; walk in and the wild creatures come.
    const south = spawn(7);
    const evs = go(south, centre(10).x, centre(10).z, [1, 7]);
    expect(evs.find((e) => e.kind === "enter")).toMatchObject({ region: { n: 10, tier: "high" } });
    expect(evs.some((e) => e.kind === "wild")).toBe(true);
    expect(south.home).toBe(7);
  });
});
