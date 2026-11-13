// Snallygaster, the first prototype from the owner's two pictures (the cryptid compendium):
// `bun proposals/compendium/snallygaster.ts [out.json]` writes the sheet (beasts/snallygaster.json, or `out`).
// A lean green dragon-bird: a hooked black beak with a mass of crimson tentacles spilling out like a beard, red frills
// on the crown, ONE big eye in the middle of the forehead (the Maryland accounts; the owner's pick), a long S-neck with a
// ribbed ochre underside, a white chest tuft, big green feathered wings with ochre primaries, two bird legs with orange
// clenched talons, and a long whip tail curling up at the end. Traits are in refs/snallygaster.json.
import { type Blob, type N, type Part, type V, bone, chain, f4, norm, pair, write } from "../set-a/upright/lib.ts";

// The whole body is one serpent's S, as in the owner's drawing: the head reared back over a throat that bows forward
// and down to a low chest, the back arching up to the hips, the tail dipping behind them, then sweeping up high and
// swinging out sideways into a curl over the back. The lowest point of the tail stays well off the ground (the rigger
// would count it as a foot), and the belly, the rig's root, stays low enough to read as a four-legged body.
const nodes: Record<string, N> = {
  tail6: [-1.02, 1.42, 0.06, 0.01],
  tail5: [-1.2, 1.46, 0.18, 0.012],
  tail4: [-1.38, 1.22, 0.16, 0.018],
  tail3: [-1.32, 0.9, 0.02, 0.026],
  tail2: [-1.02, 0.68, -0.12, 0.04],
  tail1: [-0.66, 0.74, -0.08, 0.06],
  hip: [-0.32, 0.84, 0, 0.12],
  belly: [-0.02, 0.74, 0, 0.13],
  chest: [0.26, 0.58, 0, 0.13],
  neck1: [0.52, 0.62, 0, 0.07],
  neck2: [0.7, 0.86, 0, 0.06],
  neck3: [0.58, 1.12, 0, 0.055],
  head: [0.68, 1.3, 0, 0.07],
  l_hipj: [-0.28, 0.62, 0.14, 0.08],
  l_knee: [-0.12, 0.34, 0.17, 0.06],
  l_hock: [-0.22, 0.15, 0.16, 0.035],
  l_foot: [-0.15, 0.05, 0.16, 0.03],
  l_wroot: [0.16, 0.84, 0.12, 0.06],
  l_welbow: [-0.02, 1.3, 0.55, 0.045],
  l_wwrist: [0.08, 1.6, 0.95, 0.035],
  l_wtip: [-0.12, 1.92, 1.36, 0.03],
};
const links = [
  ...chain(["tail6", "tail5", "tail4", "tail3", "tail2", "tail1", "hip", "belly", "chest", "neck1", "neck2", "neck3", "head"]),
  ...chain(["hip", "l_hipj", "l_knee", "l_hock", "l_foot"]),
  ...chain(["chest", "l_wroot", "l_welbow", "l_wwrist", "l_wtip"]),
];

