// The house quadruped (docs/ART-STYLE.md): `bun proposals/house/quadruped.ts [id ...]` writes beasts/<id>.json for
// each beast in BEASTS below (all of them, given none); `bun scripts/beasts.ts <id>` builds it. A beast here is a
// short list of numbers: a round trunk of three blobs, short thick legs built into the skin with big feet, a neck,
// a head and face from the kit, and the one legend trait (`trait`) made big.
import { type Blob, type Entry, type FaceOpts, type FootForm, type HeadOpts, type N, type Part, type V, DENSE, ear, face, foot, head, hide, limb, palette, pick, writeSheet, type HidePattern, type PaletteOpts } from "./kit.ts";
import { chain, f4 } from "../set-a/upright/lib.ts";

export interface Quad {
  /** Overall size: 1 is a pony about 1.5 m to the top of the head. */
  k: number;
  /** The trunk's length, depth and width in k (1.15, 0.62, 0.6). */
  trunk?: [number, number, number];
  /** The leg's top half-width in k (0.13), its narrowest share (0.62), the foot's form and size in the leg's width (1.45). */
  leg?: number;
  thin?: number;
  feet: FootForm;
  footSize?: number;
  footTall?: number;
  toes?: number;
  /** The belly's height off the ground as a share of the trunk's depth (0.45; rule 3: at most 0.5). */
  clear?: number;
  /** The neck: its length in k (0.42), how far it leans forward from upright in degrees (35), its thickness in k (0.17). */
  neck?: number;
  lean?: number;
  thick?: number;
  /** The head: `w` in k, the rest as the kit's. Its face, as the kit's. */
  head: Omit<HeadOpts, "at"> ;
  face?: FaceOpts;
  /** The tail: length in k (0.5) and how far it hangs (0.6: 0 straight back, 1 straight down). */
  tail?: number;
  droop?: number;
  pal: PaletteOpts;
  skin: { pattern: HidePattern; size?: number; contrast?: number; cover?: number };
  /** The legend's trait, and anything else the beast adds: parts from the built nodes and head. */
  trait?: (q: Built) => Part[];
  blend?: number;
  extra?: Record<string, Entry>;
}

export interface Built { nodes: Record<string, N>; k: number; head: ReturnType<typeof head>; }

export function quadruped(o: Quad) {
  const k = o.k, s = (x: number) => f4(x * k);
  const [TL, TD, TW] = o.trunk ?? [1.15, 0.62, 0.6];
  const clear = (o.clear ?? 0.45) * TD;
  const cy = clear + TD / 2; // the trunk's middle height, in k
  const legTop = o.leg ?? 0.13, z = TW / 2 - legTop * 0.7;
  const N4 = (x: number, y: number, zz: number, r: number): N => [s(x), s(y), s(zz), s(r)];
  const sole = 0.1; // the ankle node's height: the foot fills down to the ground under it
  const nodes: Record<string, N> = {
    hip: N4(-TL * 0.32, cy, 0, 0.12),
    belly: N4(0, cy - 0.02, 0, 0.14),
    chest: N4(TL * 0.32, cy + 0.02, 0, 0.14),
    l_shoulder: N4(TL * 0.3, cy - 0.05, z, 0.06),
    l_elbow: N4(TL * 0.33 + 0.015, (clear + sole) * 0.55 + 0.02, z + 0.01, 0.05),
    l_ffoot: N4(TL * 0.32, sole, z + 0.01, 0.045),
    l_hipj: N4(-TL * 0.3, cy - 0.04, z, 0.06),
    l_knee: N4(-TL * 0.34 - 0.025, (clear + sole) * 0.55 + 0.02, z + 0.01, 0.05),
    l_bfoot: N4(-TL * 0.31, sole, z + 0.01, 0.045),
  };
  const lean = ((o.lean ?? 35) * Math.PI) / 180, NL = o.neck ?? 0.42;
  const nb: V = [TL * 0.42, cy + TD * 0.2, 0];
  const nt: V = [nb[0] + Math.sin(lean) * NL, nb[1] + Math.cos(lean) * NL, 0];
  nodes.neck = N4(nb[0] + Math.sin(lean) * NL * 0.45, nb[1] + Math.cos(lean) * NL * 0.45, 0, 0.08);
  const W = o.head.w; // in k
  nodes.head = N4(nt[0] + W * 0.4, nt[1] + W * 0.25, 0, 0.06);
  const TLn = o.tail ?? 0.5, dr = o.droop ?? 0.6;
  const t0: V = [-TL * 0.48, cy + TD * 0.18, 0];
  for (let i = 1; i <= 3; i++) {
    const u = i / 3;
    nodes[`tail${i}`] = N4(t0[0] - TLn * u * (1 - dr * 0.6 * u), t0[1] - TLn * dr * u * u * 0.9 + 0.02 * (1 - u), 0, 0.05 - 0.012 * i);
  }
  const links = [
    ...chain(["tail3", "tail2", "tail1", "hip", "belly", "chest", "neck", "head"]),
    ...chain(["chest", "l_shoulder", "l_elbow", "l_ffoot"]),
    ...chain(["hip", "l_hipj", "l_knee", "l_bfoot"]),
  ];
  const h = head({ ...o.head, w: s(W) });
  const body: Blob[] = [
    { at: "chest", off: [0, 0, 0], r: [s(TL * 0.42), s(TD * 0.52), s(TW * 0.5)] },
    { at: "belly", off: [0, 0, 0], r: [s(TL * 0.44), s(TD * 0.5), s(TW * 0.5)] },
    { at: "hip", off: [0, s(0.01), 0], r: [s(TL * 0.4), s(TD * 0.5), s(TW * 0.49)] },
    // the neck: one tilted ellipsoid from the shoulders up into the back of the head
    { at: "neck", off: [0, 0, 0], r: [s(o.thick ?? 0.17), s(NL * 0.62), s((o.thick ?? 0.17) * 0.85)], rot: [0, 0, f4(-(o.lean ?? 35))] },
  ];
  const fLeg = limb({ along: ["l_shoulder", "l_elbow", "l_ffoot"], top: s(legTop), thin: o.thin, knee: 0.34, material: "hide" });
  const bLeg = limb({ along: ["l_hipj", "l_knee", "l_bfoot"], top: s(legTop * 1.08), thin: o.thin, knee: 0.34, calf: 0.25, material: "hide" });
  const fc = face(h, o.face);
  const feetMat = o.feet === "hoof" ? "hooves" : "hide"; // not "hoof": beast.py coats any `hoof` material glossy
  const parts: Part[] = [
    ...fc.parts,
    fLeg.part, bLeg.part,
    foot({ at: "l_ffoot", form: o.feet, low: fLeg.low, size: o.footSize, sole: s(sole), toes: o.toes, tall: o.footTall, material: feetMat }),
    foot({ at: "l_bfoot", form: o.feet, low: bLeg.low, size: o.footSize, sole: s(sole), toes: o.toes, tall: o.footTall, material: feetMat }),
  ];
  const built: Built = { nodes, k, head: h };
  if (o.trait) parts.push(...o.trait(built));
  const pal = { ...palette(o.pal), ...o.extra };
  return {
    feet: 4, wings: 0, root: "belly", material: "hide", belly: "belly", belly_turn: -0.3, blend: o.blend ?? s(0.018),
    eyes: fc.eyes, dense: { ...DENSE, accent: 0.7 },
    palette: pal, hide: hide(o.skin.pattern, o.pal.body, o.skin),
    nodes, links, blobs: [...body, ...h.blobs], parts,
    check: { headLen: f4((h.tip[0] - (h.cran.c[0] - h.cran.r[0])) / s(TL)), eye: fc.share, legThin: f4(fLeg.low / fLeg.radii[0]!), foot: f4(2 * fLeg.low * (o.footSize ?? 1.45) / (2 * fLeg.low)) },
  };
}

