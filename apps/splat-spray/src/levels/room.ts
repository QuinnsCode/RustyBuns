// What's in the room. Each entry draws itself around a point, so the layout
// can move things without touching the drawing code.
import * as THREE from "three";
import { box, cone, cylinder, disc, ellipsoid, shade, sphere, torus, wall } from "./kit.ts";
import { SceneBuilder, shuffled, type SpyScene } from "./scene.ts";

const C = (hex: number) => new THREE.Color(hex);
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const at = (p: THREE.Vector3, x: number, y: number, z: number) => V(p.x + x, p.y + y, p.z + z);

export interface Thing {
  name: string;
  aliases?: string[];
  /** rough width, so the layout can leave room */
  width: number;
  draw(b: SceneBuilder, p: THREE.Vector3): void;
}

const WHITE = C(0xf1f3f7), BLACK = C(0x15161a), WOOD = C(0x8a5a33), STEEL = C(0xb7bec6);

export const THINGS: Thing[] = [
  {
    name: "rubber duck", aliases: ["duck", "ducky", "rubber ducky"], width: 0.3,
    draw(b, p) {
      const y = C(0xf6c223);
      ellipsoid(b, at(p, 0, 0.09, 0), V(0.15, 0.09, 0.1), y, 0.012);
      sphere(b, at(p, 0.07, 0.19, 0), 0.07, y, 0.012);
      cone(b, at(p, 0.12, 0.19, 0), 0.09, 0.03, C(0xe8791b), { axis: "x", size: 0.008 });
      sphere(b, at(p, 0.1, 0.22, 0.04), 0.012, BLACK, 0.006);
      sphere(b, at(p, 0.1, 0.22, -0.04), 0.012, BLACK, 0.006);
    },
  },
  {
    name: "mug", aliases: ["coffee mug", "cup", "coffee cup"], width: 0.26,
    draw(b, p) {
      cylinder(b, at(p, 0, 0, 0), 0.17, 0.09, WHITE, { size: 0.01 });
      disc(b, at(p, 0, 0.16, 0), 0.085, C(0x3a2216), 0.01);
      torus(b, at(p, 0.12, 0.09, 0), 0.055, 0.016, WHITE, { plane: "xy", size: 0.008 });
    },
  },
  {
    name: "apple", aliases: ["red apple"], width: 0.2,
    draw(b, p) {
      sphere(b, at(p, 0, 0.09, 0), 0.09, C(0xc7332c), 0.01);
      cylinder(b, at(p, 0, 0.16, 0), 0.06, 0.008, C(0x5a3a1f), { size: 0.006 });
      ellipsoid(b, at(p, 0.04, 0.21, 0), V(0.04, 0.012, 0.025), C(0x3f7d34), 0.007);
    },
  },
  {
    name: "dice", aliases: ["die", "a dice", "game dice"], width: 0.16,
    draw(b, p) {
      box(b, at(p, 0, 0.07, 0), V(0.14, 0.14, 0.14), WHITE, 0.009);
      for (const [x, y, z] of [[0, 0.141, 0], [0.071, 0.07, 0.04], [0.071, 0.07, -0.04], [-0.071, 0.07, 0], [0.04, 0.07, 0.071], [-0.04, 0.07, 0.071]] as const) {
        sphere(b, at(p, x, y, z), 0.014, BLACK, 0.006);
      }
    },
  },
  {
    name: "tennis ball", aliases: ["ball"], width: 0.18,
    draw(b, p) { sphere(b, at(p, 0, 0.08, 0), 0.08, C(0xcede3a), 0.01); },
  },
  {
    name: "donut", aliases: ["doughnut", "ring donut"], width: 0.24,
    draw(b, p) {
      torus(b, at(p, 0, 0.05, 0), 0.08, 0.045, C(0xd9a15b), { size: 0.009 });
      torus(b, at(p, 0, 0.085, 0), 0.08, 0.035, C(0xe86ba8), { size: 0.008 });
    },
  },
  {
    name: "birthday cake", aliases: ["cake"], width: 0.34,
    draw(b, p) {
      cylinder(b, at(p, 0, 0, 0), 0.16, 0.16, C(0xf6e7d0), { caps: true, size: 0.012 });
      disc(b, at(p, 0, 0.16, 0), 0.16, C(0xe2657a), 0.012);
      cylinder(b, at(p, 0, 0.16, 0), 0.12, 0.012, C(0x6fa8dc), { size: 0.006 });
      sphere(b, at(p, 0, 0.29, 0), 0.02, C(0xffc94a), 0.008);
    },
  },
  {
    name: "ice cream cone", aliases: ["ice cream", "icecream"], width: 0.22,
    draw(b, p) {
      cone(b, at(p, 0, 0.26, 0), -0.26, 0.075, C(0xcf9a52), { size: 0.009 });
      sphere(b, at(p, 0, 0.29, 0), 0.075, C(0xf3d9e2), 0.01);
      sphere(b, at(p, 0.02, 0.38, 0.01), 0.055, C(0xa3603f), 0.01);
    },
  },
  {
    name: "mushroom", aliases: ["toadstool"], width: 0.24,
    draw(b, p) {
      cylinder(b, at(p, 0, 0, 0), 0.14, 0.035, C(0xf0e6d2), { r2: 0.05, size: 0.009 });
      ellipsoid(b, at(p, 0, 0.14, 0), V(0.13, 0.09, 0.13), (q) => (b.rand() < 0.15 ? C(0xf5f0e4) : C(0xc0281f)), 0.01, { bottom: 0 });
    },
  },
  {
    name: "cactus", aliases: ["potted cactus", "plant"], width: 0.26,
    draw(b, p) {
      cylinder(b, at(p, 0, 0, 0), 0.12, 0.08, C(0xb5623c), { r2: 0.07, caps: true, size: 0.01 });
      disc(b, at(p, 0, 0.12, 0), 0.07, C(0x5b4632), 0.008);
      const g = C(0x3f8a4a);
      cylinder(b, at(p, 0, 0.11, 0), 0.3, 0.045, g, { caps: true, size: 0.009 });
      sphere(b, at(p, 0, 0.41, 0), 0.045, g, 0.009);
      cylinder(b, at(p, -0.09, 0.26, 0), 0.1, 0.025, g, { caps: true, size: 0.008 });
      cylinder(b, at(p, -0.09, 0.26, 0), 0.09, 0.025, g, { axis: "x", size: 0.008 });
    },
  },
  {
    name: "pine tree", aliases: ["tree", "little tree", "christmas tree"], width: 0.3,
    draw(b, p) {
      cylinder(b, at(p, 0, 0, 0), 0.08, 0.03, WOOD, { size: 0.008 });
      const leaf = C(0x2f7d33);
      cone(b, at(p, 0, 0.07, 0), 0.22, 0.14, leaf, { size: 0.01 });
      cone(b, at(p, 0, 0.2, 0), 0.2, 0.1, leaf, { size: 0.01 });
      cone(b, at(p, 0, 0.32, 0), 0.16, 0.06, leaf, { size: 0.01 });
    },
  },
  {
    name: "snowman", aliases: ["snow man"], width: 0.26,
    draw(b, p) {
      const snow = C(0xeef2ff);
      sphere(b, at(p, 0, 0.1, 0), 0.1, snow, 0.01);
      sphere(b, at(p, 0, 0.24, 0), 0.075, snow, 0.01);
      sphere(b, at(p, 0, 0.36, 0), 0.055, snow, 0.01);
      cone(b, at(p, 0, 0.36, 0.05), 0.06, 0.012, C(0xf2721a), { axis: "z", size: 0.006 });
      cylinder(b, at(p, 0, 0.4, 0), 0.06, 0.04, BLACK, { caps: true, size: 0.007 });
    },
  },
  {
    name: "rocket", aliases: ["toy rocket", "spaceship"], width: 0.2,
    draw(b, p) {
      cylinder(b, at(p, 0, 0.02, 0), 0.3, 0.06, WHITE, { caps: true, size: 0.01 });
      cone(b, at(p, 0, 0.32, 0), 0.12, 0.06, C(0xcf3b30), { size: 0.009 });
      for (const t of [0, 2.09, 4.19]) box(b, at(p, Math.cos(t) * 0.07, 0.07, Math.sin(t) * 0.07), V(0.07, 0.1, 0.012), C(0xcf3b30), 0.008);
    },
  },
  {
    name: "toy car", aliases: ["car", "red car"], width: 0.34,
    draw(b, p) {
      box(b, at(p, 0, 0.07, 0), V(0.3, 0.07, 0.14), C(0xc02b2b), 0.01);
      box(b, at(p, -0.02, 0.13, 0), V(0.16, 0.06, 0.12), C(0x2a3440), 0.009);
      for (const x of [-0.1, 0.1]) for (const z of [-0.07, 0.07]) torus(b, at(p, x, 0.04, z), 0.04, 0.018, BLACK, { plane: "xy", size: 0.007 });
    },
  },
  {
    name: "house", aliases: ["toy house", "block house"], width: 0.3,
    draw(b, p) {
      box(b, at(p, 0, 0.1, 0), V(0.22, 0.2, 0.2), C(0xa8503c), 0.011);
      cone(b, at(p, 0, 0.2, 0), 0.12, 0.17, C(0x5b4038), { size: 0.011 });
      box(b, at(p, 0, 0.06, 0.101), V(0.06, 0.12, 0.01), C(0x4a2f1d), 0.007);
    },
  },
  {
    name: "chair", aliases: ["doll chair", "little chair"], width: 0.24,
    draw(b, p) {
      box(b, at(p, 0, 0.14, 0), V(0.16, 0.014, 0.16), WOOD, 0.009);
      box(b, at(p, 0, 0.23, -0.073), V(0.16, 0.18, 0.014), WOOD, 0.009);
      for (const x of [-0.065, 0.065]) for (const z of [-0.065, 0.065]) cylinder(b, at(p, x, 0, z), 0.14, 0.012, WOOD, { size: 0.007 });
    },
  },
  {
    name: "lamp", aliases: ["desk lamp", "table lamp"], width: 0.28,
    draw(b, p) {
      disc(b, at(p, 0, 0.01, 0), 0.09, C(0x3c4046), 0.009);
      cylinder(b, at(p, 0, 0.01, 0), 0.26, 0.015, C(0x3c4046), { size: 0.007 });
      cone(b, at(p, 0, 0.42, 0), -0.14, 0.13, C(0xf0d78a), { size: 0.011 });
    },
  },
  {
    name: "umbrella", aliases: ["parasol"], width: 0.34,
    draw(b, p) {
      ellipsoid(b, at(p, 0, 0.3, 0), V(0.17, 0.09, 0.17), (q) => (Math.floor((Math.atan2(q.z - p.z, q.x - p.x) / Math.PI) * 4 + 8) % 2 ? C(0xd8322f) : WHITE), 0.01, { bottom: 0 });
      cylinder(b, at(p, 0, 0, 0), 0.34, 0.01, C(0x2f2f34), { size: 0.006 });
      torus(b, at(p, 0.025, 0.02, 0), 0.025, 0.008, C(0x2f2f34), { plane: "xy", size: 0.006 });
    },
  },
  {
    name: "traffic cone", aliases: ["cone", "pylon"], width: 0.2,
    draw(b, p) {
      box(b, at(p, 0, 0.008, 0), V(0.16, 0.016, 0.16), C(0xd94f1e), 0.008);
      cone(b, at(p, 0, 0.015, 0), 0.22, 0.07, (q) => (q.y - p.y > 0.1 && q.y - p.y < 0.15 ? WHITE : C(0xd94f1e)), { size: 0.009 });
    },
  },
  {
    name: "hammer", aliases: ["a hammer", "tool"], width: 0.34,
    draw(b, p) {
      cylinder(b, at(p, -0.14, 0.02, 0), 0.28, 0.016, WOOD, { axis: "x", caps: true, size: 0.008 });
      box(b, at(p, 0.15, 0.03, 0), V(0.07, 0.05, 0.05), STEEL, 0.008);
    },
  },
  {
    name: "screwdriver", aliases: ["a screwdriver"], width: 0.34,
    draw(b, p) {
      cylinder(b, at(p, -0.16, 0.02, 0), 0.12, 0.022, C(0xd2482f), { axis: "x", caps: true, size: 0.007 });
      cylinder(b, at(p, -0.04, 0.02, 0), 0.2, 0.008, STEEL, { axis: "x", caps: true, size: 0.006 });
    },
  },
  {
    name: "pencil", aliases: ["a pencil"], width: 0.3,
    draw(b, p) {
      cylinder(b, at(p, -0.14, 0.012, 0), 0.24, 0.012, C(0xe8b93a), { axis: "x", caps: true, size: 0.006 });
      cone(b, at(p, 0.1, 0.012, 0), 0.04, 0.012, C(0xe0c39a), { axis: "x", size: 0.005 });
      cylinder(b, at(p, -0.16, 0.012, 0), 0.02, 0.013, C(0xe2758f), { axis: "x", caps: true, size: 0.005 });
    },
  },
  {
    name: "book", aliases: ["a book", "blue book"], width: 0.3,
    draw(b, p) {
      box(b, at(p, 0, 0.02, 0), V(0.24, 0.04, 0.17), C(0x2f5fa8), 0.01);
      box(b, at(p, 0.005, 0.042, 0), V(0.22, 0.008, 0.16), C(0xf2ece0), 0.008);
    },
  },
  {
    name: "light bulb", aliases: ["lightbulb", "bulb"], width: 0.18,
    draw(b, p) {
      ellipsoid(b, at(p, 0, 0.14, 0), V(0.07, 0.085, 0.07), C(0xf7f3d8), 0.01);
      cylinder(b, at(p, 0, 0.02, 0), 0.06, 0.035, STEEL, { caps: true, size: 0.008 });
    },
  },
  {
    name: "gift box", aliases: ["present", "gift", "wrapped present"], width: 0.26,
    draw(b, p) {
      box(b, at(p, 0, 0.09, 0), V(0.18, 0.18, 0.18), C(0x3f8f7a), 0.01);
      box(b, at(p, 0, 0.091, 0), V(0.19, 0.19, 0.04), C(0xf0d24a), 0.008);
      box(b, at(p, 0, 0.091, 0), V(0.04, 0.19, 0.19), C(0xf0d24a), 0.008);
      torus(b, at(p, 0, 0.19, 0), 0.04, 0.015, C(0xf0d24a), { size: 0.007 });
    },
  },
  {
    name: "flower", aliases: ["potted flower", "flower pot", "plant"], width: 0.26,
    draw(b, p) {
      cylinder(b, at(p, 0, 0, 0), 0.12, 0.08, C(0xb5623c), { r2: 0.07, caps: true, size: 0.01 });
      cylinder(b, at(p, 0, 0.12, 0), 0.22, 0.012, C(0x4a8f3c), { size: 0.007 });
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * Math.PI * 2;
        sphere(b, at(p, Math.cos(t) * 0.055, 0.35, Math.sin(t) * 0.055), 0.035, C(0xe25c8a), 0.008);
      }
      sphere(b, at(p, 0, 0.35, 0), 0.03, C(0xf6d34a), 0.008);
    },
  },
  {
    name: "wall clock", aliases: ["a clock", "round clock"], width: 0.24,
    draw(b, p) {
      cylinder(b, at(p, 0, 0.1, 0), 0.03, 0.1, C(0x2e3238), { axis: "z", caps: true, size: 0.009 });
      ellipsoid(b, at(p, 0, 0.1, 0.02), V(0.08, 0.08, 0.006), WHITE, 0.009);
      box(b, at(p, 0, 0.13, 0.03), V(0.01, 0.055, 0.008), BLACK, 0.006);
      box(b, at(p, 0.03, 0.1, 0.03), V(0.06, 0.01, 0.008), BLACK, 0.006);
    },
  },
  {
    name: "bucket", aliases: ["a bucket", "pail"], width: 0.26,
    draw(b, p) {
      cylinder(b, at(p, 0, 0, 0), 0.18, 0.08, C(0x4a86c8), { r2: 0.11, size: 0.011 });
      torus(b, at(p, 0, 0.18, 0), 0.11, 0.012, C(0x3b6f9f), { size: 0.007 });
      torus(b, at(p, 0, 0.2, 0), 0.11, 0.008, STEEL, { plane: "xy", size: 0.006 });
    },
  },
  {
    name: "teddy bear", aliases: ["teddy", "bear", "stuffed bear"], width: 0.3,
    draw(b, p) {
      const fur = C(0x9a6b45);
      ellipsoid(b, at(p, 0, 0.12, 0), V(0.09, 0.11, 0.08), fur, 0.011);
      sphere(b, at(p, 0, 0.27, 0), 0.075, fur, 0.011);
      for (const x of [-0.055, 0.055]) sphere(b, at(p, x, 0.33, 0), 0.028, fur, 0.008);
      for (const x of [-0.11, 0.11]) ellipsoid(b, at(p, x, 0.14, 0), V(0.035, 0.07, 0.035), fur, 0.008);
      for (const x of [-0.05, 0.05]) ellipsoid(b, at(p, x, 0.03, 0.02), V(0.04, 0.035, 0.06), fur, 0.008);
      sphere(b, at(p, 0, 0.26, 0.07), 0.022, C(0x54402c), 0.007);
      for (const x of [-0.03, 0.03]) sphere(b, at(p, x, 0.3, 0.06), 0.012, BLACK, 0.006);
    },
  },
];


