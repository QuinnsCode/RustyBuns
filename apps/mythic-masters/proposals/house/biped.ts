// The house biped (docs/ART-STYLE.md): `bun proposals/house/biped.ts [id ...]` writes beasts/<id>.json for each
// beast in BEASTS below (all of them, given none); `bun scripts/beasts.ts <id>` builds it. An upright beast as a
// chunky toy: a pot belly under a broad chest, short thick legs on big feet, thick arms with big hands hanging
// clear of the ground, and a head 0.30 to 0.38 of the standing height (rule 1), all from the kit.
import { type Blob, type Entry, type FaceOpts, type FootForm, type HeadOpts, type N, type Part, DENSE, ear, face, horn, foot, head, hide, limb, palette, pick, writeSheet, type HidePattern, type PaletteOpts } from "./kit.ts";
import { chain, f4 } from "../set-a/upright/lib.ts";

export interface Biped {
  /** Overall size: 1 is a big man about 2.2 m to the crown. */
  k: number;
  /** The leg's length (hip to ankle) in k (0.62; rule 3: no longer than trunk plus head), its top half-width in k (0.16). */
  legLen?: number;
  leg?: number;
  thin?: number;
  /** The trunk: hip-to-shoulder length (0.72), its width and depth (0.78, 0.55) in k, and the belly's swell (1). */
  trunk?: [number, number, number];
  belly?: number;
  /** The arm's top half-width in k (0.12), its length (0.72), and how far out from the body the hands hang (0.1). */
  arm?: number;
  armLen?: number;
  splay?: number;
  feet: FootForm;
  footSize?: number;
  hands?: { size?: number; claw?: number; curl?: number };
  head: Omit<HeadOpts, "at">;
  /** How far forward of the shoulders the head sits in its own width (0.35): a heavy head leans out. */
  jut?: number;
  face?: FaceOpts;
  pal: PaletteOpts;
  skin: { pattern: HidePattern; size?: number; contrast?: number; cover?: number };
  trait?: (b: Built) => Part[];
  blend?: number;
  extra?: Record<string, Entry>;
}

export interface Built { nodes: Record<string, N>; k: number; head: ReturnType<typeof head> }

