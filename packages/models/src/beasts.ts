// Folklore beasts from a parts list: a body plan (biped, quadruped, serpent, winged, swarm) plus the parts
// its legend gives it (horns, antlers, bat wings, a forked tail...), so a new creature is a line of data,
// not an art job. One unit tall, feet at y = 0, facing +x; the app scales it to the creature's height.
// Each wing is its own group called "wing", hinged at the shoulder, so the app can flap it; every other
// mesh is painted from four slots: hide, belly, horn and eye (eye glows). Same seed, same beast.
import * as THREE from "three";
import { mulberry32 } from "@rustybuns/util";
import { ball, part, type Palette, type Piece, R, loft } from "./shapes.ts";

export const PLANS = ["biped", "quadruped", "serpent", "winged", "swarm"] as const;
export type Plan = (typeof PLANS)[number];
export const PARTS = [
  "horns", "antlers", "ears", "snout", "spikes", "fins", "tail", "forked-tail", "hooves",
  "bat-wings", "feather-wings", "shaggy", "hunch", "headless",
] as const;
export type BeastPart = (typeof PARTS)[number];
export interface Look {
  plan: Plan;
  parts: BeastPart[];
  /** Stockiness: 0.8 lean, 1 the plan as drawn, 1.3 heavy-set. */
  build: number;
  /** Leg length on four legs: 0.5 a hare's crouch, 1 a big cat's stride. */
  legs?: number;
  colors: { hide: string; belly: string; horn: string; eye: string };
}

type V = THREE.Vector3Tuple;
const v3 = (p: V) => new THREE.Vector3(...p);

/** A tapered limb from `a` to `b`: a loft along y turned onto the segment. */
function rod(slot: string, a: V, b: V, r0: number, r1: number, { seg = 6, jag = 0 } = {}): Piece {
  const from = v3(a), dir = v3(b).sub(from), len = dir.length();
  const m = new THREE.Matrix4().compose(from, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()), new THREE.Vector3(1, 1, 1));
  return loft(slot, [R(0, r0, r0, { jag }), R(len, r1, r1, { jag })], { seg, m });
}
/** A cone from a base at `a` to a point at `b`. */
const spike = (slot: string, a: V, b: V, r: number) => rod(slot, a, b, r, 0.0001, { seg: 5 });

/** Where a plan put the head, the back and the tail root, so parts know where to go. */
interface Frame { head: V; headR: number; face: number; back: [V, V]; rear: V; shoulders: V; wingSpan: number }

function biped(p: Piece[], k: number, has: (x: BeastPart) => boolean, jag: number): Frame {
  const hunch = has("hunch") ? 0.08 : 0;
  const hipY = 0.46, chest: V = [hunch, 0.7, 0], w = 0.13 * k;
  for (const s of [-1, 1]) {
    p.push(rod("hide", [0, hipY, s * w * 0.8], [0.03, 0.24, s * w * 0.85], w * 0.55, w * 0.42, { jag }));
    p.push(rod("hide", [0.03, 0.24, s * w * 0.85], [0, 0.03, s * w * 0.85], w * 0.42, w * 0.32, { jag }));
    p.push(ball(has("hooves") ? "horn" : "belly", w * 0.42, [0.05, 0.03, s * w * 0.85], { scale: [1.5, 0.6, 1] }));
    // arms hang long when it stoops
    p.push(rod("hide", [chest[0], 0.8, s * w * 1.6], [chest[0] + 0.06, 0.55, s * w * 1.9], w * 0.42, w * 0.32, { jag }));
    p.push(rod("hide", [chest[0] + 0.06, 0.55, s * w * 1.9], [chest[0] + 0.1, 0.33 - hunch, s * w * 1.8], w * 0.32, w * 0.24, { jag }));
  }
  p.push(loft("hide", [R(hipY - 0.04, w * 1.3, w), R(0.62, w * 1.45, w * 1.1, { cx: hunch * 0.5, jag }), R(0.82, w * 1.7, w * 1.2, { cx: hunch, jag }), R(0.88, w * 0.8, w * 0.7, { cx: hunch * 1.2 })], { seg: 8 }));
  p.push(ball("belly", w * 1.05, [hunch * 0.5 + w * 0.5, 0.62, 0], { scale: [0.5, 1.4, 1.1] }));
  const head: V = [hunch * 1.6 + 0.02, 0.92 - hunch * 0.5, 0];
  return { head, headR: 0.085 * k, face: 1, back: [[hunch * 0.4 - w * 0.6, 0.6, 0], [hunch - w * 0.7, 0.86, 0]], rear: [-w * 0.6, hipY, 0], shoulders: [chest[0] - 0.02, 0.8, 0], wingSpan: 0.9 };
}

