// The room's check of a den against the world (#3700, #3763): every kind of den the page walks into holds what the page
// draws there and stands where the page draws it, and a page that names another creature, level or place is not believed.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mythicOf, sections, SECTIONS } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { denNear, holds, landing } from "../src/net/dens.ts";
import table from "../src/net/dens.json";
import { denTable } from "../scripts/dens.ts";
import { HUNTS } from "../src/world/hunts.ts";
import { NIGHT } from "../src/tiers.ts";
import { bandAt, onTrailDen as asPage, trailhead, TRAILS, trailWilds, WORLD } from "../src/world/trail.ts";
import { ALL } from "../src/world/poi.ts";
import { arenaOf, openRegions, spawn, wildsNear } from "../src/world/world.ts";

setDefaultTimeout(20_000);
const open = new Set(REGIONS.map((g) => g.n));
const playable = REGIONS.filter((g) => g.tier === "playable");
const first = <T,>(xs: T[]): T => { if (!xs[0]) throw new Error("none found"); return xs[0]; };

describe("a den's creature and level, from the world's seed", () => {
  const g = playable[1]!, a = arenaOf(g), k = 2, sec = sections(g)[k]!, hunt = first([...HUNTS.values()]);
  const wilds = wildsNear(WORLD, a.x + 900, a.z, 0, open, 600);
  const roaming = first(wilds.filter((c) => asPage(c).id === c.id)), onTrail = first(wilds.map(asPage).filter((c, i) => c.id !== wilds[i]!.id));
  const trail = first(trailWilds(a.x, a.z, 0, 8000).filter((c) => c.region === g.n).map(asPage).filter((c) => c.id));
  // After dark, a night one out on a trail: its own kind, a level above the section's wild ones (#3779).
  const dark = playable.flatMap((r) => { const c = arenaOf(r); return wildsNear(WORLD, c.x, c.z, 0, open, 3000, new Date(2026, 5, 1), true); });
  const night = first(dark.filter((c) => NIGHT.has(c.id) && TRAILS.has(c.region) && bandAt(c.x, c.z) > 1).map(asPage));
  const nightSec = sections(REGIONS[night.region - 1]!)[bandAt(night.x, night.z) - 1]!;
  test.each([
    ["a wild den, its region's pool", roaming.den, roaming.id, roaming.level],
    ["a wild den out on a trail", onTrail.den, onTrail.id, onTrail.level],
    ["a night one out on a trail", night.den, night.id, night.level],
    ["a trail section's den", trail.den, trail.id, trail.level],
    ["a keeper's stone", `keeper:${g.n}:${k}`, sec.keeper, sec.level],
    ["the arena's mythic", `mythic:${g.n}`, mythicOf(g).id, sections(g)[SECTIONS - 1]!.level],
    ["a contract's lair", `hunt:${hunt.id}`, hunt.creature, hunt.level],
  ])("%s", (_, den, id, lv) => {
    expect(holds(den, id, lv)).toBe(true);
    expect(holds(den, id, lv + 40)).toBe(false); // a wild den may be on any of its trail's bands, so not just any level off
    expect(holds(den, "not-a-creature", lv)).toBe(false);
  });

  // Standing where the page starts the fight: by the stone, the arena's marker, the trail den, the lair, the wild one.
  const pose = (x: number, z: number) => ({ r: g.n, x: Math.round(x * 10), z: Math.round(z * 10) });
  const stone = TRAILS.get(g.n)!.stones[k]!;
  test.each([
    ["a wild den", roaming.den, roaming],
    ["a keeper's stone", `keeper:${g.n}:${k}`, stone],
    ["the arena", `mythic:${g.n}`, a],
    ["a trail section's den", trail.den, trail],
    ["a contract's lair", `hunt:${hunt.id}`, hunt.lair],
  ])("%s: near where it stands, not from across the region", (_, den, at) => {
    expect(denNear(den, pose(at.x + 3, at.z))).toBe(true);
    expect(denNear(den, pose(at.x + 1500, at.z))).toBe(false);
  });

  test("every trail den is believed wherever it circles, at any hour", () => {
    const missed: string[] = [];
    for (let t = 0; t < 7200; t += 300) for (const w of trailWilds(0, 0, t, 1e9)) if (!denNear(w.den, { r: w.region, x: Math.round(w.x * 10), z: Math.round(w.z * 10) })) missed.push(`${w.den}@${t}`);
    expect(missed).toEqual([]);
  });

  test("travel lands you where the room knows, in a region you have opened: an arena's doorstep, a trailhead or beside a campfire", () => {
    // Every spot the game jumps you to (travel, a loss, fast travel), in every region: believed once the save has opened
    // that region, and not while it is still shut (a new save has only the first).
    const spots = [
      ...REGIONS.map((r) => ({ n: r.n, ...spawn(r.n) })),
      ...[...TRAILS.keys()].flatMap((n) => Array.from({ length: SECTIONS }, (_, k) => trailhead(n, k)).flatMap((p) => (p ? [{ n, ...p }] : []))),
      ...ALL.filter((p) => p.kind === "fire").map((p) => ({ n: p.n, x: p.x + 2, z: p.z })),
    ];
    const all = [...openRegions(new Set(REGIONS.map((r) => r.n)))], fresh = [...openRegions(new Set())];
    expect(fresh).toEqual([1]);
    const at = (s: (typeof spots)[number]) => pose(s.x, s.z);
    expect(spots.filter((s) => !landing(at(s), all)).map((s) => `${s.n}:${s.x},${s.z}`)).toEqual([]);
    expect(spots.filter((s) => s.n !== 1 && landing(at(s), fresh)).map((s) => `${s.n}:${s.x},${s.z}`)).toEqual([]);
    expect(landing(pose(stone.x + 300, stone.z), all)).toBe(false); // out on the trail (a trailhead is a few metres short of its stone)
  });

  test("a night one out on a trail stands above the section's own wild ones", () => {
    expect(night.level).toBeGreaterThan(nightSec.level + 1); // the section's own are at its level or one up
  });

  test("a den the world has no one in holds nothing", () => {
    expect(holds("0,0", roaming.id, roaming.level)).toBe(false); // the sea off the north-west corner
    expect(holds("hunt:9.1.1", hunt.creature, hunt.level)).toBe(false);
    expect(holds(`keeper:${g.n}:40`, sec.keeper, sec.level)).toBe(false);
  });

  test("src/net/dens.json is the world's now (rerun bun scripts/dens.ts)", () => {
    expect(denTable()).toEqual(table);
  });
});
