// Your ground's colour (world/hues.ts): 64 to pick from, and no two players in a room wearing the same one.
import { describe, expect, test } from "bun:test";
import { COLOURS, hum, PALETTE, wornColour } from "../src/world/hues.ts";

describe("the 64 colours", () => {
  test("64 different colours, each with its own figure beside its neighbours", () => {
    expect(new Set(PALETTE).size).toBe(COLOURS);
    for (let i = 0; i < COLOURS; i++) expect(hum(i)).not.toEqual(hum((i + 1) % COLOURS));
  });

  test.each([
    ["nobody else wears it: yours", 5, "b", [{ id: "a", colour: 9 }], 5],
    ["a friend who was first wears it: the next free one", 5, "b", [{ id: "a", colour: 5 }, { id: "c", colour: 6 }], 7],
    ["you were first: you keep it, they move", 5, "a", [{ id: "b", colour: 5 }], 5],
    ["at the end of the palette it wraps round", 63, "b", [{ id: "a", colour: 63 }], 0],
    ["a friend's page from before colours says none", 5, "b", [{ id: "a" }], 5],
  ])("%s", (_, chosen, me, others, worn) => { expect(wornColour(chosen, me, others)).toBe(worn); });
});
