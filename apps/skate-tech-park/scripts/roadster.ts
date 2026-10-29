// The rocket roadster's body, built in code and written out at a few polygon budgets.
//
//   bun scripts/roadster.ts
//
// Writes public/models/roadster-{hi,mid,low}.glb. It follows the October 2026 reveal, not the 2017 prototype: sharp and
// angular in the electric pickup's way, flat facets meeting at hard creases, a chine down each flank like a spy plane's,
// Ano White paint over a dark sill, gold-tinted visor glass for the canopy, dual triangular headlights, a plain light bar
// across the tail over a diffuser that holds the four rear nozzles, and the pop-out wing standing up on its struts. It
// keeps the shared footprint (about 4.7 m by 2.1 m, wheels of 0.42 m radius at x = +-1.0, z = 1.4 and -1.45), so the page
// drops it over the shared roadster (packages/models) and keeps that one's nozzle bells and hinged plate, which the
// plumes and the swap animate. Nose toward +z, in the game's frame. Budgets differ in how round the wheels are; the
// body's facets are the same at each. The wheel arches are built into the body's sections (the sill rises over each
// wheel), not cut with a Boolean.
import * as THREE from "three";
import { R, along, box, loft, part as gather, triangles, type Palette, type Piece } from "@rustybuns/models";
import { toGlb } from "@rustybuns/models/glb";

const BUDGETS = { hi: 40, mid: 20, low: 12 } as const; // segments round a wheel
const c = (hex: string, rough: number, metal = 0, glow?: number): [string, number, number, number?] => [hex, rough, metal, glow];
const PALETTE: Palette = {
  paint: c("#EDF0EB", 0.3, 0.15), ink: c("#1B1C1F", 0.8), glass: c("#805C1A", 0.12, 0.9), tyre: c("#111111", 0.9),
  rim: c("#4A4D52", 0.35, 0.7), ring: c("#ED611A", 0.4), headlight: c("#FFFFFF", 0.2, 0, 4), taillight: c("#FF2A2A", 0.2, 0, 4),
};
const WHEELS = [[-1.0, 1.4], [1.0, 1.4], [-1.0, -1.45], [1.0, -1.45]] as const;
const WHEEL_R = 0.42, ARCH_R = 0.47;

// Cross-sections nose to tail: [along, sill y, flank half width, chine y, shoulder half width, shoulder y, roof half
// width, roof y]. The roof line runs straight up the windscreen to its peak behind the doors and straight down to the
// tail, one fold, the way the reveal car's does.
type Station = number[];
const STATIONS: Station[] = [
  [2.42, 0.32, 0.78, 0.48, 0.66, 0.56, 0.36, 0.58],
  [2.3, 0.3, 0.92, 0.52, 0.8, 0.63, 0.44, 0.66],
  [1.85, 0.3, 1.02, 0.66, 0.88, 0.9, 0.5, 0.86],
  [1.4, 0.3, 1.05, 0.7, 0.89, 0.94, 0.5, 0.89],
  [0.85, 0.3, 1.06, 0.72, 0.87, 0.93, 0.5, 0.92],
  [-0.25, 0.3, 1.06, 0.74, 0.8, 0.93, 0.42, 1.24],
  [-1.45, 0.3, 1.06, 0.76, 0.88, 0.96, 0.5, 1.05],
  [-2.15, 0.3, 1.05, 0.78, 0.9, 0.97, 0.56, 1.0],
  [-2.27, 0.32, 1.0, 0.76, 0.86, 0.94, 0.54, 0.97],
];
const CANOPY = [-1.45, 0.85]; // the stretch of roof and side glass that is the gold visor

/** The section at `z`, blended between its neighbours. */
function at(z: number): Station {
  for (let i = 0; i + 1 < STATIONS.length; i++) {
    const [a, b] = [STATIONS[i], STATIONS[i + 1]];
    if (z <= a[0] && z >= b[0]) { const t = (a[0] - z) / (a[0] - b[0]); return a.map((v, k) => v + (b[k] - v) * t); }
  }
  return STATIONS[0];
}

