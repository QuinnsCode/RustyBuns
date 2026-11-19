// Qollab Studio's bass synth: every seed grows the same synth again, stands on the floor within the width asked, and
// has the keys it says (37 or 44, from C), cheap to draw.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { MONO_KEY_FRONT, MONO_KEY_TOP, monosynth } from "../src/monosynth.ts";
import { triangles } from "../src/index.ts";

test("a mono synth for each seed: the same again, on the floor, inside its width, its keys where it says", () => {
  const counts = new Set<number>();
  for (let seed = 1; seed <= 8; seed++) {
    const s = monosynth(seed, { fit: 0.82 });
    counts.add(s.count);
    const box = new THREE.Box3().setFromObject(s.group);
    expect(Math.abs(box.min.y)).toBeLessThan(0.005);
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(0.82 + 1e-6);
    expect(s.keys.whiteAt.length + s.keys.blackAt.length).toBe(s.count);
    expect(s.keys.whiteAt.every(([, y, z]) => y < MONO_KEY_TOP && z < MONO_KEY_FRONT)).toBe(true);
    expect(triangles(s.group)).toBeLessThan(20000);
    expect(monosynth(seed, { fit: 0.82 }).group.children.map((c) => c.name)).toEqual(s.group.children.map((c) => c.name));
  }
  expect([...counts].sort()).toEqual([37, 44]);
});
