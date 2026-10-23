// Yosemite Falls: a flat shelf above the falls, with the valley 90 m below. Hit the lip at the edge and
// clear the drop to the valley slope, then ride the valley floor's street line.
import { type ParkSpec } from "./park.ts";
import { bowl, flatBar, funbox, gap, halfpipe, hip, stairSet, tabletop, skyRail } from "./pieces.ts";

const E = Math.PI / 2;

const hop = gap({ x: 150, z: 80, yaw: E }, { name: "Valley Hop", span: 30, h: 2.4, w: 8, landH: 2, landLen: 14, reach: 75, bonus: 800 });

export const yosemiteFalls: ParkSpec = {
  id: "yosemite-falls",
  weather: "rain",
  name: "Yosemite Falls",
  blurb: "Build speed on the shelf above the falls and clear the drop, then skate the valley floor.",
  zone: "yosemite-falls",
  fill: { lines: 8 },
  sites: [
    { parts: [halfpipe({ x: 100, z: -40 }, { w: 20, d: 40, h: 3 })] },
    { parts: [tabletop({ x: 220, z: 100, yaw: E }, { w: 8, d: 26, h: 1.6 })] },
    { parts: [flatBar({ x: 20, z: 60, yaw: E }, { len: 14 }), funbox({ x: 70, z: 60, yaw: E }, { w: 10, d: 24, h: 1.2, ramp: 7 })] },
    { parts: [hop.launch, hop.landing, hip({ x: 177, z: 80, yaw: E }, { w: 8, d: 6, h: 1.8, name: "boulder" })] },
    { parts: [bowl({ x: 140, z: 170 }, { w: 64, d: 46, h: 4.5, deck: 5 }), stairSet({ x: 60, z: 130, yaw: E }, { w: 8, steps: 6, rise: 0.25, run: 0.9 })] },
    // not possible: a bar on stilts that climbs away from the ground
    { parts: [skyRail({ x: 100, z: 215, yaw: E }, { len: 160, y: 1.6, y2: 14 })] },
  ],
  gaps: [
    { name: "Upper Fall", a: { x: -195, z: -220 }, b: { x: -105, z: -215 }, r: 30, rb: 70, bonus: 3500, min: 40 },
  ],
  spawns: [
    { name: "falls view", x: 20, z: -190, yaw: -1.7 },
    { name: "shelf", x: -285, z: -220, yaw: E },
    { name: "valley line", x: -20, z: 60, yaw: E },
    { name: "sky rail", x: -5, z: 215, yaw: E },
  ],
  landmarks: [{ kind: "falls", from: { x: -195, z: -220 }, to: { x: -135, z: -220 }, width: 18 }],
  goals: [
    { kind: "score", target: 3000 },
    { kind: "combo", target: 1000 },
    { kind: "gap", name: "Upper Fall" },
    { kind: "gap", name: "Valley Hop" },
    { kind: "collect", count: 4 },
  ],
  pickups: [{ x: -240, z: -220, lift: 1.5 }, { x: -205, z: -220, lift: 4 }, { x: 20, z: 60, lift: 1.5 }, { x: 70, z: 60, lift: 2 }, { x: 140, z: 170, lift: 2 }],
};