/** One cross-section, left to right: sill, rocker, chine, shoulder and roof on each side. */
function section([, sill, flank, chine, shoulder, shY, roof, roofY]: Station, z: number): [number, number][] {
  // over a wheel the underside rises into an arch round it
  const lift = (y: number) => Math.max(y, ...WHEELS.filter(([, wz]) => Math.abs(z - wz) < ARCH_R).map(([, wz]) => WHEEL_R + Math.sqrt(ARCH_R ** 2 - (z - wz) ** 2)));
  const half: [number, number][] = [[flank - 0.1, lift(sill)], [flank - 0.04, lift(0.44)], [flank, lift(chine)], [shoulder, shY], [roof, roofY]];
  return [...half.map(([x, y]): [number, number] => [-x, y]), ...[...half].reverse()];
}

/** The slot of each band round a section; the canopy bands turn to glass between CANOPY's ends. */
const BANDS = ["ink", "paint", "paint", "upper", "roof", "upper", "paint", "paint", "ink"];

function body(): Piece[] {
  // the given stations plus a few more round each wheel, so the arch has a curve
  const zs = new Set(STATIONS.map((s) => s[0]));
  for (const [, wz] of WHEELS) for (const d of [-0.5, -0.45, -0.35, -0.2, 0, 0.2, 0.35, 0.45, 0.5]) zs.add(+(wz + d).toFixed(3));
  const rings = [...zs].sort((a, b) => b - a).map((z) => ({ z, pts: section(at(z), z) }));
  const slots: Record<string, number[]> = { paint: [], ink: [], glass: [] };
  const n = rings[0].pts.length;
  const push = (slot: string, ...p: THREE.Vector3[]) => slots[slot].push(...p.flatMap((v) => v.toArray()));
  const v = (r: (typeof rings)[number], k: number) => new THREE.Vector3(r.pts[k % n][0], r.pts[k % n][1], r.z);
  const quads: [string, THREE.Vector3[]][] = [];
  rings.slice(1).forEach((b, i) => {
    const a = rings[i], canopy = CANOPY[0] <= (a.z + b.z) / 2 && (a.z + b.z) / 2 <= CANOPY[1];
    for (let k = 0; k < n; k++) {
      const band = k < BANDS.length ? BANDS[k] : "ink"; // the last band closes the floor
      const lined = band === "paint" && WHEELS.some(([, wz]) => Math.abs(a.z - wz) < ARCH_R && Math.abs(b.z - wz) < ARCH_R); // inside an arch
      quads.push([band === "ink" || lined ? "ink" : band === "paint" || !canopy ? "paint" : "glass", [v(a, k), v(b, k), v(b, k + 1), v(a, k + 1)]]);
    }
  });
  // faces of zero width (a band flattened by an arch) are dropped
  const area = (q: THREE.Vector3[]) => new THREE.Vector3().subVectors(q[1], q[0]).cross(new THREE.Vector3().subVectors(q[3], q[0])).length() + new THREE.Vector3().subVectors(q[1], q[2]).cross(new THREE.Vector3().subVectors(q[3], q[2])).length();
  for (const [slot, q] of quads) if (area(q) > 1e-6) push(slot, q[0], q[1], q[2], q[0], q[2], q[3]);
  const first = rings[0], last = rings[rings.length - 1];
  const cap = (r: (typeof rings)[number], flip: boolean) => { for (let k = 1; k + 1 < n; k++) push("paint", ...(flip ? [v(r, 0), v(r, k + 1), v(r, k)] : [v(r, 0), v(r, k), v(r, k + 1)])); };
  cap(first, false); cap(last, true);
  // face outwards whichever way the rings run
  let vol = 0;
  for (const s of Object.values(slots)) for (let i = 0; i < s.length; i += 9) { const [a, b, c] = [0, 3, 6].map((o) => new THREE.Vector3(s[i + o], s[i + o + 1], s[i + o + 2])); vol += a.dot(b.clone().cross(c)) / 6; }
  const out: Piece[] = [];
  for (const [slot, s] of Object.entries(slots)) {
    if (!s.length) continue;
    if (vol < 0) for (let i = 0; i < s.length; i += 9) for (let k = 0; k < 3; k++) [s[i + 3 + k], s[i + 6 + k]] = [s[i + 6 + k], s[i + 3 + k]];
    const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(s, 3));
    geo.computeVertexNormals();
    out.push({ geo, slot });
  }
  return out;
}

