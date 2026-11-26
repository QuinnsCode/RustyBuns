// A human body, grown from a Build: one skinned mesh on a 17-bone skeleton, with a walk whose feet plant.
//
// The body is real anatomy in rings: a pelvis, a waist, a rib cage, a chest and sloped shoulders; thighs that taper to a
// knee, a calf that sits behind the shin; a deltoid, an upper arm, a forearm that flattens to a wrist, a hand with a
// thumb; a skull with a jaw, a brow, eye sockets, a nose, lips and a chin. A `Build` moves those rings the way bodies
// differ: height, frame (broad shoulders or wide hips), mass and where it sits (belly, or hips and thighs), muscle, bust,
// leg length. Clothes are layers over that body, so a jacket on a heavy build is a heavy build in a jacket.
// Skin has tone (flushed here, shaded there) and a surface: blotches, pores and freckles from the figure's one material.
//
// `human(build, outfit)` gives the figure; `figure.pose(move, dt)` walks it. The walk is inverse kinematics, not a
// swing: each foot is put on the ground where a step lands, stays there while the body passes over it, rolls from heel
// to toe and lifts, and the knees, hips and pelvis height follow from where the feet are. So feet don't slide, a stride
// grows with speed, a crouch is the same walk with the pelvis low, and a sidestep steps sideways.
//
// Feet at y 0, facing +z, metres. Geometry is shared by every figure with the same build and outfit shape; colours are
// one attribute per palette. No DOM.
import * as THREE from "three";
import { clamp, clamp01, lerp, mulberry32 } from "@rustybuns/util";
import type { Avatar } from "@rustybuns/util/avatar";
import type { Play } from "./character.ts";

/** How a body is built. Every number but `height` is 0 for the middle of the range. */
export interface Build {
  /** Standing height, metres. */
  height: number;
  /** -1 narrow shoulders over wide hips, 1 broad shoulders over narrow hips. */
  frame: number;
  /** -1 lean, 0 average, 1 heavy, 2 very heavy. */
  mass: number;
  /** 0 to 1. */
  muscle: number;
  /** Where the mass sits: -1 hips and thighs, 1 the belly. */
  belly: number;
  /** 0 to 1. */
  bust: number;
  /** -1 short legs under a long torso, 1 long legs. */
  legs: number;
  /** -1 short arms, 1 long ones; left out, 0. */
  arms?: number;
}

/** Ten body types, as a row of people is: nobody is the "default". */
export const BUILDS = {
  average: { height: 1.75, frame: 0.6, mass: 0.1, muscle: 0.25, belly: 0.2, bust: 0, legs: 0 },
  slender: { height: 1.68, frame: -0.6, mass: -0.6, muscle: 0, belly: 0, bust: 0.35, legs: 0.3 },
  athletic: { height: 1.82, frame: 1, mass: -0.2, muscle: 0.9, belly: 0, bust: 0, legs: 0.1 },
  curvy: { height: 1.64, frame: -1, mass: 0.4, muscle: 0, belly: -0.8, bust: 0.9, legs: 0 },
  heavy: { height: 1.78, frame: 0.6, mass: 1.4, muscle: 0.3, belly: 0.9, bust: 0.15, legs: -0.2 },
  pear: { height: 1.66, frame: -0.9, mass: 1.0, muscle: 0, belly: -1, bust: 0.5, legs: -0.1 },
  lanky: { height: 1.91, frame: 0.3, mass: -0.7, muscle: 0.05, belly: 0, bust: 0, legs: 0.7 },
  petite: { height: 1.56, frame: -0.5, mass: -0.2, muscle: 0.1, belly: 0, bust: 0.4, legs: 0 },
  stocky: { height: 1.65, frame: 0.9, mass: 0.7, muscle: 0.7, belly: 0.4, bust: 0, legs: -0.7 },
  strong: { height: 1.73, frame: -0.1, mass: 0.1, muscle: 0.8, belly: -0.2, bust: 0.45, legs: 0.1 },
} satisfies Record<string, Build>;
export type BuildName = keyof typeof BUILDS;

/** How a face differs from the middle of the range, each -1 to 1, so two people of one build don't share a face. */
export interface Face {
  /** Narrow to wide at the jaw. */
  jaw: number;
  /** A small, set-back chin to a long, strong one. */
  chin: number;
  /** A short nose to a long one, and a narrow one to a broad one. */
  nose: number; noseWidth: number;
  /** A smooth brow to a heavy ridge. */
  brow: number;
  /** Flat to high, full cheekbones. */
  cheeks: number;
  /** Thin lips to full ones. */
  lips: number;
  /** Small eyes to big ones, and close-set to wide-set. */
  eyes: number; eyeGap: number;
}
const FACE_KEYS = ["jaw", "chin", "nose", "noseWidth", "brow", "cheeks", "lips", "eyes", "eyeGap"] as const;
/** A face from a seed: the same seed, the same face. Most numbers sit near the middle, as faces do. */
export function faceOf(seed: number): Face {
  const r = mulberry32(seed * 7919 + 17);
  const face = {} as Face;
  for (const k of FACE_KEYS) face[k] = Math.round(((r() + r() + r()) / 1.5 - 1) * 100) / 100;
  return face;
}
/** Eye colours, browns most often, as in a crowd. */
const EYES = ["#4a2e1a", "#5a3a22", "#3b2416", "#6b4a2b", "#7a5a32", "#5f6a3a", "#4f6f86", "#6c8aa0", "#3f5560"];
export const BUILD_NAMES = Object.keys(BUILDS) as BuildName[];

export type Top = "puffer" | "shirt" | "tee" | "fur";
export type HairStyle = "bald" | "short" | "curly" | "long";
export type Hat = "none" | "beanie" | "cap" | "bucket" | "campaign";
/** What changes the mesh: clothes, hair, hat, what is carried. */
export interface Outfit {
  top: Top;
  hair: HairStyle;
  hat: Hat;
  pack?: boolean;
  /** A duty belt with a radio and a pouch. */
  belt?: boolean;
  /** A reflective band round the chest (the `trim` slot), so a ranger is easy to spot. */
  stripe?: boolean;
  /** A flashlight in the right hand, pointing down the forearm. */
  torch?: boolean;
  /** Bare feet (with `top: "fur"`, a wild thing rather than a hiker). */
  barefoot?: boolean;
}
/** A colour (sRGB hex) for each slot the mesh is painted with; a slot left out takes `DEFAULT_PALETTE`'s. */
export type Palette = Partial<Record<Slot, string>>;

const SLOTS = ["skin", "lips", "eyeWhite", "iris", "pupil", "hair", "brow", "top", "topDark", "trim", "bottom", "bottomDark", "boot", "bootDark",
  "sole", "hat", "hatDark", "band", "pack", "packDark", "strap", "roll", "belt", "kit", "metal", "glow"] as const;
export type Slot = (typeof SLOTS)[number];
export const DEFAULT_PALETTE: Record<Slot, string> = {
  skin: "#c68a5e", lips: "#9c5a4a", eyeWhite: "#e6ddd2", iris: "#5a3a22", pupil: "#0c0907", hair: "#2a1b12", brow: "#22160e",
  top: "#d9482b", topDark: "#a83a24", trim: "#5e2216", bottom: "#3b3f4a", bottomDark: "#2c2f37", boot: "#5a3b24", bootDark: "#3d2818",
  sole: "#1d1611", hat: "#1aa39a", hatDark: "#127068", band: "#3b2a1a", pack: "#e0a526", packDark: "#86631a", strap: "#654a13",
  roll: "#5a6b3a", belt: "#3b2a1a", kit: "#1e2226", metal: "#c9a646", glow: "#fff8e0",
};

const SURFACE: Partial<Record<Slot, number>> = { skin: 1, lips: 1, eyeWhite: 2, iris: 2, pupil: 2, hair: 3, brow: 3 };

/** The bones, in skeleton order. `R` is the figure's own right (x < 0 when it faces +z). */
export const BONES = ["hips", "spine", "chest", "neck", "head", "armR", "foreR", "handR", "armL", "foreL", "handL",
  "thighR", "shinR", "footR", "thighL", "shinL", "footL"] as const;
export type BoneName = (typeof BONES)[number];
const B = Object.fromEntries(BONES.map((n, i) => [n, i])) as Record<BoneName, number>;
const PARENT: Record<BoneName, BoneName | null> = {
  hips: null, spine: "hips", chest: "spine", neck: "chest", head: "neck", armR: "chest", foreR: "armR", handR: "foreR",
  armL: "chest", foreL: "armL", handL: "foreL", thighR: "hips", shinR: "thighR", footR: "shinR", thighL: "hips", shinL: "thighL", footL: "shinL",
};

// ---- measurements ---------------------------------------------------------------------------------------------------

type V3 = [number, number, number];
/** A torso ring: half its width, how far its front and back are from the body's axis. */
type Girth = { y: number; w: number; f: number; b: number };
export interface Dims {
  k: number; g: number; fat: number; mu: number; height: number;
  headH: number; chin: number; eye: number; headZ: number; hs: number;
  hipY: number; hipX: number; ankle: number; thigh: number; shin: number;
  shoulderY: number; shoulderX: number; upper: number; fore: number;
  torso: Record<"crotch" | "hip" | "crest" | "waist" | "ribs" | "chest" | "armpit" | "shoulder" | "trap" | "neckBase" | "neckTop", Girth>;
  joints: Record<BoneName, V3>;
}

/** [width, front, back] for the broad frame, the wide-hipped frame, per unit of mass, per unit of muscle. */
const TORSO: Record<keyof Dims["torso"], [V3, V3, V3, V3]> = {
  crotch: [[0.085, 0.075, -0.085], [0.09, 0.075, -0.09], [0.02, 0.02, -0.02], [0, 0, 0]],
  hip: [[0.17, 0.098, -0.125], [0.186, 0.098, -0.134], [0.03, 0.03, -0.04], [0, 0, -0.008]],
  crest: [[0.158, 0.105, -0.108], [0.166, 0.1, -0.112], [0.04, 0.055, -0.025], [0, 0, 0]],
  waist: [[0.143, 0.108, -0.092], [0.124, 0.096, -0.086], [0.045, 0.07, -0.02], [0.002, 0, 0]],
  ribs: [[0.15, 0.116, -0.098], [0.13, 0.102, -0.092], [0.03, 0.05, -0.015], [0.006, 0.004, 0]],
  chest: [[0.166, 0.128, -0.108], [0.143, 0.114, -0.1], [0.02, 0.025, -0.012], [0.012, 0.014, -0.006]],
  armpit: [[0.162, 0.114, -0.116], [0.141, 0.104, -0.106], [0.012, 0.012, -0.012], [0.016, 0.006, -0.01]],
  shoulder: [[0.178, 0.07, -0.1], [0.155, 0.064, -0.092], [0.008, 0.008, -0.01], [0.012, 0, -0.008]],
  trap: [[0.1, 0.052, -0.086], [0.082, 0.046, -0.076], [0.008, 0.008, -0.008], [0.016, 0, -0.01]],
  neckBase: [[0.06, 0.05, -0.07], [0.051, 0.044, -0.062], [0.01, 0.012, -0.006], [0.007, 0.003, -0.005]],
  neckTop: [[0.055, 0.058, -0.052], [0.047, 0.054, -0.046], [0.008, 0.012, -0.004], [0.006, 0.002, -0.004]],
};

