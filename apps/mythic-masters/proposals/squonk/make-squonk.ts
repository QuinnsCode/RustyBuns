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
function hide(at: string, off: V, r: V, o: { rolls: number; from?: number; to?: number; lift?: number; warts: number; wart?: number; seed?: number; apron?: number }) {
  const blobs: Blob[] = [{ at, off, r }];
  const from = o.from ?? -0.6, to = o.to ?? 0.7;
  for (let i = 0; i < o.rolls; i++) {
    const u = from + ((to - from) * i) / Math.max(1, o.rolls - 1);
    const s = Math.sqrt(1 - u * u);
    const lift = (o.lift ?? 0.12) * s;
    blobs.push({ at, off: [f4(off[0] + u * r[0]), f4(off[1] + r[1] * lift), off[2]], r: [f4(r[0] * 0.085), f4(r[1] * s * 1.05), f4(r[2] * s * 1.1)] });
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

for (const s of [cox, tryon, starter]) await Bun.write(join(import.meta.dir, `${s.id}.json`), JSON.stringify(s, null, 2) + "\n");
console.log("wrote squonk-cox, squonk-tryon, squonk-starter");
