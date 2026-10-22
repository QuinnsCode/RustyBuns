// Ground arrives on demand: a park's zone is fetched when its level is first built, and a level built from it
// is the same ground the table says (the signature spot is at the origin, the lat/lon the zone was cut around).
import { expect, test } from "bun:test";
import { loadZone } from "@rustybuns/terrain";
import { LEVELS } from "../src/levels/index.ts";
import { PARKS } from "../src/levels/parks.ts";
import type { ParkLevel } from "../src/levels/park.ts";

test("a zone loads once, on request, and an unknown one is refused", async () => {
  const [a, b] = await Promise.all([loadZone("zion"), loadZone("zion")]);
  expect(a).toBe(b);
  expect(a.id).toBe("zion");
  expect(a.n * a.n * 2).toBe(Buffer.from(a.heights, "base64").length);
  await expect(loadZone("atlantis")).rejects.toThrow("no zone atlantis");
});

test("every park in the table that has a level is centred on the table's spot, and is built from its own ground", async () => {
  const have = PARKS.filter((p) => LEVELS.some((l) => l.id === p.id));
  expect(have.length).toBeGreaterThanOrEqual(11);
  const heights = new Set<number>();
  for (const p of have) {
    const zone = await loadZone(p.id), level = (await LEVELS.find((l) => l.id === p.id)!.load()) as ParkLevel;
    expect(zone.center[0]).toBeCloseTo(p.lon, 4);
    expect(zone.center[1]).toBeCloseTo(p.lat, 4);
    heights.add(Math.round(level.ground.height(0, 0) * 100));
  }
  expect(heights.size).toBeGreaterThan(have.length / 2);
});
