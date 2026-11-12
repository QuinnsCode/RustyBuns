// Snallygaster, the first prototype from the owner's two pictures (the cryptid compendium):
// `bun proposals/compendium/snallygaster.ts [out.json]` writes the sheet (beasts/snallygaster.json, or `out`).
// A lean green dragon-bird: a hooked black beak with a mass of crimson tentacles spilling out like a beard, red frills
// on the crown, ONE big eye in the middle of the forehead (the Maryland accounts; the owner's pick), a long S-neck with a
// ribbed ochre underside, a white chest tuft, big green feathered wings with ochre primaries, two bird legs with orange
// clenched talons, and a long whip tail curling up at the end. Traits are in refs/snallygaster.json.
import { type Blob, type N, type Part, type V, bone, chain, f4, norm, pair, write } from "../set-a/upright/lib.ts";

const nodes: Record<string, N> = {
  tail5: [-1.5, 1.12, 0, 0.012],
  tail4: [-1.58, 0.9, 0, 0.018],
  tail3: [-1.38, 0.66, 0, 0.026],
  tail2: [-1.02, 0.6, 0, 0.04],
  tail1: [-0.66, 0.66, 0, 0.06],
  hip: [-0.32, 0.72, 0, 0.12],
  belly: [-0.02, 0.78, 0, 0.13],
  chest: [0.26, 0.9, 0, 0.13],
  neck1: [0.42, 1.08, 0, 0.07],
  neck2: [0.44, 1.32, 0, 0.06],
  neck3: [0.54, 1.5, 0, 0.055],
  head: [0.7, 1.58, 0, 0.07],
  l_hipj: [-0.28, 0.64, 0.12, 0.07],
  l_knee: [-0.1, 0.42, 0.15, 0.05],
  l_hock: [-0.24, 0.2, 0.14, 0.03],
  l_foot: [-0.16, 0.05, 0.14, 0.025],
  l_wroot: [0.18, 1.04, 0.12, 0.06],
  l_welbow: [-0.02, 1.46, 0.55, 0.045],
  l_wwrist: [0.08, 1.76, 0.95, 0.035],
  l_wtip: [-0.12, 2.08, 1.36, 0.03],
};
const links = [
  ...chain(["tail5", "tail4", "tail3", "tail2", "tail1", "hip", "belly", "chest", "neck1", "neck2", "neck3", "head"]),
  ...chain(["hip", "l_hipj", "l_knee", "l_hock", "l_foot"]),
  ...chain(["chest", "l_wroot", "l_welbow", "l_wwrist", "l_wtip"]),
];

// the body: a lean ribbed barrel, an S-neck, a whip tail tapering to a curl
const blobs: Blob[] = [
  { at: "hip", off: [0, 0, 0], r: [0.16, 0.13, 0.13] },
  { at: "belly", off: [0, 0, 0], r: [0.2, 0.15, 0.15] },
  { at: "chest", off: [0, 0, 0], r: [0.17, 0.16, 0.15] },
  ...bone(nodes, "chest", "neck1", 0.1, 0.09, 0.15),
  ...bone(nodes, "neck1", "neck2", 0.075, 0.07, 0.15),
  ...bone(nodes, "neck2", "neck3", 0.065, 0.06, 0.15),
  ...bone(nodes, "neck3", "head", 0.06, 0.055, 0.1),
  ...bone(nodes, "hip", "tail1", 0.09, 0.08, 0.15),
  ...bone(nodes, "tail1", "tail2", 0.06, 0.055, 0.12),
  ...bone(nodes, "tail2", "tail3", 0.04, 0.038, 0.12),
  ...bone(nodes, "tail3", "tail4", 0.028, 0.026, 0.1),
  ...bone(nodes, "tail4", "tail5", 0.018, 0.017, 0.1),
  // thighs, a knee, a long scaly shank: a bird's leg
  ...pair("l_hipj", [0.02, -0.03, 0], [0.11, 0.12, 0.08]),
  ...bone(nodes, "l_hipj", "l_knee", 0.065, 0.055, 0.15),
  ...pair("l_knee", [0, 0, 0], [0.045, 0.045, 0.042]),
  ...bone(nodes, "l_knee", "l_hock", 0.032, 0.03, 0.12),
  ...bone(nodes, "l_hock", "l_foot", 0.024, 0.024, 0.2),
  // the head: a round crown over a short face, the beak's root
  { at: "head", off: [0, 0.02, 0], r: [0.14, 0.12, 0.11] },
  { at: "head", off: [0.1, -0.02, 0], r: [0.09, 0.08, 0.085] },
];
// ribs across the throat and belly: thin flat bands under the body, the ochre underside's ridges
const under: [string, string, number][] = [["neck1", "neck2", 4], ["chest", "neck1", 3], ["belly", "chest", 3], ["hip", "belly", 3]];
for (const [a, b, n] of under) {
  const A = nodes[a]!, B = nodes[b]!;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t, r = A[3] + (B[3] - A[3]) * t;
    const ang = (Math.atan2(-(B[0] - A[0]), B[1] - A[1]) * 180) / Math.PI;
    blobs.push({ at: a, off: [f4(x - A[0] + 0.03), f4(y - A[1] - r * 0.85), 0], r: [0.025, f4(r * 0.35), f4(r * 1.05)], rot: [0, 0, f4(ang + 90)] });
  }
}

