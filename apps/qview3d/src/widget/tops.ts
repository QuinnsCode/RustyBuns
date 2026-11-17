// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// The tops, made in code like the hats: a tee, a sweater, a hoodie and two tanks, each a cut of one body form, laid
// out as on a shop's invisible mannequin (front to +z, arms out and down). Fabric, not shells: the cloth folds where
// it hangs free (at the hem, the sides, under the arms, down a long sleeve), sleeves grow out of a real armhole, and
// the edges are finished (rib knit cuffs, hems and collars, a rolled hem with its stitch line, bound tank edges).
// Inside faces are drawn too, a shade darker, so a neckline or an armhole shows the cloth's inside, not a hole.
//
// The print meshes share one canvas through a UV atlas: the body's front half takes u 0..0.4, its back half
// 0.4..0.8, the left sleeve 0.8..0.9 and the right 0.9..1. Inside each, u runs across by arc length and v up by
// height, so a picture keeps its shape on the cloth, and it reads the right way round from the side it is printed
// on. The print zones are rects inside those strips; the folds there are damped to a shade, so a picture stays flat.
import * as THREE from "three";
import { clamp01, lerp } from "@rustybuns/util";
import type { Garment } from "./hats.ts";
import { hang, hangerModel, type ClothPart } from "./hanger.ts";
import type { PrintZone, Side, Zone } from "./print.ts";
import type { TopModel, ZoneName } from "../api.ts";

type V3 = THREE.Vector3;
type Fabric = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const TAU = Math.PI * 2;

type Neck = { w: number; dip: number };
/** One cut of the body form. Lengths are in the viewer's units (about 45 cm each). */
export type Cut = {
  height: number;
  /** Width over the form (1 is skin tight), and 0 for a straight cut or 1 for one shaped in at the waist. */
  ease: number;
  waist: number;
  /** How far the shoulders slope from the neck to the tip, the neckline's half-width and dip, front and back, and its half-depth. */
  slope: number;
  neck: { front: Neck; back: Neck };
  nd: number;
  sleeve?: { angle: number; length: number; r0: number; r1: number; cuff: number };
  /** A tank's straps: their outer edge, front and back, and the armhole's bottom (0 hem .. 1 shoulder). */
  straps?: { front: number; back: number; underarm: number };
  /** Rib heights: the waistband (0 is a rolled, stitched hem) and the collar (0 none). */
  hem: number;
  collar: number;
  folds: number;
  cloth: "jersey" | "knit" | "fleece";
  hood?: boolean;
  zones: { front: Zone; back: Zone; sleeve?: Zone };
};

// ---- the body form and its cuts ------------------------------------------------------------------------------

/** The section's squareness: a soft box, as a torso is, not a tube. */
const N = 3.2;
const ROWS = 96, COLS = 56;
/** Row j's share of its column's height: as fine as 64 even rows at the hem, and finer toward the top, where the half closes over the shoulder and its outline would step. */
const rowAt = (j: number) => 1 - (1 - j / ROWS) ** 1.5;

const halfW = (c: Cut, t: number) =>
  (0.47 + 0.05 * smooth(0.35, 0.85, t)) * c.ease * (1 - c.waist * 0.12 * Math.exp(-(((t - 0.5) / 0.2) ** 2)) + c.waist * 0.05 * (1 - t) ** 3);
const halfD = (c: Cut, t: number) => (0.2 - 0.025 * t) * (0.9 + 0.1 * c.ease) * (1 - c.waist * 0.07 * Math.exp(-(((t - 0.5) / 0.2) ** 2)));

/** A point round a superellipse section, th 0 the front centre and +-pi/2 the sides; z >= 0 for |th| <= pi/2. */
const se = (w: number, d: number, th: number) => {
  const s = Math.sin(th), k = Math.cos(th);
  return { x: w * Math.sign(s) * Math.abs(s) ** (2 / N), z: d * Math.sign(k) * Math.abs(k) ** (2 / N) };
};

/**
 * The top edge of a half at x: the shoulder line sloping from the neck, the neckline cut into it, a tank's armholes cut
 * deeper. A sleeve's top runs out level from the shoulder tip, so on a sleeved cut the shoulder rolls level there too
 * (a smoothstep, steepest mid-shoulder); one still sloping at the tip met the sleeve in a notch (#4642).
 */
function topOf(c: Cut, back: boolean, x: number) {
  const n = back ? c.neck.back : c.neck.front, a = halfW(c, 1), ax = Math.abs(x), n0 = 0.6 * c.neck.front.w;
  const drop = (q: number) => (c.sleeve ? smooth(0, 1, q) : Math.max(0, q) ** 1.3);
  const shoulder = (q: number) => c.height - c.slope * drop((q - n0) / (a - n0));
  let y = shoulder(ax);
  if (ax < n.w) y -= n.dip * Math.sqrt(1 - (ax / n.w) ** 2);
  const so = c.straps && (back ? c.straps.back : c.straps.front);
  if (c.straps && so !== undefined && ax > so) {
    const q = clamp01((ax - so) / (a - so)), yu = c.straps.underarm * c.height;
    y = yu + (shoulder(so) - yu) * (1 - Math.sqrt(1 - (1 - q) ** 2));
  }
  return y;
}

const neckZ = (c: Cut, back: boolean, x: number) => {
  const n = back ? c.neck.back : c.neck.front;
  return Math.abs(x) < n.w ? c.nd * Math.sqrt(1 - (x / n.w) ** 2) : 0;
};

/** How much the half closes up over the shoulder at x (1 on a shoulder or strap, 0 across a tank's armhole). */
const closes = (c: Cut, back: boolean, x: number) => (c.straps ? 1 - smooth(0, 0.05, Math.abs(x) - (back ? c.straps.back : c.straps.front)) : 1);

// Smooth value noise, for folds that don't repeat.
const hash = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
function noise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = lerp(hash(xi, yi), hash(xi + 1, yi), u), b = lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u);
  return lerp(a, b, v) * 2 - 1;
}

/** 1 outside a zone, `floor` inside it, soft at its edge: folds only shade a print. */
const damp = (z: Zone | undefined, u: number, v: number, floor = 0.15) => {
  if (!z) return 1;
  const e = 0.06, inside = smooth(z.u0 - e, z.u0 + e, u) * (1 - smooth(z.u1 - e, z.u1 + e, u)) * smooth(z.v0 - e, z.v0 + e, v) * (1 - smooth(z.v1 - e, z.v1 + e, v));
  return 1 - (1 - floor) * inside;
};

