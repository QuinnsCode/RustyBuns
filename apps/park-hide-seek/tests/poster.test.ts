// The menus' poster (#3543) is drawn from numbers: one NaN in a path and the art silently vanishes, so every time of day
// and both sizes must come out as clean numbers, and the clock must land on the right poster.
import { expect, test } from "bun:test";
import { insigniaSvg, permitNo, posterSvg, stripH, todAt } from "../src/ui/poster.ts";

test.each([["day", 200, false], ["dusk", 200, false], ["night", 200, false], ["night", 90, true], ["day", 90, true]] as const)(
  "the %s poster at height %d draws only numbers", (tod, h, strip) => {
    const svg = posterSvg(tod, { h, strip });
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(svg.match(/<path /g)!.length).toBeGreaterThanOrEqual(5 + (strip ? 0 : 1));
  });

test("the player's clock picks the poster: day, dusk either side, night with the torches", () => {
  expect([3, 7, 12, 18, 22].map(todAt)).toEqual(["night", "dusk", "day", "dusk", "night"]);
});

test.each(["day", "dusk", "night"] as const)("the %s insignia draws only numbers, with and without its ribbon", (tod) => {
  for (const ribbon of [false, true]) expect(insigniaSvg(tod, { ribbon })).not.toMatch(/NaN|undefined|Infinity/);
});

test("a results card keeps its permit number for the round, and the next round gets another", () => {
  expect(permitNo("tunnel:1")).toBe(permitNo("tunnel:1"));
  expect(permitNo("tunnel:1")).toMatch(/^\d{2}-\d{4}$/);
  expect(permitNo("tunnel:2")).not.toBe(permitNo("tunnel:1"));
});

test("a panel's strip is drawn to its width: the wide results card squatter, a phone column taller, within bounds", () => {
  expect([520, 354, 260, 1200].map(stripH)).toEqual([76, 100, 100, 64]);
});
