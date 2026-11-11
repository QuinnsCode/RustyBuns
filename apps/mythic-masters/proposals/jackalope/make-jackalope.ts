// Three Jackalope directions, each from a reference (docs/shots-2026-11-11-jackalope/README.md):
// `bun proposals/jackalope/make-jackalope.ts` writes proposals/jackalope/jackalope-{statue,mount,starter}.json.
// Try one by copying it over beasts/jackalope.json and running `bun scripts/beasts.ts --render jackalope`.
// The picked one replaces beasts/jackalope.json; this folder is then deleted.
import { join } from "node:path";

type V = [number, number, number];
type N = [number, number, number, number];
type Part = Record<string, unknown>;
type Blob = { at: string; off: V; r: V; rot?: V };

const ABOUT = "The high plains: a jackrabbit with a pronghorn's antlers. Small, quick, and the antlers are the whole fight.";

const f4 = (x: number) => +x.toFixed(4);
const add = (a: V, b: V): V => [f4(a[0] + b[0]), f4(a[1] + b[1]), f4(a[2] + b[2])];
const mul = (a: V, k: number): V => [f4(a[0] * k), f4(a[1] * k), f4(a[2] * k)];
const flipZ = (a: V): V => [a[0], a[1], -a[2]];
const norm = (a: V): V => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };

/** Where a ray from `p` along `d` leaves the last of these ellipsoids: the skin it shows. */
function skin(ells: { c: V; r: V }[], p: V, d: V): V {
  let best = 0;
  for (const { c, r } of ells) {
    const q = [0, 1, 2].map((i) => (p[i]! - c[i]!) / r[i]!), e = [0, 1, 2].map((i) => d[i]! / r[i]!);
    const a = e.reduce((s, x) => s + x * x, 0), b = q.reduce((s, x, i) => s + x * e[i]!, 0), cc = q.reduce((s, x) => s + x * x, 0) - 1;
    const disc = b * b - a * cc;
    if (disc >= 0) best = Math.max(best, (-b + Math.sqrt(disc)) / a);
  }
  return [p[0] + d[0] * best, p[1] + d[1] * best, p[2] + d[2] * best];
}

type HeadOpts = {
  k: number;                 // size of the whole head
  eye?: number;              // eye size
  ear?: [number, number];    // ear length and width, metres before k
  earDir?: V;
  antler?: { len: number; base: number; dir: V; curve: number; tines: [number, V, number][] };
};

/** A hare's head on a node at `h`: round flesh (a cranium, a blunt muzzle, puffed cheeks), a big dark eye high on the side
 *  ringed pale with a glint, a pink nose with the split lip and two incisors under it, tall ears behind the antlers, and
 *  a pair of branching antlers rising off the crown on a knobbed burr. Every face part sits on the blobs' skin. */
