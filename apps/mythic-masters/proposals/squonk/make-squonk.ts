// Three Squonk directions, each from a reference (README.md here): `bun proposals/squonk/make-squonk.ts` writes
// proposals/squonk/squonk-{cox,tryon,starter}.json. Build one with
// `blender -b --factory-startup --python-exit-code 1 -t 8 -P blender/beast.py -- proposals/squonk/squonk-cox.json --render`.
// The picked one replaces beasts/squonk.json (id back to "squonk", its `about` kept); this folder is then deleted.
import { join } from "node:path";

type V = [number, number, number];
type N = [number, number, number, number];
type Part = Record<string, unknown>;
type Blob = { at: string; off: V; r: V };

const PALETTE = {
  skin: [0.64, 0.52, 0.56, 0.9, 0],
  belly: [0.78, 0.68, 0.68, 0.9, 0],
  mole: [0.3, 0.2, 0.24, 0.85, 0],
  lip: [0.6, 0.44, 0.48, 0.75, 0],
  mouth: [0.16, 0.04, 0.07, 0.6, 0],
  white: [0.92, 0.9, 0.84, 0.3, 0],
  eye: [0.08, 0.06, 0.1, 0.2, 0],
  tear: [0.45, 0.78, 1, 0.1, 0, 1.6],
  claw: [0.3, 0.24, 0.24, 0.5, 0],
  dark: [0.06, 0.03, 0.04, 0.6, 0],
};

const f4 = (x: number) => +x.toFixed(4);
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V, k: number): V => [f4(a[0] * k), f4(a[1] * k), f4(a[2] * k)];
const flipZ = (a: V): V => [a[0], a[1], -a[2]];

/** Where a ray from `p` along `d` leaves the last of these ellipsoids (all in one frame): the skin it shows. */
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

/** The weeping face on a head node at `h`, `k` times the base size: round flesh (a cranium, a soft pig-dog muzzle and
 *  two jowls sagging off it), big wet eyes with lids drooping at the outer corners under a worried brow raised in the
 *  middle, forehead wrinkles, an open frowning mouth with a heavy lower lip hanging off it, and a tear running down
 *  each cheek to a drop at the chin. Everything is placed on the blobs' skin, not floated at a guess. */