/** Overlapping spheres down a chain of nodes, tapering through these radii: a tail that can coil sideways. */
function tube(chain: string[], radii: number[]): Blob[] {
  const out: Blob[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const A = nodes[chain[i]!]!, B = nodes[chain[i + 1]!]!;
    for (let k = 0; k < 4; k++) {
      const t = k / 4, r = f4(radii[i]! + (radii[i + 1]! - radii[i]!) * t);
      out.push({ at: chain[i]!, off: [f4((B[0] - A[0]) * t), f4((B[1] - A[1]) * t), f4((B[2] - A[2]) * t)], r: [r, r, r] });
    }
  }
  return out;
}
// the body: a lean ribbed barrel arched over the hips, an S-neck, a whip tail tapering to a curl
const blobs: Blob[] = [
  { at: "hip", off: [0, 0, 0], r: [0.21, 0.17, 0.17] },
  { at: "belly", off: [0, -0.02, 0], r: [0.27, 0.21, 0.2] },
  { at: "chest", off: [0, 0, 0], r: [0.22, 0.21, 0.19] },
  ...bone(nodes, "chest", "neck1", 0.13, 0.12, 0.15),
  ...bone(nodes, "neck1", "neck2", 0.095, 0.09, 0.15),
  ...bone(nodes, "neck2", "neck3", 0.08, 0.075, 0.15),
  ...bone(nodes, "neck3", "head", 0.06, 0.055, 0.1),
  ...tube(["hip", "tail1", "tail2", "tail3", "tail4", "tail5", "tail6"], [0.13, 0.09, 0.06, 0.042, 0.03, 0.02, 0.014]),
  // thighs, a knee, a long scaly shank: a bird's leg
  ...pair("l_hipj", [0.02, -0.01, 0], [0.15, 0.15, 0.11]),
  ...bone(nodes, "l_hipj", "l_knee", 0.09, 0.075, 0.15),
  ...pair("l_knee", [0, 0, 0], [0.06, 0.06, 0.055]),
  ...bone(nodes, "l_knee", "l_hock", 0.045, 0.042, 0.12),
  ...bone(nodes, "l_hock", "l_foot", 0.034, 0.034, 0.2),
  // the head: a round crown over a short face, the beak's root
  { at: "head", off: [0, 0.02, 0], r: [0.14, 0.12, 0.11] },
  { at: "head", off: [0.1, -0.02, 0], r: [0.09, 0.08, 0.085] },
];
// ribs across the throat and belly: thin flat bands under the body, the ochre underside's ridges, spaced evenly along
// the underside so the darker `stripes` bands (one per rib, shifted half a spacing) land in the grooves between them
const under = ["hip", "belly", "chest", "neck1", "neck2", "neck3"], RIBS = 12;
const runs = under.slice(1).map((b, i) => Math.hypot(nodes[b]![0] - nodes[under[i]!]![0], nodes[b]![1] - nodes[under[i]!]![1]));
const underLength = runs.reduce((a, b) => a + b, 0);
for (let k = 0; k < RIBS; k++) {
  let s = ((k + 0.5) / RIBS) * underLength, j = 0;
  while (s > runs[j]!) s -= runs[j++]!;
  const a = under[j]!, A = nodes[a]!, B = nodes[under[j + 1]!]!, t = s / runs[j]!;
  const x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t, r = A[3] + (B[3] - A[3]) * t;
  const ang = (Math.atan2(-(B[0] - A[0]), B[1] - A[1]) * 180) / Math.PI;
  blobs.push({ at: a, off: [f4(x - A[0] + 0.03), f4(y - A[1] - r * 1.15), 0], r: [0.04, f4(r * 0.5), f4(r * 1.45)], rot: [0, 0, f4(ang + 90)] });
}

