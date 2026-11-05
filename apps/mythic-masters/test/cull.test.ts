// The open world's plants are handed to the GPU only where the camera looks (src/world/cull.ts, #3664). What a player
// would notice going wrong: turning round and finding the trees behind them gone, or a tree in view missing.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { Culled } from "../src/world/cull.ts";

test("only the plants in view are drawn, and turning round brings the ones behind back", () => {
  const mesh = new THREE.InstancedMesh(new THREE.ConeGeometry(0.5, 1), new THREE.MeshBasicMaterial(), 8);
  // four trees ahead (-z) and four behind (+z), each with its own colour
  const at = [-40, -60, -80, -100, 40, 60, 80, 100], o = new THREE.Object3D();
  at.forEach((z, i) => { o.position.set(i % 2 ? 3 : -3, 0, z); o.updateMatrix(); mesh.setMatrixAt(i, o.matrix); mesh.setColorAt(i, new THREE.Color(i / 10, 0, 0)); });
  const c = new Culled(mesh);
  c.keep(at.length);

  const cam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1000), frustum = new THREE.Frustum();
  const look = (z: number) => { cam.position.set(0, 2, 0); cam.lookAt(0, 2, z); cam.updateMatrixWorld(); frustum.setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)); };
  const drawn = () => Array.from({ length: mesh.count }, (_, k) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(k, m); const c2 = new THREE.Color(); mesh.getColorAt(k, c2); return [new THREE.Vector3().setFromMatrixPosition(m).z, Math.round(c2.r * 10)]; });

  look(-1);
  expect(c.show(frustum, 0)).toBe(4);
  expect(drawn()).toEqual([[-40, 0], [-60, 1], [-80, 2], [-100, 3]]);

  look(1); // turned round: the slots the first pick wrote are written again from what was planted
  expect(c.show(frustum, 0)).toBe(4);
  expect(drawn()).toEqual([[40, 4], [60, 5], [80, 6], [100, 7]]);
  expect(c.planted).toBe(8);
});
