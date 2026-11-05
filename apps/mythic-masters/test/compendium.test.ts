import { describe, expect, test } from "bun:test";
import { entry, folio, hauntsOf, marginOf, neighbour, stepTo, type Spot } from "../src/compendium.ts";
import { bind, newJourney, WITCH_SHEET } from "../src/journey.ts";
import { creature } from "../src/roster.ts";

// The Eldritch Compendium's bestiary keeps a cryptid under smoke until you meet it: the page must not give away
// its name or its picture before then, and binding it is what writes its kind on the page.
describe("the compendium's bestiary", () => {
  const c = creature("mothman");
  test.each([
    ["unknown", false, false, false],
    ["seen", true, true, false],
    ["bound", true, true, true],
  ] as const)("a %s entry: name %p, picture %p, kind %p", (known, name, pic, kind) => {
    const html = entry(c, known, "rare", "", known === "unknown");
    expect(html.includes(c.name)).toBe(name);
    expect(html.includes("<img")).toBe(pic);
    expect(html.includes(c.archetype)).toBe(kind);
  });
});

describe("the folio a bestiary entry opens", () => {
  const c = creature("hodag"), at = Date.UTC(2026, 10, 4, 9, 30);
  test("bound: its names, where and when the ink held, the level and stats then against now, its moves", () => {
    const j = newJourney(["squonk", "jackalope", "tatzelwurm"], at)!;
    bind(j, "hodag", 7, "Rhinelander, Great North Woods", at + 60_000); // the line-up is full: it rests in the journal
    const m = j.journal[0]!;
    m.level = 12;
    const html = folio(c, "bound", { tier: "common", member: m, item: 4, rests: "in the line-up, slot 4", now: at + 120_000 });
    expect(html).toContain("<h1>Hodag</h1>");
    expect(html).toContain("(Bovinus spiritualis)"); // its other name, in brackets under the name
    expect(html).toContain("Rhinelander, Great North Woods"); // where
    expect(html).toContain("2026"); // when
    expect(html).toContain("7 then, 12 now");
    expect(html).toContain(`class="was"`); // the radar's dashed outline of the stats it was bound with
    expect(html).toMatch(/<th>vigor<\/th><td>\d+<\/td><td>\d+<\/td><td class="gain">\+\d+<\/td>/);
    for (const mv of c.moves) expect(html).toContain(mv.name);
    expect(html).toContain("Item 4. Entered. The ink is still wet.");
  });
  test("a starter's ledger says it came off the Bog Witch's sheet; an old save's says the book kept no date", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"], at)!;
    expect(folio(c, "bound", { tier: "common", member: j.party[0]!, item: 1, rests: "in the line-up, slot 1" })).toContain(WITCH_SHEET.replace("'", "&#39;"));
    const old = folio(c, "bound", { tier: "common", member: { id: "hodag", level: 9, xp: 0 }, item: 1, rests: "in these pages" });
    expect(old).toContain("before the book kept dates");
    expect(old).not.toContain(`class="was"`);
  });
  test("seen: the name under smoke and the rest smudged, no kind, no stats; unknown: no page at all", () => {
    const seen = folio(creature("mothman"), "seen", { tier: "rare", member: null, item: 0, rests: "" });
    expect(seen).toContain("<h1>Mothman</h1>");
    expect(seen).toContain("haze");
    expect(seen).toContain("smudged");
    expect(seen).not.toContain("flyer");
    expect(seen).not.toContain("<svg class=\"radar\"");
    expect(seen).not.toContain("class=\"radar\"");
    expect(seen).toContain(marginOf("seen", 0, Infinity));
    expect(folio(c, "unknown", { tier: "common", member: null, item: 0, rests: "" })).toBe("");
    expect(entry(c, "bound", "rare", "")).toContain(`data-id="${c.id}"`);
    expect(entry(c, "unknown", "rare", "")).not.toContain("data-id");
  });
  test("where a beast roams is read off the trails", () => {
    expect(hauntsOf("wampus-cat").map((h) => h.region)).toContain("Pine Barrens");
    expect(hauntsOf("jersey-devil")[0]?.places).toEqual(["Leeds Point"]);
  });
});

// A d-pad over a page of entries laid out two columns wide across the spine: a step lands on the neighbour that way,
// a column stays a column, and the edge of the page is the edge.
describe("the quill the d-pad walks", () => {
  const grid: Spot[] = [];
  for (let r = 0; r < 2; r++) for (let col = 0; col < 2; col++) grid.push({ id: `L${r}${col}`, x: 100 + col * 120, y: 100 + r * 150 });
  for (let r = 0; r < 2; r++) grid.push({ id: `R${r}0`, x: 700, y: 100 + r * 150 }); // the right-hand page, one column
  test.each([
    [null, "right", "L00"], ["L00", "right", "L01"], ["L01", "right", "R00"], ["R00", "right", null],
    ["L00", "down", "L10"], ["L10", "down", null], ["L10", "up", "L00"], ["R10", "left", "L11"], ["L00", "left", null],
  ] as const)("from %s, %s lands on %s", (from, dir, to) => expect(stepTo(grid, from, dir)).toBe(to));
  test("a folio flips to the next known page and wraps round", () => {
    expect(neighbour(["a", "b", "c"], "c", 1)).toBe("a");
    expect(neighbour(["a", "b", "c"], "a", -1)).toBe("c");
    expect(neighbour([], "a", 1)).toBeNull();
  });
});
