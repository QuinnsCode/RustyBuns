import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { BUILDS, buildFigure, createCrowd, pose, setGun, type BuildId, type Pose } from "../src/ui/figure.ts";

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
  test("kneeling is lower, prone lies flat with the head out in front", () => {
    const stand = posed("stand").head.y;
    expect(posed("kneel").head.y).toBeLessThan(stand - 0.25);
    const prone = posed("prone");
    expect(prone.head.y).toBeLessThan(0.5);
    expect(prone.head.z).toBeLessThan(-0.6);
    expect(prone.low).toBeGreaterThan(-0.15);
  });

  test.each(Object.keys(BUILDS) as BuildId[])("the %s build stands on the ground", (b) => {
    expect(Math.abs(posed("stand", b).low)).toBeLessThan(0.15);
    expect(Math.abs(posed("kneel", b).low)).toBeLessThan(0.15);
  });

  test("the gun in the hands is the weapon that's up", () => {
    const f = buildFigure(0, 0.3);
    expect(f.gun).toBe("commit");
    setGun(f, "push");
    const hand = f.joints.hand!;
    expect(hand.getObjectByName("gun:push")!.visible).toBe(true);
    expect(hand.getObjectByName("gun:commit")!.visible).toBe(false);
  });

  test("a crowd draws every soldier's parts in a few instanced meshes, each where its joint is", () => {
    const crowd = createCrowd();
    const figs = [0xe8590c, 0x1f1f1f, 0x64748b].flatMap((c) => (["thick", "average", "lank"] as BuildId[]).map((b) => buildFigure(c, 0.3, b)));
    figs.forEach((f, i) => {
      f.root.position.set(i * 2, 0, -i);
      pose(f, { pose: "stand", speed: 3, dt: 0.1, roll: 0, pitch: 0 });
      crowd.add(f);
    });
    figs[1]!.root.visible = false;
    crowd.update();
    const meshes = crowd.root.children.filter((c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh && c.name !== "ink");
    const drawn = meshes.reduce((n, m) => n + m.count, 0);
    expect(drawn).toBe(figs.reduce((n, f) => n + (f.root.visible ? f.parts.length : 0), 0));
    expect(meshes.length).toBeLessThan(40);
    // The hand part of figure 0 is where its (invisible) stand-in is, and it has its own colour.
    const f = figs[0]!, hand = f.parts.find((p) => p.name === "handR")!;
    const m = new THREE.Matrix4(), want = hand.getWorldPosition(new THREE.Vector3());
    const hit = meshes.some((im) => {
      if (im.geometry !== hand.geometry) return false;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, m);
        if (new THREE.Vector3().setFromMatrixPosition(m).distanceTo(want) < 1e-6) return im.instanceColor!.getX(i) > 0.5;
      }
      return false;
    });
    expect(hit).toBe(true);
    // Nobody visible, nothing drawn.
    figs.forEach((g) => (g.root.visible = false));
    crowd.update();
    expect(meshes.every((x) => x.count === 0)).toBe(true);
  });
});
