// The crop that fits any upload onto the deck's underside without stretching it.
import { expect, test } from "bun:test";
import { coverCrop } from "../src/graphic.ts";

test("a wide photo is cropped from the sides, a tall one from top and bottom, and the crop always has the deck's shape", () => {
  for (const [w, h] of [[4000, 1000], [1000, 4000], [500, 500], [256, 896]]) {
    const c = coverCrop(w!, h!, 256, 896);
    expect(c.sw / c.sh).toBeCloseTo(256 / 896, 5);
    expect(c.sx).toBeGreaterThanOrEqual(0);
    expect(c.sy).toBeGreaterThanOrEqual(0);
    expect(c.sx + c.sw).toBeLessThanOrEqual(w! + 1e-6);
    expect(c.sy + c.sh).toBeLessThanOrEqual(h! + 1e-6);
  }
});