/** A build's joints and girths, in metres. */
export function measure(b: Build): Dims {
  const height = clamp(b.height, 1.3, 2.6), k = height / 1.75, g = clamp01((1 - b.frame) / 2);
  const fat = b.mass > 0 ? b.mass : b.mass * 0.45, mu = clamp01(b.muscle);
  const headH = 0.234 * Math.pow(k, 0.35), hs = headH / 0.235;
  const chin = height - headH, eye = height - headH * 0.5, headZ = 0.014 * k;
  const hipY = height * (0.528 + 0.014 * b.legs), ankle = 0.09 * k;
  const thigh = (hipY - ankle) * 0.505, shin = hipY - ankle - thigh;
  const shoulderY = chin - 0.118 * k - 0.006 * Math.max(0, fat);     // the joint: the point of the shoulder is 3.5 cm above it
  const shoulderX = k * lerp(0.19, 0.166, g) + 0.012 * mu + 0.008 * Math.max(0, fat);
  const hipX = k * lerp(0.086, 0.096, g) + 0.012 * Math.max(0, fat);
  const reach = 1 + 0.12 * clamp(b.arms ?? 0, -1, 1), upper = 0.172 * height * reach, fore = 0.146 * height * reach;
  const T = shoulderY - hipY;
  const ys: Record<keyof Dims["torso"], number> = {
    crotch: hipY - 0.105 * k, hip: hipY - 0.015 * k, crest: hipY + 0.2 * T, waist: hipY + 0.36 * T, ribs: hipY + 0.52 * T,
    chest: hipY + 0.7 * T, armpit: hipY + 0.86 * T, shoulder: shoulderY + 0.034 * k, trap: shoulderY + 0.062 * k,
    neckBase: shoulderY + 0.086 * k, neckTop: chin + 0.035 * k,
  };
  const bel = 1 + 0.5 * b.belly, hipBias = 1 - 0.5 * b.belly;
  const torso = {} as Dims["torso"];
  for (const key of Object.keys(TORSO) as (keyof Dims["torso"])[]) {
    const [m, f, df, dm] = TORSO[key];
    const low = key === "hip" || key === "crotch", mid = key === "crest" || key === "waist" || key === "ribs";
    const fw = fat * (low ? hipBias : 1), ff = fat * (mid ? bel : 1), fb = fat * (low ? hipBias : 1);
    torso[key] = {
      y: ys[key],
      w: k * lerp(m[0], f[0], g) + df[0] * fw + dm[0] * mu,
      f: k * lerp(m[1], f[1], g) + df[1] * ff + dm[1] * mu,
      b: k * lerp(m[2], f[2], g) + df[2] * fb + dm[2] * mu,
    };
  }
  const elbow = shoulderY - upper, wrist = elbow - fore, knee = hipY - thigh;
  const side = (s: number, n: "R" | "L") => ({
    ["arm" + n]: [shoulderX * s, shoulderY, -0.012 * k], ["fore" + n]: [shoulderX * s, elbow, -0.012 * k], ["hand" + n]: [shoulderX * s, wrist, -0.012 * k],
    ["thigh" + n]: [hipX * s, hipY, 0], ["shin" + n]: [hipX * s, knee, 0], ["foot" + n]: [hipX * s, ankle, 0],
  });
  const joints = {
    hips: [0, hipY, 0], spine: [0, torso.crest.y, -0.02 * k], chest: [0, torso.ribs.y, -0.025 * k],
    neck: [0, torso.neckBase.y, -0.015 * k], head: [0, chin + 0.03 * k, 0], ...side(-1, "R"), ...side(1, "L"),
  } as Dims["joints"];
  return { k, g, fat, mu, height, headH, chin, eye, headZ, hs, hipY, hipX, ankle, thigh, shin, shoulderY, shoulderX, upper, fore, torso, joints };
}

// ---- the mesh: tubes of rings, skinned ------------------------------------------------------------------------------

/** One control ring of a tube: at `y`, half-width `w`, front at z `f`, back at z `b`, centred at x. */
interface Ctl { y: number; w: number; f: number; b: number; x?: number; p?: number }
type Ring = Required<Ctl>;
/** Two bones and the second one's share. */
type Skin = [a: number, b: number, share: number];
interface TubeOptions {
  /** Points round a ring, and the gap between rings. */
  seg: number; step: number;
  /** Heights where the ring is doubled, so a hem or a cuff is a crisp edge with a step in it. */
  cuts?: number[];
  /** A rounded end this tall, at the top and the bottom; left out, the end is flat. */
  capTop?: number; capBottom?: number;
  /** Changes a sampled ring: clothes over the body. `y` is a hair above or below a cut. */
  shape?: (r: Ring, y: number) => void;
  /** Moves one point: a nose on a face. */
  bump?: (p: THREE.Vector3, ang: number, y: number) => void;
  slot: Slot | ((y: number, p: THREE.Vector3, ang: number) => Slot);
  skin: number | ((y: number, p: THREE.Vector3) => Skin);
  /** Skin isn't one colour: how flushed (0 to 1) and how shaded (0 to 1) this point is. */
  tone?: (p: THREE.Vector3, y: number) => [flush: number, shade: number];
  /** Puts the tube (built along y) somewhere else: a foot runs along z. */
  m?: THREE.Matrix4;
  /** 0 to 1: crowds the points toward the front, for a face. */
  front?: number;
}

class Builder {
  pos: number[] = []; idx: number[] = []; slot: number[] = []; bone: number[] = []; weight: number[] = []; tone: number[] = [];
  private v = new THREE.Vector3();

  private add(p: THREE.Vector3, y: number, ang: number, o: TubeOptions): number {
    const q = this.v.copy(p);
    o.bump?.(q, ang, y);
    const slot = typeof o.slot === "string" ? o.slot : o.slot(y, q, ang);
    const tone = o.tone?.(q, y);
    this.tone.push(tone ? clamp01(tone[0]) : 0, tone ? clamp01(tone[1]) : 0);
    if (o.m) q.applyMatrix4(o.m);
    const sk: Skin = typeof o.skin === "number" ? [o.skin, o.skin, 0] : o.skin(y, q);
    this.pos.push(q.x, q.y, q.z);
    this.slot.push(SLOTS.indexOf(slot));
    this.bone.push(sk[0], sk[1], 0, 0);
    this.weight.push(1 - sk[2], sk[2], 0, 0);
    return this.pos.length / 3 - 1;
  }

  /** Rings stacked along y, splined through the control rings, skinned into one closed surface. */
  tube(ctl: Ctl[], o: TubeOptions) {
    const lo = ctl[0]!.y, hi = ctl.at(-1)!.y, n = Math.max(1, Math.round((hi - lo) / o.step));
    // Where the rings go: evenly, with each cut twice (a hair below it, a hair above).
    const at: [y: number, sample: number][] = [];
    const cuts = (o.cuts ?? []).filter((c) => c > lo && c < hi).sort((a, b) => a - b);
    for (let i = 0; i <= n; i++) {
      const y = lo + ((hi - lo) * i) / n;
      if (cuts.some((c) => Math.abs(c - y) < o.step * 0.4)) continue;
      at.push([y, y]);
    }
    for (const c of cuts) at.push([c, c - 1e-5], [c, c + 1e-5]);
    at.sort((a, b) => a[1] - b[1]);
    const rings: { y: number; r: Ring; scale: number }[] = at.map(([y, s]) => {
      const r = sample(ctl, y);
      o.shape?.(r, s);
      return { y, r, scale: 1 };
    });
    const dome = (end: { y: number; r: Ring }, tall: number, dir: number) => {
      const out: typeof rings = [];
      const n = clamp(Math.round(tall / o.step), 3, 9);
      for (let i = 1; i <= n; i++) {
        const a = (i / (n + 1)) * (Math.PI / 2);
        out.push({ y: end.y + dir * tall * Math.sin(a), r: end.r, scale: Math.cos(a) });
      }
      return out;
    };
    const first = rings[0]!, last = rings.at(-1)!;
    const all = [...(o.capBottom ? dome(first, o.capBottom, -1).reverse() : []), ...rings, ...(o.capTop ? dome(last, o.capTop, 1) : [])];
    const p = new THREE.Vector3(), start: number[] = [];
    const k = o.front ?? 0;
    for (const { y, r, scale } of all) {
      start.push(this.pos.length / 3);
      const zc = (r.f + r.b) / 2, zd = ((r.f - r.b) / 2) * scale, e = 2 / r.p;
      for (let j = 0; j < o.seg; j++) {
        const u = (j / o.seg) * Math.PI * 2, t = u + k * Math.cos(u);
        const c = Math.cos(t), s = Math.sin(t);
        p.set(r.x + r.w * scale * Math.sign(c) * Math.abs(c) ** e, y, zc + zd * Math.sign(s) * Math.abs(s) ** e);
        this.add(p, y, t, o);
      }
    }
    for (let i = 0; i + 1 < all.length; i++) {
      for (let j = 0; j < o.seg; j++) {
        const a = start[i]! + j, c = start[i]! + ((j + 1) % o.seg), b2 = start[i + 1]! + j, d = start[i + 1]! + ((j + 1) % o.seg);
        this.idx.push(a, b2, c, c, b2, d);
      }
    }
    // The ends: a point in the middle, fanned to the last ring.
    for (const [ring, dir, tall] of [[all[0]!, -1, o.capBottom ?? 0], [all.at(-1)!, 1, o.capTop ?? 0]] as const) {
      const s = ring === all[0] ? start[0]! : start.at(-1)!;
      const y = ring.scale < 1 ? (dir < 0 ? first.y - tall : last.y + tall) : ring.y;
      const c = this.add(p.set(ring.r.x, y, (ring.r.f + ring.r.b) / 2), y, Math.PI / 2, o);
      for (let j = 0; j < o.seg; j++) {
        const a = s + j, b2 = s + ((j + 1) % o.seg);
        if (dir < 0) this.idx.push(c, a, b2); else this.idx.push(c, b2, a);
      }
    }
  }

  /**
   * A grid of points, `rows` by `cols`, joined round (the last column meets the first) and open at the bottom: hair,
   * whose edge is the hairline and not a level ring.
   */
  sheet(rows: number, cols: number, at: (i: number, j: number, out: THREE.Vector3) => void, slot: Slot, skin: (p: THREE.Vector3) => Skin) {
    const start = this.pos.length / 3, p = this.v;
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        at(i, j, p);
        const sk = skin(p);
        this.pos.push(p.x, p.y, p.z);
        this.tone.push(0, 0);
        this.slot.push(SLOTS.indexOf(slot));
        this.bone.push(sk[0], sk[1], 0, 0);
        this.weight.push(1 - sk[2], sk[2], 0, 0);
      }
    }
    for (let i = 0; i + 1 < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const a = start + i * cols + j, c = start + i * cols + ((j + 1) % cols), b2 = a + cols, d = c + cols;
        this.idx.push(a, b2, c, c, b2, d);
      }
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(this.bone, 4));
    g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(this.weight, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.userData.slots = Uint8Array.from(this.slot);
    g.userData.tone = Float32Array.from(this.tone);
    // What each point is made of, for the shader: 0 cloth, 1 skin, 2 an eye (wet), 3 hair.
    g.setAttribute("surface", new THREE.Float32BufferAttribute(this.slot.map((i) => SURFACE[SLOTS[i]!] ?? 0), 1));
    return g;
  }
}

