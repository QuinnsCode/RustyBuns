// Load In's gear: every id in #4849's table builds at its real size, sits on the floor, carries the jacks the
// sound and power math wires up (each on the outside, facing out) and a grab point, and stays cheap to draw.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { GEAR_IDS, GEAR_SIZES, RIG_IDS, RIG_SIZES, STOMP_SIZE, type GearId, gear, gearJacks, rigging, stompbox } from "../src/gear.ts";
import { triangles } from "../src/index.ts";
import { GEAR_IDS as catalogIds, gear as catalogGear, jackNames } from "../../gear/src/catalog.ts";

// The sound and power math's catalog (lane B). It imports nothing, so the models package can read it without a
// dependency on it; this pins the join: the same ids, sizes and jack names on both sides.
const book = new Map(catalogIds.map((id) => [id, catalogGear(id)]));

test("the models and the catalog list the same gear at the same sizes", () => {
  expect<string[]>([...GEAR_IDS].sort()).toEqual([...catalogIds].sort());
  for (const id of GEAR_IDS) { const { w, h, d } = book.get(id)!.size; expect<number[]>([...GEAR_SIZES[id]]).toEqual([w, h, d]); }
});

test.each(GEAR_IDS)("%s builds at its size, on the floor, with its jacks facing out and a grab", (id) => {
  const g = gear(id);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()).toArray();
  size.forEach((s, i) => expect(Math.abs(s - GEAR_SIZES[id][i]) / GEAR_SIZES[id][i]).toBeLessThan(0.1));
  expect(Math.abs(box.min.y)).toBeLessThan(0.005);
  expect(triangles(g)).toBeLessThan(5000);

  const jacks = gearJacks(g);
  expect([...jacks.keys()].sort()).toEqual(jackNames(book.get(id)!).sort());
  const centre = box.getCenter(new THREE.Vector3());
  for (const [name, j] of jacks) {
    const out = new THREE.Vector3(0, 0, 1).applyQuaternion(j.quaternion);
    // out of the box, not buried: a plug coming in along -z reaches it from outside the model
    expect(j.position.clone().sub(centre).dot(out), name).toBeGreaterThan(0);
    expect(box.distanceToPoint(j.position.clone().addScaledVector(out, 0.05)), name).toBeGreaterThan(0.03);
  }
  expect(g.getObjectByName("grab")).toBeDefined();
});

test("copies share geometry; a stand opens to the height asked, kept between 1.2 and 2 m", () => {
  const a = gear("sub-18"), b = gear("sub-18");
  expect((a.children[0] as THREE.Mesh).geometry).toBe((b.children[0] as THREE.Mesh).geometry);
  for (const [ask, got] of [[1.6, 1.6], [3, 2]]) {
    const s = gear("stand-tripod", { height: ask });
    expect(new THREE.Box3().setFromObject(s).max.y).toBeCloseTo(got, 2);
    expect(s.getObjectByName("pole")!.position.y).toBeCloseTo(got, 5);
  }
});

test("a line array box hinges at its front, one box height between its top and bottom pins", () => {
  const g = gear("line-array-10"), top = g.getObjectByName("hinge-top")!.position, bottom = g.getObjectByName("hinge-bottom")!.position;
  expect(top.z).toBeGreaterThan(GEAR_SIZES["line-array-10"][2] / 4);
  expect(top.z).toBeCloseTo(bottom.z, 5);
  expect(top.y - bottom.y).toBeGreaterThan(GEAR_SIZES["line-array-10"][1] * 0.85);
});

test("ramps link end to end: one's b end meets the next one's a end", () => {
  const r = gear("cable-ramp-2ch"), a = r.getObjectByName("link-a")!, b = r.getObjectByName("link-b")!;
  expect(b.position.x - a.position.x).toBeCloseTo(GEAR_SIZES["cable-ramp-2ch"][0], 3);
});

test("a speaker's perforated grille is one flat sheet; its edge bends back as a solid lip, so no holes run round it", () => {
  for (const id of ["top-12-powered", "sub-18", "wedge-12"] as const) {
    const g = gear(id), sheet = g.getObjectByName(`${id}-grille`) as THREE.Mesh;
    const n = sheet.geometry.getAttribute("normal"), first = new THREE.Vector3().fromBufferAttribute(n, 0);
    for (let i = 0; i < n.count; i++) expect(new THREE.Vector3().fromBufferAttribute(n, i).dot(first), id).toBeGreaterThan(0.999);
    expect(first.z, id).toBeGreaterThan(0.5);
  }
});

