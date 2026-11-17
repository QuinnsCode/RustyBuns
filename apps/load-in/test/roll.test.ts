// The cable roll, bowled the way a stagehand does it: hold the end, send the coil. The weight decides how it goes.
import { expect, test } from "bun:test";
import { mulberry32 } from "@rustybuns/util";
import { pathLength } from "../src/cables/rope.ts";
import { bowl, leftM, newRoll, rollKg, stepRoll, type CableKind, type Roll } from "../src/cables/roll.ts";

const DT = 1 / 60, HAND = { x: 0, y: 1, z: 0 };

/** Pick the roll up, bowl it at full power down +z with the outer end kept in your hand, and let it come to rest. */
function bowled(kind: CableKind, lengthM: number): Roll {
  const r = newRoll(kind, lengthM, { x: 0, z: 0 }), rnd = mulberry32(7);
  r.state = "held"; r.y = 1;
  bowl(r, 0, 1);
  for (let i = 0; i < 60 * 20; i++) stepRoll(r, DT, { a: HAND }, [], rnd, "a");
  return r;
}

test("a mic cable runs the room and a feeder roll dies in a few metres", () => {
  const mic = bowled("xlr", 15), feeder = bowled("power", 15);

  // 0.9 kg of mic cable leaves the arm fast and pays out every metre, lying in a line from your hand.
  expect(mic.state).toBe("out");
  expect(leftM(mic)).toBe(0);
  expect(pathLength(mic.rope)).toBeGreaterThan(14);
  expect(mic.rope.pts.at(-1)!.z).toBeGreaterThan(12);

  // 16.5 kg of feeder gets the same push: it topples a few metres out with most of the cable still on the coil,
  // and what it laid reaches from your hand to where it lies.
  expect(feeder.state).toBe("down");
  expect(feeder.z).toBeGreaterThan(2);
  expect(feeder.z).toBeLessThan(8);
  expect(leftM(feeder)).toBeGreaterThan(6);
  expect(rollKg(feeder)).toBeCloseTo(leftM(feeder) * 1.1, 5);
  const laid = feeder.rope.pts[feeder.paid]!;
  expect(Math.hypot(laid.x - feeder.x, laid.z - feeder.z)).toBeLessThan(0.3);
});

test("dragging laid feeder weighs on your hand, a mic cable hardly does, and a put-down feeder stays put", () => {
  const pull = (kind: CableKind) => {
    const r = bowled(kind, 15), rnd = mulberry32(7);
    r.state = "out"; r.paid = r.rope.pts.length - 1;
    for (let i = 0; i < 120; i++) stepRoll(r, DT, {}, [], rnd);
    const still = r.rope.pts.map((p) => ({ ...p }));
    for (let i = 0; i < 30; i++) stepRoll(r, DT, {}, [], rnd);
    const crept = Math.max(...r.rope.pts.map((p, i) => Math.hypot(p.x - still[i]!.x, p.z - still[i]!.z)));
    // Take the far end and walk on with it at a carrying pace.
    const end = { ...r.rope.pts.at(-1)!, y: 1 };
    let peak = 0;
    for (let i = 0; i < 180; i++) { end.z += 1.2 * DT; stepRoll(r, DT, { b: end }, [], rnd, "b"); peak = Math.max(peak, r.pullKg); }
    return { crept, peak };
  };
  const mic = pull("xlr"), feeder = pull("power");
  expect(feeder.crept).toBeLessThan(0.002);
  expect(feeder.peak).toBeGreaterThan(3);
  expect(mic.peak).toBeLessThan(1);
  expect(feeder.peak).toBeGreaterThan(mic.peak * 3);
});

test("a roll held still keeps its cable, and a walk pays out about what you walk (#5085)", () => {
  // The end is in a wall jack; you stand by it with the 10 m roll in your hand, then walk 4 m away at a carrying pace.
  const r = newRoll("power", 10, { x: 0, z: 0 }), rnd = mulberry32(7), wall = { x: 0, y: 0.3, z: 0 };
  r.state = "held"; r.tailIn = false;
  Object.assign(r, { x: 0, y: 1, z: 0.4 });
  for (let i = 0; i < 120; i++) stepRoll(r, DT, { a: wall }, [], rnd, "b");
  // Two seconds standing: the cable hangs from the coil to the jack, and no more comes off.
  expect(leftM(r)).toBeGreaterThan(8.5);
  const before = leftM(r);
  for (let i = 0; i < 240; i++) { r.z += 1 * DT; stepRoll(r, DT, { a: wall }, [], rnd, "b"); }
  const paid = before - leftM(r);
  expect(paid).toBeGreaterThan(3.4);
  expect(paid).toBeLessThan(4.8);
  // And it is all still cable: what is off the coil is as long as it should be, not stretched.
  expect(pathLength(r.rope)).toBeLessThan((10 - leftM(r)) * 1.05 + 0.3);
});
