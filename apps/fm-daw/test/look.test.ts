// How a room looks (src/studio/look.ts): the picture quality a visit gets, and textures laid out in metres so a
// plank or a ceiling tile comes out the same size on a small wall and a big one.
import { expect, test } from "bun:test";
import * as THREE from "three";
import { cans, metreUV, pickQuality, surface, useKit, type Quality } from "../src/studio/look.ts";

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

test("the downlights sit a metre off the walls of a small room, so they wash them, and spread out in a hall", () => {
  const offWall = (w: number, d: number) => {
    const at = cans(w, d), xs = at.map(([x]) => x), zs = at.map(([, z]) => z);
    return [w / 2 - Math.max(...xs), d / 2 - Math.max(...zs), at.length];
  };
  const [x, z, n] = offWall(10, 9); // the live room
  expect(x).toBeCloseTo(1.1); expect(z).toBeCloseTo(1.1); expect(n).toBe(9);
  const [hx, , hn] = offWall(26, 32); // the scoring hall: three across, each in the middle of its third
  expect(hx).toBeCloseTo(26 / 6); expect(hn).toBe(9);
  expect(cans(2.4, 2.4)).toEqual([[0, 0]]); // a booth: one can, in the middle
});

test("gear surfaces come from the photo-texture kit once it's set, and the room's own surfaces stay as they were", () => {
  const asked: string[] = [];
  useKit((name, color) => {
    asked.push(`${name} ${color}`);
    return name === "tolex" ? new THREE.MeshStandardMaterial({ name: "kit-tolex" }) : null;
  });
  expect(surface("tolex", "#1a1a1b").name).toBe("kit-tolex");
  expect(surface("tolex", "#1a1a1b")).toBe(surface("tolex", "#1a1a1b")); // one material per colour, asked for once
  expect(surface("rubber", "#1a1a1b").name).toBe("rubber"); // the kit hasn't got it: look.ts makes its own
  expect(asked).toEqual(["tolex #1a1a1b", "rubber #1a1a1b"]);
});
