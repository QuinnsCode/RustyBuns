// Rougarou from the Louisiana swamp-museum figure, the 1900s loup-garou prints and folk drawings: a tall wolf standing
// as a man, broad shaggy shoulders over a lean waist, a long-muzzled wolf head snarling open, tall pointed ears, red
// eyes, long clawed arms, digitigrade wolf legs and a bushy tail, grey-brown shag.
import { type Blob, type Ell, type N, type Part, type V, add, bone, chain, mul, norm, pair, skin, write } from "./lib.ts";

const nodes: Record<string, N> = {
  hip: [0, 1.0, 0, 0.16],
  belly: [0.05, 1.24, 0, 0.18],
  chest: [0.12, 1.48, 0, 0.24],
  neck: [0.24, 1.72, 0, 0.13],
  head: [0.36, 1.84, 0, 0.11],
  snout: [0.7, 1.77, 0, 0.05],
  tail1: [-0.2, 1.0, 0, 0.07],
  tail2: [-0.46, 0.86, 0, 0.06],
  tail3: [-0.68, 0.66, 0, 0.05],
  tail4: [-0.82, 0.48, 0, 0.035],
  l_hipj: [0, 0.98, 0.15, 0.1],
  l_knee: [0.17, 0.62, 0.18, 0.08],
  l_hock: [-0.1, 0.3, 0.18, 0.055],
  l_foot: [0.03, 0.05, 0.18, 0.05],
  l_shoulder: [0.12, 1.62, 0.33, 0.09],
  l_elbow: [0.14, 1.28, 0.44, 0.07],
  l_wrist: [0.42, 1.12, 0.42, 0.05],
  l_hand: [0.52, 1.07, 0.4, 0.045],
};
const links = [
  ...chain(["tail4", "tail3", "tail2", "tail1", "hip", "belly", "chest", "neck", "head", "snout"]),
  ...chain(["hip", "l_hipj", "l_knee", "l_hock", "l_foot"]),
  ...chain(["chest", "l_shoulder", "l_elbow", "l_wrist", "l_hand"]),
];

// the body: a deep barrel chest and heavy shoulders over a lean waist, as the Jersey Devil's notes say (mass high keeps
// the rig's root high, so the puppet reads it as upright)
const blobs: Blob[] = [
  { at: "hip", off: [-0.02, 0, 0], r: [0.17, 0.15, 0.2] },
  { at: "belly", off: [0.02, 0, 0], r: [0.17, 0.18, 0.21] },
  { at: "chest", off: [0, 0.02, 0], r: [0.25, 0.27, 0.32] },
  { at: "neck", off: [-0.06, -0.02, 0], r: [0.2, 0.17, 0.25], rot: [0, 0, -30] },
  ...pair("l_shoulder", [0, 0, -0.02], [0.14, 0.15, 0.13]),
  ...bone(nodes, "l_shoulder", "l_elbow", 0.1, 0.09, 0.15),
  ...bone(nodes, "l_elbow", "l_wrist", 0.08, 0.07, 0.15),
  ...pair("l_elbow", [-0.02, 0, 0], [0.075, 0.075, 0.07]),
  ...pair("l_hand", [0.01, -0.02, 0], [0.06, 0.08, 0.05]),
  ...pair("l_hipj", [0.04, -0.06, 0], [0.15, 0.17, 0.12]),
  ...bone(nodes, "l_hipj", "l_knee", 0.12, 0.1, 0.2),
  ...bone(nodes, "l_knee", "l_hock", 0.07, 0.06, 0.12),
  ...bone(nodes, "l_hock", "l_foot", 0.045, 0.045, 0.25),
  ...pair("l_hock", [-0.02, 0, 0], [0.045, 0.045, 0.04]),
  ...pair("l_knee", [0, 0, 0], [0.075, 0.075, 0.07]),
  // the tail's root, so it grows out of the rump instead of a stick
  { at: "tail1", off: [0, 0, 0], r: [0.09, 0.08, 0.08] },
  { at: "tail2", off: [0, 0, 0], r: [0.08, 0.07, 0.07] },
];

