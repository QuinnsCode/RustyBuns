// Three Hodag directions, each from a reference (README.md here): `bun proposals/hodag/make-hodag.ts`
// writes proposals/hodag/hodag-{statue,hoax,starter}.json. Build one with
// `blender -b --factory-startup --python-exit-code 1 -t 8 -P blender/beast.py -- proposals/hodag/hodag-statue.json --render`.
// The picked one replaces beasts/hodag.json (id back to "hodag"); the others and this script are deleted.
import { join } from "node:path";

type V = [number, number, number];
type N = [number, number, number, number];
type Part = Record<string, unknown>;

const PALETTE = {
  hide: [0.15, 0.26, 0.24, 0.9, 0],
  fur: [0.11, 0.19, 0.18, 0.95, 0],
  belly: [0.28, 0.36, 0.3, 0.85, 0],
  spike: [0.95, 0.92, 0.82, 0.35, 0],
  claw: [0.96, 0.93, 0.84, 0.3, 0],
  fang: [0.98, 0.96, 0.9, 0.25, 0],
  eye: [1, 0.42, 0.06, 0.3, 0, 2.2],
  pupil: [0.03, 0.02, 0.02, 0.4, 0],
  mouth: [0.3, 0.04, 0.06, 0.6, 0],
  dark: [0.04, 0.05, 0.05, 0.7, 0],
};

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** The Hodag's face around a head node at `h`, `k` times the statue's size, built from round flesh (the
 *  statue's head is a ball, not a box): a wide cranium, a bulldog muzzle under it, a dark grin wrapping round
 *  the front of the muzzle with square teeth hanging into it and two big fangs over the lower lip, glaring
 *  orange eyes under an angry brow, and white bull horns curling up off the sides of the crown. */
function face(h: V, k: number, o: { horn?: number; eye?: number; fang?: number } = {}) {
  const at = (off: V): V => [+(off[0] * k).toFixed(4), +(off[1] * k).toFixed(4), +(off[2] * k).toFixed(4)];
  const r = (x: number) => +(x * k).toFixed(4);
  const cran: V = [0.27, 0.25, 0.33], muz: V = [0.17, 0.15, 0.29], mc: V = [0.17, -0.06, 0];
  // where the muzzle's skin is, straight ahead of its centre at height y and side z (statue scale)
  const front = (y: number, z: number) => mc[0] + muz[0] * Math.sqrt(Math.max(0, 1 - ((y - mc[1]) / muz[1]) ** 2 - (z / muz[2]) ** 2));
  const nodes: Record<string, N> = {
    head: [...h, r(0.2)] as N,
    snout: [...add(h, at([0.17, -0.06, 0])), r(0.12)] as N,
    jaw: [...add(h, at([0.1, -0.13, 0])), r(0.11)] as N,
  };
  const blobs = [
    { at: "head", off: at([0, 0.03, 0]), r: at(cran) },
    { at: "head", off: at(mc), r: at(muz) },
  ];
  const lipY = -0.085;
  const teeth: Part[] = [0.03, 0.085, 0.14].map((z) => (
    { kind: "horn", at: "head", off: at([front(lipY + 0.02, z) - 0.005, lipY + 0.02, z]), dir: [0.25, -1, 0], len: r(0.05), base: r(0.024), mirror: true, material: "fang" }));
  const parts: Part[] = [
    // the grin: a dark lip band from the middle of the muzzle round to each cheek
    { kind: "ridge", at: "head", off: at([front(lipY, 0) + 0.012, lipY, 0]), dir: [-0.15, 0, 1], len: r(0.3), base: r(0.046), curve: 75, bend: [-1, 0, 0], mirror: true, material: "mouth" },
    ...teeth,
    { kind: "horn", at: "head", off: at([front(lipY + 0.03, 0.19) - 0.01, lipY + 0.03, 0.19]), dir: [0.2, -1, 0.05], len: r(0.19 * (o.fang ?? 1)), base: r(0.042), curve: 18, bend: [1, 0, 0], mirror: true, material: "fang" },
    { kind: "eye", at: "head", off: at([0.19, 0.13, 0.15]), r: r(0.08 * (o.eye ?? 1)), mirror: true, material: "eye" },
    { kind: "eye", at: "head", off: at([0.19 + 0.07 * (o.eye ?? 1), 0.13, 0.15]), r: r(0.036 * (o.eye ?? 1)), mirror: true, material: "pupil" },
    { kind: "ridge", at: "head", off: at([0.17, 0.215, 0.24]), dir: [0.25, -0.3, -1], len: r(0.2), base: r(0.05), curve: 10, mirror: true, material: "fur" },
    { kind: "eye", at: "head", off: at([front(0.02, 0.05) - 0.005, 0.02, 0.05]), r: r(0.026), mirror: true, material: "dark" },
    { kind: "horn", at: "head", off: at([-0.03, 0.17, 0.22]), dir: [-0.1, 0.05, 1], len: r(0.55 * (o.horn ?? 1)), base: r(0.085), curve: 105, bend: [0.15, 1, 0], mirror: true, material: "spike" },
    { kind: "ear", at: "head", off: at([-0.17, 0.08, 0.25]), dir: [-0.6, 0.1, 1], len: r(0.13), width: r(0.07), tilt: 15, cup: 25, mirror: true, material: "hide" },
  ];
  return { nodes, parts, blobs };
}

/** Curved white spines down the back from `from` to `to` along the spine nodes, `n` of them, their length
 *  swelling to `peak` at `top` of the way along, swept back like the statue's (not straight cones). */
function spines(nodes: Record<string, N>, chain: string[], n: number, peak: number, base: number, top = 0.55): Part[] {
  const pts = chain.map((c) => nodes[c]!);
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const s = f * (pts.length - 1);
    const a = pts[Math.floor(s)]!, b = pts[Math.min(pts.length - 1, Math.floor(s) + 1)]!, u = s - Math.floor(s);
    const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u, rr = a[3] + (b[3] - a[3]) * u;
    const size = 0.45 + 0.55 * Math.exp(-(((f - top) / 0.45) ** 2));
    out.push({ kind: "horn", at: chain[0], off: [+(x - pts[0]![0]).toFixed(4), +(y + rr * 0.8 - pts[0]![1]).toFixed(4), 0], dir: [-0.35, 1, 0], len: +(peak * size).toFixed(4), base: +(base * size).toFixed(4), curve: 45, bend: [-1, 0, 0], material: "spike" });
  }
  return out;
}

