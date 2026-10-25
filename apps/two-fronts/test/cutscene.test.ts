// Cutscenes are data on a clock: these check the clock, and that every scene's cues make sense.
import { expect, test } from "bun:test";
import { actorsAt, cameraAt, castOf, firedBetween, lengthOf, place, wordsAt, type Cutscene } from "../src/battle/cutscene.ts";
import { CUTSCENES, introOf, mossbackSting } from "../src/battle/cutscenes.ts";

const scene: Cutscene = {
  id: "t", faction: "wooka",
  cues: [
    { at: 0, do: "actor", id: "big", as: { wooka: "chub" }, x: 0, z: 0 },
    { at: 0, do: "actor", id: "small", as: { wooka: "fodder" }, x: 1, z: 0 },
    { at: 1, do: "walk", id: "big", x: 0, z: -10, dur: 2 },
    { at: 4, do: "toss", id: "big", what: "small", x: 1, z: -25, dur: 2, height: 8 },
    { at: 5, do: "say", id: "small", text: "WHEE", dur: 1 },
    { at: 6.5, do: "sound", noise: "boom" },
    { at: 0, do: "camera", from: [0, 2, 5], to: [0, 2, 1], look: [0, 1, 0], dur: 4 },
    { at: 7, do: "gone", id: "big" },
  ],
};

test("actors walk, get thrown along an arc and leave the stage on cue", () => {
  const at = (t: number, id: string) => actorsAt(scene, t).find((a) => a.id === id);
  expect(at(0.5, "big")).toMatchObject({ x: 0, z: 0, moving: false });
  expect(at(2, "big")!.z).toBeCloseTo(-5);
  expect(at(2, "big")!.moving).toBe(true);
  expect(at(3.5, "big")!.z).toBeCloseTo(-10);
  expect(at(5, "small")).toMatchObject({ flying: true });
  expect(at(5, "small")!.y).toBeCloseTo(8);
  expect(at(6.5, "small")).toMatchObject({ x: 1, z: -25, y: 0, flying: false });
  expect(at(7.5, "big")).toBeUndefined();
});

test("words, the camera and one-off cues come and go on the clock", () => {
  expect(wordsAt(scene, 4.9).bubbles).toEqual([]);
  expect(wordsAt(scene, 5.5).bubbles).toEqual([{ id: "small", text: "WHEE" }]);
  expect(cameraAt(scene, 0)!.pos).toEqual([0, 2, 5]);
  expect(cameraAt(scene, 9)!.pos).toEqual([0, 2, 1]);
  expect(firedBetween(scene, 6, 7).map((c) => c.do)).toEqual(["sound"]);
  expect(firedBetween(scene, 6.5, 7)).toEqual([]);
  expect(lengthOf(scene)).toBe(7);
});

test("a scene's frame turns onto the field like the battle's yaw", () => {
  expect(place({ x: 10, z: 5, yaw: 0 }, 1, -2)).toEqual({ x: 11, z: 3 });
  const p = place({ x: 0, z: 0, yaw: Math.PI }, 0, -10); // facing +z: ahead is +z
  expect(p.x).toBeCloseTo(0);
  expect(p.z).toBeCloseTo(10);
});

test("every scripted scene only talks about actors it put on stage, and ends", () => {
  for (const s of [...Object.values(CUTSCENES), ...(["marines", "wooka"] as const).flatMap((f) => (["shield", "capital", "spaceport", "cannon", "canyon", "jungle"] as const).map((k) => introOf(f, k))), mossbackSting("marines"), mossbackSting("wooka")]) {
    const cast = new Set(castOf(s).map((c) => c.id));
    for (const c of s.cues) {
      if ("id" in c && c.id && c.do !== "actor") expect(cast.has(c.id)).toBe(true);
      if (c.do === "toss") expect(cast.has(c.what)).toBe(true);
    }
    expect(lengthOf(s)).toBeGreaterThan(2);
    expect(lengthOf(s)).toBeLessThan(20);
  }
});