// the head (the set A wolf head, `proposals/set-a/make.ts`), offsets from the head node in head units H
const H = 1.55, M = 1.05, gape = 1.4;
const cran: Ell = { c: [0, 0.01, 0], r: [0.13, 0.11, 0.115] };
const muz: Ell = { c: [0.15 * M, -0.05, 0], r: [0.15 * M, 0.065 * 1.2, 0.07 * 1.2] };
const cheek: Ell = { c: [0.05, -0.04, 0.06], r: [0.09, 0.075, 0.065] };
const drop = 0.05 * gape;
const jaw: Ell = { c: [0.13 * M, -0.115 - drop, 0], r: [0.13 * M, 0.035, 0.06] };
const ells = [cran, muz, cheek, { c: [cheek.c[0], cheek.c[1], -cheek.c[2]] as V, r: cheek.r }];
for (const e of ells) blobs.push({ at: "head", off: mul(e.c, H), r: mul(e.r, H) });
blobs.push({ at: "head", off: mul(jaw.c, H), r: mul(jaw.r, H), rot: [0, 0, -10 * gape] });
const on = (p: V, d: V, sink = 0, set = ells): V => {
  const s = skin(set, p, d), n = norm(d);
  return mul([s[0] - n[0] * sink, s[1] - n[1] * sink, s[2] - n[2] * sink], H);
};
const hr = (x: number) => +(x * H).toFixed(4);
const tip = 0.3 * M;
const parts: Part[] = [];
// the open mouth, a dark red gullet
parts.push({ kind: "eye", at: "head", off: mul([0.15 * M, -0.09 - drop / 2, 0], H), r: hr(0.055), material: "mouth" });
const nose = on([tip - 0.02, -0.03, 0], [1, 0.4, 0], 0.012);
parts.push({ kind: "eye", at: "head", off: nose, r: hr(0.032), material: "nose" });
parts.push({ kind: "eye", at: "head", off: add(nose, mul([0.012, -0.006, 0.012], H)), r: hr(0.011), mirror: true, material: "dark" });
for (let i = 0; i < 4; i++) {
  const f = i / 3, x = tip - 0.05 - f * 0.16 * M, z = 0.035 + f * 0.02;
  parts.push({ kind: "horn", at: "head", off: on([x, -0.06, z * 0.5], [0, -1, 0.5], 0.012), dir: [0.1, -1, 0], len: hr(i === 0 ? 0.08 : 0.035), base: hr(i === 0 ? 0.017 : 0.011), curve: i === 0 ? 12 : 0, bend: [-1, 0, 0], tip_base: 0.001, mirror: true, material: "fang" });
}
for (let i = 0; i < 3; i++) {
  const x = jaw.c[0] + jaw.r[0] * (0.75 - i * 0.35);
  parts.push({ kind: "horn", at: "head", off: on([x, jaw.c[1], 0.03], [0, 1, 0.4], 0.006, [jaw]), dir: [0.15, 1, 0], len: hr(i === 0 ? 0.065 : 0.03), base: hr(i === 0 ? 0.015 : 0.01), tip_base: 0.001, curve: 0, mirror: true, material: "fang" });
}
parts.push({ kind: "ridge", at: "head", off: on([0.12 * M, -0.075, 0.045], [0.1, -0.3, 1], 0.012), dir: [1, 0.05, -0.15], len: hr(0.2 * M), base: hr(0.018), curve: 8, bend: [0, -1, 0], mirror: true, material: "dark" });
// red eyes under heavy brows, glowing
const eyeDir = norm([0.75, 0.3, 0.6]);
const eyeAt = on([0.06, 0.03, 0.03], eyeDir, 0.022);
parts.push({ kind: "eye", at: "head", off: eyeAt, r: hr(0.032), mirror: true, material: "eye" });
parts.push({ kind: "eye", at: "head", off: add(eyeAt, mul(eyeDir, 0.022 * H)), r: hr(0.012), mirror: true, material: "pupil" });
parts.push({ kind: "ridge", at: "head", off: on([0.05, 0.07, 0.05], [0.5, 1, 0.6], 0.01), dir: [0.3, -0.1, -1], len: hr(0.09), base: hr(0.024), curve: 30, bend: [0, 1, 0], mirror: true, material: "fur" });
// tall pointed ears, thick, pricked
parts.push({ kind: "ear", at: "head", off: on([-0.04, 0.06, 0.06], [-0.3, 1, 0.7], 0.02), dir: [-0.15, 1, 0.35], len: hr(0.17), width: hr(0.055), tilt: 22, cup: 30, fold: 0.35, mirror: true, material: "fur" });

