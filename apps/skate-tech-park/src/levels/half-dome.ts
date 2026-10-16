// Half Dome: a street line on the quiet east flat, and the dome itself. Ride up its east shoulder (a long
// natural ramp), cross the crest, and fly off the sheer west face.
import { type ParkSpec } from "./park.ts";
import { outcrop, fallenLog, flatBar, funbox, hip, quarterPipe, stairSet } from "./pieces.ts";

const E = Math.PI / 2, W = -Math.PI / 2;

export const halfDome: ParkSpec = {
  id: "half-dome",
  name: "Half Dome",
  blurb: "Ride up the dome's east shoulder, cross the crest and fly off the sheer west face.",
  zone: "half-dome",
  sites: [
    { parts: [outcrop({ x: 200, z: 230 }, { r: 4, h: 2.6 }), outcrop({ x: 214, z: 238 }, { r: 3, h: 1.8 }), outcrop({ x: 188, z: 240 }, { r: 2.6, h: 1.6 })] },
    { parts: [fallenLog({ x: 120, z: 230, yaw: E }, { len: 18, r: 0.9 })] },
    { parts: [flatBar({ x: 130, z: 190, yaw: E }, { len: 14 }), stairSet({ x: 155, z: 190, yaw: E }, { w: 8, steps: 6, rise: 0.25, run: 0.9 })] },
    { parts: [funbox({ x: 195, z: 190, yaw: E }, { w: 10, d: 24, h: 1.2, ramp: 7 }), hip({ x: 230, z: 190 }, { w: 12, d: 12, h: 2.4 })] },
    { parts: [quarterPipe({ x: 265, z: 190, yaw: E }, { w: 14, d: 7, h: 3.6 })] },
  ],
  gaps: [
    { name: "Half Dome Face", a: { x: -30, z: 20 }, b: { x: -120, z: -30 }, r: 45, rb: 110, bonus: 4000, min: 45 },
  ],
  spawns: [
    { name: "dome view", x: 280, z: 60, yaw: -1.5 },
    { name: "flat line", x: 100, z: 190, yaw: E },
    { name: "dome run", x: 150, z: 20, yaw: W },
    { name: "return line", x: 285, z: 215, yaw: W },
  ],
  granite: 195,
  bounds: { minX: -250, maxX: 300, minZ: -100, maxZ: 300 },
  goals: [
    { kind: "score", target: 3000 },
    { kind: "combo", target: 1200 },
    { kind: "gap", name: "Half Dome Face" },
    { kind: "climb", metres: 45, name: "the dome" },
  ],
  pickups: [{ x: 130, z: 190, lift: 1.5 }, { x: 195, z: 190, lift: 2 }, { x: 265, z: 190, lift: 4 }, { x: 80, z: 20, lift: 1.5 }, { x: 20, z: 20, lift: 1.5 }],
};