/** The ring at `y`: a spline through the control rings (Catmull-Rom on every number). */
function sample(ctl: Ctl[], y: number): Ring {
  let i = 0;
  while (i + 2 < ctl.length && y > ctl[i + 1]!.y) i++;
  const a = ctl[i]!, b = ctl[i + 1]!, pa = ctl[i - 1] ?? a, nb = ctl[i + 2] ?? b;
  const h = b.y - a.y, t = clamp01((y - a.y) / h), t2 = t * t, t3 = t2 * t;
  const ch = (get: (c: Ctl) => number) => {
    const va = get(a), vb = get(b);
    const ma = pa === a ? vb - va : ((vb - get(pa)) / (b.y - pa.y)) * h, mb = nb === b ? vb - va : ((get(nb) - va) / (nb.y - a.y)) * h;
    const v = (2 * t3 - 3 * t2 + 1) * va + (t3 - 2 * t2 + t) * ma + (-2 * t3 + 3 * t2) * vb + (t3 - t2) * mb;
    // never past both neighbours: a spline that overshoots puts a dent or a bulge nobody drew
    return clamp(v, Math.min(va, vb) - Math.abs(vb - va) * 0.15, Math.max(va, vb) + Math.abs(vb - va) * 0.15);
  };
  return { y, w: ch((c) => c.w), f: ch((c) => c.f), b: ch((c) => c.b), x: ch((c) => c.x ?? 0), p: ch((c) => c.p ?? 2) };
}

