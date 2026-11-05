// The menus' poster (#3543) is drawn from numbers: one NaN in a path and the art silently vanishes, so every time of day
// and both sizes must come out as clean numbers, and the clock must land on the right poster.
import { expect, test } from "bun:test";
import { posterSvg, todAt } from "../src/ui/poster.ts";

test.each([["day", 200, false], ["dusk", 200, false], ["night", 200, false], ["night", 90, true], ["day", 90, true]] as const)(
  "the %s poster at height %d draws only numbers", (tod, h, strip) => {
    const svg = posterSvg(tod, { h, strip });
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(svg.match(/<path /g)!.length).toBeGreaterThanOrEqual(5 + (strip ? 0 : 1));
  });

test("the player's clock picks the poster: day, dusk either side, night with the torches", () => {
  expect([3, 7, 12, 18, 22].map(todAt)).toEqual(["night", "dusk", "day", "dusk", "night"]);
});