function face(h: V, k: number, o: { eye?: number; lip?: number; brow?: number } = {}) {
  const E = o.eye ?? 1;
  const cran = { c: [0, 0.02, 0] as V, r: [0.11, 0.1, 0.105] as V };
  const muz = { c: [0.085, -0.035, 0] as V, r: [0.075, 0.062, 0.07] as V };
  const jowl = { c: [0.05, -0.075, 0.06] as V, r: [0.06, 0.055, 0.045] as V };
  const ells = [cran, muz, jowl, { c: flipZ(jowl.c), r: jowl.r }];
  const on = (p: V, d: V, sink = 0): V => {
    const s = skin(ells, p, d), n = Math.hypot(...d);
    return mul([s[0] - (d[0] / n) * sink, s[1] - (d[1] / n) * sink, s[2] - (d[2] / n) * sink], k);
  };
  const r = (x: number) => f4(x * k);
  const nodes: Record<string, N> = {
    head: [...h, r(0.09)] as N,
    snout: [...add(h, mul([0.1, -0.035, 0], k)), r(0.05)] as N,
  };
  const blobs: Blob[] = ells.map((e) => ({ at: "head", off: mul(e.c, k), r: mul(e.r, k) }));
  const eyeAt = on([0.02, 0.035, 0.03], [0.75, 0.1, 0.65], 0.022 * E);
  const eyeDir: V = [0.85, 0.12, 0.5];
  const pupil = add(eyeAt, mul(eyeDir, 0.022 * E * k / Math.hypot(...eyeDir)));
  const mouthAt = on([0.06, -0.075, 0], [1, -0.15, 0], 0.012);
  const parts: Part[] = [
    // eyes: a big glossy white, a dark iris looking a little up and out, the lid sagging over its top and outer corner
    { kind: "eye", at: "head", off: eyeAt, r: r(0.034 * E), mirror: true, material: "white" },
    { kind: "eye", at: "head", off: pupil, r: r(0.022 * E), mirror: true, material: "eye" },
    { kind: "ridge", at: "head", off: add(eyeAt, mul([-0.004, 0.026 * E, -0.012], k)), dir: [0.25, -0.45, 1], len: r(0.07 * E), base: r(0.017 * E), curve: 40, bend: [0, -1, 0], mirror: true },
    // a puffy bag under each eye
    { kind: "ridge", at: "head", off: add(eyeAt, mul([0.008, -0.03 * E, -0.008], k)), dir: [0.1, 0.25, 1], len: r(0.055 * E), base: r(0.012 * E), curve: 30, bend: [0, 1, 0], mirror: true },
    // the worried brow: high over the nose, sloping down and out past the eye
    { kind: "ridge", at: "head", off: on([0.03, 0.085, 0.015], [0.8, 0.5, 0.1], 0.004), dir: [-0.25, -0.55 * (o.brow ?? 1), 1], len: r(0.1), base: r(0.016), curve: 25, bend: [0, -1, 0], mirror: true },
    // nostrils on the end of the muzzle
    { kind: "eye", at: "head", off: on([0.1, -0.01, 0.025], [1, 0.1, 0.15], 0.003), r: r(0.011), mirror: true, material: "dark" },
    // the open mouth: a dark frown wrapping round the muzzle, ends turned down, and the lower lip hanging off it
    { kind: "eye", at: "head", off: mouthAt, r: r(0.028 * (o.lip ?? 1)), material: "mouth" },
    { kind: "ridge", at: "head", off: mouthAt, dir: [-0.3, -0.45, 1], len: r(0.095), base: r(0.019), curve: 45, bend: [-1, -0.6, 0], mirror: true, material: "mouth" },
    { kind: "ridge", at: "head", off: add(mouthAt, mul([0.006, -0.028 * (o.lip ?? 1), 0], k)), dir: [-0.3, -0.25, 1], len: r(0.085 * (o.lip ?? 1)), base: r(0.022 * (o.lip ?? 1)), curve: 50, bend: [-1, -0.3, 0], mirror: true, material: "lip" },
    // the tears: a wet streak from the eye's lower corner down the cheek, a drop at the jowl, one falling under the chin
    { kind: "ridge", at: "head", off: on([0.045, 0.005 - 0.01 * E, 0.045], [0.65, -0.1, 0.75], 0.006), dir: [0.2, -1, 0.25], len: r(0.12), base: r(0.015), curve: 20, bend: [1, 0, 0.3], mirror: true, material: "tear" },
    { kind: "eye", at: "head", off: on([0.06, -0.12, 0.07], [0.5, -0.6, 0.6], 0.002), r: r(0.014), mirror: true, material: "tear" },
    { kind: "eye", at: "head", off: add(on([0.05, -0.12, 0.05], [0.3, -1, 0.3], 0), mul([0, -0.025, 0], k)), r: r(0.011), mirror: true, material: "tear" },
  ];
  return { nodes, parts, blobs };
}

/** The body's flesh: a torso ellipsoid at `at` (offset `off`, radii `r`), then the ill-fitting skin over it: `rolls`
 *  loose folds ringing the back between `from` and `to` of the way along it (each a thin ellipsoid a little bigger
 *  than the torso there, so the skin stands in ridges), a sagging apron under the belly, and warts as small round
 *  lumps of the same skin at seeded spots over the back and flanks. */
