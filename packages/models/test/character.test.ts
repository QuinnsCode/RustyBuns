// The character wears every part the picker offers (the face maker's too, with its sliders at both ends), stands on the
// floor as a grown-up (a head about a seventh of its height, not a toy's), and its poses do what they say: sitting brings the hips down to a seat with the
// feet still on the floor, playing brings the hands up in front, walking moves the legs. It is alive: it turns its head
// to look at someone, and beams while a note sounds. Its hands have four fingers that tap the keys in turn, its glasses
// reach back to its ears, and a hat tucks a tall style under it.
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

test("every option of every part, and every slider at both ends, builds a grown-up on the floor", () => {
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
    expect(c.height).toBeGreaterThan(1.45);
    expect(c.height).toBeLessThan(2.1);
    // an adult's head: the skull is about a seventh of the height, so even with tall hair or a tall hat it is under a third
    expect(head.max.y - head.min.y).toBeGreaterThan(c.height / 9);
    expect(head.max.y - head.min.y).toBeLessThan(c.height / 3);
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
  // playing keys: both hands up in front (-z) of the body, above the lap
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

test("four fingers a hand, tapping the keys one after another; glasses reach back to the ears; a hat tucks tall hair under it", () => {
  const a = defaultAvatar("Ada");
  const c = character({ ...a, glasses: "round" });
  const fingers = named(c.group, "finger");
  expect(fingers).toHaveLength(8);
  // on keys, at one moment the fingers of a hand are curled by different amounts: they tap in turn
  c.pose({ t: 1.3, seated: true, play: "keys" });
  const curls = fingers.slice(0, 4).map((f) => Math.abs(f.rotation.z).toFixed(2));
  expect(new Set(curls).size).toBeGreaterThan(2);
  // the glasses' arms run from the frames in front of the eyes back to the sides of the head
  c.group.updateMatrixWorld(true);
  const eye = at(named(c.group, "eye")[0]!), temples = named(c.group, "temple");
  expect(temples).toHaveLength(2);
  for (const tm of temples) { const b = box(tm); expect(b.max.z).toBeGreaterThan(eye.z + 0.07); expect(Math.max(Math.abs(b.min.x), Math.abs(b.max.x))).toBeGreaterThan(0.075); }
  c.dispose();
  // a beanie over spikes, a crest or a bun stands no taller than over short hair: nothing pokes through it
  const top = (hair: string, hat: string) => { const f = character({ ...a, hair, hat }); f.pose({ t: 0 }); const y = box(f.head).max.y; f.dispose(); return y; };
  for (const hat of ["beanie", "cap", "hardhat"]) for (const hair of ["spiky", "mohawk", "flat-top", "bun", "topknot", "pompadour"])
    expect([hat, hair, top(hair, hat) <= top("short", hat) + 0.001]).toEqual([hat, hair, true]);
});
