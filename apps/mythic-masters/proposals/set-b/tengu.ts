// Tengu from the Kamakura shrine statues, the Shinagawa festival mask and a Hokusai sketch: the great mountain tengu
// as a mountain ascetic. A red face with a very long nose, fierce eyes under bushy white brows, a white beard, the small
// black cap on the brow; pale robes with a dark sash and a row of pompoms down the chest, wide trousers, tall
// one-toothed clogs; great black crow's wings, and a fan of feathers in one hand.
import { type Blob, type Ell, type N, type Part, type V, add, along, chain, mul, norm, onSkin, pair, write } from "./lib.ts";

const nodes: Record<string, N> = {
  hip: [0, 0.98, 0, 0.14],
  belly: [0.02, 1.16, 0, 0.15],
  chest: [0.05, 1.36, 0, 0.16],
  neck: [0.08, 1.54, 0, 0.07],
  head: [0.12, 1.68, 0, 0.09],
  cap: [0.16, 1.84, 0, 0.03],
  face: [0.22, 1.67, 0, 0.05],
  sash: [0.12, 1.05, 0, 0.04],
  l_hipj: [0, 0.94, 0.11, 0.09],
  l_knee: [0.05, 0.6, 0.15, 0.07],
  l_ankle: [0, 0.27, 0.15, 0.05],
  l_foot: [0.05, 0.19, 0.15, 0.04],
  l_shoulder: [0.04, 1.47, 0.2, 0.07],
  l_elbow: [0.1, 1.18, 0.29, 0.05],
  l_wrist: [0.25, 1.06, 0.26, 0.04],
  l_hand: [0.31, 1.05, 0.24, 0.035],
  l_wroot: [-0.08, 1.45, 0.1, 0.06],
  l_welbow: [-0.26, 1.9, 0.48, 0.045],
  l_wwrist: [-0.14, 2.02, 0.9, 0.035],
  l_wtip: [0.02, 1.8, 1.3, 0.03],
};
const links = [
  ...chain(["hip", "belly", "chest", "neck", "head", "cap"]), ["head", "face"], ["hip", "sash"],
  ...chain(["hip", "l_hipj", "l_knee", "l_ankle", "l_foot"]),
  ...chain(["chest", "l_shoulder", "l_elbow", "l_wrist", "l_hand"]),
  ...chain(["chest", "l_wroot", "l_welbow", "l_wwrist", "l_wtip"]),
];

const head: Ell[] = [
  { c: [0, 0.02, 0], r: [0.11, 0.115, 0.1] },
  { c: [0.06, -0.05, 0], r: [0.08, 0.07, 0.085] },
];
const on = onSkin(head);

const blobs: Blob[] = [
  // the robe: a full chest and belly, broad sleeves, wide trousers flaring to the knee and gathered at the shin
  { at: "hip", off: [0, -0.02, 0], r: [0.17, 0.17, 0.19] },
  { at: "belly", off: [0.01, 0, 0], r: [0.16, 0.18, 0.18] },
  { at: "chest", off: [0, 0.02, 0], r: [0.16, 0.17, 0.22] },
  { at: "neck", off: [0, 0, 0], r: [0.07, 0.08, 0.07] },
  ...pair("l_shoulder", [0, -0.02, 0.02], [0.1, 0.1, 0.09]),
  ...pair("l_shoulder", add(along(nodes, "l_shoulder", "l_elbow"), [-0.02, 0, 0.02]), [0.1, 0.18, 0.09]),
  ...pair("l_elbow", along(nodes, "l_elbow", "l_wrist"), [0.06, 0.12, 0.06], [0, 0, 55]),
  ...pair("l_hipj", along(nodes, "l_hipj", "l_knee"), [0.11, 0.2, 0.1]),
  ...pair("l_knee", along(nodes, "l_knee", "l_ankle", 0.4), [0.085, 0.16, 0.085]),
  ...pair("l_ankle", [0, 0, 0], [0.055, 0.06, 0.055]),
  ...head.map((e) => ({ at: "head", off: e.c, r: e.r }) as Blob),
];