function hide(at: string, off: V, r: V, o: { rolls: number; from?: number; to?: number; lift?: number; deep?: number; thick?: number; warts: number; wart?: number; seed?: number; apron?: number }) {
  const blobs: Blob[] = [{ at, off, r }];
  const from = o.from ?? -0.6, to = o.to ?? 0.7, deep = o.deep ?? 1;
  for (let i = 0; i < o.rolls; i++) {
    const u = from + ((to - from) * i) / Math.max(1, o.rolls - 1);
    const s = Math.sqrt(1 - u * u);
    const lift = (o.lift ?? 0.12) * s;
    blobs.push({ at, off: [f4(off[0] + u * r[0]), f4(off[1] + r[1] * lift), off[2]], r: [f4(r[0] * (o.thick ?? 0.085)), f4(r[1] * s * (1 + 0.05 * deep)), f4(r[2] * s * (1 + 0.1 * deep))] });
  }
  if (o.apron) blobs.push({ at, off: [f4(off[0] - r[0] * 0.05), f4(off[1] - r[1] * 0.55), off[2]], r: [f4(r[0] * 0.75), f4(r[1] * 0.5 * o.apron), f4(r[2] * 0.78)] });
  // warts: a golden-angle spiral over the upper body, seeded so it is the same every build
  let seed = o.seed ?? 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const moles: Part[] = [];
  for (let i = 0; i < o.warts; i++) {
    const u = -0.75 + 1.5 * rnd(), a = (0.15 + 0.7 * rnd()) * Math.PI, s = Math.sqrt(1 - u * u);
    const p: V = [f4(off[0] + u * r[0]), f4(off[1] + Math.sin(a) * s * r[1]), f4(off[2] + Math.cos(a) * s * r[2])];
    const w = f4((o.wart ?? 0.022) * (0.6 + 0.8 * rnd()));
    if (i % 3 === 2) moles.push({ kind: "eye", at, off: p, r: f4(w * 0.55), mirror: true, material: "mole" });
    else { blobs.push({ at, off: p, r: [w, w, w] }, { at, off: flipZ(p), r: [w, w, w] }); }
  }
  return { blobs, moles };
}

const SPINE = ["tail_tip", "tail", "hip", "belly", "chest", "neck", "head", "snout"];
const LINKS = [...SPINE.slice(1).map((n, i) => [SPINE[i]!, n]),
  ["chest", "l_shoulder"], ["l_shoulder", "l_elbow"], ["l_elbow", "l_ffoot"], ["hip", "l_hipj"], ["l_hipj", "l_knee"], ["l_knee", "l_bfoot"]];
const legs = (front: [N, N, N], back: [N, N, N]): Record<string, N> => ({
  l_shoulder: front[0], l_elbow: front[1], l_ffoot: front[2], l_hipj: back[0], l_knee: back[1], l_bfoot: back[2],
});
/** Thin bony legs lofted over the leg nodes, and long splayed toes: the plates' feet, not hooves or pads. */
const limbs = (front: number[], back: number[], toe: number, sole: number, form: "talon" | "paw" = "talon"): Part[] => [
  { kind: "limb", along: ["l_shoulder", "l_elbow", "l_ffoot"], radii: front, depth: 1.1, calf: 0.12, mirror: true },
  { kind: "limb", along: ["l_hipj", "l_knee", "l_bfoot"], radii: back, depth: 1.15, calf: 0.18, mirror: true },
  { kind: "foot", at: "l_ffoot", form, len: toe, width: toe * 0.9, toes: form === "talon" ? 4 : 3, spread: 22, claw: f4(toe * 0.35), sole, mirror: true },
  { kind: "foot", at: "l_bfoot", form, len: toe * 1.05, width: toe * 0.9, toes: form === "talon" ? 4 : 3, spread: 22, claw: f4(toe * 0.35), sole, mirror: true },
];
/** A short tail curling up over the rump. */
const tail = (len: number, base: number): Part => ({ kind: "horn", at: "tail", dir: [-1, 0.5, 0], len, base, tip_base: f4(base * 0.35), curve: 260, bend: [0, 1, 0], material: "skin" });
/** The loose fold of skin hanging off each side of the head and neck, like a hood a size too big (the 1910 plate). */
const hood = (at: string, off: V, len: number, width: number): Part => ({ kind: "ear", at, off, dir: [0.15, -1, 0.35], len, width, tilt: 12, cup: 18, mirror: true, material: "skin" });

function sheet(id: string, about: string, body: Record<string, N>, f: ReturnType<typeof face>, h: ReturnType<typeof hide>, parts: Part[], o: { budget?: number; blend?: number; colours?: Record<string, number[]> } = {}) {
  return {
    id, name: "Squonk", about, archetype: "skirmisher", feet: 4, budget: o.budget ?? 5200, root: "belly", material: "skin",
    palette: { ...PALETTE, ...o.colours }, nodes: { ...body, ...f.nodes }, links: LINKS, blobs: [...h.blobs, ...f.blobs],
    parts: [...f.parts, ...h.moles, ...parts], belly: "belly", belly_turn: -0.35, blend: o.blend ?? 0.011,
  };
}

