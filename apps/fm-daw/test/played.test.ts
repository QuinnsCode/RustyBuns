import { expect, test } from "bun:test";
import * as THREE from "three";
import { Keys, Kit, LIT, keyAt, layout, lowC, partOf } from "../src/studio/played.ts";
import { KIT } from "../src/presets.ts";

test("jam room: the note that sounds presses its own key and lights it, and lets it up after; a hit lights only its drum, which stays on top of its shell and dies away", () => {
  const lay = layout(29), low = lowC(60);
  // the keyboard runs C to C, four octaves: middle C is the second octave's C, C# the black key after it, notes off either end fold in
  expect([keyAt(60, low, lay), keyAt(61, low, lay), keyAt(30, low, lay), keyAt(110, low, lay)]).toEqual([
    { black: false, i: 7 }, { black: true, i: 5 }, { black: true, i: 2 }, { black: false, i: 22 },
  ]);
  const at = (n: number, y: number) => Array.from({ length: n }, (_, i): [number, number, number] => [i * 0.05, y, 0]);
  const wAt = at(lay.whites.length, 0.9), bAt = at(lay.blacks.length, 0.92);
  const white = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), wAt.length);
  const black = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(), bAt.length);
  const rest = new THREE.Color("#040405"), keys = new Keys(white, wAt, black, bAt, lay, 0.2, 0.12, undefined, rest);
  const colour = (mesh: THREE.InstancedMesh, i: number) => { const c = new THREE.Color(); mesh.getColorAt(i, c); return c.getHex(); };
  // where a white key's near end (toward the player, +z) is
  const tip = (i: number) => { const m = new THREE.Matrix4(); white.getMatrixAt(i, m); return new THREE.Vector3(0, 0, 0.1).applyMatrix4(m).y; };
  keys.press([60, 64], low);
  expect(keys.down).toEqual({ whites: [7, 9], blacks: [] });
  expect(tip(7)).toBeLessThan(0.9 - 0.005);
  expect(tip(8)).toBeCloseTo(0.9);
  expect([colour(white, 7), colour(white, 8)]).toEqual([LIT.getHex(), 0xffffff]);
  // a black key lights as brightly, and goes back to its own near-black
  keys.press([61], low);
  expect(colour(black, 5)).toBe(LIT.getHex());
  keys.press([], low);
  expect(tip(7)).toBeCloseTo(0.9);
  expect([colour(white, 7), colour(black, 5)]).toEqual([0xffffff, rest.getHex()]);

  // the demo kit's tracks each land on a drum the room draws
  expect(KIT.filter((t) => t.kind === "drum").map((t) => partOf(t.name))).toEqual(["kick", "snare", "hat", "snare", "tom"]);
  const kit = new Kit(), mats = { snare: new THREE.MeshStandardMaterial(), kick: new THREE.MeshStandardMaterial() };
  const head = new THREE.Object3D();
  head.position.y = 0.081;
  kit.add("snare", head, mats.snare);
  // the kick's head faces away from the stool, so its shell and the pedal's felt light too and the beater swings
  const shell = new THREE.MeshStandardMaterial(), beater = new THREE.Object3D();
  kit.add("kick", new THREE.Object3D(), [mats.kick, shell]);
  kit.swing("kick", beater, 0.45, -0.42);
  kit.hear(new Map([["1:50", "snare"]]));
  kit.tick(0.016, 0);
  // the head itself turns the played colour (a glow alone vanishes on a white head under a lamp) and doesn't sink
  expect(mats.snare.color.b).toBeGreaterThan(mats.snare.color.r);
  expect(mats.snare.emissiveIntensity).toBeGreaterThan(0.2);
  expect(head.position.y).toBe(0.081);
  expect(mats.kick.emissiveIntensity).toBe(0);
  expect(mats.kick.color.getHex()).toBe(0xffffff);
  kit.hear(new Map([["0:36", "kick"]]));
  kit.tick(0.016, 0.016);
  expect([mats.kick, shell].every((m) => m.color.b > m.color.r)).toBe(true);
  expect(beater.rotation.x).toBeCloseTo(-0.42);
  // held, it doesn't strike again; a second and a half later it has died away
  for (let i = 0; i < 90; i++) { kit.hear(new Map([["1:50", "snare"]])); kit.tick(0.016, i * 0.016); }
  expect(kit.rings().snare).toBe(0);
  expect(mats.snare.color.getHex()).toBe(0xffffff);
  expect([shell.color.getHex(), beater.rotation.x]).toEqual([0xffffff, 0.45]);
});
