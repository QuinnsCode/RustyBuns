// The cozy-to-sim dial and the clock to doors. First the same arrival at the dive bar's doors, read on each stop: Cozy runs no
// clock, Crew gives a longer window and two minutes' grace, Sim opens on time and every minute late costs pay and mood.
import { expect, test } from "bun:test";
import { DIALS, type Dial, assist, currentDial, setDial } from "../src/assists.ts";
import { newWorld, pickUp, putDown, step, walkTo } from "../src/sim.ts";
import { DIVE_BAR, aim, settle, show } from "../src/venues/dive-bar.ts";
import { clockText, doors, doorsAt, showScore } from "../src/clock.ts";

test.each([
  // dial, done at (s), doors at, minutes late, pay of 150, mood
  ["cozy", 400, null, 0, 150, 100],
  ["crew", 400, 450, 0, 150, 100],
  ["crew", 600, 450, 1, 135, 92],
  ["sim", 290, 300, 0, 150, 100],
  ["sim", 400, 300, 2, 120, 84],
  ["sim", 1500, 300, 20, 0, 20],
] as const)("%s, finished at %i s: doors at %p, %i min late, paid %i, mood %i", (dial, t, at, min, pay, mood) => {
  expect(doorsAt("dive-bar", dial)).toBe(at);
  const d = doors("dive-bar", t, dial);
  expect(Math.ceil(d.late / 60)).toBe(min);
  expect(d).toMatchObject({ pay, fee: 150, mood });
});

test("the dial turns to a stop and nowhere else; the clock reads fixed width", () => {
  expect(setDial("sim")).toBe("sim");
  expect(setDial("arcade")).toBe("sim");
  expect(assist("weight")).toBe(1);
  expect(currentDial()).toBe("sim");
  setDial("sim");
  expect(showScore(93, 84)).toBe(78);
  expect([clockText(65), clockText(5.5), clockText(-61)]).toEqual([" 1:05", " 0:05", "-1:01"]);
});

/** The dive bar set up the same way on any stop: both stands and tops to the stage, the sub against the back between them, the left top
 * toed in, then a long chat with the bar staff (four minutes) before the doors. What it costs depends on the dial. */
function loadIn(dial: Dial) {
  setDial(dial);
  const w = newWorld(DIVE_BAR);
  const carry = (key: string, x: number, z: number) => {
    const i = w.items.find((o) => o.key === key)!;
    walkTo(w, i.x, i.z + 0.9);
    w.you.yaw = 0;
    expect(pickUp(w, key)).toEqual({ ok: true });
    walkTo(w, x, z);
    w.you.yaw = 0;
    expect(putDown(w)).toEqual({ ok: true });
    settle(w);
  };
  carry("stand-l", -1.7, 2.0);
  carry("stand-r", 1.7, 2.0);
  carry("top-l", -1.7, 1.95);
  carry("top-r", 1.7, 1.95);
  carry("sub", 0, 1.3);
  walkTo(w, -1, 2.4);
  aim(w, "top-l", { turn: (30 * Math.PI) / 180 });
  const work = w.t;
  for (let i = 0; i < 240 * 60; i++) step(w, 1 / 60, { forward: 0, right: 0, turn: 0, crouch: false });
  // To the nearest 10 cm: a walk at a different pace stops on a different tick, a centimetre either way.
  const layout = w.items.map((i) => [i.key, Math.round(i.x * 10), Math.round(i.z * 10), Math.round(i.y * 10)]);
  const end = show(w);
  setDial("sim");
  return { work, layout, ...end };
}

test("the same load-in on Cozy, Crew and Sim: the same layout, a different time and a different show", () => {
  const runs = Object.fromEntries(DIALS.map((d) => [d, loadIn(d)]));
  expect(runs.cozy!.layout).toEqual(runs.sim!.layout);
  expect(runs.crew!.layout).toEqual(runs.sim!.layout);
  // Half weight carries quicker: the 45 kg sub alone is a shuffle on Sim.
  expect(runs.cozy!.work).toBeLessThan(runs.crew!.work);
  expect(runs.crew!.work).toBeLessThan(runs.sim!.work);
  expect(runs.sim!.sound).toBe(runs.cozy!.sound);
  // Cozy runs no clock, Crew's window and grace cover the chat, Sim's doors were five minutes in: late, the crowd sours.
  expect(runs.cozy).toMatchObject({ mood: 100, late: 0, pay: 150 });
  expect(runs.crew).toMatchObject({ mood: 100, late: 0, pay: 150 });
  expect(runs.sim!.late).toBeGreaterThan(0);
  expect(runs.sim!.mood).toBeLessThan(100);
  expect(runs.sim!.pay).toBeLessThan(150);
  expect(runs.sim!.score).toBeLessThan(runs.cozy!.score);
});
