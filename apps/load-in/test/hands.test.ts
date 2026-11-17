// Your hands on what you pick up: a fist closes round a cable end with every fingertip on the cable (whatever its
// size) and no joint bent past its range, and carrying a cabinet puts both palms flat on its sides. The solver and the
// placement are plain TS, so this runs without a page.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { CABLE_RADIUS, HandSolver, gripFor, type What } from "../src/hands/grip.ts";
import { PALM_FACE, carryFrames, inFrame } from "../src/hands/place.ts";
import { FINGERS } from "../src/hands/skeleton.ts";

setDefaultTimeout(30_000);
const solver = new HandSolver();

describe("hands", () => {
  const holds: [string, What][] = [
    ["a mic cable", { kind: "cable", radius: CABLE_RADIUS.xlr }],
    ["a power cord", { kind: "cable", radius: CABLE_RADIUS.power }],
    ["a feeder", { kind: "cable", radius: CABLE_RADIUS.feeder }],
    ["a plug", { kind: "plug" }],
    ["a cabinet handle", { kind: "handle" }],
    ["a coil over the fingers", { kind: "roll" }],
  ];
  test.each(holds)("a fist round %s: every fingertip on its surface, every joint in range", (_, what) => {
    const p = solver.pose(gripFor(what));
    for (const f of FINGERS) expect(Math.abs(p.tips[f]!)).toBeLessThan(0.003);
    expect(p.limitsHeld).toBe(true);
  });

  test("carrying a cabinet: both palms flat on its sides, fingers along them", () => {
    const box = { x: 2, y: 0.5, z: 3, rot: 0.6, w: 0.4, h: 0.6, d: 0.35 };
    const { right, left } = carryFrames(box, 18);
    const c = Math.cos(box.rot), s = Math.sin(box.rot), across: [number, number, number] = [c, 0, -s];
    for (const [f, side] of [[right, 1], [left, -1]] as const) {
      const palm = inFrame(f, PALM_FACE, side);
      const out = (palm[0] - box.x) * across[0] + (palm[2] - box.z) * across[2];
      expect(Math.abs(out - (side * box.w) / 2)).toBeLessThan(0.003);
      // the palm (normal -y) faces in (-side across): the back of the hand faces out
      expect((f.y[0] * across[0] + f.y[2] * across[2]) * side).toBeGreaterThan(0.95);
      expect(palm[1]).toBeGreaterThan(box.y);
      expect(palm[1]).toBeLessThan(box.y + box.h);
    }
    const flat = solver.pose(gripFor({ kind: "flat" }));
    for (const f of FINGERS) expect(Math.abs(flat.tips[f]!)).toBeLessThan(0.003);
    expect(flat.limitsHeld).toBe(true);
  });
});
