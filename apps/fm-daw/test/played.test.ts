import { expect, test } from "bun:test";
import * as THREE from "three";
import { Keys, Kit, keyAt, layout, lowC, partOf } from "../src/studio/played.ts";
import { KIT } from "../src/presets.ts";

test("jam room: the note that sounds presses its own key, and lets it up after; a hit lights only its drum, which dies away", () => {
  const lay = layout(29), low = lowC(60);
  // the keyboard runs C to C, four octaves: middle C is the second octave's C, C# the black key after it, notes off either end fold in
  expect([keyAt(60, low, lay), keyAt(61, low, lay), keyAt(30, low, lay), keyAt(110, low, lay)]).toEqual([
    { black: false, i: 7 }, { black: true, i: 5 }, { black: true, i: 2 }, { black: false, i: 22 },
  ]);
  const at = (n: number, y: number) => Array.from({ length: n }, (_, i): [number, number, number] => [i * 0.05, y, 0]);
  const wAt = at(lay.whites.length, 0.9), bAt = at(lay.blacks.length, 0.92);
  const white = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), wAt.length);
  const black = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), bAt.length);
  const keys = new Keys(white, wAt, black, bAt, lay, 0.2, 0.12);
  // where a white key's near end (toward the player, +z) is
  const tip = (i: number) => { const m = new THREE.Matrix4(); white.getMatrixAt(i, m); return new THREE.Vector3(0, 0, 0.1).applyMatrix4(m).y; };
  keys.press([60, 64], low);
  expect(keys.down).toEqual({ whites: [7, 9], blacks: [] });
  expect(tip(7)).toBeLessThan(0.9 - 0.005);
  expect(tip(8)).toBeCloseTo(0.9);
  keys.press([], low);
  expect(tip(7)).toBeCloseTo(0.9);

  // the demo kit's tracks each land on a drum the room draws
  expect(KIT.filter((t) => t.kind === "drum").map((t) => partOf(t.name))).toEqual(["kick", "snare", "hat", "snare", "tom"]);
  const kit = new Kit(), mats = { snare: new THREE.MeshStandardMaterial(), kick: new THREE.MeshStandardMaterial() };
  kit.add("snare", new THREE.Object3D(), mats.snare);
  kit.add("kick", new THREE.Object3D(), mats.kick);
  kit.hear(new Map([["1:50", "snare"]]));
  kit.tick(0.016, 0);
  expect(mats.snare.emissiveIntensity).toBeGreaterThan(0.5);
  expect(mats.kick.emissiveIntensity).toBe(0);
  // held, it doesn't strike again; a second later it has died away
  for (let i = 0; i < 60; i++) { kit.hear(new Map([["1:50", "snare"]])); kit.tick(0.016, i * 0.016); }
  expect(kit.rings().snare).toBe(0);
});
