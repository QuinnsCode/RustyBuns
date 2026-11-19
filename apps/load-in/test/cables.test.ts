// Power for the speaker, as a roadie runs it: a cable out of the case, one end into the wall, the other across the way
// in to the powered top. It lies on the floor where people walk (a hazard) until a ramp goes over it. The same calls the
// page's `window.loadIn` harness makes.
import { expect, test } from "bun:test";
import { setDial } from "../src/assists.ts";
import { newWorld, pickUp, putDown } from "../src/sim.ts";
import { cableState, dropEnd, endInHand, fedBy, grabEnd, newCables, plug, settle, takeCable, takeRoll, unplug, walkWith } from "../src/cables/cables.ts";

test("run power from the outlet to the speaker across the walkway, see the hazard, lay a ramp over it", () => {
  // Sim: no slack past the cable's length (another file may leave the dial on Cozy).
  setDial("sim");
  const w = newWorld(), c = newCables(w), state = () => cableState(w, c);

  // Out of the case, into the wall.
  walkWith(w, c, -1.6, 3.2);
  expect(takeCable(w, c, "power")).toEqual({ ok: true });
  walkWith(w, c, -2.2, 0.6);
  expect(plug(w, c, "outlet", "power-out-1")).toEqual({ ok: true });

  // Back for the other end, across the way in to the speaker: its power jack takes it, the XLR jack doesn't.
  walkWith(w, c, -1.6, 3.2);
  expect(grabEnd(w, c, "power-10", "b")).toEqual({ ok: true });
  walkWith(w, c, 2.0, 1.9);
  expect(plug(w, c, "top", "xlr-in")).toEqual({ ok: false, why: "a power cable doesn't fit xlr-in (it takes xlr)" });
  expect(plug(w, c, "top", "power-in")).toEqual({ ok: true });
  settle(w, c, 3);
  expect(state().cables[0]).toMatchObject({ key: "power-10", a: "outlet power-out-1", b: "top power-in", coiled: false });

  // Cabled, the patch decides what plays: the top has power but no signal yet, so switched on it stays quiet. The cab,
  // with no cable in it, still plays on the switches alone (the cozy way).
  const fed = fedBy(w, c);
  expect(fed(w, "top", new Set(["top"]))).toBe(false);
  expect(fed(w, "cab-4x12", new Set(["amp-head"]))).toBe(true);

  // Lying across the way in: a trip hazard.
  const [hz, ...more] = state().hazards;
  expect(more).toEqual([]);
  expect(hz).toMatchObject({ cable: "power-10", walkway: "the way in" });

  // The ramp, faced square, set down over the crossing: the cable lies on it and the hazard is gone.
  walkWith(w, c, -2.1, 5.8);
  w.you.yaw = 0;
  expect(pickUp(w, "ramp")).toEqual({ ok: true });
  walkWith(w, c, 0, hz!.z + 0.55);
  w.you.yaw = 0;
  expect(putDown(w)).toEqual({ ok: true });
  settle(w, c, 3);
  expect(state().hazards).toEqual([]);

  // A 6 m instrument cable from the case stops you at its length.
  walkWith(w, c, -1.6, 3.2);
  expect(takeCable(w, c, "instrument")).toEqual({ ok: true });
  walkWith(w, c, 2.5, 9.5);
  const fromCase = Math.hypot(w.you.x + 2.3, w.you.z - 3.2);
  expect(fromCase).toBeLessThan(6);
  expect(fromCase).toBeGreaterThan(5);
});

test("a power cable only goes one way round: the wall plug into the wall, the IEC socket into the speaker", () => {
  setDial("sim");
  const w = newWorld(), c = newCables(w);
  walkWith(w, c, -1.6, 3.2);
  expect(takeCable(w, c, "power")).toEqual({ ok: true });
  expect(endInHand(c)).toBe("edison");
  // Straight to the speaker with the end off the roll: it's the wall plug, and the speaker's inlet wants the socket.
  walkWith(w, c, 2.0, 1.9);
  expect(plug(w, c, "top", "power-in")).toEqual({ ok: false, why: "that's the wall plug end: it goes in an output, the IEC socket end goes here" });
  walkWith(w, c, -2.2, 0.6);
  expect(plug(w, c, "outlet", "power-out-1")).toEqual({ ok: true });
});

test("two hands: an end in each, a roll on the right, the end that fits goes in, G lets go of the last", () => {
  setDial("sim");
  const w = newWorld(), c = newCables(w), hold = () => cableState(w, c).hold;
  walkWith(w, c, -1.6, 3.2);
  expect(takeCable(w, c, "power")).toEqual({ ok: true });
  expect(hold()).toEqual({ right: "power-10 a", left: null });
  // A roll hangs on the right: the power end moves over to the left hand.
  expect(takeRoll(w, c, "speaker")).toEqual({ ok: true });
  expect(hold()).toEqual({ right: "speaker-10 b", left: "power-10 a" });
  expect(takeCable(w, c)).toEqual({ ok: false, why: "your hands are full" });
  // At the wall, the power end goes in though the roll was picked up last; the roll stays in the right hand.
  walkWith(w, c, -2.2, 0.6);
  expect(plug(w, c, "outlet", "power-out-1")).toEqual({ ok: true });
  expect(hold()).toEqual({ right: "speaker-10 b", left: null });
  // A free hand picks the plug back out; G (dropEnd) lets go of that one, the last picked, and keeps the roll.
  expect(unplug(w, c, "outlet", "power-out-1")).toEqual({ ok: true });
  expect(hold()).toEqual({ right: "speaker-10 b", left: "power-10 a" });
  expect(dropEnd(c)).toEqual({ ok: true });
  expect(hold()).toEqual({ right: "speaker-10 b", left: null });
  expect(dropEnd(c)).toEqual({ ok: true });
  expect(cableState(w, c).cables.find((r) => r.key === "speaker-10")?.roll?.state).toBe("down");
});
