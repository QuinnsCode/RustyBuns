import { describe, expect, test } from "bun:test";
import { tierOf } from "../src/tiers.ts";
import { bind, bindChance, call, clearSection, cleared, gainXp, loadJourney, mythicOf, newJourney, nextUp, PARTY_MAX, rest, slots, SECTIONS, sections, STARTERS, TRAIL_REGIONS } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { ROSTER } from "../src/roster.ts";
import { bandAt, newTrek, pointAt, trailhead, trailWilds, TRAILS, trek, type TrekEvent } from "../src/world/trail.ts";
import { rate } from "../scripts/tune.ts";
import { atLevel } from "../src/journey.ts";
import { creature } from "../src/roster.ts";
import { BAND, WORLD } from "../src/world/trail.ts";
import { COLS, heightAt, OWNER, STEP } from "../src/world/world.ts";
import { regionAt, spawn } from "../src/world/world.ts";

/** Walks region n's trail from where `me` stands to `s` metres along it, 1 m a step; every event, stopping at a gate. */
function hike(n: number, to: number, done: () => number, from = 0) {
  const t = TRAILS.get(n)!, p0 = from ? pointAt(t, from) : trailhead(n, 0)!, me = { ...spawn(n), x: p0.x, z: p0.z }, at = newTrek(me), ev: TrekEvent[] = [];
  for (let s = from; s <= to; s += 1) {
    const p = pointAt(t, s);
    const got = trek(me, at, p.x - me.x, p.z - me.z, new Set(), () => done());
    ev.push(...got);
    if (got.some((e) => e.kind === "blocked")) break;
  }
  return { me, at, ev };
}

