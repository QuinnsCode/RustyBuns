import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import coarse from "../src/world/coarse.json";
import { REGIONS } from "../src/regions.ts";
import { GRID, PLACES } from "../src/world/places.ts";
import { creature, ROSTER } from "../src/roster.ts";
import { inSeason, NIGHT, tierOf, TIERED, TIER_LEVEL } from "../src/tiers.ts";
import { holds } from "../src/net/dens.ts";
import type { Gait } from "../src/world/world.ts";
import { lightFire, POIS, shelterAt, SHELTER_R } from "../src/world/poi.ts";
import { BOSS_EVERY, CATCH_FAR, CATCH_NEAR, DARK_LEN, darkSounds, HUSH_R, GAP, HOUSES, LANTERN_OUT, SWEEP, glow, lantern, lightsNear, nightOf, safePaths, stalk, toSafety } from "../src/world/night.ts";
import { DAY } from "../src/world/nature.ts";
import { arenaOf, groundFrom, buildWorld, CELL, cell, COLS, detailAt, dry, explore, explored, heightAt, meet, NIGHT_MEET_R, newSeen, openRegions, opensRoadTo, OWNER, refine, ROWS, spawn, STEP, walk, wildsNear, type WalkEvent, type Walker } from "../src/world/world.ts";

/** The world with every region's fine ground in, as it stands once you have walked everywhere. */
function fullWorld() {
  const w = buildWorld(coarse);
  for (const g of REGIONS) refine(w, g.n, groundFrom(readFileSync(new URL(`../public/ground/${g.n}.bin`, import.meta.url))));
  return w;
}

