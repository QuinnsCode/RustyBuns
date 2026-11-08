import { describe, expect, test } from "bun:test";
import { entry, folio, hauntsOf, marginOf, neighbour, stepTo, type Spot } from "../src/compendium.ts";
import { TALE } from "../src/creatures.ts";
import { creature, ROSTER } from "../src/roster.ts";
import { moveLine } from "../src/moveline.ts";

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
  const c = creature("hodag");
  test("seen: the name under smoke and the rest smudged, no kind, no stats; unknown: no page at all", () => {
    const seen = folio(creature("mothman"), "seen", { tier: "rare", member: null, item: 0, rests: "" });
    expect(seen).toContain("<h1>Mothman</h1>");
    expect(seen).toContain("haze");
    expect(seen).toContain("smudged");
    expect(seen).not.toContain("flyer");
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

// Every beast's folio opens its Background on a line about the beast itself, before its region's tale (#3604), so two
// beasts of one region never read the same paragraph.
test("every beast has its own line in the Background", () => {
  const missing = ROSTER.filter((c) => !TALE[c.id]).map((c) => c.id);
  expect(missing).toEqual([]);
  const c = ROSTER[0]!, page = folio(c, "bound", { tier: "common", member: null, item: 1, rests: "in these pages" });
  expect(page).toContain(TALE[c.id]!.slice(0, 30));
});

// ATTACKS.md step 6, the beast card: each move reads as a stat line off the sim's own numbers (its shape, tempo, the
// damage from the shape's weak end to its strong one, its cost), with its shape drawn beside it on the bound folio.
describe("the beast card's move lines", () => {
  const line = (id: string, slot: string) => moveLine(creature(id).moves.find((m) => m.slot === slot)!);
  test.each([
    ["Torrent, a charged column", "squonk", "beam", "column 14 x 1.2 m · charge 1.2 s · 77-252 · 35 energy"],
    ["Flame Breath, a stream", "hodag", "beam", "cone 60 deg x 6 m · build-up 2 s · 3-17 a tick · 35 over its run"],
    ["Ember Orb, a quick lob", "hodag", "special", "blast r 1.5 m @ 10 m · quick · 25-45 · 15 energy"],
    ["a jab", "hodag", "light", "touch · quick · 24 · free"],
  ] as const)("%s", (_name, id, slot, want) => expect(line(id, slot)).toBe(want));

  test("a bound folio prints a line and a drawing for every move; a seen one keeps them under the smudge", () => {
    const c = creature("squonk"), member = { id: c.id, level: 5, xp: 0, hp: 1 };
    const page = folio(c, "bound", { tier: "common", member, item: 1, rests: "in these pages" });
    expect(page.match(/<svg class="shape"/g)?.length).toBe(c.moves.length);
    for (const mv of c.moves) expect(page).toContain(moveLine(mv));
    expect(folio(c, "seen", { tier: "common", member: null, item: 1, rests: "" })).not.toContain("svg class=\"shape\"");
  });
});
