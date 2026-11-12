// Mothman from the Point Pleasant statue and the 1966 witness accounts: a tall, lean, muscular grey man-shape, the head
// small and sunk between the shoulders, two huge glowing red eyes, a pale furred collar like a moth's thorax, and great
// moth wings towering behind it, a pointed forewing rising above the head and a rounder hindwing below, ragged at the edge.
import { type Blob, type Ell, type N, type Part, type V, add, along, chain, mul, norm, onSkin, pair, write } from "./lib.ts";

const nodes: Record<string, N> = {
  hip: [0, 0.98, 0, 0.14],
  belly: [0.02, 1.2, 0, 0.16],
  chest: [0.05, 1.45, 0, 0.19],
  neck: [0.08, 1.68, 0, 0.13],
  head: [0.15, 1.8, 0, 0.1],
  l_hipj: [0, 0.94, 0.12, 0.1],
  l_knee: [0.1, 0.55, 0.14, 0.075],
  l_ankle: [0, 0.15, 0.14, 0.055],
  l_foot: [0.07, 0.06, 0.14, 0.045],
  l_shoulder: [0.04, 1.6, 0.25, 0.09],
  l_elbow: [0.07, 1.25, 0.33, 0.06],
  l_wrist: [0.16, 1.0, 0.33, 0.045],
  l_hand: [0.2, 0.93, 0.32, 0.04],
  // the collar: a ring of puffs round the neck, painted pale
  collar_f: [0.19, 1.64, 0, 0.03],
  collar_b: [-0.07, 1.7, 0, 0.03],
  l_collar1: [0.13, 1.66, 0.15, 0.03],
  l_collar2: [0.0, 1.69, 0.21, 0.03],
  // the forewing's leading edge, from the back up past the head to the pointed tip
  l_wroot: [-0.12, 1.58, 0.12, 0.06],
  l_welbow: [-0.24, 2.15, 0.52, 0.04],
  l_wtip: [-0.3, 2.8, 0.92, 0.03],
};
const links = [
  ...chain(["hip", "belly", "chest", "neck", "head"]),
  ...chain(["hip", "l_hipj", "l_knee", "l_ankle", "l_foot"]),
  ...chain(["chest", "l_shoulder", "l_elbow", "l_wrist", "l_hand"]),
  ...chain(["chest", "l_wroot", "l_welbow", "l_wtip"]),
  ["neck", "collar_f"], ["neck", "collar_b"], ["neck", "l_collar1"], ["neck", "l_collar2"],
];

const head: Ell[] = [
  { c: [0, 0.01, 0], r: [0.11, 0.1, 0.11] },
  { c: [0.05, -0.05, 0], r: [0.08, 0.06, 0.085] },
];
const on = onSkin(head);

const blobs: Blob[] = [
  { at: "hip", off: [-0.01, 0, 0], r: [0.15, 0.15, 0.2] },
  { at: "belly", off: [0.01, 0, 0], r: [0.15, 0.18, 0.19] },
  { at: "chest", off: [0, 0.03, 0], r: [0.19, 0.21, 0.28] },
  ...pair("chest", [0.1, 0.06, 0.1], [0.08, 0.1, 0.11]),
  { at: "neck", off: [-0.05, -0.03, 0], r: [0.15, 0.14, 0.27] },
  ...pair("l_shoulder", [0, -0.01, 0.01], [0.11, 0.12, 0.1]),
  ...pair("l_shoulder", along(nodes, "l_shoulder", "l_elbow"), [0.07, 0.19, 0.07]),
  ...pair("l_elbow", along(nodes, "l_elbow", "l_wrist"), [0.055, 0.15, 0.055], [0, 0, 18]),
  ...pair("l_hipj", along(nodes, "l_hipj", "l_knee"), [0.1, 0.21, 0.09]),
  ...pair("l_knee", add(along(nodes, "l_knee", "l_ankle"), [-0.03, 0.02, 0]), [0.075, 0.2, 0.07]),
  { at: "collar_f", off: [0, 0, 0], r: [0.08, 0.07, 0.11] },
  { at: "collar_b", off: [0, 0, 0], r: [0.08, 0.08, 0.13] },
  ...pair("l_collar1", [0, 0, 0], [0.09, 0.075, 0.08]),
  ...pair("l_collar2", [0, 0, 0], [0.09, 0.08, 0.08]),
  ...head.map((e) => ({ at: "head", off: e.c, r: e.r }) as Blob),
];

