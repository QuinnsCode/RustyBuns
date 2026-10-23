import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BUILDS, buildFigure, pose, setGun, type BuildId, type Pose } from "../src/ui/figure.ts";

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

  test("poses blend: a frame of a new pose moves part of the way, enough frames get there", () => {
    const f = buildFigure(0, 0.3);
    pose(f, { pose: "stand", speed: 0, dt: 0, roll: 0, pitch: 0 });
    const legL = f.joints.legL!;
    pose(f, { pose: "kneel", speed: 0, dt: 1 / 60, roll: 0, pitch: 0, blend: 14 });
    expect(legL.rotation.x).toBeGreaterThan(0.1);
    expect(legL.rotation.x).toBeLessThan(1.0);
    for (let i = 0; i < 60; i++) pose(f, { pose: "kneel", speed: 0, dt: 1 / 60, roll: 0, pitch: 0, blend: 14 });
    expect(legL.rotation.x).toBeCloseTo(1.5, 2);
  });

  test("strafing swings the legs sideways, running forward swings them fore and aft", () => {
    const swing = (forward: number, side: number) => {
      const f = buildFigure(0, 0.3);
      // Mid-swing once this frame's step is taken.
      f.stride = Math.PI / 2 - (7.5 * 1.9) / 60;
      pose(f, { pose: "stand", speed: 7.5, forward, side, dt: 1 / 60, roll: 0, pitch: 0 });
      const r = f.joints.legL!.rotation;
      return { x: Math.abs(r.x), z: Math.abs(r.z) };
    };
    const ahead = swing(7.5, 0), sideways = swing(0, 7.5);
    expect(ahead.x).toBeGreaterThan(ahead.z);
    expect(sideways.z).toBeGreaterThan(ahead.z);
  });

  test("hanging under a parachute, both hands are up on the risers above the head", () => {
    const f = buildFigure(0, 0.3);
    pose(f, { pose: "hang", speed: 0, dt: 0, roll: 0, pitch: 0 });
    f.root.updateMatrixWorld(true);
    const head = f.head.getWorldPosition(v.clone());
    for (const hand of ["handL", "handR"]) expect(f.root.getObjectByName(hand)!.getWorldPosition(v.clone()).y).toBeGreaterThan(head.y + 0.1);
  });

  test("leaning puts the head out to the side by LEAN_REACH and leaves the feet where they were", () => {
    const f = buildFigure(0, 0.3);
    const where = (lean: number) => {
      pose(f, { pose: "stand", speed: 0, dt: 0, roll: 0, pitch: 0, lean });
      f.root.updateMatrixWorld(true);
      return { head: f.head.getWorldPosition(v.clone()), feet: ["footL", "footR"].map((n) => f.root.getObjectByName(n)!.getWorldPosition(v.clone())) };
    };
    const straight = where(0), right = where(1), left = where(-1);
    expect(Math.abs(right.head.x - 0.6)).toBeLessThan(0.1);
    expect(Math.abs(left.head.x + 0.6)).toBeLessThan(0.1);
    for (const side of [right, left]) side.feet.forEach((p, i) => expect(p.distanceTo(straight.feet[i]!)).toBeLessThan(0.15));
  });

  test("the gun in the hands is the weapon that's up", () => {
    const f = buildFigure(0, 0.3);
    expect(f.gun).toBe("commit");
    setGun(f, "push");
    const hand = f.joints.hand!;
    expect(hand.getObjectByName("gun:push")!.visible).toBe(true);
    expect(hand.getObjectByName("gun:commit")!.visible).toBe(false);
  });
});
