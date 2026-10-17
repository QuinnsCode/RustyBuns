// The Blender characters on the page's joints: every part the outfits name is in the model, feet land on the
// ground, and a character made before the model loaded changes into it when it does.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { makeBigfoot, makeCharacter, pose, useCharacterModel, type Character } from "../src/ui/characters.ts";
import { HATS, type Look } from "../src/hunt/game.ts";

const look = (hat: Look["hat"], pack = true): Look => ({ shirt: 2, pants: 1, skin: 3, hat, pack });

function triangles(ch: Character) {
  let n = 0;
  ch.root.traverse((o) => {
    const g = (o as THREE.Mesh).isMesh && o !== ch.beam ? (o as THREE.Mesh).geometry : null;
    if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  return n;
}
function feet(ch: Character) {
  ch.root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  for (const o of [ch.knees[0], ch.knees[1]]) box.expandByObject(o);
  return box.min.y;
}

test("characters change into the Blender model and stand on the ground", async () => {
  const early = makeCharacter("camper", look("cap"), "early");
  const torso = (ch: Character) => (ch.upper.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh).geometry;
  const before = torso(early);

  const bytes = await Bun.file(new URL("../public/models/characters.glb", import.meta.url)).arrayBuffer();
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  const names = new Set(gltf.scene.children.map((o) => o.name));
  useCharacterModel(gltf.scene);
  expect(torso(early)).not.toBe(before);
  expect(torso(early)).toBe(torso(makeCharacter("camper", look("cap"), "late"))); // shared, not rebuilt

  const all = [...HATS.map((h) => makeCharacter("camper", look(h), "c")), makeCharacter("ranger", look("none"), "r")];
  for (const ch of [early, ...all]) {
    expect(triangles(ch)).toBeLessThan(3000);
    expect(Math.abs(feet(ch))).toBeLessThan(0.02);
  }
  const ranger = all.at(-1)!;
  expect(ranger.light && ranger.beam && ranger.head.children.includes(ranger.light)).toBeTruthy();
  const big = makeBigfoot();
  expect(triangles(big)).toBeLessThan(3000);
  // every part an outfit asks for is in the file (a missing one would leave a joint bare)
  for (const n of ["thigh", "shin", "boot", "pelvis", "torso", "rangerTorso", "pack", "head", "hair", "hairHat", "beanie",
    "cap", "bucket", "rangerHat", "flashlight", "lens", "bfTorso", "bfHead"]) expect(names.has(n)).toBe(true);
});