const eyeDir = norm([1, 0.15, 0.75]);
const eyeAt = on([0.03, 0.01, 0.05], eyeDir, 0.03);
const forewing: (string | V)[] = ["l_wroot", "l_welbow", "l_wtip", [-0.32, 2.68, 1.12], [-0.33, 2.45, 1.28], [-0.35, 2.15, 1.34], [-0.35, 1.88, 1.27], [-0.33, 1.66, 1.08], [-0.27, 1.5, 0.66], [-0.19, 1.45, 0.2]];
const hindwing: V[] = [[-0.17, 1.42, 0.15], [-0.27, 1.4, 0.62], [-0.32, 1.3, 0.92], [-0.34, 1.1, 1.03], [-0.34, 0.88, 0.98], [-0.32, 0.7, 0.8], [-0.28, 0.63, 0.55], [-0.23, 0.72, 0.3], [-0.18, 0.96, 0.15]];
// veins: thin ribs fanned from the wing root over the membrane
const vein = (to: V, len: number): Part => {
  const from: V = [-0.15, 1.5, 0.15], d = norm([to[0] - from[0], to[1] - from[1], to[2] - from[2]]);
  return { kind: "horn", at: "chest", off: [-0.2 - 0.05, 0.03, 0.15], dir: d, len, base: 0.012, tip_base: 0.004, flat: 0.5, mirror: true, material: "vein" };
};
const parts: Part[] = [
  // the eyes: huge glowing red globes with a dark ring round each
  { kind: "eye", at: "head", off: add(eyeAt, mul(eyeDir, -0.012)), r: 0.072, mirror: true, material: "dark" },
  { kind: "eye", at: "head", off: eyeAt, r: 0.066, mirror: true, material: "eye" },
  { kind: "eye", at: "head", off: add(eyeAt, add(mul(eyeDir, 0.045), [0.025, 0.03, -0.02])), r: 0.012, mirror: true, material: "glint" },
  // feathered antennae swept back over the head
  { kind: "horn", at: "head", off: on([0.06, 0.06, 0.03], norm([0.3, 1, 0.3]), 0.01), dir: [0.2, 1, 0.35], len: 0.24, base: 0.014, tip_base: 0.004, curve: 70, bend: [-1, 0, 0], mirror: true, material: "vein" },
  // the wings
  { kind: "membrane", points: forewing, thick: 0.02, camber: 0.08, puff: 0.03, mirror: true, material: "wing" },
  { kind: "membrane", points: hindwing, thick: 0.02, camber: 0.06, puff: 0.025, mirror: true, material: "hindwing" },
  // long clawed fingers and bird-like feet
  ...[-0.03, -0.01, 0.01, 0.03].map((z): Part => ({ kind: "horn", at: "l_hand", off: [0.02, -0.03, z], dir: [0.35, -1, z * 2], len: 0.13, base: 0.016, curve: 45, bend: [1, 0, 0], mirror: true, material: "claw" })),
  { kind: "foot", at: "l_foot", form: "talon", len: 0.17, width: 0.12, toes: 3, spread: 30, sole: 0.06, mirror: true, material: "claw" },
];

write("mothman", {
  feet: 2, wings: 2, budget: 8500, root: "chest", material: "fur", blend: 0.02,
  palette: {
    fur: [0.24, 0.23, 0.24, 0.9, 0],
    ruff: [0.62, 0.58, 0.52, 0.95, 0],
    wing: [0.3, 0.25, 0.21, 0.8, 0],
    hindwing: [0.36, 0.3, 0.25, 0.8, 0],
    vein: [0.14, 0.11, 0.1, 0.7, 0],
    claw: [0.1, 0.09, 0.09, 0.4, 0],
    dark: [0.05, 0.03, 0.03, 0.6, 0],
    eye: [1, 0.08, 0.05, 0.2, 0, 2.6],
    glint: [1, 0.85, 0.8, 0.1, 0],
  },
  nodes, links, blobs, parts,
  paint: [{ nodes: ["collar_f", "collar_b", "l_collar1", "l_collar2"], material: "ruff" }],
  hide: { pattern: "fur", size: 0.03, colours: [[0.16, 0.15, 0.16], [0.33, 0.32, 0.32]], map: 1024 },
}, process.argv[2]);
