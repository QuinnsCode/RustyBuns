// Glacier Point's rim. The plateau is flat enough to build speed on; at its north edge the ground drops
// away in a cliff, and the long gap over that drop is the mega ramp. A funbox and a bar on the plateau
// keep the board busy on the way.
import { type ParkSpec } from "./park.ts";
import { flatBar, funbox, kicker } from "./pieces.ts";

const E = Math.PI / 2, N = Math.PI;

export const glacierPoint: ParkSpec = {
  id: "glacier-point",
  name: "Glacier Point Rim",
  blurb: "Build speed across the plateau, hit the lip at the overlook and clear the drop to the slope below.",
  zone: "glacier-point",
  sites: [
    { parts: [flatBar({ x: -60, z: 20, yaw: N }, { len: 16 }), funbox({ x: -40, z: 20, yaw: N }, { w: 10, d: 24, h: 1.2, ramp: 7 })] },
    { parts: [kicker({ x: -40, z: -48, yaw: N }, { w: 12, d: 16, h: 3.5, curve: 1.5, name: "overlook lip" })] },
    { parts: [kicker({ x: 90, z: 40, yaw: E }, { w: 10, d: 8, h: 2, name: "slope hop" })] },
  ],
  gaps: [
    { name: "Glacier Point Gap", a: { x: -40, z: -52 }, b: { x: -40, z: -125 }, r: 16, rb: 45, bonus: 3000 },
  ],
  spawns: [
    { name: "plateau", x: -40, z: 100, yaw: N },
    { name: "car", x: -40, z: 106, yaw: N },
    { name: "slope", x: 40, z: 40, yaw: E },
  ],
  bounds: { minX: -150, maxX: 250, minZ: -200, maxZ: 130 },
  goals: [
    { kind: "score", target: 3000 },
    { kind: "combo", target: 1200 },
    { kind: "gap", name: "Glacier Point Gap" },
    { kind: "collect", count: 6 },
  ],
  pickups: [60, 40, 20, 0, -20, -40].map((z) => ({ x: -40, z, lift: 1.4 })),
};
