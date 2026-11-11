// Three Agropelter directions, each from a reference (README.md here): `bun proposals/agropelter/make.ts`
// writes proposals/agropelter/agropelter-{cox,tryon,starter}.json. Build one with
// `blender -b --factory-startup --python-exit-code 1 -t 8 -P blender/beast.py -- proposals/agropelter/agropelter-cox.json --render`,
// then `bun proposals/agropelter/make.ts --check` rigs every built GLB and says whether it finds 2 feet.
// The picked one replaces beasts/agropelter.json (id back to "agropelter"); this folder is then deleted.
import { join } from "node:path";
import { analyze } from "@rustybuns/rig";
import { loadGlb } from "@rustybuns/rig/model";
import { feetOf } from "../../src/beasts.ts";

type V = [number, number, number];
type N = [number, number, number, number];
type Part = Record<string, unknown>;
type Blob = { at: string; off: V; r: V };

const IDS = ["agropelter-cox", "agropelter-tryon", "agropelter-starter"];

const PALETTE = {
  fur: [0.27, 0.21, 0.16, 0.95, 0],
  mane: [0.13, 0.1, 0.08, 0.95, 0],
  belly: [0.42, 0.33, 0.25, 0.95, 0],
  face: [0.74, 0.57, 0.46, 0.75, 0],
  eye: [1, 0.78, 0.2, 0.3, 0, 1.6],
  pupil: [0.03, 0.02, 0.02, 0.4, 0],
  mouth: [0.24, 0.05, 0.06, 0.6, 0],
  tooth: [0.97, 0.94, 0.86, 0.25, 0],
  dark: [0.05, 0.04, 0.04, 0.7, 0],
  bark: [0.42, 0.37, 0.31, 0.95, 0],
  claw: [0.2, 0.15, 0.12, 0.4, 0],
};

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: V): V => mul(a, 1 / Math.hypot(...a));
const fix = (a: V): V => a.map((x) => +x.toFixed(4)) as V;

/** How far forward (+x) the flesh of these head blobs reaches at height y and side z, head-local. */
function front(blobs: Blob[], y: number, z: number) {
  let x = -1;
  for (const b of blobs) {
    const q = 1 - ((y - b.off[1]) / b.r[1]) ** 2 - ((z - b.off[2]) / b.r[2]) ** 2;
    if (q > 0) x = Math.max(x, b.off[0] + b.r[0] * Math.sqrt(q));
  }
  return x;
}

type FaceOpts = { long?: number; wide?: number; ear?: number; earUp?: number; eye?: number; grin?: number; teeth?: number; brow?: number };

/** An ape's face round a head node at `h`, `k` times a 1-metre-scale head: a round cranium, a jutting
 *  bare-skinned muzzle and chin (`long` forward, `wide` across), a heavy brow over yellow eyes, a wide dark
 *  grin wrapping the muzzle with square teeth hanging in it, two nostrils and pointed ears up off the crown. */
