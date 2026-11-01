import { describe, expect, test } from "bun:test";
import { entry } from "../src/compendium.ts";
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