function head(h: V, o: HeadOpts) {
  const k = o.k, E = o.eye ?? 1;
  const cran = { c: [0, 0.01, 0] as V, r: [0.085, 0.072, 0.07] as V };
  const muz = { c: [0.06, -0.022, 0] as V, r: [0.05, 0.044, 0.046] as V };
  const cheek = { c: [0.03, -0.03, 0.035] as V, r: [0.045, 0.038, 0.035] as V };
  const ells = [cran, muz, cheek, { c: flipZ(cheek.c), r: cheek.r }];
  const on = (p: V, d: V, sink = 0): V => {
    const s = skin(ells, p, d), n = norm(d);
    return mul([s[0] - n[0] * sink, s[1] - n[1] * sink, s[2] - n[2] * sink], k);
  };
  const r = (x: number) => f4(x * k);
  const nodes: Record<string, N> = {
    head: [...h, r(0.07)] as N,
    snout: [...add(h, mul([0.07, -0.02, 0], k)), r(0.04)] as N,
  };
  const blobs: Blob[] = ells.map((e) => ({ at: "head", off: mul(e.c, k), r: mul(e.r, k) }));
  const eyeDir = norm([0.35, 0.18, 1]);
  const eyeAt = on([0.015, 0.018, 0.02], eyeDir, 0.018 * E);
  const glint = add(eyeAt, mul(add(mul(eyeDir, 0.017 * E), [0.006 * E, 0.008 * E, 0]), k));
  const noseAt = on([0.07, -0.005, 0], [1, 0.25, 0], 0.006);
  const lipAt = on([0.07, -0.035, 0], [1, -0.15, 0], 0.004);
  const [earLen, earW] = o.ear ?? [0.24, 0.055];
  const a = o.antler ?? { len: 0.24, base: 0.016, dir: [0.05, 1, 0.45] as V, curve: 45, tines: [[0.4, [0.8, 1, 0.1], 0.09], [0.72, [-0.3, 1, 0.2], 0.07]] as [number, V, number][] };
  const burr = on([0.0, 0.03, 0.018], [0.05, 1, 0.3], 0.006);
  const parts: Part[] = [
    // the eye: a pale ring, the dark eye standing out of it, a glint up front
    { kind: "eye", at: "head", off: on([0.015, 0.018, 0.02], eyeDir, 0.022 * E), r: r(0.026 * E), mirror: true, material: "ring" },
    { kind: "eye", at: "head", off: eyeAt, r: r(0.023 * E), mirror: true, material: "eye" },
    { kind: "eye", at: "head", off: glint, r: r(0.0045 * E), mirror: true, material: "glint" },
    // nose, nostrils, the split lip and the two front teeth
    { kind: "eye", at: "head", off: noseAt, r: r(0.014), material: "nose" },
    { kind: "eye", at: "head", off: add(noseAt, mul([0.002, -0.004, 0.009], k)), r: r(0.005), mirror: true, material: "dark" },
    { kind: "ridge", at: "head", off: add(noseAt, mul([0.002, -0.012, 0], k)), dir: [0, -1, 0], len: r(0.01), base: r(0.0025), material: "dark" },
    { kind: "horn", at: "head", off: add(lipAt, mul([-0.004, 0, 0.005], k)), dir: [0.15, -1, 0], len: r(0.016), base: r(0.0045), tip_base: r(0.004), flat: 0.45, bend: [1, 0, 0], mirror: true, material: "tooth" },
    // ears: the furred back, the pale inside laid just in front of it, a dark tip
    { kind: "ear", at: "head", off: on([-0.04, 0.035, 0.042], [-0.3, 1, 0.6], 0.01), dir: o.earDir ?? [-0.25, 1, 0.3], len: r(earLen), width: r(earW), tilt: 14, cup: 22, mirror: true, material: "fur" },
    { kind: "ear", at: "head", off: add(on([-0.04, 0.035, 0.042], [-0.3, 1, 0.6], 0.01), mul([0.007, 0.01, 0], k)), dir: o.earDir ?? [-0.25, 1, 0.3], len: r(earLen * 0.85), width: r(earW * 0.62), tilt: 14, cup: 26, mirror: true, material: "inner" },
    // antlers: a knobbed burr, then a beam that sweeps up, out and forward, tines rising off it
    { kind: "eye", at: "head", off: burr, r: r(a.base * 1.5), mirror: true, material: "antler" },
    { kind: "horn", at: "head", off: burr, dir: a.dir, len: r(a.len), base: r(a.base), tip_base: r(a.base * 0.15), curve: a.curve, bend: [1, 0.2, 0], mirror: true, material: "antler",
      tines: a.tines.map(([t, d, l]) => [t, d, r(l)]) },
  ];
  return { nodes, parts, blobs };
}

/** Fur in a second colour: the pale bib and belly, as a chain just under the skin that `paint` colours by. */
const SPINE_LINKS = (spine: string[]) => spine.slice(1).map((n, i) => [spine[i]!, n]);

