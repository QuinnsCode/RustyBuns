// Yeti from the museum and show figures and a Sherpa's drawing of the migoi: a towering ape of the snows, hunched and
// broad, covered in long pale shaggy hair, a pointed crown, a blue-grey bare face with red eyes and a fanged snarl,
// arms hanging to the knees, huge feet.
import { type Blob, type Ell, type N, type Part, type V, add, along, chain, mul, onSkin, pair, write } from "./lib.ts";

const nodes: Record<string, N> = {
  hip: [-0.04, 1.0, 0, 0.21],
  belly: [0.04, 1.26, 0, 0.25],
  chest: [0.1, 1.5, 0, 0.27],
  neck: [0.16, 1.7, 0, 0.19],
  head: [0.3, 1.86, 0, 0.17],
  crest: [0.2, 2.22, 0, 0.06],
  mask: [0.47, 1.82, 0, 0.1],
  l_hipj: [0, 1.0, 0.17, 0.12],
  l_knee: [0.08, 0.58, 0.2, 0.1],
  l_ankle: [-0.03, 0.13, 0.2, 0.07],
  l_foot: [0.1, 0.05, 0.2, 0.05],
  l_shoulder: [0.08, 1.64, 0.44, 0.12],
  l_elbow: [0.06, 1.15, 0.55, 0.09],
  l_wrist: [0.16, 0.72, 0.53, 0.07],
  l_hand: [0.2, 0.6, 0.52, 0.06],
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
  { at: "chest", off: [-0.02, 0.06, 0], r: [0.31, 0.31, 0.46] },
  // the hump: the shoulders and trapezius rise to the back of the head, so there is no neck
  { at: "neck", off: [-0.1, 0.0, 0], r: [0.25, 0.22, 0.38] },
  ...pair("l_shoulder", [0, -0.02, 0.02], [0.18, 0.19, 0.17]),
  ...pair("l_shoulder", mul(along(nodes, "l_shoulder", "l_elbow"), 0.5), [0.13, 0.27, 0.13]),
  ...pair("l_elbow", mul(along(nodes, "l_elbow", "l_wrist"), 0.45), [0.12, 0.25, 0.12]),
  ...pair("l_hand", [0.01, -0.04, 0], [0.09, 0.12, 0.075]),
  ...pair("l_hipj", add(along(nodes, "l_hipj", "l_knee"), [-0.01, 0, 0]), [0.17, 0.28, 0.16]),
  ...pair("l_knee", [0, 0, 0], [0.1, 0.1, 0.1]),
  ...pair("l_knee", add(along(nodes, "l_knee", "l_ankle"), [-0.05, 0.03, 0]), [0.13, 0.24, 0.12]),
  ...pair("l_ankle", [0, 0, 0], [0.08, 0.08, 0.08]),
  // shag: clumps of long hair hanging off the shoulders, elbows, forearms, flanks and calves, blended into the skin
  ...pair("l_shoulder", [-0.06, -0.12, 0.1], [0.1, 0.2, 0.08], [10, 0, -8]),
  ...pair("l_elbow", [-0.1, -0.06, 0.03], [0.08, 0.17, 0.07], [0, 0, -15]),
  ...pair("l_elbow", [0.0, -0.22, 0.09], [0.07, 0.2, 0.06], [12, 0, 0]),
  ...pair("l_elbow", [-0.07, -0.32, 0.0], [0.065, 0.18, 0.06], [0, 0, -10]),
  ...pair("hip", [-0.05, 0.05, 0.27], [0.09, 0.22, 0.07], [8, 0, 0]),
  ...pair("l_knee", [-0.12, -0.1, 0.02], [0.07, 0.18, 0.06], [0, 0, -12]),
  ...pair("l_knee", [-0.02, -0.25, 0.08], [0.06, 0.15, 0.05], [10, 0, 0]),
  { at: "neck", off: [-0.25, -0.15, 0], r: [0.12, 0.25, 0.25], rot: [0, 0, -10] },
  ...head.map((e) => ({ at: "head", off: e.c, r: e.r }) as Blob),
];

