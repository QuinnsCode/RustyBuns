// Chupacabra from the 1995 Puerto Rico sketch and its redrawings: a child-sized upright hopper, hunched on kangaroo legs,
// a big bald alien head with huge slanted black eyes, a tiny nose and mouth, thin arms held up with long claws, a row of
// long quills from the crown down the back, grey-green scaly skin with dark blotches.
import { type Blob, type Ell, type N, type Part, type V, add, bone, chain, mul, norm, onSkin, pair, skin, world, write } from "./lib.ts";

const nodes: Record<string, N> = {
  hip: [-0.02, 0.5, 0, 0.11],
  belly: [0.03, 0.64, 0, 0.11],
  chest: [0.08, 0.78, 0, 0.12],
  neck: [0.15, 0.9, 0, 0.06],
  head: [0.22, 1.0, 0, 0.09],
  crest: [0.18, 1.17, 0, 0.03],
  l_hipj: [-0.02, 0.48, 0.09, 0.07],
  l_knee: [0.13, 0.33, 0.11, 0.06],
  l_hock: [-0.08, 0.15, 0.11, 0.035],
  l_foot: [0.02, 0.035, 0.11, 0.03],
  l_shoulder: [0.1, 0.84, 0.13, 0.045],
  l_elbow: [0.06, 0.68, 0.17, 0.032],
  l_wrist: [0.2, 0.68, 0.14, 0.025],
  l_hand: [0.25, 0.67, 0.12, 0.02],
};
const links = [
  ...chain(["hip", "belly", "chest", "neck", "head", "crest"]),
  ...chain(["hip", "l_hipj", "l_knee", "l_hock", "l_foot"]),
  ...chain(["chest", "l_shoulder", "l_elbow", "l_wrist", "l_hand"]),
];

// the head, offsets from the head node: a big bald dome over a narrow face and a small chin
const cran: Ell = { c: [-0.01, 0.05, 0], r: [0.13, 0.12, 0.12] };
const face: Ell = { c: [0.06, -0.03, 0], r: [0.09, 0.08, 0.085] };
const chin: Ell = { c: [0.09, -0.09, 0], r: [0.05, 0.04, 0.05] };
const K = 1.3; // a big head, as on the cards
const head: Ell[] = [cran, face, chin].map((e) => ({ c: mul(e.c, K), r: mul(e.r, K) }));
const unit = onSkin(head);
const on = (p: V, d: V, sink = 0) => unit(mul(p, K), d, sink * K);

// the body: a pot belly, narrow shoulders, big haunches with a long shin and a backward hock, as a hopper's
const body: Blob[] = [
  { at: "hip", off: [-0.02, 0, 0], r: [0.12, 0.11, 0.12] },
  { at: "belly", off: [0.02, 0, 0], r: [0.13, 0.13, 0.13] },
  { at: "chest", off: [0, 0.02, 0], r: [0.12, 0.13, 0.14] },
  { at: "neck", off: [-0.01, 0, 0], r: [0.07, 0.08, 0.07], rot: [0, 0, -25] },
];
const blobs: Blob[] = [
  ...body,
  ...pair("l_hipj", [0.04, -0.04, 0], [0.14, 0.14, 0.1]),
  ...bone(nodes, "l_hipj", "l_knee", 0.1, 0.082, 0.2),
  ...pair("l_knee", [0, 0, 0], [0.055, 0.055, 0.05]),
  ...bone(nodes, "l_knee", "l_hock", 0.045, 0.04, 0.12),
  ...bone(nodes, "l_hock", "l_foot", 0.028, 0.028, 0.25),
  ...pair("l_hock", [-0.01, 0, 0], [0.03, 0.03, 0.028]),
  ...pair("l_shoulder", [0, 0, 0], [0.05, 0.05, 0.045]),
  ...bone(nodes, "l_shoulder", "l_elbow", 0.032, 0.03, 0.15),
  ...bone(nodes, "l_elbow", "l_wrist", 0.026, 0.024, 0.15),
  ...pair("l_elbow", [0, 0, 0], [0.03, 0.03, 0.028]),
  ...head.map((e) => ({ at: "head", off: e.c, r: e.r }) as Blob),
];

