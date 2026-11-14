// Flatwoods Monster candidates (the cryptid compendium, one beast at a time): `bun proposals/compendium/flatwoods-monster.ts
// <variant> [out.json]` writes the sheet for one of the variants below (to beasts/flatwoods-monster.json, or `out`).
// References and traits are in refs/flatwoods-monster.json: a hovering figure with no legs, a pointed hood behind a
// small round face, two big glowing eyes, square shoulders over a narrow waist, a long pleated skirt, spindly clawed arms.
//
// The skirt is a ring of upright blobs on a cone, merged by `blend` into one fluted skin; the hood is a fan of `horn`
// ribs behind the head with a `web` between each and the next (`scallop` cuts the serrated leaf edge).
import { type Blob, type Ell, type N, type Part, type V, add, bone, f4, chain, mul, norm, onSkin, pair, write } from "../set-a/upright/lib.ts";

type Look = {
  note: string;
  head: number;                       // head and hood size
  hood: { ribs: number; spread: number; len: (a: number) => number; scallop: number; lean: number };
  skirt: { hem: number; waist: number; flutes: number; flute: number };
  chest: V;                            // chest blob half-sizes
  rings: number;                       // ribbed bellows rings at the waist
  arm: { reach: number; thick: number; fingers: number; finger: number };
  collar?: { ribs: number; len: number };
  eye: number;
  palette: Record<string, number[]>;
  paint: { nodes: string[]; material: string }[];
};

// how long a hood rib is at angle a (degrees from straight up): a pointed spade, a round leaf, a tall flame
const spade = (a: number) => { const t = Math.abs(a) / 100; return 0.62 + 0.5 * Math.max(0, 1 - t * 4) ** 1.5 - 0.12 * t * t; };
const leaf = (a: number) => { const t = Math.abs(a) / 130; return 0.42 + 0.5 * Math.cos(t * Math.PI / 2) ** 0.8 + (Math.round(Math.abs(a) / 7.5) % 2 ? 0.05 : 0); };
const disc = (a: number) => { const t = Math.abs(a) / 100; return 0.55 + 0.22 * Math.max(0, 1 - t * 3) - 0.1 * t * t; };

