// Journey: a scripted rider tours every park from its first spawn (lines, gap launches, pickups, rails, flicking in the
// air) with the chase camera running. The sim stays finite and inside the walls, the camera keeps clear of the ground
// and close to the board, and the rider scores. `bun scripts/ride.ts` rides every spawn and prints the punch list.
import { expect, setDefaultTimeout, test } from "bun:test";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { ride } from "../scripts/ride.ts";
import { build } from "./parks.ts";

setDefaultTimeout(60000);

for (const e of LEVELS.filter((l) => l.id !== "plaza")) {
  test(`${e.id}: the first spawn's tour stays finite, inside the walls, with the camera holding the board`, async () => {
    const r = ride((await build(e)) as ParkLevel, 1);
    expect(r.badNumbers).toBe(false);
    expect(r.outOfBounds).toBe(0);
    expect(r.cameraBelowGround).toBe(0);
    expect(r.cameraFar).toBe(0);
    expect(r.reached).toBeGreaterThan(0);
    expect(r.bestCombo).toBeGreaterThan(0);
  });
}
