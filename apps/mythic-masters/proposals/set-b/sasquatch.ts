// Sasquatch from the 1967 film frame and the carved trail statues: a huge dark ape-man with no neck (the head sunk
// into a shoulder hump), a peaked cone crown, a bare dark face under a heavy brow, arms hanging past the hips,
// a pot belly, bent knees and big flat feet.
import { type Blob, type Ell, type N, type Part, type V, add, along, chain, mul, onSkin, pair, write } from "./lib.ts";

const nodes: Record<string, N> = {
  hip: [0, 1.04, 0, 0.2],
  belly: [0.03, 1.3, 0, 0.24],
  chest: [0.03, 1.56, 0, 0.26],
  neck: [0.07, 1.78, 0, 0.18],
  head: [0.15, 2.0, 0, 0.17],
  crest: [0.03, 2.38, 0, 0.06],
  mask: [0.32, 1.96, 0, 0.09],
  l_hipj: [0, 1.0, 0.17, 0.12],
  l_knee: [0.08, 0.58, 0.2, 0.1],
  l_ankle: [-0.03, 0.13, 0.2, 0.07],
  l_foot: [0.1, 0.05, 0.2, 0.05],
  l_shoulder: [0.0, 1.7, 0.4, 0.11],
  l_elbow: [-0.05, 1.25, 0.5, 0.08],
  l_wrist: [0.04, 0.84, 0.5, 0.06],
  l_hand: [0.08, 0.72, 0.49, 0.05],
};
const links = [
  ...chain(["hip", "belly", "chest", "neck", "head", "crest"]), ["head", "mask"],
  ...chain(["hip", "l_hipj", "l_knee", "l_ankle", "l_foot"]),
  ...chain(["chest", "l_shoulder", "l_elbow", "l_wrist", "l_hand"]),
];

// the head, as offsets from the head node
const cran: Ell = { c: [-0.01, 0.03, 0], r: [0.15, 0.15, 0.14] };
const cone: Ell = { c: [-0.06, 0.17, 0], r: [0.1, 0.16, 0.075] };
const brow: Ell = { c: [0.12, 0.055, 0], r: [0.06, 0.045, 0.13] };
const muz: Ell = { c: [0.11, -0.06, 0], r: [0.085, 0.075, 0.105] };
const chin: Ell = { c: [0.07, -0.13, 0], r: [0.08, 0.055, 0.1] };
const jowl: Ell = { c: [0.0, -0.06, 0.1], r: [0.1, 0.1, 0.07] };
const K = 1.35; // a big head, as the owner picked on the starters
const head: Ell[] = [cran, cone, brow, muz, chin, jowl, { c: [0, -0.06, -0.1], r: jowl.r }].map((e) => ({ c: mul(e.c, K), r: mul(e.r, K) }));
const unit = onSkin(head);
const on = (p: V, d: V, sink = 0) => unit(mul(p, K), d, sink * K);
const R = (x: number) => +(x * K).toFixed(4);

const blobs: Blob[] = [
  { at: "hip", off: [-0.02, 0, 0], r: [0.24, 0.22, 0.3] },
  { at: "belly", off: [0.02, -0.02, 0], r: [0.27, 0.29, 0.32] },
  { at: "chest", off: [-0.01, 0.06, 0], r: [0.29, 0.3, 0.42] },
  // the hump: the shoulders and trapezius rise to the back of the head, so there is no neck
  { at: "neck", off: [-0.08, -0.02, 0], r: [0.22, 0.2, 0.34] },
  ...pair("l_shoulder", [0, -0.02, 0.02], [0.16, 0.17, 0.15]),
  ...pair("l_shoulder", mul(along(nodes, "l_shoulder", "l_elbow"), 0.5), [0.11, 0.25, 0.11]),
  ...pair("l_elbow", mul(along(nodes, "l_elbow", "l_wrist"), 0.45), [0.1, 0.24, 0.1]),
  ...pair("l_hand", [0.01, -0.04, 0], [0.075, 0.11, 0.06]),
  ...pair("l_hipj", add(along(nodes, "l_hipj", "l_knee"), [-0.01, 0, 0]), [0.17, 0.28, 0.16]),
  ...pair("l_knee", [0, 0, 0], [0.1, 0.1, 0.1]),
  ...pair("l_knee", add(along(nodes, "l_knee", "l_ankle"), [-0.05, 0.03, 0]), [0.13, 0.24, 0.12]),
  ...pair("l_ankle", [0, 0, 0], [0.08, 0.08, 0.08]),
  ...head.map((e) => ({ at: "head", off: e.c, r: e.r }) as Blob),
];

