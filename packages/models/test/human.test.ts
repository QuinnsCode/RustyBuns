// The human as eqosys's character picker shows it (#5802): worn from an avatar, it sits on a seat its own height with
// its feet on the floor, its hands come up in front for the keys, and the hair and hats it doesn't have yet are the
// ones the picker marks "soon" (it wears the nearest instead).
import { expect, test } from "bun:test";
import * as THREE from "three";
import { defaultAvatar, PARTS } from "@rustybuns/util/avatar";
import { fromAvatar, human, playArms, seatOf, sit, wearsAsIs } from "../src/human.ts";

const at = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

test("sat on its seat with its feet down, then hands up and forward for the keys", () => {
  for (const build of PARTS.build) {
    const { build: b, outfit, palette } = fromAvatar({ ...defaultAvatar("Ada"), build });
    const body = human(b, outfit, palette), bn = body.bones;
    body.pose({ speed: 0 }, 0);
    body.root.updateMatrixWorld(true);
    const standing = at(bn.handR);

    sit(body, true);
    playArms(body, 0, "keys");
    body.root.updateMatrixWorld(true);
    const { hip, seat } = seatOf(body);
    expect(at(bn.hips).y).toBeCloseTo(hip, 3);
    expect(seat).toBeGreaterThan(0.35);
    expect(seat).toBeLessThan(0.6);
    // the feet still on the floor, under the knees
    for (const f of [bn.footR, bn.footL]) expect(Math.abs(at(f).y)).toBeLessThan(0.12);
    // both hands over the lap and ahead of the body (it faces +z)
    for (const h of [bn.handR, bn.handL]) {
      const p = at(h);
      expect(p.y).toBeGreaterThan(seat);
      expect(p.z).toBeGreaterThan(standing.z + 0.2);
    }
    body.dispose();
  }
});

test("two people of one build don't share a face, one person keeps theirs, and each eye has a coloured iris round a pupil", () => {
  const outfit = { top: "tee", hair: "short", hat: "none" } as const;
  const a = human("average", outfit, {}, 3), again = human("average", outfit, {}, 3), b = human("average", outfit, {}, 4);
  const pos = (h: ReturnType<typeof human>) => h.mesh.geometry.getAttribute("position");
  expect(pos(again)).toBe(pos(a));
  expect(pos(b)).not.toBe(pos(a));
  // the faces differ where a face is (above the chin, in front), not just in a number somewhere
  const pa = pos(a), pb = pos(b);
  expect(pb.count).toBe(pa.count);
  let moved = 0;
  for (let i = 0; i < pa.count; i++) if (pa.getY(i) > a.height - 0.2 && pa.getZ(i) > 0.06 && Math.abs(pa.getZ(i) - pb.getZ(i)) > 0.001) moved++;
  expect(moved).toBeGreaterThan(50);
  // the eye colour comes from the seed unless the palette names one
  const painted = (h: ReturnType<typeof human>, hex: string) => {
    const c = h.mesh.geometry.getAttribute("color"), want = new THREE.Color(hex);
    let n = 0;
    for (let i = 0; i < c.count; i++) if (Math.abs(c.getX(i) - want.r) + Math.abs(c.getY(i) - want.g) + Math.abs(c.getZ(i) - want.b) < 1e-4) n++;
    return n;
  };
  const blue = human("average", outfit, { iris: "#3366cc", pupil: "#010203" }, 3);
  expect(painted(blue, "#3366cc")).toBeGreaterThan(20);
  expect(painted(blue, "#010203")).toBeGreaterThan(20);
  expect(painted(a, "#3366cc")).toBe(0);
  for (const h of [a, again, b, blue]) h.dispose();
});

test("the hair and hats marked soon are the ones it wears as something else", () => {
  for (const [part, key] of [["hair", "hair"], ["hat", "hat"]] as const) {
    for (const v of PARTS[part]) {
      const worn = fromAvatar({ ...defaultAvatar("Ada"), [part]: v }).outfit[key];
      const same = v === "none" ? worn === (part === "hair" ? "bald" : "none") : worn === v;
      expect([part, v, wearsAsIs(part, v)]).toEqual([part, v, same]);
    }
  }
});
