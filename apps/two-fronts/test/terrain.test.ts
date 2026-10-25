// The scenery, headless: it builds for every kind of sector, stays within a draw and instance
// budget (a battle also has forty units to draw), and the jungle is the richest map.
import { expect, setDefaultTimeout, test } from "bun:test";
import * as THREE from "three";
import type { BattleSpec, SectorKind } from "../src/battle/contract.ts";
import { shoreX, startBattle } from "../src/battle/sim.ts";
import { buildWorld } from "../src/battle/terrain.ts";

setDefaultTimeout(30_000);

const spec = (sector: SectorKind): BattleSpec => ({
  id: "1-kessa-0", turn: 1, system: "Kessa", sector,
  factions: { attacker: "marines", defender: "wooka" }, hero: "attacker", heroLevel: 1,
  armies: { attacker: 3, defender: 2 }, tickets: { attacker: 75, defender: 50 },
  vehicles: { attacker: { tank: 1 }, defender: { tank: 1 } }, strikes: { attacker: 1, defender: 0 },
  reinforcements: { attacker: 24, defender: 0 }, turrets: 2, seed: 42,
});
const count = (scene: THREE.Scene) => {
  let draws = 0, instances = 0;
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) { draws++; instances += (o as THREE.InstancedMesh).isInstancedMesh ? (o as THREE.InstancedMesh).count : 1; }
  });
  return { draws, instances };
};
const build = (kind: SectorKind) => {
  const b = startBattle(spec(kind)), scene = new THREE.Scene();
  return { b, scene, world: buildWorld(scene, b) };
};

const KINDS: SectorKind[] = ["shield", "capital", "spaceport", "cannon", "canyon", "jungle"];
// Measured at full quality (the jungle is the most, 711 draws once main's bushes and trench dressing joined the PR's floor), with room to grow a little. The plain is 360 across (2.25x the ground), so the budget grew with it.
const BUDGET = { draws: 1300, instances: 60_000 };

test.each(KINDS)("%s scenery builds, sways and stays in budget", (kind) => {
  const { b, scene, world } = build(kind);
  const { draws, instances } = count(scene);
  expect(draws).toBeLessThanOrEqual(BUDGET.draws);
  expect(instances).toBeLessThanOrEqual(BUDGET.instances);
  expect(Number.isFinite(world.heightAt(0, 0))).toBe(true);
  // Frames with a blast going off and the units about run, and the plants bend with no sim state touched.
  const before = JSON.stringify(b.units.map((u) => [u.x, u.z]));
  b.fx.push({ kind: "blast", x: 5, z: 5, tx: 5, tz: 5, t: 0.5, big: true });
  for (let i = 0; i < 20; i++) world.update(i * 0.05, new THREE.Vector3(0, 4, 90), { x: 0, z: 60 });
  expect(JSON.stringify(b.units.map((u) => [u.x, u.z]))).toBe(before);
});

test("the jungle is the richest map, and the other woods each have a floor of their own", () => {
  const n = Object.fromEntries(KINDS.map((k) => [k, count(build(k).scene).instances])) as Record<SectorKind, number>;
  for (const k of KINDS.filter((x) => x !== "jungle")) expect(n.jungle).toBeGreaterThan(n[k]);
  expect(new Set([n.shield, n.capital, n.spaceport, n.cannon]).size).toBe(4);
});

test("the cannon shore: wading depth at the edge is an ankle, and no cover or post stands in the water", () => {
  const { b, world } = build("cannon");
  const level = -0.02;
  for (let z = -b.half; z <= b.half; z += 20) expect(level - world.heightAt(b.half, z)).toBeLessThan(0.6);
  for (const p of b.posts) expect(p.x).toBeLessThan(shoreX(b) - 20);
  expect(b.blocks.filter((k) => k.x + k.w / 2 > b.half - 68)).toEqual([]);
  expect(b.trees).toEqual([]);
});

test("the cannon shore reads from the spawn and keep: sea past both field ends and a tall headland", () => {
  const { b, world } = build("cannon");
  const level = -0.02, keep = b.posts.at(-1)!;
  // Beyond each end of the field the water reaches well inland of the straight shore.
  for (const z of [-b.half - 70, b.half + 70]) expect(level - world.heightAt(shoreX(b) - 40, z)).toBeGreaterThan(0.5);
  // The gun stands on a rock plateau far above the beach below it.
  expect(world.heightAt(keep.x - 12, keep.z - 42)).toBeGreaterThan(10);
  expect(world.heightAt(keep.x - 12, keep.z - 42) - world.heightAt(keep.x - 12, keep.z - 100)).toBeGreaterThan(8);
});