const parts: Part[] = [];
// ONE big eye in the middle of the forehead, a dark pupil and a glint
parts.push({ kind: "eye", at: "head", off: [0.12, 0.08, 0], r: 0.06, material: "eye" });
parts.push({ kind: "eye", at: "head", off: [0.172, 0.083, 0], r: 0.026, material: "pupil" });
parts.push({ kind: "eye", at: "head", off: [0.18, 0.1, 0.014], r: 0.008, material: "glint" });
parts.push({ kind: "ridge", at: "head", off: [0.12, 0.14, 0], dir: [0, 0, 1], len: 0.12, base: 0.018, curve: 40, bend: [0, 1, 0], material: "hide" });
// the hooked beak: an upper bill curving down over a shorter lower one
parts.push({ kind: "horn", at: "head", off: [0.17, -0.01, 0], dir: [1, -0.1, 0], len: 0.3, base: 0.065, tip_base: 0.004, curve: 55, bend: [0, -1, 0], material: "beak", flat: 0.7 });
parts.push({ kind: "horn", at: "head", off: [0.16, -0.06, 0], dir: [1, -0.35, 0], len: 0.17, base: 0.045, tip_base: 0.005, curve: 15, bend: [0, -1, 0], material: "beak", flat: 0.7 });
// the tentacles: a beard of long crimson tendrils spilling from the gape, curling every way
const T: [V, V, number, V, number][] = [
  // [root off, direction, length, bend, curve]
  [[0.16, -0.06, 0.03], [0.6, -1, 0.3], 0.42, [-0.4, 0, 1], 110],
  [[0.16, -0.06, -0.03], [0.6, -1, -0.3], 0.42, [-0.4, 0, -1], 110],
  [[0.17, -0.07, 0], [0.9, -1, 0], 0.5, [1, 0.3, 0], 140],
  [[0.15, -0.07, 0.05], [0.2, -1, 0.6], 0.36, [0.6, 0, 1], 90],
  [[0.15, -0.07, -0.05], [0.2, -1, -0.6], 0.36, [0.6, 0, -1], 90],
  [[0.13, -0.08, 0.02], [-0.1, -1, 0.15], 0.46, [1, 0, 0], 70],
  [[0.13, -0.08, -0.02], [-0.1, -1, -0.15], 0.46, [1, 0, 0], 70],
  [[0.18, -0.05, 0.06], [1, -0.4, 0.7], 0.3, [0, 1, 0], 120],
  [[0.18, -0.05, -0.06], [1, -0.4, -0.7], 0.3, [0, 1, 0], 120],
  [[0.12, -0.09, 0.04], [0.3, -1, 0.3], 0.26, [-1, 0, 0.4], 160],
  [[0.12, -0.09, -0.04], [0.3, -1, -0.3], 0.26, [-1, 0, -0.4], 160],
];
for (const [off, d, len, bend, curve] of T) parts.push({ kind: "horn", at: "head", off, dir: norm(d), len, base: 0.022, tip_base: 0.004, curve, bend, material: "tentacle" });
// red frills on the crown: a fan of ribs swept back, a web between them, the edge cut into points
for (let i = 0; i < 7; i++) {
  const a = ((-40 + i * 18) * Math.PI) / 180;
  parts.push({ kind: "horn", at: "head", off: [-0.02, 0.08, 0], dir: norm([-0.9, 0.5 + 0.6 * Math.cos(a), 0.5 * Math.sin(a)]), len: 0.2 - Math.abs(i - 3) * 0.02, base: 0.016, tip_base: 0.003, curve: 25, bend: [0, 1, 0], material: "frill", web: "crest", scallop: 0.35, web_thick: 0.01, web_mat: "frill" });
}
for (const z of [1, -1]) parts.push({ kind: "horn", at: "head", off: [0.02, 0.0, 0.08 * z], dir: norm([-0.8, 0.3, 0.6 * z]), len: 0.12, base: 0.014, tip_base: 0.002, curve: 20, bend: [0, 1, 0], material: "frill" });
// a white tuft at the chest
for (const [x, y, z, r] of [[0.16, 0.1, 0, 0.07], [0.13, 0.03, 0.06, 0.055], [0.13, 0.03, -0.06, 0.055], [0.15, 0.17, 0.04, 0.05], [0.15, 0.17, -0.04, 0.05], [0.12, -0.04, 0, 0.05]] as [number, number, number, number][]) parts.push({ kind: "eye", at: "chest", off: [x, y, z], r, material: "tuft" });
// big feathered wings: a green membrane on the arm, ochre primaries fanned off its trailing edge
parts.push({
  kind: "membrane", points: ["l_wroot", "l_welbow", "l_wwrist", "l_wtip", [-0.48, 1.8, 1.22], [-0.64, 1.44, 0.86], [-0.54, 1.12, 0.45], [-0.28, 1.0, 0.18]],
  thick: 0.018, camber: 0.08, puff: 0.03, mirror: true, material: "wing",
  feathers: { from: 3, to: 5, n: 9, len: 0.5, base: 0.06, flat: 0.12, curve: 10, tip: 0.35, material: "primary" },
});
// orange clenched talons: three toes curled under, a hind claw
parts.push({ kind: "foot", at: "l_foot", form: "talon", len: 0.16, width: 0.09, toes: 3, spread: 28, claw: 0.04, sole: 0.03, mirror: true, material: "leg", claw_mat: "claw" });

