import { expect, test } from "bun:test";
import { terrainPixels } from "../src/levels/thumb.ts";
import { plaza } from "../src/levels/plaza.ts";
import { LEVELS } from "../src/levels/index.ts";
import { build } from "./parks.ts";

test("every level draws a full opaque height map, and the high ground is paler than the low", async () => {
  for (const e of LEVELS) {
    const px = terrainPixels(await build(e), 24);
    expect(px.length).toBe(24 * 24 * 4);
    for (let k = 3; k < px.length; k += 4) expect(px[k]).toBe(255);
  }
  const px = terrainPixels(plaza, 40), lum = (k: number) => px[k]! + px[k + 1]! + px[k + 2]!;
  const all = Array.from({ length: 40 * 40 }, (_, n) => lum(n * 4));
  expect(Math.max(...all)).toBeGreaterThan(Math.min(...all));
});
