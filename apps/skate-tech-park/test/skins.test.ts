// The two skins over one transform, headless: the board is a few draw calls standing on its wheels
// with its nose toward +z, and Tab's swap hands over from one skin to the other in a fraction of a second.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { DECK, fingerboard, roadster } from "../src/models.ts";
import { SWAP_TIME, Skins } from "../src/render/skins.ts";

const meshes = (g: THREE.Object3D) => {
  let n = 0;
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++; });
  return n;
};
const PIVOT = { fingerboard: 0.45, roadster: 0.6 };

test("the fingerboard is a few draw calls, on its wheels, deck longer than wide, nose kicked up", () => {
  const b = fingerboard();
  expect(meshes(b)).toBeLessThanOrEqual(20);
  const box = new THREE.Box3().setFromObject(b);
  expect(Math.abs(box.min.y)).toBeLessThan(0.05);
  const size = box.getSize(new THREE.Vector3());
  expect(size.z).toBeGreaterThan(DECK.length - 0.01);
  expect(size.z / size.x).toBeGreaterThan(2.5);
  // Kicked: the deck's ends stand higher than its middle.
  const at = (z: number) => {
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 5, z), new THREE.Vector3(0, -1, 0));
    return ray.intersectObject(b, true)[0].point.y;
  };
  expect(at(DECK.length / 2 - 0.05)).toBeGreaterThan(at(0) + 0.1);
});

test("Tab hands over from one skin to the other, and both rest at full size", () => {
  const skins = new Skins({ fingerboard: fingerboard(), roadster: roadster() }, "roadster", PIVOT);
  expect(skins.pivot("fingerboard").visible).toBe(false);
  expect(skins.show("roadster")).toBe(false); // already showing: nothing to swap
  expect(skins.show("fingerboard")).toBe(true);
  expect(skins.swapping).toBe(true);
  skins.update(SWAP_TIME * 0.3);
  expect(skins.pivot("fingerboard").scale.x).toBeLessThan(1); // growing in
  expect(skins.pivot("roadster").scale.x).toBeLessThan(1); // shrinking away
  skins.update(SWAP_TIME);
  expect(skins.swapping).toBe(false);
  expect(skins.pivot("roadster").visible).toBe(false);
  expect(skins.pivot("fingerboard").visible).toBe(true);
  expect(skins.pivot("fingerboard").scale.x).toBe(1);
});

test("a skin turns about its own middle, so a flip keeps it where it was", () => {
  const skins = new Skins({ fingerboard: fingerboard(), roadster: roadster() }, "fingerboard", PIVOT);
  const centre = () => { skins.root.updateMatrixWorld(true); return new THREE.Box3().setFromObject(skins.pivot()).getCenter(new THREE.Vector3()); };
  const before = centre();
  skins.pivot().rotation.z = Math.PI;
  expect(centre().distanceTo(before)).toBeLessThan(0.6);
});

test("the parts picker repaints the board in place: deck, trucks, wheels and grip each take their colour", () => {
  const b = fingerboard();
  const colours = () => {
    const seen: number[] = [];
    b.traverse((o) => { if ((o as THREE.Mesh).isMesh) seen.push(((o as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex()); });
    return seen;
  };
  const before = colours();
  b.userData.paint({ deck: "teal", trucks: "gold", wheels: "red", grip: "grey" });
  const after = colours();
  expect(after.length).toBe(before.length);
  for (const hex of [0x1f8a8a, 0xc9a227, 0xd6382b, 0x6b6e73]) expect(after).toContain(hex);
  b.userData.paint({ deck: "nope", trucks: "nope", wheels: "nope", grip: "nope" }); // a stale saved choice falls back to the first
  expect(colours()).toEqual(before);
});

test("the grip tape marks the nose: an orange cap over the +z end only, so a board rolling fakie reads as backwards", () => {
  const b = fingerboard();
  const mark = (b.userData.nose as THREE.Mesh);
  const box = new THREE.Box3().setFromObject(mark);
  expect(box.max.z).toBeGreaterThan(DECK.length / 2 - 0.2);
  expect(box.min.z).toBeGreaterThan(0); // nothing printed toward the tail
  b.userData.paint({ deck: "teal", trucks: "gold", wheels: "red", grip: "grey" });
  expect((mark.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xff7a1a); // the graphic stays the same through the parts picker
});
