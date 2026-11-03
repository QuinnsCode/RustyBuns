import { describe, expect, test } from "bun:test";
import { handOf, knownOf, MISREAD, poolOf, ribbonsOf, summon } from "../src/grimoire.ts";
import { newJourney } from "../src/journey.ts";
import { ROSTER } from "../src/roster.ts";

const seq = (...n: number[]) => { let i = 0; return () => n[i++ % n.length]!; };

describe("the book's hand and its circle", () => {
  test("no journey: three loaned ribbons; a journey: its line-up", () => {
    expect(handOf(null)).toHaveLength(3);
    expect(ribbonsOf(null)).toBe(3);
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    expect(handOf(j)).toEqual(j.party.map((m) => m.id));
  });

  // [roll for the misread check, roll for grumpy, what comes]
  test.each([
    ["clean page", [0.5, 0.9, 0], "arrives", true],
    ["grumpy", [0.5, 0.1, 0], "grumpy", true],
    ["misread", [MISREAD - 0.01, 0, 0.9, 0], "misread", false],
  ] as const)("%s", (_n, rolls, outcome, inField) => {
    const s = summon("ember", seq(...rolls), ROSTER)!;
    expect(s.outcome).toBe(outcome);
    expect(s.line.length).toBeGreaterThan(5);
    if (inField) expect(ROSTER.find((c) => c.id === s.id)!.fields).toContain("ember");
  });

  test("an empty pool summons nothing", () => expect(summon(null, Math.random, [])).toBeNull());

  test("on a journey the book only summons pages you have earned", () => {
    const j = newJourney(["hodag", "squonk", "jackalope"])!;
    const other = ROSTER.find((c) => !["hodag", "squonk", "jackalope"].includes(c.id))!;
    const tier = () => "common";
    expect(poolOf(j, ROSTER, tier).map((c) => c.id).sort()).toEqual(["hodag", "jackalope", "squonk"]);
    expect(knownOf(j, other.id, "common")).toBe("unknown");
    j.seen.push(other.id);
    expect(poolOf(j, ROSTER, tier).map((c) => c.id)).toContain(other.id);
    expect(knownOf(j, other.id, "unknown")).toBe("unknown"); // seen only as a shrouded shape
    expect(poolOf(j, ROSTER, tier, true)).toHaveLength(ROSTER.length); // the Librarian's key
    expect(poolOf(null, ROSTER, tier)).toHaveLength(ROSTER.length);
  });
});