const GREEN = [0.2, 0.33, 0.2, 0.55, 0.1];
const LOOKS: Record<string, Look> = {
  // the 1952 accounts: a blood-red round face, glowing greenish-orange eyes, a tall pointed hood "like the ace of spades",
  // green clothing hanging in folds to the ground, short arms with long claws
  witness: {
    note: "1952 accounts: red face, tall ace-of-spades hood, green pleated skirt, short clawed arms",
    head: 1, hood: { ribs: 17, spread: 125, len: spade, scallop: 0.05, lean: 0.22 },
    skirt: { hem: 0.45, waist: 0.3, flutes: 16, flute: 0.05 }, chest: [0.26, 0.3, 0.36], rings: 0,
    arm: { reach: 0.8, thick: 0.045, fingers: 3, finger: 0.2 }, eye: 0.06,
    palette: {
      suit: GREEN, hood: [0.13, 0.22, 0.14, 0.5, 0.1], face: [0.72, 0.14, 0.1, 0.6, 0, 0.5],
      eye: [1, 0.62, 0.22, 0.2, 0, 3], dark: [0.05, 0.04, 0.04, 0.7, 0], claw: [0.12, 0.16, 0.12, 0.5, 0],
    },
    paint: [{ nodes: ["head"], material: "face" }],
  },
  // the card's painting: slate grey all over, a huge serrated leaf of a hood, red glowing eyes, a square chest plate,
  // ribbed bellows at the waist, long spindly arms with four long fingers
  leaf: {
    note: "the card painting: grey, serrated leaf hood, red eyes, chest plate, bellows waist, spindly arms",
    head: 1, hood: { ribs: 25, spread: 125, len: leaf, scallop: 0.16, lean: 0.18 },
    skirt: { hem: 0.46, waist: 0.33, flutes: 20, flute: 0.055 }, chest: [0.27, 0.3, 0.42], rings: 3,
    arm: { reach: 1.15, thick: 0.035, fingers: 4, finger: 0.26 }, eye: 0.065,
    palette: {
      suit: [0.34, 0.36, 0.37, 0.5, 0.15], hood: [0.2, 0.21, 0.23, 0.7, 0], face: [0.16, 0.17, 0.18, 0.6, 0],
      eye: [1, 0.08, 0.05, 0.2, 0, 4], dark: [0.05, 0.05, 0.06, 0.7, 0], claw: [0.26, 0.28, 0.29, 0.5, 0.1],
    },
    paint: [{ nodes: ["head"], material: "face" }],
  },
  // the Flatwoods visitor chair: a red rayed hood round a red face with big yellow eyes, a pale blue fan collar,
  // a green body, red arms hanging straight down
  chair: {
    note: "the town's visitor chair: red rayed hood and face, big yellow eyes, blue-white fan collar, green skirt",
    head: 1.1, hood: { ribs: 15, spread: 118, len: disc, scallop: 0.02, lean: 0.2 },
    skirt: { hem: 0.44, waist: 0.34, flutes: 14, flute: 0.07 }, chest: [0.25, 0.28, 0.4], rings: 0,
    arm: { reach: 0.55, thick: 0.05, fingers: 3, finger: 0.12 }, collar: { ribs: 9, len: 0.42 }, eye: 0.085,
    palette: {
      suit: [0.18, 0.38, 0.2, 0.55, 0], hood: [0.6, 0.08, 0.1, 0.55, 0], face: [0.78, 0.16, 0.16, 0.55, 0],
      eye: [1, 0.85, 0.3, 0.2, 0, 2.5], dark: [0.12, 0.04, 0.04, 0.7, 0], claw: [0.7, 0.14, 0.14, 0.5, 0],
      collar: [0.62, 0.74, 0.92, 0.4, 0], arm: [0.72, 0.15, 0.15, 0.55, 0],
    },
    paint: [{ nodes: ["head"], material: "face" }, { nodes: ["l_elbow", "r_elbow", "l_wrist", "r_wrist", "l_hand", "r_hand"], material: "arm" }],
  },
  // the starters' big-head build: the witness colours, head and hood half again as big over a short bell skirt
  starter: {
    note: "the big-head starter build, witness colours: huge hood and eyes over a short bell skirt",
    head: 1.5, hood: { ribs: 17, spread: 125, len: spade, scallop: 0.05, lean: 0.22 },
    skirt: { hem: 0.48, waist: 0.32, flutes: 14, flute: 0.06 }, chest: [0.25, 0.26, 0.34], rings: 0,
    arm: { reach: 0.7, thick: 0.05, fingers: 3, finger: 0.16 }, eye: 0.075,
    palette: {
      suit: GREEN, hood: [0.13, 0.22, 0.14, 0.5, 0.1], face: [0.74, 0.16, 0.12, 0.6, 0, 0.5],
      eye: [1, 0.62, 0.22, 0.2, 0, 3], dark: [0.05, 0.04, 0.04, 0.7, 0], claw: [0.12, 0.16, 0.12, 0.5, 0],
    },
    paint: [{ nodes: ["head"], material: "face" }],
  },
};

export const VARIANTS = Object.keys(LOOKS);