// eyes: each a big black almond (two overlapping spheres slanting up and back) with a glint
const parts: Part[] = [];
for (const [p, r] of [[[0.07, 0.0, 0.05], 0.06], [[0.052, 0.018, 0.062], 0.054]] as [V, number][]) {
  parts.push({ kind: "eye", at: "head", off: on(p, norm([0.85, 0.12, 0.6]), 0.016), r, mirror: true, material: "eye" });
}
parts.push({ kind: "eye", at: "head", off: on([0.085, 0.02, 0.05], norm([0.85, 0.2, 0.55]), -0.025), r: 0.012, mirror: true, material: "glint" });
// a tiny nose and slit nostrils, a small mouth with two fangs
const nose = on([0.1, -0.05, 0], [1, 0.1, 0], 0.006);
parts.push({ kind: "eye", at: "head", off: nose, r: 0.016, material: "hide" });
parts.push({ kind: "eye", at: "head", off: add(nose, [0.008, -0.008, 0.008]), r: 0.005, mirror: true, material: "dark" });
parts.push({ kind: "ridge", at: "head", off: on([0.12, -0.085, 0], [1, -0.2, 0], 0.006), dir: [0, 0, 1], len: 0.035, base: 0.008, curve: 30, bend: [-1, 0.3, 0], mirror: true, material: "dark" });
parts.push({ kind: "horn", at: "head", off: on([0.12, -0.09, 0.015], [1, -0.4, 0.2], 0.008), dir: [0.2, -1, 0], len: 0.018, base: 0.005, tip_base: 0.0008, curve: 10, bend: [-1, 0, 0], mirror: true, material: "fang" });
// brow ridges over the eyes, set into the dome
parts.push({ kind: "ridge", at: "head", off: on([0.05, 0.06, 0.05], norm([0.7, 0.6, 0.5]), 0.01), dir: [0.2, -0.2, -1], len: 0.06, base: 0.014, curve: 30, bend: [0, 1, 0], mirror: true, material: "hide" });

// quills: a row from the crown, over the back of the head and down the spine, longest at the crown and the shoulders
const W = world(nodes, body), H = head.map((e) => ({ c: add([nodes.head![0], nodes.head![1], 0], e.c), r: e.r }));
const quills: [V, V, number][] = [
  // [point inside, cast direction (back and up), length]
  [[0.25, 1.02, 0], [0.1, 1, 0], 0.2],
  [[0.22, 1.02, 0], [-0.3, 1, 0], 0.2],
  [[0.19, 1.02, 0], [-0.7, 1, 0], 0.15],
  [[0.17, 1.0, 0], [-1, 0.6, 0], 0.11],
  [[0.13, 0.88, 0], [-1, 0.35, 0], 0.1],
  [[0.08, 0.82, 0], [-1, 0.25, 0], 0.15],
  [[0.06, 0.76, 0], [-1, 0.15, 0], 0.16],
  [[0.03, 0.7, 0], [-1, 0.05, 0], 0.13],
  [[0.0, 0.63, 0], [-1, -0.05, 0], 0.1],
  [[-0.03, 0.56, 0], [-1, -0.15, 0], 0.07],
];
for (const [i, [p, d, len]] of quills.entries()) {
  const at = skin(i < 4 ? H : W, p, norm(d)), n = norm(d);
  const rel = add(at, mul([-nodes.chest![0], -nodes.chest![1], 0], 1));
  parts.push({ kind: "horn", at: "chest", off: add(rel, mul(n, -0.01)), dir: add(n, [0.1, 0.35, 0]), len, base: 0.016, tip_base: 0.002, curve: 18, bend: [-1, 0, 0], material: "quill" });
}
// hands: three long hooked claws; feet: three-toed talons
parts.push(
  ...[-0.015, 0, 0.015].map((z): Part => ({ kind: "horn", at: "l_hand", off: [0.01, -0.01, z], dir: [1, -0.6, z * 4], len: 0.07, base: 0.008, tip_base: 0.003, curve: 60, bend: [0, -1, 0], mirror: true, material: "claw" })),
  { kind: "foot", at: "l_foot", form: "talon", len: 0.17, width: 0.08, toes: 3, spread: 30, claw: 0.035, sole: 0.03, mirror: true, material: "hide", claw_mat: "claw" },
);

write("chupacabra", {
  feet: 2, wings: 0, budget: 7000, root: "chest", material: "hide", blend: 0.022,
  belly: "belly", belly_turn: -0.35,
  palette: {
    hide: [0.36, 0.46, 0.3, 0.8, 0],
    belly: [0.7, 0.74, 0.58, 0.8, 0],
    quill: [0.86, 0.84, 0.74, 0.45, 0],
    eye: [0.02, 0.02, 0.03, 0.15, 0],
    glint: [1, 1, 1, 0.1, 0],
    dark: [0.06, 0.07, 0.05, 0.6, 0],
    fang: [0.95, 0.93, 0.85, 0.3, 0],
    claw: [0.2, 0.18, 0.15, 0.4, 0],
  },
  nodes, links, blobs, parts,
  hide: { pattern: "scales", size: 0.014, colours: [[0.2, 0.27, 0.16], [0.42, 0.52, 0.34]], map: 1024, spots: { size: 0.09, colour: [0.06, 0.09, 0.05], cover: 0.35 } },
}, process.argv[2]);