// A: the 1910 plate (Cox, drawn by Du Bois). Hunched and high-backed, its loose hide hanging in rings of folds like a
// coat a size too big, a fold of skin draped beside the head, the face carried low and forward with a sorry eye and
// a slack open mouth, thin bony legs on long splayed toes, and a little curled tail.
const aBody: Record<string, N> = {
  tail_tip: [-0.5, 0.5, 0, 0.02], tail: [-0.42, 0.44, 0, 0.04],
  hip: [-0.3, 0.42, 0, 0.1], belly: [-0.06, 0.48, 0, 0.13], chest: [0.16, 0.45, 0, 0.12], neck: [0.3, 0.38, 0, 0.09],
  ...legs([[0.17, 0.36, 0.1, 0.035], [0.22, 0.2, 0.12, 0.025], [0.24, 0.045, 0.13, 0.02]],
          [[-0.28, 0.38, 0.1, 0.04], [-0.17, 0.22, 0.13, 0.028], [-0.3, 0.045, 0.14, 0.02]]),
};
const cox = sheet("squonk-cox", "The 1910 plate: hunched, its loose hide hanging in folds, a skin hood by the face, a slack sorry mouth, thin legs on long toes.",
  aBody, face([0.41, 0.33, 0], 1.12, { lip: 1.15 }), hide("belly", [0.02, 0.0, 0], [0.33, 0.19, 0.18], { rolls: 9, from: -0.7, to: 0.72, lift: 0.1, warts: 12, wart: 0.018, apron: 1 }), [
    ...limbs([0.034, 0.024, 0.018], [0.05, 0.03, 0.02], 0.09, 0.045),
    tail(0.12, 0.03),
    hood("neck", [0.03, 0.05, 0.1], 0.27, 0.1),
  ]);

// B: the 1939 drawing (Tryon). The same weeping thing sat up on stiff front legs, chest high and head raised, warts and
// lumps all over a pale hide, pointed ears standing up like horns, the mouth wide open in a wail and the brow knotted.
const bBody: Record<string, N> = {
  tail_tip: [-0.44, 0.2, 0, 0.02], tail: [-0.36, 0.24, 0, 0.04],
  hip: [-0.24, 0.3, 0, 0.12], belly: [-0.04, 0.42, 0, 0.14], chest: [0.12, 0.47, 0, 0.13], neck: [0.2, 0.55, 0, 0.1],
  ...legs([[0.15, 0.4, 0.11, 0.035], [0.19, 0.22, 0.13, 0.026], [0.22, 0.045, 0.14, 0.02]],
          [[-0.2, 0.26, 0.12, 0.05], [-0.06, 0.16, 0.16, 0.035], [-0.16, 0.045, 0.16, 0.022]]),
};
const tryon = sheet("squonk-tryon", "The 1939 drawing: sat up and wailing, pale and warty all over, pointed ears up like horns, a knotted brow.",
  bBody, face([0.27, 0.63, 0], 1.0, { lip: 1.35, brow: 1.4 }), hide("belly", [0.02, 0.04, 0], [0.26, 0.24, 0.18], { rolls: 5, from: -0.5, to: 0.6, lift: 0.05, warts: 26, wart: 0.036, seed: 11, apron: 0.8 }), [
    ...limbs([0.04, 0.03, 0.024], [0.07, 0.045, 0.026], 0.08, 0.045),
    tail(0.1, 0.028),
    { kind: "ear", at: "head", off: [-0.03, 0.08, 0.07], dir: [-0.25, 1, 0.35], len: 0.12, width: 0.045, tilt: 8, cup: 25, mirror: true, material: "skin" },
  ], { colours: { skin: [0.74, 0.66, 0.62, 0.9, 0], belly: [0.84, 0.78, 0.72, 0.9, 0] } });