function face(h: V, k: number, o: FaceOpts = {}) {
  const L = o.long ?? 1, W = o.wide ?? 1, E = o.eye ?? 1, G = o.grin ?? 1;
  const blobsLocal: Blob[] = [
    { at: "head", off: [-0.02, 0.04, 0], r: [0.15, 0.15, 0.14] },
    { at: "head", off: [0.08 * L, -0.05, 0], r: [0.1 * L, 0.085, 0.105 * W] },
    { at: "head", off: [0.06 * L, -0.11, 0], r: [0.085 * L, 0.05, 0.085 * W] },
    { at: "head", off: [0.075, 0.055, 0], r: [0.06, 0.035 * (o.brow ?? 1), 0.13] },
  ];
  const at = (off: V): V => fix(mul(off, k));
  const r = (x: number) => +(x * k).toFixed(4);
  const blobs = blobsLocal.map((b) => ({ at: b.at, off: at(b.off), r: at(b.r) }));
  const nodes: Record<string, N> = {
    head: [...h, r(0.13)] as N,
    snout: [...add(h, at([0.12 * L, -0.06, 0])), r(0.07)] as N,
    jaw: [...add(h, at([0.08 * L, -0.12, 0])), r(0.06)] as N,
    // inside the head, just behind the eyes: the flesh nearest it is painted bare skin, an ape face round the eyes
    mask: [...add(h, at([0.08, 0.01, 0])), r(0.04)] as N,
  };
  const skin = (y: number, z: number, sink = 0.006): V => [front(blobsLocal, y, z) - sink, y, z];
  const lipY = -0.085;
  const eyeY = 0.015, eyeZ = 0.058;
  const teeth: Part[] = [0.018, 0.05, 0.08].slice(0, o.teeth ?? 3).map((z) => (
    { kind: "horn", at: "head", off: at(skin(lipY + 0.012, z * W, 0.01)), dir: [0.3, -1, 0], len: r(0.03), base: r(0.016), mirror: true, material: "tooth" }));
  const parts: Part[] = [
    // the grin: a dark lip band from the middle of the muzzle round to each cheek
    { kind: "ridge", at: "head", off: at(add(skin(lipY, 0), [0.008, 0, 0])), dir: [-0.15, 0.12 * G, 1], len: r(0.15 * W * G), base: r(0.028), curve: 70, bend: [-1, 0.25, 0], mirror: true, material: "mouth" },
    ...teeth,
    { kind: "eye", at: "head", off: at(skin(eyeY, eyeZ, 0.022)), r: r(0.032 * E), mirror: true, material: "eye" },
    { kind: "eye", at: "head", off: at(skin(eyeY, eyeZ * 1.02, 0.0)), r: r(0.015 * E), mirror: true, material: "pupil" },
    // the brow, angry: low over the nose, up at the temples
    { kind: "ridge", at: "head", off: at(skin(0.062, 0.02, 0.0)), dir: [-0.25, 0.25, 1], len: r(0.11), base: r(0.03), curve: 15, mirror: true, material: "mane" },
    { kind: "eye", at: "head", off: at(skin(-0.03, 0.022, 0.0)), r: r(0.014), mirror: true, material: "dark" },
    { kind: "ear", at: "head", off: at([-0.05, 0.1, 0.11]), dir: [-0.35, o.earUp ?? 0.9, 1], len: r(0.15 * (o.ear ?? 1)), width: r(0.045 * (o.ear ?? 1)), tilt: 30, cup: 30, mirror: true, material: "face" },
  ];
  return { nodes, parts, blobs };
}

/** A shaggy mane over the crown, the neck and the shoulders, swept back. */
const mane = (len: number, n = 9): Part[] => [
  { kind: "tuft", along: ["head", "neck", "chest"], n, len, base: len * 0.5, rows: 9, spread: 300, sweep: 1.5, curve: 40, material: "mane" },
  { kind: "tuft", along: ["neck", "chest"], n: Math.round(n * 0.6), len: len * 1.2, base: len * 0.55, rows: 9, spread: 320, sweep: 1.3, curve: 30, material: "mane" },
  { kind: "tuft", along: ["chest", "belly", "hip"], n: Math.round(n * 0.8), len: len * 0.7, base: len * 0.35, rows: 5, spread: 190, sweep: 1.4, curve: 35, material: "fur" },
];

/** Four long hooked fingers off a hand, curled down and back round whatever it grips. */
const fingers = (at: string, len: number, base: number, curl = 120): Part[] =>
  [-1.5, -0.5, 0.5, 1.5].map((z) => ({ kind: "horn", at, off: [0.02, 0, z * base * 1.6], dir: [1, -0.1, z * 0.18], len, base, curve: curl, bend: [0, -1, 0], mirror: true, material: "face" }));

/** A dead branch through the left fist (only the left: the right hand is empty), pointing `dir`, `len` long,
 *  with a jagged broken end and a couple of dead twigs. */
