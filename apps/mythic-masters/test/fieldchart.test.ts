import { describe, expect, test } from "bun:test";
import { ask, explain, matchup, mutual, pct } from "../src/fieldchart.ts";
import { STRONG, type Field } from "../src/fields.ts";

describe("the field chart's asker", () => {
  // What a player asks it: one field into one, into two that agree (the cap), and into two that pull apart.
  test.each<[Field, Field[], string, boolean, RegExp]>([
    ["tide", ["ember"], "+12.5%", false, /tide beats ember/],
    ["ember", ["tide"], "-10%", false, /tide beats ember, so it shrugs it off/],
    ["ember", ["ember"], "-10%", false, /its own field/],
    ["ember", ["tide", "stone"], "-10%", true, /one lean is the most/],
    ["ember", ["grove", "iron"], "+12.5%", true, /one lean is the most/],
    ["ember", ["grove", "tide"], "+2.5%", false, /nearly cancel/],
    ["ember", ["spirit"], "even", false, /pass each other by/],
  ])("%s into %p is %s", (move, target, says, capped, why) => {
    const m = matchup(move, target);
    expect(pct(m.mul)).toBe(says);
    expect(m.capped).toBe(capped);
    expect(explain(m)).toMatch(why);
  });

  test("both ways: your fields into theirs and theirs into yours", () => {
    const a = ask(["tide", "stone"], ["ember"]);
    expect(a.yours.map((m) => pct(m.mul))).toEqual(["+12.5%", "+12.5%"]);
    expect(a.theirs.map((m) => pct(m.mul))).toEqual(["-10%"]);
  });

  test("the pairs it calls mutual do beat each other", () => {
    expect(mutual().length).toBeGreaterThan(0);
    for (const [a, b] of mutual()) expect(STRONG[a].includes(b) && STRONG[b].includes(a)).toBe(true);
  });
});