const smooth = (a: number, b: number, v: number) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const gauss = (d: number, s: number) => Math.exp(-(d * d) / (2 * s * s));
/** A bone below `y0`, the next above `y1`, blended between. */
const blend = (a: number, b: number, y0: number, y1: number, y: number): Skin => [a, b, smooth(y0, y1, y)];
/** Grow a ring by `t` all round. */
const pad = (r: Ring, t: number) => { r.w += t; r.f += t; r.b -= t; };
/** A cheap, repeatable noise in 0..1 from a point. */
const hash = (x: number, y: number, z: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

/** How far a top stands off the body, and where it ends. */
const TOPS: Record<Top, { thick: number; hem: number; baffles: boolean; sleeve: "long" | "short" }> = {
  puffer: { thick: 0.024, hem: -0.05, baffles: true, sleeve: "long" },
  shirt: { thick: 0.007, hem: 0.1, baffles: false, sleeve: "long" },
  tee: { thick: 0.006, hem: -0.04, baffles: false, sleeve: "short" },
  fur: { thick: 0.02, hem: -1, baffles: false, sleeve: "long" },
};

function buildMesh(d: Dims, b: Build, o: Outfit, face: Face): THREE.BufferGeometry {
  const m = new Builder(), k = d.k, t = d.torso, top = TOPS[o.top], fur = o.top === "fur";
  const shaggy = (amount: number) => (p: THREE.Vector3) => {
    if (!fur) return;
    const n = hash(p.x * 31.7, p.y * 17.3, p.z * 23.9) - 0.35;
    const r = Math.hypot(p.x, p.z) || 1;
    p.x += (p.x / r) * n * amount; p.z += (p.z / r) * n * amount; p.y -= Math.max(0, n) * amount * 0.8;
  };
  const baffle = (y: number) => (top.baffles ? 0.006 * Math.abs(Math.sin((y / (0.085 * k)) * Math.PI)) ** 0.6 : 0);

  // ---- torso and neck: crotch to the head ----
  const hem = fur ? -9 : top.hem < 0 ? d.hipY + top.hem * k : t.crest.y + (top.hem - 0.1) * k;   // a shirt tucks in at the belt
  const collar = t.neckBase.y + (o.top === "tee" ? 0.004 : 0.012) * k, collarTop = collar + (o.top === "puffer" ? 0.03 : o.top === "tee" ? 0.008 : 0.026) * k;
  const tucked = top.hem > 0;
  const beltLo = hem - 0.022 * k, beltHi = hem + 0.022 * k;
  const stripeLo = t.ribs.y - 0.005 * k, stripeHi = stripeLo + 0.04 * k;
  const torsoCtl: Ctl[] = (Object.keys(t) as (keyof Dims["torso"])[]).map((key) => ({ ...t[key], p: key === "crotch" || key === "hip" ? 2.5 : key === "trap" || key.startsWith("neck") ? 2 : 2.3 }));
  m.tube(torsoCtl, {
    seg: 20, step: 0.022 * k, capBottom: 0.05 * k,
    cuts: fur ? [] : [hem, collar, collarTop, ...(tucked ? [beltLo, beltHi] : []), ...(o.stripe ? [stripeLo, stripeHi] : [])],
    shape: (r, y) => {
      if (fur) return pad(r, y < t.neckTop.y - 0.02 ? top.thick : 0.012);
      if (y > collarTop) return;                                             // bare neck
      if (y > collar) return pad(r, o.top === "tee" ? 0.004 : o.top === "puffer" ? 0.015 : 0.01);  // the collar stands off the neck
      if (y > hem) {
        pad(r, top.thick + baffle(y));
        if (!tucked && y < hem + 0.03 * k) pad(r, 0.004);                    // a hem band
        if (tucked && y < beltHi) pad(r, 0.004);                             // the belt
      } else pad(r, 0.008);
    },
    bump: (p, ang, y) => {
      // a bust, under whatever is worn over it
      if (b.bust > 0 && p.z > 0) for (const s of [-1, 1]) p.z += 0.045 * b.bust * k * gauss(Math.hypot(p.x - s * 0.068 * k, (y - (t.chest.y - 0.012 * k)) * 0.9), 0.05 * k);
      shaggy(0.05)(p);
    },
    tone: (_p, y) => [0, 0.3 * smooth(d.chin - 0.05 * k, d.chin, y)],
    slot: (y) => (fur ? "top" : y > collarTop ? "skin" : y > collar ? "topDark" : y > hem ? (tucked && y < beltHi ? "belt" : !tucked && y < hem + 0.03 * k ? "topDark" : o.stripe && y > stripeLo && y < stripeHi ? "trim" : "top") : "bottom"),
    skin: (y) => (y < t.waist.y ? blend(B.hips, B.spine, t.crest.y - 0.02, t.waist.y, y) : y < t.armpit.y ? blend(B.spine, B.chest, t.ribs.y - 0.03, t.chest.y, y)
      : y < t.neckBase.y + 0.02 ? blend(B.chest, B.neck, t.neckBase.y - 0.02, t.neckBase.y + 0.02, y) : blend(B.neck, B.head, d.chin, d.chin + 0.03, y)),
  });

  // ---- legs ----
  const tf = 1 + 0.2 * d.fat * (1 - 0.35 * b.belly) + 0.1 * d.mu + 0.05 * d.g, cf = 1 + 0.1 * d.fat + 0.12 * d.mu;
  const rT = t.hip.w - d.hipX + 0.004;
  const knee = d.hipY - d.thigh, bootTop = d.ankle + 0.1 * k;
  for (const [s, n] of [[-1, "R"], [1, "L"]] as const) {
    const thighB = B[`thigh${n}`], shinB = B[`shin${n}`], footB = B[`foot${n}`];
    const L = (rel: number, w: number, f: number, back: number, x = 0): Ctl => ({ y: d.hipY + rel, w, f, b: back, x: (d.hipX + x) * s });
    m.tube([
      L(-d.thigh - d.shin - 0.02 * k, 0.036 * k, 0.042 * k, -0.04 * k),
      L(-d.thigh - d.shin + 0.02 * k, 0.034 * k, 0.04 * k, -0.037 * k),
      L(-d.thigh - 0.7 * d.shin, 0.039 * k * cf, 0.041 * k, -0.045 * k * cf),
      L(-d.thigh - 0.32 * d.shin, 0.053 * k * cf, 0.047 * k, -0.07 * k * cf),
      L(-d.thigh - 0.12 * d.shin, 0.05 * k, 0.053 * k, -0.055 * k),
      L(-d.thigh, 0.054 * k, 0.063 * k, -0.052 * k),
      L(-0.85 * d.thigh, 0.058 * k * (0.5 + 0.5 * tf), 0.064 * k, -0.06 * k),
      L(-0.5 * d.thigh, 0.075 * k * tf, 0.084 * k * tf, -0.08 * k * tf, -0.004),
      L(-0.06 * k, rT * 0.92, 0.092 * k * (0.6 + 0.4 * tf), -0.098 * k * (0.6 + 0.4 * tf), -0.002),
      L(0.05 * k, rT * 0.62, 0.065 * k, -0.07 * k, -0.02),
    ], {
      seg: 14, step: 0.03 * k, capTop: 0.03 * k, cuts: fur || o.barefoot ? [] : [bootTop],
      shape: (r, y) => {
        if (fur) return pad(r, 0.016);
        if (o.barefoot) return;
        if (y > bootTop) pad(r, 0.009 + 0.008 * smooth(knee, bootTop, y));       // trousers hang loose toward the boot
        else pad(r, 0.01);
      },
      bump: shaggy(0.045),
      slot: (y) => (fur ? "top" : o.barefoot ? (y > knee - 0.1 ? "bottom" : "skin") : y > bootTop ? "bottom" : "boot"),
      skin: (y) => (y > knee - 0.2 ? blend(shinB, thighB, knee - 0.05 * k, knee + 0.05 * k, y) : blend(footB, shinB, d.ankle - 0.01, d.ankle + 0.04 * k, y)),
    });
    // The foot: a boot (or a bare foot) along z, its sole flat on the ground.
    const big = fur ? 1.25 : 1;
    const F = (z: number, w: number, topY: number): Ctl => ({ y: -z * k * big, w: w * k * big, f: topY * k, b: 0, x: d.hipX * s, p: 3 });
    m.tube([F(0.2, 0.043, 0.046), F(0.15, 0.051, 0.054), F(0.09, 0.05, 0.07), F(0.03, 0.046, 0.1), F(-0.02, 0.042, 0.108), F(-0.062, 0.035, 0.08)], {
      seg: 12, step: 0.03 * k, capTop: 0.012 * k, capBottom: 0.018 * k,
      m: new THREE.Matrix4().makeRotationX(-Math.PI / 2),
      slot: (_y, p) => (fur || o.barefoot ? (fur ? "bootDark" : "skin") : p.z < 0.022 * k ? "sole" : p.y > 0.13 * k ? "bootDark" : "boot"),
      skin: footB,
    });
  }

  // ---- arms and hands ----
  const af = 1 + 0.16 * d.fat + 0.2 * d.mu, ff = 1 + 0.08 * d.fat + 0.14 * d.mu;
  const elbow = d.shoulderY - d.upper, wrist = elbow - d.fore, az = -0.012 * k;
  const cuff = wrist + 0.02 * k, sleeveEnd = top.sleeve === "long" ? cuff : d.shoulderY - 0.6 * d.upper;
  for (const [s, n] of [[-1, "R"], [1, "L"]] as const) {
    const armB = B[`arm${n}`], foreB = B[`fore${n}`], handB = B[`hand${n}`];
    const A = (rel: number, w: number, f: number, back: number, x = 0, p = 2): Ctl => ({ y: d.shoulderY + rel, w: w * k, f: f * k + az, b: back * k + az, x: (d.shoulderX + x * k) * s, p });
    const U = d.upper, Fo = d.fore, h = k;
    m.tube([
      A(-U - Fo - 0.162 * h, 0.01, 0.034, -0.008, -0.024, 2.6),
      A(-U - Fo - 0.13 * h, 0.013, 0.04, -0.02, -0.013, 2.6),
      A(-U - Fo - 0.088 * h, 0.016, 0.043, -0.03, -0.004, 2.6),
      A(-U - Fo - 0.04 * h, 0.018, 0.04, -0.032, 0, 2.4),
      A(-U - Fo, 0.022, 0.03, -0.027),
      A(-U - 0.6 * Fo, 0.03 * ff, 0.034 * ff, -0.03 * ff),
      A(-U - 0.2 * Fo, 0.037 * ff, 0.043 * ff, -0.04 * ff),
      A(-U, 0.035, 0.037, -0.041),
      A(-0.88 * U, 0.036, 0.039, -0.039),
      A(-0.5 * U, 0.043 * af, 0.049 * af, -0.046 * af),
      A(-0.09 * k, 0.049 * (0.4 + 0.6 * af), 0.054 * (0.5 + 0.5 * af), -0.053 * (0.5 + 0.5 * af)),
      A(-0.02 * k, 0.05 * (0.6 + 0.4 * af), 0.056, -0.056, -0.004),
      A(0.02 * k, 0.04, 0.046, -0.046, -0.012),
    ], {
      seg: 12, step: 0.026 * k, capTop: 0.016 * k, capBottom: 0.012 * k, cuts: fur ? [] : [sleeveEnd],
      shape: (r, y) => {
        if (fur) return pad(r, y > wrist ? 0.016 : 0);
        if (y > sleeveEnd) pad(r, top.thick * 0.85 + baffle(y) + (y < sleeveEnd + 0.03 * k ? 0.003 : 0));
      },
      bump: (p, _a, y) => { if (y > wrist) shaggy(0.05)(p); },
      tone: (_p, y) => [0.45 * smooth(wrist - 0.06 * k, wrist - 0.15 * k, y) + 0.3 * gauss(y - (wrist - 0.085 * k), 0.012 * k) + 0.3 * gauss(y - elbow, 0.03 * k), 0],
      slot: (y) => (fur ? (y > wrist ? "top" : "bootDark") : y > sleeveEnd ? (y < sleeveEnd + 0.03 * k ? "topDark" : "top") : "skin"),
      skin: (y) => (y > elbow - 0.12 ? blend(foreB, armB, elbow - 0.04 * k, elbow + 0.04 * k, y) : blend(handB, foreB, wrist - 0.015 * k, wrist + 0.02 * k, y)),
    });
    // a thumb, on the front edge of the hand
    const tm = new THREE.Matrix4().makeTranslation(d.shoulderX * s - 0.006 * k * s, wrist - 0.035 * k, az + 0.036 * k).multiply(new THREE.Matrix4().makeRotationX(0.55));
    m.tube([{ y: -0.068 * k, w: 0.008 * k, f: 0.009 * k, b: -0.009 * k }, { y: -0.03 * k, w: 0.011 * k, f: 0.012 * k, b: -0.012 * k }, { y: 0.01 * k, w: 0.012 * k, f: 0.014 * k, b: -0.014 * k }],
      { seg: 8, step: 0.025 * k, capBottom: 0.008 * k, m: tm, slot: fur ? "bootDark" : "skin", skin: handB });
  }

  head(m, d, o, face);
  /** How far forward the front of the top is at (x, y): what a strap lies on. */
  const chestZ = (x: number, y: number) => {
    const r = sample(torsoCtl, y);
    pad(r, top.thick + 0.01);
    const u = Math.min(0.98, Math.abs(x) / r.w), z = (r.f + r.b) / 2 + ((r.f - r.b) / 2) * (1 - u ** r.p) ** (1 / r.p);
    return z + 0.045 * b.bust * k * gauss(Math.hypot(Math.abs(x) - 0.068 * k, (y - (t.chest.y - 0.012 * k)) * 0.9), 0.05 * k);
  };
  if (o.pack) pack(m, d, top.thick + 0.006, chestZ);
  if (o.belt) dutyBelt(m, d, hem);
  if (o.torch) torch(m, d, wrist, az);
  return m.geometry();
}

/** The skull's rings at head scale 1, y from the eye line: [y, half-width, front, back, superellipse power]. */
const SKULL: [number, number, number, number, number][] = [
  [-0.1, 0.03, 0.09, 0.02, 2.2], [-0.082, 0.047, 0.094, -0.008, 2.4], [-0.062, 0.058, 0.095, -0.028, 2.5], [-0.042, 0.066, 0.094, -0.07, 2.4],
  [-0.02, 0.071, 0.092, -0.092, 2.3], [0, 0.0735, 0.09, -0.1, 2.2], [0.025, 0.0755, 0.093, -0.103, 2.1], [0.05, 0.0765, 0.091, -0.1, 2],
];
const CROWN = 0.067;
/** Where hair starts, going round from the front of the head (0) to the back (pi): the height of the hairline there. */
function hairline(a: number): number {
  if (a < 0.9) return 0.064 - 0.012 * (a / 0.9) ** 2;
  if (a < 1.35) return lerp(0.052, 0.012, (a - 0.9) / 0.45);          // the temple, down to the sideburn
  if (a < 1.75) return lerp(0.012, -0.012, (a - 1.35) / 0.4);         // round the ear
  return lerp(-0.012, -0.062, smooth(1.75, 2.4, a));                  // down to the nape
}

function head(m: Builder, d: Dims, o: Outfit, fc: Face) {
  const hs = d.hs, eyeY = d.eye, z0 = d.headZ, fur = o.top === "fur";
  const jaw = lerp(1.05, 0.93, d.g) + 0.03 * d.mu + 0.05 * fc.jaw, full = Math.max(0, d.fat), brow = lerp(1.25, 0.6, d.g) * (1 + 0.35 * fc.brow);
  // Where the eyes sit and how big they are, and the nose's length and width, from the face.
  const ex = 0.031 + 0.0022 * fc.eyeGap, er = 1 + 0.07 * fc.eyes, nl = 1 + 0.07 * fc.nose, nw = 1 + 0.16 * fc.noseWidth;
  const tip = -0.054 * nl, wing = -0.041 * nl;
  const ctl = (grow = 0, lift = 0): Ctl[] => SKULL.map(([y, w, f, back, p]) => {
    const low = smooth(0, -0.07, y);                                   // 0 at the eyes, 1 at the jaw
    return { y: eyeY + (y + lift) * hs, w: (w * lerp(1, jaw, low) + 0.006 * full * low + grow) * hs, f: z0 + (f + grow) * hs, b: z0 + (back - grow) * hs + 0.006 * full * low, p };
  });
  const X = (v: number) => v * hs, Y = (v: number) => eyeY + v * hs;
  // The face, as heights on the front of the skull.
  const face = (p: THREE.Vector3) => {
    if (p.z < z0 + 0.03 * hs) return;
    const x = p.x / hs, y = (p.y - eyeY) / hs, ax = Math.abs(x);
    let dz = 0;
    // eye sockets: shallow enough that the skin runs onto the lids instead of leaving them standing in a pit
    dz -= 0.0052 * er * gauss(ax - ex, 0.0135 * er) * gauss(y + 0.0005, 0.0068 * er);
    dz += 0.0035 * brow * gauss(y - 0.019, 0.007) * smooth(0.058, 0.03, ax);                  // the brow ridge
    const down = clamp01((0.008 - y) / (0.008 - tip + 0.004));                                // 0 at the bridge, 1 at the tip
    // the bridge, narrow between the eyes, and a tip that rounds under into the nostrils rather than ending in a ledge
    if (y < 0.014 && y > tip - 0.006) dz += lerp(0.005, 0.026, down ** 1.2) * gauss(x, lerp(0.0065, 0.0125 * nw, down)) * smooth(tip - 0.006, tip + 0.012, y);
    dz += 0.0065 * gauss(ax - 0.015 * nw, 0.0062 * nw) * gauss(y - wing, 0.0062);              // the wings of the nose
    dz -= 0.0022 * gauss(ax - 0.012 * nw, 0.0028) * gauss(y - wing + 0.0035, 0.0024);         // the crease round each wing
    dz += 0.0045 * gauss(x, 0.02) * gauss(y + 0.062, 0.0045);                                 // upper lip
    dz -= 0.0012 * gauss(x, 0.0035) * gauss(y + 0.0585, 0.004);                               // the groove under the nose
    dz += 0.0045 * (1 + 0.3 * fc.lips) * gauss(x, 0.017) * gauss(y + 0.0735, 0.005);         // lower lip
    dz -= 0.003 * gauss(x, 0.02) * gauss(y + 0.0675, 0.002);                                  // where they meet
    dz -= 0.003 * gauss(x, 0.02) * gauss(y + 0.084, 0.005);
    dz += 0.005 * (1 + 0.5 * fc.chin) * gauss(x, 0.017 * (1 + 0.15 * fc.jaw)) * gauss(y + 0.1, 0.01); // chin
    dz += (0.004 + 0.004 * full + 0.0022 * fc.cheeks) * gauss(ax - 0.046, 0.018) * gauss(y + 0.03 - 0.006 * fc.cheeks, 0.02); // cheeks
    p.z += dz * hs * smooth(0.03, 0.055, (p.z - z0) / hs);
  };
  // Blood shows in the cheeks, the nose and the chin; the sockets, under the nose and under the jaw sit in shadow.
  const faceTone = (p: THREE.Vector3): [number, number] => {
    const x = p.x / hs, y = (p.y - eyeY) / hs, ax = Math.abs(x), front = smooth(0.02, 0.06, (p.z - z0) / hs);
    const flush = front * (0.9 * gauss(ax - 0.044, 0.017) * gauss(y + 0.03, 0.018) + 0.8 * gauss(x, 0.012) * gauss(y + 0.04, 0.011) + 0.35 * gauss(x, 0.02) * gauss(y + 0.1, 0.012));
    const shade = front * (0.6 * gauss(ax - ex, 0.013) * gauss(y - 0.004, 0.008) + 0.45 * gauss(ax - 0.0075 * nw, 0.003) * gauss(y - tip - 0.0055, 0.0024) + 0.12 * gauss(x, 0.014) * gauss(y + 0.084, 0.004))
      + 0.4 * smooth(-0.095, -0.115, y);
    return [flush, shade];
  };
  m.tube(ctl(), {
    tone: fur ? undefined : faceTone,
    seg: 52, step: 0.0044 * hs, capTop: CROWN * hs, capBottom: 0.02 * hs, front: 0.62,
    bump: (p) => {
      face(p);
      if (!fur || (p.z > z0 + 0.05 * hs && p.y < Y(0.03))) return;
      const n = 1 + 0.2 * hash(p.x * 31.7, p.y * 17.3, p.z * 23.9);
      p.x *= n; p.z = z0 + (p.z - z0) * n;
    },
    slot: (y, p) => {
      if (fur) return p.z < z0 + 0.05 * hs || p.y > Y(0.028) ? "top" : "bootDark";
      const x = Math.abs(p.x) / hs, yy = (p.y - eyeY) / hs + 0.0677;
      return p.z > z0 + 0.07 * hs && x < 0.021 && Math.abs(yy) < (yy > 0 ? 0.0055 : 0.0075) * (1 - (x / 0.022) ** 2) ? "lips" : "skin";
    },
    skin: B.head,
  });
  // Eyes: a ball in each socket with a coloured iris and a pupil on its front, under lids that make an almond of it:
  // the upper lid covers the top of the iris, the lower one meets its bottom, so the eye looks out rather than stares.
  for (const s of [-1, 1]) {
    const em = new THREE.Matrix4().makeTranslation(X(ex) * s, Y(0.001), z0 + 0.0728 * hs).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    const r = 0.0118 * hs * er;
    const ball = (y: number): Ctl => { const w = Math.sqrt(1 - y * y) * r; return { y: y * r, w, f: w, b: -w }; };
    m.tube([ball(0.65), ball(0.8), ball(0.88), ball(0.94), ball(0.985)],
      // the ball turned a little out toward the temple, as eyes look, so the iris sits mid-opening rather than by the nose
      { seg: 16, step: r * 0.08, cuts: [r * 0.865, r * 0.972], capTop: r * 0.015, m: new THREE.Matrix4().makeTranslation(X(ex) * s, Y(0.001), z0 + 0.0728 * hs).multiply(new THREE.Matrix4().makeRotationY(0.14 * s)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)), slot: (y) => (fur ? "glow" : y > r * 0.972 ? "pupil" : y > r * 0.865 ? "iris" : "eyeWhite"), skin: B.head });
    if (fur) continue;
    // The opening, in the lid's own units across (u, toward the temple when positive) and up: the top arcs higher
    // toward the outer corner, the bottom is flatter, and both close to a point at the corners.
    const edge = (u: number) => { const w = Math.sqrt(Math.max(0, 1 - (u / 0.92) ** 2)); return [0.36 * w ** 0.8 + 0.04 * u, -0.42 * w ** 1.2 + 0.03 * u] as const; };
    m.tube([ball(0.3), ball(0.5), ball(0.7), ball(0.85), ball(0.95)].map((c) => ({ ...c, w: c.w * 1.1, f: c.f * 1.1, b: c.b * 1.1, y: c.y * 1.1 })), {
      seg: 24, step: r * 0.1, capTop: r * 0.05, m: em, skin: B.head,
      // up is -z here (the ball is built looking along y, then turned to look forward)
      bump: (p) => {
        const up = -p.z / r, [hi, lo] = edge((p.x / r) * s);
        const open = smooth(hi + 0.05, hi - 0.03, up) * smooth(lo - 0.04, lo + 0.03, up);
        p.multiplyScalar(lerp(1, 0.8, open));
      },
      // a dark lash line along the top edge, and the lid's crease a little above it
      slot: (_y, p) => { const up = -p.z / r, [hi] = edge((p.x / r) * s); return up > hi - 0.05 && up < hi + 0.09 && hi > 0.02 ? "brow" : "skin"; },
      tone: (p) => { const up = -p.z / r, [hi] = edge((p.x / r) * s); return [0.15, up > 0 ? 0.3 + 0.35 * gauss(up - hi - 0.22, 0.06) : 0.2]; },
    });
    // an ear, and a brow that sits on the ridge
    const ear = new THREE.Matrix4().makeTranslation(X(0.0745) * s, Y(-0.012), z0 - 0.012 * hs).multiply(new THREE.Matrix4().makeRotationY(-0.35 * s)).multiply(new THREE.Matrix4().makeRotationZ(-0.12 * s));
    if (!fur) m.tube([{ y: X(-0.026), w: X(0.004), f: X(0.006), b: X(-0.006) }, { y: X(-0.008), w: X(0.007), f: X(0.012), b: X(-0.014) }, { y: X(0.016), w: X(0.008), f: X(0.014), b: X(-0.018) }, { y: X(0.03), w: X(0.005), f: X(0.008), b: X(-0.012) }],
      { seg: 8, step: X(0.01), capTop: X(0.004), capBottom: X(0.004), m: ear, slot: "skin", skin: B.head, tone: () => [0.6, 0.1] });
    const bm = new THREE.Matrix4().makeTranslation(X(0.032) * s, Y(0.0215), z0 + 0.0905 * hs).multiply(new THREE.Matrix4().makeRotationZ((Math.PI / 2 + 0.1) * -s)).multiply(new THREE.Matrix4().makeRotationX(0.42));
    const bw = lerp(0.0036, 0.0022, d.g);
    if (!fur) m.tube([{ y: X(-0.019), w: X(bw * 0.7), f: X(0.003), b: X(-0.003) }, { y: X(-0.004), w: X(bw), f: X(0.004), b: X(-0.003) }, { y: X(0.017), w: X(bw * 0.5), f: X(0.001), b: X(-0.004) }],
      { seg: 6, step: X(0.009), capTop: X(0.003), capBottom: X(0.002), m: bm, slot: "brow", skin: B.head });
  }
  if (fur) return;
  // The mouth: an upper lip, a fuller lower one, and the dark line where they meet.
  const across = (y: number) => new THREE.Matrix4().makeTranslation(0, Y(y), 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  const lip = (x: number, tall: number, out: number): Ctl => ({ y: X(x), w: X(tall), f: z0 + X(0.1005 + out - 6.5 * x * x), b: z0 + X(0.09 - 6.5 * x * x) });
  const plump = lerp(0.85, 1.15, d.g) * (1 + 0.22 * fc.lips);
  m.tube([lip(-0.023, 0.0004, 0.001), lip(-0.012, 0.0038 * plump, 0.0036), lip(0, 0.0034 * plump, 0.0042), lip(0.012, 0.0038 * plump, 0.0036), lip(0.023, 0.0004, 0.001)],
    { seg: 8, step: X(0.0075), m: across(-0.0642), slot: "lips", skin: B.head });
  m.tube([lip(-0.021, 0.0004, 0.001), lip(-0.011, 0.0042 * plump, 0.0036), lip(0, 0.0052 * plump, 0.0042), lip(0.011, 0.0042 * plump, 0.0036), lip(0.021, 0.0004, 0.001)],
    { seg: 8, step: X(0.0075), m: across(-0.0712), slot: "lips", skin: B.head });
  m.tube([lip(-0.02, 0.0003, 0.0022), lip(0, 0.0006, 0.0036), lip(0.02, 0.0003, 0.0022)], { seg: 6, step: X(0.012), m: across(-0.0672), slot: "pupil", skin: B.head });

  // Hair: a sheet over the skull that starts on the hairline, thin at its edge and full a finger above it. Long hair
  // carries on down the back, behind the ears. A hat presses the top of it flat.
  if (o.hair !== "bald") {
    const under = o.hat !== "none", long = o.hair === "long";
    const thick = o.hair === "curly" ? 0.022 : long ? 0.012 : 0.008;
    const skull = ctl(), ROWS = 14, COLS = 36, TOP = 0.05 + CROWN, FALL = -0.25;
    /** The point on the skull at this turn round it and this height (from the eye line, head scale 1). */
    const scalp = (u: number, yy: number, out: THREE.Vector3) => {
      const t = u + 0.5 * Math.cos(u), hang = long && yy < -0.02;
      const r = sample(skull, Y(clamp(yy, -0.02, 0.05)));
      const q = clamp01((yy - 0.05) / CROWN), scale = Math.sqrt(1 - q * q) * (hang ? lerp(1, 0.86, (yy + 0.02) / (FALL + 0.02)) : 1);
      const c = Math.cos(t), sn = Math.sin(t), e = 2 / r.p, zc = (r.f + r.b) / 2, zd = (r.f - r.b) / 2;
      return out.set(r.w * scale * Math.sign(c) * Math.abs(c) ** e, Y(yy), zc + zd * scale * Math.sign(sn) * Math.abs(sn) ** e);
    };
    const tmp = new THREE.Vector3(), out = new THREE.Vector3();
    const cols = Array.from({ length: COLS }, (_, j) => {
      const u = (j / COLS) * Math.PI * 2;
      scalp(u, 0.02, tmp);
      const a = Math.abs(Math.atan2(tmp.x, tmp.z - z0));
      return { u, a, lo: long && a > 1.72 ? FALL : hairline(a) };
    });
    m.sheet(ROWS, COLS, (i, j, p) => {
      const { u, a, lo } = cols[j]!, t = (i / (ROWS - 1)) ** 1.6, yy = lerp(lo, TOP, t);
      scalp(u, yy, p);
      const rise = smooth(0, 0.012, yy - lo);                                   // the edge of the hair: thin, then full
      let grow = 0.0012 + thick * rise;
      if (o.hair === "curly") grow += rise * 0.016 * hash(i * 7.3, j * 3.1, 1);
      if (o.hair === "short") grow += rise * 0.007 * smooth(0.03, 0.09, yy) * smooth(1.7, 0.5, a);   // more on top, swept up at the front
      if (long) grow += rise * 0.006 * smooth(0.02, -0.1, yy);
      if (under && yy > 0.024) grow = Math.min(grow, 0.003);
      p.add(out.set(p.x, (p.y - eyeY) * 0.6, p.z - z0 + 0.005 * hs).setLength(grow * hs));
    }, "hair", (p) => (p.y < d.chin ? blend(B.chest, B.head, d.chin - 0.12 * hs, d.chin, p.y) : [B.head, B.head, 0]));
  }
  hat(m, d, o.hat, ctl);
}

function hat(m: Builder, d: Dims, kind: Hat, ctl: (grow?: number, lift?: number) => Ctl[]) {
  if (kind === "none") return;
  const hs = d.hs, eyeY = d.eye, z0 = d.headZ, Y = (v: number) => eyeY + v * hs, X = (v: number) => v * hs;
  const skull = ctl(), ring = (y: number, grow: number): Ctl => { const r = sample(skull, Y(y)); pad(r, grow * hs); return r; };
  const top = (y: number, grow: number, scale: number, rise = 0): Ctl => {
    // above the last skull ring the head is a dome: its radius at this height, then the hat's thickness
    const base = skull.at(-1)!, t = clamp01((y - 0.05) / CROWN), c = Math.sqrt(Math.max(0, 1 - t * t)) * scale;
    const zc = (base.f + base.b) / 2, zd = (base.f - base.b) / 2;
    return { y: Y(y + rise), w: base.w * c + grow * hs, f: zc + zd * c + grow * hs, b: zc - zd * c - grow * hs, p: 2 };
  };
  const on = { slot: "hat" as Slot, skin: B.head };
  if (kind === "beanie") {
    m.tube([ring(0.03, 0.013), ring(0.05, 0.014), top(0.058, 0.013, 1)], { seg: 24, step: X(0.01), ...on, slot: "hatDark" });
    m.tube([top(0.058, 0.009, 1), top(0.08, 0.009, 1), top(0.1, 0.01, 1, 0.004), top(0.112, 0.012, 0.9, 0.01)], { seg: 24, step: X(0.009), capTop: X(0.03), ...on });
    const pm = new THREE.Matrix4().makeTranslation(0, Y(0.158), z0 - X(0.006));
    m.tube([{ y: -X(0.012), w: X(0.02), f: X(0.02), b: -X(0.02) }, { y: X(0.012), w: X(0.02), f: X(0.02), b: -X(0.02) }], { seg: 10, step: X(0.012), capTop: X(0.012), capBottom: X(0.012), m: pm, slot: "trim", skin: B.head });
    return;
  }
  if (kind === "cap") {
    m.tube([ring(0.036, 0.006), top(0.058, 0.006, 1), top(0.09, 0.007, 1), top(0.108, 0.008, 0.92, 0.004)], { seg: 24, step: X(0.01), capTop: X(0.024), ...on });
    // the bill: a flat tongue out over the brow
    const bm = new THREE.Matrix4().makeTranslation(0, Y(0.038), z0 + X(0.088)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 + 0.16));
    m.tube([{ y: -X(0.012), w: X(0.074), f: X(0.004), b: -X(0.003), p: 2 }, { y: X(0.03), w: X(0.07), f: X(0.004), b: -X(0.002), p: 2 }, { y: X(0.062), w: X(0.052), f: X(0.004), b: -X(0.001), p: 2 }],
      { seg: 14, step: X(0.015), capTop: X(0.014), m: bm, slot: "hatDark", skin: B.head });
    return;
  }
  if (kind === "bucket") {
    m.tube([ring(0.034, 0.006), top(0.058, 0.006, 1), top(0.085, 0.008, 1), top(0.098, 0.014, 0.97, 0.004)], { seg: 24, step: X(0.01), capTop: X(0.012), ...on });
    // the brim slopes down and out
    const brim = (y: number, grow: number): Ctl => ring(y, grow);
    m.tube([brim(0.006, 0.062), brim(0.01, 0.06), brim(0.038, 0.01)], { seg: 24, step: X(0.012), ...on, slot: "hatDark" });
    return;
  }
  // The campaign hat: a stiff flat brim, a band, and a tall crown pinched in at four points.
  m.tube([ring(0.036, 0.085), ring(0.04, 0.088), ring(0.045, 0.085)], { seg: 28, step: X(0.004), ...on });
  m.tube([ring(0.04, 0.008), ring(0.062, 0.008)], { seg: 24, step: X(0.011), ...on, slot: "band" });
  m.tube([top(0.06, 0.007, 1), top(0.09, 0.009, 1.02), top(0.108, 0.02, 0.96, 0.02), top(0.11, 0.02, 0.8, 0.045)], {
    seg: 24, step: X(0.009), capTop: X(0.022), ...on,
    bump: (p, ang, y) => {
      const up = smooth(0.085, 0.16, (y - eyeY) / hs), pinch = Math.cos(2 * ang) ** 2;       // four dents, between front, back and sides
      p.x *= 1 - 0.3 * up * pinch; p.z = z0 + (p.z - z0) * (1 - 0.3 * up * pinch);
    },
  });
}

