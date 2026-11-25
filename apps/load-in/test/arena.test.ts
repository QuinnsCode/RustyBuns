// The big arena as a crew does it: the boxes are too heavy for one person, so the hands carry them two to a box onto
// the fly bars and the subs to the stage edge; you fly each hang at its motor, angle it, time the delay towers to the
// mains, turn the rear subs into cardioid pairs, spread the feeds over the company switch's three legs, and pass.
// Then the plausible mistakes: every feed on one leg trips it, and subs left plain fill the stage with bass.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newWorld, pickUp, type World } from "../src/sim.ts";
import { type Cables, newCables, walkWith } from "../src/cables/cables.ts";
import { ARENA, CROWD, POINTS, SWITCH, type Leg, arena, arenaState, fly, legs, pad, score, scores, send, setHang, setLeg, setSub, show, wait } from "../src/venues/arena.ts";
import { letIn } from "../src/crowd/crowd.ts";
import { setDial } from "../src/assists.ts";
import { doors } from "../src/clock.ts";

setDefaultTimeout(30_000);

/** Which boxes go up where: four on each main, two on each side hang and each tower. */
const PLAN: Record<string, number[]> = {
  "main-l": [1, 2, 3, 4], "main-r": [5, 6, 7, 8], "side-l": [9, 10], "side-r": [11, 12], "tower-l": [13, 14], "tower-r": [15, 16],
};
/** Two cardioid pairs at the stage edge: a sub, and one 0.8 m behind it (the one whose delay and polarity you set). */
const SUBS = { "sub-1": [-3, 9.2], "sub-2": [-3, 8.4], "sub-3": [3, 9.2], "sub-4": [3, 8.4] } as const;
const POWER: Record<string, Leg> = { "main-l": "L1", "side-l": "L1", "tower-l": "L1", "main-r": "L2", "side-r": "L2", "tower-r": "L2", subs: "L3" };

function rigUp(w: World, c: Cables) {
  for (const [p, ks] of Object.entries(PLAN)) for (const k of ks) expect(send(w, `box-${k}`, p)).toEqual({ ok: true });
  for (const [k, [x, z]] of Object.entries(SUBS)) expect(send(w, k, { x, z })).toEqual({ ok: true });
  // Four hands, two to a box: two carries at a time, the rest wait their turn.
  expect(arenaState(w).queued.length).toBeGreaterThan(15);
  wait(w, 1200);
  expect(arenaState(w).queued).toEqual([]);
  expect(arena(w).jobs).toEqual([]);
  for (const [p, ks] of Object.entries(PLAN)) expect(arena(w).hangs[p].boxes).toHaveLength(ks.length);

  walkWith(w, c, 0, 20); // down the middle of the floor, clear of the towers
  for (const p of POINTS) {
    walkWith(w, c, p.x, p.z + 2.5);
    expect(fly(w, p.key)).toEqual({ ok: true });
    expect(setHang(w, p.key, { angle: p.kind === "tower" ? -4 : -10, delay: p.kind === "tower" ? 65 : 0 })).toEqual({ ok: true });
  }
  for (const k of ["sub-2", "sub-4"]) {
    const s = w.items.find((i) => i.key === k)!;
    walkWith(w, c, s.x + 1.2, s.z + 2);
    expect(setSub(w, k, { delay: (0.8 / 343) * 1000, invert: true })).toEqual({ ok: true });
  }
  walkWith(w, c, SWITCH.x - 1, SWITCH.z);
}