const eyeDir: V = [1, 0.05, 0.42];
const eyeAt = on([0.05, 0.0, 0.055], eyeDir, 0.012);
const noseAt = on([0.1, -0.03, 0], [1, 0.1, 0], 0.01);
const parts: Part[] = [
  // deep-set eyes under the brow: a dark socket, the amber eye, a glint
  { kind: "eye", at: "head", off: on([0.05, 0.0, 0.055], eyeDir, 0.04), r: R(0.05), mirror: true, material: "dark" },
  { kind: "eye", at: "head", off: eyeAt, r: R(0.037), mirror: true, material: "eye" },
  { kind: "eye", at: "head", off: add(eyeAt, mul([0.022, 0.01, 0.004], K)), r: R(0.007), mirror: true, material: "glint" },
  // a broad flat nose: a pad and two flared nostrils
  { kind: "eye", at: "head", off: noseAt, r: R(0.04), material: "face" },
  { kind: "eye", at: "head", off: add(noseAt, mul([0.018, -0.02, 0.028], K)), r: R(0.016), mirror: true, material: "dark" },
  // the snarl: a dark open mouth, two fangs down from the upper lip, two up from the lower, small teeth between
  { kind: "eye", at: "head", off: on([0.1, -0.1, 0], [1, -0.2, 0], 0.03), r: R(0.055), material: "mouth" },
  { kind: "horn", at: "head", off: on([0.1, -0.075, 0.045], [1, -0.1, 0.5], 0.012), dir: [0.15, -1, 0], len: R(0.06), base: R(0.017), curve: 10, bend: [-1, 0, 0], mirror: true, material: "fang" },
  { kind: "horn", at: "head", off: on([0.1, -0.135, 0.04], [1, -0.4, 0.5], 0.012), dir: [0.15, 1, 0], len: R(0.045), base: R(0.015), curve: 10, bend: [-1, 0, 0], mirror: true, material: "fang" },
  { kind: "horn", at: "head", off: on([0.12, -0.075, 0.015], [1, -0.1, 0.15], 0.012), dir: [0.1, -1, 0], len: R(0.028), base: R(0.012), mirror: true, material: "fang" },
  // feet: long, flat and five-toed; hands: four heavy fingers and a thumb, bare leather
  { kind: "foot", at: "l_foot", form: "paw", len: 0.4, width: 0.17, toes: 5, claw: 0.018, sole: 0.05, mirror: true, material: "face" },
  ...[-0.035, -0.012, 0.012, 0.035].map((z): Part => ({ kind: "horn", at: "l_hand", off: [0.035, -0.09, z], dir: [0.3, -1, z * 1.5], len: 0.11, base: 0.022, tip_base: 0.014, curve: 50, bend: [-1, 0, 0], mirror: true, material: "face" })),
  { kind: "horn", at: "l_hand", off: [0.06, -0.02, -0.04], dir: [0.6, -0.8, -0.3], len: 0.08, base: 0.022, tip_base: 0.015, curve: 30, bend: [0, 0, 1], mirror: true, material: "face" },
];

write("yeti", {
  feet: 2, wings: 0, budget: 8500, root: "chest", material: "fur", blend: 0.03,
  palette: {
    fur: [0.86, 0.85, 0.82, 0.95, 0],
    mane: [0.93, 0.93, 0.91, 0.95, 0],
    face: [0.36, 0.42, 0.52, 0.75, 0],
    mouth: [0.3, 0.06, 0.08, 0.6, 0],
    fang: [0.95, 0.9, 0.72, 0.3, 0],
    dark: [0.04, 0.03, 0.03, 0.6, 0],
    eye: [1, 0.18, 0.12, 0.3, 0, 1.8],
    glint: [1, 1, 1, 0.1, 0],
    claw: [0.12, 0.1, 0.09, 0.5, 0],
  },
  nodes, links, blobs, parts,
  paint: [{ nodes: ["mask"], material: "face" }],
  hide: { pattern: "fur", size: 0.035, colours: [[0.72, 0.72, 0.72], [0.98, 0.98, 0.96]], map: 1024 },
}, process.argv[2]);
