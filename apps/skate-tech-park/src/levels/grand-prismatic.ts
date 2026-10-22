// Grand Prismatic: the spring basin, flat as a table, and the low sinter terraces to the south-west.
// A kit park on the basin (a bowl in the middle, a street line round it) with the terraces to pump over.
import { type ParkSpec } from "./park.ts";
import { outcrop, bowl, flatBar, funbox, gap, geyserCone, halfpipe, hip, quarterPipe, spine, tabletop, skyRail } from "./pieces.ts";

const E = Math.PI / 2;

const sinter = gap({ x: -150, z: -180, yaw: E }, { name: "Sinter Jump", span: 30, h: 2.4, w: 8, landH: 2, landLen: 14, reach: 75, bonus: 800 });

export const grandPrismatic: ParkSpec = {
  id: "grand-prismatic",
  weather: "noon",
  name: "Grand Prismatic",
  blurb: "A bowl on the spring basin, a street line round it and the sinter terraces to pump over.",
  earthworks: { hillMin: 0.06 }, // little hill here, so even a gentle rise gets a cut
  zone: "grand-prismatic",
  fill: { lines: 8 },
  sites: [
    { parts: [geyserCone({ x: -200, z: -100 }, { r: 8, h: 2.4 })] },
    { parts: [tabletop({ x: -250, z: -120, yaw: E }, { w: 8, d: 26, h: 1.6 })] },
    { parts: [halfpipe({ x: -100, z: -245 }, { w: 20, d: 40, h: 3, name: "spring runoff pipe" })] },
    { parts: [outcrop({ x: -170, z: -240 }, { r: 3, h: 2 })] },
    { parts: [bowl({ x: -100, z: -60 }, { w: 80, d: 56, h: 5, deck: 6 })] },
    { parts: [flatBar({ x: -230, z: -180, yaw: E }, { len: 14 }), funbox({ x: -190, z: -180, yaw: E }, { w: 10, d: 24, h: 1.2, ramp: 7 })] },
    { parts: [sinter.launch, sinter.landing, hip({ x: -123, z: -180, yaw: E }, { w: 8, d: 6, h: 1.8, name: "geyser cone" })] },
    { parts: [quarterPipe({ x: -40, z: -180, yaw: E }, { w: 14, d: 7, h: 3.6 }), spine({ x: -10, z: -140, yaw: E }, { w: 12, d: 8, h: 2.4 })] },
    // not possible: a bar on stilts that climbs away from the ground
    { parts: [skyRail({ x: -80, z: -120, yaw: E }, { len: 120, y: 1.6, y2: 25.6 })] },
  ],
  spawns: [
    { name: "spring view", x: 55, z: 50, yaw: 1.93 },
    { name: "street line", x: -270, z: -180, yaw: E },
    { name: "bowl deck", x: -100, z: 10, yaw: Math.PI },
    { name: "sky rail", x: -155, z: -120, yaw: E },
  ],
  landmarks: [{ kind: "plume", x: 140, z: 20, tall: 32, r: 6 }, { kind: "rings", x: 140, z: 20, rings: [{ r: 72, color: 0xd9a441 }, { r: 56, color: 0x6aa84f }, { r: 40, color: 0x2fb5a8 }, { r: 24, color: 0x1f5fbf }] }],
  goals: [
    { kind: "score", target: 2500 },
    { kind: "combo", target: 800 },
    { kind: "gap", name: "Sinter Jump" },
    { kind: "collect", count: 4 },
  ],
  pickups: [{ x: -230, z: -180, lift: 1.5 }, { x: -190, z: -180, lift: 2 }, { x: -100, z: -60, lift: 2 }, { x: -40, z: -180, lift: 4 }],
};
