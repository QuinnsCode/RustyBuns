// The house kit (docs/ART-STYLE.md): one head, one face, one limb and one foot for the whole roster. Each function
// returns sheet pieces (blobs, parts, palette entries) that a body plan (quadruped.ts, biped.ts, longneck.ts) puts
// together, so a beast is a short list of numbers. Nothing here writes a file but `writeSheet`.
//
// Sizes are metres in the game's frame (y up, facing +x, left = +z). A head's pieces are offsets from its node.
// The face is cast onto the head's own blobs (`onSkin`), so it sits on the skin the remesh (`blend`) will make.
//
// The eye, and how it gets along with the game: src/eyes.ts gives every ball in the `eye` material a slit pupil at
// runtime (and darkens that material for a blink). The house eye draws its own round pupil, so it uses no `eye`
// material at all and the game adds nothing: a `white` ball, an `iris` lens, a `pupil` lens and a `glint`, all
// turned to the game's gaze (forward, turned out 37 degrees: `gaze` in src/eyes.ts, `eye_gaze` in blender/beast.py),
// so the builder's lid ring (`eyes: {lids: true}`), which hoods the eye along that gaze, sits where the kit drew it.
import { readFileSync, writeFileSync } from "node:fs";
import { int, num, obj, opt } from "@rustybuns/util/guard";
import { SHEET_WHO } from "../../src/roster.ts";
import { type Blob as LibBlob, type Ell, type N, type Part, type V, add, f4, flipZ, mul, norm, skin } from "../set-a/upright/lib.ts";

export type { Ell, N, Part, V };
/** A blob on a sheet, with its own material (beast.py reads it for a lid; `blend` gives the skin the body's). */
export type Blob = LibBlob & { material?: string };
export type RGB = [number, number, number];
/** A palette entry as beast.py reads it: sRGB colour, roughness, metalness, and an optional glow strength. */
export type Entry = number[];

export const APP = `${import.meta.dir}/../..`;
const deg = (a: number) => (a * Math.PI) / 180;
/** The game's gaze for a left eye (src/eyes.ts `gaze`): forward, turned out to its side. */
export const GAZE: V = norm([1, 0, 0.75]);
/** A sheet's `dense`: the face's materials keep every triangle through the decimator (the body pays), so a thin
 *  smile line or a brow isn't collapsed away and the eyes stay round. */
export const DENSE = { white: 1, iris: 1, pupil: 1, glint: 1, mouth: 1, brow: 1, tooth: 1 };

// ---------------------------------------------------------------------------------------------- the head

export interface HeadOpts {
  /** The node the head hangs on ("head"). */
  at?: string;
  /** Half the head's width (the cranium's side radius), metres: the number every face size is measured in. */
  w: number;
  /** Cranium height and length in `w` (0.92, 1.0): a little lower than wide reads soft and toy-like. */
  tall?: number;
  long?: number;
  /** Where the cranium sits on the node, in `w` ([0, 0, 0]). */
  off?: V;
  /** The muzzle's reach past the cranium's front as a share of the skull's length (0: none; at most 0.6, rule 2). */
  muzzle?: number;
  /** The muzzle's thickness in `w` (0.6), its height in its thickness (0.85), and how far under the eye line it hangs in `w` (0.3). */
  snout?: number;
  flat?: number;
  drop?: number;
  /** Round cheeks under the eyes, in `w` (0.45; 0 none): they push the face's lower half out and make it glad. */
  cheeks?: number;
  /** A lower jaw blob under the muzzle, in `w` (0: none): a horse's chin, a bull's jowl. */
  jaw?: number;
  /** Tilts the muzzle down by degrees (0): a horse's or a bull's nose hangs. */
  droop?: number;
}

export interface Head {
  at: string;
  w: number;
  /** Every head ellipsoid as an offset from the node: the skin the face is cast onto. */
  ells: Ell[];
  cran: Ell;
  muz: Ell | null;
  blobs: Blob[];
  /** The head's width (2 w), for the style checks. */
  width: number;
  /** The muzzle's front tip (an offset), where the nose goes. */
  tip: V;
}