// hands: four long hooked claws; feet: wolf paws with claws
parts.push(
  ...[-0.03, -0.01, 0.01, 0.03].map((z): Part => ({ kind: "horn", at: "l_hand", off: [0.03, -0.06, z], dir: [1, -0.5, z * 2], len: 0.12, base: 0.016, tip_base: 0.004, curve: 45, bend: [-1, 0, 0], mirror: true, material: "claw" })),
  { kind: "foot", at: "l_foot", form: "paw", len: 0.22, width: 0.13, toes: 4, claw: 0.04, sole: 0.05, mirror: true, material: "fur", claw_mat: "claw" },
);
// shag: thin strands in their own colour (set A's lesson), a mane over the neck and shoulders, fringes on the arms,
// a bushy tail
parts.push(
  { kind: "tuft", along: ["head", "neck", "chest", "belly"], n: 20, len: 0.2, base: 0.03, rows: 9, spread: 110, sweep: 1.6, curve: 25, flat: 0.5, material: "tuft" },
  { kind: "tuft", along: ["neck", "chest"], n: 12, len: 0.24, base: 0.045, rows: 10, spread: 160, sweep: 1.5, curve: 30, flat: 0.5, material: "mane" },
  { kind: "tuft", along: ["l_shoulder", "l_elbow", "l_wrist"], n: 8, len: 0.13, base: 0.035, rows: 3, spread: 60, flat: 0.5, mirror: true, material: "tuft" },
  { kind: "tuft", along: ["l_hipj", "l_knee"], n: 4, len: 0.13, base: 0.035, rows: 3, spread: 50, flat: 0.5, mirror: true, material: "tuft" },
  { kind: "tuft", along: ["tail1", "tail2", "tail3", "tail4"], n: 14, len: 0.2, base: 0.045, rows: 8, spread: 165, sweep: 1.8, curve: 20, flat: 0.5, material: "tuft" },
);

write("rougarou", {
  feet: 2, wings: 0, budget: 9000, root: "chest", material: "fur", blend: 0.025,
  belly: "belly", belly_turn: -0.3,
  palette: {
    fur: [0.3, 0.26, 0.22, 0.95, 0],
    tuft: [0.38, 0.34, 0.3, 0.95, 0],
    mane: [0.22, 0.19, 0.17, 0.95, 0],
    belly: [0.5, 0.46, 0.4, 0.95, 0],
    eye: [1, 0.15, 0.05, 0.3, 0, 5],
    pupil: [1, 0.7, 0.3, 0.2, 0, 6],
    mouth: [0.45, 0.06, 0.06, 0.6, 0, 0.5],
    nose: [0.05, 0.04, 0.04, 0.4, 0],
    dark: [0.06, 0.04, 0.04, 0.6, 0],
    fang: [0.95, 0.92, 0.82, 0.3, 0],
    claw: [0.16, 0.14, 0.12, 0.4, 0],
  },
  nodes, links, blobs, parts,
  hide: { pattern: "fur", size: 0.045, colours: [[0.17, 0.15, 0.13], [0.46, 0.42, 0.37]], map: 1024 },
}, process.argv[2]);