const PAL = (fur: number[], extra: Record<string, number[]> = {}) => ({
  fur, belly: [0.93, 0.9, 0.84, 0.95, 0], bib: [0.95, 0.93, 0.88, 0.95, 0], tail: [0.97, 0.95, 0.9, 0.95, 0],
  antler: [0.55, 0.4, 0.26, 0.6, 0], eye: [0.06, 0.04, 0.03, 0.15, 0], glint: [1, 1, 1, 0.1, 0], ring: [0.9, 0.85, 0.74, 0.9, 0],
  nose: [0.78, 0.5, 0.48, 0.6, 0], inner: [0.86, 0.68, 0.62, 0.8, 0], tooth: [0.96, 0.94, 0.86, 0.3, 0],
  dark: [0.05, 0.04, 0.04, 0.6, 0], sock: [0.9, 0.87, 0.8, 0.95, 0], claw: [0.2, 0.17, 0.15, 0.5, 0], ...extra,
});

function sheet(id: string, nodes: Record<string, N>, links: string[][], blobs: Blob[], parts: Part[], o: { palette: Record<string, number[]>; paint?: unknown[]; budget?: number }) {
  return {
    id, name: "Jackalope", about: ABOUT, archetype: "skirmisher", feet: 4, budget: o.budget ?? 5600, root: "belly", material: "fur",
    palette: o.palette, nodes, links, blobs, parts, belly: "belly", belly_turn: -0.3, blend: 0.009, ...(o.paint ? { paint: o.paint } : {}),
  };
}

const paws = (front: number, hind: number): Part[] => [
  { kind: "foot", at: "l_ffoot", form: "paw", len: front, width: front * 0.8, toes: 4, claw: f4(front * 0.25), sole: 0.012, mirror: true, material: "sock" },
  { kind: "foot", at: "l_hfoot", form: "paw", len: hind, width: hind * 0.55, toes: 4, claw: f4(hind * 0.15), sole: 0.012, mirror: true, material: "sock" },
];

/** Both sides of a blob on an `l_` node. */
const pair = (at: string, off: V, r: V, rot?: V): Blob[] => [
  { at, off, r, ...(rot ? { rot } : {}) },
  { at: at.replace(/^l_/, "r_"), off: flipZ(off), r, ...(rot ? { rot: [-rot[0], -rot[1], rot[2]] as V } : {}) },
];

// A: the Douglas, Wyoming statue. Sitting up tall on folded haunches, a pale bib down the chest, the head held high on
// a short neck, huge upright ears, and a pair of forked antlers sweeping up and forward.
function statue() {
  const H: V = [0.12, 0.62, 0];
  const hd = head(H, { k: 1.05, eye: 1.1, ear: [0.25, 0.06], antler: { len: 0.28, base: 0.024, dir: [0.12, 1, 0.35], curve: 50, tines: [[0.42, [0.9, 1, 0.05], 0.13], [0.75, [-0.2, 1, 0.25], 0.09]] } });
  const nodes: Record<string, N> = {
    tail: [-0.2, 0.12, 0, 0.04], hip: [-0.08, 0.17, 0, 0.1], belly: [0, 0.26, 0, 0.11], chest: [0.05, 0.39, 0, 0.09], neck: [0.09, 0.51, 0, 0.06],
    ...hd.nodes,
    bib1: [0.12, 0.42, 0, 0.05], bib2: [0.11, 0.3, 0, 0.05],
    l_shoulder: [0.08, 0.36, 0.05, 0.04], l_elbow: [0.14, 0.2, 0.05, 0.028], l_ffoot: [0.17, 0.035, 0.045, 0.022],
    l_hip: [-0.07, 0.16, 0.11, 0.06], l_hock: [-0.15, 0.04, 0.14, 0.03], l_hfoot: [0.05, 0.03, 0.16, 0.022],
  };
  const links = [...SPINE_LINKS(["tail", "hip", "belly", "chest", "neck", "head", "snout"]), ["chest", "bib1"], ["bib1", "bib2"],
    ["chest", "l_shoulder"], ["l_shoulder", "l_elbow"], ["l_elbow", "l_ffoot"], ["hip", "l_hip"], ["l_hip", "l_hock"], ["l_hock", "l_hfoot"]];
  const blobs: Blob[] = [
    { at: "belly", off: [-0.01, -0.04, 0], r: [0.15, 0.15, 0.13] },
    { at: "chest", off: [0.0, 0, 0], r: [0.11, 0.15, 0.11], rot: [0, 0, -15] },
    { at: "neck", off: [0, 0, 0], r: [0.07, 0.08, 0.065] },
    // the folded haunch, and the long hind foot lying flat on the ground in front of it
    ...pair("l_hip", [-0.01, 0.01, 0], [0.14, 0.13, 0.07]),
    ...pair("l_hock", [0.07, -0.005, 0], [0.11, 0.028, 0.035]),
    // the front legs, straight and slim
    ...pair("l_shoulder", [0.01, -0.05, 0], [0.04, 0.08, 0.035]),
    ...pair("l_elbow", [0.005, -0.07, 0], [0.026, 0.085, 0.024]),
    ...hd.blobs,
  ];
  const parts: Part[] = [...hd.parts, ...paws(0.045, 0.06),
    { kind: "eye", at: "tail", off: [-0.02, 0.02, 0], r: 0.045, material: "tail" }];
  const paint = [{ nodes: ["bib1", "bib2"], material: "bib" }, { nodes: ["l_ffoot", "l_hfoot"], material: "sock" }];
  return sheet("jackalope", nodes, links, blobs, parts, { palette: PAL([0.47, 0.46, 0.45, 0.9, 0], { antler: [0.5, 0.28, 0.16, 0.55, 0] }), paint });
}

