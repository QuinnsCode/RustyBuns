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

test("the hair and hats marked soon are the ones it wears as something else", () => {
  for (const [part, key] of [["hair", "hair"], ["hat", "hat"]] as const) {
    for (const v of PARTS[part]) {
      const worn = fromAvatar({ ...defaultAvatar("Ada"), [part]: v }).outfit[key];
      const same = v === "none" ? worn === (part === "hair" ? "bald" : "none") : worn === v;
      expect([part, v, wearsAsIs(part, v)]).toEqual([part, v, same]);
    }
  }
});