function branch(at: string, dir: V, len: number, base: number): Part[] {
  const d = norm(dir);
  const side: V = norm([-d[1], d[0], 0.3]);
  const twig = (f: number, s: number, l: number): Part[] => {
    const off = mul(d, len * f), td = norm(add(mul(d, 0.7), mul(side, s)));
    return [
      { kind: "horn", at, off: fix(off), dir: fix(td), len: +(len * l).toFixed(4), base: +(base * 0.4).toFixed(4), tip_base: +(base * 0.15).toFixed(4), curve: 25 * s, material: "bark" },
      { kind: "horn", at, off: fix(add(off, mul(td, len * l * 0.55))), dir: fix(norm(add(td, mul(side, -s * 0.9)))), len: +(len * l * 0.45).toFixed(4), base: +(base * 0.2).toFixed(4), tip_base: +(base * 0.08).toFixed(4), material: "bark" },
    ];
  };
  // the snapped-off far end: a few short splinters, not a point
  const end = mul(d, len * 0.97);
  const splinters: Part[] = [[0.5, 0.2], [-0.4, 0.3], [0.1, -0.5]].map(([a, b]) => (
    { kind: "horn", at, off: fix(add(end, [0, 0, b! * base * 0.6])), dir: fix(norm(add(d, mul(side, a!)))), len: +(base * 1.1).toFixed(4), base: +(base * 0.45).toFixed(4), material: "bark" }));
  return [
    { kind: "horn", at, dir: d, len, base, tip_base: base * 0.85, curve: 8, material: "bark" },
    { kind: "horn", at, dir: mul(d, -1), len: len * 0.16, base, tip_base: base, material: "bark" },
    ...splinters, ...twig(0.42, 1, 0.32), ...twig(0.68, -1, 0.24),
  ];
}

/** An arm from the shoulder to the hand as a smooth curve through `ctrl` (Catmull-Rom), `n` nodes, the radius
 *  easing from `r0` to `r1`: a whip-thin arm bends round in a curve instead of kinking at one elbow. The first
 *  node is `l_shoulder`, the last `l_hand`. */
function arm(ctrl: V[], n: number, r0: number, r1: number) {
  const p = [ctrl[0]!, ...ctrl, ctrl[ctrl.length - 1]!];
  const at = (t: number): V => {
    const s = t * (ctrl.length - 1), i = Math.min(ctrl.length - 2, Math.floor(s)), u = s - i;
    const [a, b, c, e] = [p[i]!, p[i + 1]!, p[i + 2]!, p[i + 3]!];
    return [0, 1, 2].map((k) => 0.5 * (2 * b[k]! + (-a[k]! + c[k]!) * u + (2 * a[k]! - 5 * b[k]! + 4 * c[k]! - e[k]!) * u * u + (-a[k]! + 3 * b[k]! - 3 * c[k]! + e[k]!) * u ** 3)) as V;
  };
  const names = Array.from({ length: n }, (_, i) => i === 0 ? "l_shoulder" : i === n - 1 ? "l_hand" : `l_arm${i}`);
  const nodes: Record<string, N> = {};
  const radii: number[] = [];
  names.forEach((nm, i) => {
    const t = i / (n - 1), r = +(r0 + (r1 - r0) * Math.sqrt(t)).toFixed(4);
    radii.push(r);
    nodes[nm] = [...fix(at(t)), +(i === 0 ? r * 0.9 : r * 0.5).toFixed(4)] as N;
  });
  return { nodes, names, radii };
}

const SPINE = ["hip", "belly", "chest", "neck", "head", "snout"];
const links = (armNames: string[]) => [...SPINE.slice(1).map((n, i) => [SPINE[i]!, n]), ["head", "jaw"], ["head", "mask"],
  ["chest", "l_shoulder"], ...armNames.slice(1).map((n, i) => [armNames[i]!, n]),
  ["hip", "l_hipj"], ["l_hipj", "l_knee"], ["l_knee", "l_foot"]];

const ABOUT = "Lumber-camp tales of the north woods: a lean ape with whip-thin arms longer than its legs, living in hollow trunks and pelting anyone who passes with dead branches. Hunched, long-armed, knuckles near the ground.";

