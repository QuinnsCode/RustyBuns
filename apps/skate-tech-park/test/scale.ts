// Selling the scale on each sampled park: scenery lands only on open ground and cheaply, and the kit stands
// in a clearing. A slice of the sample a file (`scale-<n>.test.ts`), so CI's shards can balance them.
import { expect, setDefaultTimeout, test } from "bun:test";
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import { onRail } from "../src/level.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { DECK } from "../src/models.ts";
import { KINDS, SCENERY_TILE, Scenery, TREES, scatter } from "../src/render/scenery.ts";
import { level as loadLevel, sample, slice } from "./parks.ts";

/** Registers the scenery checks for every `of`th sampled park from the `part`th. */
export function scaleParks(part: number, of: number) {
  setDefaultTimeout(60000); // building a park's ground and scatter runs past bun's 5 s default under a loaded suite
  const parks = slice(sample(LEVELS), part, of); // scatter is deterministic code; a sample of parks keeps the suite inside CI's ten minutes

  test.each(parks.map((e) => [e.name, e.id]))("%s: scenery is seeded and keeps off pieces, rails and the spawn", async (_, id) => {
    const park = (await loadLevel(id)) as ParkLevel;
    const spots = scatter(park, park.ground);
    expect(spots.length).toBeGreaterThan(50);
    expect(scatter(park, park.ground)).toEqual(spots); // the same every time
    for (const s of spots) {
      expect(park.height(s.x, s.z) - park.ground.height(s.x, s.z)).toBeLessThan(0.03);
      for (const r of park.rails) { const o = onRail(r, s.x, s.z); expect(o.t < -0.05 || o.t > 1.05 || o.off >= 3).toBe(true); }
      for (const sp of park.spawns) expect(Math.hypot(sp.x - s.x, sp.z - s.z)).toBeGreaterThan(11);
    }
    for (const s of spots) expect(s.size).toBeLessThan(DECK.length / 2); // every pine, rock and tent is a toy beside the board
    let calls = 0;
    new Scenery(spots).group.traverse((o) => { if ((o as THREE.Mesh).isMesh) calls++; });
    expect(calls).toBeLessThanOrEqual(KINDS.length * Math.ceil((2 * park.ground.R) / SCENERY_TILE + 1) ** 2); // a draw call a kind a tile, and three culls the tiles out of view
    expect(new Set(spots.map((s) => s.kind)).size).toBeGreaterThan(4); // and a park has most of them
  });

  test.each(parks.map((e) => [e.name, e.id]))("%s: the kit stands in a clearing and the forest thickens past it", async (_, id) => {
    const park = (await loadLevel(id)) as ParkLevel;
    const spots = scatter(park, park.ground), trees = spots.filter((s) => TREES.has(s.kind));
    const dist = (s: { x: number; z: number }) => Math.min(...park.pieces.map((p) => Math.hypot(p.x - s.x, p.z - s.z) - Math.hypot(p.w, p.d) / 2));
    expect(trees.length).toBeGreaterThan(100);
    expect(trees.filter((s) => dist(s) < 5).length).toBe(0); // nothing tall crowds the kit
    expect(spots.filter((s) => s.kind === "flower" || s.kind === "fern" || s.kind === "sage").length).toBeGreaterThan(20); // the clearing has meadow in it
    expect(trees.filter((s) => dist(s) > 25).length).toBeGreaterThan(trees.filter((s) => dist(s) < 15).length * 0.5); // and the woods are further out (the kit now spreads over the whole map, so the clearing is the 12 m around each part, not a 40 m belt)
  });
}
