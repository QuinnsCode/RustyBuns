// The Grand Canyon's South Rim at Mather Point: a flat limestone shelf to skate on, and where it ends the
// ground falls a thousand real metres to the inner gorge. Hit the kicker at the rim and clear the first drop.
// The first place added with packages/terrain/scripts/fetch-place.ts, so it has no hand-drawn landmarks.
import { type ParkSpec } from "./park.ts";
import { bowl, flatBar, rockFace, funbox, hip, kicker, outcrop, quarterPipe, skyRail, stairSet, tabletop } from "./pieces.ts";

const E = Math.PI / 2;

export const grandCanyon: ParkSpec = {
  id: "grand-canyon",
  weather: "dust",
  name: "Grand Canyon",
  blurb: "Build speed across the South Rim, hit the lip at Mather Point and clear the first drop into the canyon.",
  earthworks: { hillMin: 0.06 }, // little hill here, so even a gentle rise gets a cut
  zone: "grand-canyon",
  fill: { lines: 8 },
  sites: [
    { parts: [flatBar({ x: -120, z: 200, yaw: E }, { len: 14 }), stairSet({ x: -95, z: 200, yaw: E }, { w: 8, steps: 6, rise: 0.25, run: 0.9 })] },
    { parts: [funbox({ x: -40, z: 200, yaw: E }, { w: 10, d: 24, h: 1.2, ramp: 7 }), hip({ x: 0, z: 200 }, { w: 12, d: 12, h: 2.4 })] },
    { parts: [quarterPipe({ x: 50, z: 200, yaw: E }, { w: 14, d: 7, h: 3.6 })] },
    { parts: [tabletop({ x: -30, z: 140, yaw: E }, { w: 8, d: 26, h: 1.6 })] },
    { parts: [outcrop({ x: -150, z: 140 }, { r: 3.5, h: 2.2 }), outcrop({ x: -170, z: 110 }, { r: 3, h: 1.8 })] },
    { parts: [kicker({ x: 90, z: 90, yaw: E }, { w: 12, d: 16, h: 3.5, curve: 1.5, name: "Mather lip" })] },
    // the canyon rim's own stone: a bowl on the flat bench, and two buttresses that turn to vertical
    { parts: [bowl({ x: -230, z: 0 }, { w: 34, d: 24, h: 2.6, deck: 3, name: "rim bowl" })] },
    { parts: [rockFace({ x: -230, z: 90, yaw: Math.PI / 2 }, { w: 14, d: 6, h: 4.4 }), rockFace({ x: -200, z: 150, yaw: -Math.PI / 2 }, { w: 10, d: 5, h: 3.6 })] },
    // not possible: a bar on stilts that climbs away from the ground
    { parts: [skyRail({ x: -50, z: 260, yaw: E }, { len: 100, y: 1.6, y2: 21.6 })] },
  ],
  gaps: [
    { name: "Canyon Drop", a: { x: 94, z: 90 }, b: { x: 190, z: 90 }, r: 16, rb: 60, bonus: 3500, min: 45 },
  ],
  spawns: [
    { name: "rim line", x: -140, z: 90, yaw: E },
    { name: "overlook", x: 20, z: 90, yaw: E },
    { name: "street line", x: -140, z: 200, yaw: E },
    { name: "sky rail", x: -115, z: 260, yaw: E },
  ],
  goals: [
    { kind: "score", target: 3000 },
    { kind: "combo", target: 1200 },
    { kind: "gap", name: "Canyon Drop" },
    { kind: "collect", count: 5 },
  ],
  pickups: [-100, -60, -20, 20, 60].map((x) => ({ x, z: 90, lift: 1.4 })),
};
