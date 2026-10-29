// Journey: a scripted rider tours every park from its first spawn (lines, gap launches, pickups, rails, flicking in the
// air) with the chase camera running, a sample of them unless ALL_PARKS=1 (test/parks.ts). The sim stays finite and inside the walls, the camera keeps clear of the ground
// and close to the board, and the rider scores. `bun scripts/ride.ts` rides every spawn and prints the punch list.
// The parks are dealt over ride-1..4.test.ts, one file each, so `bun test --parallel` and CI's shards ride them side by side.
import { expect, test } from "bun:test";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { ride } from "../scripts/ride.ts";
import { build, sample } from "./parks.ts";

export const RIDE_FILES = 4;

/** The tour of every RIDE_FILES-th sampled park, starting at the k-th. */
export function rideParks(k: number) {
  for (const e of sample(LEVELS).filter((_, i) => i % RIDE_FILES === k)) {
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
}
