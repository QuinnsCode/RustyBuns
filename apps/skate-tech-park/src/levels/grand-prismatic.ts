// Grand Prismatic: the spring basin, flat as a table, and the low sinter terraces to the south-west.
// A kit park on the basin (a bowl in the middle, a street line round it) with the terraces to pump over.
import { type ParkSpec } from "./park.ts";
import { bowl, flatBar, funbox, gap, hip, quarterPipe, spine } from "./pieces.ts";

const E = Math.PI / 2;

const sinter = gap({ x: -150, z: -180, yaw: E }, { name: "Sinter Jump", span: 30, h: 2.4, w: 8, landH: 2, landLen: 14, reach: 55, bonus: 800 });

export const grandPrismatic: ParkSpec = {
  id: "grand-prismatic",
  name: "Grand Prismatic",
  blurb: "A bowl on the spring basin, a street line round it and the sinter terraces to pump over.",
  zone: "grand-prismatic",
  sites: [
    { parts: [bowl({ x: -100, z: -60 }, { w: 80, d: 56, h: 5, deck: 6 })] },
    { parts: [flatBar({ x: -230, z: -180, yaw: E }, { len: 14 }), funbox({ x: -190, z: -180, yaw: E }, { w: 10, d: 24, h: 1.2, ramp: 7 })] },
    { parts: [sinter.launch, sinter.landing, hip({ x: -123, z: -180, yaw: E }, { w: 8, d: 6, h: 1.8, name: "geyser cone" })] },
    { parts: [quarterPipe({ x: -40, z: -180, yaw: E }, { w: 14, d: 7, h: 3.6 }), spine({ x: -10, z: -140, yaw: E }, { w: 12, d: 8, h: 2.4 })] },
  ],
  spawns: [
    { name: "spring view", x: 55, z: 50, yaw: 1.93 },
    { name: "street line", x: -270, z: -180, yaw: E },
    { name: "bowl deck", x: -100, z: 10, yaw: Math.PI },
  ],
  landmarks: [{ kind: "plume", x: 140, z: 20, tall: 32, r: 6 }, { kind: "rings", x: 140, z: 20, rings: [{ r: 72, color: 0xd9a441 }, { r: 56, color: 0x6aa84f }, { r: 40, color: 0x2fb5a8 }, { r: 24, color: 0x1f5fbf }] }],
  bounds: { minX: -290, maxX: 230, minZ: -290, maxZ: 140 },
  goals: [
    { kind: "score", target: 2500 },
    { kind: "combo", target: 800 },
    { kind: "gap", name: "Sinter Jump" },
    { kind: "collect", count: 4 },
  ],
  pickups: [{ x: -230, z: -180, lift: 1.5 }, { x: -190, z: -180, lift: 2 }, { x: -100, z: -60, lift: 2 }, { x: -40, z: -180, lift: 4 }],
};