const parts: Part[] = [];
// ONE big eye in the middle of the forehead, a dark pupil and a glint
parts.push({ kind: "eye", at: "head", off: [0.12, 0.08, 0], r: 0.06, material: "eye" });
parts.push({ kind: "eye", at: "head", off: [0.172, 0.083, 0], r: 0.026, material: "pupil" });
parts.push({ kind: "eye", at: "head", off: [0.18, 0.1, 0.014], r: 0.008, material: "glint" });
parts.push({ kind: "ridge", at: "head", off: [0.12, 0.14, 0], dir: [0, 0, 1], len: 0.12, base: 0.018, curve: 40, bend: [0, 1, 0], material: "hide" });
// the hooked beak: an upper bill curving down over a shorter lower one
parts.push({ kind: "horn", at: "head", off: [0.17, -0.01, 0], dir: [1, -0.1, 0], len: 0.38, base: 0.085, tip_base: 0.005, curve: 85, bend: [0, -1, 0], material: "beak", flat: 0.7 });
parts.push({ kind: "horn", at: "head", off: [0.16, -0.06, 0], dir: [1, -0.35, 0], len: 0.17, base: 0.045, tip_base: 0.005, curve: 15, bend: [0, -1, 0], material: "beak", flat: 0.7 });
// a row of teeth down each side of the upper bill (the Maryland accounts' toothed, metal-like beak)
for (let i = 0; i < 5; i++) for (const z of [1, -1]) {
  const t = i / 4, x = 0.19 + 0.15 * t, y = -0.035 - 0.05 * t * t;
  parts.push({ kind: "horn", at: "head", off: [f4(x), f4(y), f4(0.024 * z * (1 - 0.4 * t))], dir: norm([0.15, -1, 0.2 * z]), len: f4(0.065 - 0.02 * t), base: 0.016, tip_base: 0.002, material: "fang" });
}
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
for (const [off, d, len, bend, curve] of T) parts.push({ kind: "horn", at: "head", off, dir: norm(d), len, base: 0.032, tip_base: 0.006, curve, bend, material: "tentacle" });
// a second, shorter ring round the gape so the beard reads as a mass, not a few strands
for (let i = 0; i < 10; i++) {
  const a = (i / 10) * Math.PI * 2, z = Math.sin(a), y = Math.cos(a);
  parts.push({ kind: "horn", at: "head", off: [0.15, f4(-0.075 + 0.02 * y), f4(0.05 * z)], dir: norm([0.5, -1 + 0.4 * y, 0.8 * z]), len: f4(0.24 + 0.08 * ((i * 7) % 3)), base: 0.026, tip_base: 0.005, curve: 100 + 25 * (i % 3), bend: [f4(0.6 * y), 0.2, f4(z)], material: "tentacle" });
}
// red frills on the crown: a fan of ribs swept back, a web between them, the edge cut into points
for (let i = 0; i < 7; i++) {
  const a = ((-40 + i * 18) * Math.PI) / 180;
  parts.push({ kind: "horn", at: "head", off: [-0.02, 0.08, 0], dir: norm([-0.9, 0.5 + 0.6 * Math.cos(a), 0.5 * Math.sin(a)]), len: 0.2 - Math.abs(i - 3) * 0.02, base: 0.016, tip_base: 0.003, curve: 25, bend: [0, 1, 0], material: "frill", web: "crest", scallop: 0.35, web_thick: 0.01, web_mat: "frill" });
}
for (const z of [1, -1]) parts.push({ kind: "horn", at: "head", off: [0.02, 0.0, 0.08 * z], dir: norm([-0.8, 0.3, 0.6 * z]), len: 0.12, base: 0.014, tip_base: 0.002, curve: 20, bend: [0, 1, 0], material: "frill" });
// a white tuft at the chest: soft feathers in rows, laid flat and pointing down over the breast, on the front of the
// throat's low bow (on the chest itself the bowed neck buries them)
for (const [row, y, n, len] of [[0, 0.16, 3, 0.12], [1, 0.08, 4, 0.14], [2, 0.0, 5, 0.15], [3, -0.08, 4, 0.13]] as [number, number, number, number][]) {
  for (let i = 0; i < n; i++) {
    const z = (i - (n - 1) / 2) * 0.045;
    parts.push({ kind: "horn", at: "neck1", off: [f4(0.13 + (y - 0.04) * 0.6 - row * 0.01 - Math.abs(z) * 0.5), f4(y - 0.04), f4(z)], dir: norm([0.35, -1, z * 2.5]), len, base: 0.045, tip_base: 0.008, flat: 0.3, curve: 25, bend: [-1, 0, 0], material: "tuft" });
  }
}
// big feathered wings: a smaller, cupped green membrane on the arm, and long separate ochre primaries
// fanned off its tip and trailing edge that carry the wing's outline
parts.push({
  kind: "membrane", points: ["l_wroot", "l_welbow", "l_wwrist", "l_wtip", [-0.2, 1.88, 1.2], [-0.22, 1.5, 0.72], [-0.16, 1.2, 0.38], [-0.04, 1.04, 0.16]],
  thick: 0.016, camber: 0.16, puff: 0.03, mirror: true, material: "wing",
  feathers: { from: 3, to: 7, n: 20, len: 0.7, base: 0.06, flat: 0.1, curve: 14, tip: 0.3, rake: -40, material: "primary" },
});
// covert feathers in three overlapping rows over the membrane, each lying back from the leading edge toward the
// trailing one, so the wing reads as feathered and layered rather than a flat panel
{
  const lead = ["l_wroot", "l_welbow", "l_wwrist", "l_wtip"].map((k) => [nodes[k]![0], nodes[k]![1], nodes[k]![2]] as V);
  const back: V[] = [[-0.24, 1.0, 0.18], [-0.42, 1.12, 0.42], [-0.48, 1.42, 0.78], [-0.34, 1.78, 1.1]];
  const at = (pts: V[], t: number): V => { const s = t * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(s)), u = s - i; return [0, 1, 2].map((k) => pts[i]![k]! + (pts[i + 1]![k]! - pts[i]![k]!) * u) as V; };
  const root = lead[0]!;
  for (let row = 0; row < 4; row++) for (let i = 0; i < 9; i++) {
    const t = 0.06 + (i / 8) * 0.88, P = at(lead, t), Q = at(back, t), w = 0.06 + row * 0.2;
    const p: V = [P[0] + (Q[0] - P[0]) * w, P[1] + (Q[1] - P[1]) * w, P[2] + (Q[2] - P[2]) * w + 0.012];
    parts.push({ kind: "horn", at: "l_wroot", off: [f4(p[0] - root[0]), f4(p[1] - root[1]), f4(p[2] - root[2])], dir: norm([Q[0] - P[0], Q[1] - P[1], Q[2] - P[2]]), len: f4(0.22 + row * 0.07), base: 0.06, tip_base: 0.016, flat: 0.12, curve: 8, bend: [0, 0, 1], mirror: true, material: row === 3 ? "primary" : "covert" });
  }
}
// orange clenched talons: three toes curled under, a hind claw
parts.push({ kind: "foot", at: "l_foot", form: "talon", len: 0.2, width: 0.12, toes: 3, spread: 30, claw: 0.055, sole: 0.03, mirror: true, material: "leg", claw_mat: "claw" });