// C: a starter. Big head on a small round body so it reads at fight size: the head near half the beast, eyes huge and
// brimming, the lip hanging, two fat hoods of skin like a basset's ears, three deep rolls round a saggy body, stubby
// legs and the curled tail.
const cBody: Record<string, N> = {
  tail_tip: [-0.36, 0.34, 0, 0.02], tail: [-0.3, 0.3, 0, 0.04],
  hip: [-0.2, 0.28, 0, 0.1], belly: [-0.04, 0.3, 0, 0.13], chest: [0.1, 0.32, 0, 0.12], neck: [0.2, 0.36, 0, 0.1],
  ...legs([[0.1, 0.22, 0.1, 0.035], [0.13, 0.12, 0.12, 0.03], [0.14, 0.04, 0.12, 0.025]],
          [[-0.18, 0.22, 0.1, 0.04], [-0.14, 0.12, 0.12, 0.03], [-0.17, 0.04, 0.12, 0.025]]),
};
const starter = sheet("squonk-starter", "A starter: a big weeping head on a little saggy body, huge brimming eyes, a hanging lip, basset hoods, three rolls.",
  cBody, face([0.34, 0.42, 0], 1.55, { eye: 1.25, lip: 1.2 }), hide("belly", [0, 0, 0], [0.24, 0.16, 0.17], { rolls: 4, from: -0.55, to: 0.55, lift: 0.08, warts: 9, wart: 0.02, seed: 5, apron: 1.1 }), [
    ...limbs([0.05, 0.04, 0.032], [0.06, 0.045, 0.032], 0.075, 0.04, "paw"),
    tail(0.1, 0.03),
    hood("head", [-0.05, -0.02, 0.13], 0.22, 0.09),
  ], { colours: { skin: [0.7, 0.54, 0.6, 0.9, 0] } });

/** The sculpted face (the owner's reference, a pale clay Squonk), all one flesh: a round head with a short muzzle, a
 *  ring of thick lid flesh on each side with a huge glossy dark-red eye set down inside it, a heavy brow over it and a
 *  cheek fold under it, a pink upturned bulb of a nose and a pout (a thin upper lip, a full lower one sagging at the
 *  corners) made of blobs so the skin runs into them, long flat ears drooping past the jaw, and freckles on the crown.
 *  The nose and lips are coloured by painting their nodes. */
