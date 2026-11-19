// The scenery set (scripts/scenery.ts): every kind the scatter can place is in the GLB at every budget, stands on
// the ground about a metre tall, and keeps under its triangle budget, so thousands of instances stay cheap. A park's biome
// picks which kinds grow on it.
import { expect, setDefaultTimeout, test } from "bun:test";
import * as THREE from "three";
import type { ParkLevel } from "../src/levels/park.ts";
import { level as loadLevel } from "./parks.ts";
import { KINDS, SCENERY_BUDGETS, Scenery, loadScenery, scatter } from "../src/render/scenery.ts";

setDefaultTimeout(60000); // building a park's ground and scatter runs past bun's 5 s default under a loaded suite
const read = (f: string) => Bun.file(new URL(`../public/${f}`, import.meta.url)).arrayBuffer();
const TREES = ["pine", "aspen", "oak", "joshua", "saguaro", "palm", "snag", "sequoia"];

test.each([...SCENERY_BUDGETS])("the %s scenery set has every kind, standing on the ground about a metre tall", async (budget) => {
  const models = await loadScenery(budget, read);
  const cap = { hi: 900, mid: 320, low: 110 }[budget];
  for (const kind of KINDS) {
    const g = models[kind];
    g.computeBoundingBox();
    const b = g.boundingBox!, tall = b.max.y - b.min.y;
    expect(g.attributes.color).toBeDefined();
    expect(g.attributes.position!.count / 3).toBeLessThanOrEqual(cap);
    expect(b.min.y).toBeGreaterThan(kind === "rock" ? -0.2 : -0.05); // a rock sits a little under the ground
    expect(tall).toBeGreaterThan(0.3);
    expect(tall).toBeLessThan(1.3);
    if (TREES.includes(kind)) expect(tall).toBeGreaterThan(0.8);
    expect(Math.max(Math.abs(b.min.x), Math.abs(b.max.x), Math.abs(b.min.z), Math.abs(b.max.z))).toBeLessThan(0.8);
  }
});

test("a park drawn with the set has one instanced mesh per kind, placed where its spots are", async () => {
  const level = (await loadLevel("el-capitan")) as ParkLevel;
  const spots = scatter(level, level.ground), models = await loadScenery("low", read);
  const scenery = new Scenery(spots, models);
  const meshes = scenery.group.children.filter((o): o is THREE.InstancedMesh => (o as THREE.InstancedMesh).isInstancedMesh);
  expect(meshes.length).toBeGreaterThanOrEqual(new Set(spots.map((s) => s.kind)).size); // a draw call a kind a tile, none for kinds the park doesn't grow
  expect(meshes.every((m) => m.frustumCulled && m.boundingSphere)).toBe(true); // so three can drop the tiles out of view
  expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(spots.length);
  const pine = spots.findIndex((s) => s.kind === "pine");
  expect(pine).toBeGreaterThanOrEqual(0);
  expect(scenery.scaleOf("pine", spots.filter((s) => s.kind === "pine").indexOf(spots[pine]!))).toBeCloseTo(1, 5);
});
