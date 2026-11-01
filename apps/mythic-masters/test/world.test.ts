import { describe, expect, test } from "bun:test";
import ground from "../src/world/ground.json";
import { REGIONS } from "../src/regions.ts";
import { GRID, PLACES } from "../src/world/places.ts";
import { creature, ROSTER } from "../src/roster.ts";
import { inSeason, tierOf, TIERED, TIER_LEVEL } from "../src/tiers.ts";
import { arenaOf, buildWorld, CELL, cell, COLS, detailAt, explore, explored, heightAt, meet, newSeen, openRegions, opensRoadTo, OWNER, ROWS, spawn, STEP, walk, wildsNear, type WalkEvent, type Walker } from "../src/world/world.ts";

/** Walks in 1 m steps toward (tx, tz), or until blocked; every event on the way. */
function go(me: Walker, tx: number, tz: number, beaten: number[]): WalkEvent[] {
  const out: WalkEvent[] = [], won = new Set(beaten);
  for (let i = 0; i < 6000; i++) {
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

  test("regions are ragged pieces of one continent, ringed by sea, and every built one can be reached", () => {
    // A piece spills past its grid cell somewhere: no region is a square block.
    const spills = new Set<number>();
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      const n = OWNER[r * COLS + c]!, g = n && region(n);
      if (g && (Math.floor((c * STEP) / CELL) !== cell(g)[0] || Math.floor((r * STEP) / CELL) !== cell(g)[1])) spills.add(n);
    }
    expect(spills.size).toBe(64);
    // The world's edge is sea all round.
    for (let c = 0; c < COLS; c++) expect(OWNER[c]! + OWNER[(ROWS - 1) * COLS + c]!).toBe(0);
    for (let r = 0; r < ROWS; r++) expect(OWNER[r * COLS]! + OWNER[r * COLS + COLS - 1]!).toBe(0);
    // Win every North American arena and all 16 built regions are open, none of the coming-soon ones.
    expect([...openRegions(new Set([1, 2, 3, 4, 5, 6, 7, 8]))].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  test("walking clears the map's fog, and it stays cleared", () => {
    const seen = newSeen(), me = spawn(1);
    expect(explore(seen, me.x, me.z)).toBeGreaterThan(0);
    const start = explored(seen, 1);
    for (let i = 0; i < 80; i++) { walk(me, -1, 0, new Set()); explore(seen, me.x, me.z); }
    expect(explored(seen, 1)).toBeGreaterThan(start);
    expect(explore(seen, me.x, me.z)).toBe(0);
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

describe("what opens a road", () => {
  test("the open arena beside a closed piece, the one you stand in first; nothing once it's open", () => {
    // From the Pine Barrens, before any win, the Great North Woods to the west waits on its arena.
    expect(opensRoadTo(region(3), new Set())?.n).toBe(1);
    // The Bayou borders both the Appalachians and the Great North Woods: the one you're in is the answer.
    expect(opensRoadTo(region(7), new Set([1]), 2)?.n).toBe(2);
    expect(opensRoadTo(region(7), new Set([1]), 3)?.n).toBe(3);
    expect(opensRoadTo(region(3), new Set([1]))).toBeUndefined();
  });
});

describe("roaming and collecting", () => {
  const w = buildWorld(ground);

  test("the ground between samples has its own hills, and every arena stands on a level pad", () => {
    // Over 200 m of the Great North Woods the fine detail lifts and drops the ground by metres, between samples 40 m apart.
    const a = centre(3), ds = Array.from({ length: 200 }, (_, i) => detailAt(w, a.x + 100 + i, a.z + 100, 5));
    expect(Math.max(...ds) - Math.min(...ds)).toBeGreaterThan(1);
    for (const n of [1, 2, 3, 6]) { const p = centre(n); expect(Math.abs(heightAt(w, p.x + 5, p.z) - heightAt(w, p.x, p.z - 5))).toBeLessThan(0.01); }
  });

  test("a walk: wild creatures of the region roam the open ground, and walking into one meets it", () => {
    // Nothing roams a region you can't enter yet, and the Pine Barrens is open from the start.
    const me = spawn(1), open = openRegions(new Set()), june = new Date(2026, 5, 1);
    const near = wildsNear(w, me.x, me.z, 0, open, 900, june);
    expect(near.length).toBeGreaterThan(2);
    expect(near.every((c) => c.region === 1 && creature(c.id).region <= 2 && c.level >= 1 && c.level <= 3 + TIER_LEVEL[tierOf(c.id)])).toBe(true);
    // Win the Pine Barrens arena and the Great North Woods fills with its own, stronger creatures.
    const woods = wildsNear(w, centre(3).x, centre(3).z, 0, openRegions(new Set([1])), 900, june).filter((c) => c.region === 3);
    expect(woods.length).toBeGreaterThan(2);
    expect(woods.every((c) => c.level >= 5)).toBe(true);
    // Walk up to one: it's met once you're close; a calm den isn't.
    const c = near[0]!;
    Object.assign(me, { x: c.x + 2, z: c.z });
    expect(meet(me, near, new Set())?.den).toBe(c.den);
    expect(meet(me, near, new Set([c.den]))).toBeUndefined();
  });

  test("tiers: every listed creature exists; commons turn up most, and an event creature roams only in its season", () => {
    const ids = new Set(ROSTER.map((c) => c.id));
    expect(TIERED.filter((id) => !ids.has(id))).toEqual([]);
    const count: Record<string, number> = {};
    for (const n of [1, 2, 3]) for (const c of wildsNear(w, centre(n).x, centre(n).z, 0, openRegions(new Set([1, 2, 3, 4, 5, 6, 7, 8])), 2500, new Date(2026, 5, 1)))
      count[tierOf(c.id)] = (count[tierOf(c.id)] ?? 0) + 1;
    expect(count.common ?? 0).toBeGreaterThan(count.legendary ?? 0);
    expect(inSeason("yule-cat", new Date(2026, 11, 24))).toBe(true);
    expect(inSeason("yule-cat", new Date(2026, 6, 4))).toBe(false);
    expect(inSeason("jackalope", new Date(2026, 6, 4))).toBe(true);
  });
});

describe("trailheads", () => {
  test("every trailhead and trail point stands on dry ground", async () => {
    const { TRAILS, WORLD, trailhead } = await import("../src/world/trail.ts");
    const { heightAt } = await import("../src/world/world.ts");
    for (const t of TRAILS.values()) {
      for (const p of [...t.pts, ...t.stones]) expect(heightAt(WORLD, p.x, p.z)).toBeGreaterThan(0.3);
      for (let done = 0; done < 12; done++) { const h = trailhead(t.n, done)!; expect(heightAt(WORLD, h.x, h.z)).toBeGreaterThan(0.3); }
    }
  });
});
