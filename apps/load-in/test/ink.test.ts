// Your ink: a tattoo for each rung of the tour you pass, each on its own place on an arm, and a saved look that
// loads back (or falls back to plain when what was stored is not a look).
import { expect, test } from "bun:test";
import { FLASH, earned, plainLook, readLook } from "../src/you/ink.ts";
import { LADDER, newTour, record } from "../src/tour.ts";

test("passing gigs earns their tattoos, in ladder order, and a failed night earns nothing", () => {
  let tour = newTour();
  expect(earned(tour.nights)).toEqual([]);
  // A bad first night, then a good one, then a good night at the next rung.
  tour = record(tour, LADDER[0]!.level, { score: 40, pass: false, pay: 100 }).tour;
  expect(earned(tour.nights)).toEqual([]);
  tour = record(tour, LADDER[0]!.level, { score: 95, pass: true, pay: 100 }).tour;
  tour = record(tour, LADDER[1]!.level, { score: 90, pass: true, pay: 100 }).tour;
  expect(earned(tour.nights)).toEqual([LADDER[0]!.level.name, LADDER[1]!.level.name]);
  // The first two sit one on each arm, down by the wrist.
  expect(earned(tour.nights).map((l) => FLASH[l]!.arm)).toEqual(["right", "left"]);
});

test("every rung of the ladder has a tattoo, and no two share a place", () => {
  expect(LADDER.map((r) => r.level.name).filter((n) => !FLASH[n])).toEqual([]);
  const spots = Object.values(FLASH).map((f) => `${f.arm} ${f.at} ${f.round}`);
  expect(new Set(spots).size).toBe(spots.length);
});

test("a saved look loads back, and anything else is the plain look", () => {
  const mine = { own: "data:image/jpeg;base64,AAAA", arm: "right" as const, at: 0.5, size: 0.3 };
  expect(readLook(JSON.parse(JSON.stringify(mine)))).toEqual(mine);
  // The shoes ride in the same save: a colour that is kept, and black for a save from before there were shoes.
  expect(readLook({ ...mine, shoes: "red" }).shoes).toBe("red");
  expect(readLook(mine).shoes).toBeUndefined();
  expect(readLook({ ...mine, shoes: "plaid" })).toEqual(plainLook());
  for (const bad of [null, "ink", { arm: "tail", at: 0.5, size: 0.3 }, { ...mine, own: "https://example.com/x.png" }, { ...mine, at: 7 }]) {
    expect(readLook(bad)).toEqual(plainLook());
  }
});
