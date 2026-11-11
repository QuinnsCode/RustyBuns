// Three Tatzelwurm directions, each from a reference (README.md here): `bun proposals/tatzelwurm/make-tatzelwurm.ts`
// writes proposals/tatzelwurm/tatzelwurm-{plate,alpine,starter}.json. Build one with
// `blender -b --factory-startup --python-exit-code 1 -t 8 -P blender/beast.py -- proposals/tatzelwurm/tatzelwurm-plate.json --render`.
// The picked one replaces beasts/tatzelwurm.json (id back to "tatzelwurm"); the others and this script are deleted.
import { join } from "node:path";

type V = [number, number, number];
type N = [number, number, number, number];
type Part = Record<string, unknown>;

const PALETTE: Record<string, number[]> = {
  hide: [0.42, 0.4, 0.34, 0.85, 0],
  scale: [0.3, 0.29, 0.25, 0.7, 0],
  belly: [0.72, 0.66, 0.52, 0.8, 0],
  fur: [0.5, 0.46, 0.38, 0.95, 0],
  crest: [0.75, 0.28, 0.16, 0.6, 0],
  claw: [0.95, 0.92, 0.84, 0.3, 0],
  fang: [0.98, 0.96, 0.9, 0.25, 0],
  whisker: [0.92, 0.9, 0.84, 0.5, 0],
  eye: [0.85, 0.95, 0.2, 0.3, 0, 2.2],
  pupil: [0.03, 0.02, 0.02, 0.4, 0],
  mouth: [0.32, 0.06, 0.08, 0.6, 0],
  nose: [0.12, 0.08, 0.08, 0.5, 0],
  ear: [0.62, 0.42, 0.4, 0.8, 0],
};

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** A cat's face on a head node at `h`, `k` times a lynx-sized head: a round cranium wider than it is long, two
 *  whisker pads and a small chin under a flat face (a cat's face is flat in front, not a snout), a dark nose
 *  between the pads, big round eyes set forward under a brow, pointed ears up off the crown (with `tufts`, a
 *  lynx's), whiskers fanned out of the pads, a dark mouth line under them and two small fangs. */
function face(h: V, k: number, o: { eye?: number; ear?: number; tufts?: boolean; fang?: number } = {}) {
  const at = (off: V): V => [+(off[0] * k).toFixed(4), +(off[1] * k).toFixed(4), +(off[2] * k).toFixed(4)];
  const r = (x: number) => +(x * k).toFixed(4);
  const e = o.eye ?? 1, ear = o.ear ?? 1, earDir: V = [-0.05, 1, 0.4];
  const nodes: Record<string, N> = { head: [...h, r(0.15)] as N, chin: [...add(h, at([0.1, -0.08, 0])), r(0.07)] as N };
  const blobs = [
    { at: "head", off: at([0, 0.02, 0]), r: at([0.19, 0.18, 0.22]) },
    { at: "head", off: at([0.12, -0.05, 0.065]), r: at([0.085, 0.07, 0.085]) },
    { at: "head", off: at([0.12, -0.05, -0.065]), r: at([0.085, 0.07, 0.085]) },
    { at: "head", off: at([0.09, -0.1, 0]), r: at([0.07, 0.04, 0.07]) },
  ];
  const whiskers: Part[] = [0.15, 0, -0.15].map((y) => (
    { kind: "horn", at: "head", off: at([0.17, -0.045, 0.1]), dir: [0.35, y, 1], len: r(0.24), base: r(0.007), curve: 12, bend: [0, -1, 0], mirror: true, material: "whisker" }));
  const parts: Part[] = [
    { kind: "eye", at: "head", off: at([0.155, 0.05, 0.085]), r: r(0.05 * e), mirror: true, material: "eye" },
    // a cat's slit: two thin flat cones up and down from the middle of the eye
    ...[1, -1].map((y) => ({ kind: "horn", at: "head", off: at([0.155 + 0.046 * e, 0.05, 0.085 + 0.008 * e]), dir: [0, y, 0], len: r(0.036 * e), base: r(0.012 * e), curve: 1, bend: [0, 0, 1], flat: 0.35, mirror: true, material: "pupil" })),
    // an angry brow, low over the top of the eye and sloping down to the nose
    { kind: "ridge", at: "head", off: at([0.16, 0.098, 0.095]), dir: [0.15, -0.4, -1], len: r(0.11), base: r(0.03), curve: 10, mirror: true, material: "hide" },
    { kind: "eye", at: "head", off: at([0.2, -0.015, 0]), r: r(0.028), material: "nose" },
    { kind: "ridge", at: "head", off: at([0.19, -0.1, 0]), dir: [-0.2, 0, 1], len: r(0.12), base: r(0.022), curve: 60, bend: [-1, 0, 0], mirror: true, material: "mouth" },
    { kind: "horn", at: "head", off: at([0.185, -0.09, 0.035]), dir: [0.15, -1, 0], len: r(0.06 * (o.fang ?? 1)), base: r(0.014), curve: 10, bend: [-1, 0, 0], mirror: true, material: "fang" },
    // pointed ears: flat cones, thin front to back, pink inside
    { kind: "horn", at: "head", off: at([-0.02, 0.13, 0.12]), dir: earDir, len: r(0.17 * ear), base: r(0.075 * ear), curve: 12, bend: [1, 0, 0], flat: 0.3, mirror: true, material: "hide" },
    { kind: "horn", at: "head", off: at([-0.005, 0.135, 0.12]), dir: earDir, len: r(0.13 * ear), base: r(0.05 * ear), curve: 12, bend: [1, 0, 0], flat: 0.25, mirror: true, material: "ear" },
    ...whiskers,
  ];
  const n = Math.hypot(...earDir), tip = (x: number) => 0.16 * ear * x / n;
  if (o.tufts) parts.push({ kind: "horn", at: "head", off: at([-0.01 + tip(earDir[0]), 0.13 + tip(earDir[1]), 0.12 + tip(earDir[2])]), dir: [-0.15, 1, 0.3], len: r(0.08), base: r(0.012), curve: 20, bend: [-1, 0, 0], mirror: true, material: "pupil" });
  return { nodes, parts, blobs };
}

/** Curved spines down the back along a chain, `n` of them, swelling to `peak` at `top` of the way. */
function crest(nodes: Record<string, N>, chain: string[], n: number, peak: number, base: number, top = 0.3): Part[] {
  const pts = chain.map((c) => nodes[c]!);
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0.5 : i / (n - 1);
    const s = f * (pts.length - 1);
    const a = pts[Math.floor(s)]!, b = pts[Math.min(pts.length - 1, Math.floor(s) + 1)]!, u = s - Math.floor(s);
    const p = [0, 1, 2, 3].map((j) => a[j]! + (b[j]! - a[j]!) * u);
    const size = 0.45 + 0.55 * Math.exp(-(((f - top) / 0.45) ** 2));
    const o = pts[0]!;
    out.push({ kind: "horn", at: chain[0], off: [+(p[0]! - o[0]).toFixed(4), +(p[1]! + p[3]! * 0.8 - o[1]).toFixed(4), +(p[2]! - o[2]).toFixed(4)], dir: [-0.4, 1, 0], len: +(peak * size).toFixed(4), base: +(base * size).toFixed(4), curve: 40, bend: [-1, 0, 0], flat: 0.35, material: "crest" });
  }
  return out;
}

/** Three hooked claws off the front of a paw. */
const claws = (at: string, fwd: number, len: number, base: number): Part[] =>
  [-1, 0, 1].map((z) => ({ kind: "horn", at, off: [fwd, -0.015, z * 0.045], dir: [1, -0.3, z * 0.35], len, base, curve: 60, bend: [0, -1, 0], mirror: true, material: "claw" }));

/** The one pair of legs: short, thick, bent forward at the elbow, a paw and hooked claws. */
const arms = (r: number[], paw: number, sole: number, claw: [number, number]): Part[] => [
  { kind: "limb", along: ["l_shoulder", "l_elbow", "l_foot"], radii: r, depth: 1.15, calf: 0.2, mirror: true, material: "hide" },
  { kind: "foot", at: "l_foot", form: "paw", len: paw, width: paw, toes: 3, claw: 0, sole, mirror: true, material: "hide" },
  ...claws("l_foot", paw * 0.7, claw[0], claw[1]),
];

const scales = (chain: string[], n: number, len: number, rows = 5, spread = 150): Part =>
  ({ kind: "scales", along: chain, n, len, base: len * 1.2, overlap: 1.3, sink: 0.95, rows, spread, material: "scale" });

function sheet(id: string, about: string, spine: [string, N][], legs: [N, N, N], f: ReturnType<typeof face>, parts: Part[], colours: Record<string, number[]> = {}, budget = 6000) {
  const body = Object.fromEntries(spine) as Record<string, N>;
  const nodes = { ...body, l_shoulder: legs[0], l_elbow: legs[1], l_foot: legs[2], ...f.nodes };
  const names = [...spine.map(([n]) => n), "head"];
  const links = [...names.slice(1).map((n, i) => [names[i]!, n]), ["head", "chin"], ["chest", "l_shoulder"], ["l_shoulder", "l_elbow"], ["l_elbow", "l_foot"]];
  return {
    id, name: "Tatzelwurm", about, archetype: "skirmisher", feet: 2, budget, root: "chest", material: "hide",
    palette: { ...PALETTE, ...colours }, nodes, links, blobs: f.blobs, parts: [...f.parts, ...parts],
    belly: "belly", belly_turn: -0.3, blend: 0.022,
  };
}

// A: the plates. The 19th-century Alpine engraving and the 1723 cat-headed serpent: one long, thick, evenly
// scaled worm lying low in a slow S, a small round cat face at the front and two stubby paws under the neck.
const aSpine: [string, N][] = [
  ["t6", [-1.75, 0.22, -0.05, 0.045]], ["t5", [-1.58, 0.24, 0.12, 0.09]], ["t4", [-1.34, 0.26, 0.26, 0.14]],
  ["t3", [-1.04, 0.28, 0.2, 0.18]], ["t2", [-0.74, 0.29, -0.06, 0.2]], ["t1", [-0.44, 0.3, -0.22, 0.21]],
  ["b1", [-0.12, 0.31, -0.12, 0.21]], ["chest", [0.16, 0.33, 0.02, 0.2]], ["neck", [0.4, 0.39, 0, 0.17]],
];
const plate = sheet("tatzelwurm-plate", "The old plates: a long thick scaly worm in a low S, a round cat face, two stubby paws.", aSpine,
  [[0.28, 0.3, 0.18, 0.09], [0.38, 0.16, 0.3, 0.07], [0.46, 0.045, 0.33, 0.05]],
  face([0.62, 0.48, 0], 1.2), [
    ...arms([0.09, 0.075, 0.06], 0.13, 0.04, [0.09, 0.022]),
    scales(["neck", "chest", "b1", "t1", "t2", "t3", "t4", "t5"], 34, 0.075, 4, 160),
    { kind: "tuft", along: ["head", "neck", "chest"], n: 4, len: 0.1, base: 0.05, rows: 5, spread: 160, sweep: 1.2, material: "fur" },
  ]);

// B: the Alpine folk figure. The 1723 plate's tufted lynx face with whiskers and a bristling mane, and the
// reconstruction's red crest down the back and tail curled up off the ground; olive with a pale belly.
const bSpine: [string, N][] = [
  ["t6", [-1.12, 0.62, 0, 0.04]], ["t5", [-1.3, 0.56, 0, 0.065]], ["t4", [-1.3, 0.34, 0, 0.09]],
  ["t3", [-1.0, 0.17, 0, 0.12]], ["t2", [-0.72, 0.17, 0.08, 0.16]], ["t1", [-0.44, 0.19, 0.08, 0.19]],
  ["b1", [-0.14, 0.22, 0, 0.21]], ["chest", [0.14, 0.29, 0, 0.2]], ["neck", [0.34, 0.42, 0, 0.15]],
];
const bBody = Object.fromEntries(bSpine) as Record<string, N>;
const alpine = sheet("tatzelwurm-alpine", "The Alpine folk figure: tufted lynx face, whiskers, a mane, a red crest, the tail curled up.", bSpine,
  [[0.22, 0.28, 0.15, 0.1], [0.36, 0.14, 0.22, 0.08], [0.43, 0.045, 0.23, 0.055]],
  face([0.5, 0.56, 0], 1.15, { tufts: true, fang: 1.3 }), [
    ...arms([0.1, 0.08, 0.065], 0.15, 0.045, [0.11, 0.026]),
    scales(["chest", "b1", "t1", "t2", "t3", "t4"], 26, 0.075, 4, 140),
    ...crest(bBody, ["chest", "b1", "t1", "t2", "t3", "t4", "t5"], 13, 0.16, 0.06, 0.25),
    { kind: "tuft", along: ["head", "neck", "chest"], n: 6, len: 0.15, base: 0.06, rows: 7, spread: 200, sweep: 1.3, material: "fur" },
  ], { hide: [0.36, 0.44, 0.24, 0.85, 0], scale: [0.26, 0.34, 0.16, 0.7, 0], fur: [0.46, 0.4, 0.26, 0.95, 0], belly: [0.82, 0.74, 0.4, 0.8, 0] });

// C: a starter. The village-fountain statue's big cat head and short body, so it reads at fight size: the head
// near a third of the beast, a fat body arched like the statue's, chunky paws, and the tail coiled up behind.
const cSpine: [string, N][] = [
  ["t6", [-0.42, 0.74, 0, 0.04]], ["t5", [-0.6, 0.76, 0, 0.065]], ["t4", [-0.74, 0.6, 0, 0.09]],
  ["t3", [-0.66, 0.38, 0, 0.12]], ["t2", [-0.46, 0.24, 0, 0.16]], ["t1", [-0.24, 0.22, 0, 0.2]],
  ["b1", [-0.04, 0.27, 0, 0.22]], ["chest", [0.14, 0.33, 0, 0.2]], ["neck", [0.26, 0.45, 0, 0.16]],
];
const starter = sheet("tatzelwurm-starter", "A starter: the fountain statue's big cat head, a short fat arched body, chunky paws, a coiled tail.", cSpine,
  [[0.22, 0.3, 0.14, 0.1], [0.32, 0.16, 0.21, 0.085], [0.38, 0.05, 0.22, 0.06]],
  face([0.4, 0.66, 0], 1.6, { eye: 1.2, ear: 1.05 }), [
    ...arms([0.11, 0.09, 0.075], 0.16, 0.05, [0.12, 0.03]),
    scales(["chest", "b1", "t1", "t2", "t3"], 16, 0.08, 3, 110),
    { kind: "tuft", along: ["head", "neck"], n: 3, len: 0.12, base: 0.06, rows: 6, spread: 200, sweep: 1.2, material: "fur" },
  ], { hide: [0.5, 0.56, 0.6, 0.85, 0], scale: [0.36, 0.42, 0.48, 0.7, 0], fur: [0.58, 0.62, 0.66, 0.95, 0], belly: [0.86, 0.86, 0.8, 0.8, 0] });

for (const s of [plate, alpine, starter]) await Bun.write(join(import.meta.dir, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
console.log("wrote tatzelwurm-plate, tatzelwurm-alpine, tatzelwurm-starter");
