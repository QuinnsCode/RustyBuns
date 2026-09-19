// A tiny kit for building splat scenes out of shapes. Every level is a list of
// shapes, sampled into gaussians: enough to be recognizable once painted, and
// cheap enough that 20 levels cost nothing to ship.
import * as THREE from "three";

export interface Emitter {
  /** density: splats per square unit of surface */
  density: number;
  /** `normal` is which way the surface faces; the builder bakes light from it. */
  at(p: THREE.Vector3, color: THREE.Color, size: number, normal?: THREE.Vector3): void;
  rand(): number;
  /** Start tagging splats as part of a named object; returns its id. */
  object(name: string, aliases?: string[], origin?: THREE.Vector3): number;
}

export type Paint = THREE.Color | ((p: THREE.Vector3) => THREE.Color);
const colorAt = (paint: Paint, p: THREE.Vector3) => (paint instanceof THREE.Color ? paint : paint(p));

/** Deterministic, so a level looks the same for everyone. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const v = new THREE.Vector3();
const nrm = new THREE.Vector3();

export function ellipsoid(e: Emitter, center: THREE.Vector3, radii: THREE.Vector3, paint: Paint, size = 0.022, opts: { top?: number; bottom?: number } = {}) {
  const area = 4 * Math.PI * ((radii.x * radii.y + radii.y * radii.z + radii.z * radii.x) / 3);
  const n = Math.max(200, Math.round(area * e.density));
  for (let i = 0; i < n; i++) {
    const u = (opts.bottom ?? -1) + e.rand() * ((opts.top ?? 1) - (opts.bottom ?? -1));
    const t = e.rand() * Math.PI * 2, s = Math.sqrt(Math.max(0, 1 - u * u));
    v.set(center.x + radii.x * s * Math.cos(t), center.y + radii.y * u, center.z + radii.z * s * Math.sin(t));
    // gradient of (x/rx)^2 + (y/ry)^2 + (z/rz)^2: the true surface normal
    nrm.set((v.x - center.x) / (radii.x * radii.x), (v.y - center.y) / (radii.y * radii.y), (v.z - center.z) / (radii.z * radii.z)).normalize();
    e.at(v, colorAt(paint, v), size, nrm);
  }
}

export const sphere = (e: Emitter, center: THREE.Vector3, r: number, paint: Paint, size?: number) =>
  ellipsoid(e, center, new THREE.Vector3(r, r, r), paint, size);

/** Filled box surface (all six faces). */
export function box(e: Emitter, center: THREE.Vector3, size3: THREE.Vector3, paint: Paint, size = 0.022) {
  const [x, y, z] = [size3.x, size3.y, size3.z];
  const faces: [number, number, number][] = [[x, y, 0], [x, 0, z], [0, y, z]];
  const area = 2 * (x * y + y * z + z * x);
  const n = Math.max(200, Math.round(area * e.density));
  for (let i = 0; i < n; i++) {
    const pick = e.rand() * area;
    const f = pick < 2 * x * y ? 0 : pick < 2 * (x * y + x * z) ? 1 : 2;
    const [fx, fy, fz] = faces[f]!;
    const sign = e.rand() < 0.5 ? -0.5 : 0.5;
    v.set(
      center.x + (fx ? (e.rand() - 0.5) * x : sign * x),
      center.y + (fy ? (e.rand() - 0.5) * y : sign * y),
      center.z + (fz ? (e.rand() - 0.5) * z : sign * z),
    );
    nrm.set(fx ? 0 : Math.sign(sign), fy ? 0 : Math.sign(sign), fz ? 0 : Math.sign(sign));
    if (f === 0) nrm.set(0, 0, Math.sign(sign));
    else if (f === 1) nrm.set(0, Math.sign(sign), 0);
    else nrm.set(Math.sign(sign), 0, 0);
    e.at(v, colorAt(paint, v), size, nrm);
  }
}