type Arm = ReturnType<typeof arm>;
function sheet(id: string, body: Record<string, N>, a: Arm, f: ReturnType<typeof face>, parts: Part[], extra: { blobs?: Blob[]; colours?: Record<string, number[]> } = {}) {
  return {
    id, name: "Agropelter", about: ABOUT, archetype: "bruiser", feet: 2, wings: 0, budget: 6800, root: "chest", material: "fur",
    palette: { ...PALETTE, ...extra.colours }, nodes: { ...body, ...a.nodes, ...f.nodes }, links: links(a.names),
    blobs: [...f.blobs, ...(extra.blobs ?? [])], parts: [...f.parts,
      { kind: "limb", along: a.names, radii: a.radii, depth: 1, mirror: true, material: "fur" }, ...parts],
    paint: [{ nodes: ["snout", "jaw", "mask"], material: "face" }],
    belly: "belly", belly_turn: -0.3, blend: 0.02,
  };
}

const legs = (radii: number[], calf = 0.15): Part => ({ kind: "limb", along: ["l_hipj", "l_knee", "l_foot"], radii, depth: 1.1, calf, mirror: true, material: "fur" });
const feet = (len: number, sole: number): Part[] => [
  { kind: "foot", at: "l_foot", form: "paw", len, width: len * 0.6, toes: 4, claw: len * 0.18, sole, mirror: true, material: "face" },
];

// A: Cox 1910 (the plate on p. 40): a lean, shaggy-maned ape with a long sly face, whip-thin rope arms far longer
// than its legs (here swinging back in a loop and forward again), a dead branch in the left fist.
const aBody: Record<string, N> = {
  hip: [-0.04, 0.86, 0, 0.13], belly: [0.05, 1.02, 0, 0.15], chest: [0.15, 1.18, 0, 0.17], neck: [0.28, 1.32, 0, 0.09],
  l_hipj: [-0.02, 0.82, 0.1, 0.06], l_knee: [0.2, 0.46, 0.15, 0.04], l_foot: [0.0, 0.07, 0.14, 0.035],
};
const aArm = arm([[0.14, 1.28, 0.17], [0.06, 1.05, 0.3], [-0.06, 0.78, 0.36], [0.08, 0.52, 0.4], [0.36, 0.48, 0.38], [0.56, 0.6, 0.3]], 14, 0.06, 0.03);
const cox = sheet("agropelter-cox", aBody, aArm, face([0.4, 1.42, 0], 1.0, { long: 1.35, wide: 0.92, ear: 1, grin: 1, brow: 1.2 }), [
  legs([0.085, 0.055, 0.04]), ...feet(0.2, 0.06),
  ...fingers("l_hand", 0.09, 0.016),
  ...branch("l_hand", [0.55, 1, -0.15], 0.75, 0.045),
  ...mane(0.24, 11),
], { blobs: [{ at: "chest", off: [0.02, 0.02, 0], r: [0.17, 0.2, 0.2] }] });

// B: Tryon 1939: a squat, round, shaggy ape clinging to its tree, a wide toothy grin under a low brow, big
// pointed ears, long arms with long-fingered hands, short bowed legs.
const bBody: Record<string, N> = {
  hip: [-0.04, 0.62, 0, 0.18], belly: [0.04, 0.8, 0, 0.22], chest: [0.12, 1.0, 0, 0.22], neck: [0.24, 1.14, 0, 0.12],
  l_hipj: [-0.04, 0.58, 0.15, 0.08], l_knee: [0.16, 0.34, 0.24, 0.06], l_foot: [0.06, 0.08, 0.2, 0.05],
};
const bArm = arm([[0.14, 1.06, 0.24], [0.04, 0.84, 0.36], [0.02, 0.64, 0.42], [0.26, 0.5, 0.42], [0.5, 0.5, 0.34]], 11, 0.085, 0.045);
const tryon = sheet("agropelter-tryon", bBody, bArm, face([0.34, 1.26, 0], 1.2, { long: 0.9, wide: 1.25, ear: 1.3, earUp: 1.4, grin: 1.2, brow: 1.3, eye: 1.3 }), [
  legs([0.11, 0.075, 0.05], 0.25), ...feet(0.22, 0.07),
  ...fingers("l_hand", 0.12, 0.02),
  ...branch("l_hand", [0.5, 1, -0.2], 0.8, 0.05),
  ...mane(0.24, 11),
], { blobs: [{ at: "belly", off: [0.02, 0, 0], r: [0.27, 0.3, 0.27] }, { at: "chest", off: [0.03, 0.04, 0], r: [0.22, 0.2, 0.25] }] });

