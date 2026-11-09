import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Gaits } from "../src/world/bearer.ts";

/** The built figure (`bun run bearer`), parsed as the page loads it. */
async function figure(): Promise<GLTF> {
  const bytes = readFileSync(new URL("../public/models/bearer.glb", import.meta.url));
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return new Promise((ok, bad) => new GLTFLoader().parse(buf, "", ok, bad));
}

test("the bearer stands, walks off, breaks into a run and stops again, on its own skinned figure", async () => {
  const g = await figure();
  const skinned: THREE.SkinnedMesh[] = [];
  g.scene.traverse((o) => { if (o instanceof THREE.SkinnedMesh) skinned.push(o); });
  // one skinned body, a draw per material (body, cover, glow), and the clips the game plays it with
  expect({ meshes: skinned.length, clips: g.animations.map((c) => c.name).sort() }).toEqual({ meshes: 3, clips: ["cast", "idle", "look", "run", "walk"] });

  const gaits = new Gaits(g.scene, g.animations), seen: string[] = [];
  const go = (speed: number, secs: number) => { for (let t = 0; t < secs; t += 1 / 60) { gaits.update(speed / 60, 1 / 60); if (seen.at(-1) !== gaits.gait) seen.push(gaits.gait); } };
  go(0, 1); go(1.6, 1); go(12, 1); go(0, 1);
  expect(seen).toEqual(["idle", "walk", "run", "walk", "idle"]);
  // left standing, it looks round about it once, then stands again
  go(0, 20);
  expect(seen.slice(5)).toEqual(["look", "idle"]);
});
