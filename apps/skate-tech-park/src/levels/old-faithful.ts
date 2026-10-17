// A bowl sunk where Old Faithful blows, on the flat geyser basin; a boardwalk of bars along the west,
// a hop over a steaming vent to the east, and the basin's own low rise beyond it as a launch.
import { type ParkSpec } from "./park.ts";
import { bowl, fallenLog, flatBar, funbox, gap, geyserCone, hip, quarterPipe, rollers, spine, stairSet, skyRail } from "./pieces.ts";

const E = Math.PI / 2;

const vent = gap({ x: 56, z: 75, yaw: E }, { name: "Geyser Hop", span: 30, h: 2.4, w: 8, landH: 1.8, landLen: 14, reach: 75, bonus: 800 });

export const oldFaithful: ParkSpec = {
  id: "old-faithful",
  weather: "overcast",
  name: "Old Faithful Bowl",
  blurb: "A bowl where the geyser blows, a boardwalk of bars along the basin, and a hop over a steaming vent.",
  zone: "old-faithful",
  fill: { lines: 8 },
  relief: 0.7, // the basin is flat: at the default relief no slope is steep enough for a ribbon
  sites: [
    { parts: [geyserCone({ x: -130, z: 100 }, { r: 8, h: 2.4 })] },
    { parts: [rollers({ x: -60, z: 120, yaw: E }, { w: 8, n: 5, period: 7, h: 0.8 })] },
    { parts: [fallenLog({ x: 60, z: 110, yaw: E }, { len: 16, r: 0.8 }), fallenLog({ x: 60, z: 122, yaw: E }, { len: 12, r: 0.6 })] },
    { parts: [bowl({ x: -17, z: 75 }, { w: 44, d: 32, h: 3.5, deck: 4 })] },
    { parts: [flatBar({ x: -150, z: 20, yaw: E }, { len: 14 }), flatBar({ x: -125, z: 20, yaw: E }, { len: 14 })] },
    { parts: [stairSet({ x: -100, z: 20, yaw: E }, { w: 8, steps: 6, rise: 0.25, run: 0.9 }), funbox({ x: -70, z: 20, yaw: E }, { w: 10, d: 24, h: 1.2, ramp: 7 })] },
    { parts: [vent.launch, vent.landing, hip({ x: 74, z: 75, yaw: E }, { w: 8, d: 6, h: 1.8, name: "vent" })] },
    { parts: [quarterPipe({ x: 120, z: 75, yaw: E }, { w: 14, d: 7, h: 3.6 }), spine({ x: 100, z: 100, yaw: E }, { w: 12, d: 8, h: 2.2 })] },
    // not possible: a bar on stilts that climbs away from the ground
    { parts: [skyRail({ x: -20, z: 140, yaw: E }, { len: 120, y: 1.6, y2: 12 })] },
  ],
  spawns: [
    { name: "geyser view", x: -150, z: 75, yaw: E },
    { name: "boardwalk", x: -175, z: 20, yaw: E },
    { name: "vent line", x: 24, z: 75, yaw: E },
    { name: "bowl deck", x: -17, z: 130, yaw: Math.PI },
    { name: "sky rail", x: -100, z: 140, yaw: E },
  ],
  landmarks: [{ kind: "plume", x: -17, z: 75, tall: 55, r: 8 }],
  goals: [
    { kind: "score", target: 2500 },
    { kind: "combo", target: 800 },
    { kind: "gap", name: "Geyser Hop" },
    { kind: "collect", count: 5 },
  ],
  pickups: [{ x: -45, z: 75, lift: 2 }, { x: 10, z: 75, lift: 2 }, { x: -17, z: 95, lift: 2 }, { x: -150, z: 20, lift: 1.5 }, { x: -70, z: 20, lift: 2 }],
};
