// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// The tops, made in code like the hats: a tee and a hoodie, laid out as on a hanger (front to +z, arms out and down).
// A top isn't a lathe, so its print meshes share one canvas through a UV atlas instead: the body's front half takes
// u 0..0.4, its back half 0.4..0.8, the left sleeve 0.8..0.9 and the right 0.9..1. Inside each, u runs across by
// arc length and v up by height, so a picture keeps its shape on the cloth, and it reads the right way round from
// the side it is printed on. The print zones (front, back, left sleeve) are rects inside those strips.
import * as THREE from "three";
import { fabric, type Garment } from "./hats.ts";
import type { PrintZone, Side, Zone } from "./print.ts";
import type { TopModel, ZoneName } from "../api.ts";

type Fabric = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

type Shape = {
  /** Body height, and the half-width and half-depth at height t (0 hem .. 1 shoulder line). */
  height: number;
  halfWidth: (t: number) => number;
  halfDepth: (t: number) => number;
  /** How far the shoulders slope down from the neck, and the neck's half-width and front and back dips. */
  slope: number;
  neck: number;
  dipFront: number;
  dipBack: number;
  sleeve: { angle: number; length: number; r0: number; r1: number };
};

const ROWS = 40, COLS = 36;

/** The body's top at x: the shoulder line, sloping down from the neck, with the neckline cut into it. */
function topAt(s: Shape, x: number, dip: number) {
  const a = s.halfWidth(1), n0 = s.neck * 0.6;
  const cut = Math.abs(x) < s.neck ? dip * Math.sqrt(1 - (x / s.neck) ** 2) : 0;
  return s.height - s.slope * Math.max(0, (Math.abs(x) - n0) / (a - n0)) ** 1.3 - cut;
}

/** A point round the body at height t, angle th (0 the front centre, +-pi/2 the sides): a soft box, not a tube. */
function around(s: Shape, t: number, th: number) {
  const sn = Math.sin(th), cs = Math.cos(th), n = 3.2;
  return new THREE.Vector2(s.halfWidth(t) * Math.sign(sn) * Math.abs(sn) ** (2 / n), s.halfDepth(t) * Math.sign(cs) * Math.abs(cs) ** (2 / n));
}

/**
 * One half of the body (front: z > 0, or back), its UVs in `strip` (u0..u1 of the atlas). Rows sit at even heights
 * and stop at the shoulder line; u is arc length across the row, from the wearer's right on the front and the
 * wearer's left on the back, so both read the right way round from their own side. Returns the mesh and the row
 * widths a print zone needs.
 */