/** Walks in 3 m steps (a running stride) toward (tx, tz), or until blocked; every event on the way. */
function go(me: Walker, tx: number, tz: number, beaten: number[]): WalkEvent[] {
  const out: WalkEvent[] = [], won = new Set(beaten);
  for (let i = 0; i < 8000; i++) {
    const dx = tx - me.x, dz = tz - me.z, d = Math.hypot(dx, dz), step = Math.min(3, d) / Math.max(1e-6, d);
    if (d < 0.5) break;
    const ev = walk(me, dx * step, dz * step, won);
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
    const w = fullWorld();
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
  const w = fullWorld();

  test("the ground between samples has its own hills, and every arena stands on a level pad", () => {
    // Over 200 m of the Great North Woods the fine detail lifts and drops the ground by metres, between samples 200 m apart.
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

describe("night (#3773)", () => {
  const w = fullWorld();
  test("the night ones roam only after dark, the room believes them, and a lit campfire, a cabin or the arena's ring is shelter", () => {
    const all = openRegions(new Set([1, 2, 3, 4, 5, 6, 7, 8])), june = new Date(2026, 5, 1);
    const out = (night: boolean) => [1, 2, 3, 5, 6, 7].flatMap((n) => wildsNear(w, centre(n).x, centre(n).z, 0, all, 2500, june, night));
    expect(out(false).filter((c) => NIGHT.has(c.id))).toEqual([]);
    const after = out(true).filter((c) => NIGHT.has(c.id));
    expect(new Set(after.map((c) => c.id)).size).toBeGreaterThanOrEqual(4);
    for (const c of after) expect([c.den, holds(c.den, c.id, c.level)]).toEqual([c.den, true]);
    // Out in the open after dark they come at you from further off.
    const me = { ...spawn(1) }, c = after[0]!;
    Object.assign(me, { x: c.x + 6, z: c.z });
    expect(meet(me, [c], new Set())).toBeUndefined();
    expect(meet(me, [c], new Set(), NIGHT_MEET_R)?.den).toBe(c.den);
    // A fire you have lit is shelter while you stand in its light; an unlit one isn't.
    const j = { found: [] as string[], fires: [] as string[], sights: [] as string[] }, fire = POIS.get(1)!.find((p) => p.kind === "fire")!, at = { x: fire.x + SHELTER_R - 2, z: fire.z };
    expect(shelterAt(j, at)).toBeUndefined();
    lightFire(j, fire);
    expect(shelterAt(j, at)?.id).toBe(fire.id);
    expect(shelterAt(j, { x: fire.x + SHELTER_R * 2, z: fire.z })).toBeUndefined();
    // A cabin is shelter lit or not, three to a region down its trail; so is the ring round the arena (#3779).
    const cabins = POIS.get(1)!.filter((p) => p.kind === "cabin"), arena = arenaOf(REGIONS[0]!);
    expect(cabins.map((p) => p.k)).toEqual([2, 4, 6]);
    expect(shelterAt(j, { x: cabins[0]!.x + 5, z: cabins[0]!.z })?.id).toBe(cabins[0]!.id);
    expect(shelterAt(j, { x: arena.x, z: arena.z + 10 })?.id).toBe("arena:1");
  });
});

describe("safe paths at night", () => {
  test("a few lit paths join tonight's safe houses; off them something catches you in 10 to 30 seconds, and on one it fades", () => {
    const nt = safePaths(1, 3), ids = new Set(nt.houses.map((h) => h.id));
    expect(nt.houses).toHaveLength(HOUSES + 4); // the arena, the three cabins and tonight's fires
    expect(nt.paths).toHaveLength(nt.houses.length - 1); // one tree: every house reached, no loops
    expect(new Set(nt.paths.flatMap((q) => [q.from, q.to]))).toEqual(ids);
    expect(safePaths(1, 3)).toEqual(nt); // the same night is the same for the whole party
    expect(safePaths(1, 4).houses.map((h) => h.id)).not.toEqual(nt.houses.map((h) => h.id)); // the next night, other houses
    // A night is one night from dusk to dawn: its number turns over at noon, not midnight.
    expect(nightOf(DAY * 0.45)).toBe(nightOf(DAY * 0.7)); // 18:48 and 00:48 the same night
    // On a path (or a light beside it) is safe; out in the dark is not.
    const path = nt.paths[0]!, mid = path.pts[Math.floor(path.pts.length / 2)]!;
    expect(toSafety(nt, ...mid)).toBe(0);
    for (const [x, z] of lightsNear(nt, ...mid, 60).slice(0, 6)) expect(toSafety(nt, x, z)).toBe(0);
    // Out in the open it catches you: 10 s far out, 30 s at the edge of the lights.
    const until = (d: number) => { let st = 0, t = 0; while (st < 1) { st = stalk(st, 0.1, d); t += 0.1; } return t; };
    expect(until(400)).toBeCloseTo(CATCH_FAR, 0);
    expect(until(1)).toBeGreaterThan(CATCH_NEAR - 1);
    expect(stalk(0.5, 1, 0)).toBeLessThan(0.5); // back on a path it fades
  });

  test("the dark's sounds: a heartbeat with no fire near, harder off the lights and as it stalks you; the crickets hush as a night one closes in", () => {
    const far = HUSH_R + 50;
    // [dark, by a fire, metres from the lights, dread, metres to the nearest night one] -> what you hear
    const walk: [boolean, boolean, number, number, number][] = [
      [false, false, 50, 0, 5], // by day: nothing
      [true, true, 0, 0, far], // at a fire: no heartbeat
      [true, false, 0, 0, far], // on the lights
      [true, false, 30, 0, far], // off them
      [true, false, 30, 0.8, far], // something following
    ];
    const heard = walk.map((w) => darkSounds(...w));
    expect(heard[0]).toEqual({ heart: 0, near: 0 });
    expect(heard[1]!.heart).toBe(0);
    expect(heard[2]!.heart).toBeGreaterThan(0);
    expect(heard[3]!.heart).toBeGreaterThan(heard[2]!.heart);
    expect(heard[4]!.heart).toBeGreaterThan(heard[3]!.heart);
    // One of the six closing in: the hush grows with it, even heard from a fire's edge, and the heart races on the path.
    const near = [far, HUSH_R * 0.75, HUSH_R * 0.25, 2].map((d) => darkSounds(true, false, 0, 0, d));
    expect(near.map((n) => n.near)).toEqual([...near.map((n) => n.near)].sort((a, b) => a - b));
    expect(near[0]!.near).toBe(0);
    expect(near[3]!.near).toBe(1);
    expect(near[3]!.heart).toBe(1);
    expect(darkSounds(true, true, 0, 0, 25).near).toBeGreaterThan(0);
  });

  test("the boss night: the dark rolls down a path, a runner keeps ahead of it and a walker is caught in it", () => {
    const nights = Array.from({ length: BOSS_EVERY * 2 }, (_, k) => safePaths(1, k));
    expect(nights.filter((nt) => nt.boss)).toHaveLength(2); // one night in BOSS_EVERY
    const nt = nights.find((q) => q.boss)!, calm = nights.find((q) => !q.boss)!;
    const p = nt.paths.reduce((a, b) => (b.at.at(-1)! > a.at.at(-1)! ? b : a)), len = p.at.at(-1)!;
    expect(len).toBeGreaterThan(200);
    const where = (s: number): [number, number] => {
      const i = Math.max(1, p.at.findIndex((a) => a >= s)), u = (s - p.at[i - 1]!) / (p.at[i]! - p.at[i - 1]! || 1);
      return [p.pts[i - 1]![0] + (p.pts[i]![0] - p.pts[i - 1]![0]) * u, p.pts[i - 1]![1] + (p.pts[i]![1] - p.pts[i - 1]![1]) * u];
    };
    // The moment the dark sets off from the path's start, you are 30 m along it: then you walk, or run, for the far house.
    const loop = len + DARK_LEN + GAP, t0 = ((((-p.phase * loop) % loop) + loop) % loop) / SWEEP;
    const unsafe = (pace: number) => { let n = 0; for (let t = 0; 30 + pace * t < len - 30; t += 0.25) if (toSafety(nt, ...where(30 + pace * t), t0 + t) > 0) n++; return n; };
    expect(unsafe(5)).toBe(0); // a run (PACE.run) outpaces it
    expect(unsafe(1.5)).toBeGreaterThan(8); // a walk doesn't: the path goes out under your feet
    // Before it comes, the lights just ahead flicker; on any other night they never do.
    const ahead = Array.from({ length: 40 }, (_, k) => glow(nt, p, 10, t0 + k * 0.05));
    expect(Math.min(...ahead)).toBeLessThan(1);
    expect(Math.max(...ahead)).toBe(1);
    for (const [, , k, at] of lightsNear(calm, ...calm.paths[0]!.pts[0]!, 200)) expect(glow(calm, calm.paths[k]!, at, t0)).toBe(1);
  });

  test("the first night: Gary's lantern burns while he walks, catches and dies a few times when he's taken, then stays dark", () => {
    expect(lantern(-1)).toBe(1);
    const out = Array.from({ length: Math.ceil(LANTERN_OUT * 20) }, (_, k) => lantern(k / 20));
    expect(out.filter((k) => k === 0).length).toBeGreaterThan(3); // it gutters,
    expect(out.slice(out.indexOf(0)).some((k) => k > 0.3)).toBe(true); // catches again,
    expect(lantern(LANTERN_OUT)).toBe(0); // and is out for good
    expect(lantern(LANTERN_OUT + 5)).toBe(0);
  });

  test("a night path keeps to dry ground: round a river and a bay, never across the sea to an island's fire", async () => {
    const { WORLD } = await import("../src/world/trail.ts");
    const paths = REGIONS.flatMap((g) => [0, 1, 2].flatMap((night) => safePaths(g.n, night).paths.map((p) => p.pts.slice(1, -1))));
    const wet = paths.map((pts) => pts.filter(([x, z]) => !dry(WORLD, x, z)).length / pts.length);
    expect(Math.max(...wet)).toBeLessThan(0.15); // a ford over a river, not half a path over the sea (region 3's island house)
    expect(wet.reduce((s, w, i) => s + w * paths[i]!.length, 0) / paths.flat().length).toBeLessThan(0.002); // was 1 in 20, then 1 in 75
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

describe("beast travel", () => {
  test("Mothman's hollows stay shut until a flier is in the line-up; the Jersey Devil is one", async () => {
    const { creature } = await import("../src/roster.ts");
    const { gateShut, openRegions, setTravel } = await import("../src/world/world.ts");
    const { REGIONS } = await import("../src/regions.ts");
    const beaten = new Set([1]), hollows = REGIONS[1]!;
    try {
      setTravel([creature("hodag"), creature("squonk"), creature("jackalope")]);
      expect(openRegions(beaten).has(2)).toBe(false);
      expect(gateShut(hollows, beaten)?.needs).toBe("flier");
      expect(openRegions(beaten).has(3)).toBe(true); // the other road from the Pine Barrens is not gated
      setTravel([creature("hodag"), creature("squonk"), creature("jersey-devil")]);
      expect(openRegions(beaten).has(2)).toBe(true);
      expect(gateShut(hollows, beaten)).toBeUndefined();
    } finally { setTravel(null); }
    expect(openRegions(beaten).has(2)).toBe(true); // bots and the sim never see a gate
  });

  test("the south opens to a swimmer, the Andes to a flier as well, and you can walk on where you stand", async () => {
    const { creature } = await import("../src/roster.ts");
    const { arenaOf, openRegions, setTravel, spawn, walk } = await import("../src/world/world.ts");
    const { REGIONS } = await import("../src/regions.ts");
    const beaten = new Set([1, 2, 3, 5, 7, 8]); // the Bayou and the Ozarks border Mexico, Yucatán and (through the hollows) the Caribbean
    const south = [9, 10, 11, 12, 14, 15, 16];
    try {
      setTravel([creature("hodag"), creature("jersey-devil")]);
      expect(south.filter((n) => openRegions(beaten).has(n))).toEqual([]);
      setTravel([creature("champ"), creature("hodag")]);
      expect(south.filter((n) => openRegions(beaten).has(n))).toEqual(south);
      expect(openRegions(beaten).has(13)).toBe(false);
      setTravel([creature("lizard-man"), creature("jersey-devil")]);
      expect(openRegions(beaten).has(13)).toBe(true);
      // Swap the swimmer out while in Mexico: you can still walk Mexico, but not on into Yucatán.
      setTravel([creature("hodag")]);
      const me = spawn(9), a = arenaOf(REGIONS[8]!);
      expect(walk(me, 5, 0, beaten).some((e) => e.kind === "blocked")).toBe(false);
      expect(Math.hypot(me.x - a.x - 5, me.z - (a.z + 12))).toBeLessThan(1e-6);
    } finally { setTravel(null); }
  });

  test("a swimmer swims the water a wade would slow, a flier glides a slope, and nothing outruns the streaming", async () => {
    const { creature } = await import("../src/roster.ts");
    const { pace, PACE_MAX, setTravel } = await import("../src/world/world.ts");
    try {
      const rows: [string[], boolean, number, number, Gait, number][] = [
        // line-up, dash, depth, slope, gait, pace for 8 m/s walking, 16 running
        [["hodag"], false, 0, 0, "walk", 8],
        [["hodag"], false, 0.6, 0, "wade", 3.6],
        [["champ"], false, 0.6, 0, "swim", 10],
        [["hodag"], false, 0, -0.3, "walk", 8],
        [["jersey-devil"], false, 0, -0.3, "glide", 12],
        [["jersey-devil"], false, 0, 0.3, "walk", 8],
        [["jersey-devil"], true, 0, -0.3, "glide", PACE_MAX],
      ];
      for (const [party, dash, depth, slope, gait, v] of rows) {
        setTravel(party.map(creature));
        expect({ party, ...pace(dash ? 16 : 8, depth, slope) }).toEqual({ party, v, gait });
      }
    } finally { setTravel(null); }
  });
});
