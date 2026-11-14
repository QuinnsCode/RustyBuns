// Required Notice: Copyright (c) 2026 Ryan Quinn (QNTBR) (https://qntbr.com). PolyForm Noncommercial 1.0.0, see ../../LICENSE.
//
// The hats, made here in code rather than downloaded: no model file to fetch, license or cache, and a few
// kilobytes of script draws all three. Each is lathes (a profile spun round the hat's axis) plus a visor for the cap.
// A lathe's UVs are the print map: u goes once round the hat (0.5 is the front, facing +z), v climbs the profile
// by arc length, so a picture placed in UV space sits on the fabric without stretching up the crown.
import * as THREE from "three";
import type { HatModel } from "../api.ts";
import type { PrintZone, Zone } from "./print.ts";

type Fabric = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;

/** A product made in code: a hat or a top. */
export type Garment = {
  group: THREE.Group;
  /** The meshes a picture is printed on; their material's map is the one print canvas, each in its own UV rect. */
  prints: Fabric[];
  /** Meshes that take the product's colour (the print meshes take it through their canvas). */
  dyed: Fabric[];
  /** Where pictures may go, the first one where a new picture starts. */
  zones: PrintZone[];
  /** Where the camera looks. */
  target: THREE.Vector3;
  /** A top on a hanger: one frame of its cloth settling (false once it hangs still), and hanging it again. */
  tick?: () => boolean;
  restart?: () => void;
};

/** A hat's one zone, the front of its crown: as wide as that stretch of lathe is round, as tall as its profile is long. */
const front = (zone: Zone, radiusAt: (v: number) => number, profileLength: number): PrintZone[] => [{
  ...zone, name: "front", label: "Front", view: "front",
  width: (v) => (zone.u1 - zone.u0) * Math.PI * 2 * radiusAt(zone.v0 + v * (zone.v1 - zone.v0)),
  height: (zone.v1 - zone.v0) * profileLength,
}];

type P = [r: number, y: number];

/** `pts` resampled to `n` points evenly spaced along the curve, so lathe v is arc length. */
function resample(pts: P[], n: number): THREE.Vector2[] {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i]![0], p[1] - pts[i]![1]));
  const total = seg.reduce((a, b) => a + b, 0);
  const out: THREE.Vector2[] = [];
  for (let k = 0, i = 0, acc = 0; k < n; k++) {
    const d = (k / (n - 1)) * total;
    while (i < seg.length - 1 && acc + seg[i]! < d) acc += seg[i++]!;
    const t = seg[i]! ? Math.min(1, (d - acc) / seg[i]!) : 0;
    const a = pts[i]!, b = pts[i + 1]!;
    out.push(new THREE.Vector2(Math.max(1e-4, a[0] + (b[0] - a[0]) * t), a[1] + (b[1] - a[1]) * t));
  }
  return out;
}

const curveLength = (v: THREE.Vector2[]) => v.slice(1).reduce((s, p, i) => s + p.distanceTo(v[i]!), 0);

/** A lathe whose u = 0.5 faces +z (the front). */
const lathe = (profile: THREE.Vector2[], segments = 96) => new THREE.LatheGeometry(profile, segments, -Math.PI, Math.PI * 2);

export const fabric = (color = "#ffffff") => new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });

function crownFrom(profile: THREE.Vector2[]) {
  const print = new THREE.Mesh(lathe(profile), fabric());
  const radiusAt = (v: number) => profile[Math.round(THREE.MathUtils.clamp(v, 0, 1) * (profile.length - 1))]!.x;
  return { print, radiusAt, profileLength: curveLength(profile) };
}

/** Six panel seams down a dome, as thin dark lines just above the fabric. */
function seams(profile: THREE.Vector2[], count: number): THREE.LineSegments {
  const pos: number[] = [];
  for (let s = 0; s < count; s++) {
    const a = (s / count) * Math.PI * 2 + Math.PI / count;
    for (let i = 0; i < profile.length - 1; i++) {
      for (const p of [profile[i]!, profile[i + 1]!]) pos.push(Math.sin(a) * p.x * 1.004, p.y, Math.cos(a) * p.x * 1.004);
    }
  }
  const g = new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 }));
}