function quadruped(p: Piece[], k: number, has: (x: BeastPart) => boolean, jag: number, legs: number): Frame {
  const y = 0.2 + 0.35 * legs, len = 0.42, w = 0.17 * k, leg = y - w * 0.4;
  p.push(ball("hide", 1, [0, y, 0], { scale: [len, w, w * 0.9], seg: 10, rings: 6, jag }));
  p.push(ball("belly", 1, [0, y - w * 0.35, 0], { scale: [len * 0.8, w * 0.7, w * 0.75] }));
  for (const fx of [-1, 1]) for (const s of [-1, 1]) {
    const x = fx * len * 0.62, z = s * w * 0.62;
    p.push(rod("hide", [x, y, z], [x + 0.02, y * 0.45, z], w * 0.42, w * 0.3, { jag }));
    p.push(rod("hide", [x + 0.02, y * 0.45, z], [x, 0.03, z], w * 0.3, w * 0.22));
    p.push(ball(has("hooves") ? "horn" : "hide", w * 0.26, [x + 0.02, 0.03, z], { scale: [1.3, 0.6, 1] }));
  }
  // neck up and forward
  const head: V = [len + 0.18, y + 0.24, 0];
  p.push(rod("hide", [len * 0.75, y + 0.05, 0], [head[0] - 0.04, head[1], 0], w * 0.7, w * 0.5, { jag }));
  return { head, headR: 0.11 * k, face: 1, back: [[-len * 0.7, y + w * 0.85, 0], [len * 0.6, y + w * 0.9, 0]], rear: [-len, y + 0.04, 0], shoulders: [len * 0.4, y + w, 0], wingSpan: 0.8 };
}

function serpent(p: Piece[], k: number): Frame {
  // Humps out of the ground behind, then a long neck rising to the head: the lake-serpent outline.
  const r = 0.09 * k, pts: V[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14, x = -0.9 + t * 1.2, hump = Math.max(0, Math.sin(t * Math.PI * 3)) * 0.22;
    pts.push([x, r * 0.7 + hump, Math.sin(t * 5) * 0.12]);
  }
  pts.push([0.42, 0.5, 0], [0.5, 0.75, 0], [0.55, 0.88, 0]);
  for (let i = 0; i + 1 < pts.length; i++) {
    const t0 = i / (pts.length - 1), t1 = (i + 1) / (pts.length - 1);
    const ra = r * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(0.85, 0.15 + t0))), rb = r * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(0.85, 0.15 + t1)));
    p.push(rod("hide", pts[i], pts[i + 1], ra, rb, { seg: 7 }), ball("hide", ra, pts[i], { seg: 7, rings: 4 }));
  }
  const head: V = [0.62, 0.92, 0];
  return { head, headR: 0.08 * k, face: 1, back: [pts[2], pts[12]], rear: pts[0], shoulders: [0.4, 0.5, 0], wingSpan: 0.8 };
}

function winged(p: Piece[], k: number, has: (x: BeastPart) => boolean, jag: number): Frame {
  // A light body on two legs, leaning forward, made to be carried by its wings.
  const w = 0.11 * k;
  for (const s of [-1, 1]) {
    p.push(rod("hide", [-0.02, 0.42, s * w * 0.7], [0.05, 0.22, s * w * 0.8], w * 0.45, w * 0.32));
    p.push(rod("hide", [0.05, 0.22, s * w * 0.8], [-0.02, 0.03, s * w * 0.8], w * 0.32, w * 0.24));
    p.push(ball(has("hooves") ? "horn" : "hide", w * 0.36, [0.02, 0.03, s * w * 0.8], { scale: [1.4, 0.6, 1] }));
  }
  p.push(loft("hide", [R(0.38, w * 1.1, w * 0.9), R(0.6, w * 1.35, w * 1.05, { cx: 0.04, jag }), R(0.8, w * 1.2, w, { cx: 0.08, jag }), R(0.84, w * 0.6, w * 0.5, { cx: 0.09 })], { seg: 8 }));
  p.push(ball("belly", w, [0.08, 0.6, 0], { scale: [0.5, 1.5, 1] }));
  return { head: [0.12, 0.92, 0], headR: 0.08 * k, face: 1, back: [[-0.04, 0.5, 0], [0.0, 0.78, 0]], rear: [-0.06, 0.42, 0], shoulders: [0.02, 0.76, 0], wingSpan: 1.1 };
}