// ---- more things (one-offs) ----
const MORE: Thing[] = [
  { name: "toy boat", aliases: ["boat", "sailboat"], width: 0.3, draw(b, p) {
    ellipsoid(b, at(p, 0, 0.05, 0), V(0.15, 0.05, 0.07), C(0xc44a3a), 0.01, { bottom: -1, top: 0.2 });
    cylinder(b, at(p, 0, 0.06, 0), 0.26, 0.008, C(0x8a6a45), { size: 0.006 });
    box(b, at(p, 0.05, 0.19, 0), V(0.1, 0.16, 0.008), WHITE, 0.008); } },
  { name: "toy plane", aliases: ["plane", "airplane", "aeroplane"], width: 0.34, draw(b, p) {
    cylinder(b, at(p, -0.14, 0.1, 0), 0.28, 0.035, C(0xdad9d4), { axis: "x", caps: true, size: 0.008 });
    box(b, at(p, 0, 0.1, 0), V(0.08, 0.01, 0.3), C(0x3a72c4), 0.008);
    box(b, at(p, -0.12, 0.14, 0), V(0.04, 0.08, 0.1), C(0x3a72c4), 0.007); } },
  { name: "toy train", aliases: ["train", "locomotive"], width: 0.32, draw(b, p) {
    box(b, at(p, 0, 0.09, 0), V(0.26, 0.12, 0.13), C(0x2f6f4f), 0.01);
    box(b, at(p, -0.06, 0.19, 0), V(0.1, 0.08, 0.11), C(0x2f6f4f), 0.008);
    cylinder(b, at(p, 0.08, 0.16, 0), 0.07, 0.025, C(0x1e1e22), { caps: true, size: 0.007 });
    for (const x of [-0.08, 0.08]) for (const z of [-0.07, 0.07]) torus(b, at(p, x, 0.035, z), 0.035, 0.014, BLACK, { plane: "xy", size: 0.006 }); } },
  { name: "dinosaur", aliases: ["dino", "toy dinosaur", "t rex"], width: 0.34, draw(b, p) {
    const g = C(0x4f8f4a);
    ellipsoid(b, at(p, 0, 0.14, 0), V(0.12, 0.08, 0.07), g, 0.01);
    ellipsoid(b, at(p, 0.13, 0.22, 0), V(0.06, 0.05, 0.05), g, 0.009);
    cone(b, at(p, -0.12, 0.15, 0), 0.18, 0.05, g, { axis: "x", size: 0.009 });
    for (const x of [-0.05, 0.05]) for (const z of [-0.05, 0.05]) cylinder(b, at(p, x, 0, z), 0.1, 0.022, g, { caps: true, size: 0.007 }); } },
  { name: "fish", aliases: ["toy fish", "goldfish"], width: 0.26, draw(b, p) {
    ellipsoid(b, at(p, 0, 0.08, 0), V(0.1, 0.06, 0.04), C(0xe8811b), 0.009);
    cone(b, at(p, -0.1, 0.08, 0), 0.08, 0.05, C(0xe8811b), { axis: "x", size: 0.007 });
    sphere(b, at(p, 0.07, 0.1, 0.03), 0.012, BLACK, 0.005); } },
  { name: "yo-yo", aliases: ["yoyo"], width: 0.16, draw(b, p) {
    for (const z of [-0.02, 0.02]) cylinder(b, at(p, 0, 0.06, z), 0.02, 0.06, C(0xc4306a), { axis: "z", caps: true, size: 0.008 });
    cylinder(b, at(p, 0, 0.06, 0), 0.04, 0.012, C(0xf0ece2), { axis: "z", size: 0.006 }); } },
  { name: "spinning top", aliases: ["top", "toy top"], width: 0.16, draw(b, p) {
    cone(b, at(p, 0, 0.12, 0), -0.12, 0.06, C(0x3a72c4), { size: 0.008 });
    cylinder(b, at(p, 0, 0.12, 0), 0.06, 0.01, C(0xecc63c), { size: 0.006 }); } },
  { name: "bell", aliases: ["a bell", "hand bell"], width: 0.16, draw(b, p) {
    ellipsoid(b, at(p, 0, 0.08, 0), V(0.06, 0.08, 0.06), C(0xd8b44a), 0.008, { bottom: -0.2 });
    cylinder(b, at(p, 0, 0.15, 0), 0.05, 0.008, C(0x8a6a45), { size: 0.006 }); } },
  { name: "shoe", aliases: ["sneaker", "trainer", "a shoe"], width: 0.28, draw(b, p) {
    ellipsoid(b, at(p, 0, 0.04, 0), V(0.13, 0.04, 0.06), WHITE, 0.009);
    ellipsoid(b, at(p, -0.05, 0.09, 0), V(0.07, 0.05, 0.055), C(0x3a72c4), 0.008); } },
  { name: "party hat", aliases: ["hat", "cone hat"], width: 0.2, draw(b, p) {
    cone(b, at(p, 0, 0.01, 0), 0.24, 0.08, (q) => (Math.floor((q.y - p.y) * 20) % 2 ? C(0xe25c8a) : C(0xf0ece2)), { size: 0.009 });
    sphere(b, at(p, 0, 0.26, 0), 0.025, C(0xecc63c), 0.007); } },
  { name: "crown", aliases: ["a crown", "gold crown"], width: 0.2, draw(b, p) {
    const gold = C(0xe0bb45);
    cylinder(b, at(p, 0, 0.01, 0), 0.07, 0.08, gold, { size: 0.008 });
    for (let i = 0; i < 6; i++) { const t = (i / 6) * Math.PI * 2; cone(b, at(p, Math.cos(t) * 0.08, 0.08, Math.sin(t) * 0.08), 0.05, 0.018, gold, { size: 0.006 }); } } },
  { name: "sunglasses", aliases: ["glasses", "shades"], width: 0.24, draw(b, p) {
    const frame = C(0x6f7681), lens = C(0x2a3b52);
    for (const x of [-0.055, 0.055]) {
      torus(b, at(p, x, 0.05, 0), 0.045, 0.008, frame, { plane: "xy", size: 0.005 });
      ellipsoid(b, at(p, x, 0.05, 0), V(0.042, 0.042, 0.005), lens, 0.006);
    }
    box(b, at(p, 0, 0.055, 0), V(0.03, 0.008, 0.008), frame, 0.005);
    for (const x of [-0.1, 0.1]) box(b, at(p, x, 0.05, -0.035), V(0.008, 0.008, 0.08), frame, 0.005); } },
  { name: "magnifying glass", aliases: ["magnifier", "loupe"], width: 0.26, draw(b, p) {
    torus(b, at(p, 0.05, 0.08, 0), 0.06, 0.012, C(0x6a4f3a), { plane: "xy", size: 0.007 });
    ellipsoid(b, at(p, 0.05, 0.08, 0), V(0.055, 0.055, 0.005), C(0xcfe4ee), 0.008);
    cylinder(b, at(p, -0.13, 0.055, 0), 0.13, 0.014, C(0x6a4f3a), { axis: "x", caps: true, size: 0.006 }); } },
  { name: "key", aliases: ["a key", "brass key"], width: 0.2, draw(b, p) {
    torus(b, at(p, -0.07, 0.035, 0), 0.035, 0.009, C(0xd8b44a), { plane: "xy", size: 0.005 });
    cylinder(b, at(p, -0.035, 0.035, 0), 0.13, 0.009, C(0xd8b44a), { axis: "x", caps: true, size: 0.005 });
    for (const x of [0.06, 0.085]) box(b, at(p, x, 0.015, 0), V(0.012, 0.045, 0.01), C(0xd8b44a), 0.005); } },
  { name: "piggy bank", aliases: ["piggybank", "pig"], width: 0.26, draw(b, p) {
    const pink = C(0xe89ab0);
    ellipsoid(b, at(p, 0, 0.1, 0), V(0.1, 0.08, 0.08), pink, 0.01);
    cylinder(b, at(p, 0.1, 0.1, 0), 0.03, 0.035, pink, { axis: "x", caps: true, size: 0.007 });
    for (const x of [-0.05, 0.05]) for (const z of [-0.045, 0.045]) cylinder(b, at(p, x, 0, z), 0.04, 0.02, pink, { caps: true, size: 0.006 }); } },
  { name: "drum", aliases: ["toy drum"], width: 0.26, draw(b, p) {
    cylinder(b, at(p, 0, 0, 0), 0.13, 0.1, C(0xc44a3a), { size: 0.01 });
    disc(b, at(p, 0, 0.13, 0), 0.1, C(0xf0e6d2), 0.01);
    for (const x of [-0.11, 0.11]) cylinder(b, at(p, x, 0.14, 0), 0.16, 0.008, C(0x8a6a45), { axis: "z", size: 0.006 }); } },
  { name: "guitar", aliases: ["toy guitar", "ukulele"], width: 0.36, draw(b, p) {
    ellipsoid(b, at(p, -0.06, 0.05, 0), V(0.1, 0.04, 0.09), C(0xc98a45), 0.01);
    disc(b, at(p, -0.06, 0.09, 0), 0.03, C(0x2a1c12), 0.007);
    cylinder(b, at(p, 0.02, 0.05, 0), 0.2, 0.018, C(0x8a5a33), { axis: "x", caps: true, size: 0.007 }); } },
  { name: "kite", aliases: ["a kite"], width: 0.3, draw(b, p) {
    box(b, at(p, 0, 0.16, 0), V(0.16, 0.22, 0.006), C(0x8e5bc4), 0.009);
    for (let i = 0; i < 4; i++) sphere(b, at(p, 0, 0.04 - i * 0.012, 0.02 + i * 0.05), 0.016, C(0xecc63c), 0.006); } },
  { name: "robot", aliases: ["toy robot", "tin robot"], width: 0.26, draw(b, p) {
    box(b, at(p, 0, 0.12, 0), V(0.12, 0.16, 0.08), STEEL, 0.009);
    box(b, at(p, 0, 0.24, 0), V(0.09, 0.08, 0.08), STEEL, 0.008);
    for (const x of [-0.03, 0.03]) sphere(b, at(p, x, 0.25, 0.042), 0.013, C(0xc4302f), 0.006);
    for (const x of [-0.085, 0.085]) cylinder(b, at(p, x, 0.06, 0), 0.12, 0.016, STEEL, { caps: true, size: 0.006 });
    for (const x of [-0.035, 0.035]) cylinder(b, at(p, x, 0, 0), 0.05, 0.02, STEEL, { caps: true, size: 0.006 }); } },
  { name: "globe", aliases: ["world globe", "earth"], width: 0.24, draw(b, p) {
    sphere(b, at(p, 0, 0.16, 0), 0.09, (q) => (Math.sin(q.x * 14) + Math.cos(q.z * 11) > 0.4 ? C(0x4f8f4a) : C(0x2f6fb0)), 0.01);
    torus(b, at(p, 0, 0.04, 0), 0.05, 0.008, C(0xd8b44a), { size: 0.006 }); } },
  { name: "teapot", aliases: ["tea pot", "kettle"], width: 0.26, draw(b, p) {
    ellipsoid(b, at(p, 0, 0.09, 0), V(0.09, 0.07, 0.09), C(0xdfe3e8), 0.01);
    cylinder(b, at(p, 0, 0.15, 0), 0.03, 0.03, C(0xdfe3e8), { caps: true, size: 0.007 });
    cylinder(b, at(p, 0.09, 0.11, 0), 0.08, 0.015, C(0xdfe3e8), { axis: "x", size: 0.006 });
    torus(b, at(p, -0.11, 0.1, 0), 0.05, 0.012, C(0xdfe3e8), { plane: "xy", size: 0.006 }); } },
  { name: "banana", aliases: ["a banana"], width: 0.24, draw(b, p) {
    for (let i = 0; i < 14; i++) { const t = -1.1 + (i / 13) * 2.2; sphere(b, at(p, Math.sin(t) * 0.11, 0.025 + 0.075 * (1 - Math.cos(t)), 0), 0.026 - Math.abs(t) * 0.008, C(0xe8c93c), 0.008); } } },
  { name: "orange", aliases: ["an orange", "tangerine"], width: 0.18, draw(b, p) {
    sphere(b, at(p, 0, 0.07, 0), 0.07, C(0xe8791b), 0.009);
    ellipsoid(b, at(p, 0.01, 0.14, 0), V(0.025, 0.008, 0.02), C(0x4f8f4a), 0.006); } },
  { name: "carrot", aliases: ["a carrot"], width: 0.2, draw(b, p) {
    cone(b, at(p, -0.08, 0.02, 0), 0.16, 0.03, C(0xe8791b), { axis: "x", size: 0.007 });
    for (let i = 0; i < 4; i++) ellipsoid(b, at(p, -0.1 - i * 0.008, 0.04 + i * 0.01, (i - 1.5) * 0.012), V(0.02, 0.012, 0.01), C(0x4f8f4a), 0.006); } },
  { name: "cupcake", aliases: ["a cupcake", "muffin"], width: 0.18, draw(b, p) {
    cylinder(b, at(p, 0, 0, 0), 0.07, 0.05, C(0xd9a15b), { r2: 0.065, size: 0.008 });
    ellipsoid(b, at(p, 0, 0.08, 0), V(0.07, 0.05, 0.07), C(0xf2c7d8), 0.008);
    sphere(b, at(p, 0, 0.13, 0), 0.016, C(0xc4302f), 0.006); } },
  { name: "cookie", aliases: ["a cookie", "biscuit"], width: 0.16, draw(b, p) {
    cylinder(b, at(p, 0, 0.005, 0), 0.02, 0.065, C(0xc08a4a), { caps: true, size: 0.008 });
    for (let i = 0; i < 6; i++) { const t = (i / 6) * Math.PI * 2; sphere(b, at(p, Math.cos(t) * 0.035, 0.026, Math.sin(t) * 0.035), 0.01, C(0x4a2e1c), 0.005); } } },
  { name: "milk carton", aliases: ["milk", "carton of milk"], width: 0.18, draw(b, p) {
    box(b, at(p, 0, 0.09, 0), V(0.09, 0.18, 0.09), C(0xf2f0ea), 0.009);
    cone(b, at(p, 0, 0.18, 0), 0.05, 0.065, C(0x6fa8dc), { size: 0.007 }); } },
  { name: "cereal box", aliases: ["cereal", "box of cereal"], width: 0.2, draw(b, p) {
    box(b, at(p, 0, 0.13, 0), V(0.14, 0.26, 0.06), C(0xecc63c), 0.01);
    box(b, at(p, 0, 0.15, 0.032), V(0.1, 0.12, 0.006), C(0xc4302f), 0.007); } },
  { name: "watering can", aliases: ["watering pot"], width: 0.3, draw(b, p) {
    cylinder(b, at(p, 0, 0, 0), 0.14, 0.07, C(0x4f9a8f), { caps: true, size: 0.009 });
    cylinder(b, at(p, 0.07, 0.1, 0), 0.14, 0.018, C(0x4f9a8f), { axis: "x", size: 0.007 });
    torus(b, at(p, -0.08, 0.1, 0), 0.05, 0.012, C(0x4f9a8f), { plane: "xy", size: 0.006 }); } },
  { name: "paint brush", aliases: ["brush", "paintbrush"], width: 0.24, draw(b, p) {
    cylinder(b, at(p, -0.1, 0.012, 0), 0.16, 0.012, C(0x8a5a33), { axis: "x", caps: true, size: 0.006 });
    cylinder(b, at(p, 0.06, 0.012, 0), 0.03, 0.016, STEEL, { axis: "x", caps: true, size: 0.005 });
    box(b, at(p, 0.11, 0.012, 0), V(0.05, 0.02, 0.03), C(0x2f6fb0), 0.006); } },
  { name: "scissors", aliases: ["a pair of scissors"], width: 0.24, draw(b, p) {
    for (const z of [-0.015, 0.015]) {
      cylinder(b, at(p, -0.02, 0.01, z), 0.12, 0.008, STEEL, { axis: "x", caps: true, size: 0.005 });
      torus(b, at(p, -0.06, 0.01, z * 2), 0.025, 0.006, C(0xd0333f), { plane: "xz", size: 0.005 });
    } } },
  { name: "toothbrush", aliases: ["tooth brush"], width: 0.22, draw(b, p) {
    cylinder(b, at(p, -0.09, 0.01, 0), 0.16, 0.009, C(0x3a72c4), { axis: "x", caps: true, size: 0.005 });
    box(b, at(p, 0.08, 0.016, 0), V(0.05, 0.014, 0.02), C(0xf2f0ea), 0.005); } },
  { name: "toy phone", aliases: ["phone", "mobile"], width: 0.16, draw(b, p) {
    box(b, at(p, 0, 0.012, 0), V(0.07, 0.02, 0.13), C(0x24262b), 0.006);
    box(b, at(p, 0, 0.023, 0), V(0.055, 0.004, 0.11), C(0x8fd0e8), 0.005); } },
  { name: "alarm clock", aliases: ["clock with bells", "wind up clock"], width: 0.2, draw(b, p) {
    cylinder(b, at(p, 0, 0.09, 0), 0.03, 0.07, C(0xc4302f), { axis: "z", caps: true, size: 0.008 });
    ellipsoid(b, at(p, 0, 0.09, 0.02), V(0.055, 0.055, 0.006), WHITE, 0.007);
    for (const x of [-0.055, 0.055]) sphere(b, at(p, x, 0.15, 0), 0.025, C(0xd8b44a), 0.007);
    for (const x of [-0.03, 0.03]) cylinder(b, at(p, x, 0, 0), 0.03, 0.008, C(0xd8b44a), { size: 0.005 }); } },
];