// ------------------------------------------------------------------------------------------------ the beasts

const BEASTS: Record<string, () => ReturnType<typeof quadruped>> = {
  // The Kelpie: a dark water horse that waits on the bank. A child draws: a horse, its dripping weedy mane. The mane
  // is the trait, made big: heavy wet locks in weed green from the forelock down the whole crest and the tail.
  kelpie: () => quadruped({
    k: 1, feet: "hoof", trunk: [1.0, 0.66, 0.62], leg: 0.14, thin: 0.66, footSize: 1.5, footTall: 1.5,
    neck: 0.4, lean: 30, thick: 0.21,
    head: { w: 0.21, tall: 0.95, long: 1.0, muzzle: 0.32, snout: 0.7, flat: 0.88, drop: 0.3, droop: 20, cheeks: 0.45 },
    face: { eye: 0.33, wide: 34, high: 8, sink: 0.38, teeth: "buck", grin: 0.55, nose: "dots" },
    tail: 0.5, droop: 0.5,
    pal: { body: [0.17, 0.27, 0.36], belly: [0.42, 0.55, 0.6], accent: [0.22, 0.56, 0.42], iris: [0.25, 0.7, 0.78], roughness: 0.6, extra: { hooves: [0.3, 0.27, 0.25, 0.85, 0] } },
    skin: { pattern: "wet", size: 0.18, contrast: 0.14, cover: 0.08 },
    trait: ({ head: h }) => [
      { kind: "lock", along: ["head", "neck", "chest"], n: 8, len: 0.58, base: 0.16, rows: 3, spread: 32, sweep: 1.1, curve: 45, flat: 0.55, twist: 45, material: "accent" },
      { kind: "lock", along: ["head", "neck"], n: 3, len: 0.3, base: 0.11, rows: 2, spread: 20, sweep: -0.6, curve: 40, flat: 0.55, material: "accent" },
      { kind: "lock", along: ["tail1", "tail2", "tail3"], n: 4, len: 0.3, base: 0.11, rows: 4, spread: 80, sweep: 1.2, curve: 40, material: "accent" },
      ear(h, { from: [-0.35, 1, 0.55], dir: [-0.3, 1, 0.35], len: 0.9, width: 0.45, tilt: 18, cup: 30, point: 0.4, material: "hide" }),
    ],
  }),
};

if (import.meta.main) for (const id of pick(BEASTS)) {
  const { check, ...sheet } = BEASTS[id]!();
  console.log(id, JSON.stringify(check));
  writeSheet(id, sheet);
}
