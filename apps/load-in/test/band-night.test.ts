// Band night as a crew does it: mics and the DI on their marks, each into the stage box, the snake to the desk, then a
// line check with the band. A clean night passes; a dead cable and a crossed pair are found by ear and fixed (a spare
// swapped in, a repatch at the stage box); the bass DI's hum goes with its ground lift, and a power cord laid along a
// mic cable hums until it is moved.
import { expect, test } from "bun:test";
import type { Fault, KeyedCable } from "@rustybuns/gear";
import { BAND_NIGHT, INPUTS, type LaidCable, ZONES, check, faultsFor, jobs, judge, night, show } from "../src/venues/band-night.ts";
import { type World, newWorld } from "../src/sim.ts";

/** The stage set: each mic and the DI on its mark, the stage box at the stage's edge, the desk and the fan at the back. */
function setUp(faults: Fault[]): World {
  const w = newWorld(BAND_NIGHT);
  const at = (key: string, x: number, z: number) => Object.assign(w.items.find((i) => i.key === key)!, { x, z });
  for (const l of INPUTS) at(l.source, l.mark.x, l.mark.z);
  at("stage-box", -1, 2.7);
  at("desk", 2.8, 9.4);
  at("fan", 2.6, 9.0);
  night(w).faults = faults;
  return w;
}

const xlr = (key: string, source: string, input: number): KeyedCable => ({ key, kind: "xlr", lengthM: 10, from: [source, "xlr-out"], to: ["stage-box", `xlr-in-${input}`] });
const base: KeyedCable[] = [
  { key: "power-5", kind: "power", lengthM: 5, from: ["desk-wall", "power-out-1"], to: ["desk", "power-in"] },
  { key: "snake", kind: "multi", lengthM: 30, from: ["stage-box", "multi-out"], to: ["fan", "multi-in"] },
];
/** Each input into the stage box input of its own number, on the case's cables a to f. */
const patch = (cable = (ch: number) => `xlr-${"abcdef"[ch - 1]}`, input = (ch: number) => ch) => [...base, ...INPUTS.map((l) => xlr(cable(l.channel), l.source, input(l.channel)))];
const on = new Set(["desk"]);

/** Line-check every channel in order, as the band plays one at a time. */
const lineCheck = (w: World, runs: KeyedCable[]) => INPUTS.map((l) => check(w, runs, on, l.channel)!);

test("a clean night: every input up clean on its channel at line check, and the show passes", () => {
  const w = setUp([]);
  night(w).phantom = true;
  const heard = lineCheck(w, patch());
  expect(heard.map((h) => [h.on, h.sound])).toEqual(INPUTS.map((l) => [l.channel, "clean"]));
  expect(jobs(w, patch(), judge(w, patch(), on)).filter((j) => !j.done)).toEqual([]);
  expect(show(w, patch(), on)).toMatchObject({ sound: 100, faults: [], pass: true });
});

test("a dead cable and a crossed pair: found at line check, fixed with a spare and a repatch, and then it passes", () => {
  // Cable c (the bass DI's) is dead; stage box inputs 1 and 5 come out on each other's pairs.
  const w = setUp([{ kind: "dead", cable: "xlr-c" }, { kind: "crossed", a: 1, b: 5 }]);
  night(w).phantom = true;
  const heard = lineCheck(w, patch());
  expect(heard.map((h) => [h.what, h.on, h.sound])).toEqual([
    ["Kick", 5, "clean"], ["Snare", 2, "clean"], ["Bass DI", null, "silent"], ["Guitar", 4, "clean"], ["Vocal 1", 1, "clean"], ["Vocal 2", 6, "clean"],
  ]);
  expect(heard[2]!.why).toContain("xlr-c is dead");
  expect(show(w, patch(), on).pass).toBe(false);

  // Swap the bass DI onto spare g, and patch the kick into 5 and vocal 1 into 1: each lands where the list wants it.
  const fixed = patch((ch) => (ch === 3 ? "xlr-g" : `xlr-${"abcdef"[ch - 1]}`), (ch) => (ch === 1 ? 5 : ch === 5 ? 1 : ch));
  expect(lineCheck(w, fixed).every((h) => h.ok)).toBe(true);
  expect(show(w, fixed, on)).toMatchObject({ faults: [], pass: true });
});

test("the bass DI hums until its ground lift is pressed; the condenser is silent until 48 V is on", () => {
  const w = setUp([{ kind: "hum", di: "bass-di" }]);
  const sounds = () => lineCheck(w, patch()).map((h) => h.sound);
  expect(sounds()).toEqual(["clean", "clean", "hum", "clean", "clean", "silent"]);
  night(w).lift = true;
  night(w).phantom = true;
  expect(sounds()).toEqual(INPUTS.map(() => "clean"));
});

test("each night seeds one to three faults, the same ones for the same seed", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const f = faultsFor(seed);
    expect(f.length).toBeGreaterThanOrEqual(1);
    expect(f.length).toBeLessThanOrEqual(3);
    expect(faultsFor(seed)).toEqual(f);
  }
  // The stage plot fits the stage, and the 30 m snake reaches from it to the mix position.
  for (const l of INPUTS) expect(l.mark.z).toBeLessThanOrEqual(ZONES.stage.z1);
  expect(Math.hypot(ZONES.desk.x1, ZONES.desk.z1)).toBeLessThan(30);
});

/** Rope points 0.2 m apart on the floor from one spot to another, as a laid cable's rope lies. */
const lay = (x0: number, z0: number, x1: number, z1: number) => {
  const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
  return Array.from({ length: n + 1 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / n, y: 0.006, z: z0 + ((z1 - z0) * i) / n }));
};

test("a power cord laid along vocal 1's mic cable hums on its channel; moved apart, or crossed square, it stops", () => {
  const w = setUp([]);
  night(w).phantom = true;
  // Vocal 1's cable runs from its mark to the stage box; a power cord from the stage wall lies 15 cm beside it.
  const mic = { ...xlr("xlr-e", "vox-1", 5), path: lay(0.3, 2.75, -1, 2.7) };
  const runs = (path: ReturnType<typeof lay>): LaidCable[] => [
    ...patch().filter((r) => r.key !== "xlr-e"), mic,
    { key: "power-stage", kind: "power", lengthM: 5, from: ["stage-wall", "power-out-1"], to: ["bass-amp", "power-in"], path },
  ];

  const beside = runs(lay(0.2, 2.9, -0.9, 2.85));
  expect(check(w, beside, on, 5)).toMatchObject({ on: 5, sound: "hum", ok: false });
  expect(night(w).last?.why).toContain("Run them apart");
  expect(show(w, beside, on).pass).toBe(false);

  // A metre away, or across it at a right angle: clean again, and the other channels never hummed.
  expect(lineCheck(w, runs(lay(0.2, 1.75, -0.9, 1.7))).map((h) => h.sound)).toEqual(INPUTS.map(() => "clean"));
  expect(check(w, runs(lay(-0.4, 2.0, -0.4, 3.5)), on, 5)?.sound).toBe("clean");
});