/** A day pack on the back, a bedroll under it, straps over the shoulders. */
function pack(m: Builder, d: Dims, over: number, chestZ: (x: number, y: number) => number) {
  const k = d.k, t = d.torso, back = Math.min(t.chest.b, t.armpit.b) - over;
  const P = (y: number, w: number, deep: number, p = 3.4): Ctl => ({ y, w: w * k, f: back + 0.012, b: back - deep * k, p });
  m.tube([P(t.waist.y - 0.02 * k, 0.118, 0.1), P(t.ribs.y, 0.13, 0.135), P(t.armpit.y, 0.128, 0.125), P(t.shoulder.y + 0.01 * k, 0.11, 0.09)],
    { seg: 14, step: 0.04 * k, capTop: 0.03 * k, capBottom: 0.02 * k, slot: (y) => (y > t.armpit.y + 0.01 * k ? "packDark" : "pack"), skin: B.chest });
  m.tube([P(t.ribs.y - 0.05 * k, 0.085, 0.165), P(t.ribs.y + 0.06 * k, 0.085, 0.165)], { seg: 10, step: 0.05 * k, capTop: 0.012 * k, capBottom: 0.012 * k, slot: "packDark", skin: B.chest });
  // the bedroll, across the bottom
  const rm = new THREE.Matrix4().makeTranslation(0, t.waist.y - 0.06 * k, back - 0.06 * k).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2));
  m.tube([{ y: -0.15 * k, w: 0.052 * k, f: 0.052 * k, b: -0.052 * k }, { y: 0.15 * k, w: 0.052 * k, f: 0.052 * k, b: -0.052 * k }], { seg: 12, step: 0.1 * k, capTop: 0.006, capBottom: 0.006, m: rm, slot: "roll", skin: B.spine });
  // Straps: a band from the top of the pack, over the shoulder and down the chest to the bottom of the pack.
  for (const s of [-1, 1]) {
    const x = (t.trap.w + 0.02 * k) * s, lo = t.ribs.y - 0.03 * k, hi = t.shoulder.y - 0.004 * k;
    const pts: V3[] = [[x * 1.2, lo - 0.03 * k, chestZ(x, lo) * 0.4], ...Array.from({ length: 7 }, (_, i): V3 => { const y = lerp(lo, hi, i / 6); return [x, y, chestZ(x, y)]; }),
      [x, t.shoulder.y + 0.026 * k + over, 0.012 * k], [x, t.shoulder.y + 0.014 * k + over, -0.06 * k], [x, t.armpit.y, back + 0.012]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = new THREE.Vector3(...pts[i]!), c = new THREE.Vector3(...pts[i + 1]!), len = a.distanceTo(c);
      const sm = new THREE.Matrix4().compose(a.clone().add(c).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize()), new THREE.Vector3(1, 1, 1));
      m.tube([{ y: -len / 2 - 0.006, w: 0.017 * k, f: 0.006, b: -0.006, p: 4 }, { y: len / 2 + 0.006, w: 0.017 * k, f: 0.006, b: -0.006, p: 4 }], { seg: 6, step: len, m: sm, slot: "strap", skin: B.chest });
    }
  }
}

