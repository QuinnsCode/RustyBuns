// Power for the speaker, as a roadie runs it: a cable out of the case, one end into the wall, the other across the way
// in to the powered top. It lies on the floor where people walk (a hazard) until a ramp goes over it. The same calls the
// page's `window.loadIn` harness makes.
import { expect, test } from "bun:test";
import { setDial } from "../src/assists.ts";
import { newWorld, pickUp, putDown, type Level } from "../src/sim.ts";
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

  // The ramp, faced square, set down centred on the crossing (it lands 0.7 m in front of you): the cable lies on it
  // and the hazard is gone.
  walkWith(w, c, -2.1, 5.8);
  w.you.yaw = 0;
  expect(pickUp(w, "ramp")).toEqual({ ok: true });
  walkWith(w, c, 0, hz!.z + 0.7);
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

// The boxes' real panels (#6029): each jack is the connector on its maker's sheet, and a wrong plug says why.
const PANELS_ROOM: Level = {
  name: "panels",
  bounds: { x0: -2.75, x1: 2.75, z0: 0.25, z1: 6.75 },
  room: { x0: -3, x1: 3, z0: 0, z1: 7, height: 3, door: 2 },
  outlets: [{ key: "outlet", x: -2.2, y: 0.3, z: 0.01 }],
  start: { x: 0, z: 4, yaw: 0 },
  items: [
    { key: "top", gear: "top-15-passive", x: -1.4, y: 0, z: 2.5, rot: 0 },
    { key: "array", gear: "line-array-box", x: 1.2, y: 0, z: 2.5, rot: 0 },
    { key: "fill", gear: "line-array-10", x: -1.4, y: 0, z: 4.5, rot: 0 },
    { key: "case", gear: "road-case-m", x: 0, y: 0, z: 1.2, rot: 0 },
  ],
  caseLoad: [
    { key: "nl4", kind: "speaker", lengthM: 10 },
    { key: "nl8", kind: "speaker", lengthM: 10, ends: ["nl8", "nl8"] },
    { key: "iec", kind: "power", lengthM: 10 },
    { key: "true1", kind: "power", lengthM: 10, ends: ["edison", "powercon-true1"] },
  ],
};

test("each box takes the plug on its sheet: speakON not into a quarter-inch link, NL8 for a four-way box, TRUE1 for powerCON", () => {
  setDial("sim");
  const w = newWorld(PANELS_ROOM), c = newCables(w), behind = (x: number, z = 1.9) => walkWith(w, c, x, z);
  // The passive top: a speakON goes in its NL4, not its quarter-inch link.
  behind(0.4, 1.2); expect(takeCable(w, c, "speaker")).toEqual({ ok: true });
  behind(-1.4);
  expect(plug(w, c, "top", "speaker-out")).toEqual({ ok: false, why: "that speakON NL4 plug won't go into a quarter-inch TS socket" });
  expect(plug(w, c, "top", "speaker-in")).toEqual({ ok: true });
  // The four-way line array box: the NL4's two pairs aren't enough, the NL8's four are.
  behind(0.4, 1.2); expect(grabEnd(w, c, "nl4", "b")).toEqual({ ok: true });
  behind(1.2);
  expect(plug(w, c, "array", "speaker-in")).toEqual({ ok: false, why: "a speakON carries 2 amp channels and the passive line array element takes 4: it wants an NL8 cable" });
  expect(dropEnd(c)).toEqual({ ok: true });
  behind(0.4, 1.2); expect(takeCable(w, c, "speaker")).toEqual({ ok: true });
  behind(1.2); expect(plug(w, c, "array", "speaker-in")).toEqual({ ok: true });
  // The powered line array box: an IEC cord won't go in its powerCON TRUE1 inlet, a TRUE1 cord does.
  behind(0.4, 1.2); expect(takeCable(w, c, "power")).toEqual({ ok: true });
  walkWith(w, c, -2.0, 0.7); expect(plug(w, c, "outlet", "power-out-1")).toEqual({ ok: true });
  behind(0.4, 1.2); expect(grabEnd(w, c, "iec", "b")).toEqual({ ok: true });
  behind(-1.4, 3.9);
  expect(plug(w, c, "fill", "power-in")).toEqual({ ok: false, why: "that IEC plug won't go into a powerCON TRUE1 socket" });
  expect(dropEnd(c)).toEqual({ ok: true });
  behind(0.4, 1.2); expect(takeCable(w, c, "power")).toEqual({ ok: true });
  walkWith(w, c, -2.0, 0.7); expect(plug(w, c, "outlet", "power-out-2")).toEqual({ ok: true });
  behind(0.4, 1.2); expect(grabEnd(w, c, "true1", "b")).toEqual({ ok: true });
  behind(-1.4, 3.9); expect(plug(w, c, "fill", "power-in")).toEqual({ ok: true });
});
