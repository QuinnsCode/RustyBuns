// Rails between the sequoias of the Mariposa Grove, down the grove's own hillside: bars threaded through
// two pairs of giants, a funbox in a clearing, and a fallen giant to jump. Everything follows the slope.
import { type ParkSpec, type Tree } from "./park.ts";
import { flatBar, funbox, gap, handrail, hip, kicker, quarterPipe } from "./pieces.ts";

// Sequoias at the scale of the giant board: wide enough that the bar between a pair reads as a needle.
const pair = (name: string, x: number, z: number): Tree[] => [-8, 8].map((dx) => ({ x: x + dx, z, r: 4.5, tall: 80, name }));

const giant = gap({ x: 50, z: 30 }, { name: "Fallen Giant", span: 30, h: 2.4, w: 8, landH: 1.8, landLen: 14, reach: 40, bonus: 800 });

export const mariposaGrove: ParkSpec = {
  id: "mariposa-grove",
  name: "Mariposa Grove",
  blurb: "Skate the needle between the Faithful Couple and the Clothespin, and jump the fallen giant.",
  zone: "mariposa-grove",
  sites: [
    { parts: [handrail({ x: -80, z: 0 }, { len: 40, y: 1.2 })] },
    { parts: [funbox({ x: -80, z: 60 }, { w: 10, d: 24, h: 1.2, ramp: 7 })] },
    { parts: [handrail({ x: 50, z: -50 }, { len: 40, y: 1.2 }), flatBar({ x: 50, z: -5 }, { len: 14 })] },
    { parts: [giant.launch, giant.landing, hip({ x: 50, z: 48, yaw: 0 }, { w: 14, d: 5, h: 2, name: "fallen giant" })] },
    { parts: [quarterPipe({ x: 50, z: 100 }, { w: 14, d: 7, h: 3.6 }), kicker({ x: -80, z: 110 }, { w: 8, d: 8, h: 1.6 })] },
  ],
  trees: [...pair("Faithful Couple", -80, 0), ...pair("Clothespin", 50, -50)],
  spawns: [
    { name: "grove road", x: -80, z: -60, yaw: 0 },
    { name: "clearing", x: 50, z: -90, yaw: 0 },
  ],
  bounds: { minX: -150, maxX: 120, minZ: -110, maxZ: 160 },
  goals: [
    { kind: "score", target: 2500 },
    { kind: "combo", target: 900 },
    { kind: "gap", name: "Fallen Giant" },
    { kind: "collect", count: 5 },
  ],
  pickups: [{ x: -80, z: -10, lift: 1.8 }, { x: -80, z: 12, lift: 1.8 }, { x: 50, z: -60, lift: 1.8 }, { x: 50, z: -40, lift: 1.8 }, { x: -80, z: 60, lift: 2 }],
};