// How far into a model a ray from outside gets past `face` (a coordinate along `dir`) before it hits something
// other than the grille's sheet.
function reach(id: GearId, from: readonly [number, number, number], dir: readonly [number, number, number], face: number) {
  const g = gear(id);
  g.updateMatrixWorld(true);
  const d = new THREE.Vector3(...dir), hits = new THREE.Raycaster(new THREE.Vector3(...from), d).intersectObject(g, true).filter((h) => !h.object.name.endsWith("-grille"));
  return hits[0].point.dot(d) - face;
}

test.each([
  // [what, id, from, along, the face's own coordinate along it, how deep a real one goes at least]
  ["the PA top's woofer, 7 cm back behind its grille", "top-12-powered", [0, 0.3, 1], [0, 0, -1], -0.18, 0.03],
  ["the PA top's handle, a pocket sunk in its top", "top-12-powered", [0, 1, 0.01], [0, -1, 0], -0.575, 0.025],
  ["the PA top's side handle", "top-12-powered", [1, 0.36, -0.01], [-1, 0, 0], -0.16, 0.025],
  ["the sub's port, a slot right across the bottom of its front", "sub-18", [0, 0.084, 1], [0, 0, -1], -0.361, 0.1],
  ["the sub's side handle", "sub-18", [1, 0.42, 0], [-1, 0, 0], -0.27, 0.03],
] as const)("%s is a hollow you see into", (_, id, from, dir, face, deep) => {
  expect(reach(id, from, dir, face)).toBeGreaterThan(deep);
});

test.each(RIG_IDS)("the rig's %s builds at its size and stays cheap to draw", (id) => {
  const g = rigging(id);
  g.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3()).toArray();
  size.forEach((s, i) => expect(Math.abs(s - RIG_SIZES[id][i])).toBeLessThan(0.01));
  expect(triangles(g)).toBeLessThan(5000);
});

test("a frame pins onto the top box, and the motor's hook bites its shackle with the jacks facing out", () => {
  const box = gear("line-array-10"), frame = rigging("flying-frame"), motor = rigging("chain-motor");
  frame.position.y = GEAR_SIZES["line-array-10"][1];
  // hang the motor over the pick-up, its chain plumb, and run the hook down to it
  frame.updateMatrixWorld(true);
  const pickup = frame.getObjectByName("pickup")!.getWorldPosition(new THREE.Vector3()), chain = motor.getObjectByName("chain")!.position;
  motor.position.set(pickup.x - chain.x, 4, pickup.z - chain.z);
  const hook = motor.getObjectByName("part:hook")!;
  hook.position.y = pickup.y - motor.position.y + motor.userData.bite;
  for (const o of [box, frame, motor]) o.updateMatrixWorld(true);

  const at = (o: THREE.Object3D, name: string) => o.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
  expect(at(frame, "hinge-bottom").distanceTo(at(box, "hinge-top"))).toBeLessThan(0.002);
  const bite = hook.getWorldPosition(new THREE.Vector3()).setY(hook.getWorldPosition(new THREE.Vector3()).y - motor.userData.bite);
  expect(bite.distanceTo(pickup)).toBeLessThan(0.002);
  // the hook hangs under the motor's chain guide, and the motor's own hook is at its top
  expect(at(motor, "hang").y).toBeCloseTo(motor.position.y + 0.74, 3);
  const jacks = gearJacks(motor), centre = new THREE.Box3().setFromObject(motor).getCenter(new THREE.Vector3());
  expect([...jacks.keys()].sort()).toEqual(["control-in", "power-in"]);
  for (const j of jacks.values()) expect(j.getWorldPosition(new THREE.Vector3()).sub(centre).dot(new THREE.Vector3(0, 0, 1).applyQuaternion(j.quaternion))).toBeGreaterThan(0);
});

test("a stompbox builds at the size asked, its jacks out of each end and its footswitch on the lid", () => {
  for (const size of [STOMP_SIZE, [0.12, 0.06, 0.2] as THREE.Vector3Tuple]) {
    const g = stompbox(size);
    g.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(g), got = box.getSize(new THREE.Vector3()).toArray();
    got.forEach((s, i) => expect(Math.abs(s - size[i])).toBeLessThan(0.004));
    expect(Math.abs(box.min.y)).toBeLessThan(0.001);
    const jacks = gearJacks(g);
    expect(jacks.get("in")!.position.x).toBeGreaterThan(size[0] / 2);
    expect(jacks.get("out")!.position.x).toBeLessThan(-size[0] / 2);
    expect(g.getObjectByName("switch")!.position.y).toBeGreaterThan(size[1] - 0.012);
    expect(triangles(g)).toBeLessThan(2000);
  }
});
