// The chase camera on a long run: holding W to top speed keeps the board one size on screen, and a
// camera behind a rise comes in rather than sinking into it.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { makeLevel, piece } from "../src/level.ts";
import { Chase } from "../src/render/chase.ts";
import { start } from "../src/sim.ts";

const level = makeLevel({ name: "flat", pieces: [], rails: [], spawns: [{ name: "car", x: 0, z: -90, yaw: 0 }], bounds: { minX: -50, maxX: 50, minZ: -100, maxZ: 400 } });
const BOX = level.bounds;
// What the board covers of the view: its size over the camera's distance, at the lens in use.
const onScreen = (c: Chase, cam: THREE.PerspectiveCamera, b: { x: number; y: number; z: number }) =>
  1 / (c.pos.distanceTo(new THREE.Vector3(b.x, b.y, b.z)) * Math.tan((cam.fov * Math.PI) / 360));

test("a rise between the board and the camera brings the camera in, above the rise", () => {
  const wall = piece("box", "wall", 0, -4, 0, 20, 4, 6, 6); // a 6 m block just behind the board
  const l = makeLevel({ name: "wall", pieces: [wall], rails: [], spawns: [{ name: "car", x: 0, z: 0, yaw: 0 }], bounds: BOX });
  const sim = start(0, 0, 0, l), cam = new THREE.PerspectiveCamera(66, 1.6, 0.1, 2000), chase = new Chase(cam);
  chase.snap(sim, "roadster");
  chase.apply(BOX, l.height);
  expect(chase.pos.z).toBeGreaterThan(-8); // came in from the 10 m rig
  expect(chase.pos.y).toBeGreaterThanOrEqual(l.height(chase.pos.x, chase.pos.z) + 0.5);
});
