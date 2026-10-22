// The Blender kit (blender/kit.py) fitted to real levels: still two draw calls, and at every budget the
// dressed ramps, stairs, blocks, boulders, logs and hips show their top where the sim's floor is, on the plaza and
// on a park's slopes.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { makeLevel, toLocal } from "../src/level.ts";
import { bowl, fallenLog, join, outcrop, rockFace } from "../src/levels/pieces.ts";
import { KIT_BUDGETS, fitAcross, fitUp, loadKit } from "../src/render/kit.ts";
import { levelMeshes } from "../src/render/pieces.ts";

const read = (f: string) => Bun.file(new URL(`../public/${f}`, import.meta.url)).arrayBuffer();
const down = (m: THREE.Object3D, x: number, z: number) =>
  new THREE.Raycaster(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0)).intersectObject(m, true)[0]?.point.y;

test.each([...KIT_BUDGETS])("the %s kit dresses ramps, stairs, blocks, boulders, logs, hips and the picnic table where the sim rides them", async (budget) => {
  const kit = await loadKit(budget, read);
  const kinds = new Set<string>();
  for (const id of ["plaza", "yosemite-falls", "half-dome", "mariposa-grove"]) {
    const level = LEVELS.find((e) => e.id === id)!.load(), ground = "ground" in level ? (level as ParkLevel).ground.height : undefined;
    const group = levelMeshes(level, ground, kit);
    expect(group.children.length).toBeLessThanOrEqual(2);
    const dressed = level.pieces.filter((p) => p.look);
    expect(dressed.length).toBeGreaterThan(0);
    for (const p of dressed) {
      kinds.add(p.look!.kind);
      // Away from a stair's step edges, the seams and the fixed-size trim: the middle of the riding surface.
      for (const [fx, fz] of [[0.2, 0.05], [-0.25, -0.2], [0.1, 0.3]]) {
        const lx = fx * p.w, lz = fz * p.d, x = p.x + lx * Math.cos(p.yaw) + lz * Math.sin(p.yaw), z = p.z - lx * Math.sin(p.yaw) + lz * Math.cos(p.yaw);
        if (p.look?.kind === "stairs" && Math.abs(((lz + p.d / 2) % p.look.run) - p.look.run / 2) > p.look.run * 0.3) continue;
        const [bx, bz] = toLocal(p, x, z);
        const want = Math.max(level.height(x, z), p.height(bx, bz));
        const at = down(group, x, z);
        expect(at).toBeDefined();
        expect(Math.abs(at! - want)).toBeLessThan(budget === "low" ? 0.5 : 0.25); // the low budget is coarse: a big ramp on a hillside is off by a few tenths
      }
    }
  }
  expect([...kinds].sort()).toEqual(["bench", "block", "bowl", "cliff", "hip", "log", "ramp", "rock", "stairs", "table"]);
});

test.each([...KIT_BUDGETS])("the %s landscape: a boulder, a rock face that turns to vertical, a log and a pool are drawn where they are ridden", async (budget) => {
  const kit = await loadKit(budget, read);
  const part = join(outcrop({ x: -60, z: 0 }), rockFace({ x: -20, z: 0 }), fallenLog({ x: 20, z: 0 }), bowl({ x: 70, z: 0 }, { w: 30, d: 22 }));
  expect(part.pieces.every((p) => p.look)).toBe(true);
  const level = makeLevel({ name: "landscape", pieces: part.pieces, rails: part.rails, spawns: [], bounds: { minX: -100, maxX: 100, minZ: -40, maxZ: 40 } });
  const group = levelMeshes(level, undefined, kit);
  expect(group.children.length).toBeLessThanOrEqual(2);
  const [rock, face, log, pool] = part.pieces as [typeof part.pieces[0], ...typeof part.pieces];
  // The crest of the boulder and of the log, the shelf behind the face's lip, and the pool's floor and deck.
  const spots: [number, number][] = [
    [rock!.x, rock!.z], [log!.x, log!.z], [face!.x, face!.z + face!.d / 2 - 1], [face!.x + face!.w * 0.3, face!.z + face!.d / 2 - 1],
    [pool!.x, pool!.z], [pool!.x + pool!.w / 2 - 2, pool!.z], [pool!.x, pool!.z - pool!.d / 2 + 2],
  ];
  for (const [x, z] of spots) {
    const at = down(group, x, z);
    expect(at).toBeDefined();
    expect(Math.abs(at! - level.height(x, z))).toBeLessThan(0.25);
  }
  // The face really does turn to vertical: it only ever climbs along z, ends at its full height, and its last steps are the steep ones.
  const hs = Array.from({ length: 61 }, (_, i) => face!.height(0, -face!.d / 2 + (face!.d * i) / 60));
  const rises = hs.slice(1).map((h, i) => h - hs[i]!);
  expect(rises.every((r) => r >= -1e-9)).toBe(true);
  expect(hs.at(-1)).toBeCloseTo(face!.h1);
  expect(Math.max(...rises)).toBeGreaterThan(face!.h1 * 0.15);
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
