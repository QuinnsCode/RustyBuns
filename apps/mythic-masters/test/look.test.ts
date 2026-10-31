import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as THREE from "three";
import { loadGlb } from "@rustybuns/rig/model";
import { balls, gaze, pupils } from "../src/eyes.ts";
import { smoothNormals } from "../src/smooth.ts";

// Two triangles meeting along the z axis, folded `deg` from flat, each with its own copy of the shared edge
// (as the exporter splits a hard edge): the shape a decimated hide is made of.
function fold(deg: number) {
  const t = (deg * Math.PI) / 180;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, -1, 0, 0, 0, 0, 0, Math.cos(t), Math.sin(t), 0, 0, 0, 1], 3));
  g.computeVertexNormals();
  return g;
}
const normal = (g: THREE.BufferGeometry, i: number) => new THREE.Vector3().fromBufferAttribute(g.getAttribute("normal"), i);

describe("smoothNormals", () => {
  test.each([
    [40, true],   // a fold the decimator left: the copies along the edge share one normal, so it shades round
    [110, false], // a horn's edge or a claw: stays sharp
  ])("a %i° fold smooths: %p", (deg, smooth) => {
    const g = fold(deg);
    smoothNormals([g]);
    expect(normal(g, 0).angleTo(normal(g, 3)) < 1e-4).toBe(smooth);
    expect(normal(g, 2).angleTo(normal(g, 4)) > 0.1).toBe(true); // the far corners are alone and keep their own
  });

  test("a part and the body meeting at one spot blend across the two geometries", () => {
    const a = fold(30), b = fold(30);
    const tilted = normal(a, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.35);
    b.getAttribute("normal").setXYZ(0, tilted.x, tilted.y, tilted.z);
    smoothNormals([a, b]);
    expect(normal(a, 0).angleTo(normal(b, 0))).toBeLessThan(1e-4);
  });
});

describe("eyes", () => {
  test("every beast's eye balls get a pupil, one per ball, facing forward and out to its own side", async () => {
    // Hodag's sheet: two glowing eyes on its head (the dark nostrils are another material)
    const model = await loadGlb(readFileSync(join(import.meta.dir, "../public/models/hodag.glb")).buffer as ArrayBuffer, "hodag");
    const part = model.parts.find((p) => !Array.isArray(p.material) && p.material.name === "eye")!;
    const found = balls(part.geometry);
    expect(found).toHaveLength(2);
    expect(Math.sign(found[0]!.centre.z)).toBe(-Math.sign(found[1]!.centre.z));
    for (const b of found) { const d = gaze(b); expect(d.x).toBeGreaterThan(0.5); expect(Math.sign(d.z)).toBe(Math.sign(b.centre.z)); }
    const n = part.geometry.getAttribute("position").count;
    const p = pupils(part.geometry, new Uint16Array(n * 4).fill(3), new Float32Array(n * 4).fill(0.25))!;
    expect(p.getAttribute("skinIndex").array[0]).toBe(3);
    expect(p.getAttribute("position").count).toBe(p.getAttribute("skinWeight").count);
  });
});