// B: the crouched hare of the period plates (Hoefnagel, and the eighteenth-century "lievre cornu") and the mounted heads:
// a long low body with the back arched over a big haunch, the head carried forward, ears up behind thick
// many-tined antlers, brown agouti fur over a white belly.
function mount() {
  const H: V = [0.34, 0.37, 0];
  const hd = head(H, { k: 1, eye: 1, ear: [0.23, 0.055], earDir: [-0.55, 1, 0.35], antler: { len: 0.32, base: 0.026, dir: [-0.1, 1, 0.4], curve: 60, tines: [[0.28, [1, 0.8, 0.1], 0.12], [0.52, [0.4, 1, -0.1], 0.13], [0.78, [0.6, 1, 0.3], 0.09]] } });
  const nodes: Record<string, N> = {
    tail: [-0.3, 0.2, 0, 0.04], hip: [-0.17, 0.22, 0, 0.11], belly: [0, 0.25, 0, 0.12], chest: [0.16, 0.24, 0, 0.09], neck: [0.26, 0.3, 0, 0.06],
    ...hd.nodes,
    bib1: [0.2, 0.2, 0, 0.03], bib2: [0.0, 0.15, 0, 0.03],
    l_shoulder: [0.17, 0.2, 0.06, 0.04], l_elbow: [0.21, 0.1, 0.07, 0.026], l_ffoot: [0.24, 0.035, 0.07, 0.02],
    l_hip: [-0.16, 0.2, 0.1, 0.06], l_hock: [-0.25, 0.04, 0.12, 0.03], l_hfoot: [-0.05, 0.03, 0.13, 0.022],
  };
  const links = [...SPINE_LINKS(["tail", "hip", "belly", "chest", "neck", "head", "snout"]), ["belly", "bib2"], ["bib2", "bib1"],
    ["chest", "l_shoulder"], ["l_shoulder", "l_elbow"], ["l_elbow", "l_ffoot"], ["hip", "l_hip"], ["l_hip", "l_hock"], ["l_hock", "l_hfoot"]];
  const blobs: Blob[] = [
    { at: "belly", off: [0, 0.02, 0], r: [0.24, 0.13, 0.12] },
    { at: "hip", off: [-0.02, 0.03, 0], r: [0.13, 0.14, 0.12] },
    { at: "chest", off: [0, 0, 0], r: [0.11, 0.11, 0.095] },
    { at: "neck", off: [0, 0, 0], r: [0.07, 0.07, 0.06], rot: [0, 0, 30] },
    ...pair("l_hip", [0, 0, 0], [0.14, 0.12, 0.065]),
    ...pair("l_hock", [0.08, -0.005, 0], [0.12, 0.026, 0.033]),
    ...pair("l_shoulder", [0.015, -0.04, 0], [0.035, 0.07, 0.03]),
    ...pair("l_elbow", [0.012, -0.04, 0], [0.024, 0.06, 0.022]),
    ...hd.blobs,
  ];
  const parts: Part[] = [...hd.parts, ...paws(0.045, 0.06),
    { kind: "eye", at: "tail", off: [-0.01, 0.03, 0], r: 0.04, material: "tail" }];
  const paint = [{ nodes: ["bib1", "bib2"], material: "belly" }, { nodes: ["l_ffoot", "l_hfoot"], material: "sock" }];
  return sheet("jackalope", nodes, links, blobs, parts, {
    palette: PAL([0.55, 0.43, 0.3, 0.9, 0], { antler: [0.72, 0.63, 0.5, 0.6, 0] }), paint,
  });
}