const eyeDir = norm([1, 0.12, 0.55]);
const eyeAt = on([0.04, 0.03, 0.04], eyeDir, 0.016);
const noseAt = on([0.1, -0.02, 0], [1, 0, 0], 0.03);
const parts: Part[] = [
  // fierce eyes: white, a gold iris, a black pupil
  { kind: "eye", at: "head", off: eyeAt, r: 0.03, mirror: true, material: "white" },
  { kind: "eye", at: "head", off: add(eyeAt, mul(eyeDir, 0.016)), r: 0.018, mirror: true, material: "iris" },
  { kind: "eye", at: "head", off: add(eyeAt, mul(eyeDir, 0.026)), r: 0.009, mirror: true, material: "pupil" },
  // the nose: long, thick at the root, lifting a little toward its tip
  { kind: "horn", at: "head", off: noseAt, dir: [1, -0.05, 0], len: 0.26, base: 0.04, tip_base: 0.022, curve: 12, bend: [0, 1, 0], material: "skin" },
  // bushy white brows sweeping up and out, a white moustache and beard
  ...[0.015, 0.04].map((z): Part => ({ kind: "horn", at: "head", off: on([0.07, 0.065, z], norm([1, 0.6, z * 12]), 0.008), dir: [0.5, 0.7, 0.6], len: 0.07, base: 0.026, tip_base: 0.006, curve: 30, bend: [-1, 0, 0], flat: 0.35, mirror: true, material: "hair" })),
  ...[-0.06, -0.035, -0.012, 0.012, 0.035, 0.06].map((z): Part => ({ kind: "horn", at: "head", off: on([0.05, -0.1, z], norm([0.5, -1, z * 4]), 0.02), dir: [0.3, -1, z * 2], len: 0.13, base: 0.04, tip_base: 0.012, curve: 20, bend: [-1, 0, 0], flat: 0.3, material: "hair" })),
  // white hair down the back of the head
  { kind: "tuft", along: ["head", "neck"], n: 4, len: 0.14, base: 0.06, rows: 7, spread: 100, sweep: 2.2, curve: 20, flat: 0.25, sink: 0.9, material: "hair" },
  // the small black cap on the brow: a short wide horn, its top wider than its root
  { kind: "horn", at: "head", off: on([0.04, 0.08, 0], norm([0.35, 1, 0]), 0.01), dir: [0.35, 1, 0], len: 0.07, base: 0.04, tip_base: 0.05, flat: 0.8, material: "cap" },
  // pompoms down the chest, a sash at the waist
  ...[0, 1, 2].map((i): Part => ({ kind: "eye", at: "chest", off: [0.155 - i * 0.008, 0.1 - i * 0.11, 0.07], r: 0.035, mirror: true, material: "pompom" })),
  // great crow's wings: a cupped membrane with long primaries off its rim
  { kind: "membrane", points: ["l_wroot", "l_welbow", "l_wwrist", "l_wtip", [-0.2, 1.5, 1.22], [-0.36, 1.3, 1.0], [-0.46, 1.12, 0.65], [-0.42, 1.02, 0.35], [-0.28, 1.05, 0.15]], thick: 0.025, camber: 0.12, puff: 0.05,
    feathers: { from: 3, to: 8, n: 10, len: 0.42, base: 0.075, flat: 0.15, curve: 12, tip: 0.3 }, mirror: true, material: "wing" },
  // the feather fan in the right hand (its left, +z), the other hand open
  ...[-40, -25, -10, 5, 20, 35].map((a): Part => {
    const r = (a * Math.PI) / 180;
    return { kind: "horn", at: "l_hand", off: [0.04, 0.03, -0.01], dir: [Math.cos(r) * 0.5, Math.cos(r), Math.sin(r)], len: 0.22, base: 0.045, tip_base: 0.03, flat: 0.15, material: "fan" };
  }).map((p, i) => (i === 0 ? p : p)),
  ...[-0.02, 0, 0.02].map((z): Part => ({ kind: "horn", at: "r_hand", off: [0.03, -0.01, z], dir: [1, -0.6, z * 2], len: 0.07, base: 0.014, curve: 50, bend: [0, -1, 0], material: "skin" })),
  // tall one-toothed clogs: a wooden sole on a single high tooth
  { kind: "foot", at: "l_foot", form: "hoof", len: 0.2, width: 0.11, toes: 1, sole: 0.04, mirror: true, material: "wood" },
  { kind: "horn", at: "l_foot", off: [0.02, -0.05, 0], dir: [0, -1, 0], len: 0.11, base: 0.05, tip_base: 0.05, flat: 0.25, mirror: true, material: "wood" },
];

write("tengu", {
  feet: 2, wings: 2, budget: 8500, root: "chest", material: "robe", blend: 0.016,
  palette: {
    robe: [0.88, 0.86, 0.8, 0.85, 0],
    trouser: [0.33, 0.38, 0.5, 0.85, 0],
    sash: [0.26, 0.2, 0.42, 0.8, 0],
    skin: [0.78, 0.12, 0.1, 0.55, 0],
    hair: [0.95, 0.94, 0.9, 0.9, 0],
    cap: [0.07, 0.07, 0.08, 0.5, 0],
    pompom: [0.95, 0.5, 0.12, 0.95, 0],
    wing: [0.06, 0.06, 0.08, 0.6, 0],
    fan: [0.18, 0.2, 0.16, 0.6, 0],
    wood: [0.55, 0.38, 0.22, 0.75, 0],
    white: [0.96, 0.95, 0.9, 0.2, 0],
    iris: [0.95, 0.7, 0.15, 0.2, 0, 0.6],
    pupil: [0.03, 0.03, 0.03, 0.2, 0],
  },
  nodes, links, blobs, parts,
  paint: [
    { nodes: ["head", "face", "cap", "l_hand", "l_wrist"], material: "skin" },
    { nodes: ["l_hipj", "l_knee", "l_ankle", "l_foot"], material: "trouser" },
    { nodes: ["sash"], material: "sash" },
    { nodes: ["l_wroot", "l_welbow", "l_wwrist", "l_wtip"], material: "wing" },
  ],
  hide: { pattern: "skin", size: 0.1, colours: [[0.72, 0.7, 0.66]], map: 1024 },
}, process.argv[2]);
