// Rails between the sequoias of the Mariposa Grove: bars threaded through pairs of giants, a funbox in
// a clearing, and a fallen giant to jump. The grove's ground rolls gently, so every spot sits on a pad.
import { type ParkSpec, type Tree } from "./park.ts";
import { flatBar, funbox, gap, handrail, hip, kicker, quarterPipe } from "./pieces.ts";

const pair = (name: string, x: number, z: number): Tree[] =>
  [-3.2, 3.2].map((dx) => ({ x: x + dx, z, r: 2.2, tall: 40, name }));

const giant = gap({ x: 22, z: 40, yaw: Math.PI / 2 }, { name: "Fallen Giant", span: 6, h: 1.3, landH: 0.8, bonus: 600 });

export const mariposaGrove: ParkSpec = {
  id: "mariposa-grove",
  name: "Mariposa Grove",
  blurb: "Skate the needle between the Faithful Couple and the Clothespin, and jump the fallen giant.",
  zone: "mariposa-grove",
  sites: [
    { x: -41, z: -8, r: 8, parts: [] },
    { x: -8, z: 40, r: 5, parts: [] },
    { x: -41, z: 18, r: 12, parts: [handrail({ x: -41, z: 18 }, { len: 18, y: 1 })] },
    { x: -41, z: 42, r: 8, parts: [funbox({ x: -41, z: 42 }, { w: 6, d: 12, h: 0.7 })] },
    { x: -16, z: 1, r: 12, parts: [handrail({ x: -16, z: 1 }, { len: 16, y: 1 }), flatBar({ x: -16, z: 18 }, { len: 6 })] },
    { x: 0, z: 40, r: 8, parts: [hip({ x: 0, z: 40 }, { w: 7, d: 7, h: 1.2 }), kicker({ x: 8, z: 40, yaw: Math.PI / 2 }, { w: 4, d: 3, h: 0.8 })] },
    { x: 22, z: 40, r: 10, parts: [giant.launch, giant.landing, hip({ x: 25, z: 40, yaw: Math.PI / 2 }, { w: 3, d: 2.4, h: 0.9, name: "fallen giant" })] },
    { x: 46, z: 40, r: 8, parts: [quarterPipe({ x: 48, z: 40, yaw: Math.PI / 2 }, { w: 8, d: 4, h: 2.2 })] },
  ],
  trees: [...pair("Faithful Couple", -41, 18), ...pair("Clothespin", -16, 1)],
  spawns: [
    { name: "grove road", x: -41, z: -8, yaw: 0 },
    { name: "clearing", x: -8, z: 40, yaw: Math.PI / 2 },
  ],
  bounds: { minX: -70, maxX: 62, minZ: -24, maxZ: 70 },
  goals: [
    { kind: "score", target: 2000 },
    { kind: "combo", target: 800 },
    { kind: "gap", name: "Fallen Giant" },
    { kind: "collect", count: 5 },
  ],
  pickups: [{ x: -41, z: 10, lift: 1.5 }, { x: -41, z: 26, lift: 1.5 }, { x: -16, z: -4, lift: 1.5 }, { x: -16, z: 8, lift: 1.5 }, { x: -41, z: 42, lift: 1.6 }],
};
