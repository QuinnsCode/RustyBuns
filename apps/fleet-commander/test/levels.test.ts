// Every level as a player meets it: the intended play (the level's own `plan`) wins it, and a fleet left with no
// orders loses it. Seeded, so each run is the same battle.
import { expect, setDefaultTimeout, test } from "bun:test";
import { LEVELS, levelBrains, startLevel } from "../src/sim/levels.ts";
import { step, type World } from "../src/sim/world.ts";

setDefaultTimeout(30_000);

const play = (w: World, brain?: (w: World) => void) => { while (!w.outcome) { brain?.(w); step(w, levelBrains(w)); } return w.outcome; };

test("each level: the intended play wins it, doing nothing loses it", () => {
  expect(LEVELS.length).toBeGreaterThanOrEqual(6);
  for (const l of LEVELS) for (const seed of [1, 2]) {
    expect([l.id, seed, play(startLevel(l, seed), l.plan)]).toEqual([l.id, seed, "win"]);
    expect([l.id, seed, play(startLevel(l, seed))]).toEqual([l.id, seed, "loss"]);
  }
});