const sheet = {
  feet: 2, wings: 2, budget: 9000, root: "belly", material: "hide", blend: 0.022,
  belly: "belly", belly_turn: -0.25,
  palette: {
    hide: [0.14, 0.36, 0.22, 0.6, 0],
    belly: [0.78, 0.58, 0.26, 0.65, 0],
    band: [0.24, 0.14, 0.05, 0.7, 0],
    wing: [0.12, 0.33, 0.21, 0.6, 0],
    primary: [0.62, 0.44, 0.2, 0.6, 0],
    covert: [0.16, 0.4, 0.25, 0.6, 0],
    beak: [0.82, 0.8, 0.72, 0.3, 0.35],
    fang: [0.96, 0.94, 0.86, 0.3, 0],
    tentacle: [0.72, 0.1, 0.16, 0.4, 0],
    frill: [0.82, 0.13, 0.15, 0.5, 0],
    eye: [0.96, 0.86, 0.4, 0.2, 0, 0.6],
    pupil: [0.03, 0.03, 0.03, 0.2, 0],
    glint: [1, 1, 1, 0.1, 0],
    tuft: [0.95, 0.94, 0.9, 0.8, 0],
    leg: [0.9, 0.55, 0.16, 0.55, 0],
    claw: [0.12, 0.1, 0.08, 0.4, 0],
  },
  // the darker grooves between the ribs: a band centred halfway between each rib and the next (the ribs sit
  // 3 cm forward of their spot on the chain), measured from the blended skin since it lies far past the node radii
  stripes: { along: under, n: RIBS, width: 0.6, material: "band", side: "under", below: -0.1, reach: 0.05, phase: f4((1 - 0.6 / 2 + (0.03 * RIBS) / underLength) % 1) },
  paint: [{ nodes: ["l_knee", "r_knee", "l_hock", "r_hock", "l_foot", "r_foot"], material: "leg" }],
  nodes, links, blobs, parts,
  hide: { pattern: "scales", size: 0.022, colours: [[0.1, 0.26, 0.16], [0.18, 0.42, 0.26]], map: 1024 },
};

write("snallygaster", { ...(process.argv[2] ? { candidate: "one-eyed dragon-bird from the owner's pictures: tentacle beard, red frills, feathered wings" } : {}), ...sheet }, process.argv[2]);
