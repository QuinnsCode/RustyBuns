import { expect, setDefaultTimeout, test } from "bun:test";
import { baseLevel, START_LEVEL, SECTIONS, sectionLevel } from "../src/journey.ts";
import { setTravel } from "../src/world/world.ts";
import { levels, lineup, pace, route, stones } from "../scripts/levels.ts";

setDefaultTimeout(30_000);

test("the levels card: five checks on the road from region 1, each a rate with its points, and a total out of 5", () => {
  const road = route(), all = stones(road), at = pace(road);
  expect(road[0]).toBe(1);
  expect(all.length).toBe(road.length * SECTIONS);
  // at pace: the lead sets out at the level the Book hands it over at, and never goes down
  expect(at[0]).toBeGreaterThanOrEqual(START_LEVEL);
  expect(at.every((l, i) => i === 0 || l >= at[i - 1]!)).toBe(true);
  // more dens never leave the line-up further behind
  const behind = (dens: number) => lineup(dens, road).reduce((t, r) => t + r.levels.reduce((s, l) => s + Math.max(0, r.stone.level - l), 0), 0);
  expect(behind(48)).toBeLessThanOrEqual(behind(12));

  const card = levels(1, ["hodag"]);
  expect(card.checks.map((c) => c.id)).toEqual(["L1", "L2", "L3", "L4", "L5"]);
  for (const c of card.checks) {
    expect(c.rate).toBeGreaterThanOrEqual(0);
    expect(c.rate).toBeLessThanOrEqual(1);
    expect(c.points).toBeCloseTo(c.rate, 2);
    expect(c.band.length).toBeGreaterThan(0);
    expect(c.detail.length).toBeGreaterThan(0);
    // a check short of its point says which cells miss
    if (c.rate < 1) expect(c.misses.length).toBeGreaterThan(0);
  }
  expect(card.total).toBeCloseTo(card.checks.reduce((t, c) => t + c.points, 0), 2);
  // the same seeds play the same fights
  expect(levels(1, ["hodag"]).checks.map((c) => c.rate)).toEqual(card.checks.map((c) => c.rate));
});

test("levels follow the road: each trail on it starts at the level of the boss before it, whoever is in the line-up", () => {
  setTravel([{ archetype: "tank", fields: ["grove"] }]); // no flier, no swimmer: the gates hold for the game, not for the road
  try {
    const road = route();
    expect(road).toEqual([1, 2, 3, 5, 4, 6, 7, 8]);
    for (let i = 1; i < road.length; i++) expect(baseLevel(road[i]!)).toBe(sectionLevel(road[i - 1]!, SECTIONS - 1));
  } finally { setTravel(null); }
});
