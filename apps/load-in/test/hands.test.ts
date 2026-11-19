// Your hands on what you pick up: a fist closes round a cable end with every fingertip on the cable (whatever its
// size) and no joint bent past its range, and carrying a cabinet puts both palms flat on its sides. The solver and the
// placement are plain TS, so this runs without a page. The skin over the bones is one closed surface, and bent by the
// same pose its fingers close on what the hand holds.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { CABLE_RADIUS, HandSolver, gripFor, surfaceDistance, type What } from "@rustybuns/rig/hand";
import { PALM_FACE, carryFrames, inFrame } from "../src/hands/place.ts";
import { FINGERS, HAND } from "@rustybuns/rig/hand";
import { buildSkin } from "@rustybuns/rig/hand";

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

  const skin = buildSkin();
  test("the skin is one closed surface: every edge between two triangles", () => {
    const edges = new Map<string, number>(), ix = skin.index;
    for (let t = 0; t < ix.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = ix[t + k], b = ix[t + ((k + 1) % 3)], key = a < b ? `${a} ${b}` : `${b} ${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
  });

  /** The skin bent by the pose of a grip on `what`: how close each finger's skin comes to what it holds (negative: inside). */
  const skinGaps = (what: What) => {
    const grip = gripFor(what), m = solver.pose(grip).mats, P = skin.positions;
    const near = Object.fromEntries(FINGERS.map((f) => [f, Infinity])) as Record<(typeof FINGERS)[number], number>;
    // The thumb's base is the ball of the thumb, part of the palm: its skin is the palm's, flat on what it holds.
    const fingerOf = new Map(FINGERS.flatMap((f) => HAND.chains[f].slice(f === "thumb" ? 1 : 0).map((j) => [j, f] as const)));
    for (let i = 0; i < P.length / 3; i++) {
      // the vertex where its joints carry it: each joint's turn about where it sat at rest, by weight
      let y = 0, z = 0;
      for (let k = 0; k < 4; k++) {
        const j = skin.joints[i * 4 + k], w = skin.weights[i * 4 + k], a = HAND.bones[j].at, o = j * 16;
        const vx = P[i * 3] - a[0], vy = P[i * 3 + 1] - a[1], vz = P[i * 3 + 2] - a[2];
        y += w * (m[o + 1] * vx + m[o + 5] * vy + m[o + 9] * vz + m[o + 13]);
        z += w * (m[o + 2] * vx + m[o + 6] * vy + m[o + 10] * vz + m[o + 14]);
      }
      const f = fingerOf.get(skin.joints[i * 4]);
      if (f) near[f] = Math.min(near[f], surfaceDistance(grip.surface!, y, z));
    }
    return near;
  };
  test.each(holds)("the skin bends with the bones round %s: each finger's skin on it, not through it", (_, what) => {
    const near = skinGaps(what);
    for (const f of FINGERS.slice(1)) {
      expect(near[f]).toBeGreaterThan(-0.001);
      expect(near[f]).toBeLessThan(0.0025);
    }
    // The thumb closes over it too, and doesn't go through it on the way.
    expect(near.thumb).toBeGreaterThan(-0.001);
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
    expect(skinGaps({ kind: "flat" }).thumb).toBeGreaterThan(-0.001);
  });
});