/** A round, soft head from blended blobs: a cranium, an optional short muzzle, cheeks and jaw. */
export function head(o: HeadOpts): Head {
  const w = o.w, at = o.at ?? "head", T = o.tall ?? 0.92, L = o.long ?? 1;
  const c0 = mul(o.off ?? [0, 0, 0], w);
  const cran: Ell = { c: c0, r: [f4(L * w), f4(T * w), f4(w)] };
  const ells: Ell[] = [cran];
  let muz: Ell | null = null;
  let tip: V = add(c0, [f4(L * w), f4(-0.15 * w), 0]);
  const m = Math.min(o.muzzle ?? 0, 0.6);
  if (m > 0) {
    const skullLen = 2 * L * w, front = c0[0] + L * w + m * skullLen, back = c0[0] + 0.15 * w;
    const S = o.snout ?? 0.6, rx = (front - back) / 2, dropY = -(o.drop ?? 0.3) * w;
    const tilt = deg(o.droop ?? 0);
    const cx = back + rx * Math.cos(tilt), cy = c0[1] + dropY - rx * Math.sin(tilt);
    muz = { c: [f4(cx), f4(cy), 0], r: [f4(rx), f4(S * (o.flat ?? 0.85) * w), f4(S * w)] };
    ells.push(muz);
    tip = [f4(cx + rx * Math.cos(tilt)), f4(cy - rx * Math.sin(tilt)), 0];
  }
  const ch = o.cheeks ?? 0.45;
  if (ch > 0) {
    const c: V = add(c0, mul([0.38, -0.42, 0.5], w)), r: V = mul([0.62, 0.52, 0.5], ch * w * 1.6);
    ells.push({ c, r }, { c: flipZ(c), r });
  }
  if (o.jaw && muz) ells.push({ c: [f4(muz.c[0] - 0.15 * muz.r[0]), f4(muz.c[1] - muz.r[1] * 0.55), 0], r: mul([muz.r[0] / w * 0.85, 0.32, 0.5], o.jaw * w) });
  // the cranium carries the `lid` material: the builder rings each eye in the material of the head's blob (`head_mat`), and the
  // remesh gives every blob the body's anyway, so this only colours the lids (the body's colour, out of the belly's tone)
  const blobs: Blob[] = ells.map((e, i) => ({ at, off: e.c, r: e.r, ...(i === 0 ? { material: "lid" } : {}) }));
  if (o.droop && muz) blobs[1] = { ...blobs[1]!, rot: [0, 0, f4(-(o.droop ?? 0))] };
  return { at, w, ells, cran, muz, blobs, width: 2 * w, tip };
}

/** A point on the head's skin cast from `from` (an offset) along `d`, sunk `sink` metres back in. */
export function onHead(h: Head, from: V, d: V, sink = 0, set: Ell[] = h.ells): V {
  const s = skin(set, from, norm(d)), n = norm(d);
  return [f4(s[0] - n[0] * sink), f4(s[1] - n[1] * sink), f4(s[2] - n[2] * sink)];
}

// ---------------------------------------------------------------------------------------------- the face

export type Teeth = "fangs" | "fang" | "buck" | "row" | "none";
export type Mood = "glad" | "fierce" | "shy";

export interface FaceOpts {
  /** Each eye's width as a share of the head's width (0.32; rule 4 says 0.28 to 0.36). */
  eye?: number;
  /** How far round the head the eyes sit, degrees from straight ahead (32): more is wider apart. */
  wide?: number;
  /** How high, degrees above the cranium's middle (8). */
  high?: number;
  /** How deep the white sits in the skin, in its radius (0.3). */
  sink?: number;
  /** The iris's and pupil's visible width as shares of the eye's (0.75, 0.45). */
  iris?: number;
  pupil?: number;
  /** The builder's lid ring in the body's colour round each eye, hooding the top (true). */
  lid?: boolean;
  /** Brow length in eye widths (0.9; 0 none), how far the inner end rises in degrees (24), and how far above the eye it sits in eye radii (1.25). */
  brow?: number;
  browTilt?: number;
  browUp?: number;
  /** Mouth width as a share of the head's width (0.5; 0 none) and how far its corners turn up, degrees (55). */
  grin?: number;
  smile?: number;
  /** Which teeth show (rule 4): one or two big fangs, buck teeth, a short neat row, or none ("fangs"). */
  teeth?: Teeth;
  /** Tooth length in `w` (0.22 for fangs, 0.12 buck, 0.07 row). */
  tooth?: number;
  /** Nostrils on the muzzle's tip ("dots"), a nose pad ("pad"), or none. */
  nose?: "dots" | "pad" | "none";
  /** A preset over the brow and grin: glad (the default), fierce (flatter brows, a wider grin), shy (high brows, small mouth). */
  mood?: Mood;
}