/** On the belt: a radio on the right hip with its aerial, a pouch on the left, a buckle. */
function dutyBelt(m: Builder, d: Dims, y: number) {
  const k = d.k, w = d.torso.crest.w + 0.012;
  const box = (x: number, yy: number, z: number, sx: number, sy: number, sz: number, slot: Slot) => m.tube(
    [{ y: -sy / 2, w: sx / 2, f: sz / 2, b: -sz / 2, p: 6 }, { y: sy / 2, w: sx / 2, f: sz / 2, b: -sz / 2, p: 6 }],
    { seg: 8, step: sy, m: new THREE.Matrix4().makeTranslation(x, yy, z), slot, skin: B.hips });
  box(-w - 0.012 * k, y + 0.01 * k, -0.01, 0.03 * k, 0.095 * k, 0.05 * k, "kit");
  box(-w - 0.012 * k, y + 0.1 * k, -0.025, 0.008 * k, 0.09 * k, 0.008 * k, "kit");
  box(w + 0.012 * k, y - 0.012 * k, 0, 0.034 * k, 0.07 * k, 0.075 * k, "band");
  box(0, y, d.torso.crest.f + 0.014, 0.06 * k, 0.045 * k, 0.012 * k, "metal");
}

/** A flashlight in the right hand, along the forearm; its lens is the `glow` slot. */
function torch(m: Builder, d: Dims, wrist: number, az: number) {
  const k = d.k, x = -d.shoulderX - 0.004 * k, tm = new THREE.Matrix4().makeTranslation(x, wrist - 0.07 * k, az + 0.03 * k);
  const c = (y: number, r: number): Ctl => ({ y: y * k, w: r * k, f: r * k, b: -r * k });
  m.tube([c(-0.2, 0.031), c(-0.165, 0.031), c(-0.13, 0.02), c(0.07, 0.02)], { seg: 10, step: 0.03 * k, m: tm, slot: "kit", skin: B.handR });
  m.tube([c(-0.206, 0.027), c(-0.2, 0.027)], { seg: 10, step: 0.01, m: tm, slot: "glow", skin: B.handR });
}

// ---- the figure: mesh, bones, and the walk --------------------------------------------------------------------------

/** How the figure is moving this frame. */
export interface Move {
  /** Ground speed, m/s. */
  speed: number;
  /** Which way it travels, radians from the way it faces: 0 ahead, pi/2 to its left, pi backwards. */
  heading?: number;
  /** Crouched: true or false, or how far (0 to 1). */
  crouch?: boolean | number;
  /** Looking up (+) or down (-), radians. */
  pitch?: number;
  /** Holds the right forearm out ahead (a flashlight shines that way). */
  aim?: boolean;
  /** Sat on the ground, out of the game. */
  down?: boolean;
}

export interface Human {
  /** Feet at its origin. Holds the mesh and the bones. */
  root: THREE.Group;
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  /** Standing height, metres (hair and hats not counted). */
  height: number;
  /** The base of the skull after the last pose, in the figure's own space: a name tag sits above it. */
  headAt: THREE.Vector3;
  pose(move: Move, dt: number): void;
  /** Where in the stride it is, 0 to 1 (one step with each foot); with a number, puts it there (a still for a picture or a test). */
  stride(at?: number): number;
  /** Repaints it: the mesh is shared, the colours are this figure's. */
  paint(palette: Palette): void;
  dispose(): void;
}

const meshes = new Map<string, { geo: THREE.BufferGeometry; dims: Dims }>();
/**
 * One material for the whole figure. What a point is made of (the `surface` attribute) changes how it's lit:
 * - skin is mottled (blotches a few centimetres across, pores under a millimetre), smoother than cloth where the pores
 *   aren't, and glows warm at its edges where light gets into it and back out;
 * - eyes are wet, so they catch a highlight;
 * - hair has strands: streaks that run the way it falls;
 * - cloth has a weave.
 * The patterns are worked out from where the point is on the body at rest, so they stay put as it moves.
 */
const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 });
material.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nattribute float surface;\nvarying float vSurface;\nvarying vec3 vRest;")
    .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSurface = surface;\nvRest = position;");
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", `#include <common>
varying float vSurface;
varying vec3 vRest;
float hHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hHash(i), hHash(i + vec3(1, 0, 0)), f.x), mix(hHash(i + vec3(0, 1, 0)), hHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hHash(i + vec3(0, 0, 1)), hHash(i + vec3(1, 0, 1)), f.x), mix(hHash(i + vec3(0, 1, 1)), hHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float hSkin, hEye, hHair, hCloth, hPore;`)
    .replace("#include <color_fragment>", `#include <color_fragment>
hSkin = 1.0 - smoothstep(0.0, 0.5, abs(vSurface - 1.0));
hEye = 1.0 - smoothstep(0.0, 0.5, abs(vSurface - 2.0));
hHair = 1.0 - smoothstep(0.0, 0.5, abs(vSurface - 3.0));
hCloth = 1.0 - smoothstep(0.0, 0.5, vSurface);
// a pattern finer than a pixel would only shimmer: fade each one out as the figure gets far away
float hPx = length(fwidth(vRest));
float hFine = 1.0 - smoothstep(0.25, 0.9, hPx * 1300.0), hMid = 1.0 - smoothstep(0.25, 0.9, hPx * 500.0);
float hBlotch = hNoise(vRest * 38.0) * 0.5 + hNoise(vRest * 110.0) * 0.3 + hNoise(vRest * 300.0) * 0.2 * hMid;
hPore = mix(0.5, hNoise(vRest * 1700.0) * 0.5 + hNoise(vRest.yzx * 2900.0) * 0.5, hFine);
// a few freckles and moles: rare dark specks
float hSpeck = smoothstep(0.62, 0.74, hNoise(vRest * 610.0) * hNoise(vRest.zxy * 470.0 + 3.1) * 1.7) * hMid;
// skin: blotches that shift it redder or paler, and pores that speckle it
diffuseColor.rgb *= mix(vec3(1.0), vec3(1.0 + (hBlotch - 0.5) * 0.12, 1.0 + (hBlotch - 0.5) * 0.4, 1.0 + (hBlotch - 0.5) * 0.46) * (0.93 + hPore * 0.14) * (1.0 - 0.13 * hSpeck), hSkin);
// hair: strands, long the way it falls
float hStrand = mix(0.5, hNoise(vRest * vec3(520.0, 28.0, 520.0)), hMid) * 0.65 + hNoise(vRest * vec3(160.0, 9.0, 160.0)) * 0.35;
diffuseColor.rgb *= mix(1.0, 0.62 + hStrand * 0.8, hHair);
// cloth: a weave
float hWeave = mix(0.5, hNoise(vRest * 900.0), hFine);
diffuseColor.rgb *= mix(1.0, 0.9 + 0.14 * hWeave + 0.08 * hNoise(vRest * 45.0), hCloth);`)
    .replace("#include <normal_fragment_maps>", `#include <normal_fragment_maps>
// Pores, strands and the weave are bumps too: tilt the surface by their slope, so a highlight breaks up on them.
float hHeight = hSkin * hPore * 0.00035 + hHair * hStrand * 0.0012 + hCloth * hWeave * 0.0004;
vec3 hDx = dFdx(-vViewPosition), hDy = dFdy(-vViewPosition);
vec3 hR1 = cross(hDy, normal), hR2 = cross(normal, hDx);
float hDet = dot(hDx, hR1);
normal = normalize(abs(hDet) * normal - sign(hDet) * (dFdx(hHeight) * hR1 + dFdy(hHeight) * hR2));`)
    .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.44 + hPore * 0.2 + hBlotch * 0.1, hSkin);
roughnessFactor = mix(roughnessFactor, 0.06, hEye);
roughnessFactor = mix(roughnessFactor, 0.42 + hStrand * 0.3, hHair);`)
    .replace("#include <lights_fragment_end>", `#include <lights_fragment_end>
// light that goes into skin comes back out red, most where the surface turns away from the eye
float hRim = pow(1.0 - saturate(dot(geometryNormal, geometryViewDir)), 2.2);
reflectedLight.indirectDiffuse += hSkin * hRim * (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) * vec3(0.75, 0.2, 0.1);`);
};