/** Colour families: cheap variety, and prompts like "a red crayon" that need looking. */
const PALETTE: [string, number][] = [["red", 0xd0333f], ["blue", 0x3a72c4], ["green", 0x3f9a52], ["yellow", 0xecc63c], ["purple", 0x8e5bc4], ["orange", 0xe8791b]];

function variants(): Thing[] {
  const out: Thing[] = [];
  for (const [name, hex] of PALETTE) {
    out.push({
      name: `${name} ball`, aliases: [`${name} bouncy ball`], width: 0.18,
      draw(b, p) { sphere(b, at(p, 0, 0.075, 0), 0.075, C(hex), 0.01); },
    });
    out.push({
      name: `${name} crayon`, aliases: [`${name} pencil crayon`], width: 0.22,
      draw(b, p) {
        cylinder(b, at(p, -0.08, 0.014, 0), 0.16, 0.014, C(hex), { axis: "x", caps: true, size: 0.006 });
        cone(b, at(p, 0.08, 0.014, 0), 0.03, 0.014, C(0xe8d9be), { axis: "x", size: 0.005 });
      },
    });
    out.push({
      name: `${name} block`, aliases: [`${name} brick`, `${name} cube`], width: 0.16,
      draw(b, p) { box(b, at(p, 0, 0.06, 0), V(0.12, 0.12, 0.12), C(hex), 0.009); },
    });
    out.push({
      name: `${name} cup`, aliases: [`${name} beaker`], width: 0.18,
      draw(b, p) { cylinder(b, at(p, 0, 0, 0), 0.13, 0.055, C(hex), { r2: 0.07, size: 0.008 }); },
    });
    out.push({
      name: `${name} balloon`, aliases: [], width: 0.22,
      draw(b, p) {
        ellipsoid(b, at(p, 0, 0.34, 0), V(0.09, 0.11, 0.09), C(hex), 0.011);
        cylinder(b, at(p, 0, 0.02, 0), 0.22, 0.004, C(0xe8e4dc), { size: 0.005 });
      },
    });
    out.push({
      name: `${name} star`, aliases: [`${name} toy star`], width: 0.22,
      draw(b, p) {
        // standing up, so its outline reads: five tapering arms in the XY plane
        const col = C(hex);
        for (let i = 0; i < 5; i++) {
          const t = Math.PI / 2 + (i / 5) * Math.PI * 2;
          for (let k = 1; k <= 5; k++) {
            const r = (k / 5) * 0.11;
            ellipsoid(b, at(p, Math.cos(t) * r, 0.13 + Math.sin(t) * r, 0), V(0.028 * (1 - k / 6), 0.028 * (1 - k / 6), 0.014), col, 0.007);
          }
        }
        ellipsoid(b, at(p, 0, 0.13, 0), V(0.05, 0.05, 0.016), col, 0.008);
        cylinder(b, at(p, 0, 0, 0), 0.04, 0.012, C(0x8a6a45), { caps: true, size: 0.006 });
      },
    });
  }
  return out;
}

