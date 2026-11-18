// Load In's gear: every id in #4849's table builds at its real size, sits on the floor, carries the jacks the
// sound and power math wires up (each on the outside, facing out) and a grab point, and stays cheap to draw.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { GEAR_IDS, GEAR_SIZES, type GearId, gear, gearJacks } from "../src/gear.ts";
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
function reach(id: GearId, from: THREE.Vector3Tuple, dir: THREE.Vector3Tuple, face: number) {
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

test("the DJ mixer's print lies on its top face and knob caps, looking up, inside the plate", () => {
  const g = gear("mixer-dj"), ink = g.getObjectByName("mixer-dj-ink") as THREE.Mesh, [w, h, d] = GEAR_SIZES["mixer-dj"];
  const p = ink.geometry.getAttribute("position"), n = ink.geometry.getAttribute("normal");
  expect(p.count / 3).toBeGreaterThan(100);
  for (let i = 0; i < p.count; i++) {
    expect(n.getY(i)).toBeCloseTo(1, 5);
    expect(Math.abs(p.getX(i))).toBeLessThan(w / 2 - 0.007);
    expect(Math.abs(p.getZ(i))).toBeLessThan(d / 2 - 0.009);
    expect(p.getY(i)).toBeGreaterThan(h - 0.008);
    expect(p.getY(i)).toBeLessThan(h + 0.009); // the field, or the knobs' caps (their pointer lines)
  }
});
