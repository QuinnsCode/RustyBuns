// The skate pieces' look, headless: however many pieces a level has, they are two draw calls; the
// mesher's surface follows each piece's own height function; and its sides are solid, facing out.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";
import { piece } from "../src/level.ts";
import { TILE, levelMeshes, pieceGeometry } from "../src/render/pieces.ts";
import { build, level as loadLevel } from "./parks.ts";

const draws = (g: THREE.Object3D) => { let n = 0; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };

test.each(LEVELS.map((e) => [e.name, e.id]))("%s: every piece and rail is two draw calls a tile", async (_, id) => {
  const level = await loadLevel(id), park = "ground" in level ? (level as ParkLevel).ground.height : undefined;
  const group = levelMeshes(level, park);
  const tiles = new Set(group.children.map((m) => m.name === "pieces" || m.name === "rails" ? m.name : "?"));
  expect(tiles.has("?")).toBe(false);
  expect(draws(group)).toBeLessThanOrEqual(2 * Math.ceil(2 * 700 / TILE) ** 2); // a few dozen at most, however many pieces
  expect(group.children.some((m) => m.name === "pieces")).toBe(level.pieces.length > 0);
  // The look costs vertices, not draw calls: a park stays a few hundred thousand.
  const verts = group.children.reduce((n, m) => n + (m as THREE.Mesh).geometry.attributes.position.count, 0);
  expect(verts).toBeLessThan(600000);
});

test("the meshed surface sits where the piece's height says, on a kicker and a stair set", async () => {
  const plaza = await build(LEVELS[0]!);
  const down = (m: THREE.Object3D, x: number, z: number) => new THREE.Raycaster(new THREE.Vector3(x, 50, z), new THREE.Vector3(0, -1, 0)).intersectObject(m, true)[0]?.point.y;
  const mesh = levelMeshes(plaza);
  for (const p of plaza.pieces) {
    for (const [fx, fz] of [[0, 0], [0.3, 0.2], [-0.25, -0.3]]) {
      const lx = fx * p.w, lz = fz * p.d, x = p.x + lx * Math.cos(p.yaw) + lz * Math.sin(p.yaw), z = p.z - lx * Math.sin(p.yaw) + lz * Math.cos(p.yaw);
      const at = down(mesh, x, z);
      // Pieces can overlap; the mesh's top is the highest of them, as the sim's floor is.
      expect(at).toBeDefined();
      expect(Math.abs(at! - plaza.height(x, z))).toBeLessThan(0.2);
    }
  }
});

test("a block is a closed solid whose sides face outward", () => {
  const g = pieceGeometry(piece("box", "block", 0, 0, 0, 4, 4, 1, 1), 0);
  g.computeBoundingBox();
  expect(g.boundingBox!.min.y).toBe(0);
  expect(g.boundingBox!.max.y).toBe(1);
  // Every vertex normal on a side wall points away from the centre.
  const pos = g.attributes.position, nor = g.attributes.normal;
  let walls = 0;
  for (let i = 0; i < pos.count; i++) {
    if (Math.abs(nor.getY(i)) > 0.5) continue;
    walls++;
    expect(nor.getX(i) * pos.getX(i) + nor.getZ(i) * pos.getZ(i)).toBeGreaterThan(0);
  }
  expect(walls).toBeGreaterThan(10);
});

test("a park's pieces are split into tiles, so the camera and the sun's shadow box can drop the far ones", async () => {
  const level = await loadLevel("el-capitan"), group = levelMeshes(level, (level as ParkLevel).ground.height);
  const pieces = group.children.filter((m) => m.name === "pieces") as THREE.Mesh[];
  expect(pieces.length).toBeGreaterThan(1);
  const rider = level.spawns[0]!, cam = new THREE.OrthographicCamera(-60, 60, 60, -60, 0.1, 200);
  cam.position.set(rider.x, 100, rider.z);
  cam.lookAt(rider.x, 0, rider.z);
  cam.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  const seen = pieces.filter((m) => frustum.intersectsObject(m)).length;
  expect(seen).toBeLessThan(pieces.length);
});