const LAST: Thing[] = [
  { name: "rubber snake", aliases: ["snake", "toy snake"], width: 0.34, draw(b, p) {
    for (let i = 0; i < 16; i++) {
      const t = (i / 15) * Math.PI * 2.2;
      sphere(b, at(p, Math.sin(t) * 0.12, 0.022, -0.14 + (i / 15) * 0.28), 0.022 * (1 - i / 30), C(0x5aa04a), 0.007);
    }
    sphere(b, at(p, 0, 0.03, -0.15), 0.03, C(0x4f8f4a), 0.007); } },
];

export const ALL_THINGS: Thing[] = [...THINGS, ...MORE, ...LAST, ...variants()];

/**
 * Slots: every place a thing can sit. There are more slots than things, so a
 * shuffle moves everything and leaves gaps in different places.
 */
export function roomSlots(rand: () => number): THREE.Vector3[] {
  const slots: THREE.Vector3[] = [];
  const jitter = (n: number) => (rand() - 0.5) * n;
  // three shelves on the back wall
  for (const y of [1.15, 1.72, 2.29]) for (let i = 0; i < 13; i++) slots.push(V(-3.3 + i * 0.55 + jitter(0.08), y, -2.45 + jitter(0.06)));
  // the desk
  for (let i = 0; i < 6; i++) slots.push(V(1.35 + (i % 3) * 0.42 + jitter(0.06), 0.72, -1.2 + Math.floor(i / 3) * 0.4 + jitter(0.06)));
  // the bed
  for (let i = 0; i < 6; i++) slots.push(V(-2.5 + (i % 3) * 0.5 + jitter(0.08), 0.48, -1.35 + Math.floor(i / 3) * 0.5 + jitter(0.08)));
  // the toy chest lid
  for (let i = 0; i < 4; i++) slots.push(V(2.5 + jitter(0.1), 0.52, 0.5 + i * 0.25 + jitter(0.08)));
  // the floor, spread across the middle of the room
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 12; col++) {
      const z = -0.55 + row * 0.52;
      const x = -3.1 + col * 0.56 + (row % 2) * 0.24;
      if (x > 1.0 && z < -0.9) continue;              // under the desk
      if (x < -1.7 && z < -0.9) continue;             // under the bed
      if (x > 2.1 && z > 0.3 && z < 1.4) continue;    // the toy chest
      slots.push(V(x + jitter(0.1), 0.02, z + jitter(0.1)));
    }
  }
  return slots;
}