function sculptFace(h: V, k: number) {
  const cran = { c: [0, 0.012, 0] as V, r: [0.1, 0.095, 0.094] as V };
  const muz = { c: [0.068, -0.035, 0] as V, r: [0.062, 0.056, 0.06] as V };
  const ells = [cran, muz];
  const on = (p: V, d: V, sink = 0): V => {
    const s = skin(ells, p, d), n = Math.hypot(...d);
    return [s[0] - (d[0] / n) * sink, s[1] - (d[1] / n) * sink, s[2] - (d[2] / n) * sink];
  };
  const r = (x: number) => f4(x * k);
  const blobs: Blob[] = ells.map((e) => ({ at: "head", off: mul(e.c, k), r: mul(e.r, k) }));
  const both = (off: V, rr: V) => { blobs.push({ at: "head", off: mul(off, k), r: mul(rr, k) }, { at: "head", off: mul(flipZ(off), k), r: mul(rr, k) }); };
  // the eye: where it sits on the skull, looking out to the side and a little forward, ringed by lid flesh
  const ER = 0.042;
  const dir: V = [0.4, 0.08, 1];
  const n0 = Math.hypot(...dir), nrm: V = [dir[0] / n0, dir[1] / n0, dir[2] / n0];
  const surf = on([0.035, 0.02, 0.03], nrm, 0);
  const eye: V = [surf[0] + nrm[0] * ER * 0.05, surf[1] + nrm[1] * ER * 0.05, surf[2] + nrm[2] * ER * 0.05];
  const u: V = [0, 1, 0], v: V = [nrm[2], 0, -nrm[0]];  // up, and forward across the eye (unit: nrm has no big y)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * 2 * Math.PI, top = Math.max(0, Math.sin(a));
    const R = ER * 1.0, w = ER * (0.42 + 0.12 * top);
    const p: V = [eye[0] + (v[0] * Math.cos(a) + u[0] * Math.sin(a)) * R - nrm[0] * ER * 0.12,
                  eye[1] + (v[1] * Math.cos(a) + u[1] * Math.sin(a)) * R - nrm[1] * ER * 0.12,
                  eye[2] + (v[2] * Math.cos(a) + u[2] * Math.sin(a)) * R - nrm[2] * ER * 0.12];
    both(p, [w, w, w]);
  }
  both([eye[0] - 0.01, eye[1] + ER * 1.2, eye[2] - 0.014], [ER * 0.9, ER * 0.32, ER * 0.5]);  // the brow
  both([eye[0] + 0.01, eye[1] - ER * 1.45, eye[2] - 0.006], [ER * 0.85, ER * 0.3, ER * 0.45]);  // the cheek fold
  // the nose: an upturned bulb on the end of the muzzle; the pout under it
  const noseAt = on([0.07, -0.005, 0], [1, 0.35, 0], 0.012);
  blobs.push({ at: "head", off: mul(noseAt, k), r: mul([0.032, 0.03, 0.034], k) });
  const lip = on([0.06, -0.062, 0], [1, -0.1, 0], 0.008);
  blobs.push({ at: "head", off: mul([lip[0], lip[1] + 0.012, 0], k), r: mul([0.016, 0.008, 0.038], k) });  // upper lip
  blobs.push({ at: "head", off: mul([lip[0] + 0.004, lip[1] - 0.008, 0], k), r: mul([0.02, 0.014, 0.03], k) });  // lower lip
  both([lip[0] - 0.006, lip[1] - 0.012, 0.028], [0.016, 0.012, 0.018]);  // its corners, sagging
  const nodes: Record<string, N> = {
    head: [...h, r(0.09)] as N,
    snout: [...add(h, mul([0.07, -0.035, 0], k)), r(0.05)] as N,
    nose: [...add(h, mul(noseAt, k)), r(0.02)] as N,
    lip: [...add(h, mul([lip[0], lip[1] - 0.004, 0], k)), r(0.015)] as N,
  };
  const freckles: Part[] = [[-0.01, 0.1, 0.03], [0.02, 0.095, 0.04], [-0.04, 0.09, 0.05], [0.0, 0.08, 0.062], [-0.03, 0.1, 0.015], [-0.06, 0.07, 0.06]]
    .map((p) => ({ kind: "eye", at: "head", off: mul(on(p as V, [0, 1, 0.4], 0.0015), k), r: r(0.0032), mirror: true, material: "freckle" }));
  const parts: Part[] = [
    { kind: "eye", at: "head", off: mul(eye, k), r: r(ER), mirror: true, material: "eye" },
    { kind: "eye", at: "head", off: mul(add(noseAt, [0.024, -0.008, 0.012]), k), r: r(0.0065), mirror: true, material: "dark" },
    { kind: "ear", at: "head", off: mul(on([-0.045, 0.05, 0.05], [-0.1, 0.6, 1], 0.01), k), dir: [-0.05, -1, 0.4], len: r(0.22), width: r(0.06), tilt: 12, cup: 12, mirror: true, material: "skin" },
    ...freckles,
  ];
  return { nodes, parts, blobs };
}

/** A leg of one flesh with the body: a thick thigh, a knee (or elbow) knob, a tapering shin with three wrinkle rings at
 *  the ankle, a soft foot pad, four fat toes and a pale nail on each. `top`, `mid`, `foot` are the leg's l_ nodes; the
 *  blobs go on both sides (the r_ twins), the nails mirror. */