/** A head with its parts: a snout or a round face, eyes, and horns, antlers or ears on top. */
function head(p: Piece[], f: Frame, has: (x: BeastPart) => boolean, jag: number) {
  const [x, y] = f.head, r = f.headR;
  if (has("headless")) {
    // eyes set in the chest
    for (const s of [-1, 1]) p.push(ball("eye", r * 0.45, [f.shoulders[0] + r * 1.1, f.shoulders[1] - r * 0.4, s * r * 0.8], { scale: [0.6, 1, 1] }));
    return;
  }
  p.push(ball("hide", r, [x, y, 0], { scale: [1.1, 1, 0.95], jag }));
  const muzzle = has("snout") ? r * 1.25 : r * 0.35;
  if (has("snout")) p.push(rod("hide", [x + r * 0.5, y - r * 0.15, 0], [x + r * 0.5 + muzzle, y - r * 0.35, 0], r * 0.62, r * 0.4, { seg: 6 }));
  for (const s of [-1, 1]) {
    p.push(ball("eye", r * 0.2, [x + r * 0.78, y + r * 0.25, s * r * 0.48]));
    if (has("horns")) p.push(spike("horn", [x - r * 0.1, y + r * 0.7, s * r * 0.5], [x - r * 0.9, y + r * 1.9, s * r * 1.2], r * 0.22));
    if (has("ears")) p.push(spike("hide", [x - r * 0.35, y + r * 0.75, s * r * 0.45], [x - r * 0.6, y + r * (has("antlers") ? 1.9 : 1.6), s * r * 0.7], r * 0.24));
    if (has("antlers")) {
      const base: V = [x - r * 0.1, y + r * 0.8, s * r * 0.3], top: V = [x - r * 0.4, y + r * 2.4, s * r * 1.2];
      p.push(rod("horn", base, top, r * 0.1, r * 0.06, { seg: 4 }));
      for (const t of [0.4, 0.7]) {
        const at: V = [base[0] + (top[0] - base[0]) * t, base[1] + (top[1] - base[1]) * t, base[2] + (top[2] - base[2]) * t];
        p.push(rod("horn", at, [at[0] + r * 0.45, at[1] + r * 0.5, at[2]], r * 0.06, r * 0.04, { seg: 4 }));
      }
    }
  }
}

/** One wing hinged at the origin, reaching out along +z (`side` flips it): a bat's ribbed membrane or a feathered fan. */
function wing(look: Look, span: number, side: number, palette: Palette): THREE.Group {
  const p: Piece[] = [], z = (n: number) => n * side;
  const feathered = look.parts.includes("feather-wings");
  const fingers = feathered ? 6 : 4;
  for (let i = 0; i < fingers; i++) {
    const t = i / (fingers - 1), a = 0.25 + t * 1.1;
    const tip: V = [-Math.sin(a) * span * (feathered ? 0.55 : 0.6), Math.cos(a) * span * 0.25, z(span * (1 - t * 0.35))];
    p.push(rod(feathered ? "belly" : "horn", [0, 0, 0], tip, 0.018, 0.006, { seg: 4 }));
    if (i > 0 || feathered) {
      const prev = i === 0 ? [0, 0.02, z(span * 0.2)] as V : [-Math.sin(a - 1.1 / (fingers - 1)) * span * (feathered ? 0.55 : 0.6), Math.cos(a - 1.1 / (fingers - 1)) * span * 0.25, z(span * (1 - (t - 1 / (fingers - 1)) * 0.35))] as V;
      // a thin two-sided sheet between this finger and the last
      for (const flip of [0, 1]) {
        const g = new THREE.BufferGeometry(), tri = flip ? [0, 0, 0, ...tip, ...prev] : [0, 0, 0, ...prev, ...tip];
        g.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3)); g.computeVertexNormals();
        p.push({ geo: g, slot: "hide" });
      }
    }
  }
  return part("wing", p, palette);
}

