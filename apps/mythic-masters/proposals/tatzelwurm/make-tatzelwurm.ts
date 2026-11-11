// The Tatzelwurm after the Haus der Natur reconstruction (README.md here), which the owner picked as the target
// over the first three tries: `bun proposals/tatzelwurm/make-tatzelwurm.ts` writes proposals/tatzelwurm/
// tatzelwurm-museum.json (four legs, as the figure has) and tatzelwurm-museum2.json (two, as the lore says).
// Build one with `blender -b --factory-startup --python-exit-code 1 -t 8 -P blender/beast.py -- proposals/tatzelwurm/tatzelwurm-museum.json --render`.
// The picked one replaces beasts/tatzelwurm.json (id back to "tatzelwurm"); the rest and this script are deleted.
import { join } from "node:path";

type V = [number, number, number];
type N = [number, number, number, number];
type Part = Record<string, unknown>;

const PALETTE: Record<string, number[]> = {
  hide: [0.44, 0.5, 0.22, 0.8, 0],
  tail: [0.4, 0.34, 0.18, 0.8, 0],
  belly: [0.74, 0.74, 0.32, 0.8, 0],
  crest: [0.85, 0.34, 0.2, 0.55, 0],
  frill: [0.78, 0.46, 0.34, 0.7, 0],
  tongue: [0.82, 0.27, 0.24, 0.5, 0],
  mouth: [0.3, 0.06, 0.06, 0.6, 0],
  fang: [0.96, 0.93, 0.82, 0.25, 0],
  claw: [0.97, 0.95, 0.88, 0.3, 0],
  eye: [0.86, 0.86, 0.5, 0.25, 0, 1.2],
  pupil: [0.05, 0.04, 0.03, 0.4, 0],
  nostril: [0.12, 0.1, 0.06, 0.6, 0],
};

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** The figure's head on a head node at `h`, `k` times life size: a broad flat-topped cranium and a blunt snout
 *  of round flesh, the lower jaw dropped open on its own node under it with a dark mouth between, a row of
 *  fangs hanging from the upper lip, a long red forked tongue hanging out to the chest, round pale eyes under a
 *  heavy brow, big nostrils on top of the nose, webbed frills swept back off the cheeks and three short horns. */
