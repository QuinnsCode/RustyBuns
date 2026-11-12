// Shared bits for the set B sheet generators: vector helpers, the ray-cast `skin()` that puts a face part on the
// blobs' surface, mirrored blob pairs, and a writer that keeps the old sheet's id, name, about and archetype.
import { readFileSync, writeFileSync } from "node:fs";

export type V = [number, number, number];
export type N = [number, number, number, number];
export type Part = Record<string, unknown>;
export type Blob = { at: string; off: V; r: V; rot?: V };
export type Ell = { c: V; r: V };

export const APP = `${import.meta.dir}/../..`;
export const f4 = (x: number) => +x.toFixed(4);
export const add = (a: V, b: V): V => [f4(a[0] + b[0]), f4(a[1] + b[1]), f4(a[2] + b[2])];
export const sub = (a: V, b: V): V => [f4(a[0] - b[0]), f4(a[1] - b[1]), f4(a[2] - b[2])];
export const mul = (a: V, k: number): V => [f4(a[0] * k), f4(a[1] * k), f4(a[2] * k)];
export const mid = (a: V, b: V, t = 0.5): V => add(a, mul(sub(b, a), t));
export const flipZ = (a: V): V => [a[0], a[1], -a[2]];
export const norm = (a: V): V => { const n = Math.hypot(...a); return [a[0] / n, a[1] / n, a[2] / n]; };
export const p3 = (n: N): V => [n[0], n[1], n[2]];

/** Where a ray from `p` along `d` leaves the last of these ellipsoids: the skin it shows. */
export function skin(ells: Ell[], p: V, d: V): V {
  let best = 0;
  for (const { c, r } of ells) {
    const q = [0, 1, 2].map((i) => (p[i]! - c[i]!) / r[i]!), e = [0, 1, 2].map((i) => d[i]! / r[i]!);
    const a = e.reduce((s, x) => s + x * x, 0), b = q.reduce((s, x, i) => s + x * e[i]!, 0), cc = q.reduce((s, x) => s + x * x, 0) - 1;
    const disc = b * b - a * cc;
    if (disc >= 0) best = Math.max(best, (-b + Math.sqrt(disc)) / a);
  }
  return [f4(p[0] + d[0] * best), f4(p[1] + d[1] * best), f4(p[2] + d[2] * best)];
}

/** A point on the skin of these ellipsoids (offsets from the head node), cast from `p` along `d`, sunk `sink` back in. */
export const onSkin = (ells: Ell[]) => (p: V, d: V, sink = 0): V => {
  const s = skin(ells, p, d), n = norm(d);
  return [f4(s[0] - n[0] * sink), f4(s[1] - n[1] * sink), f4(s[2] - n[2] * sink)];
};

/** Both sides of a blob on an `l_` node. */
export const pair = (at: string, off: V, r: V, rot?: V): Blob[] => [
  { at, off, r, ...(rot ? { rot } : {}) },
  { at: at.replace(/^l_/, "r_"), off: flipZ(off), r, ...(rot ? { rot: [-rot[0], -rot[1], rot[2]] as V } : {}) },
];

/** A blob along a bone: centred `t` of the way from node a to node b, as an offset from a. */
export const along = (nodes: Record<string, N>, a: string, b: string, t = 0.5): V => mul(sub(p3(nodes[b]!), p3(nodes[a]!)), t);

export const chain = (names: string[]) => names.slice(1).map((n, i) => [names[i]!, n]);

/** Write beasts/<id>.json from the old one's identity plus these fields (or to `out` for a candidate). */
export function write(id: string, fields: Record<string, unknown>, out?: string) {
  const path = `${APP}/beasts/${id}.json`;
  const old = JSON.parse(readFileSync(path, "utf8"));
  const sheet = { id: old.id, name: old.name, about: old.about, archetype: old.archetype, ...fields };
  writeFileSync(out ?? path, JSON.stringify(sheet, null, 2) + "\n");
  console.log(`wrote ${out ?? path}`);
}