/** A figure of this build in this outfit, standing at the origin. */
export function human(build: Build | BuildName, outfit: Outfit, palette: Palette = {}, seed = 1, face: Partial<Face> = {}): Human {
  const b = typeof build === "string" ? BUILDS[build] : build;
  // The seed picks the face and the eye colour; `face` and `palette.iris` override them.
  const f: Face = { ...faceOf(seed), ...face };
  palette = { iris: EYES[Math.floor(mulberry32(seed * 31 + 5)() * EYES.length)]!, ...palette };
  const key = JSON.stringify([b, outfit, f]);
  let made = meshes.get(key);
  if (!made) { const dims = measure(b); meshes.set(key, (made = { geo: buildMesh(dims, b, outfit, f), dims })); }
  const d = made.dims;
  // The mesh's shape, bones and weights are shared; its colours are its own.
  const geo = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "skinIndex", "skinWeight", "surface"]) geo.setAttribute(name, made.geo.getAttribute(name));
  geo.setIndex(made.geo.getIndex());
  const slots: Uint8Array = made.geo.userData.slots, tone: Float32Array = made.geo.userData.tone;
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(slots.length * 3), 3));

  const bones = {} as Record<BoneName, THREE.Bone>;
  for (const n of BONES) {
    const bone = (bones[n] = new THREE.Bone());
    bone.name = n;
    const p = PARENT[n], at = d.joints[n], from: V3 = p ? d.joints[p] : [0, 0, 0];
    bone.position.set(at[0] - from[0], at[1] - from[1], at[2] - from[2]);
    if (p) bones[p].add(bone);
  }
  const root = new THREE.Group();
  const mesh = new THREE.SkinnedMesh(geo, material);
  mesh.castShadow = true;
  mesh.frustumCulled = false;       // its bounds are the rest pose's; a crouch or a stride leaves them
  root.add(bones.hips, mesh);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BONES.map((n) => bones[n])));
  const eye = palette.iris;
  const paint = (p: Palette) => {
    const col = geo.getAttribute("color") as THREE.BufferAttribute, c = new THREE.Color();
    const rgb = SLOTS.map((s) => { c.set(p[s] ?? (s === "iris" ? eye : undefined) ?? DEFAULT_PALETTE[s]); return [c.r, c.g, c.b] as const; });
    const skin = SLOTS.indexOf("skin");
    for (let i = 0; i < slots.length; i++) {
      const [r, g, bl] = rgb[slots[i]!]!, flush = tone[i * 2]! * 0.55, lit = 1 - 0.42 * tone[i * 2 + 1]!;
      // flushed skin keeps its red and loses green and blue; shaded skin goes darker and a little warmer
      if (slots[i] === skin) col.setXYZ(i, r * lerp(1, 1.06, flush) * lit, g * lerp(1, 0.66, flush) * lit * lit, bl * lerp(1, 0.64, flush) * lit * lit);
      else col.setXYZ(i, r, g, bl);
    }
    col.needsUpdate = true;
  };
  paint(palette);
  const gait = new Gait(d, bones, seed);
  const me: Human = { root, mesh, bones, height: d.height, headAt: gait.headAt, paint, pose: (mv, dt) => gait.step(mv, dt),
    stride: (at) => (at === undefined ? gait.phase : (gait.phase = ((at % 1) + 1) % 1)), dispose: () => geo.dispose() };
  me.pose({ speed: 0 }, 0);
  return me;
}

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion(), e1 = new THREE.Euler();
const m1 = new THREE.Matrix4();
const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), t3 = new THREE.Vector3(), t4 = new THREE.Vector3();

/** The turn that takes a limb hanging straight down (its hinge bending toward +z) to `dir`, bending toward `pole`. */
function limbTurn(out: THREE.Quaternion, dir: THREE.Vector3, pole: THREE.Vector3): THREE.Quaternion {
  const y = v3.copy(dir).negate().normalize();
  const x = v4.crossVectors(y, pole).normalize();
  const z = v2.crossVectors(x, y);
  return out.setFromRotationMatrix(m1.makeBasis(x, y, z));
}

/**
 * The walk. Everything is worked out in the figure's own space (feet at y 0, facing +z): where each foot is, then the
 * pelvis as high as the legs allow, then the knees by two-bone IK, then the spine, arms and head on top.
 */
class Gait {
  /** Where in the stride it is: 0 to 1 is one step with each foot. */
  phase: number;
  private speed = 0; private crouch = 0; private run = 0; private down = 0; private aim = 0; private t: number;
  private hx = 0; private hz = 1;
  private pelvisY: number;
  private foot = [new THREE.Vector3(), new THREE.Vector3()];
  private legLen: number;
  headAt = new THREE.Vector3();

  constructor(private d: Dims, private bones: Record<BoneName, THREE.Bone>, seed: number) {
    const r = mulberry32(seed);
    this.phase = r(); this.t = r() * 20;
    this.pelvisY = d.hipY;
    this.legLen = d.thigh + d.shin;
  }

  step(mv: Move, dt: number) {
    const d = this.d, bn = this.bones, k = d.k;
    const ease = (rate: number) => 1 - Math.exp(-dt * rate) || (dt === 0 ? 1 : 0);
    this.t += dt;
    this.speed += (Math.max(0, mv.speed) - this.speed) * ease(9);
    this.crouch += ((typeof mv.crouch === "number" ? clamp01(mv.crouch) : mv.crouch ? 1 : 0) - this.crouch) * ease(9);
    this.down += ((mv.down ? 1 : 0) - this.down) * ease(5);
    this.aim += ((mv.aim ? 1 : 0) - this.aim) * ease(8);
    const v = this.speed, c = Math.max(this.crouch, this.down), sit = this.down;
    this.run += (smooth(2.6, 3.8, v) * (1 - c) - this.run) * ease(6);
    const run = this.run;
    // Which way the feet travel: the heading, eased so a change of direction is a turn of the stride, not a snap.
    const head = mv.heading ?? 0;
    this.hx += (Math.sin(head) - this.hx) * ease(10); this.hz += (Math.cos(head) - this.hz) * ease(10);
    const hl = Math.hypot(this.hx, this.hz) || 1, dx = this.hx / hl, dz = this.hz / hl;
    const back = dz < -0.3 ? 1 : 0;

    // A stride (two steps) grows with the square root of speed, as people's do; a crouch shortens it.
    const stride = Math.max(0.05, d.height * 0.7 * Math.sqrt(v) * (1 - 0.3 * c) * (1 - 0.25 * back));
    const go = smooth(0.05, 0.5, v);                       // 0 standing, 1 walking
    if (v > 0.03) this.phase = (this.phase + (dt * v) / stride) % 1;
    const duty = lerp(0.62, 0.36, run);                    // how much of a stride a foot is down
    const reach = stride * duty;

    // ---- feet ----
    const stanceX = d.hipX * lerp(0.98, 0.6, go) + 0.05 * k * c + 0.04 * sit, toeOut = 0.12 + 0.1 * c;
    const heel = v1.set(0, 0, -0.055 * k), ball = v2.set(0, 0, 0.125 * k);
    const pitch: number[] = [0, 0], ankleUp = d.ankle;
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, p = (this.phase + (i ? 0.5 : 0)) % 1;
      let along: number, lift = 0, th: number;
      const strike = -0.32 * go * (1 - c) * (1 - back), off = lerp(0.95, 1.1, run) * go * (1 - 0.4 * c) * (1 - 0.6 * back);
      if (p < duty) {
        const u = p / duty;
        along = reach * (0.5 - u);
        th = u < 0.14 ? strike * (1 - u / 0.14) : u > 0.5 ? off * ((u - 0.5) / 0.5) ** 1.5 : 0;
      } else {
        const w = (p - duty) / (1 - duty), e = w * w * (3 - 2 * w);
        along = reach * (e - 0.5);
        lift = go * lerp(0.05 + 0.03 * c, 0.16, run) * k * Math.sin(Math.PI * Math.pow(w, 0.75)) + run * 0.12 * k * Math.sin(Math.PI * w) ** 2;
        th = lerp(off, strike, smooth(0.1, 0.95, w)) + run * 0.5 * Math.sin(Math.PI * w);
      }
      // a crouch is staggered: one foot ahead of the other
      const stagger = (c * 0.09 + sit * 0.1) * k * -s;
      const f = this.foot[i]!;
      const behind = 0.09 * reach * (1 - back);
      f.set(s * stanceX + dx * along, lift, dz * (along - behind) + stagger + 0.02 * k - 0.04 * k * run);
      // the ankle: the foot turns about its heel when the toes are up, about the ball when the heel is
      const piv = th > 0 ? ball : heel, cs = Math.cos(th), sn = Math.sin(th);
      f.z += piv.z + ankleUp * sn - piv.z * cs;
      f.y = lift + ankleUp * cs + piv.z * sn;
      pitch[i] = th;
    }

    // ---- pelvis ----
    const sway = Math.sin(this.phase * Math.PI * 2), lead = Math.cos(this.phase * Math.PI * 2), fwd = dz >= -0.2 ? 1 : -1;
    const drop = (0.44 * c + 0.2 * sit) * this.legLen;
    let py = d.hipY - 0.001 * k - drop + run * 0.035 * k * Math.sin(this.phase * Math.PI * 4 + 2.45);
    const lean = 0.03 + 0.1 * run + 0.42 * c - 0.2 * sit + 0.02 * go;
    const px = -sway * 0.022 * k * go * (1 - run), pz = (0.02 + 0.1 * c - 0.14 * sit) * k;
    const yaw = lead * 0.07 * go * fwd * (1 + run), roll = -sway * 0.035 * go * (1 - c);
    // as high as both legs allow, a little short of straight (a soft minimum, so the two arcs meet without a corner)
    const max = this.legLen * 0.9985;
    let soft = 0, hard = Infinity;
    for (let i = 0; i < 2; i++) {
      const f = this.foot[i]!, s = i ? 1 : -1;
      const h2 = max * max - (f.x - (px + s * d.hipX)) ** 2 - (f.z - pz) ** 2;
      const top = f.y + Math.sqrt(Math.max(0.01, h2));
      hard = Math.min(hard, top); soft += Math.exp(-90 * (top - d.hipY));
    }
    py = Math.min(py, d.hipY - Math.log(soft) / 90 + Math.LN2 / 90, hard);
    if (sit) py = lerp(py, 0.2 * k, sit);
    this.pelvisY = py;
    const hips = bn.hips;
    hips.position.set(px, py, pz);
    hips.quaternion.setFromEuler(e1.set(lean * 0.45 - 0.5 * sit, yaw, roll, "YXZ"));