function head(h: V, k: number) {
  const at = (off: V): V => [+(off[0] * k).toFixed(4), +(off[1] * k).toFixed(4), +(off[2] * k).toFixed(4)];
  const r = (x: number) => +(x * k).toFixed(4);
  const nodes: Record<string, N> = {
    head: [...h, r(0.1)] as N,
    jaw: [...add(h, at([0.13, -0.13, 0])), r(0.045)] as N,
  };
  const blobs = [
    { at: "head", off: at([0, 0.02, 0]), r: at([0.15, 0.1, 0.15]) },
    { at: "head", off: at([0.13, -0.01, 0]), r: at([0.12, 0.075, 0.11]) },
    { at: "head", off: at([0.22, 0.0, 0]), r: at([0.06, 0.06, 0.08]) },
    { at: "jaw", off: at([0.0, 0, 0]), r: at([0.12, 0.035, 0.09]), rot: [0, 0, -12] },
  ];
  const fangs: Part[] = [0.02, 0.05, 0.08, 0.1].map((z, i) => (
    { kind: "horn", at: "head", off: at([0.24 - z * 0.9, -0.06, z]), dir: [0.15, -1, 0], len: r(i === 2 ? 0.075 : 0.05), base: r(i === 2 ? 0.016 : 0.012), curve: 12, bend: [-1, 0, 0], mirror: true, material: "fang" }));
  const parts: Part[] = [
    // the open mouth: a dark gullet between the snout and the dropped jaw, fangs over it, the tongue hanging out
    { kind: "eye", at: "head", off: at([0.12, -0.085, 0]), r: r(0.07), material: "mouth" },
    ...fangs,
    { kind: "horn", at: "jaw", off: at([0.08, 0.02, 0.06]), dir: [0.1, 1, 0], len: r(0.035), base: r(0.01), mirror: true, material: "fang" },
    // a flat ribbon hanging straight down, splitting into two points at the end
    { kind: "horn", at: "head", off: at([0.2, -0.08, 0]), dir: [0.08, -1, 0], len: r(0.36), base: r(0.042), tip_base: r(0.03), curve: 2, bend: [1, 0, 0], flat: 0.3, material: "tongue" },
    ...[1, -1].map((s) => ({ kind: "horn", at: "head", off: at([0.228, -0.42, 0.014 * s]), dir: [0.08, -1, 0.35 * s], len: r(0.1), base: r(0.02), curve: 2, bend: [1, 0, 0], flat: 0.3, material: "tongue" })),
    // eyes and brow
    { kind: "eye", at: "head", off: at([0.09, 0.07, 0.11]), r: r(0.042), mirror: true, material: "eye" },
    { kind: "eye", at: "head", off: at([0.124, 0.072, 0.118]), r: r(0.02), mirror: true, material: "pupil" },
    { kind: "ridge", at: "head", off: at([0.1, 0.11, 0.115]), dir: [0.6, -0.1, -1], len: r(0.12), base: r(0.035), curve: 15, mirror: true, material: "hide" },
    // nostrils on top of the blunt nose
    { kind: "eye", at: "head", off: at([0.25, 0.045, 0.035]), r: r(0.018), mirror: true, material: "nostril" },
    // frills: a fan of flat pointed ribs swept back off each cheek, longest at the top, like the figure's fins
    ...[[1.1, 0.24], [0.6, 0.21], [0.15, 0.17], [-0.3, 0.13], [-0.75, 0.1]].map(([y, len]) => (
      { kind: "horn", at: "head", off: at([-0.02, 0.0, 0.13]), dir: [-0.7, y!, 0.6], len: r(len!), base: r(0.05), curve: 15, bend: [0, 1, 0], flat: 0.22, mirror: true, material: "frill" })),
    // three short horns on the crown
    { kind: "horn", at: "head", off: at([-0.02, 0.1, 0]), dir: [-0.2, 1, 0], len: r(0.1), base: r(0.03), curve: 15, bend: [-1, 0, 0], material: "crest" },
    { kind: "horn", at: "head", off: at([0.0, 0.09, 0.07]), dir: [-0.2, 1, 0.5], len: r(0.08), base: r(0.025), curve: 15, bend: [-1, 0, 0], mirror: true, material: "crest" },
  ];
  return { nodes, parts, blobs };
}

/** The crest: flat triangular red spines down the back of a chain, standing off its upper side wherever the chain
 *  turns (up the neck, over the back, round the tail's coil), leaning toward the tail. */
function crest(nodes: Record<string, N>, chain: string[], n: number, peak: number, base: number): Part[] {
  const pts = chain.map((c) => nodes[c]!);
  const out: Part[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i / (n - 1)) * (pts.length - 1);
    const j = Math.min(pts.length - 2, Math.floor(s)), u = s - j;
    const a = pts[j]!, b = pts[j + 1]!;
    const p = [0, 1, 2, 3].map((q) => a[q]! + (b[q]! - a[q]!) * u);
    const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dx = (b[0] - a[0]) / dl, dy = (b[1] - a[1]) / dl;
    const nx = dy, ny = -dx; // the chain's upper side, toward the tail
    const size = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, (i + 2) / (n * 0.7)));
    const o = pts[0]!;
    out.push({ kind: "horn", at: chain[0], off: [+(p[0]! + nx * p[3]! * 0.85 - o[0]).toFixed(4), +(p[1]! + ny * p[3]! * 0.85 - o[1]).toFixed(4), 0], dir: [+(nx + 0.4 * dx).toFixed(3), +(ny + 0.4 * dy).toFixed(3), 0], len: +(peak * size).toFixed(4), base: +(base * size).toFixed(4), curve: 2, bend: [0, 0, 1], flat: 0.3, material: "crest" });
  }
  return out;
}

