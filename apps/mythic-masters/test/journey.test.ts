import { describe, expect, test } from "bun:test";
import { tierOf } from "../src/tiers.ts";
import { bind, bindChance, call, heal, hpOf, MAULED, maul, wound, clearSection, cleared, gainXp, shareXp, loadJourney, mythicOf, newJourney, nextUp, OWN_MAX, PARTY_MAX, release, rest, slots, SECTIONS, sections, STARTERS, TRAIL_REGIONS, BOOK_PAGE, bookSays } from "../src/journey.ts";
import { REGIONS } from "../src/regions.ts";
import { creature, ROSTER } from "../src/roster.ts";
import { denHolds as holdsOf, holds } from "../src/net/dens.ts";
import { oppositeOf, preyOf, stir, stirOf } from "../src/released.ts";
import { bandAt, newTrek, pointAt, trailhead, trailWilds, TRAILS, trek, type TrekEvent } from "../src/world/trail.ts";
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
  test("you take three of the Book's five commons, all at level 5; the Pine Barrens' twelve end at the Jersey Devil", () => {
    expect(STARTERS.every((id) => tierOf(id) === "common")).toBe(true);
    const j = newJourney(["squonk", "tatzelwurm", "hodag"], 1000)!;
    expect(j.starter).toBe("squonk");
    expect(j.party).toEqual(["squonk", "tatzelwurm", "hodag"].map((id) => ({ id, level: 5, xp: 0, caught: { at: 1000, where: BOOK_PAGE, level: 5 } })));
    // a bind writes where and when the ink held, at the level it was then; the save keeps it, an old save does without
    expect(bind(j, "mothman", 9, "Point Pleasant, Appalachian hollows", 2000)).toBe("journal");
    expect(j.journal[0]).toEqual({ id: "mothman", level: 9, xp: 0, caught: { at: 2000, where: "Point Pleasant, Appalachian hollows", level: 9 } });
    expect(loadJourney(JSON.stringify(j))).toEqual(j);
    expect(loadJourney(JSON.stringify({ ...j, party: [{ id: "squonk", level: 5, xp: 0 }] }))?.party[0]?.caught).toBeUndefined();
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

  test("the line-up holds three, a slot more per mythic beaten up to five, the journal the rest; a swap, a rest, the next one up", () => {
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

  test("a win's XP: the beast that fought gets all of it, the rest of the line-up half (#5387)", () => {
    const j = newJourney(["jackalope", "hodag", "agropelter"])!;
    const [a, b, c] = j.party as [typeof j.party[0], typeof j.party[0], typeof j.party[0]];
    for (const m of j.party) { m.level = 50; m.xp = 0; } // far from the next level, so the XP stays readable
    expect(shareXp(j.party, b, 8)).toEqual([0, 0, 0]);
    expect([a.xp, b.xp, c.xp]).toEqual([40, 80, 40]);
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
});

describe("the Book holds nine; a released one changes its country (#3031)", () => {
  test("binds stop at nine until you release one; it is gone for good and remembered where it went; an old six-strong line-up keeps everyone", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    for (const id of ["mothman", "champ", "wampus-cat", "chupacabra", "sasquatch", "dover-demon"]) bind(j, id, 4);
    expect(j.party.length + j.journal.length).toBe(OWN_MAX);
    expect(bind(j, "snallygaster", 6)).toBe("full");
    expect(j.journal.some((m) => m.id === "snallygaster")).toBe(false);
    expect(j.seen).toContain("snallygaster"); // met, though the ink didn't take
    expect(release(j, "journal", 0, 1, 1000)?.id).toBe("mothman");
    expect(j.released).toEqual([{ id: "mothman", level: 4, n: 1, at: 1000 }]);
    expect(bind(j, "snallygaster", 6)).toBe("journal");
    while (release(j, "party", 0, 1));
    expect(j.party).toHaveLength(1); // the line-up keeps one
    // a save from before the cap: six in the line-up and twelve in all. The sixth rests, nobody is lost, and nothing more binds.
    const old = newJourney(["hodag", "squonk", "jackalope"])!;
    old.party.push(...["mothman", "champ", "wampus-cat"].map((id) => ({ id, level: 9, xp: 0 })));
    old.journal.push(...["a", "b", "c", "d", "e", "f"].map((id) => ({ id, level: 9, xp: 0 })));
    const back = loadJourney(JSON.stringify(old))!;
    expect([back.party.length, back.journal.length, back.journal[0]!.id]).toEqual([PARTY_MAX, 7, "wampus-cat"]);
    expect(bind(back, "champ", 3)).toBe("full");
  });

  test("a strong one let go in a weak region lifts its wild ones; a hunter thins out its prey, and the kind opposite it less", () => {
    const kindOf = (id: string) => creature(id).archetype;
    const flyer = ROSTER.find((c) => c.archetype === "flyer")!, prey = ROSTER.filter((c) => c.archetype === preyOf("flyer")), opp = ROSTER.filter((c) => c.archetype === oppositeOf("flyer"));
    expect(stirOf([{ id: flyer.id, level: 30, n: 1, at: 0 }], 2, kindOf)).toEqual({ lift: 0, thin: {} }); // another region's
    const s = stirOf([{ id: flyer.id, level: 30, n: 1, at: 0 }], 1, kindOf);
    expect(s.lift).toBe(4);
    expect(stirOf([{ id: flyer.id, level: 3, n: 1, at: 0 }], 1, kindOf).lift).toBe(0); // a weak one lifts nothing
    // over many dens: about a third of the prey's stand empty, a fifth of the opposite kind's, none of the rest; the rest lift
    const dens = Array.from({ length: 2000 }, (_, i) => `${i},${i * 7}`);
    const empty = (ids: readonly { id: string }[]) => dens.filter((d, i) => !stir({ den: d, id: ids[i % ids.length]!.id, region: 1, level: 2 }, s, kindOf).id).length / dens.length;
    expect(empty(prey)).toBeCloseTo(0.35, 1);
    expect(empty(opp)).toBeCloseTo(0.2, 1);
    expect(empty([flyer])).toBe(0);
    expect(stir({ den: "3,4", id: flyer.id, region: 1, level: 2 }, s, kindOf).level).toBe(6);
  });

  test("the room believes a wild one lifted by a release, and only that far", () => {
    const [den, id, lv] = (() => { for (let cx = 0; cx < 400; cx++) for (let cz = 0; cz < 400; cz++) {
      const at = [...holdsOf(`${cx},${cz}`)][0]; if (at) { const [i, l] = at.split("@"); return [`${cx},${cz}`, i!, Number(l)] as const; } } throw new Error("no den"); })();
    expect([holds(den, id, lv), holds(den, id, lv + 4), holds(den, id, lv + 5), holds(den, id, lv - 1)]).toEqual([true, true, false, false]);
  });
});

describe("caught at night (#4387)", () => {
  test("the stalker strikes first: whoever is up goes in hurt, a downed one is passed over, and a campfire mends it", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    expect(maul(j)).toBe(0);
    expect(hpOf(j.party[0]!)).toBeCloseTo(1 - MAULED);
    // the lead went down in that fight; caught again on the way home, the squonk takes it, and a worn one keeps a sliver
    wound(j.party[0]!, 0); wound(j.party[1]!, 0.2);
    expect(maul(j)).toBe(1);
    expect(hpOf(j.party[1]!)).toBeGreaterThan(0);
    expect(heal(j)).toBe(2);
    expect(j.party.every((m) => hpOf(m) === 1)).toBe(true);
  });
});

describe("the Book's five on a second journey (#4174)", () => {
  test("it says what became of each starter you took last time, and that you left the others", () => {
    expect(bookSays("hodag", null)).toStartWith("A hodag pup");
    // a save from before the Book gave out its own five wrote the starters down as the old sheet's: they still count
    const old = JSON.stringify(newJourney(["squonk", "hodag", "jackalope"], 1)).replaceAll(BOOK_PAGE, "the Bog Witch's sheet, Pine Barrens");
    const last = loadJourney(old)!;
    last.party[0]!.level = 14;
    last.party[1]!.hp = 0;
    last.party[1]!.level = 9;
    const said = Object.fromEntries(STARTERS.map((id) => [id, bookSays(id, last)]));
    expect(said).toEqual({
      squonk: "The Squonk led for you last time. Level 14, and it came back expecting to lead again.",
      hodag: "The Hodag came back to me flat out. Level 9. It has not forgiven you.",
      jackalope: "You took the Jackalope for the walk and nothing else. Still level 5. Still hungry.",
      agropelter: "You left the Agropelter in me last time. It noticed.",
      tatzelwurm: "You left the Tatzelwurm in me last time. It noticed.",
    });
    // one moved off the line-up into the journal is still one you took
    last.journal.push(last.party.splice(2, 1)[0]!);
    expect(bookSays("jackalope", last)).toBe("You took the Jackalope, then shelved it on my back pages. It came back level 5, sulking.");
    for (const s of Object.values(said)) expect(s.length).toBeLessThan(95);
  });
});
