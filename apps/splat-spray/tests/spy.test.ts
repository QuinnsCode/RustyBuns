import { describe, expect, test } from "bun:test";
import { briefing, rank } from "../src/spy.ts";

describe("spy story", () => {
  test("one seed is one briefing on every page, and seeds vary it", () => {
    expect(briefing(42, "red crayon")).toEqual(briefing(42, "red crayon"));
    const ops = new Set(Array.from({ length: 40 }, (_, i) => briefing(i, "duck").operation));
    expect(ops.size).toBeGreaterThan(20);
    expect(briefing(7, "owl").objective).toEndWith("is hidden in an owl.");
  });

  test.each([[1, "Super Spy"], [3, "Super Spy"], [4, "Secret Agent"], [10, "Special Agent"], [16, "Field Agent"], [90, "Rookie"]])(
    "%i shots ranks %s", (shots, title) => expect<string>(rank(shots)).toBe(title));
});