// C: a starter. The head near half the beast so it reads at fight size: a huge grin, big yellow eyes, tall
// pointed ears and a mane collar on a small round body and short legs, with long whip arms raising a dead
// branch overhead in both fists, ready to throw.
const cBody: Record<string, N> = {
  hip: [-0.02, 0.46, 0, 0.15], belly: [0.02, 0.6, 0, 0.17], chest: [0.06, 0.74, 0, 0.17], neck: [0.12, 0.86, 0, 0.12],
  l_hipj: [-0.02, 0.42, 0.11, 0.07], l_knee: [0.08, 0.24, 0.14, 0.05], l_foot: [0.04, 0.07, 0.14, 0.045],
};
const cArm = arm([[0.08, 0.8, 0.2], [0.0, 0.92, 0.38], [-0.04, 1.18, 0.46], [0.04, 1.48, 0.4], [0.12, 1.66, 0.24]], 12, 0.05, 0.03);
const starter = sheet("agropelter-starter", cBody, cArm, face([0.2, 1.08, 0], 1.75, { long: 1, wide: 1.15, ear: 1.25, earUp: 1.6, eye: 1.35, grin: 1.12 }), [
  legs([0.08, 0.06, 0.045], 0.2), ...feet(0.17, 0.06),
  ...fingers("l_hand", 0.08, 0.015, 100),
  // one dead branch across both fists, overhead, a twig or two still on it
  { kind: "horn", at: "l_hand", off: [0, 0, 0.14], dir: [0.05, 0.08, -1], len: 0.8, base: 0.05, tip_base: 0.042, curve: 6, material: "bark" },
  { kind: "horn", at: "l_hand", off: [0, 0.03, 0.04], dir: [0.15, 0.6, 1], len: 0.24, base: 0.02, tip_base: 0.008, curve: 20, material: "bark" },
  { kind: "horn", at: "l_hand", off: [0, 0.03, -0.34], dir: [-0.2, 0.7, -1], len: 0.2, base: 0.018, tip_base: 0.007, curve: -18, material: "bark" },
  ...mane(0.2),
], { blobs: [{ at: "belly", off: [0.01, 0.02, 0], r: [0.19, 0.22, 0.2] }] });

const dir = import.meta.dir;
if (process.argv.includes("--check")) {
  const app = join(dir, "..", "..");
  for (const id of IDS) {
    const glb = Bun.file(join(app, "public", "models", `${id}.glb`));
    if (!(await glb.exists())) { console.log(`-- ${id}: not built`); continue; }
    const model = await loadGlb(await glb.arrayBuffer(), id);
    const r = analyze(model.positions, model.indices, { resolution: 96 });
    const hasKids = new Array<boolean>(r.parents.length).fill(false);
    for (const p of r.parents) if (p >= 0) hasKids[p] = true;
    const tips: number[] = [];
    for (let j = 1; j < r.parents.length; j++) if (!hasKids[j]) tips.push(j);
    let height = 0;
    for (let i = 1; i < model.positions.length; i += 3) height = Math.max(height, model.positions[i]!);
    const found = feetOf(r, tips, height);
    console.log(`${found.length === 2 ? "ok" : "!!"} ${id}: ${model.triangles} tris, ${r.parents.length} joints, ${tips.length} tips, feet ${found.length}/2, ${height.toFixed(2)} m tall`);
  }
} else {
  for (const s of [cox, tryon, starter]) await Bun.write(join(dir, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
  console.log(`wrote ${IDS.join(", ")}`);
}