const eyeDir: V = [1, 0.05, 0.42];
const eyeAt = on([0.05, 0.0, 0.055], eyeDir, 0.018);
const noseAt = on([0.1, -0.03, 0], [1, 0.1, 0], 0.01);
const parts: Part[] = [
  // deep-set eyes under the brow: a dark socket, the amber eye, a glint
  { kind: "eye", at: "head", off: on([0.05, 0.0, 0.055], eyeDir, 0.04), r: R(0.042), mirror: true, material: "dark" },
  { kind: "eye", at: "head", off: eyeAt, r: R(0.03), mirror: true, material: "eye" },
  { kind: "eye", at: "head", off: add(eyeAt, mul([0.022, 0.01, 0.004], K)), r: R(0.007), mirror: true, material: "glint" },
  // a broad flat nose: a pad and two flared nostrils
  { kind: "eye", at: "head", off: noseAt, r: R(0.04), material: "face" },
  { kind: "eye", at: "head", off: add(noseAt, mul([0.018, -0.02, 0.028], K)), r: R(0.016), mirror: true, material: "dark" },
  // a wide thin mouth
  { kind: "ridge", at: "head", off: on([0.12, -0.1, 0], [1, -0.1, 0], 0.012), dir: [0, 0, 1], len: R(0.1), base: R(0.016), curve: 30, bend: [-1, 0.3, 0], mirror: true, material: "dark" },
  // hair: a ruff framing the face, shaggy fringes hanging off the forearms and the backs of the calves, a back mane
  { kind: "tuft", along: ["head", "neck"], n: 5, len: 0.16, base: 0.09, rows: 9, spread: 90, sweep: 2, curve: 25, flat: 0.2, sink: 0.95, material: "mane" },
  { kind: "tuft", along: ["neck", "chest", "belly", "hip"], n: 9, len: 0.2, base: 0.1, rows: 5, spread: 80, sweep: 2.6, curve: 20, flat: 0.2, sink: 0.95, material: "mane" },
  { kind: "tuft", along: ["l_elbow", "l_wrist"], n: 5, len: 0.15, base: 0.08, rows: 5, spread: 120, sweep: 2.6, curve: 20, flat: 0.2, sink: 0.95, mirror: true, material: "mane" },
  { kind: "tuft", along: ["l_shoulder", "l_elbow"], n: 5, len: 0.15, base: 0.08, rows: 5, spread: 120, sweep: 2.6, curve: 20, flat: 0.2, sink: 0.95, mirror: true, material: "mane" },
  // feet: long, flat and five-toed; hands: four heavy fingers and a thumb, bare leather
  { kind: "foot", at: "l_foot", form: "paw", len: 0.4, width: 0.17, toes: 5, claw: 0.018, sole: 0.05, mirror: true, material: "face" },
  ...[-0.035, -0.012, 0.012, 0.035].map((z): Part => ({ kind: "horn", at: "l_hand", off: [0.035, -0.09, z], dir: [0.3, -1, z * 1.5], len: 0.11, base: 0.022, tip_base: 0.014, curve: 50, bend: [-1, 0, 0], mirror: true, material: "face" })),
  { kind: "horn", at: "l_hand", off: [0.06, -0.02, -0.04], dir: [0.6, -0.8, -0.3], len: 0.08, base: 0.022, tip_base: 0.015, curve: 30, bend: [0, 0, 1], mirror: true, material: "face" },
];

write("sasquatch", {
  feet: 2, wings: 0, budget: 8000, root: "chest", material: "fur", blend: 0.03,
  palette: {
    fur: [0.24, 0.15, 0.1, 0.95, 0],
    mane: [0.21, 0.13, 0.08, 0.95, 0],
    face: [0.5, 0.37, 0.29, 0.8, 0],
    dark: [0.04, 0.03, 0.03, 0.6, 0],
    eye: [0.95, 0.62, 0.22, 0.3, 0, 1.4],
    glint: [1, 1, 1, 0.1, 0],
    claw: [0.12, 0.1, 0.09, 0.5, 0],
  },
  nodes, links, blobs, parts,
  paint: [{ nodes: ["mask"], material: "face" }],
  hide: { pattern: "fur", size: 0.035, colours: [[0.15, 0.09, 0.06], [0.33, 0.22, 0.15]], map: 1024 },
}, process.argv[2]);