/** How far the body's cloth stands out (or sinks in) from the form at (u across the half, t up), along its normal. */
function bodyFold(c: Cut, back: boolean, u: number, t: number) {
  const side = Math.abs(u * 2 - 1), seed = back ? 7.3 : 1.1, A = c.folds;
  let d = 0;
  // Where the cloth hangs free at the hem: a few soft vertical waves.
  const hem = Math.max(0, 1 - t / (c.hem ? 0.2 : 0.34)) ** 2;
  d += 0.016 * hem * Math.sin(TAU * (u * 4.2 + 0.4 * noise(u * 3 + seed, t * 2)));
  // Down the sides: long folds.
  d += 0.01 * smooth(0.62, 1, side) * Math.sin(TAU * (u * 10 + 0.6 * noise(u * 4, t * 3 + seed))) * smooth(0, 0.25, t) * (1 - smooth(0.6, 0.8, t));
  // Under the arms: drag lines running in toward the chest.
  if (c.sleeve) d += 0.011 * Math.exp(-(((t - 0.7) / 0.08) ** 2)) * smooth(0.55, 0.95, side) * Math.sin(TAU * (side * 7 - t * 8 + seed));
  // A shaped waist gathers a little at the sides.
  d += c.waist * 0.004 * Math.exp(-(((t - 0.5) / 0.12) ** 2)) * smooth(0.5, 1, side) * Math.sin(TAU * t * 14);
  // Above a rib waistband the body blouses: fine gathers.
  if (c.hem) d += 0.01 * Math.max(0, 1 - t / 0.12) ** 1.5 * (0.6 + 0.4 * Math.sin(TAU * u * 17 + noise(u * 6, seed) * 2));
  // And all over, a little unevenness.
  d += 0.004 * noise(u * 7 + seed, t * 6);
  return d * A * damp(back ? c.zones.back : c.zones.front, u, t) * (1 - smooth(0.88, 0.98, t));
}

/**
 * A point on one half (front: z > 0, or back) at th (-pi/2 the wearer's right side on the front, their left on the
 * back) and height y. Near the top the half closes over the shoulder to meet the other half (the shoulder seam),
 * except round the neck, which stays an oval, and across a tank's armhole, which stays open.
 */
function bodyPoint(c: Cut, back: boolean, th: number, y: number): V3 {
  const t = y / c.height, w = halfW(c, t), d = halfD(c, t);
  let { x, z } = se(w, d, th);
  const xTop = se(halfW(c, 1), 1, th).x, top = topOf(c, back, xTop);
  const s = smooth(top - 0.28, top, y) * closes(c, back, xTop);
  z = lerp(z, neckZ(c, back, xTop), s);
  const gx = Math.sign(x) * Math.abs(x / w) ** (N - 1) / w, gz = Math.abs(z / d) ** (N - 1) / d, gl = Math.hypot(gx, gz) || 1;
  // Folds fade out as the half closes, so front and back meet edge to edge along the shoulder seam (each half's own
  // fold noise there left the seam a zigzag in the outline).
  const f = bodyFold(c, back, th / Math.PI + 0.5, t) * (1 - smooth(top - 0.2, top - 0.02, y));
  x += (gx / gl) * f;
  z += (gz / gl) * f;
  return back ? V(-x, y, -z) : V(x, y, z);
}

/** The columns' angles, spaced by arc length round the section, so the front's middle is as fine as its sides. */
function columns(c: Cut) {
  const n = 400, pts = Array.from({ length: n + 1 }, (_, i) => se(halfW(c, 0.6), halfD(c, 0.6), -Math.PI / 2 + (i / n) * Math.PI));
  const run = [0];
  for (let i = 1; i <= n; i++) run.push(run[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z));
  const total = run[n]!;
  return Array.from({ length: COLS + 1 }, (_, i) => {
    const want = (i / COLS) * total;
    let k = 0;
    while (k < n - 1 && run[k + 1]! < want) k++;
    const f = (want - run[k]!) / (run[k + 1]! - run[k]! || 1);
    return -Math.PI / 2 + ((k + f) / n) * Math.PI;
  });
}

/**
 * A half's u by arc length round its level section at each height: `u(i, y)` for column i, and `width(t)` the whole
 * section's length, which is what a print zone there spans. Measured level, not along a grid row: a tank's rows
 * climb toward its armholes, and u along them stretched a picture across its middle and squeezed it at the sides.
 */
function sections(c: Cut, back: boolean, ths: number[]) {
  const K = 160, SUB = 4;
  const levels = Array.from({ length: K + 1 }, (_, k) => {
    const y = (k / K) * c.height, run = [0];
    let prev = bodyPoint(c, back, ths[0]!, y);
    for (let i = 1; i <= COLS; i++) {
      let len = run[i - 1]!;
      for (let s = 1; s <= SUB; s++) { const p = bodyPoint(c, back, lerp(ths[i - 1]!, ths[i]!, s / SUB), y); len += p.distanceTo(prev); prev = p; }
      run.push(len);
    }
    return run;
  });
  const at = (y: number, f: (run: number[]) => number) => {
    const q = clamp01(y / c.height) * K, k = Math.min(K - 1, Math.floor(q));
    return lerp(f(levels[k]!), f(levels[k + 1]!), q - k);
  };
  return { u: (i: number, y: number) => at(y, (run) => run[i]! / run[COLS]!), width: (t: number) => at(t * c.height, (run) => run[COLS]!) };
}

// ---- building meshes -----------------------------------------------------------------------------------------

