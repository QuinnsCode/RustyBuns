// The Blender Half Dome (blender/landmark.py) at each polygon budget: a mountain standing past the park's west edge, its
// crest as high as the spec says, a sheer face on its west and a long shoulder on its east, unaffected by the fog.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { halfDome } from "../src/levels/half-dome.ts";
import { PEAK_MODELS, type Peak } from "../src/levels/park.ts";
import { dressPeak, PEAK_BUDGETS } from "../src/render/peak.ts";
import { LEVELS } from "../src/levels/index.ts";
import type { ParkLevel } from "../src/levels/park.ts";

const glb = (budget: string) => Bun.file(new URL(`../public/models/landmark-half-dome-${budget}.glb`, import.meta.url)).arrayBuffer();
const peak = halfDome.landmarks!.find((l): l is Peak => l.kind === "peak")!;
const BUDGET = { hi: 30000, mid: 10000, low: 3000 } as const;

test.each([...PEAK_BUDGETS])("the %s Half Dome stands past the park's west edge, crest at the height the spec gives", async (budget) => {
  const g = await dressPeak(peak, await glb(budget), 0xdfe5ec);
  const box = new THREE.Box3().setFromObject(g), at = (v: number) => (v - peak.x) / peak.tall;
  expect(box.max.y - peak.y).toBeGreaterThan(peak.tall * 0.95);
  expect(box.max.y - peak.y).toBeLessThan(peak.tall * 1.05);
  expect(box.min.y).toBeCloseTo(peak.y, 0); // its foot on the ground it is given
  const edge = -(LEVELS.find((l) => l.id === "half-dome")!.load() as ParkLevel).ground.R;
  expect(box.max.x).toBeLessThan(edge + 20); // the toe of the shoulder meets the park, it does not cover it
  expect(at(box.min.x)).toBeGreaterThan(-0.7); // the face is on the west, near the crest...
  expect(at(box.max.x)).toBeGreaterThan(1.2); // ...and the shoulder runs a long way east
  let tris = 0;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    tris += (m.geometry.index?.count ?? 0) / 3;
    expect((m.material as THREE.MeshBasicMaterial).fog).toBe(false);
  });
  expect(tris).toBeLessThan(BUDGET[budget]);
});

test("the west face is sheer and the east shoulder is not", async () => {
  const g = await dressPeak(peak, await glb("mid"), 0xdfe5ec);
  g.updateMatrixWorld(true);
  const rise = (x: number, dx: number) => { // metres of height the crest line gains over `dx` metres of run
    const up = (x0: number) => new THREE.Raycaster(new THREE.Vector3(x0, 5000, peak.z), new THREE.Vector3(0, -1, 0)).intersectObject(g, true)[0]?.point.y ?? peak.y;
    return Math.abs(up(x + dx) - up(x)) / Math.abs(dx);
  };
  const crest = peak.x, face = crest - 0.03 * peak.tall, shoulder = crest + 0.5 * peak.tall;
  expect(rise(face, 0.02 * peak.tall)).toBeGreaterThan(3);
  expect(rise(shoulder, 0.02 * peak.tall)).toBeLessThan(1);
});

// The landmarks for the parks beyond the Sierra (blender/landmarks.py), each normalised like Half Dome: crest at `tall`, foot on `y`.
test.each(PEAK_MODELS.filter((m) => m !== "half-dome").flatMap((m) => PEAK_BUDGETS.map((b) => [m, b] as const)))("the %s landmark at %s stands on its ground with its crest at the height the spec gives", async (model, budget) => {
  const p: Peak = { kind: "peak", model, x: 500, y: 20, z: -300, tall: 240, yaw: 0.3 };
  const g = await dressPeak(p, await Bun.file(new URL(`../public/models/landmark-${model}-${budget}.glb`, import.meta.url)).arrayBuffer(), 0xdfe5ec);
  const box = new THREE.Box3().setFromObject(g);
  expect(box.max.y - p.y).toBeGreaterThan(p.tall * 0.95);
  expect(box.max.y - p.y).toBeLessThan(p.tall * 1.05);
  expect(box.min.y).toBeCloseTo(p.y, 0);
  expect(Math.max(box.max.x - p.x, p.x - box.min.x, box.max.z - p.z, p.z - box.min.z)).toBeLessThan(p.tall * 2.2); // inside the frame peak() expects (x -1..1.5, z +-1.3, turned by yaw)
  let tris = 0;
  g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index?.count ?? m.geometry.attributes.position!.count) / 3; });
  expect(tris).toBeLessThan(BUDGET[budget]);
});