test("the crew carries the boxes in, the hangs fly and line up, the stage stays quiet, the legs share the load", () => {
  setDial("crew");
  const w = newWorld(ARENA), c = newCables(w);

  // A 75 kg box is two people's work.
  walkWith(w, c, -10, 54);
  w.you.yaw = 0;
  expect(pickUp(w, "box-1")).toEqual({ ok: false, why: "line array element, powered is 75 kg, too heavy to lift alone" });

  rigUp(w, c);
  // Nothing plays until it has power.
  expect(score(w).crowd).toBeNull();
  for (const [feed, leg] of Object.entries(POWER)) expect(setLeg(w, feed, leg)).toEqual({ ok: true });
  expect(legs(w).map((l) => l.watts)).toEqual([4000, 4000, 3000]);

  const s = score(w);
  expect(s.covered).toBeGreaterThan(0.85);
  expect(s.lagMs).toBeGreaterThan(0);
  expect(s.lagMs).toBeLessThan(20);
  expect(s.stageGap).toBeGreaterThan(10);
  expect(s).toMatchObject({ warn: 0, tripped: 0, pass: true });
  // On time on Crew: the crew carried it all well inside the doors.
  expect(doors("arena", w.t).late).toBe(0);

  // Doors: 3,000 take the floor. The hangs fire over their heads, so the full floor still passes (the show scores it),
  // every part of it dances, and the hall rings for over a second less.
  letIn(w, CROWD);
  const full = scores(w).full, people = arenaState(w).people;
  expect(full.crowd!).toBeLessThan(s.crowd!);
  expect(full).toMatchObject({ pass: true });
  expect(show(w).sound).toBe(full.score);
  expect(people).toMatchObject({ in: true, count: 3000 });
  expect(people.regions.map((r) => r.doing)).toEqual(["dancing", "dancing", "dancing"]);
  expect(people.regions[0]!.density).toBeGreaterThan(people.regions[2]!.density);
  expect(people.empty.rt60! - people.full.rt60!).toBeGreaterThan(1);

  // A tower left at 0 ms lands well before the mains, out of time.
  expect(setHang(w, "tower-l", { delay: 0 })).toEqual({ ok: true });
  expect(setHang(w, "tower-r", { delay: 0 })).toEqual({ ok: true });
  expect(score(w).lined).toBeLessThan(0.1);
  expect(score(w).pass).toBe(false);
});

test("everything on one leg trips it, and plain subs fill the stage", () => {
  setDial("sim");
  const w = newWorld(ARENA), c = newCables(w);
  rigUp(w, c);
  for (const feed of Object.keys(POWER)) setLeg(w, feed, "L1");
  expect(legs(w)[0]).toMatchObject({ watts: 11000, tripped: true });
  expect(score(w)).toMatchObject({ crowd: null, pass: false });

  for (const [feed, leg] of Object.entries(POWER)) setLeg(w, feed, leg);
  const cardioid = score(w).stageGap!;
  for (const k of ["sub-2", "sub-4"]) {
    const s = w.items.find((i) => i.key === k)!;
    walkWith(w, c, s.x + 1.2, s.z + 2);
    setSub(w, k, { delay: 0, invert: false });
  }
  expect(score(w).stageGap!).toBeLessThan(cardioid - 8);
});

test("on a phone the arena's buttons say what they do where you stand: send, fly then lower, the leg at the switch", () => {
  setDial("crew");
  const w = newWorld(ARENA), c = newCables(w);
  const words = (selected: string) => Object.fromEntries(Object.entries(pad(w, selected, null)).map(([k, l]) => [k, l.glyph]));

  // At the dock, looking at a box: K sends the crew with it to the selected hang; with the subs selected it tags it.
  walkWith(w, c, -10, 54);
  w.you.yaw = 0;
  expect(pad(w, "main-l", null)).toMatchObject({ KeyK: { glyph: "Send", what: "Send the crew with box-1 to main-l's fly bar" }, Digit1: { on: true }, Digit2: { on: false } });
  expect(words("subs").KeyK).toBe("Tag");
  expect(words("main-l").KeyL).toBeUndefined(); // away from the switch L is still the strike

  for (const k of [1, 2, 3, 4]) send(w, `box-${k}`, "main-l");
  wait(w, 400);
  walkWith(w, c, 0, 20);
  walkWith(w, c, POINTS[0]!.x, POINTS[0]!.z + 2.5);
  expect(words("main-l").KeyU).toBe("Fly");
  expect(fly(w, "main-l")).toEqual({ ok: true });
  expect(words("main-l").KeyU).toBe("Lower");

  walkWith(w, c, SWITCH.x - 1, SWITCH.z);
  expect(pad(w, "main-l", null).KeyL).toEqual({ glyph: "Leg", what: "Put main-l on L1" });
});