const PALETTE = (c: Look["colors"]): Palette => ({ hide: [c.hide, 0.8, 0], belly: [c.belly, 0.85, 0], horn: [c.horn, 0.5, 0.05], eye: [c.eye, 0.3, 0, 1.2] });

/** The beast a look describes, built from `seed`. */
export function beast(look: Look, seed: number): THREE.Group {
  const rand = mulberry32(seed), has = (x: BeastPart) => look.parts.includes(x), k = look.build;
  const jag = has("shaggy") ? 0.18 : 0, palette = PALETTE(look.colors), g = new THREE.Group();
  g.name = "beast";
  if (look.plan === "swarm") {
    // a cloud of small winged bodies around head height
    for (let i = 0; i < 9; i++) {
      const p: Piece[] = [], at: V = [(rand() - 0.5) * 0.7, 0.35 + rand() * 0.6, (rand() - 0.5) * 0.7], r = 0.05 * k * (0.7 + rand() * 0.6);
      p.push(ball("hide", r, at, { scale: [1.4, 1, 1] }), ball("eye", r * 0.3, [at[0] + r * 1.1, at[1] + r * 0.3, at[2]]));
      if (has("horns")) p.push(spike("horn", [at[0], at[1] + r * 0.8, at[2]], [at[0] - r, at[1] + r * 2, at[2]], r * 0.3));
      g.add(part(`body${i}`, p, palette));
      for (const s of [-1, 1]) { const w = wing(look, r * 3, s, palette); w.position.set(...at); g.add(w); }
    }
    return g;
  }
  const p: Piece[] = [];
  const f = look.plan === "biped" ? biped(p, k, has, jag) : look.plan === "quadruped" ? quadruped(p, k, has, jag, look.legs ?? 1)
    : look.plan === "serpent" ? serpent(p, k) : winged(p, k, has, jag);
  head(p, f, has, jag);
  // spines or fins down the back
  const [b0, b1] = f.back;
  const along = (t: number): V => [b0[0] + (b1[0] - b0[0]) * t, b0[1] + (b1[1] - b0[1]) * t, b0[2] + (b1[2] - b0[2]) * t];
  if (has("spikes")) for (let i = 0, n = 5 + Math.floor(rand() * 3); i < n; i++) {
    const at = along(i / (n - 1)), h = 0.08 + 0.06 * Math.sin((i / (n - 1)) * Math.PI);
    p.push(spike("horn", at, [at[0] - 0.03, at[1] + h, at[2]], 0.035));
  }
  if (has("fins")) for (let i = 0; i < 4; i++) {
    const at = along(0.15 + i * 0.25);
    p.push(spike("belly", at, [at[0] - 0.06, at[1] + 0.09, at[2]], 0.05));
  }
  if (has("tail") || has("forked-tail")) {
    const [x, y, z] = f.rear, end: V = [x - 0.45, y - 0.12, z + (rand() - 0.5) * 0.1];
    p.push(rod("hide", [x, y, z], [x - 0.22, y + 0.02, z], 0.05 * k, 0.03 * k, { jag }), rod("hide", [x - 0.22, y + 0.02, z], end, 0.03 * k, 0.012 * k, { jag }));
    if (has("forked-tail")) for (const s of [-1, 1]) p.push(spike("horn", end, [end[0] - 0.08, end[1] - 0.02, end[2] + s * 0.06], 0.02));
    else if (has("spikes")) p.push(spike("horn", end, [end[0] - 0.1, end[1], end[2]], 0.03));
  }
  g.add(part("body", p, palette));
  if (has("bat-wings") || has("feather-wings")) for (const s of [-1, 1]) {
    const w = wing(look, f.wingSpan * (look.plan === "winged" ? 1 : 0.6), s, palette);
    w.position.set(f.shoulders[0] - 0.04, f.shoulders[1], s * 0.08 * k);
    g.add(w);
  }
  return g;
}
