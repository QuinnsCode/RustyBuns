// The cozy-to-sim dial and the clock to doors. The same arrival at the dive bar's doors, read on each stop: Cozy runs no
// clock, Crew gives a longer window and two minutes' grace, Sim opens on time and every minute late costs pay and mood.
import { expect, test } from "bun:test";
import { assist, currentDial, setDial } from "../src/assists.ts";
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
  setDial("crew");
  expect(showScore(93, 84)).toBe(78);
  expect([clockText(65), clockText(5.5), clockText(-61)]).toEqual([" 1:05", " 0:05", "-1:01"]);
});
