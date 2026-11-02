// The park's ground is tiles, each with a coarse version for the distance: the camera drops the tiles behind it
// and swaps far ones to 8 m,.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { GROUND_FAR, GROUND_TILE, groundMesh } from "../src/levels/ground.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { level as loadLevel } from "./parks.ts";

// the grain texture is drawn on a canvas; any 2d context will do headless
(globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => new Proxy({ createRadialGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : () => {}), set: () => true }) }) };

test("the ground is a LOD per tile: fine near, coarse past the far distance,", async () => {
  const level = (await loadLevel("el-capitan")) as ParkLevel, ground = groundMesh(level);
  const lods = ground.children as THREE.LOD[];
  expect(lods.length).toBeGreaterThan(1);
  const tri = (m: THREE.Mesh) => m.geometry.index!.count / 3;
  const cam = new THREE.PerspectiveCamera();
  const unbuilt = lods.filter((l) => !(l.levels[0]!.object as THREE.Mesh).geometry.index).length;
  expect(unbuilt).toBe(lods.length); // nothing fine is built until a camera comes near
  for (const lod of lods) {
    lod.updateMatrixWorld(true);
    cam.position.copy(lod.position).setY(30);
    cam.updateMatrixWorld(true);
    lod.update(cam); // the camera over a tile builds its fine version
    const [near, far] = lod.levels.map((l) => l.object as THREE.Mesh) as [THREE.Mesh, THREE.Mesh];
    expect(lod.levels.map((l) => l.distance)).toEqual([0, GROUND_FAR]);
    expect(tri(far)).toBeLessThan(tri(near) / 8);
    near.geometry.computeBoundingBox();
    expect(near.geometry.boundingBox!.max.x - near.geometry.boundingBox!.min.x).toBeLessThanOrEqual(GROUND_TILE + 1e-3);
  }
  // a camera at the first tile's middle sees it fine and a tile 300 m off coarse
  const mid = lods[0]!;
  mid.updateMatrixWorld(true);
  cam.position.copy(mid.position).setY(30);
  cam.updateMatrixWorld(true);
  mid.update(cam);
  expect(mid.getCurrentLevel()).toBe(0);
  cam.position.x += 300;
  cam.updateMatrixWorld(true);
  mid.update(cam);
  expect(mid.getCurrentLevel()).toBe(1);
});
