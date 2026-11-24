// The set dressing that moves: a drum machine on a table runs its step chase with the band.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { DECOR } from "../src/studio/builder.ts";
import { chaseSteps, prop, STEP_LAMPS } from "../src/studio/props.ts";

test("a drum machine's step lamps chase the running sixteenth, and show the downbeats when it's stopped", () => {
  const g = prop({ kind: "drumMachine", at: [0, 0], yaw: 0, ...DECOR.drumMachine!, seed: 1 });
  const lamps = g.getObjectByName(STEP_LAMPS);
  if (!(lamps instanceof THREE.InstancedMesh)) throw new Error("no step lamps");
  const row = () => Array.from({ length: lamps.count }, (_, i) => { const c = new THREE.Color(); lamps.getColorAt(i, c); return c.r > 0.5 ? "#" : "."; }).join("");
  chaseSteps(g, 5);
  expect(row()).toBe(".....#..........");
  chaseSteps(g, null);
  expect(row()).toBe("#...#...#...#...");
});