function half(s: Shape, back: boolean, strip: [number, number]) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [], widths: number[] = [];
  for (let j = 0; j <= ROWS; j++) {
    const y = (j / ROWS) * s.height, t = y / s.height;
    const row: THREE.Vector2[] = [];
    for (let i = 0; i <= COLS; i++) {
      const th = -Math.PI / 2 + (i / COLS) * Math.PI;
      const p = around(s, t, th);
      row.push(back ? new THREE.Vector2(-p.x, -p.y) : p);
    }
    const run = [0];
    for (let i = 1; i <= COLS; i++) run.push(run[i - 1]! + row[i]!.distanceTo(row[i - 1]!));
    const len = run[COLS]!;
    widths.push(len);
    for (let i = 0; i <= COLS; i++) {
      const p = row[i]!;
      pos.push(p.x, Math.min(y, topAt(s, p.x, back ? s.dipBack : s.dipFront)), p.y);
      uv.push(strip[0] + (run[i]! / len) * (strip[1] - strip[0]), t);
    }
  }
  for (let j = 0; j < ROWS; j++) {
    for (let i = 0; i < COLS; i++) {
      const a = j * (COLS + 1) + i, b = a + 1, c = a + COLS + 1, d = c + 1;
      idx.push(a, b, d, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, widthAt: (t: number) => widths[Math.round(THREE.MathUtils.clamp(t, 0, 1) * ROWS)]! };
}

/** The strip across the top from the front's shoulder line to the back's, open at the neck. */
function yoke(s: Shape) {
  const pos: number[] = [], idx: number[] = [];
  const side = (x: number) => Math.abs(x) >= s.neck;
  let k = 0;
  for (let i = 0; i <= COLS; i++) {
    const th = -Math.PI / 2 + (i / COLS) * Math.PI;
    const p = around(s, 1, th);
    pos.push(p.x, topAt(s, p.x, s.dipFront), p.y, p.x, topAt(s, p.x, s.dipBack), -p.y);
    if (i > 0 && side(p.x) && side(around(s, 1, th - Math.PI / COLS).x)) idx.push(k - 2, k, k + 1, k - 2, k + 1, k - 1);
    k += 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A sleeve: a tapered tube from the shoulder, `side` +1 for the wearer's left (+x). Its UVs fill `strip`; u = 0.5 faces
 * `face` (toward the camera's three-quarter view), and the picture's up runs back toward the shoulder.
 */
function sleeve(s: Shape, side: 1 | -1, strip: [number, number]) {
  const { angle, length, r0, r1 } = s.sleeve;
  const dir = new THREE.Vector3(side * Math.cos(angle), -Math.sin(angle), 0);
  const root = new THREE.Vector3(side * (s.halfWidth(1) - r0 * 0.55), topAt(s, s.halfWidth(1), 0) - r0 * 0.75, 0);
  const face = new THREE.Vector3(side, 0.35, 1).normalize();
  const e1 = face.clone().addScaledVector(dir, -face.dot(dir)).normalize();
  const e2 = new THREE.Vector3().crossVectors(e1, dir).normalize();
  const along = 16, round = 32, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= along; j++) {
    const f = j / along, r = r0 + (r1 - r0) * f;
    const c = root.clone().addScaledVector(dir, f * length);
    for (let i = 0; i <= round; i++) {
      const u = i / round, a = (u - 0.5) * Math.PI * 2;
      const p = c.clone().addScaledVector(e1, Math.cos(a) * r).addScaledVector(e2, Math.sin(a) * r * 0.92);
      pos.push(p.x, p.y, p.z);
      uv.push(strip[0] + u * (strip[1] - strip[0]), 1 - f);
    }
  }
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < round; i++) {
      const a = j * (round + 1) + i, b = a + 1, c = a + round + 1, d = c + 1;
      idx.push(a, c, d, a, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geo: g, end: root.clone().addScaledVector(dir, length), dir, radiusAt: (v: number) => r0 + (r1 - r0) * (1 - v) };
}

/** A ribbed band round a ring of points (a collar, a cuff, a waistband). */
function band(ring: THREE.Vector3[], up: THREE.Vector3, h: number, out = 1.03) {
  const c = ring.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(ring.length);
  const pos: number[] = [], idx: number[] = [];
  ring.forEach((p, i) => {
    const q = c.clone().add(p.clone().sub(c).multiplyScalar(out));
    pos.push(q.x, q.y, q.z, q.x + up.x * h, q.y + up.y * h, q.z + up.z * h);
    if (i) { const k = i * 2; idx.push(k - 2, k, k + 1, k - 2, k + 1, k - 1); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, fabric());
}

const circle = (c: THREE.Vector3, e1: THREE.Vector3, e2: THREE.Vector3, r: number, n = 32) =>
  Array.from({ length: n + 1 }, (_, i) => c.clone().addScaledVector(e1, Math.cos((i / n) * Math.PI * 2) * r).addScaledVector(e2, Math.sin((i / n) * Math.PI * 2) * r));

/** A zone inside a strip: `rect` in the strip's own 0..1, with the cloth's width from `widthAt` (the strip's full width at a height). */
function zone(name: ZoneName, label: string, view: Side, strip: [number, number], rect: Zone, widthAt: (v: number) => number, height: number): PrintZone {
  const span = strip[1] - strip[0];
  const z = { u0: strip[0] + rect.u0 * span, u1: strip[0] + rect.u1 * span, v0: rect.v0, v1: rect.v1 };
  return { ...z, name, label, view, width: (v) => (rect.u1 - rect.u0) * widthAt(rect.v0 + v * (rect.v1 - rect.v0)), height: (rect.v1 - rect.v0) * height };
}

const FRONT: [number, number] = [0, 0.4], BACK: [number, number] = [0.4, 0.8], LEFT: [number, number] = [0.8, 0.9], RIGHT: [number, number] = [0.9, 1];

function top(s: Shape, hoodie: boolean): Garment {
  const prints: Fabric[] = [], dyed: Fabric[] = [];
  const print = fabric();
  const f = half(s, false, FRONT), b = half(s, true, BACK);
  const l = sleeve(s, 1, LEFT), r = sleeve(s, -1, RIGHT);
  for (const g of [f.geo, b.geo, l.geo, r.geo]) prints.push(new THREE.Mesh(g, print));
  const group = new THREE.Group();
  group.add(...prints);

  // The yoke and the trims take the colour as plain material.
  const add = (m: Fabric) => { dyed.push(m); group.add(m); };
  add(new THREE.Mesh(yoke(s), fabric()));
  const collar = circle(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), 1, 40)
    .map((p) => new THREE.Vector3(p.x * s.neck, topAt(s, p.x * s.neck, p.z > 0 ? s.dipFront : s.dipBack), p.z * s.halfDepth(1) * 0.98));
  add(band(collar, new THREE.Vector3(0, 1, 0), hoodie ? 0.03 : 0.045, 1.01));
  for (const sl of [l, r]) {
    const e1 = new THREE.Vector3(0, 0, 1), e2 = new THREE.Vector3().crossVectors(sl.dir, e1).normalize();
    const cuff = circle(sl.end, e1, e2, s.sleeve.r1 * 1.02);
    add(band(cuff, sl.dir.clone().negate(), hoodie ? 0.12 : 0.035));
  }
  const hem = Array.from({ length: 65 }, (_, i) => { const p = around(s, 0, (i / 64) * Math.PI * 2 - Math.PI); return new THREE.Vector3(p.x, 0, p.y); });
  add(band(hem, new THREE.Vector3(0, 1, 0), hoodie ? 0.14 : 0.03, 1.015));

  if (hoodie) {
    // The hood lies back off the neck, open to the front; a pouch pocket across the belly; two drawcords.
    // A half shell, its open side up and to the front, laid down over the shoulders' back.
    const hood = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), fabric());
    hood.scale.set(s.neck * 2.1, 0.36, 0.13);
    hood.rotation.set(0.35, 0, 0);
    hood.position.set(0, s.height - 0.02, -s.halfDepth(1) * 0.95);
    add(hood);
    const pocket = new THREE.Shape();
    pocket.moveTo(-0.34, 0.16).lineTo(0.34, 0.16).lineTo(0.27, 0.46).lineTo(-0.27, 0.46).closePath();
    const pg = new THREE.ShapeGeometry(pocket);
    pg.translate(0, 0, s.halfDepth(0.18) + 0.012);
    add(new THREE.Mesh(pg, fabric()));
    for (const x of [-0.07, 0.07]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.26, 6), new THREE.MeshStandardMaterial({ color: "#f5f5f4", roughness: 0.8 }));
      cord.position.set(x, s.height - s.dipFront - 0.15, s.halfDepth(0.9) + 0.02);
      group.add(cord);
    }
  }

  const sleeveLen = s.sleeve.length, round = (v: number) => Math.PI * 2 * l.radiusAt(v);
  const zones = [
    zone("front", "Front", "front", FRONT, hoodie ? { u0: 0.2, u1: 0.8, v0: 0.36, v1: 0.8 } : { u0: 0.18, u1: 0.82, v0: 0.22, v1: 0.82 }, f.widthAt, s.height),
    zone("back", "Back", "back", BACK, { u0: 0.16, u1: 0.84, v0: 0.2, v1: hoodie ? 0.78 : 0.84 }, b.widthAt, s.height),
    zone("left-sleeve", "Sleeve", "angle", LEFT, { u0: 0.3, u1: 0.7, v0: hoodie ? 0.45 : 0.1, v1: 0.9 }, round, sleeveLen),
  ];
  return { group, prints, dyed, zones, target: new THREE.Vector3(0, s.height * 0.55, 0) };
}

const TEE: Shape = {
  height: 1.55, halfWidth: (t) => 0.5 + 0.04 * t, halfDepth: (t) => 0.2 * (1 - 0.35 * t ** 3),
  slope: 0.14, neck: 0.15, dipFront: 0.1, dipBack: 0.03,
  sleeve: { angle: 0.62, length: 0.42, r0: 0.21, r1: 0.17 },
};

const HOODIE: Shape = {
  height: 1.62, halfWidth: (t) => 0.55 + 0.03 * t, halfDepth: (t) => 0.25 * (1 - 0.3 * t ** 3),
  slope: 0.16, neck: 0.16, dipFront: 0.07, dipBack: 0.02,
  sleeve: { angle: 1.08, length: 1.0, r0: 0.21, r1: 0.12 },
};

export const buildTop = (m: TopModel): Garment => (m === "hoodie" ? top(HOODIE, true) : top(TEE, false));
