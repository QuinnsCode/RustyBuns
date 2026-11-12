// Jersey Devil from the 1909 Philadelphia newspaper drawings and the later woodcut: a horse's long head on a long
// neck, small horns, bat wings, a kangaroo's body upright on hocked hind legs with cloven hooves, small clawed arms,
// and a long thin tail ending in an arrowhead.
import { type Blob, type Ell, type N, type Part, type V, add, along, chain, mul, norm, onSkin, pair, write } from "./lib.ts";

const nodes: Record<string, N> = {
  hip: [0, 0.95, 0, 0.14],
  belly: [0.07, 1.15, 0, 0.15],
  chest: [0.14, 1.37, 0, 0.14],
  neck1: [0.17, 1.57, 0, 0.08],
  neck2: [0.18, 1.77, 0, 0.065],
  head: [0.2, 1.95, 0, 0.07],
  horn: [0.15, 2.09, 0, 0.03],
  snout: [0.45, 1.83, 0, 0.04],
  tail1: [-0.24, 0.86, 0, 0.06],
  tail2: [-0.52, 0.66, 0, 0.045],
  tail3: [-0.82, 0.58, 0, 0.035],
  tail4: [-1.08, 0.64, 0, 0.03],
  l_hipj: [0, 0.92, 0.13, 0.1],
  l_knee: [0.17, 0.62, 0.16, 0.075],
  l_hock: [-0.1, 0.3, 0.16, 0.05],
  l_foot: [-0.01, 0.06, 0.16, 0.045],
  l_shoulder: [0.18, 1.4, 0.14, 0.055],
  l_elbow: [0.3, 1.22, 0.2, 0.04],
  l_hand: [0.42, 1.13, 0.18, 0.035],
  l_wroot: [0.02, 1.5, 0.11, 0.06],
  l_welbow: [-0.14, 1.88, 0.42, 0.04],
  l_wwrist: [-0.05, 2.08, 0.82, 0.035],
  l_wtip: [0.15, 1.95, 1.22, 0.03],
};
const links = [
  ...chain(["tail4", "tail3", "tail2", "tail1", "hip", "belly", "chest", "neck1", "neck2", "head", "snout"]), ["head", "horn"],
  ...chain(["hip", "l_hipj", "l_knee", "l_hock", "l_foot"]),
  ...chain(["chest", "l_shoulder", "l_elbow", "l_hand"]),
  ...chain(["chest", "l_wroot", "l_welbow", "l_wwrist", "l_wtip"]),
];

// the head: a cranium and a long horse's muzzle tipped down, a soft nose end and a jaw line under it
const head: Ell[] = [
  { c: [0, 0.01, 0], r: [0.1, 0.085, 0.08] },
  { c: [0.14, -0.06, 0], r: [0.15, 0.06, 0.058] },
  { c: [0.25, -0.11, 0], r: [0.065, 0.06, 0.06] },
  { c: [0.08, -0.08, 0], r: [0.1, 0.05, 0.065] },
];
const on = onSkin(head);

const blobs: Blob[] = [
  { at: "hip", off: [-0.02, 0, 0], r: [0.14, 0.14, 0.14] },
  { at: "belly", off: [0.01, 0, 0], r: [0.16, 0.19, 0.14] },
  { at: "chest", off: [0.01, 0.02, 0], r: [0.17, 0.19, 0.19] },
  { at: "neck1", off: along(nodes, "neck1", "neck2"), r: [0.07, 0.12, 0.06], rot: [0, 0, 4] },
  ...pair("l_hipj", add(along(nodes, "l_hipj", "l_knee"), [-0.02, 0.02, 0]), [0.12, 0.2, 0.095], [0, 0, 28]),
  ...pair("l_knee", along(nodes, "l_knee", "l_hock"), [0.055, 0.18, 0.055], [0, 0, -42]),
  ...pair("l_hock", along(nodes, "l_hock", "l_foot"), [0.038, 0.12, 0.038], [0, 0, 15]),
  ...pair("l_foot", [0, 0.02, 0], [0.05, 0.05, 0.05]),
  ...pair("l_shoulder", along(nodes, "l_shoulder", "l_elbow"), [0.04, 0.1, 0.04], [0, 0, 55]),
  ...pair("l_elbow", along(nodes, "l_elbow", "l_hand"), [0.032, 0.08, 0.032], [0, 0, 50]),
  ...head.map((e) => ({ at: "head", off: e.c, r: e.r }) as Blob),
];

