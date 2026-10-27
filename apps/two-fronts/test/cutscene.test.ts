// Cutscenes are data on a clock: these check the clock, and that every scene's cues make sense.
import { expect, test } from "bun:test";
import { actorsAt, cameraAt, castOf, firedBetween, lengthOf, place, wordsAt, type Cutscene } from "../src/battle/cutscene.ts";
import { CUTSCENES, introOf, mossbackSting, prologueOf, rideOf, STORIES } from "../src/battle/cutscenes.ts";

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

// The drop: a ship rattles in, two crates fall, one chute opens.
const drop: Cutscene = {
  id: "d", faction: "marines",
  cues: [
    { at: 0, do: "actor", id: "ship", as: { prop: "dropship" }, x: 0, y: 12, z: -30 },
    { at: 0, do: "fly", id: "ship", x: 0, y: 10, z: 0, dur: 4, wobble: 0.5 },
    { at: 4, do: "actor", id: "a", as: { prop: "crate" }, x: -1, y: 10, z: 0 },
    { at: 4, do: "actor", id: "b", as: { prop: "crate" }, x: 1, y: 10, z: 0 },
    { at: 4, do: "drop", id: "a", dur: 5, height: 10, x: -4, z: 0, chute: 1 },
    { at: 4, do: "drop", id: "b", dur: 1.5, height: 10 },
  ],
};

test("a ship flies in rattling, one crate floats down under its chute and the other is a brick", () => {
  const at = (t: number, id: string) => actorsAt(drop, t).find((a) => a.id === id)!;
  expect(at(0, "ship")).toMatchObject({ y: 12, z: -30, chute: false });
  expect(at(2, "ship").moving).toBe(true);
  expect(Math.abs(at(2, "ship").roll)).toBeGreaterThan(0);
  expect(at(4.5, "ship").z).toBeCloseTo(0, 0);
  // Before the chute: both fall, both tumbling, neither under a canopy.
  expect(at(4.5, "a")).toMatchObject({ flying: true, chute: false });
  expect(at(4.5, "b")).toMatchObject({ flying: true, chute: false });
  expect(at(4.5, "b").y).toBeLessThan(at(4.5, "a").y);
  // The chute opens a second in: that crate hangs under it and drifts; the other has already hit.
  expect(at(5.5, "a")).toMatchObject({ flying: false, chute: true });
  expect(at(5.5, "a").y).toBeGreaterThan(5);
  expect(at(5.5, "b")).toMatchObject({ y: 0, flying: false, chute: false });
  // Both down at the end, where they were sent.
  expect(at(9.1, "a")).toMatchObject({ y: 0, x: -4, flying: false, chute: false });
});

test("a scene's frame turns onto the field like the battle's yaw", () => {
  expect(place({ x: 10, z: 5, yaw: 0 }, 1, -2)).toEqual({ x: 11, z: 3 });
  const p = place({ x: 0, z: 0, yaw: Math.PI }, 0, -10); // facing +z: ahead is +z
  expect(p.x).toBeCloseTo(0);
  expect(p.z).toBeCloseTo(10);
});

test("every scripted scene only talks about actors it put on stage, and ends", () => {
  const kinds = ["shield", "capital", "spaceport", "cannon", "canyon", "jungle"] as const;
  const intros = (["marines", "wooka"] as const).flatMap((f) => kinds.flatMap((k) => [introOf(f, k), prologueOf(f, k)]));
  expect(prologueOf("marines", "shield")?.id).toBe("marines-drop");
  expect(prologueOf("wooka", "shield")).toBeNull();
  const rides = STORIES.map((_, n) => rideOf(n));
  for (const s of [...Object.values(CUTSCENES), ...intros.filter((c): c is Cutscene => !!c), ...rides, mossbackSting("marines"), mossbackSting("wooka")]) {
    const cast = new Set(castOf(s).map((c) => c.id));
    for (const c of s.cues) {
      if ("id" in c && c.id && c.do !== "actor") expect(cast.has(c.id)).toBe(true);
      if (c.do === "toss") expect(cast.has(c.what)).toBe(true);
    }
    expect(lengthOf(s)).toBeGreaterThan(2);
    expect(lengthOf(s)).toBeLessThan(20);
  }
});

test("each ride down is the next seat's story, a short clip, and they go round them all", () => {
  const rides = STORIES.map((_, n) => rideOf(n));
  expect(new Set(rides.map((r) => r.id)).size).toBe(STORIES.length);
  expect(rideOf(STORIES.length).id).toBe(rides[0]!.id);
  expect(new Set(STORIES.map((s) => s.kind))).toEqual(new Set(["bad", "weird", "scary", "revenge"]));
  for (const r of rides) {
    expect(lengthOf(r)).toBeGreaterThanOrEqual(5);
    expect(lengthOf(r)).toBeLessThanOrEqual(15);
    // The one across has walked off down the line by the end.
    expect(actorsAt(r, lengthOf(r) - 0.01).find((a) => a.id === "teller")!.z).toBeLessThan(-5);
  }
});
