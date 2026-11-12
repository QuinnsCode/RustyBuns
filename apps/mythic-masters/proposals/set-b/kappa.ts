// Kappa from the 1836 water-imp plate, the Wakan Sansai Zue print and the temple statues: a child-sized river imp in a
// crouch, frog-green spotted skin, a turtle's shell on its back and a pale plastron in front, a beak, round yellow eyes,
// and the dish of water on its crown ringed by a fringe of hair. Long thin limbs, webbed hands and feet.
import { type Blob, type Ell, type N, type Part, type V, add, along, chain, mul, norm, onSkin, pair, write } from "./lib.ts";

const nodes: Record<string, N> = {
  hip: [0, 0.4, 0, 0.09],
  belly: [0.03, 0.53, 0, 0.11],
  chest: [0.06, 0.66, 0, 0.11],
  neck: [0.1, 0.76, 0, 0.065],
  head: [0.15, 0.87, 0, 0.09],
  crown: [0.13, 1.0, 0, 0.03],
  shell: [-0.1, 0.58, 0, 0.05],
  shell_top: [-0.1, 0.76, 0, 0.03],
  shell_low: [-0.09, 0.42, 0, 0.03],
  l_shell: [-0.07, 0.6, 0.15, 0.03],
  l_shell_top: [-0.07, 0.74, 0.12, 0.03],
  plastron: [0.13, 0.55, 0, 0.05],
  l_hipj: [0, 0.38, 0.09, 0.06],
  l_knee: [0.13, 0.25, 0.16, 0.045],
  l_ankle: [0.01, 0.07, 0.16, 0.035],
  l_foot: [0.07, 0.025, 0.17, 0.025],
  l_shoulder: [0.06, 0.7, 0.14, 0.045],
  l_elbow: [0.03, 0.52, 0.22, 0.035],
  l_wrist: [0.14, 0.42, 0.23, 0.028],
  l_hand: [0.17, 0.39, 0.23, 0.025],
};
const links = [
  ...chain(["hip", "belly", "chest", "neck", "head", "crown"]), ["belly", "shell"], ["shell", "shell_top"], ["shell", "shell_low"], ["shell", "l_shell"], ["shell", "l_shell_top"], ["belly", "plastron"],
  ...chain(["hip", "l_hipj", "l_knee", "l_ankle", "l_foot"]),
  ...chain(["chest", "l_shoulder", "l_elbow", "l_wrist", "l_hand"]),
];

// the head: a round cranium, a short face pushed forward into the beak, cheeks
const head: Ell[] = [
  { c: [0, 0.025, 0], r: [0.115, 0.105, 0.11] },
  { c: [0.07, -0.025, 0], r: [0.075, 0.065, 0.08] },
];
const on = onSkin(head);

const blobs: Blob[] = [
  { at: "belly", off: [0, -0.02, 0], r: [0.13, 0.17, 0.14] },
  { at: "chest", off: [0, 0, 0], r: [0.11, 0.12, 0.14] },
  // the carapace: a broad low dome on the back, and the plastron a flatter plate in front
  { at: "shell", off: [-0.02, 0.02, 0], r: [0.1, 0.25, 0.22], rot: [0, 0, -12] },
  { at: "plastron", off: [0, 0, 0], r: [0.05, 0.17, 0.11], rot: [0, 0, -10] },
  { at: "neck", off: [0, 0, 0], r: [0.06, 0.07, 0.065] },
  ...pair("l_shoulder", [0, -0.01, 0], [0.05, 0.05, 0.05]),
  ...pair("l_shoulder", along(nodes, "l_shoulder", "l_elbow"), [0.035, 0.1, 0.035]),
  ...pair("l_elbow", along(nodes, "l_elbow", "l_wrist"), [0.03, 0.08, 0.03]),
  ...pair("l_hipj", along(nodes, "l_hipj", "l_knee"), [0.055, 0.1, 0.05]),
  ...pair("l_knee", along(nodes, "l_knee", "l_ankle", 0.45), [0.04, 0.11, 0.04]),
  ...pair("l_foot", [0.02, 0, 0], [0.06, 0.025, 0.045]),
  ...pair("l_hand", [0.015, -0.01, 0], [0.035, 0.03, 0.03]),
  ...head.map((e) => ({ at: "head", off: e.c, r: e.r }) as Blob),
];