const MOODS: Record<Mood, Partial<FaceOpts>> = {
  glad: {},
  fierce: { browTilt: 14, browUp: 1.12, grin: 0.6, smile: 45 },
  shy: { browTilt: 34, browUp: 1.4, grin: 0.36, smile: 60 },
};

export interface Face {
  parts: Part[];
  /** The sheet's `eyes` setting: the builder keeps the kit's sizes and draws only the lid ring. */
  eyes: { scale: 1; sink: 0; lids: boolean; brows: false };
  /** Measured, for the style checks: each eye's width over the head's, and the eye's centre (an offset). */
  share: number;
  eyeAt: V;
}

/** THE HOUSE FACE: two eyes (white, iris, round pupil, one catchlight up and out), brows tipped up in the middle, a
 *  mouth whose corners turn up, and teeth. Every number has a default, so every beast gets the same face family. */
export function face(h: Head, opts: FaceOpts = {}): Face {
  const o: FaceOpts = { ...MOODS[opts.mood ?? "glad"], ...opts };
  const w = h.w, at = h.at, c0 = h.cran.c;
  const share = o.eye ?? 0.32, R = (share * h.width) / 2;
  const az = deg(o.wide ?? 32), el = deg(o.high ?? 8);
  const look: V = [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
  const surf = onHead(h, c0, look, 0, [h.cran, ...h.ells.slice(h.muz ? 2 : 1)]);
  const g = GAZE;
  const white = add(surf, mul(g, -(o.sink ?? 0.3) * R));
  // the iris and pupil are lenses: eggs flattened along the gaze and turned to it, each rim on the ball under it, so
  // each shows as its own clean outline (two coarse balls cut into each other show a ragged edge)
  const turn: V = [0, f4((-Math.atan2(g[2], g[0]) * 180) / Math.PI), 0];
  const aI = Math.min(o.iris ?? 0.75, 0.95) * R, dI = Math.sqrt(R * R - aI * aI), tI = R - dI + 0.05 * R;
  const aP = Math.min(o.pupil ?? 0.45, 0.7) * R, onIris = dI + tI * Math.sqrt(1 - (aP / aI) ** 2), tP = R + 0.05 * R - onIris + 0.04 * R;
  // the catchlight: on the iris's front, up and out from the pupil
  const up = norm([-g[0] * g[1], 1 - g[1] * g[1], -g[2] * g[1]]);
  const out = norm([g[1] * up[2] - g[2] * up[1], g[2] * up[0] - g[0] * up[2], g[0] * up[1] - g[1] * up[0]]);
  const sideOut: V = out[2] > 0 ? out : mul(out, -1);
  const glintAt = add(white, add(mul(g, R * 1.04), add(mul(up, aP * 0.95), mul(sideOut, aP * 0.55))));
  const parts: Part[] = [
    { kind: "eye", at, off: white, r: [f4(R), f4(R), f4(R)], mirror: true, material: "white" },
    { kind: "eye", at, off: add(white, mul(g, dI)), r: [f4(tI), f4(aI), f4(aI)], rot: turn, mirror: true, material: "iris" },
    { kind: "eye", at, off: add(white, mul(g, onIris)), r: [f4(tP), f4(aP), f4(aP)], rot: turn, mirror: true, material: "pupil" },
    { kind: "eye", at, off: glintAt, r: [f4(R * 0.06), f4(R * 0.14), f4(R * 0.14)], rot: turn, mirror: true, material: "glint" },
  ];
  // brows: a soft ridge above each eye from its outer end in toward the nose, the inner end higher (tipped up in the middle)
  const B = o.brow ?? 0.9;
  if (B > 0) {
    const len = B * 2 * R, tilt = deg(o.browTilt ?? 24), lift = (o.browUp ?? 1.25) * R;
    const mid = add(white, add(mul(up, lift), mul(g, R * 0.35)));
    const startFrom = add(mid, mul(sideOut, len * 0.5));
    const start = onHead(h, c0, add(startFrom, mul(c0, -1)), 0.004 * w, [h.cran]);
    const inward: V = mul(sideOut, -1);
    const dir = norm(add(mul(inward, Math.cos(tilt)), mul(up, Math.sin(tilt))));
    parts.push({ kind: "ridge", at, off: start, dir, len: f4(len), base: f4(R * 0.32), curve: 28, bend: mul(g, -1), mirror: true, material: "brow" });
  }
  // the mouth: a smile line from the middle of the lips (cast onto the skin the remesh makes, every head blob, cheeks
  // too) out round the muzzle to each corner, the corner higher than the middle so it turns up
  const G = o.grin ?? 0.5;
  const set = h.muz ? [h.muz] : [h.cran];
  const mc = h.muz ? h.muz.c : c0;
  const lipMid = onHead(h, mc, [1, -0.45, 0], 0.005 * w);
  if (G > 0) {
    // an arc round the muzzle: out to the side from the lip's middle, bending back by the corner's angle round the
    // muzzle, at the muzzle's own radius there, so it lies on the skin the whole way; tipped up so the corner rises
    const a = 18 + 70 * G, around = Math.max(lipMid[0] - mc[0], 0.2 * w);
    const up = Math.tan(deg((o.smile ?? 55) * 0.35));
    parts.push({ kind: "ridge", at, off: lipMid, dir: norm([0, up, 1]), len: f4(deg(a) * around), base: f4(0.11 * w), curve: f4(a), bend: [-1, 0, 0], mirror: true, material: "mouth" });
  }
  // teeth hang from the upper lip, just above the smile line
  const t = o.teeth ?? "fangs";
  const lipZ = (z: number) => onHead(h, mc, [1, -0.38, z], 0.03 * w);
  if (t === "fangs" || t === "fang") {
    const len = (o.tooth ?? 0.22) * w;
    parts.push({ kind: "horn", at, off: lipZ(0.45 + 0.3 * G), dir: [0.2, -1, 0.05], len: f4(len), base: f4(len * 0.3), tip_base: 0.002, curve: 10, bend: [1, 0, 0], ...(t === "fangs" ? { mirror: true } : {}), material: "tooth" });
  } else if (t === "buck") {
    const len = (o.tooth ?? 0.12) * w;
    parts.push({ kind: "horn", at, off: lipZ(0.09), dir: [0.25, -1, 0], len: f4(len), base: f4(len * 0.42), tip_base: f4(len * 0.36), flat: 0.45, bend: [1, 0, 0], mirror: true, material: "tooth" });
  } else if (t === "row") {
    const len = (o.tooth ?? 0.07) * w;
    for (const z of [0.1, 0.3, 0.5]) parts.push({ kind: "horn", at, off: lipZ(z), dir: [0.15, -1, 0], len: f4(len), base: f4(len * 0.45), tip_base: 0.002, mirror: true, material: "tooth" });
  }
  // the nose: two dark nostrils on the muzzle's tip, or a broad pad with the nostrils in its front
  const nose = o.nose ?? "dots";
  if (nose === "pad") {
    const tipAt = onHead(h, mc, [1, 0.15, 0], 0, set), pr: V = [f4(0.12 * w), f4(0.17 * w), f4(0.3 * w)];
    parts.push({ kind: "eye", at, off: add(tipAt, [-0.06 * w, 0, 0]), r: pr, material: "nose" });
    parts.push({ kind: "eye", at, off: add(tipAt, [0.045 * w, -0.01 * w, 0.14 * w]), r: [f4(0.03 * w), f4(0.06 * w), f4(0.05 * w)], mirror: true, material: "dark" });
  } else if (nose === "dots") {
    parts.push({ kind: "eye", at, off: onHead(h, mc, [1, 0.2, 0.32], 0.035 * w, set), r: f4(0.065 * w), mirror: true, material: "dark" });
  }
  return { parts, eyes: { scale: 1, sink: 0, lids: o.lid ?? true, brows: false }, share, eyeAt: white };
}

/** An ear on the head's skin: `from` a direction off the cranium's middle, `len` and `width` in `w`. */
export function ear(h: Head, o: { from: V; dir: V; len: number; width: number; tilt?: number; cup?: number; thick?: number; fold?: number; point?: number; material: string }): Part {
  const off = onHead(h, h.cran.c, o.from, 0.08 * h.w, [h.cran]);
  return { kind: "ear", at: h.at, off, dir: o.dir, len: f4(o.len * h.w), width: f4(o.width * h.w), tilt: o.tilt ?? 15, cup: o.cup ?? 25, thick: o.thick ?? 0.3, fold: o.fold ?? 0.2, point: o.point ?? 0, mirror: true, material: o.material };
}

/** A horn rooted in the head's skin: `from` a direction off the cranium's middle, `len` and `base` in `w` (rule 5: the trait, made big). */
export function horn(h: Head, o: { from: V; dir: V; len: number; base: number; curve?: number; bend?: V; mirror?: boolean; material: string }): Part {
  const off = onHead(h, h.cran.c, o.from, 0.12 * o.base * h.w, [h.cran]);
  return { kind: "horn", at: h.at, off, dir: o.dir, len: f4(o.len * h.w), base: f4(o.base * h.w), tip_base: f4(0.01 * h.w), curve: o.curve ?? 0, bend: o.bend ?? [0, 1, 0], segments: 10, mirror: o.mirror ?? true, material: o.material };
}

// ---------------------------------------------------------------------------------------------- limbs and feet

export interface LimbOpts {
  /** The `l_` nodes from the top (inside the body) to the ankle or wrist; `mirror` makes the twin. */
  along: string[];
  /** Half-width at the top, metres (needed unless `radii` gives every node's). */
  top?: number;
  /** The narrowest the limb gets, as a share of `top` (0.62; rule 3 floor is 0.45). */
  thin?: number;
  /** The knee or elbow knob (0.22), the calf bulge (0.15), fore-to-aft depth (1.1), the shoulder swell (0.15). */
  knee?: number;
  calf?: number;
  depth?: number;
  shoulder?: number;
  /** Each node's half-width in metres, in place of `top` and `thin`: a neck or tail may taper past a leg's floor. */
  radii?: number[];
  /** False for a neck or tail on the centreline: one loft, no twin (true). */
  mirror?: boolean;
  material: string;
}

/** A thick limb built into the skin (`limb` with `skin: true`), tapering smoothly from `top` to `top * thin` with a
 *  knee or elbow you can see. Returns the part and its narrowest half-width (for the foot and the checks). */
export function limb(o: LimbOpts): { part: Part; low: number; radii: number[] } {
  const thin = Math.max(o.thin ?? 0.62, 0.45), n = o.along.length;
  const radii = o.radii?.map(f4) ?? o.along.map((_, i) => f4((o.top ?? 0.1) * (1 - (1 - thin) * Math.pow(i / (n - 1), 0.8))));
  return {
    part: { kind: "limb", along: o.along, radii, depth: o.depth ?? 1.1, calf: o.calf ?? 0.15, shoulder: o.shoulder ?? 0.15, elbow: o.knee ?? 0.22, skin: true, mirror: o.mirror ?? true, material: o.material },
    low: radii[n - 1]!,
    radii,
  };
}

export type FootForm = "hoof" | "paw" | "mitten" | "hand" | "talon" | "flipper";

export interface FootOpts {
  at: string;
  form: FootForm;
  /** The limb's half-width just above the foot: the foot is `size` (1.45; rule 3: 1.3 to 1.6) times its width. */
  low: number;
  size?: number;
  /** Length in the foot's width (1.1), the node's height off the ground (the sole), toes, claw length in the width. */
  long?: number;
  sole: number;
  toes?: number;
  claw?: number;
  /** A hand's pointing and palm directions ([0.3, -1, 0] and [0, 0, -1]) and finger curl (40). */
  dir?: V;
  palm?: V;
  curl?: number;
  tall?: number;
  material: string;
  claw_mat?: string;
}

/** A big foot at 1.3 to 1.6 times the limb's width: a hoof, a padded mitten paw built into the skin, a hand, a
 *  talon, or a flipper (a flat broad paddle, a mitten flattened). */
export function foot(o: FootOpts): Part {
  const width = f4(2 * o.low * (o.size ?? 1.45)), len = f4(width * (o.long ?? 1.1));
  const base = { kind: "foot", at: o.at, mirror: true, material: o.material, sole: f4(o.sole), width, len };
  switch (o.form) {
    case "hoof": return { ...base, form: "hoof", toes: o.toes ?? 1, r: f4(o.low * 1.05), tall: o.tall ?? 0.9, claw_mat: o.claw_mat ?? o.material };
    case "mitten": case "paw": return { ...base, form: "mitten", skin: true, r: f4(o.low * 1.25), tall: o.tall ?? 1.4, toes: o.toes ?? 4, claw: f4((o.claw ?? 0.12) * width), claw_mat: o.claw_mat ?? "claw" };
    case "flipper": return { ...base, form: "mitten", skin: true, r: f4(o.low * 1.1), tall: o.tall ?? 0.55, toes: o.toes ?? 0, claw: 0, len: f4(width * (o.long ?? 1.6)) };
    case "hand": return { ...base, form: "hand", dir: o.dir ?? [0.3, -1, 0], palm: o.palm ?? [0, 0, -1], fingers: o.toes ?? 4, curl: o.curl ?? 40, thick: f4(width * 0.5), claw: f4((o.claw ?? 0) * width), claw_mat: o.claw_mat ?? "claw" };
    case "talon": return { ...base, form: "talon", toes: o.toes ?? 3, r: f4(o.low), claw: f4((o.claw ?? 0.3) * width), claw_mat: o.claw_mat ?? "claw" };
  }
}

// ---------------------------------------------------------------------------------------------- colours

export interface PaletteOpts {
  /** The body's colour, sRGB, at middle brightness (rule 6). The material is named by `PaletteOpts.name` ("hide"). */
  body: RGB;
  name?: string;
  /** The lighter belly (default: the body lifted toward a warm cream). */
  belly?: RGB;
  /** The one accent for the legend's trait, its roughness and glow (0: only the eyes and this may glow). */
  accent: RGB;
  accentRough?: number;
  accentGlow?: number;
  /** The iris colour and its glow (0.35; capped at 0.5), the white's tint, the brow's colour (the body darkened). */
  iris: RGB;
  irisGlow?: number;
  white?: RGB;
  brow?: RGB;
  roughness?: number;
  /** Any other named entries (a hoof, a horn): they never glow. */
  extra?: Record<string, RGB | Entry>;
}

const luma = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix = (a: RGB, b: RGB, t: number): RGB => [f4(a[0] + (b[0] - a[0]) * t), f4(a[1] + (b[1] - a[1]) * t), f4(a[2] + (b[2] - a[2]) * t)];
export const shadeOf = (c: RGB, k: number): RGB => [f4(Math.min(1, c[0] * k)), f4(Math.min(1, c[1] * k)), f4(Math.min(1, c[2] * k))];

/** Rule 6's palette: body, a lighter belly, one accent, and the eye's colours (white, iris, pupil, glint), with the mouth, tooth, nostril and brow entries the face uses. Eye glow is capped at 0.5; a
 *  grey-brown body (too little colour) or one too dark or too light throws, so a sheet can't drift into mud. */
export function palette(o: PaletteOpts): Record<string, Entry> {
  const L = luma(o.body), chroma = Math.max(...o.body) - Math.min(...o.body);
  if (L < 0.08 || L > 0.62) throw new Error(`palette: body brightness ${L.toFixed(2)} is outside 0.08..0.62 (rule 6: middle brightness)`);
  if (chroma < 0.04) throw new Error(`palette: body colour ${o.body.join(",")} has no colour in it (rule 6: no grey-brown mud)`);
  const rough = o.roughness ?? 0.7;
  const belly = o.belly ?? mix(o.body, [0.95, 0.86, 0.7], 0.45);
  const glow = Math.min(o.irisGlow ?? 0.35, 0.5);
  const out: Record<string, Entry> = {
    [o.name ?? "hide"]: [...o.body, rough, 0],
    lid: [...o.body, rough, 0],
    belly: [...belly, rough, 0],
    accent: [...o.accent, o.accentRough ?? 0.5, 0, ...(o.accentGlow ? [Math.min(o.accentGlow, 1)] : [])],
    white: [...(o.white ?? [0.97, 0.95, 0.9]), 0.2, 0],
    iris: [...o.iris, 0.15, 0, glow],
    pupil: [0.03, 0.025, 0.03, 0.08, 0],
    glint: [1, 1, 1, 0.05, 0, 0.5],
    brow: [...(o.brow ?? shadeOf(o.body, 0.62)), 0.85, 0],
    mouth: [0.32, 0.08, 0.1, 0.6, 0],
    tooth: [0.97, 0.95, 0.88, 0.3, 0],
    dark: [0.05, 0.04, 0.05, 0.6, 0],
    nose: [...shadeOf(o.body, 0.55), 0.5, 0],
    claw: [0.92, 0.88, 0.78, 0.35, 0],
  };
  for (const [k, v] of Object.entries(o.extra ?? {})) out[k] = v.length === 3 ? [...v, 0.6, 0] : v.slice(0, 5);
  return out;
}

export type HidePattern = "skin" | "fur" | "wet" | "scales" | "velvet" | "spots";

/** The body's `hide`, large and low in contrast (rule 6): the pattern's colours are the body's own, `contrast` (0.12)
 *  darker and lighter, and `size` (0.12 m) is one scale, fold or patch: big, so it reads at fight size. */
export function hide(pattern: HidePattern, body: RGB, o: { size?: number; contrast?: number; map?: number; cover?: number } = {}) {
  const c = o.contrast ?? 0.12, dark = shadeOf(body, 1 - c), light = shadeOf(body, 1 + c);
  const colours: RGB[] = pattern === "fur" ? [dark, light] : pattern === "wet" || pattern === "scales" ? [dark, light] : [dark];
  return { pattern, size: o.size ?? 0.12, colours, map: o.map ?? 256, ...(o.cover !== undefined ? { cover: o.cover } : {}), rough: pattern === "wet" ? [0.5, 0.72] : undefined };
}

// ---------------------------------------------------------------------------------------------- writing

const Old = obj({ ...SHEET_WHO, feet: int(0, 8), wings: opt(int(0, 8)), budget: num(100, 20000, 3000) });

/** Write beasts/<id>.json: the old sheet's identity (id, name, about, archetype, feet, wings, budget) and the plan's
 *  body. A body that names a different feet or wings count than the old sheet throws: the fighter doesn't change. */
export function writeSheet(id: string, body: { feet: number; wings?: number } & object, out?: string) {
  const path = `${APP}/beasts/${id}.json`;
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const who = Old(raw);
  if (body.feet !== who.feet) throw new Error(`${id}: the plan has ${body.feet} feet, the sheet ${who.feet}`);
  if ((body.wings ?? 0) !== (who.wings ?? 0)) throw new Error(`${id}: the plan has ${body.wings ?? 0} wings, the sheet ${who.wings ?? 0}`);
  const sheet = { id: who.id, name: who.name, about: who.about, archetype: who.archetype, ...body, feet: who.feet, ...(who.wings !== undefined ? { wings: who.wings } : {}), budget: who.budget };
  writeFileSync(out ?? path, JSON.stringify(sheet, null, 2) + "\n");
  console.log(`wrote ${out ?? path}`);
}

/** The ids a plan's command line names (all of the table's, given none), checked against the table. */
export function pick(table: Record<string, unknown>, argv = process.argv.slice(2)): string[] {
  const ids = argv.filter((a) => !a.startsWith("--"));
  for (const id of ids) if (!(id in table)) throw new Error(`no beast ${id} in this plan (have: ${Object.keys(table).join(", ")})`);
  return ids.length ? ids : Object.keys(table);
}
