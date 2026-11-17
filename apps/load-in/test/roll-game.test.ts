// Power for the garage speaker the way a stagehand runs it: lift the cord's roll out of the case, carry it to the wall,
// plug its end, bowl the roll toward the speaker, pick it up where it stopped, carry the rest and plug it in. The same
// calls the page's `window.loadIn` harness makes.
import { expect, test } from "bun:test";
import { setDial } from "../src/assists.ts";
import { newWorld } from "../src/sim.ts";
import { bowl, cableState, grabEnd, newCables, plug, settle, takeRoll, walkWith } from "../src/cables/cables.ts";

test("carry a power roll to the wall, plug it, bowl it, carry the rest to the speaker: it feeds the speaker and its weight slowed you", () => {
  setDial("sim");
  const w = newWorld(), c = newCables(w), run = () => cableState(w, c).cables.find((r) => r.key === "power-10")!;
  const noPower = () => cableState(w, c).problems.includes("top has no power");

  // Empty-handed, the walk from the case to the wall, and back.
  walkWith(w, c, -1.6, 3.2);
  const free = walkWith(w, c, -2.2, 0.6);
  walkWith(w, c, -1.6, 3.2);

  // The roll out of the case: 10 m of cord in your arms, its end still wound on. The same walk is slower.
  expect(takeRoll(w, c, "power")).toEqual({ ok: true });
  expect(run()).toMatchObject({ a: "loose", b: "hand", roll: { kind: "cord", state: "held", kg: 1.7 } });
  const laden = walkWith(w, c, -2.2, 0.6);
  expect(laden).toBeGreaterThan(free * 1.015);

  // The end into the wall; you keep the roll. Face the speaker and bowl: the roll leaves your hands paying out cord.
  expect(plug(w, c, "outlet", "power-out-1")).toEqual({ ok: true });
  expect(run()).toMatchObject({ a: "outlet power-out-1", b: "hand" });
  w.you.yaw = Math.atan2(-(1.4 - w.you.x), -(2.2 - w.you.z));
  expect(bowl(w, c, 0.5)).toEqual({ ok: true });
  settle(w, c, 6);
  const lay = run().roll!;
  expect(lay.state).toBe("down");
  expect(Math.hypot(lay.x + 2.2, lay.z - 0.6)).toBeGreaterThan(1.5);
  expect(run().laid).toBeGreaterThan(1.5);

  // Pick it up where it stopped, carry the rest across the way in and plug it into the speaker: the speaker has power,
  // and the spare stays coiled under the jack.
  walkWith(w, c, lay.x - 0.4, lay.z);
  expect(grabEnd(w, c, "power-10", "b")).toEqual({ ok: true });
  expect(noPower()).toBe(true);
  walkWith(w, c, 2.0, 1.9);
  expect(plug(w, c, "top", "power-in")).toEqual({ ok: true });
  settle(w, c, 2);
  expect(run()).toMatchObject({ a: "outlet power-out-1", b: "top power-in", roll: { state: "tied" } });
  expect(run().roll!.leftM).toBeGreaterThan(0);
  expect(noPower()).toBe(false);
});
