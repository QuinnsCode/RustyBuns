// The character wears every part the picker offers (the face maker's too, with its sliders at both ends), stands on the
// floor as a chunky toy with a big head, and its poses do what they say: sitting brings the hips down to a seat with the
// feet still on the floor, playing brings the hands up in front, walking moves the legs. It is alive: it turns its head
// to look at someone, and beams while a note sounds.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { defaultAvatar, FACE, PARTS, TUNE, TUNE_STEPS, type Avatar } from "@rustybuns/util/avatar";
import { character, type Pose } from "../src/character.ts";

const box = (o: THREE.Object3D) => { o.updateMatrixWorld(true); return new THREE.Box3().setFromObject(o); };
const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
const named = (root: THREE.Object3D, name: string) => { const out: THREE.Object3D[] = []; root.traverse((o) => { if (o.name === name) out.push(o); }); return out; };
/** Where the shoes and hands are after a pose. */
function posed(a: Avatar, p: Pose) {
  const c = character(a);
  c.pose(p);
  c.group.updateMatrixWorld(true);
  return { c, hands: named(c.group, "hand").map(at), feet: named(c.group, "foot").map(at), hips: c.group.children[0]!.position.y };
}

test("every option of every part, and every slider at both ends, builds a toy on the floor with a big head", () => {
  const ada = defaultAvatar("Ada");
  const cases: Partial<Avatar>[] = [
    ...(Object.keys(PARTS) as (keyof typeof PARTS)[]).flatMap((k) => PARTS[k].map((v) => ({ [k]: v }))),
    ...(Object.keys(FACE) as (keyof typeof FACE)[]).flatMap((k) => FACE[k].map((v) => ({ [k]: v }))),
    ...TUNE.flatMap((k) => [{ [k]: -TUNE_STEPS }, { [k]: TUNE_STEPS }]),
  ];
  for (const change of cases) {
    const c = character({ ...ada, ...change });
    c.pose({ t: 0 });
    const b = box(c.group), head = box(c.head);
    expect([change, b.min.y > -0.03 && b.min.y < 0.03]).toEqual([change, true]);
    expect(b.max.y).toBeGreaterThan(1.05);
    expect(b.max.y).toBeLessThan(2.4);
    // a caricature: the head (with its hair and hat) is at least a third of the figure's height
    expect(head.max.y - head.min.y).toBeGreaterThan(c.height / 3);
    c.dispose();
  }
});

test("sitting, playing and walking move the body the way they say", () => {
  const a = { ...defaultAvatar("Ada"), build: "tall" };
  const stand = posed(a, { t: 1 }), sit = posed(a, { t: 1, seated: true });
  expect(stand.feet).toHaveLength(2);
  expect(stand.hands).toHaveLength(2);
  // seated: hips at seat height, feet still on the floor
  expect(sit.hips).toBeLessThan(stand.hips * 0.75);
  for (const f of sit.feet) expect(f.y).toBeLessThan(0.08);
  // playing keys: both hands up in front (-z) of the round belly, above the lap
  const keys = posed(a, { t: 1, seated: true, play: "keys" });
  for (const h of keys.hands) { expect(h.z).toBeLessThan(-0.25); expect(h.y).toBeGreaterThan(sit.hips); }
  // sticks: the hands strike in turn, so they are at different heights mid-beat
  const sticks = posed(a, { t: Math.PI / 18, seated: true, play: "sticks" });
  expect(Math.abs(sticks.hands[0]!.y - sticks.hands[1]!.y)).toBeGreaterThan(0.06);
  // strings: the fretting hand is further out to its side than the strumming one
  const strings = posed(a, { t: 1, play: "strings" });
  expect(Math.abs(strings.hands[0]!.x)).toBeGreaterThan(Math.abs(strings.hands[1]!.x));
  // walking: one foot ahead of the other
  const walk = posed(a, { t: Math.PI / 2 / 10.2, speed: 1.4 }); // the widest stride: 6 + 3 a m/s strides a second
  expect(Math.abs(walk.feet[0]!.z - walk.feet[1]!.z)).toBeGreaterThan(0.08);
  expect(Math.abs(stand.feet[0]!.z - stand.feet[1]!.z)).toBeLessThan(0.02);
});

test("it looks at whoever you point it at, and beams while a note sounds", () => {
  const c = character(defaultAvatar("Ada"));
  const facing = () => { c.group.updateMatrixWorld(true); return new THREE.Vector3(0, 0, -1).applyQuaternion(c.head.getWorldQuaternion(new THREE.Quaternion())); };
  // someone off to one side (+x is to its right as it faces -z): after a moment its face has turned that way
  for (let t = 0; t < 1.5; t += 1 / 30) c.pose({ t, look: { x: 2, y: 1, z: -1 } });
  expect(facing().x).toBeGreaterThan(0.4);
  for (let t = 1.5; t < 3; t += 1 / 30) c.pose({ t, look: { x: -2, y: 1, z: -1 } });
  expect(facing().x).toBeLessThan(-0.4);
  // a note: the happy face shows, and a moment after the note it is gone
  const happy = () => named(c.group, "joy").every((o) => o.visible);
  expect(happy()).toBe(false);
  c.pose({ t: 3.1, note: true });
  expect(happy()).toBe(true);
  c.pose({ t: 3.2 });
  expect(happy()).toBe(true);
  c.pose({ t: 3.8 });
  expect(happy()).toBe(false);
  c.dispose();
});

test("no hair covers the face: looking at an eye from in front, the first thing hit is the face, not hair", () => {
  for (const hair of PARTS.hair) for (const face of FACE.face) {
    const c = character({ ...defaultAvatar("Ada"), hair, face, hairColor: "#c23a6b", hat: "none", glasses: "none", eyes: "dot" });
    c.pose({ t: 0 });
    c.group.updateMatrixWorld(true);
    const eye = at(named(c.group, "eye")[0]!);
    const hit = new THREE.Raycaster(new THREE.Vector3(eye.x, eye.y, -3), new THREE.Vector3(0, 0, 1)).intersectObject(c.group, true)[0];
    const m = hit?.object instanceof THREE.Mesh ? hit.object.material : null;
    expect([hair, face, m instanceof THREE.MeshStandardMaterial ? m.color.getHexString() : "nothing"]).not.toEqual([hair, face, "c23a6b"]);
    c.dispose();
  }
});