/** A sprawled lizard leg: a limb over three nodes, a long-toed foot and four white hooked claws. */
const leg = (along: [string, string, string], radii: number[], foot: number): Part[] => [
  { kind: "limb", along, radii, depth: 1.1, calf: 0.15, mirror: true, material: "hide" },
  { kind: "foot", at: along[2], form: "paw", len: foot, width: foot * 1.1, toes: 4, claw: 0, sole: 0.035, mirror: true, material: "hide" },
  ...[-1.5, -0.5, 0.5, 1.5].map((z) => ({ kind: "horn", at: along[2], off: [foot * 0.75, -0.015, z * 0.032], dir: [1, -0.35, z * 0.3], len: 0.06, base: 0.014, curve: 55, bend: [0, -1, 0], mirror: true, material: "claw" })),
];

const SPINE: [string, N][] = [
  ["t7", [-1.22, 0.5, 0, 0.035]], ["t6", [-1.18, 0.64, 0, 0.045]], ["t5", [-1.32, 0.7, 0, 0.055]],
  ["t4", [-1.45, 0.56, 0, 0.07]], ["t3", [-1.4, 0.38, 0, 0.09]], ["t2", [-1.18, 0.27, 0, 0.12]],
  ["t1", [-0.9, 0.26, 0, 0.15]], ["hip", [-0.6, 0.27, 0, 0.18]], ["b2", [-0.3, 0.27, 0, 0.2]],
  ["b1", [0.0, 0.27, 0, 0.2]], ["chest", [0.28, 0.3, 0, 0.18]], ["n1", [0.48, 0.56, 0, 0.14]],
  ["n2", [0.56, 0.86, 0, 0.115]],
];
const HEAD: V = [0.62, 1.1, 0];

function sheet(id: string, about: string, hind: boolean) {
  const body = Object.fromEntries(SPINE) as Record<string, N>;
  const f = head(HEAD, 1.3);
  const legs: Record<string, N> = {
    l_shoulder: [0.3, 0.24, 0.15, 0.08], l_elbow: [0.38, 0.17, 0.36, 0.06], l_foot: [0.5, 0.045, 0.4, 0.045],
    ...(hind ? { l_hipj: [-0.62, 0.24, 0.15, 0.08], l_knee: [-0.58, 0.17, 0.37, 0.06], l_bfoot: [-0.48, 0.045, 0.42, 0.045] } : {}),
  };
  const names = [...SPINE.map(([n]) => n), "head"];
  const links = [...names.slice(1).map((n, i) => [names[i]!, n]), ["head", "jaw"], ["chest", "l_shoulder"], ["l_shoulder", "l_elbow"], ["l_elbow", "l_foot"],
    ...(hind ? [["hip", "l_hipj"], ["l_hipj", "l_knee"], ["l_knee", "l_bfoot"]] : [])];
  return {
    id, name: "Tatzelwurm", about, archetype: "skirmisher", feet: hind ? 4 : 2, budget: 6000, root: "chest", material: "hide",
    palette: PALETTE, nodes: { ...body, ...legs, ...f.nodes }, links, blobs: f.blobs,
    parts: [
      ...f.parts,
      ...leg(["l_shoulder", "l_elbow", "l_foot"], [0.085, 0.065, 0.05], 0.13),
      ...(hind ? leg(["l_hipj", "l_knee", "l_bfoot"], [0.095, 0.07, 0.05], 0.14) : []),
      ...crest(body, ["n2", "n1", "chest", "b1", "b2", "hip", "t1", "t2", "t3", "t4", "t5"], 34, 0.11, 0.05),
    ],
    paint: [{ nodes: ["t3", "t4", "t5", "t6", "t7"], material: "tail" }],
    belly: "belly", belly_turn: -0.3, blend: 0.02,
  };
}

const museum = sheet("tatzelwurm-museum", "After the Haus der Natur figure: open fanged mouth, forked tongue, frills, a red crest, a curled tail, four sprawled legs.", true);
const museum2 = sheet("tatzelwurm-museum2", "The same figure on the lore's two front legs only.", false);
for (const s of [museum, museum2]) await Bun.write(join(import.meta.dir, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
console.log("wrote tatzelwurm-museum, tatzelwurm-museum2");
