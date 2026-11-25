// The local festival as a crew works it, in the real order: push each stage's amp rack 60 m from the compound to the
// back of its stage, carry each desk out to its mix position, put every load on a phase and run each stage a feeder
// thick enough, run the snakes, then aim. Facing each other with omni subs, each stage bleeds into the other's audience
// and the subs boom at the fence; turned away from each other with cardioid subs, it passes at soundcheck, but with the crowd in the
// tops at head height fire through every row, until they're lifted over the heads. A rack left by the desk
// drives 40 m of speaker cable and loses level. The same calls `window.loadIn` makes.
import { expect, setDefaultTimeout, test } from "bun:test";
import { newWorld, push, pickUp, putDown, type World } from "../src/sim.ts";
import { type Cables, newCables, walkWith } from "../src/cables/cables.ts";
import { letIn } from "../src/crowd/crowd.ts";
import { FENCE_LIMIT, FESTIVAL, COMPOUND, NEAR_DB, STAGE_KEYS, type StageKey, crowdSpot, face, feeder, festivalState, lift, master, mixSpot, onStage, phase, rig, run, show, snake, subs } from "../src/venues/festival.ts";

setDefaultTimeout(30_000);
const at = (w: World, k: string) => w.items.find((i) => i.key === k)!;
function go(w: World, c: Cables, x: number, z: number) {
  for (let k = 0; k < 8 && Math.hypot(x - w.you.x, z - w.you.z) > 0.05; k++) walkWith(w, c, x, z);
}
/** Walk up to `key`, take it (push it if it rolls), and set it down at (x, z). */
function move(w: World, c: Cables, key: string, x: number, z: number) {
  const i = at(w, key);
  go(w, c, i.x, i.z + 0.9);
  w.you.yaw = 0;
  expect((i.gear === "amp-rack-12u" ? push : pickUp)(w, key)).toEqual({ ok: true });
  go(w, c, x, z + 0.9);
  expect(putDown(w)).toEqual({ ok: true });
  return at(w, key);
}

/** The load-in up to aiming: racks behind their stages (or by the desk), desks at the mix positions, the phases
 * balanced across the generator, thick enough feeders, snakes run. */
function loadIn(rackAtDesk = false) {
  const w = newWorld(FESTIVAL), c = newCables(w);
  for (const k of STAGE_KEYS) {
    const yaw = rig(w).yaw[k], m = mixSpot(k, yaw), back = onStage(k, yaw, 0, -2);
    move(w, c, `${k}-desk`, m.x, m.z);
    const rk = rackAtDesk ? { x: m.x + 1.5, z: m.z } : back;
    move(w, c, `${k}-rack`, rk.x, rk.z);
  }
  go(w, c, COMPOUND.x, COMPOUND.z + 2);
  // racks (5.2 kW) on two legs, lights and backline balanced across them, the traders' vans on what's left
  const legs = { "tent-rack": "L1", "open-rack": "L2", "tent-lights": "L3", "open-lights": "L3", "tent-backline": "L2", "open-backline": "L1", "traders-1": "L1", "traders-2": "L2", "traders-3": "L3" } as const;
  for (const [f, leg] of Object.entries(legs)) expect(phase(w, f, leg)).toEqual({ ok: true });
  expect(feeder(w, "tent", 10)).toEqual({ ok: true });
  expect(festivalState(w).power.stages.tent.ok).toBe(false); // #10 cord over 77 m: too thin for 43 A
  for (const k of STAGE_KEYS) expect(feeder(w, k, 2)).toEqual({ ok: true });
  for (const k of STAGE_KEYS) {
    const d = at(w, `${k}-desk`);
    go(w, c, d.x, d.z + 1);
    expect(snake(w, k)).toEqual({ ok: true });
  }
  return { w, c };
}

/** Walk onto a stage and turn it, and build its subs. */
function aim(w: World, c: Cables, k: StageKey, deg: number, mode: "omni" | "cardioid") {
  const s = onStage(k, rig(w).yaw[k], 0, 0);
  go(w, c, s.x + 1, s.z + 1);
  expect(face(w, k, deg)).toEqual({ ok: true });
  expect(subs(w, k, mode)).toEqual({ ok: true });
}