describe("the journey", () => {
  test("you take three of the Bog Witch's five commons, all at level 5; the Pine Barrens' twelve end at the Jersey Devil", () => {
    expect(STARTERS.map((id) => ROSTER.find((c) => c.id === id)?.archetype)).toEqual(["tank", "skirmisher", "bruiser", "skirmisher", "skirmisher"]);
    expect(STARTERS.every((id) => tierOf(id) === "common")).toBe(true);
    const j = newJourney(["squonk", "tatzelwurm", "hodag"])!;
    expect(j.starter).toBe("squonk");
    expect(j.party).toEqual(["squonk", "tatzelwurm", "hodag"].map((id) => ({ id, level: 5, xp: 0 })));
    for (const bad of [["squonk", "hodag"], ["squonk", "squonk", "hodag"], ["squonk", "hodag", "mothman"]]) expect(newJourney(bad)).toBeNull();
    for (const g of TRAIL_REGIONS) {
      const secs = sections(g);
      expect(secs).toHaveLength(SECTIONS);
      expect(secs.at(-1)!.keeper).toBe(mythicOf(g).id);
      // every keeper and wild one is a real fighter, never a starter, and the levels only climb
      for (const s of secs) for (const id of [s.keeper, ...s.wilds]) expect(ROSTER.some((c) => c.id === id) && !STARTERS.some((x) => x === id)).toBe(true);
      expect(secs.every((s, k) => !k || s.level >= secs[k - 1]!.level)).toBe(true);
    }
    expect(sections(REGIONS[0]!).map((s) => s.name)).toContain("Leeds Point");
    expect(mythicOf(REGIONS[0]!).id).toBe("jersey-devil");
  });

  test("a hike: the first keeper stops you, the bog-light gate holds until it's beaten, the mythic only answers at the end", () => {
    const t = TRAILS.get(1)!, stone = (k: number) => t.stoneAt[k]!;
    let done = 0;
    // walk the trail toward the third stone: the first keeper meets you, then a gate shuts the third section
    const first = hike(1, stone(2), () => done);
    expect(first.ev.find((e) => e.kind === "keeper")).toMatchObject({ kind: "keeper", k: 0 });
    expect(first.ev.at(-1)).toMatchObject({ kind: "blocked", why: "gate" });
    expect(bandAt(first.me.x, first.me.z)).toBeLessThanOrEqual(2);
    // two keepers beaten: on to the third stone, whose keeper is next
    done = 2;
    const second = hike(1, stone(2) + 2, () => done);
    expect(second.ev.some((e) => e.kind === "blocked")).toBe(false);
    expect(second.ev.filter((e) => e.kind === "keeper").map((e) => e.kind === "keeper" && e.k)).toEqual([2]);
    expect(second.ev.filter((e) => e.kind === "section").length).toBeGreaterThanOrEqual(2);
    // eleven beaten: down the last stretch, into the arena and the Jersey Devil
    done = SECTIONS - 1;
    const last = hike(1, t.length, () => done, stone(SECTIONS - 2) + 4);
    expect(last.ev.some((e) => e.kind === "arena")).toBe(true);
    expect(regionAt(last.me.x, last.me.z)?.n).toBe(1);
  });

  test("every section before the arena has wild ones to bind", () => {
    for (const t of TRAILS.values()) {
      const bands = new Set(trailWilds(t.pts[0]!.x, t.pts[0]!.z, 0, 1e5).filter((c) => c.region === t.n).map((c) => bandAt(c.x, c.z)));
      for (let b = 1; b < SECTIONS; b++) expect([t.n, b, bands.has(b)]).toEqual([t.n, b, true]);
    }
  });

  test("binding: nothing above the line, likelier as it wears down, a mythic half as easy", () => {
    expect([bindChance(0.9, false), bindChance(0.5, false), bindChance(0.35, true)]).toEqual([0, 0, 0]);
    expect(bindChance(0.05, false)).toBeGreaterThan(bindChance(0.4, false));
    expect(bindChance(0.05, true)).toBeCloseTo(bindChance(0.05 * (0.45 / 0.3), false) / 2, 5);
  });

  test("the line-up holds three, a slot more per mythic beaten up to six, the journal the rest; a swap, a rest, the next one up", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    expect(slots(j)).toBe(3);
    expect(bind(j, "mothman", 4)).toBe("journal");
    // Beat the Jersey Devil (the Pine Barrens' last section) and the line-up gains its fourth slot.
    for (let k = 0; k < SECTIONS; k++) clearSection(j, 1, k);
    expect(slots(j)).toBe(4);
    expect(bind(j, "champ", 4)).toBe("party");
    expect(call(j, 0, 1)).toBe(true); // the mothman in for the squonk
    expect(j.party.map((m) => m.id)).toEqual(["hodag", "mothman", "jackalope", "champ"]);
    expect(j.journal.map((m) => m.id)).toEqual(["squonk"]);
    expect(nextUp(j, new Set([0, 1]))).toBe(2);
    expect(nextUp(j, new Set([0, 1, 2, 3]))).toBe(-1);
    for (const n of [2, 3, 4, 5, 6]) j.cleared[n] = SECTIONS;
    expect(slots(j)).toBe(PARTY_MAX);
    while (rest(j, 0));
    expect(j.party).toHaveLength(1); // the line-up keeps one
    expect(gainXp(j.party[0]!, 10)).toBeGreaterThan(0);
  });

  test("sections clear in order and write their pages; the save comes back as it went, and a broken one is no journey", () => {
    const j = newJourney(["jackalope", "hodag", "agropelter"])!;
    clearSection(j, 1, 3); // can't skip ahead
    expect(cleared(j, 1)).toBe(0);
    for (let k = 0; k < 3; k++) clearSection(j, 1, k);
    expect([cleared(j, 1), j.pages]).toEqual([3, ["1:0", "1:1", "1:2"]]);
    expect(loadJourney(JSON.stringify(j))).toEqual(j);
    for (const bad of [null, "{", '{"v":1}', JSON.stringify({ ...j, party: [] }), JSON.stringify({ ...j, cleared: { 1: 99 } })]) expect(loadJourney(bad)).toBeNull();
  });

  test("every region's twelve are even bands of land, each written by hand with its own place and fact", () => {
    for (const g of TRAIL_REGIONS) {
      const secs = sections(g), land = new Array<number>(SECTIONS).fill(0);
      for (let i = 0; i < BAND.length; i++) if (OWNER[i] === g.n && BAND[i] && WORLD.y[i]! > 0.3 && heightAt(WORLD, (i % COLS) * STEP, Math.floor(i / COLS) * STEP) > 0.3) land[BAND[i]! - 1]!++;
      expect([g.n, Math.max(...land) / Math.min(...land) < 1.2]).toEqual([g.n, true]);
      expect(new Set(secs.map((s) => s.name)).size).toBe(SECTIONS);
      expect(secs.every((s) => s.lore.length > 40 && !s.lore.includes("Nothing is written"))).toBe(true);
    }
  });

  test("the level-10 Jersey Devil is a wall for level-5 starters", () => {
    const devil = atLevel(creature("jersey-devil"), 10, true);
    const wins = STARTERS.map((id) => rate(atLevel(creature(id), 5), devil, 20).wins);
    expect(Math.max(...wins)).toBeLessThan(0.5);
  });
});
