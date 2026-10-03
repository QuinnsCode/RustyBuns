// Built-in models made of overlapping capsules: no assets to download, and
// the tests know where every tip is. Y up, meters, like glTF.

export interface Mesh { positions: Float32Array; indices: Uint32Array }

type V3 = [number, number, number];
interface Capsule { a: V3; b: V3; r: number }

/** A capsule from a to b: a tube with a hemisphere on each end. */
function capsule({ a, b, r }: Capsule, seg = 16, rings = 6): { p: number[]; i: number[] } {
  const d: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d);
  const w: V3 = len > 1e-9 ? [d[0] / len, d[1] / len, d[2] / len] : [0, 1, 0];
  // any two unit vectors perpendicular to w
  const t: V3 = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(t, w)), v = cross(w, u);
  const p: number[] = [], i: number[] = [];
  // rows from the a pole to the b pole: (center, offset along w, ring radius)
  const rows: [V3, number, number][] = [];
  for (let k = 0; k <= rings; k++) {
    const phi = (Math.PI / 2) * (k / rings); // 0 at the a pole
    rows.push([a, -r * Math.cos(phi), r * Math.sin(phi)]);
  }
  for (let k = 0; k <= rings; k++) {
    const phi = (Math.PI / 2) * (k / rings);
    rows.push([b, r * Math.sin(phi), r * Math.cos(phi)]);
  }
  for (const [c, off, rr] of rows) {
    for (let s = 0; s < seg; s++) {
      const th = (2 * Math.PI * s) / seg;
      const cu = Math.cos(th) * rr, sv = Math.sin(th) * rr;
      p.push(c[0] + w[0] * off + u[0] * cu + v[0] * sv, c[1] + w[1] * off + u[1] * cu + v[1] * sv, c[2] + w[2] * off + u[2] * cu + v[2] * sv);
    }
  }
  for (let r0 = 0; r0 < rows.length - 1; r0++) {
    for (let s = 0; s < seg; s++) {
      const q = r0 * seg + s, q1 = r0 * seg + ((s + 1) % seg);
      i.push(q, q1, q + seg, q1, q1 + seg, q + seg);
    }
  }
  return { p, i };
}

function merge(parts: Capsule[]): Mesh {
  const p: number[] = [], i: number[] = [];
  for (const c of parts) {
    const m = capsule(c);
    const base = p.length / 3;
    p.push(...m.p);
    for (const x of m.i) i.push(x + base);
  }
  return { positions: new Float32Array(p), indices: new Uint32Array(i) };
}

const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };

/** T-posed, 1.75 m. Tips: head, both hands, both feet. */
export const GINGERBREAD_TIPS: V3[] = [[0, 1.72, 0], [-0.86, 1.36, 0], [0.86, 1.36, 0], [-0.13, 0.04, 0.02], [0.13, 0.04, 0.02]];
export function gingerbread(): Mesh {
  return merge([
    { a: [0, 0.92, 0], b: [0, 1.32, 0], r: 0.17 },          // torso
    { a: [0, 1.4, 0], b: [0, 1.6, 0], r: 0.12 },            // neck and head
    { a: [-0.18, 1.36, 0], b: [-0.8, 1.36, 0], r: 0.055 },  // arms
    { a: [0.18, 1.36, 0], b: [0.8, 1.36, 0], r: 0.055 },
    { a: [-0.1, 0.9, 0], b: [-0.13, 0.1, 0], r: 0.07 },     // legs
    { a: [0.1, 0.9, 0], b: [0.13, 0.1, 0], r: 0.07 },
    { a: [-0.13, 0.06, 0], b: [-0.13, 0.05, 0.1], r: 0.05 }, // feet
    { a: [0.13, 0.06, 0], b: [0.13, 0.05, 0.1], r: 0.05 },
  ]);
}

/** Four legs, a long tail, a head. Tips: head, tail, four feet. */
export const LIZARD_TIPS: V3[] = [[0.75, 0.3, 0], [-1.3, 0.12, 0], [0.32, 0.02, 0.28], [0.32, 0.02, -0.28], [-0.32, 0.02, 0.28], [-0.32, 0.02, -0.28]];
export function lizard(): Mesh {
  return merge([
    { a: [-0.4, 0.3, 0], b: [0.4, 0.3, 0], r: 0.14 },        // body
    { a: [0.45, 0.32, 0], b: [0.7, 0.3, 0], r: 0.08 },       // head
    { a: [-0.45, 0.28, 0], b: [-0.85, 0.2, 0], r: 0.07 },    // tail, tapering
    { a: [-0.85, 0.2, 0], b: [-1.27, 0.12, 0], r: 0.035 },
    { a: [0.32, 0.25, 0.1], b: [0.32, 0.25, 0.22], r: 0.045 }, // legs: out, then down
    { a: [0.32, 0.25, 0.22], b: [0.32, 0.04, 0.28], r: 0.04 },
    { a: [0.32, 0.25, -0.1], b: [0.32, 0.25, -0.22], r: 0.045 },
    { a: [0.32, 0.25, -0.22], b: [0.32, 0.04, -0.28], r: 0.04 },
    { a: [-0.32, 0.25, 0.1], b: [-0.32, 0.25, 0.22], r: 0.045 },
    { a: [-0.32, 0.25, 0.22], b: [-0.32, 0.04, 0.28], r: 0.04 },
    { a: [-0.32, 0.25, -0.1], b: [-0.32, 0.25, -0.22], r: 0.045 },
    { a: [-0.32, 0.25, -0.22], b: [-0.32, 0.04, -0.28], r: 0.04 },
  ]);
}
