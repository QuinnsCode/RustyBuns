// The Grand Canyon's South Rim at Mather Point: a flat limestone shelf to skate on, and where it ends the
// ground falls a thousand real metres to the inner gorge. Hit the kicker at the rim and clear the first drop.
// The first place added with packages/terrain/scripts/fetch-place.ts, so it has no hand-drawn landmarks.
import { type ParkSpec } from "./park.ts";
import { flatBar, funbox, hip, kicker, outcrop, quarterPipe, stairSet, tabletop } from "./pieces.ts";

const E = Math.PI / 2;

export const grandCanyon: ParkSpec = {
  id: "grand-canyon",
  name: "Grand Canyon",
  blurb: "Build speed across the South Rim, hit the lip at Mather Point and clear the first drop into the canyon.",
  zone: "grand-canyon",
  sites: [
    { parts: [flatBar({ x: -120, z: 200, yaw: E }, { len: 14 }), stairSet({ x: -95, z: 200, yaw: E }, { w: 8, steps: 6, rise: 0.25, run: 0.9 })] },
    { parts: [funbox({ x: -40, z: 200, yaw: E }, { w: 10, d: 24, h: 1.2, ramp: 7 }), hip({ x: 0, z: 200 }, { w: 12, d: 12, h: 2.4 })] },
    { parts: [quarterPipe({ x: 50, z: 200, yaw: E }, { w: 14, d: 7, h: 3.6 })] },
    { parts: [tabletop({ x: -30, z: 140, yaw: E }, { w: 8, d: 26, h: 1.6 })] },
    { parts: [outcrop({ x: -150, z: 140 }, { r: 3.5, h: 2.2 }), outcrop({ x: -170, z: 110 }, { r: 3, h: 1.8 })] },
    { parts: [kicker({ x: 90, z: 90, yaw: E }, { w: 12, d: 16, h: 3.5, curve: 1.5, name: "Mather lip" })] },
  ],
  gaps: [
    { name: "Canyon Drop", a: { x: 94, z: 90 }, b: { x: 190, z: 90 }, r: 16, rb: 60, bonus: 3500, min: 45 },
  ],
  spawns: [
    { name: "rim line", x: -140, z: 90, yaw: E },
    { name: "overlook", x: 20, z: 90, yaw: E },
    { name: "street line", x: -140, z: 200, yaw: E },
  ],
  bounds: { minX: -300, maxX: 250, minZ: -100, maxZ: 300 },
  goals: [
    { kind: "score", target: 3000 },
    { kind: "combo", target: 1200 },
    { kind: "gap", name: "Canyon Drop" },
    { kind: "collect", count: 5 },
  ],
  pickups: [-100, -60, -20, 20, 60].map((x) => ({ x, z: 90, lift: 1.4 })),
};
