// The scenery set (scripts/scenery.ts): every kind the scatter can place is in the GLB at every budget, stands on
// the ground about a metre tall, and keeps under its triangle budget, so thousands of instances stay cheap. A park's biome
// picks which kinds grow on it.
import { expect, test } from "bun:test";
import * as THREE from "three";
import type { ParkLevel } from "../src/levels/park.ts";
import { level as loadLevel } from "./parks.ts";
import { KINDS, SCENERY_BUDGETS, Scenery, dressTrees, loadScenery, scatter } from "../src/render/scenery.ts";
import { props } from "../src/levels/ground.ts";

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

test("a desert park grows joshua trees, saguaros and sage, and a pine park none of them", async () => {
  const level = (await loadLevel("grand-canyon")) as ParkLevel;
  const desert = scatter(level, level.ground, 7, "desert"), pine = scatter(level, level.ground, 7, "pine");
  const kinds = (spots: ReturnType<typeof scatter>) => new Set(spots.map((s) => s.kind));
  for (const k of ["joshua", "saguaro", "sage"] as const) {
    expect(kinds(desert).has(k)).toBe(true);
    expect(kinds(pine).has(k)).toBe(false);
  }
  expect(kinds(desert).has("pine")).toBe(false);
  expect(kinds(pine).has("pine")).toBe(true);
  expect(level.biome).toBe("pine"); // a park says nothing and gets the forest it always had
});

test("Mariposa Grove's named sequoias wear the Blender sequoia, each as tall and as wide as its spec", async () => {
  const level = (await loadLevel("mariposa-grove")) as ParkLevel, models = await loadScenery("mid", read);
  const { group } = props(level);
  expect(dressTrees(group, models.sequoia)).toBe(level.trees.length);
  const meshes: THREE.Mesh[] = [];
  group.traverse((o) => { if (o.userData.tree) meshes.push(o as THREE.Mesh); });
  expect(meshes.length).toBe(level.trees.length);
  for (const m of meshes) {
    const t = m.userData.tree as { x: number; z: number; r: number; tall: number }, box = new THREE.Box3().setFromObject(m);
    expect(Math.abs(box.max.y - box.min.y - t.tall)).toBeLessThan(t.tall * 0.03); // the model is a metre tall give or take its ruffle
    expect(Math.abs(m.position.x - t.x) + Math.abs(m.position.z - t.z)).toBeLessThan(1e-6);
    expect(box.max.x - box.min.x).toBeGreaterThan(t.r * 2); // the crown spreads wider than the trunk
  }
});