/** Three big white hooked claws off the front of a paw. */
const claws = (at: string, fwd: number, len: number, base: number): Part[] =>
  [-1, 0, 1].map((z) => ({ kind: "horn", at, off: [fwd, -0.02, z * 0.07], dir: [1, -0.25, z * 0.3], len, base, curve: 60, bend: [0, -1, 0], mirror: true, material: "claw" }));

const legs = (front: [N, N, N], back: [N, N, N]): Record<string, N> => ({
  l_shoulder: front[0], l_elbow: front[1], l_ffoot: front[2],
  l_hipj: back[0], l_bknee: back[1], l_bfoot: back[2],
});
const SPINE = ["tail_tip", "tail2", "tail1", "hip", "belly", "chest", "neck", "head", "snout"];
const LINKS = [...SPINE.slice(1).map((n, i) => [SPINE[i]!, n]), ["head", "jaw"],
  ["chest", "l_shoulder"], ["l_shoulder", "l_elbow"], ["l_elbow", "l_ffoot"], ["hip", "l_hipj"], ["l_hipj", "l_bknee"], ["l_bknee", "l_bfoot"]];

function sheet(id: string, about: string, body: Record<string, N>, f: ReturnType<typeof face>, parts: Part[], colours: Record<string, number[]> = {}) {
  const nodes = { ...body, ...f.nodes };
  return {
    id, name: "Hodag", about, archetype: "tank", feet: 4, budget: 7000, root: "belly", material: "hide",
    palette: { ...PALETTE, ...colours }, nodes, links: LINKS, blobs: f.blobs, parts: [...f.parts, ...parts],
    belly: "belly", belly_turn: -0.3, blend: 0.025,
  };
}