/** A grid mesh from rows of points (each the same length): uv by arc length across and the row's own v, uv1 in world units. */
function gridGeo(rows: V3[][], uv?: (i: number, j: number, across: number, run: number) => [number, number]) {
  const pos: number[] = [], uvs: number[] = [], uv1: number[] = [], idx: number[] = [];
  const cols = rows[0]!.length - 1;
  rows.forEach((row, j) => {
    const run = [0];
    for (let i = 1; i <= cols; i++) run.push(run[i - 1]! + row[i]!.distanceTo(row[i - 1]!));
    row.forEach((p, i) => {
      pos.push(p.x, p.y, p.z);
      const [u, v] = uv ? uv(i, j, run[cols]!, run[i]!) : [i / cols, j / (rows.length - 1)];
      uvs.push(u, v);
      uv1.push(run[i]!, j ? p.distanceTo(rows[j - 1]![i]!) + uv1[(((j - 1) * (cols + 1)) + i) * 2 + 1]! : 0);
    });
  });
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute("uv1", new THREE.Float32BufferAttribute(uv1, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A small tileable canvas texture. */
function tile(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Rib knit: soft ridges running along the band (u across them in world units). */
const ribTexture = () => tile(16, 4, (g) => {
  for (let x = 0; x < 16; x++) { const l = Math.round(255 * (0.8 + 0.2 * (0.5 + 0.5 * Math.cos((x / 16) * TAU)))); g.fillStyle = `rgb(${l},${l},${l})`; g.fillRect(x, 0, 1, 4); }
});
/** A seam: a soft groove where the panels meet, with a row of thread dashes either side (a cover stitch).
 * Blended, not alpha-tested, so it fades into a tonal line at a distance instead of stair-stepping. */
const stitchTexture = () => tile(32, 16, (g) => {
  for (let y = 4; y < 12; y++) { g.fillStyle = `rgba(30,30,30,${(0.5 * Math.sin(((y - 3.5) / 8) * Math.PI)).toFixed(2)})`; g.fillRect(0, y, 32, 1); }
  for (const y of [2, 12]) {
    g.fillStyle = "rgba(90,90,90,0.9)";
    g.fillRect(5, y, 20, 2);
    g.fillStyle = "rgba(90,90,90,0.45)";
    g.fillRect(4, y, 1, 2);
    g.fillRect(25, y, 1, 2);
  }
});
/** Knitted jersey for a sweater: rows of little Vs, as a bump. */
const knitTexture = () => tile(16, 16, (g) => {
  g.fillStyle = "#808080";
  g.fillRect(0, 0, 16, 16);
  g.strokeStyle = "#e0e0e0";
  g.lineWidth = 3;
  for (const ox of [0, 8]) { g.beginPath(); g.moveTo(ox + 1, 2); g.lineTo(ox + 4, 14); g.moveTo(ox + 7, 2); g.lineTo(ox + 4, 14); g.stroke(); }
}, false);

type Kit = { print: THREE.MeshPhysicalMaterial; inside: THREE.MeshStandardMaterial; plain: () => THREE.MeshPhysicalMaterial; rib: THREE.MeshPhysicalMaterial; stitch: THREE.MeshStandardMaterial };

function kit(c: Cut): Kit {
  const look = { roughness: c.cloth === "fleece" ? 1 : 0.88, metalness: 0, sheen: 1, sheenRoughness: c.cloth === "fleece" ? 0.9 : 0.6, sheenColor: new THREE.Color("#3a3a3a") };
  const print = new THREE.MeshPhysicalMaterial({ ...look, side: THREE.FrontSide });
  if (c.cloth === "knit") {
    const k = knitTexture();
    k.channel = 1;
    k.repeat.set(1 / 0.022, 1 / 0.028);
    print.bumpMap = k;
    print.bumpScale = 0.6;
  }
  const ribMap = ribTexture();
  ribMap.repeat.set(1 / 0.016, 1);
  const rib = new THREE.MeshPhysicalMaterial({ ...look, side: THREE.DoubleSide, map: ribMap, bumpMap: ribMap, bumpScale: 1.2 });
  const shade = tile(1, 1, (g) => { g.fillStyle = "#8a8a8a"; g.fillRect(0, 0, 1, 1); });
  const inside = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.BackSide, map: shade });
  const sm = stitchTexture();
  sm.repeat.set(1 / 0.016, 1);
  const stitch = new THREE.MeshStandardMaterial({ roughness: 1, map: sm, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  return { print, inside, rib, stitch, plain: () => new THREE.MeshPhysicalMaterial({ ...look, side: THREE.DoubleSide }) };
}

/** A stitch line along `pts`, lifted off the cloth along `normals`: a thin ribbon of dashes. */
function stitchGeo(pts: V3[], normals: V3[], width = 0.012) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let run = 0;
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const tan = b.clone().sub(a).normalize(), n = normals[i]!, side = V().crossVectors(tan, n).normalize().multiplyScalar(width / 2);
    if (i) run += p.distanceTo(pts[i - 1]!);
    const q = p.clone().addScaledVector(n, 0.003);
    pos.push(q.x - side.x, q.y - side.y, q.z - side.z, q.x + side.x, q.y + side.y, q.z + side.z);
    uv.push(run, 0, run, 1);
    if (i) { const k = i * 2; idx.push(k - 2, k, k + 1, k - 2, k + 1, k - 1); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A tube along a curve, its section `rx` across by `ry` (in the curve's normal plane, ry along `up`), each scaled by `size(i)`. */
function tubeGeo(pts: V3[], rx: number, ry: number, up: (i: number) => V3, round = 10) {
  const rows: V3[][] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!;
    const tan = b.clone().sub(a).normalize(), u = up(i).clone().addScaledVector(tan, -up(i).dot(tan)).normalize(), s = V().crossVectors(tan, u);
    rows.push(Array.from({ length: round + 1 }, (_, k) => { const a2 = (k / round) * TAU; return p.clone().addScaledVector(s, Math.cos(a2) * rx).addScaledVector(u, Math.sin(a2) * ry); }));
  });
  return gridGeo(rows);
}

// A closed loop's frame at point i: the tangent (over a few points either side, so a flat band turns round a tight bend
// without twisting), `up` (world up, square to it) and `out` (across, away from the loop's middle).
function loopFrame(pts: V3[], i: number, reach = 4) {
  const n = pts.length, tan = pts[(i + reach) % n]!.clone().sub(pts[(i - reach + n) % n]!).normalize();
  const up = V(0, 1, 0).addScaledVector(tan, -tan.y).normalize();
  return { up, out: V().crossVectors(tan, up) };
}

// A hood's opening edge as fleece makes it: a flat band, two layers folded over at the opening, with the drawcord's
// channel a slight ridge just behind the fold, thinning and sloping down to where it is sewn to the shell. `pts` is the
// loop of the band's middle; `w(i)` (about -1..1) widens and flattens it where it bunches, `lift(i)` ripples it.
const BAND = { fold: -0.024, edge: 0.03, r: 0.011, drop: 0.01 };
function bandAt(t: number, top: boolean, w = 0) {
  const { fold, edge, r, drop } = BAND, s = lerp(fold + r, edge * (1 + 0.15 * w), t), fall = -drop * t ** 1.5;
  const half = r * (1 - 0.3 * w);
  // Lofty fleece: both faces bulge, thinning late toward the seam, so the band never comes to a wire-thin edge.
  const face = half * (1 - 0.55 * t ** 1.6);
  return top ? [s, face + 0.005 * Math.exp(-(((t - 0.22) / 0.11) ** 2)) + fall] : [s, -face + fall];
}
function bandGeo(pts: V3[], w: (i: number) => number, lift: (i: number) => number) {
  const T = 10, F = 8;
  const rows = pts.map((p, i) => {
    const { up, out } = loopFrame(pts, i), wi = w(i), half = BAND.r * (1 - 0.3 * wi);
    // Round the loop's section: along the underside to the fold, round it, and out along the top.
    const prof = [
      ...Array.from({ length: T }, (_, k) => bandAt(1 - k / T, false, wi)),
      ...Array.from({ length: F + 1 }, (_, k) => { const a = -Math.PI / 2 - (k / F) * Math.PI; return [BAND.fold + BAND.r + half * Math.cos(a), half * Math.sin(a)]; }),
      ...Array.from({ length: T }, (_, k) => bandAt((k + 1) / T, true, wi)),
    ];
    prof.push(prof[0]!);
    return prof.map(([s, u]) => p.clone().addScaledVector(out, s!).addScaledVector(up, u! + lift(i)));
  });
  rows.push(rows[0]!.map((p) => p.clone()));
  return gridGeo(rows);
}
// A line along the band's top at `t` (0 the fold, 1 its sewn edge) and its normals: for the band's topstitching.
function bandLine(pts: V3[], t: number, w: (i: number) => number, lift: (i: number) => number): [V3[], V3[]] {
  const frames = pts.map((_, i) => loopFrame(pts, i));
  const line = pts.map((p, i) => { const [s, u] = bandAt(t, true, w(i)); return p.clone().addScaledVector(frames[i]!.out, s!).addScaledVector(frames[i]!.up, u! + lift(i)); });
  line.push(line[0]!.clone());
  return [line, [...frames.map((f) => f.up), frames[0]!.up]];
}

// ---- the parts -----------------------------------------------------------------------------------------------

const FRONT: [number, number] = [0, 0.4], BACK: [number, number] = [0.4, 0.8], LEFT: [number, number] = [0.8, 0.9], RIGHT: [number, number] = [0.9, 1];

/** One half's grid: rows climb each column to its own top edge, so a tank's armhole or a neckline is the grid's edge. */
function halfRows(c: Cut, back: boolean, ths: number[]) {
  const tops = ths.map((th) => topOf(c, back, se(halfW(c, 1), 1, th).x));
  return Array.from({ length: ROWS + 1 }, (_, j) => ths.map((th, i) => bodyPoint(c, back, th, rowAt(j) * tops[i]!)));
}

/** A sleeve's section: an oval this much flatter one way (e2) than the other. */
const FLAT = 0.9;
/** Angles round the sleeve's oval spaced by arc length, and its perimeter at radius 1: a print's u is even centimetres all round. */
const OVAL = (() => {
  const n = 720, run = [0];
  for (let i = 1; i <= n; i++) {
    const a = ((i - 1) / n - 0.5) * TAU, b = (i / n - 0.5) * TAU;
    run.push(run[i - 1]! + Math.hypot(Math.cos(b) - Math.cos(a), FLAT * (Math.sin(b) - Math.sin(a))));
  }
  const total = run[n]!;
  const at = (u: number) => {
    const want = u * total;
    let k = 0;
    while (k < n - 1 && run[k + 1]! < want) k++;
    return ((k + (want - run[k]!) / (run[k + 1]! - run[k]! || 1)) / n - 0.5) * TAU;
  };
  return { at, perimeter: total };
})();
/** How far down the sleeve (world units) it blends out of the armhole: a print zone keeps below that. */
const SLEEVE_BLEND = 0.14;

/** A sleeve, `side` +1 for the wearer's left (+x): lofted out of the armhole on the body's side into a tapering, folding tube. */
function sleeve(c: Cut, side: 1 | -1) {
  const sl = c.sleeve!;
  const a = halfW(c, 1), shoulderY = c.height - c.slope, under = shoulderY - sl.r0 * 1.75;
  const mid = (shoulderY + under) / 2, hy = (shoulderY - under) / 2;
  const dir = V(side * Math.cos(sl.angle), -Math.sin(sl.angle), 0);
  const face = V(side * 0.6, 0.35, 1).normalize();
  const e1 = face.clone().addScaledVector(dir, -face.dot(dir)).normalize();
  const e2 = V().crossVectors(e1, dir).normalize();
  const sideX = (y: number, z: number) => {
    const t = y / c.height, w = halfW(c, t), d = halfD(c, t) * (1 - 0.85 * smooth(c.height - c.slope - 0.28, c.height - c.slope, y));
    return w * (1 - Math.min(0.97, Math.abs(z) / d) ** N) ** (1 / N);
  };
  // The tube starts with its top on the shoulder tip, so the shoulder line runs on down the sleeve.
  const center = V(side * a, shoulderY, 0).addScaledVector(V(-side * Math.sin(sl.angle), Math.cos(sl.angle), 0), -sl.r0);
  /** The armhole on the body at angle k round the sleeve: an oval on the body's side. */
  const hole = (k: number) => {
    const q = e1.clone().multiplyScalar(Math.cos(k)).addScaledVector(e2, Math.sin(k));
    const ang = Math.atan2(q.z, q.y);
    const y = mid + hy * Math.cos(ang), z = halfD(c, mid / c.height) * 0.55 * Math.sin(ang);
    return V(side * (sideX(Math.min(y, shoulderY - 0.005), z) + 0.004), Math.min(y, shoulderY), z);
  };
  const along = 30, round = 40, L = sl.length, zone = c.zones.sleeve;
  const rows: V3[][] = [];
  for (let j = 0; j <= along; j++) {
    const f = j / along, blend = smooth(0, SLEEVE_BLEND, f * L);
    const cuffBlouse = sl.cuff ? 0.07 * smooth(0.78, 1, f) : 0;
    const r = lerp(sl.r0, sl.r1, f) * (1 + cuffBlouse);
    const ctr = center.clone().addScaledVector(dir, f * L);
    const row: V3[] = [];
    for (let i = 0; i <= round; i++) {
      const u = i / round, k = OVAL.at(u);
      // Folds: wrinkles stacking toward a long sleeve's cuff, a little crease under the arm, unevenness.
      const stack = L > 0.6 ? 0.08 * smooth(0.5, 0.95, f) * Math.sin(TAU * (f * L / 0.075 + u * 1.3 + 0.5 * noise(u * 4, f * 6))) : 0;
      const down = -(e1.y * Math.cos(k) + e2.y * Math.sin(k)) / (Math.hypot(e1.y, e2.y) || 1);
      const pit = 0.035 * smooth(0.5, 1, down) * Math.exp(-(((f - 0.12) / 0.1) ** 2)) * Math.sin(TAU * u * 5);
      const fold = (stack + pit + 0.012 * noise(u * 6 + side, f * 5)) * c.folds * damp(zone, u, 1 - f, 0.2);
      const rr = r * (1 + fold);
      const tube = ctr.clone().addScaledVector(e1, Math.cos(k) * rr).addScaledVector(e2, Math.sin(k) * rr * FLAT);
      row.push(blend < 1 ? hole(k).lerp(tube, blend) : tube);
    }
    rows.push(row);
  }
  const strip = side > 0 ? LEFT : RIGHT;
  const geo = gridGeo(rows, (i, j) => [strip[0] + (i / round) * (strip[1] - strip[0]), 1 - j / along]);
  // gridGeo winds rows bottom-up; along the sleeve that faces inward, so flip it.
  const ix = geo.getIndex()!;
  for (let k = 0; k < ix.count; k += 3) { const b = ix.getX(k + 1); ix.setX(k + 1, ix.getX(k + 2)); ix.setX(k + 2, b); }
  geo.computeVertexNormals();
  const end = center.clone().addScaledVector(dir, L);
  return { geo, rows, end, dir, e1, e2, radiusAt: (v: number) => lerp(sl.r0, sl.r1, 1 - v) };
}

function zone(name: ZoneName, label: string, view: Side, strip: [number, number], rect: Zone, widthAt: (v: number) => number, height: number): PrintZone {
  const span = strip[1] - strip[0];
  const z = { u0: strip[0] + rect.u0 * span, u1: strip[0] + rect.u1 * span, v0: rect.v0, v1: rect.v1 };
  return { ...z, name, label, view, width: (v) => (rect.u1 - rect.u0) * widthAt(rect.v0 + v * (rect.v1 - rect.v0)), height: (rect.v1 - rect.v0) * height };
}

const ringCenter = (ring: V3[]) => ring.reduce((a, p) => a.add(p), V()).divideScalar(ring.length);

/** A rib band: rings from `ring` stepping by `step(k)` (0..1 down the band), u round it in world units. */
function ribBand(ring: V3[], step: (p: V3, k: number, i: number) => V3, rows = 6) {
  return gridGeo(Array.from({ length: rows + 1 }, (_, j) => ring.map((p, i) => step(p, j / rows, i))), (_i, j, _across, run) => [run, j / rows]);
}

export function buildCut(c: Cut, onHanger = false): Garment {
  const m = kit(c);
  const group = new THREE.Group(), prints: Fabric[] = [], dyed: Fabric[] = [];
  const add = (g: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial) => { const x = new THREE.Mesh(g, mat); dyed.push(x); group.add(x); return x; };
  const ths = columns(c);

  // The two halves, each with its own inside.
  const fr = halfRows(c, false, ths), br = halfRows(c, true, ths);
  // Point by point (rows climb each column to its own top): u by arc length round the level section there, v its height.
  const fs = sections(c, false, ths), bs = sections(c, true, ths);
  const uvOf = (rows: V3[][], s: typeof fs, strip: [number, number]) => (i: number, j: number): [number, number] => {
    const p = rows[j]![i]!;
    return [strip[0] + s.u(i, p.y) * (strip[1] - strip[0]), p.y / c.height];
  };
  const fGeo = gridGeo(fr, uvOf(fr, fs, FRONT)), bGeo = gridGeo(br, uvOf(br, bs, BACK));
  const parts = [fGeo, bGeo];
  let left: ReturnType<typeof sleeve> | null = null;
  if (c.sleeve) {
    left = sleeve(c, 1);
    const right = sleeve(c, -1);
    parts.push(left.geo, right.geo);
    for (const s of [left, right]) finishSleeve(c, s, m, add);
  }
  for (const g of parts) {
    const p = new THREE.Mesh(g, m.print);
    prints.push(p);
    group.add(p);
    add(g, m.inside);
  }

  // The waistband: a rib that pulls in, or a rolled hem with its twin stitch line.
  const bottom = [...fr[0]!, ...br[0]!.slice(1)];
  if (c.hem) {
    add(ribBand(bottom, (p, k) => {
      const inward = p.clone().setY(0);
      const pull = 0.05 * smooth(0, 0.35, k) - 0.012 * Math.sin(Math.PI * k);
      return V(p.x - inward.x * pull, -c.hem * k, p.z - inward.z * pull);
    }, 8), m.rib);
  } else {
    add(ribBand(bottom, (p, k) => { const inward = p.clone().setY(0).normalize(); return p.clone().addScaledVector(inward, -0.014 * k).setY(-0.004 * Math.sin(Math.PI * k)); }, 2), m.plain());
    for (const y of [0.045, 0.058]) {
      const pts = [...ths.map((th) => bodyPoint(c, false, th, y)), ...ths.slice(1).map((th) => bodyPoint(c, true, th, y))];
      add(stitchGeo(pts, pts.map((p) => p.clone().setY(0).normalize())), m.stitch);
    }
  }

  // The neckline: a rib collar on a crew neck; a tank's edges are bound all the way round instead.
  if (c.straps) {
    for (const [rows, back] of [[fr, false], [br, true]] as const) {
      const edge = rows[ROWS]!;
      add(tubeGeo(edge, 0.008, 0.008, () => V(0, 0, back ? -1 : 1)), m.plain());
      const below = edge.map((p, i) => p.clone().lerp(rows[ROWS - 1]![i]!, 0.5));
      add(stitchGeo(below, below.map(() => V(0, 0, back ? -1 : 1))), m.stitch);
    }
  } else {
    const ring: V3[] = [];
    for (let i = 0; i <= 72; i++) {
      const ph = (i / 72) * TAU, back = Math.cos(ph) < 0, n = back ? c.neck.back : c.neck.front;
      const x = Math.sin(ph) * n.w * 0.995, top = topOf(c, back, x);
      ring.push(V(x, top, (back ? -1 : 1) * Math.max(0.012, neckZ(c, back, x))));
    }
    if (c.collar) {
      add(ribBand(ring, (p, k) => {
        const inward = V(-p.x, 0, -p.z).normalize();
        return p.clone().add(V(0, c.collar * k, 0)).addScaledVector(inward, c.collar * 0.3 * k * k).addScaledVector(inward, -0.006 * Math.sin(Math.PI * k));
      }, 5), m.rib);
      const below = ring.map((p) => p.clone().add(V(0, -0.012, 0)));
      add(stitchGeo(below, below.map((p) => V(p.x, 0.6, p.z).normalize())), m.stitch);
    }
    // The shoulder seams, where the halves meet over the top.
    for (const s of [-1, 1]) {
      const seam = ths.filter((th) => s * Math.sin(th) > 0).map((th) => { const x = se(halfW(c, 1), 1, th).x; return V(x, topOf(c, false, x), 0.0); }).filter((p) => Math.abs(p.x) > c.neck.front.w + 0.01 && Math.abs(p.x) < halfW(c, 1) - 0.06);
      if (seam.length > 2) add(stitchGeo(seam, seam.map(() => V(0, 1, 0))), m.stitch);
    }
    if (c.hood) hood(c, m, add, group);
  }
  if (c.hood) pocket(c, m, add, group);
  const settle = onHanger ? hangIt(c, group, prints, fs.width) : null;

  const z = c.zones, H = c.height;
  const zones = [
    zone("front", "Front", "front", FRONT, z.front, fs.width, H),
    zone("back", "Back", "back", BACK, z.back, bs.width, H),
  ];
  if (left && z.sleeve) {
    // Clear of where the sleeve blends out of the armhole, so a picture never creases into the shoulder.
    const rect = { ...z.sleeve, v1: Math.min(z.sleeve.v1, 1 - (SLEEVE_BLEND + 0.03) / c.sleeve!.length) };
    zones.push(zone("left-sleeve", "Sleeve", "angle", LEFT, rect, (v) => OVAL.perimeter * left.radiusAt(v), c.sleeve!.length));
  }
  return { group, prints, dyed, zones, target: V(0, H * 0.5 - (c.hem ? c.hem / 2 : 0), 0), ...(settle && { tick: settle.tick, restart: settle.restart }) };
}

/** On a hanger: the front, back and sleeves become cloth, pinned along the shoulders (a tank by its straps). */
function hangIt(c: Cut, group: THREE.Group, prints: Fabric[], width: (t: number) => number) {
  const a = halfW(c, 1);
  const pin = (back: boolean) => (_i: number, p: V3) => {
    const x = back ? -p.x : p.x;
    return p.y > topOf(c, back, x) - 0.004 && Math.abs(x) > c.neck.front.w && Math.abs(x) < a - 0.03 && closes(c, back, x) > 0.5;
  };
  // Laid flat: each half's rows unrolled across, a sleeve pressed flat and moved out with the unrolled side seam.
  const flatHalf = (mesh: Fabric, s: 1 | -1) => {
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute, out: V3[] = [];
    for (let j = 0; j <= ROWS; j++) {
      const row = Array.from({ length: COLS + 1 }, (_, i) => V().fromBufferAttribute(pos, j * (COLS + 1) + i));
      const run = [0];
      for (let i = 1; i <= COLS; i++) run.push(run[i - 1]! + Math.hypot(row[i]!.x - row[i - 1]!.x, row[i]!.z - row[i - 1]!.z));
      row.forEach((p, i) => out.push(V(s * (run[i]! - run[COLS]! / 2), p.y, s * 0.008)));
    }
    return (i: number) => out[i]!;
  };
  const spread = width(0.8) / 2 - halfW(c, 0.8);
  const flatSleeve = (_i: number, p: V3) => V(p.x + Math.sign(p.x) * spread, p.y, p.z * 0.08);
  const parts: ClothPart[] = prints.map((mesh, k) => ({
    mesh, side: k === 0 ? 1 : k === 1 ? -1 : 0, pinned: k < 2 ? pin(k === 1) : () => false,
    flat: k < 2 ? flatHalf(mesh, k === 0 ? 1 : -1) : flatSleeve,
  }));
  const cloth = new Set<THREE.Object3D>(prints);
  const followers: THREE.Mesh[] = [];
  group.traverse((o) => { if (o instanceof THREE.Mesh && !cloth.has(o) && !prints.some((p) => p.geometry === o.geometry)) followers.push(o); });
  group.add(hangerModel(a - 0.04, (x) => topOf(c, false, Math.abs(x) < c.neck.front.w ? c.neck.front.w : x)));
  return hang(parts, followers);
}

/** The sleeve's end (a rib cuff, or a rolled hem with stitching) and the armhole seam. */
function finishSleeve(c: Cut, s: ReturnType<typeof sleeve>, m: Kit, add: (g: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial) => unknown) {
  const sl = c.sleeve!, last = s.rows[s.rows.length - 1]!, first = s.rows[1]!;
  if (sl.cuff) {
    add(ribBand(last, (p, k) => {
      const out = p.clone().sub(s.end), rel = out.clone().addScaledVector(s.dir, -out.dot(s.dir));
      const pull = 0.22 * smooth(0, 0.3, k);
      return s.end.clone().addScaledVector(s.dir, out.dot(s.dir) + sl.cuff * k).addScaledVector(rel, 1 - pull);
    }, 6), m.rib);
  } else {
    add(ribBand(last, (p, k) => { const rel = p.clone().sub(s.end); return s.end.clone().add(rel.multiplyScalar(1 - 0.08 * k)).addScaledVector(s.dir, -0.004 * k); }, 2), m.plain());
    const back = s.rows[s.rows.length - 3]!;
    add(stitchGeo(back, back.map((p) => p.clone().sub(s.end).addScaledVector(s.dir, -p.clone().sub(s.end).dot(s.dir)).normalize())), m.stitch);
  }
  const ctr = ringCenter(first);
  add(stitchGeo(first, first.map((p) => p.clone().sub(ctr).normalize())), m.stitch);
}

/**
 * A hood lying back over the shoulders, as two layers of fleece: its opening's rolled edge crosses at the front of
 * the neck, lies flat on the shoulders and swings back behind it to the crown's lip; inside that, the lining sinks into a
 * dark bowl; outside, the slack shell rolls over the crown, slumps onto the shoulders and comes down to a soft point
 * on the upper back, creased where it gathers at the neck and where the point bunches (#4657).
 */
function hood(c: Cut, m: Kit, add: (g: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial) => THREE.Mesh, group: THREE.Group) {
  const nw = c.neck.front.w, rx = nw + 0.1, rz = c.nd + 0.06, yNb = topOf(c, true, 0);
  const ang = (ph: number) => Math.atan2(Math.sin(ph), Math.cos(ph));
  const loopNoise = (ph: number, seed: number) => noise(Math.cos(ph) * 1.6 + seed, Math.sin(ph) * 1.6 + seed);
  // How far round to the back: 0 round the front of the neck, 1 at the crown's lip behind it.
  const backness = (ph: number) => smooth(0.9, 2.2, Math.abs(ang(ph)));
  const rimAt = (ph: number) => {
    const back = Math.cos(ph) < 0, a = ang(ph), b = backness(ph);
    // Round the neck it sits on the neckline; out on the shoulders it lies on them, where they slope away.
    const sx = Math.sin(ph) * lerp(nw, rx, smooth(0.35, 1.2, Math.abs(a)));
    const around = topOf(c, back, sx) + 0.015 + 0.03 * (1 - Math.cos(ph)) / 2 - 0.08 * Math.exp(-((a / 0.4) ** 2)) - 0.05 * Math.exp(-(((Math.abs(a) - 0.9) / 0.5) ** 2));
    // Where the edge lies on the shoulders it drops in a few soft folds.
    const folds = 0.012 * Math.sin(ph * 7) * Math.exp(-(((Math.abs(a) - 1.45) / 0.4) ** 2)) + 0.006 * loopNoise(ph, 9);
    return V(Math.sin(ph) * lerp(rx, rx + 0.05, b), lerp(around, yNb - 0.07, b) + folds, Math.cos(ph) * lerp(rz, 0.28, b));
  };
  const rim = Array.from({ length: 96 }, (_, i) => rimAt((i / 96) * TAU));
  const hoodMat = m.plain();
  // The band is soft, not an even pipe: wider and flatter where it bunches, rippling a little along its length,
  // and round the front, where nothing joins it from below, sitting up on the cloth it lies on (a flat band there sank
  // into the shoulders' cloth where the old round roll stood clear of it).
  const sitUp = (ph: number) => 0.022 * (1 - backness(ph));
  const bunch = (i: number) => loopNoise((i / rim.length) * TAU, 2.3), ripple = (i: number) => 0.003 * Math.sin((i / rim.length) * TAU * 11) + sitUp((i / rim.length) * TAU);
  add(bandGeo(rim, bunch, ripple), hoodMat);
  add(stitchGeo(...bandLine(rim, 0.72, bunch, ripple), 0.008), m.stitch);

  // The back of the body at (x, y), for laying the hood on it.
  const backAt = (x: number, y: number) => {
    const w = halfW(c, clamp01(y / c.height)), th = Math.asin(Math.sign(-x) * Math.min(1, Math.abs(x) / w) ** (N / 2));
    return bodyPoint(c, true, th, Math.min(y, topOf(c, true, x) - 0.02));
  };
  const bez = (a: V3, b: V3, c2: V3, d: V3, t: number) => {
    const u = 1 - t;
    return a.clone().multiplyScalar(u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c2, 3 * u * t * t).addScaledVector(d, t * t * t);
  };
  const S = 64, Q = 48, Lh = 0.6, Wh = 0.33, SPAN = 1.85;
  const phOf = (s: number) => Math.PI + s * SPAN;

  // The lining: from the neckline back to the lip, sagging into a bowl where the head would go.
  const lining = m.inside.clone();
  lining.side = THREE.DoubleSide;
  const bowl: V3[][] = [];
  for (let j = 0; j <= 10; j++) {
    const t = j / 10, row: V3[] = [];
    for (let i = 0; i <= S; i++) {
      const ph = phOf((i / S) * 2 - 1), back = Math.cos(ph) < 0, x = Math.sin(ph) * nw * 0.995;
      const seam = V(x, topOf(c, back, x), (back ? -1 : 1) * Math.max(0.012, neckZ(c, back, x)));
      const lip = rimAt(ph);
      row.push(seam.lerp(lip, t).add(V(0, -0.1 * backness(ph) * Math.sin(Math.PI * t) ** 0.8, 0)));
    }
    bowl.push(row);
  }
  add(gridGeo(bowl), lining);

  // The shell: over the crown from the lip, standing off the back, down to a rounded point lying on it.
  const rows: V3[][] = [];
  for (let j = 0; j <= Q; j++) {
    const q = j / Q, row: V3[] = [];
    for (let i = 0; i <= S; i++) {
      const s = (i / S) * 2 - 1, b = Math.sqrt(1 - s * s), lip = rimAt(phOf(s)).add(V(0, -0.012, 0));
      const bx = -s * Wh, by = yNb - Lh * (0.45 + 0.55 * lerp(1 - Math.sqrt(s * s + 0.02), b, 0.4)), my = lerp(lip.y, by, 0.5);
      const foot = backAt(bx, by).add(V(0, 0, -0.01));
      // Slack fleece: the crown barely rises before it falls back, and the sides slump out onto the shoulders.
      const crown = lip.clone().add(V(0, 0.08 * b, -0.2 * b));
      const fall = V(bx * 1.15, my - 0.05 * (1 - b), backAt(bx, my).z - 0.04 - 0.2 * b);
      const p = bez(lip, crown, fall, foot, q);
      const slump = smooth(0.4, 1, Math.abs(s)) * Math.sin(Math.PI * q);
      p.x += Math.sign(bx) * 0.045 * slump;
      p.y -= 0.06 * slump;
      // Folds where it gathers: at the neck just past the lip, and where its point bunches on the back, with two long
      // ones running from the neck's sides toward the point. Valleys sharp, ridges round, as cloth folds.
      const gather = Math.exp(-(((q - 0.22) / 0.13) ** 2)) + 1.1 * smooth(0.68, 1, q);
      const crease = Math.abs(Math.sin(s * 5.2 + 0.5 + 0.9 * q + 0.6 * noise(s * 2, q * 3))) - 0.62;
      const long = Math.max(...[-1, 1].map((k) => Math.exp(-(((s - k * (0.72 - 0.5 * q)) / 0.11) ** 2)))) * Math.sin(Math.PI * q) ** 0.7;
      const sag = 0.012 * Math.sin(q * 13 + s * s * 4) * smooth(0.3, 0.5, q) * (1 - smooth(0.8, 0.95, q)) * b;
      // The centre seam's stitching pulls the cloth beside it into small slanting puckers.
      const pucker = 0.008 * Math.sin(q * 62 + Math.abs(s) * 28 + 2 * noise(q * 5, 4.1)) * Math.exp(-(((Math.abs(s) - 0.05) / 0.045) ** 2)) * smooth(0.06, 0.18, q) * (1 - smooth(0.82, 0.95, q));
      const depth = (0.045 * crease * gather + 0.035 * long + sag + pucker + 0.012 * noise(s * 3 + 7, q * 4)) * (0.35 + 0.65 * b);
      p.addScaledVector(V(0, 1 - smooth(0.12, 0.45, q), -1).normalize(), depth);
      // The middle drifts a little side to side as it hangs, so the centre seam isn't ruler-straight.
      p.x += 0.008 * noise(q * 4 + 3, 1.7) * b * smooth(0.1, 0.45, q);
      const body = backAt(p.x, p.y).z - 0.012;
      if (p.z > body) p.z = lerp(p.z, body, smooth(0.04, 0.2, q));
      row.push(p);
    }
    rows.push(row);
  }
  add(gridGeo(rows), hoodMat);
  const seam = rows.map((r) => r[S / 2]!).slice(1, -2);
  add(stitchGeo(seam, seam.map((p, k) => V(1, 0, 0).cross((seam[k + 1] ?? p).clone().sub(seam[Math.max(0, k - 1)]!)).normalize())), m.stitch);

  // A soft shadow on the back where the shell's edge lies, round its sides and point.
  const edge = [...rows.map((r) => r[0]!), ...rows[Q]!.slice(1), ...rows.map((r) => r[S]!).reverse().slice(1)].filter((p) => p.y < yNb - 0.05);
  const shadow: number[] = [], tint: number[] = [], idx: number[] = [];
  const mid = V(0, yNb - Lh * 0.55, 0);
  edge.forEach((p, k) => {
    const out = V(p.x - mid.x, p.y - mid.y, 0).normalize();
    const a = backAt(p.x, p.y).add(V(0, 0, -0.004)), o = backAt(p.x + out.x * 0.05, p.y + out.y * 0.05).add(V(0, 0, -0.004));
    shadow.push(a.x, a.y, a.z, o.x, o.y, o.z);
    tint.push(0, 0, 0, 0.32, 0, 0, 0, 0);
    if (k) { const n = k * 2; idx.push(n - 2, n, n + 1, n - 2, n + 1, n - 1); }
  });
  const sg = new THREE.BufferGeometry();
  sg.setAttribute("position", new THREE.Float32BufferAttribute(shadow, 3));
  sg.setAttribute("color", new THREE.Float32BufferAttribute(tint, 4));
  sg.setIndex(idx);
  group.add(new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
  // Drawcords out of the rim's underside at the front, lying on the chest as they fall, with a soft sway and
  // uneven lengths, so they read as cord, not rods. Metal tips.
  const cordMat = new THREE.MeshStandardMaterial({ color: "#ecebe8", roughness: 0.85 });
  const tipMat = new THREE.MeshStandardMaterial({ color: "#a8a29e", roughness: 0.35, metalness: 0.8 });
  for (const s of [-1, 1]) {
    const start = rimAt(s * 0.32).add(V(0, sitUp(s * 0.32), 0));
    const n = s < 0 ? 22 : 19;
    const pts = Array.from({ length: n }, (_, k) => {
      const t = k / (n - 1), y = start.y - 0.012 - k * 0.019;
      const x = start.x * lerp(0.95, 0.78, t) + s * 0.016 * Math.sin(t * 4.2 + (s < 0 ? 0.4 : 1.6)) * smooth(0, 0.3, t);
      const front = bodyPoint(c, false, Math.asin(Math.sign(x) * Math.min(1, Math.abs(x) / halfW(c, y / c.height)) ** (N / 2)), y);
      // Out of the rim it eases down onto the cloth over its first few points, then rests on it.
      return V(x, y, lerp(start.z, front.z + 0.01, smooth(0, 0.18, t)));
    });
    group.add(new THREE.Mesh(tubeGeo(pts, 0.0105, 0.0075, () => V(0, 0, 1)), cordMat));
    const end = pts[pts.length - 1]!;
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 0.04, 10), tipMat);
    tip.position.copy(end).add(V(0, -0.02, 0));
    group.add(tip);
  }
}

/** A hoodie's pouch pocket: a patch on the belly, open at its slanted sides, stitched along its top and bottom. */
function pocket(c: Cut, m: Kit, add: (g: THREE.BufferGeometry, mat: THREE.MeshStandardMaterial) => unknown, group: THREE.Group) {
  const H = c.height, yb = 0.015, yt = H * 0.38, wb = 0.34, wt = 0.24, A = 20, B = 14;
  const at = (a: number, b: number, lift: number) => {
    const y = lerp(yb, yt, b), hw = lerp(wb, wt, b), x = (a * 2 - 1) * hw;
    const w = halfW(c, y / H), th = Math.asin(Math.sign(x) * Math.min(1, Math.abs(x) / w) ** (N / 2));
    const p = bodyPoint(c, false, th, y), n = V(p.x / w ** 2, 0, p.z / halfD(c, y / H) ** 2).normalize();
    return p.addScaledVector(n, lift);
  };
  const rows = Array.from({ length: B + 1 }, (_, j) => Array.from({ length: A + 1 }, (_, i) => at(i / A, j / B, 0.012 + 0.012 * Math.sin((Math.PI * i) / A) * Math.sin((Math.PI * j) / B))));
  add(gridGeo(rows), m.plain());
  // The pocket's mouths: a shadow on the body just inside each slanted side.
  const shade = new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const a0 of [0, 1]) {
    const strip = Array.from({ length: B + 1 }, (_, j) => [at(a0, j / B, 0.004), at(a0 ? 1 - 0.07 : 0.07, j / B, 0.004)]);
    const g = gridGeo(strip.map((r) => (a0 ? r : [r[1]!, r[0]!])));
    group.add(new THREE.Mesh(g, shade));
  }
  for (const b of [0.08, 0.97]) {
    const pts = Array.from({ length: A + 1 }, (_, i) => at(i / A, b, 0.012 + 0.012 * Math.sin((Math.PI * i) / A) * Math.sin(Math.PI * b)));
    add(stitchGeo(pts, pts.map((p) => V(p.x, 0, p.z).normalize())), m.stitch);
  }
}

// ---- the range -----------------------------------------------------------------------------------------------

const CREW = { front: { w: 0.15, dip: 0.1 }, back: { w: 0.15, dip: 0.03 } };

export const CUTS: Record<TopModel, Cut> = {
  tee: {
    height: 1.52, ease: 1.04, waist: 0, slope: 0.15, neck: CREW, nd: 0.11, hem: 0, collar: 0.04, folds: 1, cloth: "jersey",
    sleeve: { angle: 0.6, length: 0.44, r0: 0.2, r1: 0.175, cuff: 0 },
    zones: { front: { u0: 0.2, u1: 0.8, v0: 0.24, v1: 0.8 }, back: { u0: 0.18, u1: 0.82, v0: 0.22, v1: 0.82 }, sleeve: { u0: 0.3, u1: 0.7, v0: 0.12, v1: 0.85 } },
  },
  sweater: {
    height: 1.42, ease: 1.08, waist: 0, slope: 0.15, neck: { front: { w: 0.15, dip: 0.09 }, back: { w: 0.15, dip: 0.03 } }, nd: 0.11, hem: 0.11, collar: 0.06, folds: 1.1, cloth: "knit",
    sleeve: { angle: 1.1, length: 0.92, r0: 0.19, r1: 0.105, cuff: 0.1 },
    zones: { front: { u0: 0.2, u1: 0.8, v0: 0.22, v1: 0.78 }, back: { u0: 0.18, u1: 0.82, v0: 0.2, v1: 0.82 }, sleeve: { u0: 0.3, u1: 0.7, v0: 0.5, v1: 0.92 } },
  },
  hoodie: {
    height: 1.45, ease: 1.14, waist: 0, slope: 0.16, neck: { front: { w: 0.16, dip: 0.07 }, back: { w: 0.16, dip: 0.02 } }, nd: 0.12, hem: 0.13, collar: 0, folds: 1.2, cloth: "fleece", hood: true,
    sleeve: { angle: 1.08, length: 0.96, r0: 0.21, r1: 0.12, cuff: 0.12 },
    zones: { front: { u0: 0.22, u1: 0.78, v0: 0.44, v1: 0.8 }, back: { u0: 0.2, u1: 0.8, v0: 0.12, v1: 0.5 }, sleeve: { u0: 0.3, u1: 0.7, v0: 0.5, v1: 0.92 } },
  },
  tank: {
    height: 1.55, ease: 1.0, waist: 0, slope: 0.13, neck: { front: { w: 0.18, dip: 0.2 }, back: { w: 0.18, dip: 0.08 } }, nd: 0.1, hem: 0, collar: 0, folds: 0.9, cloth: "jersey",
    straps: { front: 0.3, back: 0.3, underarm: 0.6 },
    zones: { front: { u0: 0.22, u1: 0.78, v0: 0.2, v1: 0.58 }, back: { u0: 0.22, u1: 0.78, v0: 0.2, v1: 0.6 } },
  },
  racerback: {
    height: 1.55, ease: 0.97, waist: 1, slope: 0.13, neck: { front: { w: 0.19, dip: 0.27 }, back: { w: 0.07, dip: 0.12 } }, nd: 0.1, hem: 0, collar: 0, folds: 0.8, cloth: "jersey",
    straps: { front: 0.26, back: 0.12, underarm: 0.56 },
    zones: { front: { u0: 0.24, u1: 0.76, v0: 0.18, v1: 0.56 }, back: { u0: 0.24, u1: 0.76, v0: 0.18, v1: 0.52 } },
  },
};

/** A top; `onHanger` hangs a sleeved one on a hanger (a tank stays on its form). */
export const buildTop = (m: TopModel, onHanger = false): Garment => buildCut(CUTS[m], onHanger && !!CUTS[m].sleeve);
