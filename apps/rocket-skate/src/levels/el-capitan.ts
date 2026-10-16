// The meadow under El Capitan, flat enough to string a line together. One run goes east: a flat bar, a
// funbox, a hop over a boulder, then a quarter pipe to turn round on; the way back west is stairs, a
// hubba, a hip and a spine.
import { type ParkSpec } from "./park.ts";
import { flatBar, funbox, gap, handrail, hip, hubba, quarterPipe, spine, stairSet } from "./pieces.ts";

const E = Math.PI / 2, W = -Math.PI / 2;

const boulder = gap({ x: -2, z: 75, yaw: E }, { name: "Boulder Gap", span: 7, h: 1.4, landH: 0.9, bonus: 600 });

export const elCapitan: ParkSpec = {
  id: "el-capitan",
  name: "El Capitan Meadow",
  blurb: "The meadow under the wall: a line east over a boulder, a quarter pipe to turn on, and a street line back.",
  zone: "el-capitan",
  sites: [
    { x: -50, z: 75, r: 10, parts: [flatBar({ x: -50, z: 75, yaw: E }, { len: 8 }), handrail({ x: -50, z: 70, yaw: E }, { len: 8 })] },
    { x: -32, z: 75, r: 10, parts: [funbox({ x: -32, z: 75, yaw: E }, { w: 6, d: 12, h: 0.7 })] },
    { x: 8, z: 75, r: 14, parts: [boulder.launch, boulder.landing, hip({ x: 4.5, z: 75, yaw: E }, { w: 5, d: 3, h: 1, name: "boulder" })] },
    { x: 58, z: 75, r: 10, parts: [quarterPipe({ x: 62, z: 75, yaw: E }, { w: 8, d: 4, h: 2.4 })] },
    { x: 40, z: 95, r: 10, parts: [hip({ x: 44, z: 95 }, { w: 8, d: 8, h: 1.2 }), spine({ x: 34, z: 95, yaw: E }, { w: 8, d: 5, h: 1.4 })] },
    { x: 14, z: 95, r: 12, parts: [stairSet({ x: 18, z: 95, yaw: W }, { w: 4, steps: 6 }), hubba({ x: 8, z: 95, yaw: W })] },
  ],
  spawns: [
    { name: "skate", x: -70, z: 75, yaw: E },
    { name: "car", x: -68, z: 75, yaw: E },
    { name: "return line", x: 66, z: 95, yaw: W },
  ],
  bounds: { minX: -85, maxX: 85, minZ: 40, maxZ: 112 },
  goals: [
    { kind: "score", target: 2500 },
    { kind: "combo", target: 900 },
    { kind: "gap", name: "Boulder Gap" },
    { kind: "collect", count: 5 },
  ],
  pickups: [
    { x: -50, z: 75, lift: 1.4 }, { x: -32, z: 75, lift: 1.6 }, { x: 32, z: 75, lift: 1.6 },
    { x: 62, z: 75, lift: 3.2 }, { x: 18, z: 95, lift: 1.8 },
  ],
};