const limbs = (front: number[], back: number[], depth = 1.15): Part[] => [
  { kind: "limb", along: ["l_shoulder", "l_elbow", "l_ffoot"], radii: front, depth, calf: 0.18, mirror: true, material: "hide" },
  { kind: "limb", along: ["l_hipj", "l_bknee", "l_bfoot"], radii: back, depth, calf: 0.14, mirror: true, material: "hide" },
];
const paws = (len: number, sole: number, claw: [number, number]): Part[] => [
  { kind: "foot", at: "l_ffoot", form: "paw", len, width: len, toes: 3, claw: 0, sole, mirror: true, material: "hide" },
  { kind: "foot", at: "l_bfoot", form: "paw", len: len * 0.92, width: len * 0.92, toes: 3, claw: 0, sole, mirror: true, material: "hide" },
  ...claws("l_ffoot", len * 0.75, claw[0], claw[1]), ...claws("l_bfoot", len * 0.7, claw[0] * 0.85, claw[1] * 0.9),
];
const fur = (chain: string[], n: number, len: number): Part => ({ kind: "tuft", along: chain, n, len, base: len * 0.45, rows: 5, spread: 170, sweep: 1.4, curve: 35, material: "fur" });

// A: the Rhinelander statue. The grin, fangs, bull horns and glare on a low, heavy, shaggy crawler with tall
// curved spines swelling over the hips and fist-sized claws.
const sBody: Record<string, N> = {
  tail_tip: [-1.55, 0.22, 0, 0.05], tail2: [-1.2, 0.32, 0, 0.12], tail1: [-0.85, 0.42, 0, 0.2],
  hip: [-0.45, 0.5, 0, 0.3], belly: [-0.02, 0.52, 0, 0.36], chest: [0.4, 0.56, 0, 0.37], neck: [0.66, 0.6, 0, 0.3],
  ...legs([[0.44, 0.48, 0.34, 0.14], [0.56, 0.26, 0.52, 0.12], [0.7, 0.09, 0.56, 0.09]],
          [[-0.45, 0.42, 0.3, 0.15], [-0.32, 0.24, 0.48, 0.12], [-0.22, 0.08, 0.52, 0.09]]),
};
const statue = sheet("hodag-statue", "The Rhinelander statue: grin, fangs, bull horns, shaggy dark fur, curved white spines, big claws.",
  sBody, face([0.92, 0.66, 0], 1.45), [
    ...limbs([0.2, 0.15, 0.1], [0.2, 0.13, 0.1]), ...paws(0.26, 0.09, [0.2, 0.045]),
    ...spines(sBody, ["neck", "chest", "belly", "hip", "tail1", "tail2"], 9, 0.48, 0.11, 0.5),
    fur(["neck", "chest", "belly", "hip", "tail1"], 12, 0.22),
    { kind: "tuft", along: ["l_shoulder", "l_elbow"], n: 3, len: 0.14, base: 0.07, rows: 3, spread: 120, mirror: true, material: "fur" },
  ]);