/** A kid's room: bed, desk, shelves, toy chest, and things everywhere. */
/** The room: a table and a shelf unit against a wall, with the things laid out on them. */
export function buildRoom(opts: { density?: number; seed?: number; shuffle?: boolean } = {}): SpyScene {
  const b = new SceneBuilder(opts);
  const objectDensity = b.density;

  // Scenery is huge in area and only needs to read as a surface, so it gets a
  // fraction of the density the small objects do (a floor at object density is
  // over a million splats by itself).
  b.scenery();
  b.density = objectDensity / 10;
  disc(b, V(0, 0, 0), 9, (p) => shade(C(0x6b5f52), 0.08, b.rand), 0.03);            // floorboards
  disc(b, V(0, 0.005, 0.7), 3.2, (p) => shade(C(0x7a4a5a), 0.1, b.rand), 0.028);      // rug
  wall(b, V(0, 0, -2.7), 13, 3.6, (p) => shade(C(0xaab6c0), 0.05, b.rand), 0.03);   // back wall
  b.density = objectDensity / 3;
  for (const y of [1.08, 1.65, 2.22]) box(b, V(0, y, -2.5), V(7.6, 0.06, 0.44), C(0x8d6a45), 0.018);   // shelves
  // bed
  box(b, V(-2.3, 0.42, -1.1), V(1.9, 0.12, 1.5), C(0x4f6f9a), 0.018);
  box(b, V(-2.3, 0.2, -1.1), V(1.8, 0.32, 1.4), C(0x8a5a33), 0.02);
  box(b, V(-3.0, 0.52, -1.45), V(0.5, 0.1, 0.4), C(0xf0ece2), 0.015);
  // desk
  box(b, V(1.75, 0.68, -1.0), V(1.7, 0.08, 0.9), C(0x9a6f45), 0.018);
  for (const x of [1.0, 2.5]) for (const z of [-1.35, -0.65]) cylinder(b, V(x, 0, z), 0.68, 0.05, C(0x7d5836), { caps: true, size: 0.014 });
  // toy chest
  box(b, V(2.5, 0.25, 0.95), V(0.9, 0.5, 1.4), C(0xa8724a), 0.018);
  box(b, V(2.5, 0.52, 0.95), V(0.95, 0.06, 1.45), C(0x8a5a33), 0.016);
  b.density = objectDensity;

  const slots = roomSlots(b.rand);
  const order = opts.shuffle === false ? slots : shuffled(slots, b.rand);
  ALL_THINGS.forEach((thing, i) => {
    const slot = order[i % order.length]!;
    b.object(thing.name, thing.aliases ?? [], slot);
    thing.draw(b, slot);
  });

  return b.finish();
}