test("facing each other with omni subs, the stages bleed into each other and the fence booms; turned apart and cardioid, it passes", () => {
  const { w, c } = loadIn();
  expect(festivalState(w).power).toMatchObject({ trips: false, imbalance: expect.any(Number) });
  expect(festivalState(w).powerOk).toBe(true);

  const facing = festivalState(w);
  for (const k of STAGE_KEYS) expect(facing.stages[k]!.live).toBe(true);
  expect(facing.stages.tent!.bleedOk).toBeLessThan(0.8);
  expect(facing.fence!).toBeGreaterThan(FENCE_LIMIT + 6);
  expect(facing.pass).toBe(false);

  // Turn the tent north-west and the open stage north-east, away from each other and from the houses, and rebuild the subs.
  aim(w, c, "tent", 330, "cardioid");
  aim(w, c, "open", 30, "cardioid");
  // The desks follow their stages out to the new mix positions, and the snakes are re-run.
  for (const k of STAGE_KEYS) {
    const m = mixSpot(k, rig(w).yaw[k]), back = onStage(k, rig(w).yaw[k], 0, -2);
    move(w, c, `${k}-rack`, back.x, back.z);
    move(w, c, `${k}-desk`, m.x, m.z);
    expect(snake(w, k)).toEqual({ ok: true });
    expect(master(w, k, rig(w).master[k] - 4)).toEqual({ ok: true });
  }
  const apart = festivalState(w);
  for (const k of STAGE_KEYS) {
    expect(apart.stages[k]!.bleedOk).toBe(1);
    expect(apart.stages[k]!.covered).toBeGreaterThan(0.6);
    expect(apart.stages[k]!.cableDb!).toBeLessThan(NEAR_DB);
  }
  expect(apart.fence!).toBeLessThan(facing.fence! - 10);
  expect(apart.houses!).toBeLessThan(facing.houses!);

  // Show time: 2,000 come in, half in front of each stage wherever it faces now. The stacks stand at head height, so
  // each audience hears less of them through the bodies, and the show is scored as the crowd hears it.
  letIn(w, crowdSpot(w));
  const withCrowd = festivalState(w);
  expect(withCrowd.people.count).toBeGreaterThan(1900);
  for (const [k, st] of withCrowd.people.stages.entries()) {
    expect(st.people).toBeGreaterThan(900);
    expect(st.full!).toBeLessThan(st.soundcheck! - 1);
    expect(withCrowd.full.stages[STAGE_KEYS[k]!]!.covered).toBeLessThan(apart.stages[STAGE_KEYS[k]!]!.covered);
  }
  expect(withCrowd.full.score).toBeLessThan(withCrowd.score);
  expect(show(w).sound).toBe(withCrowd.full.score);

  // Lift the tops over the heads: the tent's stacks onto scaffold wings, the open stage's pairs flown from its roof.
  for (const k of STAGE_KEYS) {
    const s = onStage(k, rig(w).yaw[k], 0, 0);
    go(w, c, s.x + 1, s.z + 1);
    expect(lift(w, k, true)).toEqual({ ok: true });
  }
  expect(lift(w, "tent", true)).toMatchObject({ ok: false }); // standing at the open stage
  const lifted = festivalState(w);
  for (const k of STAGE_KEYS) {
    expect(lifted.stages[k]!.lifted).toBe(true);
    expect(lifted.full.stages[k]!.covered).toBeGreaterThan(withCrowd.full.stages[k]!.covered + 0.2);
  }
  expect(lifted.full.score).toBeGreaterThan(withCrowd.full.score + 10);

  // An hour of the show: the songs rise and fall, and the 15-minute LAeq at each desk stays inside the licence.
  run(w, 3600);
  expect(festivalState(w)).toMatchObject({ licenceOk: true, curfewOk: true, pass: true, full: { pass: true } });
  expect(show(w).sound).toBe(festivalState(w).full.score);
});

test("a rack left by the desk drives 40 m of speaker cable and loses level", () => {
  const near = festivalState(loadIn().w), far = festivalState(loadIn(true).w);
  for (const k of STAGE_KEYS) {
    expect(far.stages[k]!.cableDb!).toBeGreaterThan(NEAR_DB);
    expect(far.stages[k]!.cableDb! - near.stages[k]!.cableDb!).toBeGreaterThan(0.4);
    expect(far.stages[k]!.level!).toBeLessThan(near.stages[k]!.level!);
  }
  expect(far.score).toBeLessThan(near.score);
});
