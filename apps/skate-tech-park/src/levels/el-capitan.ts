// The meadow under El Capitan and the wall above it. A street line runs east across the flat meadow
// (bars, a funbox, a boulder to jump, a quarter pipe) and a stair, hubba, spine line comes back; the
// wall itself is the big feature: the talus slope under it is a natural quarter pipe, and the goal is to
// ride up it.
import { type ParkSpec } from "./park.ts";
import { flatBar, funbox, gap, handrail, hip, hubba, quarterPipe, skyRail, spine, stairSet } from "./pieces.ts";

const E = Math.PI / 2, W = -Math.PI / 2, N = Math.PI;

const boulder = gap({ x: -10, z: 100, yaw: E }, { name: "Boulder Gap", span: 30, h: 2.4, w: 8, landH: 2, landLen: 14, reach: 55, bonus: 800 });

export const elCapitan: ParkSpec = {
  id: "el-capitan",
  name: "El Capitan Meadow",
  blurb: "A street line across the meadow, and the wall above it: ride the talus up the face.",
  zone: "el-capitan",
  sites: [
    { parts: [flatBar({ x: -100, z: 100, yaw: E }, { len: 14 }), handrail({ x: -76, z: 100, yaw: E }, { len: 14, y: 1.1 })] },
    { parts: [funbox({ x: -48, z: 100, yaw: E }, { w: 10, d: 24, h: 1.2, ramp: 7 })] },
    { parts: [boulder.launch, boulder.landing, hip({ x: 8, z: 100, yaw: E }, { w: 8, d: 6, h: 1.8, name: "boulder" })] },
    { parts: [quarterPipe({ x: 80, z: 100, yaw: E }, { w: 14, d: 7, h: 4 })] },
    { parts: [hip({ x: 60, z: 130 }, { w: 12, d: 12, h: 2.4 }), spine({ x: 30, z: 130, yaw: E }, { w: 12, d: 8, h: 2.4 })] },
    { parts: [stairSet({ x: 0, z: 130, yaw: W }, { w: 8, steps: 8, rise: 0.25, run: 0.9 }), hubba({ x: -30, z: 130, yaw: W }, { steps: 8, rise: 0.25, run: 0.9 })] },
    // not possible: a bar on stilts that climbs away from the meadow, 160 m long
    { parts: [skyRail({ x: -50, z: 155, yaw: E }, { len: 160, y: 1.6, y2: 14 })] },
  ],
  spawns: [
    { name: "wall view", x: 36, z: 150, yaw: N },
    { name: "street line", x: -125, z: 100, yaw: E },
    { name: "sky rail", x: -140, z: 155, yaw: E },
    { name: "return line", x: 90, z: 130, yaw: W },
  ],
  granite: 140,
  bounds: { minX: -150, maxX: 120, minZ: -70, maxZ: 170 },
  goals: [
    { kind: "score", target: 3000 },
    { kind: "combo", target: 1000 },
    { kind: "gap", name: "Boulder Gap" },
    { kind: "climb", metres: 25, name: "the wall" },
  ],
  pickups: [
    { x: -100, z: 100, lift: 1.5 }, { x: -48, z: 100, lift: 2 }, { x: 80, z: 100, lift: 4.5 },
    { x: 36, z: 10, lift: 2 }, { x: 36, z: -15, lift: 2 },
  ],
};
