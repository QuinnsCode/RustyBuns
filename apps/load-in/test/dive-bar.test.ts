// The dive bar as a player does it: carry both stands and both tops from the door to the stage, set each top on its
// stand, point them at the back wall (the crowd hears their backs: a low score), then turn them round, toe them in
// toward the crowd and away from the bar, raise the stands; the sub still by the door booms at the back of the crowd and
// fades at the front, so carry it to the stage, and pass. The same calls `window.loadIn` makes.
import { expect, test } from "bun:test";
import { newWorld, pickUp, putDown, type World, walkTo } from "../src/sim.ts";
import { aimHint, roomHint } from "../src/venues/dive-bar-view.ts";
import { DIVE_BAR, PASS, aim, raise, score, settle, sources } from "../src/venues/dive-bar.ts";

const DEG = Math.PI / 180;

/** Pick `key` up where it is, carry it to stand at (x, z) facing the back wall, and set it down in front of you. */
function carry(w: World, key: string, x: number, z: number) {
  const i = w.items.find((o) => o.key === key)!;
  walkTo(w, i.x, i.z + 0.9);
  w.you.yaw = 0;
  expect(pickUp(w, key)).toEqual({ ok: true });
  walkTo(w, x, z);
  w.you.yaw = 0;
  expect(putDown(w)).toEqual({ ok: true });
  settle(w);
}

test("a silent room scores nothing; tops at the wall score low; aimed at the crowd with the sub on stage they pass", () => {
  const w = newWorld(DIVE_BAR), at = (key: string) => w.items.find((i) => i.key === key)!;
  // With no speaker in the room, every cell is silence (-Infinity from levelAt), and silence scores nothing.
  const empty = newWorld({ ...DIVE_BAR, items: [] });
  expect(sources(empty)).toEqual([]);
  expect(score(empty)).toMatchObject({ crowd: null, gap: null, score: 0, pass: false });

  carry(w, "stand-l", -1.7, 2.0);
  carry(w, "stand-r", 1.7, 2.0);
  carry(w, "top-l", -1.7, 1.95);
  carry(w, "top-r", 1.7, 1.95);
  for (const side of ["l", "r"]) {
    expect(at(`top-${side}`)).toMatchObject({ x: at(`stand-${side}`).x, z: at(`stand-${side}`).z, y: 1.2 });
  }

  // Set down facing the way they were carried: their fronts to the back wall.
  for (const key of ["top-l", "top-r"]) {
    walkTo(w, at(key).x * 0.6, 2.2);
    expect(aim(w, key, { turn: Math.PI - at(key).rot })).toEqual({ ok: true });
  }
  const wall = score(w);
  expect(wall.score).toBeLessThan(PASS / 2);

  // Turn them round to the crowd, the left one (by the bar) toed in hard, both stands up to 1.6 m.
  walkTo(w, -1.0, 2.4);
  expect(aim(w, "top-l", { turn: -Math.PI + 30 * DEG })).toEqual({ ok: true });
  expect(raise(w, "stand-l", 1.6)).toEqual({ ok: true });
  walkTo(w, 1.0, 2.4);
  expect(aim(w, "top-r", { turn: -Math.PI })).toEqual({ ok: true });
  expect(raise(w, "stand-r", 1.6)).toEqual({ ok: true });
  expect(at("top-l").y).toBeCloseTo(1.6, 5);

  // The sub left at the door: the bass is uneven over the crowd, and the show doesn't pass yet.
  const doorSub = score(w);
  expect(doorSub.bass).toBeLessThan(0.5);
  expect(doorSub.pass).toBe(false);

  carry(w, "sub", 0.4, 1.3);
  const aimed = score(w);
  expect(aimed.bass).toBeGreaterThan(0.8);
  expect(aimed.pass).toBe(true);
  expect(aimed.crowd!).toBeGreaterThan(95);
  expect(aimed.gap!).toBeGreaterThan(4);
  expect(raise(w, "top-r", 1.8)).toEqual({ ok: false, why: '12" two-way powered speaker isn\'t a stand' });
});

test("the centre prompt names a key only when you look at what it works on", () => {
  const w = newWorld(DIVE_BAR), map = { on: false, band: "high" as const };
  const lookAt = (key: string) => {
    const i = w.items.find((o) => o.key === key)!;
    walkTo(w, i.x, i.z + 0.9);
    w.you.yaw = 0;
  };
  // In from the street, looking at nothing: no keys.
  walkTo(w, 2, 11.5);
  w.you.yaw = 0;
  expect(aimHint(w)).toBe("");
  expect(roomHint(w, map, false)).toBe("");

  // A top on the floor turns and tilts; the mixer has the fader, with where it is now.
  lookAt("top-l");
  expect(aimHint(w)).toBe("Q / E turn, R / V tilt");
  walkTo(w, -1.6, 10.8);
  w.you.yaw = Math.PI;
  expect(aimHint(w)).toBe("[ ] fader, -14 dB");

  // On its stand at the stage, the top also has the stand's keys; the bare stand has only those.
  carry(w, "stand-l", -1.7, 2.0);
  carry(w, "top-l", -1.7, 1.95);
  expect(aimHint(w)).toBe("Q / E turn, R / V tilt, Z / X stand");
  lookAt("stand-r");
  expect(aimHint(w)).toBe("Z / X stand");

  // The heat map is on the floor: look down for H, which says what the next press does.
  walkTo(w, 0.7, 6);
  w.you.yaw = 0;
  w.you.pitch = -0.6;
  expect(roomHint(w, map, false)).toBe("H heat map");
  expect(roomHint(w, { on: true, band: "high" }, false)).toBe("H bass map (mids now)");
  // Face the street door from inside for Enter, until the doors are open.
  walkTo(w, 0, 9.5);
  w.you.yaw = Math.PI;
  w.you.pitch = 0;
  expect(roomHint(w, map, false)).toBe("Enter open the doors");
  expect(roomHint(w, map, true)).toBe("");
  w.you.yaw = 0;
  expect(roomHint(w, map, false)).toBe("");
});
