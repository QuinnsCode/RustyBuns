import { expect, test } from "bun:test";
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { buildCrowd, CROWD_MODELS } from "../src/crowd.ts";

const seats = Array.from({ length: 200 }, (_, i) => ({ pos: new THREE.Vector3(i, 0, 0), yaw: 0 }));

test("every seat gets a person, spread over the models, and a cheer lifts the arms then settles", () => {
  const crowd = buildCrowd(seats, mulberry32(1));
  const bodies = crowd.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
  expect(bodies.reduce((n, m) => n + m.count, 0) / 4).toBeGreaterThanOrEqual(200); // torso, head, two arms each (hats add more)
  expect(new Set(bodies.map((m) => m.geometry)).size).toBeGreaterThan(CROWD_MODELS.length);
  const arm = bodies.find((m) => m.geometry instanceof THREE.BoxGeometry && m.geometry.parameters.height === 0.2)!;
  const y = (m: THREE.InstancedMesh) => { const v = new THREE.Vector3(0, -0.2, 0), mm = new THREE.Matrix4(); m.getMatrixAt(0, mm); return v.applyMatrix4(mm).y; };
  crowd.update(0.01);
  const rest = y(arm);
  crowd.cheer(1); crowd.update(0.01);
  expect(y(arm)).toBeGreaterThan(rest + 0.2);
  for (let i = 0; i < 400; i++) crowd.update(0.05);
  expect(y(arm)).toBeCloseTo(rest, 3);
});
