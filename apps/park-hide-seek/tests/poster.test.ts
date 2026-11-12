// The menus' poster (#3543) is drawn from numbers: one NaN in a path and the art silently vanishes, so every time of day
// and both sizes must come out as clean numbers, and the clock must land on the right poster.
import { expect, test } from "bun:test";
import { backdropSvg, halftoneSvg, headSvg, insigniaSvg, patchSvg, permitNo, posterSvg, todAt } from "../src/ui/poster.ts";

// Round 7 (#4229): the screen behind the menus, for a laptop, a tablet and a phone.
test.each([["day", 0.625], ["night", 0.625], ["dusk", 1.45], ["night", 2.15]] as const)("the %s backdrop for a screen %d tall per wide draws only numbers", (tod, aspect) => {
  expect(backdropSvg(tod, aspect)).not.toMatch(/NaN|undefined|Infinity/);
  for (const h of [76, 120, 230]) expect(headSvg(tod, h)).not.toMatch(/NaN|undefined|Infinity/);
});

test.each([["day", 200, false], ["dusk", 200, false], ["night", 200, false], ["night", 90, true], ["day", 90, true]] as const)(
  "the %s poster at height %d draws only numbers", (tod, h, strip) => {
    const svg = posterSvg(tod, { h, strip });
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  });

test("the player's clock picks the poster: day, dusk either side, night with the torches", () => {
  expect([3, 7, 12, 18, 22].map(todAt)).toEqual(["night", "dusk", "day", "dusk", "night"]);
});

test.each(["day", "dusk", "night"] as const)("the %s insignia and paper halftone draw only numbers", (tod) => {
  for (const ribbon of [false, true]) expect(insigniaSvg(tod, { ribbon })).not.toMatch(/NaN|undefined|Infinity/);
  expect(halftoneSvg(tod)).not.toMatch(/NaN|undefined|Infinity/);
});

test("a results card's park patch carries the park's name and outcome, its own skyline, and no stray markup", () => {
  const a = patchSvg("night", "Great Sand Dunes", "Camped out"), b = patchSvg("night", "Arches", "Caught");
  expect(a).not.toMatch(/NaN|undefined|Infinity/);
  expect(a).toContain("GREAT SAND DUNES");
  expect(patchSvg("day", "Zion <b>", "Caught")).not.toContain("<b>");
  // Each park is seeded by its name, so two parks get two skylines.
  expect(a.match(/<path d="M0 [^"]+"/g)).not.toEqual(b.match(/<path d="M0 [^"]+"/g));
});

test("a results card keeps its permit number for the round, and the next round gets another", () => {
  expect(permitNo("tunnel:1")).toBe(permitNo("tunnel:1"));
  expect(permitNo("tunnel:1")).toMatch(/^\d{2}-\d{4}$/);
  expect(permitNo("tunnel:2")).not.toBe(permitNo("tunnel:1"));
});