// C: the starter. The same sitting hare as the statue, but the head is near half its height, the eyes big and bright,
// the body a soft round bun on short legs with big hind feet, and the antlers short, thick and forked.
function starter() {
  const H: V = [0.08, 0.5, 0];
  const hd = head(H, { k: 1.75, eye: 1.35, ear: [0.17, 0.05], earDir: [-0.2, 1, 0.4], antler: { len: 0.17, base: 0.02, dir: [0.15, 1, 0.35], curve: 45, tines: [[0.4, [1, 1, 0], 0.1], [0.75, [-0.3, 1, 0.3], 0.07]] } });
  const nodes: Record<string, N> = {
    tail: [-0.2, 0.12, 0, 0.04], hip: [-0.08, 0.15, 0, 0.1], belly: [0, 0.2, 0, 0.11], chest: [0.04, 0.29, 0, 0.09], neck: [0.06, 0.37, 0, 0.06],
    ...hd.nodes,
    bib1: [0.11, 0.3, 0, 0.03], bib2: [0.1, 0.17, 0, 0.03],
    l_shoulder: [0.08, 0.25, 0.05, 0.04], l_elbow: [0.13, 0.13, 0.05, 0.03], l_ffoot: [0.16, 0.035, 0.045, 0.024],
    l_hip: [-0.06, 0.13, 0.11, 0.06], l_hock: [-0.14, 0.04, 0.15, 0.035], l_hfoot: [0.06, 0.035, 0.17, 0.026],
  };
  const links = [...SPINE_LINKS(["tail", "hip", "belly", "chest", "neck", "head", "snout"]), ["chest", "bib1"], ["bib1", "bib2"],
    ["chest", "l_shoulder"], ["l_shoulder", "l_elbow"], ["l_elbow", "l_ffoot"], ["hip", "l_hip"], ["l_hip", "l_hock"], ["l_hock", "l_hfoot"]];
  const blobs: Blob[] = [
    { at: "belly", off: [0, -0.02, 0], r: [0.16, 0.15, 0.14] },
    { at: "chest", off: [0, 0, 0], r: [0.11, 0.12, 0.11] },
    ...pair("l_hip", [0, 0.01, 0], [0.13, 0.12, 0.07]),
    ...pair("l_hock", [0.09, 0, 0], [0.12, 0.034, 0.045]),
    ...pair("l_shoulder", [0.01, -0.05, 0], [0.042, 0.07, 0.04]),
    ...pair("l_elbow", [0.005, -0.05, 0], [0.032, 0.065, 0.03]),
    ...hd.blobs,
  ];
  const parts: Part[] = [...hd.parts, ...paws(0.05, 0.07),
    { kind: "eye", at: "tail", off: [-0.02, 0.02, 0], r: 0.05, material: "tail" }];
  const paint = [{ nodes: ["bib1", "bib2"], material: "bib" }, { nodes: ["l_ffoot", "l_hfoot"], material: "sock" }];
  return sheet("jackalope", nodes, links, blobs, parts, { palette: PAL([0.68, 0.53, 0.37, 0.9, 0], { antler: [0.62, 0.44, 0.28, 0.55, 0] }), paint });
}

const dir = import.meta.dir;
for (const [name, s] of [["statue", statue()], ["mount", mount()], ["starter", starter()]] as const)
  await Bun.write(join(dir, `jackalope-${name}.json`), JSON.stringify(s, null, 1) + "\n");
console.log("wrote proposals/jackalope/jackalope-{statue,mount,starter}.json");