const eyeDir = norm([0.7, 0.25, 0.7]);
const eyeAt = on([0.04, 0.0, 0.04], eyeDir, 0.018);
const beakAt = on([0.1, -0.02, 0], [1, 0, 0], 0.02);
const top = on([0, 0.03, 0], [0, 1, 0], 0.008);
// the fringe: a ring of hair hanging round the dish
const fringe: Part[] = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2, d: V = [Math.cos(a), 0, Math.sin(a)];
  const at = on([d[0] * 0.05, 0.06, d[2] * 0.05], norm([d[0], 1.6, d[2]]), 0.006);
  return { kind: "horn", at: "head", off: at, dir: norm([d[0], -0.15, d[2]]), len: 0.055, base: 0.026, tip_base: 0.006, flat: 0.35, curve: 35, bend: [0, -1, 0], material: "hair" };
});
const parts: Part[] = [
  // round yellow eyes, a black pupil, a glint
  { kind: "eye", at: "head", off: eyeAt, r: 0.034, mirror: true, material: "eye" },
  { kind: "eye", at: "head", off: add(eyeAt, mul(eyeDir, 0.022)), r: 0.016, mirror: true, material: "pupil" },
  { kind: "eye", at: "head", off: add(eyeAt, add(mul(eyeDir, 0.032), [0.004, 0.008, 0])), r: 0.005, mirror: true, material: "glint" },
  // the beak: a hooked upper bill over a shorter lower one
  { kind: "horn", at: "head", off: add(beakAt, [0, 0.012, 0]), dir: [1, -0.15, 0], len: 0.1, base: 0.038, curve: 45, bend: [0, -1, 0], flat: 0.7, material: "beak" },
  { kind: "horn", at: "head", off: add(beakAt, [-0.01, -0.025, 0]), dir: [1, -0.35, 0], len: 0.06, base: 0.03, curve: 10, bend: [0, 1, 0], flat: 0.6, material: "beak" },
  // the dish on the crown: a pale rim, the water in it
  { kind: "horn", at: "head", off: top, dir: [0, 1, 0], len: 0.02, base: 0.075, tip_base: 0.08, material: "dish" },
  { kind: "horn", at: "head", off: add(top, [0, 0.006, 0]), dir: [0, 1, 0], len: 0.016, base: 0.06, tip_base: 0.062, material: "water" },
  ...fringe,
  // webbed feet and hands
  { kind: "foot", at: "l_foot", form: "web", len: 0.13, width: 0.11, toes: 4, sole: 0.025, mirror: true, material: "web" },
  { kind: "foot", at: "l_hand", form: "web", len: 0.08, width: 0.07, toes: 4, sole: 0.0, mirror: true, material: "web" },
];

write("kappa", {
  feet: 2, wings: 0, budget: 7000, root: "chest", material: "skin", blend: 0.012,
  palette: {
    skin: [0.33, 0.52, 0.3, 0.6, 0],
    shell: [0.36, 0.3, 0.16, 0.6, 0],
    plastron: [0.78, 0.71, 0.42, 0.7, 0],
    beak: [0.86, 0.64, 0.24, 0.4, 0],
    dish: [0.82, 0.86, 0.84, 0.3, 0],
    water: [0.45, 0.7, 0.85, 0.05, 0],
    hair: [0.08, 0.1, 0.07, 0.9, 0],
    eye: [0.98, 0.86, 0.22, 0.3, 0],
    pupil: [0.03, 0.03, 0.02, 0.2, 0],
    glint: [1, 1, 1, 0.1, 0],
    web: [0.4, 0.6, 0.34, 0.6, 0],
    claw: [0.85, 0.8, 0.65, 0.4, 0],
  },
  nodes, links, blobs, parts,
  paint: [{ nodes: ["shell", "shell_top", "shell_low", "l_shell", "l_shell_top"], material: "shell" }, { nodes: ["plastron"], material: "plastron" }],
  hide: { pattern: "spots", spots: { size: 0.045, colour: [0.17, 0.3, 0.15], cover: 0.35 }, map: 1024 },
}, process.argv[2]);