export function biped(o: Biped) {
  const k = o.k, s = (x: number) => f4(x * k);
  const [TL, TW, TD] = o.trunk ?? [0.72, 0.78, 0.55];
  const LL = o.legLen ?? 0.62, sole = 0.11;
  const hipY = sole + LL, shY = hipY + TL;
  const N4 = (x: number, y: number, z: number, r: number): N => [s(x), s(y), s(z), s(r)];
  const legZ = TW * 0.26, armZ = TW * 0.5 + (o.arm ?? 0.12) * 0.6 + (o.splay ?? 0.1);
  const AL = o.armLen ?? 0.72;
  const W = o.head.w;
  const nodes: Record<string, N> = {
    hip: N4(0, hipY + 0.05, 0, 0.15),
    belly: N4(0.02, hipY + TL * 0.38, 0, 0.18),
    chest: N4(0.03, hipY + TL * 0.78, 0, 0.18),
    neck: N4(0.08, shY + 0.06, 0, 0.12),
    head: N4(0.1 + (o.jut ?? 0.35) * W, shY + 0.08 + W * 0.95, 0, 0.08),
    l_hipj: N4(0, hipY, legZ, 0.08),
    l_knee: N4(0.05, sole + LL * 0.5, legZ + 0.01, 0.07),
    l_ankle: N4(0, sole, legZ + 0.01, 0.06),
    l_shoulder: N4(0, shY - 0.06, TW * 0.46, 0.07),
    l_elbow: N4(-0.04, shY - 0.06 - AL * 0.5, armZ - 0.02, 0.06),
    l_hand: N4(0.06, shY - 0.06 - AL, armZ, 0.05),
  };
  const links = [
    ...chain(["hip", "belly", "chest", "neck", "head"]),
    ...chain(["hip", "l_hipj", "l_knee", "l_ankle"]),
    ...chain(["chest", "l_shoulder", "l_elbow", "l_hand"]),
  ];
  const h = head({ ...o.head, w: s(W) });
  const B = o.belly ?? 1;
  const body: Blob[] = [
    { at: "chest", off: [0, s(0.02), 0], r: [s(TD * 0.5), s(TL * 0.36), s(TW * 0.5)] },
    { at: "belly", off: [s(0.03 * B), 0, 0], r: [s(TD * 0.52 * B), s(TL * 0.38), s(TW * 0.46)] },
    { at: "hip", off: [0, s(0.04), 0], r: [s(TD * 0.44), s(TL * 0.26), s(TW * 0.44)] },
    // shoulders: round caps the arms grow from, and a thick neck into the back of the head
    { at: "l_shoulder", off: [0, s(0.03), 0], r: [s(0.15), s(0.14), s(0.15)] },
    { at: "r_shoulder", off: [0, s(0.03), 0], r: [s(0.15), s(0.14), s(0.15)] },
    { at: "neck", off: [0, s(0.05), 0], r: [s(W * 0.75), s(0.18), s(W * 0.8)] },
  ];
  const leg = limb({ along: ["l_hipj", "l_knee", "l_ankle"], top: s(o.leg ?? 0.16), thin: o.thin ?? 0.68, knee: 0.25, material: "hide" });
  const arm = limb({ along: ["l_shoulder", "l_elbow", "l_hand"], top: s(o.arm ?? 0.12), thin: 0.7, knee: 0.25, calf: 0.25, material: "hide" });
  const fc = face(h, o.face);
  const hs = o.hands ?? {};
  const parts: Part[] = [
    ...fc.parts, leg.part, arm.part,
    foot({ at: "l_ankle", form: o.feet, low: leg.low, size: o.footSize, sole: s(sole), long: 1.15, tall: 1.3, material: o.feet === "hoof" ? "hooves" : "hide" }), // not "hoof": beast.py coats any `hoof` material glossy
    foot({ at: "l_hand", form: "hand", low: arm.low, size: hs.size ?? 1.5, sole: 0, long: 1.1, claw: hs.claw ?? 0, curl: hs.curl ?? 55, dir: [0.15, -1, 0], palm: [0.2, 0, -1], material: "hide" }),
  ];
  const built: Built = { nodes, k, head: h };
  if (o.trait) parts.push(...o.trait(built));
  // rule 1, measured: the head's height (crown to chin) over the standing height (to the crown)
  const crown = nodes.head![1] + h.cran.c[1] + h.cran.r[1];
  const chin = nodes.head![1] + Math.min(...h.ells.map((e) => e.c[1] - e.r[1]));
  return {
    feet: 2, wings: 0, root: "belly", material: "hide", belly: "belly", belly_turn: -0.25, blend: o.blend ?? s(0.02),
    eyes: fc.eyes, dense: DENSE,
    palette: { ...palette(o.pal), ...(o.extra ?? {}) }, hide: hide(o.skin.pattern, o.pal.body, o.skin),
    nodes, links, blobs: [...body, ...h.blobs], parts,
    check: { head: f4((crown - chin) / crown), legOverTrunkHead: f4(LL / (TL + (crown - chin) / k)), eye: fc.share, legThin: f4(leg.low / leg.radii[0]!), hand: hs.size ?? 1.5 },
  };
}

// ------------------------------------------------------------------------------------------------ the beasts

const BEASTS: Record<string, () => ReturnType<typeof biped>> = {
  // The Minotaur: the body of a huge man, the head of a bull. A child draws: the bull's head and its wide sweeping
  // horns. The horns are the trait, made big: ivory, sweeping out wider than the shoulders and up at the tips.
  minotaur: () => biped({
    k: 1, feet: "hoof", footSize: 1.45, legLen: 0.6, leg: 0.17, trunk: [0.72, 0.8, 0.56], belly: 1.1, arm: 0.15, armLen: 0.66, splay: 0.06,
    hands: { size: 1.5, curl: 60 },
    head: { w: 0.34, tall: 0.95, long: 0.95, muzzle: 0.3, snout: 0.86, flat: 0.74, drop: 0.42, droop: 6, cheeks: 0.4 },
    jut: 0.3,
    face: { eye: 0.3, wide: 36, high: 6, teeth: "fangs", tooth: 0.14, grin: 0.6, nose: "pad", mood: "fierce" },
    pal: { body: [0.5, 0.3, 0.19], belly: [0.84, 0.68, 0.5], accent: [0.95, 0.89, 0.72], iris: [0.95, 0.62, 0.15], extra: { hooves: [0.3, 0.24, 0.2, 0.85, 0] } },
    skin: { pattern: "velvet", size: 0.18, contrast: 0.06 },
    trait: ({ head: h }) => [
      horn(h, { from: [-0.1, 0.6, 0.8], dir: [0.12, -0.08, 1], len: 3.0, base: 0.3, curve: 75, bend: [0.45, 1, 0], material: "accent" }),
      ear(h, { from: [-0.3, 0.25, 1], dir: [-0.2, -0.15, 1], len: 0.62, width: 0.32, tilt: 10, cup: 30, thick: 0.35, material: "hide" }),
    ],
  }),
};

if (import.meta.main) for (const id of pick(BEASTS)) {
  const { check, ...sheet } = BEASTS[id]!();
  console.log(id, JSON.stringify(check));
  writeSheet(id, sheet);
}