/** A six-panel cap: a soft dome, a curved visor and a button on top. */
function cap(): Garment {
  const dome: P[] = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * (Math.PI / 2);
    dome.push([Math.pow(Math.cos(a), 0.8), 0.95 * Math.pow(Math.sin(a), 0.9)]);
  }
  const profile = resample(dome, 48);
  const { print, radiusAt, profileLength } = crownFrom(profile);

  // The visor: a band from the crown's rim out to a rounded front edge, curving down at the sides.
  const visorGeo = new THREE.BufferGeometry();
  const pos: number[] = [], idx: number[] = [], cols = 48, max = THREE.MathUtils.degToRad(68);
  for (let i = 0; i <= cols; i++) {
    const t = (i / cols) * 2 - 1, th = t * max;
    const reach = 0.85 * Math.pow(Math.cos((t * Math.PI) / 2), 0.5);
    for (const [r, out] of [[0.995, 0], [0.995 + reach, 1]] as const) {
      // Out at the edge the bill tips down a little and curls down harder at its sides: a pre-curved bill.
      const x = Math.sin(th) * r * (out ? 0.9 : 1), z = Math.cos(th) * r;
      const drop = out ? -0.08 - 0.16 * Math.pow(Math.abs(t), 1.6) : 0;
      pos.push(x, 0.04 + drop, z);
    }
    if (i < cols) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  visorGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  visorGeo.setIndex(idx);
  visorGeo.computeVertexNormals();
  const visor = new THREE.Mesh(visorGeo, fabric());
  const button = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 8), fabric());
  button.position.y = 0.955;
  button.scale.y = 0.55;

  const group = new THREE.Group();
  group.add(print, visor, button, seams(profile, 6));
  return { group, prints: [print], dyed: [visor, button], zones: front({ u0: 0.4, u1: 0.6, v0: 0.06, v1: 0.62 }, radiusAt, profileLength), target: new THREE.Vector3(0, 0.4, 0.15) };
}

/** A cuffed beanie with a pom: the picture goes on the cuff, where a patch would be stitched. */
function beanie(): Garment {
  const dome: P[] = [[0.93, 0.36]];
  for (let i = 1; i <= 24; i++) {
    const a = (i / 24) * (Math.PI / 2);
    dome.push([0.93 * Math.pow(Math.cos(a), 0.7), 0.36 + 0.9 * Math.sin(a)]);
  }
  const body = new THREE.Mesh(lathe(resample(dome, 40)), fabric());
  const cuffProfile = resample([[0.955, 0], [0.985, 0.02], [0.99, 0.2], [0.985, 0.38], [0.94, 0.41]], 24);
  const { print, radiusAt, profileLength } = crownFrom(cuffProfile);
  const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 2), fabric());
  pom.position.y = 1.32;
  const group = new THREE.Group();
  group.add(body, print, pom);
  return { group, prints: [print], dyed: [body, pom], zones: front({ u0: 0.42, u1: 0.58, v0: 0.12, v1: 0.85 }, radiusAt, profileLength), target: new THREE.Vector3(0, 0.55, 0) };
}

/** A bucket hat: a tapered crown with a flat top and an all-round sloping brim. */
function bucket(): Garment {
  const profile = resample([[0.92, 0], [0.86, 0.45], [0.8, 0.72], [0.74, 0.76], [0.4, 0.78], [0, 0.78]], 48);
  const { print, radiusAt, profileLength } = crownFrom(profile);
  const brim = new THREE.Mesh(lathe(resample([[0.92, 0.01], [1.2, -0.12], [1.45, -0.27]], 12)), fabric());
  const group = new THREE.Group();
  group.add(print, brim, seams(profile.slice(0, 30), 4));
  const side = profile.findIndex((p) => p.y > 0.7) / (profile.length - 1);
  return { group, prints: [print], dyed: [brim], zones: front({ u0: 0.4, u1: 0.6, v0: 0.04, v1: side }, radiusAt, profileLength), target: new THREE.Vector3(0, 0.3, 0) };
}

export const buildHat = (m: HatModel): Garment => (m === "beanie" ? beanie() : m === "bucket" ? bucket() : cap());
