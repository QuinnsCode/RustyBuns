// Flick profiles: a finger on the pad's board, through a profile, into the same step() the page runs.
import { expect, test } from "bun:test";
import { matchStroke, parseProfile, pickProfile, type Profile } from "../src/flick.ts";
import { PROFILES } from "../src/flick-profiles.ts";
import { Gestures } from "../src/gesture.ts";
import { makeLevel } from "../src/level.ts";
import { DT, IDLE, start, step } from "../src/sim.ts";

const fingerboard = PROFILES.find((p) => p.name === "fingerboard")!;
const flat = makeLevel({ name: "t", pieces: [], rails: [], spawns: [], bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 } });

test("on the fingerboard layout a tap on the tail ollies, and a tap on the nose then a flick off it lands a nollie kickflip", () => {
  const g = new Gestures(fingerboard);
  const sk = Object.assign(start(0, 0, 0, flat), { speed: 6 });
  const ride = (secs: number, press?: (t: number) => void) => {
    for (let i = 0; i < secs / DT; i++) { press?.(i * DT); step(sk, { ...IDLE, ...g.take() }, flat); }
  };
  g.down(200, 380, 0, 0.9); g.up(200, 380, 0.08); // tail tap
  ride(2);
  expect(sk.last?.name).toBe("Air");
  const plain = sk.last!.points;

  g.down(200, 120, 0, 0.1); g.up(201, 121, 0.08); // nose tap
  let flicked = false;
  ride(2, () => {
    if (sk.air && sk.airTime > 0.1 && !flicked) { g.down(200, 120, 0, 0.1); g.up(280, 125, 0.1); flicked = true; } // off the nose, to the right
  });
  expect(sk.last?.name).toBe("nollie kickflip x2"); // chained on the ollie
  expect(sk.last!.points).toBeGreaterThan(plain);
});

test("every profile has a name of its own, pops an ollie, and no stroke is hidden behind an earlier one", () => {
  expect(PROFILES.length).toBe(20);
  expect(new Set(PROFILES.map((p) => p.name)).size).toBe(PROFILES.length);
  for (const p of PROFILES) {
    expect(p.strokes.some((s) => s.pop === "ollie")).toBe(true);
    for (const s of p.strokes) {
      const zone = s.from === "any" ? "mid" : s.from;
      const len = (s.min ?? p.minDrag) + 1, rad = s.dir === "tap" ? 0 : (s.dir * Math.PI) / 180;
      const got = s.dir === "tap" ? matchStroke(p, zone, 0, 0, 0) : matchStroke(p, zone, Math.cos(rad) * len, -Math.sin(rad) * len, 0.2);
      expect({ profile: p.name, pop: got?.pop, flick: got?.flick }).toEqual({ profile: p.name, pop: s.pop, flick: s.flick });
    }
  }
});

test("a profile can be handed in by name or as JSON; a wrong shape falls back to the library's first", () => {
  const custom = { name: "mine", side: "left", strokes: [{ from: "any", dir: 90, pop: "ollie" }, { from: "nose", dir: "tap", pop: "nollie" }] };
  const b64 = btoa(JSON.stringify(custom)).replace(/\+/g, "-").replace(/\//g, "_");
  expect(pickProfile(PROFILES, "compass", null).name).toBe("compass");
  expect(pickProfile(PROFILES, null, "tap pop").name).toBe("tap pop");
  for (const handed of [JSON.stringify(custom), b64]) {
    const p = pickProfile(PROFILES, handed, null);
    expect({ name: p.name, side: p.side, strokes: p.strokes.length, minDrag: p.minDrag }).toEqual({ name: "mine", side: "left", strokes: 2, minDrag: PROFILES[0].minDrag });
  }
  for (const bad of ["{not json", '{"strokes":[{"from":"top","dir":90,"pop":"ollie"}]}', '{"strokes":[{"from":"any","dir":90,"flick":"rocket"}]}', '{"strokes":"up"}', "[]"]) {
    expect(pickProfile(PROFILES, bad, null)).toBe(PROFILES[0]);
  }
  const base: Profile = PROFILES[0];
  expect(parseProfile({ strokes: [{ from: "any", dir: 400, pop: "ollie" }] }, base)).toBeNull(); // off the compass
});