/** A tyre, a flush dark aero cover with a spoke so it shows turning, and a thin orange ring on its face. */
function wheel(x: number, z: number, around: number): Piece[] {
  const side = x > 0 ? 1 : -1, cyl = (slot: string, r: number, len: number, dx = 0) =>
    loft(slot, [R(-len / 2, r), R(len / 2, r)], { seg: around, m: along("x", [x + dx, WHEEL_R, z]) });
  return [cyl("tyre", WHEEL_R, 0.34), cyl("rim", 0.3, 0.36), box("ink", [0.36, 0.05, 0.56], [x, WHEEL_R, z]), cyl("ring", 0.33, 0.012, side * 0.172)];
}

/** The pop-out wing, up: two struts off the rear deck, a blade tipped a little nose-down, and end plates. */
const wing = (): Piece[] => [
  ...[-0.5, 0.5].map((x) => box("ink", [0.05, 0.34, 0.14], [x, 1.12, -1.95])),
  box("paint", [1.96, 0.04, 0.42], [0, 1.3, -1.98], { rot: [(-6 * Math.PI) / 180, 0, 0] }),
  ...[-0.99, 0.99].map((x) => box("paint", [0.03, 0.2, 0.46], [x, 1.24, -1.98])),
];

/** A flat triangle in x, y, standing proud of the nose. */
function headlight(s: number): Piece {
  const pts = [[s * 0.72, 0.47], [s * 0.3, 0.55], [s * 0.62, 0.56]], [z0, z1] = [2.44, 2.41];
  const f = pts.map(([x, y]) => [x, y, z0]), b = pts.map(([x, y]) => [x, y, z1]);
  const tris = [[f[0], f[1], f[2]], [b[0], b[2], b[1]], ...[0, 1, 2].flatMap((k) => { const j = (k + 1) % 3; return [[f[k], b[k], b[j]], [f[k], b[j], f[j]]]; })];
  const geo = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(tris.flat(2), 3));
  geo.computeVertexNormals();
  // wound to face out: flip if the front triangle faces back
  const n = new THREE.Vector3().subVectors(new THREE.Vector3(...f[1]), new THREE.Vector3(...f[0])).cross(new THREE.Vector3().subVectors(new THREE.Vector3(...f[2]), new THREE.Vector3(...f[0])));
  if (n.z < 0) { const p = geo.attributes.position; for (let i = 0; i < p.count; i += 3) { const [x, y, z] = [p.getX(i + 1), p.getY(i + 1), p.getZ(i + 1)]; p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2)); p.setXYZ(i + 2, x, y, z); } geo.computeVertexNormals(); }
  return { geo, slot: "headlight" };
}

export async function model(budget: keyof typeof BUDGETS) {
  const around = BUDGETS[budget];
  const pieces = [...body(), headlight(-1), headlight(1),
    box("taillight", [1.9, 0.05, 0.03], [0, 0.9, -2.285]), // the plain bar across the tail
    box("ink", [1.8, 0.36, 0.06], [0, 0.48, -2.27]), // the four rear nozzles sit in it
    ...[-1, 1].map((s) => box("ink", [0.02, 0.16, 0.5], [s * 1.065, 0.6, -0.85])), // intakes behind the doors
    ...wing(), ...WHEELS.flatMap(([x, z]) => wheel(x, z, around))];
  const g = gather("roadster", pieces, PALETTE);
  const scene = new THREE.Scene();
  scene.add(g);
  return { glb: await toGlb(scene), tris: triangles(g) };
}

if (import.meta.main) {
  for (const budget of Object.keys(BUDGETS) as (keyof typeof BUDGETS)[]) {
    const { glb, tris } = await model(budget);
    await Bun.write(new URL(`../public/models/roadster-${budget}.glb`, import.meta.url), glb);
    console.log(`${budget}: ${tris} triangles -> public/models/roadster-${budget}.glb (${Math.round(glb.byteLength / 1024)} KB)`);
  }
}
