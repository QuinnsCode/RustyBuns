import { describe, expect, test } from "bun:test";
import ground from "../src/world/ground.json";
import { REGIONS } from "../src/regions.ts";
import { GRID, PLACES } from "../src/world/places.ts";
import { arenaOf, buildWorld, CELL, cell, heightAt, spawn, walk, type WalkEvent, type Walker } from "../src/world/world.ts";

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
const region = (n: number) => REGIONS.find((g) => g.n === n)!;
const centre = (n: number) => arenaOf(region(n));

describe("the supercontinent", () => {
  test("every region has its own cell on the grid, and each arena stands on dry ground", () => {
    expect(REGIONS.every((g) => PLACES[g.n] !== undefined)).toBe(true);
    expect(new Set(REGIONS.map((g) => cell(g).join())).size).toBe(64);
    for (const g of REGIONS) expect(cell(g)[0] >= 0 && cell(g)[0] < GRID.w && cell(g)[1] >= 0 && cell(g)[1] < GRID.h).toBe(true);
    const w = buildWorld(ground);
    for (const g of REGIONS.filter((x) => x.tier !== "coming-soon")) expect(heightAt(w, centre(g.n).x, centre(g.n).z)).toBeGreaterThan(0);
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
    expect(go(me, centre(3).x, centre(3).z, [1])).toContainEqual({ kind: "enter", region: region(3) });
    // East of the Pine Barrens is Iceland: on the map, coming soon.
    const east = spawn(1);
    expect(go(east, centre(1).x + CELL, east.z, [1]).at(-1)).toMatchObject({ kind: "blocked", why: "soon" });
    // Win the Bayou and the south opens; walk in and the wild creatures come.
    const south = spawn(7);
    const evs = go(south, centre(10).x, centre(10).z, [1, 7]);
    expect(evs.find((e) => e.kind === "enter")).toMatchObject({ region: { n: 10, tier: "high-level" } });
    expect(evs.some((e) => e.kind === "wild")).toBe(true);
    expect(south.home).toBe(7);
  });
});
