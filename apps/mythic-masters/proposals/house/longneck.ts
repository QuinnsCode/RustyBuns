// The house long-neck (docs/ART-STYLE.md): `bun proposals/house/longneck.ts [id ...]` writes beasts/<id>.json for
// each beast in BEASTS below (all of them, given none); `bun scripts/beasts.ts <id>` builds it. A big round body with
// humps on its back, four short legs ending in broad flippers or feet, a thick tapering tail held off the ground, and
// a long neck rising to a round head at least 1.6 times as wide as the neck under it (rule 1), all from the kit.
import { type Blob, type Entry, type FaceOpts, type FootForm, type HeadOpts, type N, type Part, type V, DENSE, face, foot, head, hide, limb, palette, pick, writeSheet, type HidePattern, type PaletteOpts } from "./kit.ts";
import { chain, f4 } from "../set-a/upright/lib.ts";

export interface LongNeck {
  /** Overall size: 1 is a lake beast about 3.6 m nose to tail and 2.8 m to the top of its head. */
  k: number;
  /** The body's length, depth and width in k (1.9, 1.0, 1.2), and how high its belly rides (0.2 of its depth). */
  body?: [number, number, number];
  clear?: number;
  /** Humps on the back: each [where along the body, -1 tail to 1 chest; size in k]. */
  humps?: [number, number][];
  /** The neck: where it reaches to, [forward, up] in k from the chest's top ([0.65, 1.75]), its thickness at the
   *  base and the top in k (0.28, 0.16), and how far it bows forward in the middle (0.12). */
  reach?: [number, number];
  neck?: [number, number];
  bow?: number;
  /** The legs: top half-width in k (0.16), the feet's form and size. */
  leg?: number;
  feet: FootForm;
  footSize?: number;
  /** The tail: length in k (1.0), thickness at the root (0.32). */
  tail?: number;
  tailThick?: number;
  head: Omit<HeadOpts, "at">;
  face?: FaceOpts;
  pal: PaletteOpts;
  skin: { pattern: HidePattern; size?: number; contrast?: number; cover?: number };
  trait?: (b: Built) => Part[];
  blend?: number;
  extra?: Record<string, Entry>;
}

export interface Built { nodes: Record<string, N>; k: number; head: ReturnType<typeof head>; neck: string[] }

