// Glacier Point's rim. The plateau is flat enough to build speed on; at its north edge the ground drops
// away in a cliff, and the long gap over that drop is the mega ramp. A funbox and a bar on the plateau
// keep the board busy on the way.
import { type ParkSpec } from "./park.ts";
import { line } from "./lines.ts";
import { bowl, outcrop, flatBar, rockFace, funbox, kicker, tabletop, skyRail } from "./pieces.ts";

const E = Math.PI / 2, N = Math.PI;

export const glacierPoint: ParkSpec = {
  id: "glacier-point",
  weather: "dusk",
  name: "Glacier Point Rim",
  blurb: "Build speed across the plateau, hit the lip at the overlook and clear the drop to the slope below.",
  zone: "glacier-point",
  fill: { lines: 8 },
  sites: [
    { parts: [tabletop({ x: 20, z: 90 }, { w: 8, d: 26, h: 1.6 })] },
    { parts: [outcrop({ x: -80, z: 110 }, { r: 3.5, h: 2.2 }), outcrop({ x: -100, z: 80 }, { r: 3, h: 1.8 })] },
    { parts: [flatBar({ x: -60, z: 20, yaw: N }, { len: 16 }), funbox({ x: -40, z: 20, yaw: N }, { w: 10, d: 24, h: 1.2, ramp: 7 })] },
    { parts: [kicker({ x: -40, z: -48, yaw: N }, { w: 12, d: 16, h: 3.5, curve: 1.5, name: "overlook lip" })] },
    { parts: [kicker({ x: 90, z: 40, yaw: E }, { w: 10, d: 8, h: 2, name: "slope hop" })] },
    { parts: [bowl({ x: 170, z: -150 }, { w: 30, d: 22, h: 2.4, deck: 3, name: "point bowl" }), rockFace({ x: 190, z: -110, yaw: Math.PI }, { w: 10, d: 5, h: 3.4 })] },
    // a line: up a kicker, along a bar, across a manual pad, up a bank onto a ledge and down off its far end
    { parts: [line({ x: 20, z: 190, yaw: N }, ["kicker", "bar", "manualPad", "bankLedge", "downLedge"], { name: "plateau line" })] },
    // not possible: a bar on stilts that climbs away from the ground
    { parts: [skyRail({ x: -40, z: 95, yaw: E }, { len: 100, y: 1.6, y2: 16.6 })] },
  ],
  gaps: [
    { name: "Glacier Point Gap", a: { x: -40, z: -52 }, b: { x: -40, z: -150 }, r: 16, rb: 100, bonus: 3000, min: 50 },
  ],
  spawns: [
    { name: "overlook", x: -40, z: 62, yaw: N },
    { name: "plateau", x: -40, z: 100, yaw: N },
    { name: "slope", x: 40, z: 40, yaw: E },
    { name: "sky rail", x: -105, z: 95, yaw: E },
  ],
  goals: [
    { kind: "score", target: 3000 },
    { kind: "combo", target: 1200 },
    { kind: "gap", name: "Glacier Point Gap" },
    { kind: "collect", count: 6 },
    { kind: "line", name: "plateau line" },
  ],
  pickups: [60, 40, 20, 0, -20, -40].map((z) => ({ x: -40, z, lift: 1.4 })),
};
