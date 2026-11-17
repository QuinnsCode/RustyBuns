// The character wears every part the picker offers, stands on the floor at about a person's height, and its poses do
// what they say: sitting brings the hips down to a chair with the feet still on the floor, playing brings the hands up in
// front, and walking moves the legs.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { defaultAvatar, PARTS, type Avatar } from "@rustybuns/util/avatar";
import { character, type Pose } from "../src/character.ts";

const box = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
/** The lowest and the frontmost points of the shoes and hands, after a pose. */
function posed(a: Avatar, p: Pose) {
  const c = character(a);
  c.pose(p);
  c.group.updateMatrixWorld(true);
  const hands: THREE.Vector3[] = [], feet: THREE.Vector3[] = [];
  c.group.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !(o.geometry instanceof THREE.SphereGeometry)) return;
    const m = o.material;
    if (!(m instanceof THREE.MeshStandardMaterial)) return;
    if (m.color.getHexString() === "16191c" && o.geometry.parameters.radius === 0.06) feet.push(at(o));
    if (o.geometry.parameters.radius === 0.045 && m.color.getHexString() === a.skin.slice(1)) hands.push(at(o));
  });
  return { c, hands, feet, hips: c.group.children[0]!.position.y };
}

test("every option of every part builds, standing on the floor at about a person's height", () => {
  for (const k of Object.keys(PARTS) as (keyof typeof PARTS)[]) for (const v of PARTS[k]) {
    const c = character({ ...defaultAvatar("Ada"), [k]: v });
    c.pose({ t: 0 });
    const b = box(c.group);
    expect(b.min.y).toBeGreaterThan(-0.03);
    expect(b.min.y).toBeLessThan(0.03);
    expect(b.max.y).toBeGreaterThan(1.4);
    expect(b.max.y).toBeLessThan(2.6);
    c.dispose();
  }
});

test("sitting, playing and walking move the body the way they say", () => {
  const a = { ...defaultAvatar("Ada"), build: "tall" };
  const stand = posed(a, { t: 1 }), sit = posed(a, { t: 1, seated: true });
  expect(stand.feet).toHaveLength(2);
  expect(stand.hands).toHaveLength(2);
  // seated: hips at chair height, feet still on the floor
  expect(sit.hips).toBeLessThan(stand.hips * 0.62);
  for (const f of sit.feet) expect(f.y).toBeLessThan(0.06);
  // playing keys: both hands up in front (-z), at about lap height
  const keys = posed(a, { t: 1, seated: true, play: "keys" });
  for (const h of keys.hands) { expect(h.z).toBeLessThan(-0.25); expect(h.y).toBeGreaterThan(sit.hips); }
  // sticks: the hands strike in turn, so they are at different heights mid-beat
  const sticks = posed(a, { t: Math.PI / 18, seated: true, play: "sticks" });
  expect(Math.abs(sticks.hands[0]!.y - sticks.hands[1]!.y)).toBeGreaterThan(0.1);
  // strings: the fretting hand is further out to its side than the strumming one
  const strings = posed(a, { t: 1, play: "strings" });
  expect(Math.abs(strings.hands[0]!.x)).toBeGreaterThan(Math.abs(strings.hands[1]!.x));
  // walking: one foot ahead of the other
  const walk = posed(a, { t: 0.3, speed: 1.4 });
  expect(Math.abs(walk.feet[0]!.z - walk.feet[1]!.z)).toBeGreaterThan(0.15);
  expect(Math.abs(stand.feet[0]!.z - stand.feet[1]!.z)).toBeLessThan(0.02);
});

test("no hair covers the face: looking at an eye from in front, the first thing hit is the face, not hair", () => {
  for (const hair of PARTS.hair) {
    const c = character({ ...defaultAvatar("Ada"), hair, hairColor: "#c23a6b", hat: "none", glasses: "none", eyes: "dot" });
    c.pose({ t: 0 });
    c.group.updateMatrixWorld(true);
    const eye = c.head.localToWorld(new THREE.Vector3(0.04, 0.0125, 0));
    const hit = new THREE.Raycaster(new THREE.Vector3(eye.x, eye.y, -3), new THREE.Vector3(0, 0, 1)).intersectObject(c.group, true)[0];
    const m = hit?.object instanceof THREE.Mesh ? hit.object.material : null;
    expect([hair, m instanceof THREE.MeshStandardMaterial ? m.color.getHexString() : "nothing"]).not.toEqual([hair, "c23a6b"]);
    c.dispose();
  }
});