const eyeDir = norm([0.45, 0.35, 1]);
const eyeAt = on([0.02, 0.03, 0.03], eyeDir, 0.012);
const nose = on([0.28, -0.1, 0.03], norm([1, 0.2, 0.55]), 0.008);
const parts: Part[] = [
  // glaring red eyes under a brow, a glint
  { kind: "eye", at: "head", off: eyeAt, r: 0.03, mirror: true, material: "eye" },
  { kind: "eye", at: "head", off: add(eyeAt, mul(eyeDir, 0.022)), r: 0.007, mirror: true, material: "glint" },
  { kind: "ridge", at: "head", off: on([0.04, 0.06, 0.04], norm([0.4, 1, 0.8]), 0.008), dir: [0.6, 0, 1], len: 0.08, base: 0.022, curve: 25, bend: [0, -1, 0], mirror: true, material: "hide" },
  // nostrils, a dark mouth line along the muzzle, two teeth at the front
  { kind: "eye", at: "head", off: nose, r: 0.013, mirror: true, material: "dark" },
  { kind: "ridge", at: "head", off: on([0.2, -0.14, 0.04], norm([0.3, -0.6, 1]), 0.006), dir: [-1, 0.15, 0.1], len: 0.2, base: 0.012, curve: 10, mirror: true, material: "dark" },
  { kind: "horn", at: "head", off: on([0.26, -0.15, 0.025], [0.3, -1, 0.2], 0.01), dir: [0.2, -1, 0], len: 0.035, base: 0.01, mirror: true, material: "fang" },
  // small horns curving back off the crown, and pointed ears behind them
  { kind: "horn", at: "head", off: on([0.0, 0.06, 0.035], norm([0, 1, 0.35]), 0.01), dir: [-0.3, 1, 0.25], len: 0.16, base: 0.026, curve: 55, bend: [-1, 0, 0], mirror: true, material: "horn" },
  { kind: "ear", at: "head", off: on([-0.05, 0.04, 0.05], norm([-0.3, 0.6, 1]), 0.01), dir: [-0.6, 0.7, 0.5], len: 0.14, width: 0.032, tilt: 25, cup: 25, thick: 0.15, mirror: true, material: "hide" },
  // a mane down the neck
  { kind: "tuft", along: ["head", "neck2", "neck1", "chest"], n: 8, len: 0.1, base: 0.04, rows: 3, spread: 40, sweep: 2, curve: 20, flat: 0.3, sink: 0.9, material: "mane" },
  // bat wings: finger bones from the wrist, the membrane sagging between them down to the flank
  { kind: "wing", hub: "l_wwrist", tips: ["l_wtip", [-0.1, 1.55, 1.32], [-0.38, 1.22, 1.05], [-0.45, 1.0, 0.6]], body: [[-0.32, 1.0, 0.24], [-0.12, 1.2, 0.12], "l_wroot"], sag: 0.1, scallop: 0.3, bone: 0.02, bone_mat: "hide", thick: 0.015, mirror: true, material: "wing" },
  { kind: "horn", at: "l_wwrist", off: [0, 0.02, 0], dir: [0.3, 1, -0.2], len: 0.08, base: 0.018, curve: 40, bend: [1, 0, 0], mirror: true, material: "claw" },
  // cloven hooves, clawed hands
  { kind: "foot", at: "l_foot", form: "hoof", len: 0.15, width: 0.11, toes: 2, sole: 0.06, mirror: true, material: "hoof" },
  ...[-0.02, 0, 0.02].map((z): Part => ({ kind: "horn", at: "l_hand", off: [0.02, -0.01, z], dir: [0.5, -1, z * 3], len: 0.07, base: 0.012, curve: 70, bend: [-1, 0, 0], mirror: true, material: "claw" })),
  // the tail's arrowhead: two barbs swept back from a point
  { kind: "horn", at: "tail4", off: [-0.02, 0, 0], dir: [-1, 0.1, 0], len: 0.16, base: 0.06, flat: 0.25, material: "hide" },
  { kind: "horn", at: "tail4", off: [-0.06, 0, 0.01], dir: [0.7, 0, 1], len: 0.12, base: 0.045, flat: 0.25, curve: 20, bend: [1, 0, 0], mirror: true, material: "hide" },
];

write("jersey-devil", {
  feet: 2, wings: 2, budget: 8500, root: "chest", material: "hide", blend: 0.016,
  palette: {
    hide: [0.3, 0.2, 0.17, 0.75, 0],
    mane: [0.15, 0.1, 0.09, 0.9, 0],
    wing: [0.22, 0.12, 0.11, 0.7, 0],
    horn: [0.86, 0.8, 0.68, 0.4, 0],
    hoof: [0.12, 0.1, 0.09, 0.4, 0],
    claw: [0.14, 0.12, 0.1, 0.4, 0],
    fang: [0.95, 0.92, 0.84, 0.3, 0],
    dark: [0.05, 0.03, 0.03, 0.6, 0],
    eye: [1, 0.2, 0.08, 0.3, 0, 1.8],
    glint: [1, 1, 1, 0.1, 0],
  },
  nodes, links, blobs, parts,
  hide: { pattern: "skin", size: 0.09, colours: [[0.18, 0.11, 0.1]], map: 1024 },
}, process.argv[2]);
