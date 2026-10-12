import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BUILDS, buildFigure, pose, type BuildId, type Pose } from "../src/ui/figure.ts";

const v = new THREE.Vector3();
/** Where a figure's head is, and its lowest point, once posed. */
function posed(p: Pose, build: BuildId = "average") {
  const f = buildFigure(0x1f1f1f, 0.3, build);
  pose(f, { pose: p, speed: 0, dt: 0, roll: 0.5, pitch: 0 });
  f.root.updateMatrixWorld(true);
  const head = f.head.getWorldPosition(v.clone());
  const box = new THREE.Box3().setFromObject(f.root);
  return { head, low: box.min.y, high: box.max.y };
}

describe("figure", () => {
  test("standing, the head is up top and the feet are on the ground", () => {
    const { head, low } = posed("stand");
    expect(head.y).toBeGreaterThan(1.5);
    expect(Math.abs(low)).toBeLessThan(0.15);
  });

  test("kneeling is lower, prone lies flat with the head out in front", () => {
    const stand = posed("stand").head.y;
    expect(posed("kneel").head.y).toBeLessThan(stand - 0.25);
    const prone = posed("prone");
    expect(prone.head.y).toBeLessThan(0.5);
    expect(prone.head.z).toBeLessThan(-0.6);
    expect(prone.low).toBeGreaterThan(-0.15);
  });

  test("hands up on its knees when downed, nothing below the ground", () => {
    const s = posed("surrender");
    expect(s.head.y).toBeLessThan(posed("stand").head.y);
    expect(s.high).toBeGreaterThan(s.head.y + 0.3);
    expect(s.low).toBeGreaterThan(-0.15);
  });

  test.each(Object.keys(BUILDS) as BuildId[])("the %s build stands on the ground", (b) => {
    expect(Math.abs(posed("stand", b).low)).toBeLessThan(0.15);
    expect(Math.abs(posed("kneel", b).low)).toBeLessThan(0.15);
  });

  test("lank is the tallest, thick the widest", () => {
    const width = (b: BuildId) => {
      const f = buildFigure(0, 0.3, b);
      pose(f, { pose: "stand", speed: 0, dt: 0, roll: 0, pitch: -Math.PI / 2 });
      f.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(f.root.getObjectByName("hips")!);
      return box.max.x - box.min.x;
    };
    expect(posed("stand", "lank").head.y).toBeGreaterThan(posed("stand", "average").head.y);
    expect(posed("stand", "thick").head.y).toBeLessThan(posed("stand", "average").head.y);
    expect(width("thick")).toBeGreaterThan(width("average"));
    expect(width("lank")).toBeLessThan(width("average"));
  });
});
