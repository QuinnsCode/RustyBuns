// How a room looks (src/studio/look.ts): the picture quality a visit gets, and textures laid out in metres so a
// plank or a ceiling tile comes out the same size on a small wall and a big one.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { metreUV, pickQuality, type Quality } from "../src/studio/look.ts";

test("the link picks the quality, then what this browser chose last, else high unless it's a phone", () => {
  const cases: [string, string | null, boolean, Quality][] = [
    ["?quality=low", "high", false, "low"],
    ["?room=x&quality=high", "low", true, "high"],
    ["", "low", false, "low"],
    ["", null, false, "high"],
    ["", null, true, "low"],
    ["?quality=ultra", "nonsense", false, "high"],
  ];
  for (const [search, stored, phone, want] of cases) expect(pickQuality(search, stored, phone)).toBe(want);
});

test("a wall's texture runs in metres along it and up it, whatever its size", () => {
  for (const [w, h] of [[2, 3], [26, 13]]) {
    const uv = metreUV(new THREE.BoxGeometry(w, h, 0.12)).getAttribute("uv");
    const us: number[] = [], vs: number[] = [];
    for (let i = 0; i < uv.count; i++) { us.push(uv.getX(i)); vs.push(uv.getY(i)); }
    expect(Math.max(...us) - Math.min(...us)).toBeCloseTo(w);
    expect(Math.max(...vs) - Math.min(...vs)).toBeCloseTo(h);
  }
});
