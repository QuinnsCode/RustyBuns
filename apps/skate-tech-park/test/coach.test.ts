// The first-time tutorial's journey: a new rider pushes, carves, ollies, kickflips and grinds a bar, through the same
// step() the page runs, and the coach's card walks one step at a time to the end.
import { expect, test } from "bun:test";
import { stepAt } from "@rustybuns/util/tutorial";
import { makeLevel } from "../src/level.ts";
import { DT, IDLE, type Input, start, step, type State } from "../src/sim.ts";
import { learn, realRide, steps, unlearned } from "../src/coach.ts";

const bar = makeLevel({ name: "t", pieces: [], spawns: [], bounds: { minX: -80, maxX: 80, minZ: -80, maxZ: 80 }, rails: [{ kind: "rail", a: { x: 0, z: 0 }, b: { x: 0, z: 60 }, y: 0.9 }] });

test("push, turn, ollie, flip and grind walk the coach to its end, each step waiting for its own move", () => {
  const l = unlearned(), list = steps(l);
  let sim = start(-30, -60, 0, bar);
  const ride = (seconds: number, inp: Partial<Input> | ((s: State) => Partial<Input>)) => {
    for (let i = 0; i < seconds / DT; i++) { const held = { ...IDLE, ...(typeof inp === "function" ? inp(sim) : inp) }; step(sim, held, bar); learn(l, sim, held); }
  };
  const at = () => list[stepAt(list, 0)]?.title ?? "done";

  expect(at()).toBe("Push");
  ride(1, { steer: 1 }); // leaning on the stick standing still is not a turn
  expect(at()).toBe("Push");
  ride(2, { throttle: 1 });
  expect(at()).toBe("Turn");
  ride(0.5, { throttle: 1, steer: 1 });
  expect(at()).toBe("Ollie");
  ride(0.1, { jump: true });
  ride(0.1, {});
  expect(at()).toBe("Flip it");
  ride(0.1, { flip: true });
  ride(1.5, {});
  expect(at()).toBe("Grind");

  sim = start(0, -30, 0, bar); // back to a start lined up behind the bar
  let popped = false;
  ride(6, (s) => (s.z > -2.5 && !popped ? ((popped = true), { throttle: 1, jump: true }) : { throttle: popped ? 0 : 1 }));
  expect(at()).toBe("done");
});

test("only a ride picked for real runs the tutorial: not the title, the tour, the showroom or a check's jump link", () => {
  const cases: [string, boolean][] = [
    ["?level=plaza", true],
    ["?level=plaza&mode=car", true],
    ["?level=plaza&room=ABCD", true],
    ["", false],
    ["?room=ABCD", false], // the park picker, the tour behind it
    ["?front", false],
    ["?showroom", false],
    ["?level=plaza&spawn=rail", false],
    ["?level=plaza&nosweep", false],
    ["?level=plaza&fps", false],
  ];
  for (const [search, real] of cases) expect([search, realRide(search)]).toEqual([search, real]);
});