function fleshLeg(body: Record<string, N>, top: string, mid: string, foot: string, s: number) {
  const blobs: Blob[] = [], nails: Part[] = [];
  const at = (n: string) => body[n]!;
  const half = (a: N, b: N): V => [(b[0] - a[0]) / 2, (b[1] - a[1]) / 2, (b[2] - a[2]) / 2];
  const push = (n: string, off: V, rr: V) => { blobs.push({ at: n, off, r: rr }, { at: "r_" + n.slice(2), off: flipZ(off), r: rr }); };
  const t = at(top), m = at(mid), f = at(foot);
  push(top, half(t, m), [0.072 * s, 0.085 * s, 0.066 * s]);
  push(mid, [0, 0, 0], [0.056 * s, 0.05 * s, 0.054 * s]);
  push(mid, half(m, f), [0.046 * s, 0.065 * s, 0.044 * s]);
  for (const [y, w] of [[0.03, 1.06], [0.045, 1.08], [0.06, 1.05]] as const) push(foot, [0, y - f[1] + 0.015, 0], [0.043 * s * w, 0.006, 0.041 * s * w]);
  push(foot, [0.02, 0.025 - f[1], 0], [0.058 * s, 0.026, 0.05 * s]);
  for (const z of [-0.033, -0.011, 0.011, 0.033]) {
    const tz = z * s * (1 + Math.abs(z) * 3);
    push(foot, [0.07 * s, 0.016 - f[1], tz], [0.032 * s, 0.017, 0.015 * s]);
    nails.push({ kind: "eye", at: foot, off: [f4(0.1 * s), f4(0.016 - f[1]), f4(tz)], r: f4(0.01 * s), mirror: true, material: "nail" });
  }
  return { blobs: blobs.map((b) => ({ ...b, off: b.off.map(f4) as V, r: b.r.map(f4) as V })), nails };
}

// D: the owner's reference, a sculpted Squonk. A short barrel of a body ringed all over in deep, even rolls from the neck
// to the rump, carried on stout legs of the same flesh with knees, ankle wrinkles and wide nailed toes; the head low and
// forward, the sculpted face above, no tail to speak of. Pale cream with pink at the nose, lips and toes. At a 9000
// triangle budget (the others keep 5200) so the rolls and the face come out smooth.
const dBody: Record<string, N> = {
  tail_tip: [-0.36, 0.3, 0, 0.02], tail: [-0.3, 0.31, 0, 0.04],
  hip: [-0.2, 0.32, 0, 0.1], belly: [0, 0.34, 0, 0.13], chest: [0.18, 0.31, 0, 0.12], neck: [0.3, 0.31, 0, 0.09],
  ...legs([[0.17, 0.32, 0.09, 0.03], [0.19, 0.16, 0.11, 0.025], [0.2, 0.045, 0.115, 0.022]],
          [[-0.19, 0.32, 0.09, 0.03], [-0.2, 0.16, 0.11, 0.025], [-0.22, 0.045, 0.115, 0.022]]),
};
const dFace = sculptFace([0.43, 0.31, 0], 1.4);
const fore = fleshLeg(dBody, "l_shoulder", "l_elbow", "l_ffoot", 1), hind = fleshLeg(dBody, "l_hipj", "l_knee", "l_bfoot", 1.08);
const sculptBase = sheet("squonk-sculpt", "The owner's reference, a sculpted Squonk: deep even rolls, one huge red eye a side, a pink pout, long drooping ears.",
  dBody, dFace, hide("belly", [0.0, 0.06, 0], [0.31, 0.21, 0.19], { rolls: 10, from: -0.82, to: 0.82, lift: 0.04, deep: 1.3, thick: 0.11, warts: 0 }),
  [...fore.nails, ...hind.nails], { budget: 9000, blend: 0.008, colours: {
    skin: [0.86, 0.83, 0.74, 0.8, 0], belly: [0.9, 0.84, 0.78, 0.8, 0], eye: [0.42, 0.02, 0.05, 0.1, 0],
    nose: [0.9, 0.68, 0.66, 0.6, 0], pout: [0.9, 0.74, 0.7, 0.7, 0], nail: [0.96, 0.86, 0.86, 0.4, 0], freckle: [0.55, 0.3, 0.22, 0.8, 0],
  } });
const sculpt = {
  ...sculptBase,
  links: [...sculptBase.links, ["snout", "nose"], ["snout", "lip"]],
  blobs: [...sculptBase.blobs, ...fore.blobs, ...hind.blobs],
  paint: [{ nodes: ["nose"], material: "nose" }, { nodes: ["lip"], material: "pout" }],
};

for (const s of [cox, tryon, starter, sculpt]) await Bun.write(join(import.meta.dir, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
console.log("wrote squonk-cox, squonk-tryon, squonk-starter, squonk-sculpt");
