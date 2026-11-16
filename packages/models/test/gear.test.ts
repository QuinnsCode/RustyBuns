// Load In's gear: every id in #4849's table builds at its real size, sits on the floor, carries the jacks the
// sound and power math wires up (each on the outside, facing out) and a grab point, and stays cheap to draw.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { GEAR_IDS, GEAR_SIZES, type GearId, gear, gearJacks } from "../src/gear.ts";
import { triangles } from "../src/index.ts";

const n = (stem: string, k: number) => Array.from({ length: k }, (_, i) => `${stem}-${i + 1}`);
const JACKS: Record<GearId, string[]> = {
  "top-12-powered": ["power-in", "xlr-in", "xlr-out"],
  "top-15-passive": ["speaker-in", "speaker-out"],
  "sub-18": ["speaker-in", "speaker-out"],
  "wedge-12": ["speaker-in", "speaker-out"],
  "amp-head": ["inst-in", "speaker-out", "power-in"],
  "cab-4x12": ["speaker-in"],
  "amp-rack-4u": ["xlr-in-1", "xlr-in-2", "speaker-out-1", "speaker-out-2", "power-in"],
  "mixer-small": [...n("xlr-in", 12), "xlr-out-1", "xlr-out-2", "power-in"],
  "generator-7kva": n("power-out", 4),
  "distro-box": [...n("power-out", 6), "power-in"],
  "cable-ramp-2ch": [],
  "road-case-m": [],
  "stand-tripod": [],
  "mic-stand": [],
  guitar: ["inst-out"],
};

test.each(GEAR_IDS)("%s builds at its size, on the floor, with its jacks facing out and a grab", (id) => {
  const g = gear(id);
  g.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3()).toArray();
  size.forEach((s, i) => expect(Math.abs(s - GEAR_SIZES[id][i]) / GEAR_SIZES[id][i]).toBeLessThan(0.1));
  expect(Math.abs(box.min.y)).toBeLessThan(0.005);
  expect(triangles(g)).toBeLessThan(1500);

  const jacks = gearJacks(g);
  expect([...jacks.keys()].sort()).toEqual([...JACKS[id]].sort());
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

test("ramps link end to end: one's b end meets the next one's a end", () => {
  const r = gear("cable-ramp-2ch"), a = r.getObjectByName("link-a")!, b = r.getObjectByName("link-b")!;
  expect(b.position.x - a.position.x).toBeCloseTo(GEAR_SIZES["cable-ramp-2ch"][0], 3);
});