    // ---- legs: hip to ankle, knee forward ----
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, n = i ? "L" : "R", f = this.foot[i]!;
      const hip = v1.set(s * d.hipX, 0, 0).applyQuaternion(hips.quaternion).add(hips.position);
      const to = v2.copy(f).sub(hip);
      let len = to.length();
      const a = d.thigh, bl = d.shin;
      if (len > (a + bl) * 0.999) { len = (a + bl) * 0.999; to.setLength(len); }
      // the knee: off the hip-to-ankle line toward the pole, by the law of cosines
      const pole = v3.set(Math.sin(toeOut * s) + 0.25 * s * (c + sit), 0.15 * sit, Math.cos(toeOut * s)).normalize();
      const along = (a * a - bl * bl + len * len) / (2 * len), out = Math.sqrt(Math.max(0, a * a - along * along));
      const dir = v4.copy(to).divideScalar(len);
      const perp = pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      const kneeP = t1.copy(hip).addScaledVector(dir, along).addScaledVector(perp, out);
      const ankle = t2.copy(hip).add(to);
      const toe = t3.set(Math.sin(toeOut * s), 0, Math.cos(toeOut * s));
      limbTurn(q1, t4.copy(kneeP).sub(hip), toe);
      bn[`thigh${n}`].quaternion.copy(q2.copy(hips.quaternion).invert()).multiply(q1);
      limbTurn(q3, t4.copy(ankle).sub(kneeP), toe);
      bn[`shin${n}`].quaternion.copy(q1.invert()).multiply(q3);
      // the foot keeps its own pitch, whatever the shin does
      q2.setFromEuler(e1.set(pitch[i]!, toeOut * s, 0, "YXZ"));
      bn[`foot${n}`].quaternion.copy(q3.invert()).multiply(q2);
    }

    // ---- spine, arms, head ----
    const breathe = Math.sin(this.t * 1.5) * 0.008 * (1 - go);
    q1.setFromEuler(e1.set(lean * 0.3 + 0.12 * c + breathe, -yaw * 0.9, -roll * 0.8, "YXZ"));
    bn.spine.quaternion.copy(q1);
    q2.setFromEuler(e1.set(lean * 0.25 + 0.1 * c + 0.25 * sit, -yaw * 1.1 * (1 + 0.4 * run), -roll * 0.5, "YXZ"));
    bn.chest.quaternion.copy(q2);
    const tip = lean + 0.22 * c + 0.25 * sit;              // how far the chest leans forward, all told
    const swing = go * lerp(0.5, 0.9, run) * (1 - 0.5 * c) * Math.min(1, stride / (d.height * 0.8) + 0.3);
    for (let i = 0; i < 2; i++) {
      const s = i ? 1 : -1, n = i ? "L" : "R";
      const sw = s * Math.cos(this.phase * Math.PI * 2 - 0.3) * swing * fwd;     // against the leg on its own side
      const aiming = i === 0 ? this.aim : 0;
      // An arm hangs from a chest that leans, so it turns forward by that lean to hang straight down; then it swings,
      // further back than forward, the elbow folding as it comes forward. Aiming, the forearm points where the eyes look.
      const part = sw / (swing || 1);
      const ax = lerp(sw * (sw > 0 ? lerp(0.8, 0.6, run) : 1.1) + tip * 0.55 + 0.3 * sit, 0.57 + (mv.pitch ?? 0) + tip, aiming);
      const bend = lerp(0.2 + 0.3 * go * Math.max(0, part) + run * (1.35 + 0.35 * part) + 0.45 * c + 0.5 * sit, 1.0, aiming);
      const out = (0.09 + 0.05 * d.fat + 0.04 * d.mu + 0.06 * run + 0.05 * c) * s;
      bn[`arm${n}`].quaternion.setFromEuler(e1.set(-ax, 0, out, "ZXY"));
      bn[`fore${n}`].quaternion.setFromEuler(e1.set(-bend, 0.25 * s * (1 - aiming), 0, "YXZ"));
      bn[`hand${n}`].quaternion.setFromEuler(e1.set(-0.12, 0, -0.1 * s, "XYZ"));
    }
    // The head stays level and faces where the figure faces: it undoes what the pelvis and spine did, then looks.
    q3.copy(hips.quaternion).multiply(bn.spine.quaternion).multiply(bn.chest.quaternion);
    bn.neck.quaternion.copy(q3).invert().slerp(q1.identity(), 0.5);
    // where the head ends up: down the chain from the hips
    this.headAt.copy(bn.head.position).applyQuaternion(q1.copy(q3).multiply(bn.neck.quaternion));
    this.headAt.add(t1.copy(bn.neck.position).applyQuaternion(q3)).add(t1.copy(bn.chest.position).applyQuaternion(q2.copy(hips.quaternion).multiply(bn.spine.quaternion)));
    this.headAt.add(t1.copy(bn.spine.position).applyQuaternion(hips.quaternion)).add(hips.position);
    q3.multiply(bn.neck.quaternion).invert();
    bn.head.quaternion.copy(q3).multiply(q2.setFromEuler(e1.set(-(mv.pitch ?? 0) * 0.8 + 0.25 * c * (1 - sit), 0, 0)));
  }
}


// ---- from an eqosys avatar ---------------------------------------------------------------------------------------------

const AVATAR_BUILD: Record<string, BuildName> = { slim: "slender", round: "heavy", tall: "lanky", short: "stocky" };
const AVATAR_HAIR: Record<string, HairStyle> = {
  none: "bald", buzz: "short", short: "short", spiky: "short", mohawk: "short", pompadour: "short", "flat-top": "short", mullet: "short",
  afro: "curly", curly: "curly", locs: "curly", braids: "curly",
};
const AVATAR_HAT: Record<string, Hat> = { cap: "cap", beanie: "beanie", bucket: "bucket" };
const tint = (c: string, k: number, to = "#000000") => `#${new THREE.Color(c).lerp(new THREE.Color(to), k).getHexString()}`;

/**
 * A saved avatar (@rustybuns/util/avatar) as this body wears it: its build (and height slider), its skin, hair and its
 * colour, a hat the body has (a cap, a beanie or a bucket), and its top and trousers. A dress is a curvy build in a tee,
 * a suit or a lab coat a long-sleeved shirt in its colour. The face maker's parts wait for this body's faces (#5716).
 */
export function fromAvatar(a: Avatar): { build: Build; outfit: Outfit; palette: Palette } {
  const base = BUILDS[a.top === "dress" && a.build !== "round" ? "curvy" : AVATAR_BUILD[a.build] ?? "average"];
  const build: Build = { ...base, height: base.height * (1 + 0.025 * (a.height ?? 0)) };
  const top: Top = ["hoodie", "suit", "labcoat"].includes(a.top) ? "shirt" : "tee";
  const topColor = a.top === "suit" ? "#2e3439" : a.top === "labcoat" ? "#f4f5f5" : a.topColor;
  const bottom = a.top === "overalls" ? "#3a6bd8" : a.bottomColor;
  const outfit: Outfit = { top, hair: AVATAR_HAIR[a.hair] ?? "long", hat: AVATAR_HAT[a.hat] ?? "none" };
  const palette: Palette = {
    skin: a.skin, lips: tint(a.skin, 0.4, "#8a2f2f"), hair: a.hairColor, brow: tint(a.hairColor, 0.25),
    top: topColor, topDark: tint(topColor, 0.3), trim: tint(topColor, 0.45), bottom, bottomDark: tint(bottom, 0.25),
    boot: "#24272c", bootDark: "#17191c", sole: "#f1ede4", hat: tint(topColor, 0.15), hatDark: tint(topColor, 0.4),
  };
  return { build, outfit, palette };
}

// ---- sitting and playing ------------------------------------------------------------------------------------------------

/** How a body sits: its hip joints' height over the floor (shins straight down, thighs level), and the underside of its
 *  thighs (what rests on a seat), in metres. */
export function seatOf(h: Human): { hip: number; seat: number } {
  const k = h.height / 1.75, hip = h.bones.footR.position.length() + 0.09 * k;
  return { hip, seat: hip - 0.08 * k };
}

/** Sits a posed body (after `pose({ speed: 0 })`): thighs level, shins down, leaning in a little more when it plays. */
export function sit(h: Human, playing: boolean) {
  const bn = h.bones;
  bn.hips.position.set(0, seatOf(h).hip, 0);
  bn.hips.quaternion.identity();
  for (const [n, s] of [["R", -1], ["L", 1]] as const) {
    bn[`thigh${n}`].quaternion.setFromEuler(e1.set(-(Math.PI / 2 - 0.05), 0, s * 0.12));
    bn[`shin${n}`].quaternion.setFromEuler(e1.set(Math.PI / 2 - 0.05, 0, -s * 0.12));
    bn[`foot${n}`].quaternion.setFromEuler(e1.set(0, s * 0.15, 0));
  }
  bn.spine.quaternion.setFromEuler(e1.set(playing ? 0.08 : 0.02, 0, 0));
  bn.chest.quaternion.setFromEuler(e1.set(playing ? 0.06 : 0.02, 0, 0));
  bn.neck.quaternion.identity(); bn.head.quaternion.identity();
}

/**
 * An arm's pose while seated or playing, `s` 1 for the right arm and -1 the left, in the frame of an arm facing -z (the
 * old character's): the shoulder's swing forward (x) and out to its side (z), the elbow's and the wrist's bend.
 */
export function playArm(s: number, t: number, play: Play | null): { sx: number; sz: number; ex: number; wx: number } {
  if (play === "keys") {
    const tap = Math.max(0, Math.sin(t * 11 + (s > 0 ? 0 : 1.9)));
    return { sx: 0.75, sz: s * 0.12, ex: 1.75 - tap * 0.12, wx: -0.75 + tap * 0.25 };
  }
  if (play === "sticks") {
    const hit = Math.pow(Math.max(0, Math.sin(t * 9 + (s > 0 ? 0 : Math.PI))), 3);
    return { sx: 0.9 + (1 - hit) * 0.45, sz: s * 0.3, ex: 0.9 - hit * 0.6, wx: -0.4 + hit * 0.5 };
  }
  if (play === "strings") {
    if (s < 0) return { sx: 0.75, sz: -0.75, ex: 0.55 + Math.sin(t * 2) * 0.05, wx: -0.3 };
    const strum = Math.sin(t * 12);
    return { sx: 0.55, sz: -0.45, ex: 1.05 + strum * 0.18, wx: strum * 0.25 };
  }
  return { sx: 0.35, sz: s * 0.12, ex: 0.9, wx: 0 };
}

const HALF = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
/** Puts both of a body's arms in `playArm`'s pose (its own hands, no fingers: a preview, not the room). */
export function playArms(h: Human, t: number, play: Play | null) {
  for (const [s, n] of [[1, "R"], [-1, "L"]] as const) {
    const p = playArm(s, t, play);
    // the arm frame faces -z, the body +z: the same turn seen from behind is a half turn, the turn, and a half turn back
    for (const [bone, x, z] of [[h.bones[`arm${n}`], p.sx, p.sz], [h.bones[`fore${n}`], p.ex, 0], [h.bones[`hand${n}`], p.wx, 0]] as const)
      bone.quaternion.copy(HALF).multiply(q1.setFromEuler(e1.set(x, 0, z))).multiply(HALF);
  }
}

/** Whether the body has an avatar's hair or hat itself (true), or wears the nearest it has until it grows one. */
export function wearsAsIs(part: "hair" | "hat", v: string): boolean {
  if (v === "none") return true;
  return part === "hair" ? (AVATAR_HAIR[v] ?? "long") === v : AVATAR_HAT[v] === v;
}