export function longneck(o: LongNeck) {
  const k = o.k, s = (x: number) => f4(x * k);
  const [BL, BD, BW] = o.body ?? [1.9, 1.0, 1.2];
  const cy = (o.clear ?? 0.2) * BD + BD / 2;
  const N4 = (x: number, y: number, z: number, r: number): N => [s(x), s(y), s(z), s(r)];
  const [rx, ry] = o.reach ?? [0.65, 1.75], [nb, nt] = o.neck ?? [0.28, 0.16], bow = o.bow ?? 0.12;
  const base: V = [BL * 0.36, cy + BD * 0.28, 0];
  const sole = 0.1, legTop = o.leg ?? 0.16, lz = BW * 0.42;
  const nodes: Record<string, N> = {
    hip: N4(-BL * 0.3, cy, 0, 0.2),
    belly: N4(0, cy, 0, 0.24),
    chest: N4(BL * 0.3, cy + 0.02, 0, 0.22),
    l_shoulder: N4(BL * 0.28, cy - BD * 0.15, lz * 0.8, 0.08),
    l_felbow: N4(BL * 0.34, (cy - BD * 0.15 + sole) * 0.5, lz + 0.05, 0.07),
    l_ffoot: N4(BL * 0.38, sole, lz + 0.1, 0.06),
    l_hipj: N4(-BL * 0.28, cy - BD * 0.15, lz * 0.8, 0.08),
    l_bknee: N4(-BL * 0.33, (cy - BD * 0.15 + sole) * 0.5, lz + 0.05, 0.07),
    l_bfoot: N4(-BL * 0.36, sole, lz + 0.1, 0.06),
  };
  // the neck: a bowed curve from the chest's top to under the head, a node every quarter, thinning as it rises
  const neck = ["neck1", "neck2", "neck3"];
  neck.forEach((n, i) => {
    const u = (i + 1) / 4, b = Math.sin(Math.PI * u) * bow;
    nodes[n] = N4(base[0] + rx * u * u + b, base[1] + ry * u, 0, 0.1);
  });
  const W = o.head.w;
  nodes.head = N4(base[0] + rx + W * 0.35, base[1] + ry + W * 0.3, 0, 0.08);
  const TL = o.tail ?? 1.0;
  ["tail1", "tail2", "tail3"].forEach((n, i) => {
    const u = (i + 1) / 3;
    nodes[n] = N4(-BL * 0.45 - TL * u, cy + BD * 0.05 - TL * 0.12 * u, 0, 0.12 - 0.03 * i);
  });
  const links = [
    ...chain(["tail3", "tail2", "tail1", "hip", "belly", "chest", ...neck, "head"]),
    ...chain(["chest", "l_shoulder", "l_felbow", "l_ffoot"]),
    ...chain(["hip", "l_hipj", "l_bknee", "l_bfoot"]),
  ];
  const h = head({ ...o.head, w: s(W) });
  const blobs: Blob[] = [
    { at: "belly", off: [0, 0, 0], r: [s(BL * 0.5), s(BD * 0.5), s(BW * 0.5)] },
    { at: "chest", off: [s(0.05), s(0.05), 0], r: [s(BL * 0.26), s(BD * 0.44), s(BW * 0.42)] },
  ];
  for (const [t, size] of o.humps ?? [[-0.35, 0.34], [0.2, 0.3]]) blobs.push({ at: "belly", off: [s(t * BL * 0.45), s(BD * 0.36), 0], r: [s(size * 1.15), s(size), s(size * 1.05)] });
  // the neck and tail: one smooth loft each, built into the skin (a row of ellipsoids reads as a string of beads)
  const tt = o.tailThick ?? 0.32;
  const neckLoft = limb({ along: ["chest", ...neck, "head"], radii: [s(nb * 1.1), s(nb), s(nb + (nt - nb) * 0.45), s(nt), s(nt * 0.95)], knee: 0, calf: 0, shoulder: 0.2, depth: 1.05, mirror: false, material: "hide" });
  const tailLoft = limb({ along: ["hip", "tail1", "tail2", "tail3"], radii: [s(tt * 1.2), s(tt), s(tt * 0.6), s(tt * 0.28)], knee: 0, calf: 0, shoulder: 0, depth: 0.8, mirror: false, material: "hide" });
  const fLeg = limb({ along: ["l_shoulder", "l_felbow", "l_ffoot"], top: s(legTop), thin: 0.65, material: "hide" });
  const bLeg = limb({ along: ["l_hipj", "l_bknee", "l_bfoot"], top: s(legTop), thin: 0.65, material: "hide" });
  const fc = face(h, o.face);
  const parts: Part[] = [
    ...fc.parts, fLeg.part, bLeg.part, neckLoft.part, tailLoft.part,
    foot({ at: "l_ffoot", form: o.feet, low: fLeg.low, size: o.footSize ?? 1.5, sole: s(sole), material: "hide" }),
    foot({ at: "l_bfoot", form: o.feet, low: bLeg.low, size: o.footSize ?? 1.5, sole: s(sole), material: "hide" }),
  ];
  const built: Built = { nodes, k, head: h, neck };
  if (o.trait) parts.push(...o.trait(built));
  return {
    feet: 4, wings: 0, root: "belly", material: "hide", belly: "belly", belly_turn: -0.3, blend: o.blend ?? s(0.028),
    eyes: fc.eyes, dense: DENSE,
    palette: { ...palette(o.pal), ...o.extra }, hide: hide(o.skin.pattern, o.pal.body, o.skin),
    nodes, links, blobs: [...blobs, ...h.blobs], parts,
    check: { headOverNeck: f4(W / nt), eye: fc.share, legThin: f4(fLeg.low / fLeg.radii[0]!), foot: o.footSize ?? 1.5 },
  };
}

// ------------------------------------------------------------------------------------------------ the beasts

const BEASTS: Record<string, () => ReturnType<typeof longneck>> = {
  // The Loch Ness Monster: a great dark body with humps breaking the water, four flippers, a long neck. A child draws:
  // the humps and the long neck with a little head. The neck is the trait, made big (and its head kept big, rule 1);
  // the accent is a row of soft coral knobs up the back of the neck and over the humps.
  nessie: () => longneck({
    k: 1, feet: "flipper", footSize: 1.55, body: [1.9, 1.0, 1.2], humps: [[-0.4, 0.34], [0.15, 0.3]],
    reach: [0.6, 1.6], neck: [0.3, 0.19], bow: 0.14, leg: 0.24, clear: 0.18, tail: 1.05, tailThick: 0.3,
    head: { w: 0.36, tall: 0.9, long: 1.05, muzzle: 0.26, snout: 0.62, flat: 0.8, drop: 0.25, cheeks: 0.42 },
    face: { eye: 0.32, wide: 34, high: 10, teeth: "row", grin: 0.55, nose: "dots" },
    pal: { body: [0.25, 0.46, 0.42], belly: [0.76, 0.8, 0.64], accent: [0.95, 0.56, 0.38], iris: [0.95, 0.7, 0.2] },
    skin: { pattern: "wet", size: 0.22, contrast: 0.08, cover: 0.1 },
    trait: ({ neck }) => [
      { kind: "spikes", along: ["chest", ...neck, "head"], n: 7, len: 0.09, base: 0.1, lean: -0.6, sink: 0.92, material: "accent" },
      { kind: "spikes", along: ["tail3", "tail2", "tail1", "hip", "belly"], n: 6, len: 0.1, base: 0.11, lean: -0.4, sink: 0.95, material: "accent" },
    ],
  }),
};

if (import.meta.main) for (const id of pick(BEASTS)) {
  const { check, ...sheet } = BEASTS[id]!();
  console.log(id, JSON.stringify(check));
  writeSheet(id, sheet);
}