const sheet = {
  feet: 2, wings: 2, budget: 9000, root: "belly", material: "hide", blend: 0.022,
  belly: "belly", belly_turn: -0.25,
  palette: {
    hide: [0.14, 0.36, 0.22, 0.6, 0],
    belly: [0.78, 0.58, 0.26, 0.65, 0],
    wing: [0.12, 0.33, 0.21, 0.6, 0],
    primary: [0.62, 0.44, 0.2, 0.6, 0],
    beak: [0.05, 0.05, 0.06, 0.35, 0],
    tentacle: [0.72, 0.1, 0.16, 0.4, 0],
    frill: [0.82, 0.13, 0.15, 0.5, 0],
    eye: [0.96, 0.86, 0.4, 0.2, 0, 0.6],
    pupil: [0.03, 0.03, 0.03, 0.2, 0],
    glint: [1, 1, 1, 0.1, 0],
    tuft: [0.95, 0.94, 0.9, 0.8, 0],
    leg: [0.9, 0.55, 0.16, 0.55, 0],
    claw: [0.12, 0.1, 0.08, 0.4, 0],
  },
  paint: [{ nodes: ["l_knee", "r_knee", "l_hock", "r_hock", "l_foot", "r_foot"], material: "leg" }],
  nodes, links, blobs, parts,
  hide: { pattern: "scales", size: 0.022, colours: [[0.1, 0.26, 0.16], [0.18, 0.42, 0.26]], map: 1024 },
};

write("snallygaster", { ...(process.argv[2] ? { candidate: "one-eyed dragon-bird from the owner's pictures: tentacle beard, red frills, feathered wings" } : {}), ...sheet }, process.argv[2]);
