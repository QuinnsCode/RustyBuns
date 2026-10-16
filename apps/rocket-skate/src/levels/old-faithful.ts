// A bowl by Old Faithful on the flat geyser basin, a boardwalk of flat bars to the west, and a hop over
// a steaming vent to the east.
import { type ParkSpec } from "./park.ts";
import { bowl, flatBar, funbox, gap, hip, quarterPipe, stairSet } from "./pieces.ts";

const E = Math.PI / 2;

const vent = gap({ x: 24, z: 30, yaw: E }, { name: "Geyser Hop", span: 7, h: 1.4, landH: 0.9, bonus: 600 });

export const oldFaithful: ParkSpec = {
  id: "old-faithful",
  name: "Old Faithful Bowl",
  blurb: "A bowl sunk where the geyser blows, a boardwalk of bars along the basin, and a hop over a steaming vent.",
  zone: "old-faithful",
  sites: [
    { x: -6, z: 27, r: 22, parts: [bowl({ x: -6, z: 27 }, { w: 34, d: 24, h: 2.4 })] },
    { x: -50, z: 60, r: 8, parts: [flatBar({ x: -52, z: 60, yaw: E }, { len: 8 })] },
    { x: -38, z: 60, r: 8, parts: [flatBar({ x: -40, z: 60, yaw: E }, { len: 8 }), stairSet({ x: -32, z: 62, yaw: E }, { w: 4, steps: 4 })] },
    { x: -20, z: 62, r: 8, parts: [funbox({ x: -20, z: 62, yaw: E }, { w: 6, d: 12, h: 0.7 })] },
    { x: 24, z: 30, r: 10, parts: [vent.launch, vent.landing, hip({ x: 28.5, z: 30, yaw: E }, { w: 5, d: 3, h: 1, name: "vent" })] },
    { x: 46, z: 30, r: 8, parts: [quarterPipe({ x: 48, z: 30, yaw: E }, { w: 8, d: 4, h: 2.2 })] },
    { x: -58, z: 40, r: 6, parts: [] },
    { x: -6, z: 47, r: 5, parts: [] },
  ],
  spawns: [
    { name: "boardwalk", x: -58, z: 40, yaw: 0 },
    { name: "bowl deck", x: -6, z: 47, yaw: Math.PI },
  ],
  bounds: { minX: -70, maxX: 58, minZ: 0, maxZ: 80 },
  goals: [
    { kind: "score", target: 2000 },
    { kind: "combo", target: 700 },
    { kind: "gap", name: "Geyser Hop" },
    { kind: "collect", count: 5 },
  ],
  pickups: [{ x: -22, z: 27, lift: 1.4 }, { x: 10, z: 27, lift: 1.4 }, { x: -6, z: 36, lift: 1.4 }, { x: -52, z: 60, lift: 1.4 }, { x: -20, z: 62, lift: 1.6 }],
};