export function sheet(name: string) {
  const L = LOOKS[name];
  if (!L) throw new Error(`no variant ${name}: one of ${VARIANTS.join(", ")}`);
  const short = name === "starter"; // a squat body under the big head
  const y = (v: number) => (short ? 0.25 + (v - 0.25) * 0.72 : v);
  const nodes: Record<string, N> = {
    hem: [0, y(0.5), 0, 0.2],
    base: [0, y(0.8), 0, 0.2],
    waist: [0.01, y(1.3), 0, 0.17],
    chest: [0.02, y(1.72), 0, 0.2],
    neck: [0.05, y(2.0), 0, 0.09],
    head: [0.08, y(2.0) + 0.2 * L.head, 0, 0.1],
    l_shoulder: [0.02, y(1.9), 0.3, 0.07],
    l_elbow: [0.12, y(1.9) - 0.4 * L.arm.reach, 0.42, 0.045],
    l_wrist: [0.12 + 0.3 * L.arm.reach, y(1.9) - 0.52 * L.arm.reach, 0.44, 0.035],
    l_hand: [0.18 + 0.33 * L.arm.reach, y(1.9) - 0.55 * L.arm.reach, 0.43, 0.03],
  };
  const links = [...chain(["hem", "base", "waist", "chest", "neck", "head"]), ...chain(["chest", "l_shoulder", "l_elbow", "l_wrist", "l_hand"])];

  // the skirt: a smooth cone core from the hem to the waist, a ring of tall flutes leaning in with it: deep pleats
  const blobs: Blob[] = [];
  const hemY = nodes.hem![1] + 0.02, waistY = nodes.waist![1];
  const rAt = (yy: number) => L.skirt.hem + (L.skirt.waist - L.skirt.hem) * ((yy - hemY) / (waistY - hemY));
  const by = (yy: number) => f4(yy - nodes.base![1]);
  for (let t = 0; t < 5; t++) {
    const yc = hemY + ((waistY - hemY) * (t + 0.5)) / 5, r = f4(rAt(yc) - L.skirt.flute * 0.7);
    blobs.push({ at: "base", off: [0, by(yc), 0], r: [r, f4((waistY - hemY) * 0.14), r] });
  }
  const tilt = (Math.atan2(L.skirt.hem - L.skirt.waist, waistY - hemY) * 180) / Math.PI;
  const midY = (hemY + waistY) / 2 + 0.03, fr = f4(rAt(midY) - L.skirt.flute * 0.55);
  for (let i = 0; i < L.skirt.flutes; i++) {
    const a = (i / L.skirt.flutes) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a);
    blobs.push({ at: "base", off: [f4(fr * c), by(midY), f4(fr * s)], r: [L.skirt.flute, f4((waistY - hemY) * 0.46), L.skirt.flute], rot: [f4(-tilt * s), 0, f4(tilt * c)] });
  }
  // bellows rings at the waist, square chest plate, shoulders, neck
  for (let i = 0; i < L.rings; i++) blobs.push({ at: "waist", off: [0, 0.07 + i * 0.075, 0], r: [L.skirt.waist + 0.04, 0.032, L.skirt.waist + 0.04] });
  blobs.push(
    { at: "waist", off: [0, 0.04, 0], r: [L.skirt.waist, 0.16, L.skirt.waist] },
    { at: "chest", off: [0, 0, 0], r: L.chest },
    { at: "chest", off: [0.03, 0.12, 0], r: [L.chest[0] * 0.95, L.chest[1] * 0.55, L.chest[2] * 1.05] },
    ...pair("l_shoulder", [0, 0, 0], [0.11, 0.11, 0.1]),
    { at: "neck", off: [0, 0, 0], r: [0.1, 0.12, 0.1] },
    ...bone(nodes, "l_shoulder", "l_elbow", L.arm.thick, L.arm.thick, 0.15),
    ...bone(nodes, "l_elbow", "l_wrist", L.arm.thick * 0.85, L.arm.thick * 0.85, 0.15),
    ...pair("l_elbow", [0, 0, 0], [L.arm.thick * 1.15, L.arm.thick * 1.15, L.arm.thick * 1.15]),
    ...pair("l_wrist", [0.02, 0, 0], [L.arm.thick * 1.3, L.arm.thick, L.arm.thick * 1.2]),
  );

  // the face: a small round head, offsets from the head node, scaled with the hood
  const K = L.head;
  const face: Ell[] = [{ c: [0.02, 0, 0], r: [0.14, 0.16, 0.15] }, { c: [0.06, -0.06, 0], r: [0.09, 0.08, 0.1] }].map((e) => ({ c: mul(e.c, K), r: mul(e.r, K) }));
  blobs.push(...face.map((e) => ({ at: "head", off: e.c, r: e.r }) as Blob));
  const on = onSkin(face);
  const parts: Part[] = [];
  // two big round glowing eyes, a small nose and a mouth line
  parts.push({ kind: "eye", at: "head", off: on([0.06 * K, 0.02 * K, 0.06 * K], norm([0.9, 0.1, 0.55]), L.eye * K * 0.45), r: L.eye * K, mirror: true, material: "eye" });
  parts.push({ kind: "eye", at: "head", off: on([0.1 * K, -0.04 * K, 0], [1, -0.1, 0], 0.012 * K), r: 0.022 * K, material: "face" });
  parts.push({ kind: "ridge", at: "head", off: on([0.11 * K, -0.1 * K, 0], [1, -0.4, 0], 0.006), dir: [0, 0, 1], len: 0.05 * K, base: 0.009, curve: 20, bend: [-1, 0.3, 0], mirror: true, material: "dark" });

  // the hood: a fan of ribs behind the head, leaning back, a web between each and the next
  const hub: V = [-0.1 * K, -0.03 * K, 0];
  for (let i = 0; i < L.hood.ribs; i++) {
    const a = -L.hood.spread + (2 * L.hood.spread * i) / (L.hood.ribs - 1), rad = (a * Math.PI) / 180;
    parts.push({
      kind: "horn", at: "head", off: hub, dir: norm([-L.hood.lean, Math.cos(rad), Math.sin(rad)]), len: +(L.hood.len(a) * K).toFixed(4),
      base: 0.03 * K, tip_base: 0.01 * K, material: "hood", web: "hood", scallop: L.hood.scallop, web_thick: 0.035 * K, web_mat: "hood",
    });
  }
  // the chair's pale fan collar: ribs from the neck fanned down over the chest and shoulders
  if (L.collar) {
    for (let i = 0; i < L.collar.ribs; i++) {
      const a = -80 + (160 * i) / (L.collar.ribs - 1), rad = (a * Math.PI) / 180;
      parts.push({ kind: "horn", at: "neck", off: [0.04, 0.02, 0], dir: norm([0.55 * Math.cos(rad), -0.55, Math.sin(rad)]), len: L.collar.len, base: 0.025, tip_base: 0.012, material: "collar", web: "collar", scallop: 0.05, web_thick: 0.03, web_mat: "collar" });
    }
    parts.push(...[0, 1, 2, 3, 4].map((i): Part => ({ kind: "eye", at: "waist", off: [L.skirt.waist + 0.01, 0.06, (i - 2) * 0.12], r: 0.06, material: "collar" })));
  }
  // long hooked claws for fingers
  const fz = L.arm.fingers === 4 ? [-0.03, -0.01, 0.01, 0.03] : [-0.02, 0, 0.02];
  parts.push(...fz.map((z): Part => ({ kind: "horn", at: "l_hand", off: [0.01, -0.01, z], dir: [0.6, -1, z * 6], len: L.arm.finger, base: L.arm.thick * 0.35, tip_base: 0.004, curve: 45, bend: [1, 0, 0], mirror: true, material: "claw" })));

  return {
    feet: 0, wings: 0, budget: 8000, root: "chest", material: "suit", blend: 0.024,
    palette: L.palette, paint: L.paint, nodes, links, blobs, parts,
  };
}

