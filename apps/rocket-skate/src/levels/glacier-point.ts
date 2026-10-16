// A mega ramp off Glacier Point's overlook: drop in from a deck on the rim, build speed across the
// plateau, launch off a curved ramp at the lip and fly the void to a landing far below. A small rail
// and kicker on the plateau keep the board busy. The long gap is cut for the roadster.
import { type ParkSpec } from "./park.ts";
import { box, flatBar, gap, kicker, rollIn } from "./pieces.ts";

const E = Math.PI / 2;

const mega = gap({ x: 22, z: 0, yaw: E }, { name: "Glacier Point Gap", span: 58, h: 3, curve: 1.3, kick: 28, w: 10, landH: 7, landLen: 20, bonus: 3000, mode: "car" });

export const glacierPoint: ParkSpec = {
  id: "glacier-point",
  name: "Glacier Point Mega Ramp",
  blurb: "Drop in from the rim deck, build speed across the plateau, and clear the void to the landing far below.",
  zone: "glacier-point",
  sites: [
    { x: -62, z: 0, r: 24, parts: [box({ x: -80, z: 0, yaw: E }, { w: 8, d: 8, h: 7, name: "rim deck" }), rollIn({ x: -64, z: 0, yaw: E }, { w: 8, d: 24, h: 7 })] },
    { x: -44, z: 0, r: 6, parts: [] },
    { x: -26, z: 0, r: 10, parts: [flatBar({ x: -26, z: 0, yaw: E }, { len: 10 })] },
    { x: -2, z: 0, r: 12, parts: [kicker({ x: -2, z: 6, yaw: E }, { w: 5, d: 4, h: 1, name: "rim hop" })] },
    { x: 22, z: 0, r: 18, parts: [mega.launch] },
    { x: mega.land.x, z: 0, r: 16, parts: [mega.landing] },
  ],
  spawns: [
    { name: "rim deck", x: -80, z: 0, yaw: E },
    { name: "plateau", x: -44, z: 0, yaw: E },
  ],
  bounds: { minX: -92, maxX: 118, minZ: -30, maxZ: 30 },
  goals: [
    { kind: "score", target: 3000 },
    { kind: "combo", target: 1200 },
    { kind: "gap", name: "Glacier Point Gap" },
    { kind: "collect", count: 6 },
  ],
  pickups: [-60, -48, -36, -24, -12, 0].map((x) => ({ x, z: 0, lift: 1.2 })),
};