/** Cylinder along an axis: "y" by default. Set r2 for a cone or a tapered trunk. */
export function cylinder(e: Emitter, from: THREE.Vector3, height: number, r: number, paint: Paint, opts: { r2?: number; axis?: "x" | "y" | "z"; size?: number; caps?: boolean } = {}) {
  const r2 = opts.r2 ?? r, axis = opts.axis ?? "y", size = opts.size ?? 0.022;
  const slant = Math.hypot(height, r - r2);
  const area = Math.PI * (r + r2) * slant + (opts.caps ? Math.PI * (r * r + r2 * r2) : 0);
  const n = Math.max(200, Math.round(area * e.density));
  for (let i = 0; i < n; i++) {
    const along = e.rand();
    const rr = r + (r2 - r) * along;
    const cap = opts.caps && e.rand() < 0.15;
    const rad = cap ? Math.sqrt(e.rand()) * rr : rr;
    const t = e.rand() * Math.PI * 2;
    const h = cap ? (e.rand() < 0.5 ? 0 : height) : along * height;
    const a = rad * Math.cos(t), b = rad * Math.sin(t);
    const along0 = cap ? (h === 0 ? -1 : 1) : 0;
    if (axis === "y") { v.set(from.x + a, from.y + h, from.z + b); nrm.set(cap ? 0 : a, along0, cap ? 0 : b); }
    else if (axis === "x") { v.set(from.x + h, from.y + a, from.z + b); nrm.set(along0, cap ? 0 : a, cap ? 0 : b); }
    else { v.set(from.x + a, from.y + b, from.z + h); nrm.set(cap ? 0 : a, cap ? 0 : b, along0); }
    if (nrm.lengthSq() < 1e-9) nrm.set(0, 1, 0);
    e.at(v, colorAt(paint, v), size, nrm.normalize());
  }
}

export const cone = (e: Emitter, base: THREE.Vector3, height: number, r: number, paint: Paint, opts: { axis?: "x" | "y" | "z"; size?: number } = {}) =>
  cylinder(e, base, height, r, paint, { ...opts, r2: 0.001 });

/** Ring of revolution: wheels, scarves, donuts, handles. */
export function torus(e: Emitter, center: THREE.Vector3, ring: number, tube: number, paint: Paint, opts: { plane?: "xy" | "xz" | "yz"; size?: number } = {}) {
  const plane = opts.plane ?? "xz", size = opts.size ?? 0.02;
  const area = 4 * Math.PI * Math.PI * ring * tube;
  const n = Math.max(200, Math.round(area * e.density));
  for (let i = 0; i < n; i++) {
    const t = e.rand() * Math.PI * 2, a = e.rand() * Math.PI * 2;
    const rr = ring + tube * Math.cos(a), h = tube * Math.sin(a);
    const x = rr * Math.cos(t), y = rr * Math.sin(t);
    const nx = Math.cos(a) * Math.cos(t), ny = Math.cos(a) * Math.sin(t), nh = Math.sin(a);
    if (plane === "xz") { v.set(center.x + x, center.y + h, center.z + y); nrm.set(nx, nh, ny); }
    else if (plane === "xy") { v.set(center.x + x, center.y + y, center.z + h); nrm.set(nx, ny, nh); }
    else { v.set(center.x + h, center.y + x, center.z + y); nrm.set(nh, nx, ny); }
    e.at(v, colorAt(paint, v), size, nrm.normalize());
  }
}

/** Flat ground or a tabletop. */
export function disc(e: Emitter, center: THREE.Vector3, r: number, paint: Paint, size = 0.035) {
  const n = Math.max(400, Math.round(Math.PI * r * r * e.density));
  for (let i = 0; i < n; i++) {
    const rad = Math.sqrt(e.rand()) * r, t = e.rand() * Math.PI * 2;
    v.set(center.x + rad * Math.cos(t), center.y + (e.rand() - 0.5) * 0.015, center.z + rad * Math.sin(t));
    e.at(v, colorAt(paint, v), size, nrm.set(0, 1, 0));
  }
}

/** A wall or backdrop, so scenes have something behind them to occlude. */
export function wall(e: Emitter, center: THREE.Vector3, width: number, height: number, paint: Paint, size = 0.03) {
  const n = Math.max(400, Math.round(width * height * e.density));
  for (let i = 0; i < n; i++) {
    v.set(center.x + (e.rand() - 0.5) * width, center.y + e.rand() * height, center.z + (e.rand() - 0.5) * 0.25);
    e.at(v, colorAt(paint, v), size, nrm.set(0, 0, 1));
  }
}

export const shade = (c: THREE.Color, amount: number, rand: () => number) => c.clone().offsetHSL(0, 0, (rand() - 0.5) * amount);