// The owner's redesign (2026-11-12, from a picture they sent, kept private): none of the four fan hoods above. A solid
// teardrop cowl closing round the head with the face sunk in it, two small close-set red eyes, long insect arms bent
// out at the elbow with hooked talons hanging past the waist, a lean ribbed bronze chest, and a narrow pleated column
// of a skirt that glows green at the hem and fades into the mist it hovers in.
const COWL_NOTE = "the owner's picture: teardrop cowl, small red eyes, insect arms with talons, ribbed chest, skirt fading into green mist";
// how the mist it hovers in ties into its moves (spirit and venom; its signature is Hissing Mist in src/creatures.ts),
// shown under its strip on the candidate page. Proposals for the owner: no move changes in the game yet.
const COWL_MIST = [
  "Hissing Mist (its signature, venom breath): the green glow at the hem flares and a poison mist rolls out ahead of it. A foe who stays in the mist is poisoned a little more each second; stepping out stops it getting worse.",
  "Draining Fog (spirit): it sinks into a grey-green fog that spreads round it. Foes inside slowly lose stamina and it heals by what they lose. While the fog is up, its skirt fades from the hem upward, so you can see it drawing the fog in.",
  "Hovering in its own mist: with no legs it floats, so a hit slides it back instead of knocking it down. When it has used up its mist the hem glow goes dim: that is the moment it is open.",
];
export function cowl() {
  const nodes: Record<string, N> = {
    hem: [0, 0.4, 0, 0.16],
    base: [0, 0.95, 0, 0.17],
    waist: [0.01, 1.42, 0, 0.13],
    chest: [0.03, 1.78, 0, 0.16],
    neck: [0.06, 2.04, 0, 0.08],
    head: [0.1, 2.22, 0, 0.09],
    hood: [-0.04, 2.5, 0, 0.12],
    peak: [-0.08, 2.85, 0, 0.04],
    l_shoulder: [0.02, 1.98, 0.27, 0.06],
    l_elbow: [0.0, 1.62, 0.56, 0.04],
    l_wrist: [0.2, 1.2, 0.5, 0.032],
    l_hand: [0.26, 1.08, 0.46, 0.028],
  };
  const links = [...chain(["hem", "base", "waist", "chest", "neck", "head"]), ...chain(["neck", "hood", "peak"]), ...chain(["chest", "l_shoulder", "l_elbow", "l_wrist", "l_hand"])];
  const blobs: Blob[] = [];
  const by = (yy: number) => f4(yy - nodes.base![1]);

  // the skirt: a narrow column, barely flaring, with deep straight pleats
  const hemY = 0.36, waistY = nodes.waist![1], rAt = (yy: number) => 0.37 + (0.24 - 0.37) * ((yy - hemY) / (waistY - hemY));
  for (let t = 0; t < 6; t++) {
    const yc = hemY + ((waistY - hemY) * (t + 0.5)) / 6, r = f4(rAt(yc) - 0.03);
    blobs.push({ at: "base", off: [0, by(yc), 0], r: [r, f4((waistY - hemY) * 0.12), r] });
  }
  const tilt = (Math.atan2(0.37 - 0.24, waistY - hemY) * 180) / Math.PI, midY = (hemY + waistY) / 2 + 0.02;
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a), fr = f4(rAt(midY) - 0.02);
    blobs.push({ at: "base", off: [f4(fr * c), by(midY), f4(fr * s)], r: [0.035, f4((waistY - hemY) * 0.47), 0.035], rot: [f4(-tilt * s), 0, f4(tilt * c)] });
  }
  // a narrow waist, a lean chest with rib bands across its front, shoulders, a thin neck
  blobs.push(
    { at: "waist", off: [0, 0.02, 0], r: [0.19, 0.16, 0.22] },
    { at: "chest", off: [0, 0, 0], r: [0.19, 0.26, 0.27] },
    { at: "chest", off: [0.02, 0.14, 0], r: [0.17, 0.12, 0.31] },
    ...[-0.14, -0.06, 0.02, 0.1].map((dy, i): Blob => ({ at: "chest", off: [0.06, dy, 0], r: [0.15, 0.025, 0.26 - i * 0.01 + (dy > 0 ? 0.02 : 0)] })),
    ...pair("l_shoulder", [0, 0, 0], [0.09, 0.08, 0.08]),
    { at: "neck", off: [0, 0, 0], r: [0.08, 0.1, 0.08] },
  );
  // insect arms: thin segments with knobbed joints, the elbow bent out and up, the forearm reaching down and forward
  blobs.push(
    ...bone(nodes, "l_shoulder", "l_elbow", 0.035, 0.035, 0.1),
    ...bone(nodes, "l_elbow", "l_wrist", 0.03, 0.03, 0.1),
    ...pair("l_elbow", [0, 0, 0], [0.05, 0.05, 0.05]),
    ...pair("l_wrist", [0.01, 0, 0], [0.04, 0.035, 0.04]),
    ...[0.3, 0.6].flatMap((t) => pair("l_elbow", mul([nodes.l_wrist![0] - nodes.l_elbow![0], nodes.l_wrist![1] - nodes.l_elbow![1], nodes.l_wrist![2] - nodes.l_elbow![2]], t), [0.038, 0.03, 0.038])),
    ...bone(nodes, "l_wrist", "l_hand", 0.03, 0.03, 0.2),
  );
  // the cowl: a teardrop shell round the head, widest at the cheeks, narrowing to a point well above the crown
  const hood: Blob[] = [
    { at: "hood", off: [0, -0.12, 0], r: [0.26, 0.3, 0.3] },
    { at: "hood", off: [-0.02, 0.1, 0], r: [0.2, 0.24, 0.22] },
    { at: "hood", off: [-0.03, 0.27, 0], r: [0.12, 0.17, 0.13] },
    { at: "peak", off: [0, -0.04, 0], r: [0.05, 0.1, 0.05] },
  ];
  // the face: a dark red mask set into the cowl's front, so the cowl's rim stands proud round it
  const face: Ell[] = [{ c: [0.07, -0.02, 0], r: [0.13, 0.16, 0.16] }];
  blobs.push(...hood, ...face.map((e) => ({ at: "head", off: e.c, r: e.r }) as Blob));
  const on = onSkin(face);
  const parts: Part[] = [];
  // the cowl's rim round the face: ridges standing on the hood around the mask
  for (const [a, len] of [[100, 0.16], [140, 0.14], [180, 0.12]] as [number, number][]) {
    const rad = (a * Math.PI) / 180;
    parts.push({ kind: "ridge", at: "head", off: [0.13, f4(0.16 * Math.cos(rad) + 0.02), f4(0.17 * Math.sin(rad))], dir: [0, f4(-Math.sin(rad)), f4(Math.cos(rad))], len, base: 0.035, curve: 25, bend: [0, f4(-Math.cos(rad)), f4(-Math.sin(rad))], mirror: true, material: "hood" });
  }
  // two small, close-set, glowing red eyes, a slit of a mouth
  parts.push({ kind: "eye", at: "head", off: on([0.1, 0.02, 0.045], norm([1, 0.05, 0.3]), 0.012), r: 0.03, mirror: true, material: "eye" });
  parts.push({ kind: "ridge", at: "head", off: on([0.12, -0.09, 0], [1, -0.2, 0], 0.004), dir: [0, 0, 1], len: 0.03, base: 0.006, curve: 10, bend: [-1, 0, 0], mirror: true, material: "dark" });
  // four long hooked talons hanging from each hand, past the waist
  parts.push(...[-0.03, -0.01, 0.01, 0.03].map((z): Part => ({ kind: "horn", at: "l_hand", off: [0.01, -0.01, z], dir: [0.5, -1, z * 5], len: 0.3, base: 0.016, tip_base: 0.003, curve: 75, bend: [1, 0.2, 0], mirror: true, material: "claw" })));
  // wisps of glowing mist licking up the skirt from the hem. They rise and stay inside a 0.42 m radius: the rig
  // counts any skeleton tip in a beast's bottom 15% as a foot, and wisps flaring out past about 0.45 m (the old
  // ones reached 0.5) grow a skeleton branch to the hem's rim, a stray foot
  for (let i = 0; i < 8; i++) {
    const a = ((i + 0.5) / 8) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    parts.push({ kind: "horn", at: "hem", off: [f4(0.3 * c), 0, f4(0.3 * s)], dir: norm([0.6 * c, 1, 0.6 * s]), len: 0.12, base: 0.045, tip_base: 0.006, curve: 50, bend: [f4(-s), 0, f4(c)], material: "mist" });
  }
  return {
    feet: 0, wings: 0, budget: 8000, root: "chest", material: "suit", blend: 0.022,
    palette: {
      suit: [0.2, 0.19, 0.12, 0.45, 0.25], hood: [0.08, 0.08, 0.07, 0.6, 0.1], face: [0.32, 0.05, 0.04, 0.6, 0, 0.35],
      eye: [1, 0.1, 0.06, 0.2, 0, 6], dark: [0.04, 0.02, 0.02, 0.7, 0], claw: [0.14, 0.13, 0.09, 0.4, 0.2],
      mist: [0.42, 0.95, 0.45, 0.9, 0, 1.4], skirt: [0.09, 0.1, 0.08, 0.7, 0],
    },
    paint: [
      { nodes: ["head"], material: "face" }, { nodes: ["hood", "peak"], material: "hood" },
      { nodes: ["base"], material: "skirt" }, { nodes: ["hem"], material: "mist" },
    ],
    nodes, links, blobs, parts,
  };
}

if (import.meta.main) {
  const [name, out] = process.argv.slice(2);
  if (name === "cowl") write("flatwoods-monster", { ...(out ? { candidate: COWL_NOTE, notes: COWL_MIST } : {}), ...cowl() }, out);
  else if (!name || !LOOKS[name]) { console.error(`usage: bun proposals/compendium/flatwoods-monster.ts <cowl|${VARIANTS.join("|")}> [out.json]`); process.exit(1); }
  else write("flatwoods-monster", { ...(out ? { candidate: LOOKS[name]!.note } : {}), ...sheet(name) }, out);
}
