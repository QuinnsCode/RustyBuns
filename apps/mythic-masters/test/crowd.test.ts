import { expect, test } from "bun:test";
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { buildCrowd, CAST, CLIPS } from "../src/crowd.ts";

const seats = Array.from({ length: 600 }, (_, i) => ({ pos: new THREE.Vector3(i, 0, 0), yaw: 0 }));

test("the stands seat everyone as one of the recorded cast, a draw call per cast member, and a cheer rises and settles", () => {
  expect(CAST.length).toBe(32); // every recorded cast member still passes codeSplitter's avatar check
  const crowd = buildCrowd(seats, mulberry32(1));
  const meshes = crowd.group.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh);
  expect(meshes.reduce((n, m) => n + m.count, 0)).toBe(600);
  expect(meshes.length).toBe(crowd.draws);
  expect(crowd.draws).toBeLessThanOrEqual(CAST.length);
  // the arms are marked for the shader: each body has vertices on both shoulders
  const arm = meshes[0]!.geometry.getAttribute("aArm");
  const sides = new Set(Array.from({ length: arm.count }, (_, i) => arm.getW(i)));
  expect([...sides].sort()).toEqual([-1, 0, 1]);
  crowd.cheer(1); crowd.update(0.01);
  expect(crowd.state().excite).toBeGreaterThan(0.9);
  for (let i = 0; i < 100; i++) crowd.update(0.05);
  expect(crowd.state().excite).toBe(0);
  expect(crowd.play("clap")).toBe(true);
  crowd.update(1);
  expect(crowd.state()).toMatchObject({ playing: "clap", excite: 1 });
  expect(crowd.play("moonwalk")).toBe(false);
});

test("the recorded takes do what they're named: arms up goes up, clap meets in front, jump leaves the step", () => {
  const take = (name: string) => CLIPS.find((c) => c.name === name)!.frames;
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  expect(mean(take("arms-up").map((f) => f[2]!))).toBeGreaterThan(2.3);
  expect(mean(take("clap").map((f) => f[3]!))).toBeGreaterThan(1);
  expect(Math.max(...take("jump").map((f) => f[0]!))).toBeGreaterThan(0.1);
});