// B: the 1893 photograph. Shepard's hoax was carved wood under ox hide with bull horns: a heavy ox-dog up on
// its legs, the head carried level, a bristling back ridge and a spear-tipped tail; the face is the same
// beast's, smaller and grimmer.
const hBody: Record<string, N> = {
  tail_tip: [-1.35, 0.55, 0, 0.04], tail2: [-1.1, 0.66, 0, 0.08], tail1: [-0.82, 0.74, 0, 0.13],
  hip: [-0.5, 0.8, 0, 0.27], belly: [-0.1, 0.8, 0, 0.32], chest: [0.32, 0.84, 0, 0.36], neck: [0.6, 0.86, 0, 0.28],
  ...legs([[0.36, 0.68, 0.22, 0.15], [0.42, 0.36, 0.26, 0.11], [0.44, 0.08, 0.27, 0.08]],
          [[-0.5, 0.66, 0.2, 0.17], [-0.38, 0.38, 0.24, 0.11], [-0.48, 0.08, 0.25, 0.08]]),
};
const hoax = sheet("hodag-hoax", "The 1893 photograph: an ox-hide brute up on its legs, bull horns, a bristling ridge, a spear tail.",
  hBody, face([0.84, 0.84, 0], 0.85, { horn: 1.15, fang: 0.8, eye: 0.85 }), [
    ...limbs([0.19, 0.12, 0.08], [0.22, 0.12, 0.08], 1.25), ...paws(0.2, 0.08, [0.13, 0.035]),
    ...spines(hBody, ["neck", "chest", "belly", "hip", "tail1"], 11, 0.3, 0.07, 0.35),
    { kind: "horn", at: "tail_tip", dir: [-1, -0.1, 0], len: 0.26, base: 0.06, material: "spike" },
    { kind: "horn", at: "tail_tip", dir: [-0.6, 0.2, 1], len: 0.14, base: 0.04, mirror: true, material: "spike" },
    fur(["neck", "chest", "belly", "hip"], 10, 0.16),
  ], { hide: [0.24, 0.17, 0.12, 0.9, 0], fur: [0.16, 0.11, 0.08, 0.95, 0], belly: [0.36, 0.28, 0.2, 0.85, 0], eye: [1, 0.2, 0.05, 0.3, 0, 2.2] });

// C: a starter. Big-head-small-body, so it reads at fight size and in a party of three: the head near half the
// beast, a round body, stubby legs with oversized claws, three big spines and the statue's face.
const cBody: Record<string, N> = {
  tail_tip: [-0.95, 0.2, 0, 0.05], tail2: [-0.75, 0.24, 0, 0.1], tail1: [-0.55, 0.3, 0, 0.16],
  hip: [-0.3, 0.44, 0, 0.24], belly: [0, 0.47, 0, 0.29], chest: [0.26, 0.5, 0, 0.28], neck: [0.42, 0.56, 0, 0.28],
  ...legs([[0.3, 0.36, 0.26, 0.12], [0.36, 0.2, 0.36, 0.11], [0.42, 0.08, 0.38, 0.09]],
          [[-0.32, 0.36, 0.25, 0.12], [-0.33, 0.2, 0.4, 0.1], [-0.36, 0.07, 0.44, 0.09]]),
};
const starter = sheet("hodag-starter", "A starter: the statue's grin, fangs and horns on a big head, a round body, stubby clawed legs, three big spines.",
  cBody, face([0.6, 0.7, 0], 1.25, { eye: 1.2, horn: 0.8 }), [
    ...limbs([0.15, 0.12, 0.1], [0.16, 0.12, 0.1], 1.1), ...paws(0.22, 0.09, [0.17, 0.045]),
    ...spines(cBody, ["chest", "belly", "hip"], 3, 0.38, 0.12, 0.5),
    ...spines(cBody, ["tail1", "tail2"], 2, 0.16, 0.06, 0),
    fur(["neck", "chest", "belly", "hip"], 8, 0.16),
  ], { hide: [0.18, 0.36, 0.28, 0.9, 0], fur: [0.13, 0.28, 0.22, 0.95, 0], belly: [0.5, 0.56, 0.4, 0.85, 0] });

for (const s of [statue, hoax, starter]) await Bun.write(join(import.meta.dir, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
console.log("wrote hodag-statue, hodag-hoax, hodag-starter");
