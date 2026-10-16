// The Blender kit (blender/kit.py) fitted to real levels: still two draw calls, and at every budget the
// dressed ramps, stairs and blocks show their top where the sim's floor is, on the plaza and on a park's slopes.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { toLocal } from "../src/level.ts";
import { KIT_BUDGETS, fitAcross, fitUp, loadKit } from "../src/render/kit.ts";
import { levelMeshes } from "../src/render/pieces.ts";

const read = (f: string) => Bun.file(new URL(`../public/${f}`, import.meta.url)).arrayBuffer();
const down = (m: THREE.Object3D, x: number, z: number) =>
  new THREE.Raycaster(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0)).intersectObject(m, true)[0]?.point.y;

test.each([...KIT_BUDGETS])("the %s kit dresses ramps, stairs and blocks where the sim rides them", async (budget) => {
  const kit = await loadKit(budget, read);
  for (const id of ["plaza", "yosemite-falls"]) {
    const level = LEVELS.find((e) => e.id === id)!.load(), ground = "ground" in level ? (level as ParkLevel).ground.height : undefined;
    const group = levelMeshes(level, ground, kit);
    expect(group.children.length).toBeLessThanOrEqual(2);
    const dressed = level.pieces.filter((p) => p.look);
    expect(dressed.length).toBeGreaterThan(0);
    for (const p of dressed) {
      // Away from a stair's step edges, the seams and the fixed-size trim: the middle of the riding surface.
      for (const [fx, fz] of [[0.2, 0.05], [-0.25, -0.2], [0.1, 0.3]]) {
        const lx = fx * p.w, lz = fz * p.d, x = p.x + lx * Math.cos(p.yaw) + lz * Math.sin(p.yaw), z = p.z - lx * Math.sin(p.yaw) + lz * Math.cos(p.yaw);
        if (p.look?.kind === "stairs" && Math.abs(((lz + p.d / 2) % p.look.run) - p.look.run / 2) > p.look.run * 0.3) continue;
        const [bx, bz] = toLocal(p, x, z);
        const want = Math.max(level.height(x, z), p.height(bx, bz));
        const at = down(group, x, z);
        expect(at).toBeDefined();
        expect(Math.abs(at! - want)).toBeLessThan(0.25);
      }
    }
  }
});

test("the fixed-size bands: a trim keeps its metres on a small piece and a big one", () => {
  for (const half of [2, 15]) expect(half - fitAcross(0.4, half, 0.4)).toBeCloseTo(0.4);
  expect(fitAcross(0.5, 15, 0.4)).toBeCloseTo(15);
  expect(fitAcross(-0.2, 15, 0.4)).toBeCloseTo(-(15 - 0.4) / 2);
  expect(fitUp(1, 3, 10, 0.15)).toBeCloseTo(10);
  expect(fitUp(0.9, 3, 10, 0.15)).toBeCloseTo(10 - 0.15);
  expect(fitUp(0, 3, 10, 0.15)).toBeCloseTo(3);
  // A sliver of a column keeps its band in proportion instead of turning inside out.
  expect(fitUp(0.9, 0, 0.1, 0.15)).toBeGreaterThan(0);
});
