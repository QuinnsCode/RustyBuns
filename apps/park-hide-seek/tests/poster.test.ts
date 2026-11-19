// The menus' poster (#3543) is drawn from numbers: one NaN in a path and the art silently vanishes, so every time of day
// and both sizes must come out as clean numbers, and the clock must land on the right poster.
import { expect, test } from "bun:test";
import { backdropSvg, halftoneSvg, headSvg, insigniaSvg, patchSvg, permitNo, posterSvg, todAt } from "../src/ui/poster.ts";

test("every time of day, at every size the menus use, draws only numbers", () => {
  const clean = (svg: string) => expect(svg).not.toMatch(/NaN|undefined|Infinity/);
  // the screen behind the menus (#4229), for a laptop, a tablet and a phone
  for (const [tod, aspect] of [["day", 0.625], ["night", 0.625], ["dusk", 1.45], ["night", 2.15]] as const) clean(backdropSvg(tod, aspect));
  for (const tod of ["day", "dusk", "night"] as const) {
    for (const h of [76, 120, 230]) clean(headSvg(tod, h));
    clean(posterSvg(tod, { h: 200, strip: false }));
    for (const ribbon of [false, true]) clean(insigniaSvg(tod, { ribbon }));
    clean(halftoneSvg(tod));
  }
  for (const tod of ["day", "night"] as const) clean(posterSvg(tod, { h: 90, strip: true }));
});

test("the player's clock picks the poster: day, dusk either side, night with the torches", () => {
  expect([3, 7, 12, 18, 22].map(todAt)).toEqual(["night", "dusk", "day", "dusk", "night"]);
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
