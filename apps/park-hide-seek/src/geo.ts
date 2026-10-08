// Plane geometry in kilometres. Parks are stored already projected: x east,
// y north, origin at the park's centre (see scripts/fetch-parks.ts).

export type Pt = [number, number];

const KM_PER_DEG_LAT = 111.32;

/** Equirectangular around (lon0, lat0): good to well under 1% across a park. */
export function project(lon: number, lat: number, lon0: number, lat0: number): Pt {
  return [(lon - lon0) * KM_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * KM_PER_DEG_LAT];
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Distance from p to segment ab. */
export function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function lineDist(px: number, py: number, line: Pt[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) best = Math.min(best, segDist(px, py, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
  return line.length === 1 ? dist(px, py, line[0][0], line[0][1]) : best;
}

/** Even-odd test against one closed ring (first point need not repeat). */
export function inRing(x: number, y: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inRings(x: number, y: number, rings: Pt[][]): boolean {
  for (const r of rings) if (inRing(x, y, r)) return true;
  return false;
}

/** Shoelace area, always positive. */
export function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  return Math.abs(a) / 2;
}

export function ringCentroid(ring: Pt[]): Pt {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

/** Douglas-Peucker. Keeps the endpoints. */
export function simplify(line: Pt[], tol: number): Pt[] {
  if (line.length < 3) return line.slice();
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist(line[i][0], line[i][1], line[a][0], line[a][1], line[b][0], line[b][1]);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return line.filter((_, i) => keep[i]);
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function bounds(rings: Pt[][]): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of rings) for (const [x, y] of r) {
    if (x < b.minX) b.minX = x; if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y; if (y > b.maxY) b.maxY = y;
  }
  return b;
}

/** A round number near v for labels: 1, 2, 2.5 or 5 times a power of ten. */
export function niceKm(v: number): number {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m < 1.5 ? 1 : m < 2.25 ? 2 : m < 3.5 ? 2.5 : m < 7.5 ? 5 : 10) * p;
}

/** Seeded PRNG (mulberry32), so bots and terrain repeat for a seed. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
