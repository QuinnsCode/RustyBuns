// The Pine Barrens' landmarks of pines.ts drawn: Batsto's stucco mansion and its tower, the ironstone gristmill, the
// sawmill and a row of weathered cedar cottages by a tea-brown lake; the galvanised fire tower with its glass cab on
// Apple Pie Hill; the cranberry bogs, flooded red or still in bronze vines, each behind a sandy dyke with a sluice
// gate; and tea-coloured puddles in the sand road. Every part is one merged, vertex-coloured mesh built once (about
// thirty draw calls, only near one of them), stood on the drawn ground every half second while you are in range.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mulberry32 } from "@rustybuns/util";
import { PUDDLES, SIGHTS, type Part, type PartKind } from "./pines.ts";

const SEEN_R = 1500, TOWER_SEEN_R = 2600, PUDDLE_R = 240, PUDDLE_CAP = 96;
const STUCCO = 0xf0e6cc, ROOF = 0x55585a, SHUTTER = 0x2f4a36, TRIM = 0xeeeae0, GLASS = 0x22282e, CEDAR = 0xb4a68e, CEDAR_DARK = 0x655243,
  SHINGLE = 0x4a4541, IRONSTONE = 0x8b5a3e, MORTAR = 0x9a7a62, TIN = 0x7c5c48, DOOR = 0x4a3626, BRICK = 0x8a4a3a, STEEL = 0x9aa1a6,
  CAB = 0xd4d2c8, CAB_GLASS = 0x3c4c5a, DYKE = 0x8c8460, PLANK = 0x5e4a36, TEA = 0x3a2414, LOGS = 0x7a5a3c;

type G = THREE.BufferGeometry;
/** A geometry painted one colour, non-indexed and without uvs, so any of them merge. */
function paint(g: G, hex: number): G {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute("uv");
  const c = new THREE.Color(hex), a = new Float32Array(n.getAttribute("position").count * 3);
  for (let i = 0; i < a.length; i += 3) { a[i] = c.r; a[i + 1] = c.g; a[i + 2] = c.b; }
  n.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return n;
}
const box = (w: number, h: number, d: number, hex: number, x = 0, y = 0, z = 0) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
/** A gable roof over w by d, its ridge along x, `rise` high, its eaves at y. */
function gable(w: number, d: number, rise: number, hex: number, y: number, over = 0.4) {
  const s = new THREE.Shape([new THREE.Vector2(-d / 2 - over, 0), new THREE.Vector2(d / 2 + over, 0), new THREE.Vector2(0, rise)]);
  return paint(new THREE.ExtrudeGeometry(s, { depth: w + over * 2, bevelEnabled: false }).translate(0, 0, -(w + over * 2) / 2).rotateY(Math.PI / 2).translate(0, y, 0), hex);
}
/** A hip roof (four-sided) over w by d. */
const hip = (w: number, d: number, rise: number, hex: number, y: number) => paint(new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).scale(w + 0.8, rise, d + 0.8).translate(0, y + rise / 2, 0), hex);
/** A rod from a to b. */
function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, hex: number) {
  const L = a.distanceTo(b), g = new THREE.CylinderGeometry(r, r, L, 5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return paint(g.applyQuaternion(q).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2), hex);
}
/** A row of windows along a wall's face at `z` (its +z side), shuttered or trimmed. */
function windows(n: number, span: number, y: number, z: number, w: number, h: number, shutters: boolean, rot = 0): G[] {
  const out: G[] = [];
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? 0 : -span / 2 + (span * i) / (n - 1);
    out.push(box(w + 0.16, h + 0.16, 0.06, TRIM, x, y, z), box(w, h, 0.08, GLASS, x, y, z + 0.02));
    if (shutters) out.push(box(w * 0.45, h, 0.07, SHUTTER, x - w * 0.75, y, z), box(w * 0.45, h, 0.07, SHUTTER, x + w * 0.75, y, z));
  }
  return rot ? out.map((g) => g.rotateY(rot)) : out;
}
/** A flat surface w by d, mottled by `shade` per vertex: a lake, a flooded bog, a bed of vines. */
function surface(w: number, d: number, seed: number, shade: (r: () => number, u: number, v: number) => number, round = false) {
  const g = round ? new THREE.CircleGeometry(0.5, 28).scale(w, d, 1) : new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(d / 2)));
  g.rotateX(-Math.PI / 2);
  const n = g.index ? g.toNonIndexed() : g, p = n.getAttribute("position"), a = new Float32Array(p.count * 3), c = new THREE.Color(), rnd = mulberry32(seed);
  n.deleteAttribute("uv");
  const cache = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(2)},${p.getZ(i).toFixed(2)}`;
    let hex = cache.get(key);
    if (hex === undefined) { hex = shade(rnd, p.getX(i) / w + 0.5, p.getZ(i) / d + 0.5); cache.set(key, hex); }
    c.setHex(hex); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b;
  }
  n.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return n;
}
const pickOf = (hexes: number[]) => (r: () => number) => hexes[Math.floor(r() * hexes.length)]!;

/** One part's geometry, round its own centre with its foot at y = 0, front toward +z. */
function build(p: Part, seed: number): G[] {
  const { w, d } = p, f = d / 2 + 0.03, V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  switch (p.kind) {
    case "cottage": return [
      box(w, 5.6, d, CEDAR, 0, 1.3, 0), gable(w, d, 2.4, SHINGLE, 4.1), box(0.9, 1.9, 0.08, DOOR, -0.8, 0.95, f),
      ...windows(1, 0, 1.6, f, 0.8, 1.0, false).map((g) => g.translate(1.5, 0, 0)), ...windows(1, 0, 4.9, 0, 0.6, 0.6, false).map((g) => g.rotateY(Math.PI / 2).translate(w / 2 + 0.03, 0, 0)),
      box(0.7, 2.4, 0.7, BRICK, w / 2 - 1, 5.6, -0.6), box(w + 0.4, 0.15, 1.6, CEDAR_DARK, 0, 2.3, f + 0.7), rod(V(-w / 2, 0, f + 1.4), V(-w / 2, 2.3, f + 1.4), 0.07, TRIM), rod(V(w / 2, 0, f + 1.4), V(w / 2, 2.3, f + 1.4), 0.07, TRIM),
    ];
    case "mansion": return [
      box(w, 11.5, d, STUCCO, 0, 4.25, 0), hip(w, d, 3.2, ROOF, 10), box(0.9, 2.4, 0.9, BRICK, -w / 3, 13.4, 0), box(0.9, 2.4, 0.9, BRICK, w / 3, 13.4, 0),
      ...windows(5, w - 3, 2.0, f, 1.0, 1.6, true), ...windows(5, w - 3, 5.2, f, 1.0, 1.6, true), ...windows(5, w - 3, 8.2, f, 0.9, 1.2, true),
      box(1.4, 2.6, 0.1, DOOR, 0, 1.3, f + 0.02),
      // the veranda across the front: a deck, a roof on white posts
      box(w + 1, 0.3, 3, CEDAR_DARK, 0, 0.2, f + 1.5), box(w + 1.4, 0.18, 3.4, ROOF, 0, 3.4, f + 1.5),
      ...[-0.5, -0.25, 0, 0.25, 0.5].map((u) => rod(V(u * w, 0.3, f + 2.9), V(u * w, 3.35, f + 2.9), 0.1, TRIM)),
    ];
    case "tower": return [
      box(w, 18.5, d, STUCCO, 0, 7.75, 0), ...windows(1, 0, 13.5, f, 0.8, 1.6, true), ...windows(1, 0, 9.5, f, 0.8, 1.4, true),
      box(w + 0.6, 0.3, d + 0.6, TRIM, 0, 17, 0), hip(w, d, 1.6, ROOF, 17.1),
      // the cupola, its windows on four sides, and the flagpole
      box(2, 1.8, 2, TRIM, 0, 19.6, 0), ...[0, 1, 2, 3].flatMap((i) => windows(1, 0, 19.6, 1.03, 0.9, 1.0, false, (i * Math.PI) / 2)), hip(1.4, 1.4, 1.2, ROOF, 20.5),
      rod(V(0, 21.5, 0), V(0, 25, 0), 0.05, TRIM),
    ];
    case "gristmill": {
      const stones: G[] = [box(w, 7.5, d, IRONSTONE, 0, 2.25, 0), gable(w, d, 3.2, SHINGLE, 6), box(1.3, 2.3, 0.08, DOOR, 0, 1.15, f), box(1.1, 1.2, 0.08, DOOR, 0, 4.4, f)];
      // courses of mortar on the brown stone, so it reads as laid stone, not stucco
      for (let y = 0.6; y < 6; y += 0.7) stones.push(box(w + 0.02, 0.06, d + 0.02, MORTAR, 0, y, 0));
      stones.push(...windows(2, w - 4, 1.8, f, 0.8, 1.1, false), ...windows(2, w - 4, 4.4, f, 0.8, 1.0, false));
      return stones;
    }
    case "mill": {
      const out: G[] = [box(w, 6, d, CEDAR_DARK, 0, 1.5, 0), gable(w, d, 2.2, TIN, 4.5, 0.7), box(w * 0.6, 3.2, 0.1, 0x221a14, 0, 1.6, f)];
      // board-and-batten: a dark batten every 0.6 m
      for (let x = -w / 2 + 0.3; x < w / 2; x += 0.6) out.push(box(0.08, 4.4, 0.06, 0x3e3024, x, 2.2, f + 0.01));
      // a pile of pine logs by the open bay
      const rnd = mulberry32(seed);
      for (let i = 0; i < 9; i++) { const row = i < 4 ? 0 : i < 7 ? 1 : 2, x = -2 + (i - (row === 0 ? 0 : row === 1 ? 4 : 7)) * 0.75 + row * 0.37; out.push(paint(new THREE.CylinderGeometry(0.34, 0.36, 5 + rnd(), 8).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(x + w / 2 + 2.5, 0.35 + row * 0.62, 0), LOGS)); }
      return out;
    }
    case "shed": return [box(w, 4, d, CEDAR, 0, 0.6, 0), gable(w, d, 1.2, TIN, 2.6, 0.3), box(0.9, 1.8, 0.08, DOOR, 0, 0.9, f)];
    case "lake": return [surface(w, d, seed, pickOf([TEA, 0x41291a, 0x33200f, 0x4a3020]), true)];
    case "bog": return [surface(w, d, seed, (r) => [0xa3192a, 0xb8262e, 0x8e1424, 0xc8333a, 0x7a1a22][Math.floor(r() * 5)]!)];
    // vines in rows along the bed: deep bronze and green, a little red where the berries are
    case "vines": return [surface(w, d, seed, (r, u) => (Math.floor(u * 8) % 2 ? [0x4e4a2a, 0x5a3e26, 0x46502c] : [0x5c2e22, 0x4a3a24, 0x6a2a26])[Math.floor(r() * 3)]!)];
    case "dyke": {
      const t = 1.4, hd = d / 2, hw = w / 2;
      return [box(w, 2.3, t, DYKE, 0, -0.65, hd), box(w, 2.3, t, DYKE, 0, -0.65, -hd), box(t, 2.3, d, DYKE, hw, -0.65, 0), box(t, 2.3, d, DYKE, -hw, -0.65, 0)];
    }
    case "sluice": return [
      box(w, 1.6, d, PLANK, 0, 0, 0), box(w * 0.8, 0.08, d + 0.3, 0x3a2e22, 0, 0.82, 0), box(0.2, 1.6, 0.2, PLANK, -w / 2, 1.2, 0), box(0.2, 1.6, 0.2, PLANK, w / 2, 1.2, 0),
      box(w + 0.2, 0.22, 0.24, PLANK, 0, 2.0, 0), rod(V(0, 0.8, 0), V(0, 2.5, 0), 0.05, 0x3a3a3a), paint(new THREE.TorusGeometry(0.4, 0.05, 5, 12).rotateX(Math.PI / 2).translate(0, 2.5, 0), 0x2f2f2f),
    ];
    case "firetower": {
      // A galvanised lattice: four legs leaning in from a 6 m square to a 2.6 m one at 18 m, girts at each landing,
      // crossed braces between them on all four faces, a stair inside, and the cab on top.
      const H = 18, b = 3, t = 1.3, out: G[] = [], at = (y: number) => b + (t - b) * (y / H);
      const corner = (i: number, y: number) => { const s = at(y), a = (i * Math.PI) / 2 + Math.PI / 4; return V(Math.cos(a) * s * Math.SQRT2, y, Math.sin(a) * s * Math.SQRT2); };
      for (let i = 0; i < 4; i++) out.push(rod(corner(i, -1), corner(i, H), 0.13, STEEL), box(0.9, 0.5, 0.9, 0x9a9890, corner(i, 0).x, 0, corner(i, 0).z));
      const levels = [0.4, 4.6, 8.8, 13, H];
      for (let l = 0; l < levels.length; l++) for (let i = 0; i < 4; i++) {
        out.push(rod(corner(i, levels[l]!), corner((i + 1) % 4, levels[l]!), 0.06, STEEL));
        if (l + 1 < levels.length) { out.push(rod(corner(i, levels[l]!), corner((i + 1) % 4, levels[l + 1]!), 0.04, STEEL), rod(corner((i + 1) % 4, levels[l]!), corner(i, levels[l + 1]!), 0.04, STEEL)); }
      }
      // the stair: a flight between each pair of landings, turning each time, with a small landing deck
      for (let l = 0; l + 1 < levels.length; l++) {
        const y0 = levels[l]!, y1 = levels[l + 1]!, s = at(y1) * 0.55, dir = l % 2 ? 1 : -1;
        out.push(rod(V(-s * dir, y0, -s * 0.4), V(s * dir, y1, -s * 0.4), 0.22, 0x6e7478), box(1.6, 0.1, 1.2, 0x6e7478, s * dir, y1 - 0.05, -s * 0.4));
      }
      const c = 1.85, y = H;
      out.push(
        box(c * 2 + 0.8, 0.2, c * 2 + 0.8, 0x6e7478, 0, y, 0), box(c * 2, 1.0, c * 2, CAB, 0, y + 0.6, 0), box(c * 2 - 0.02, 1.3, c * 2 - 0.02, CAB_GLASS, 0, y + 1.75, 0),
        ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => box(0.12, 1.3, 0.12, CAB, sx! * c, y + 1.75, sz! * c)), box(c * 2, 0.35, c * 2, CAB, 0, y + 2.55, 0),
        hip(c * 2, c * 2, 1.0, 0x5d6266, y + 2.7), rod(V(0, y + 3.6, 0), V(0, y + 6.5, 0), 0.04, 0x444444), box(0.12, 0.25, 0.12, 0xc83a2a, 0, y + 6.55, 0),
      );
      // the catwalk's rail round the cab
      const r = c + 0.4;
      for (const [ax, az, bx, bz] of [[-r, -r, r, -r], [r, -r, r, r], [r, r, -r, r], [-r, r, -r, -r]]) out.push(rod(V(ax!, y + 1.0, az!), V(bx!, y + 1.0, bz!), 0.03, STEEL));
      return out;
    }
  }
}

/** How a part meets uneven ground: a building's foot sits at its lowest corner (its walls go on down), water and banks
 *  at the highest, so a flooded bed never shows ground through it and the lake never floats. */
const HIGH: ReadonlySet<PartKind> = new Set(["bog", "vines", "dyke", "sluice"]);

export function pinesView(group: THREE.Group, groundY: (x: number, z: number) => number) {
  const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
  const wet = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 70, specular: 0x55483a });
  const root = new THREE.Group();
  root.name = "pines";
  group.add(root);
  const sights = SIGHTS.map((s, si) => {
    const g = new THREE.Group();
    g.visible = false;
    root.add(g);
    const parts = s.parts.map((p, pi) => {
      const geo = mergeGeometries(build(p, si * 101 + pi)) ?? new THREE.BufferGeometry();
      const m = new THREE.Mesh(geo, p.kind === "lake" || p.kind === "bog" ? wet : solid);
      m.rotation.y = p.yaw; m.position.set(p.x, 0, p.z); m.matrixAutoUpdate = false; m.updateMatrix();
      g.add(m);
      return { p, m };
    });
    return { s, g, parts, reach: s.id === "fire-tower" ? TOWER_SEEN_R : SEEN_R };
  });
  const disc = new THREE.CircleGeometry(1, 14).rotateX(-Math.PI / 2);
  const puddles = new THREE.InstancedMesh(disc, new THREE.MeshPhongMaterial({ color: 0x4a2c16, shininess: 90, specular: 0x6a5a48, polygonOffset: true, polygonOffsetFactor: -2 }), PUDDLE_CAP);
  puddles.count = 0; puddles.frustumCulled = false; root.add(puddles);
  const o = new THREE.Object3D();
  let wait = 0;
  /** Where a part stands: its footprint's corners and middle, read off the drawn ground. */
  function lay(p: Part) {
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    let lo = Infinity, hi = -Infinity;
    for (const [u, v] of [[0, 0], [-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) {
      const lx = u * p.w, lz = v * p.d, y = groundY(p.x + lx * c + lz * s, p.z - lx * s + lz * c);
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    return p.kind === "lake" ? lo + 0.25 : HIGH.has(p.kind) ? hi + (p.kind === "dyke" ? 0.45 : p.kind === "sluice" ? 0.3 : 0.12) : lo;
  }
  return {
    /** Each frame: shows the sights in range of `me`, and lays them and the near puddles on the ground twice a second. */
    update(me: { x: number; z: number }, dt: number) {
      wait -= dt;
      if (wait > 0) return;
      wait = 0.5;
      for (const v of sights) {
        v.g.visible = Math.hypot(me.x - v.s.x, me.z - v.s.z) < v.reach;
        if (!v.g.visible) continue;
        // a dyke stands round its bed at the bed's own level, so lay beds first and hand their height on
        let bed = 0;
        for (const { p, m } of v.parts) {
          const y = p.kind === "dyke" || p.kind === "sluice" ? bed + (p.kind === "dyke" ? -0.2 : 0.1) : lay(p);
          if (p.kind === "bog" || p.kind === "vines") bed = y;
          if (m.position.y !== y) { m.position.y = y; m.updateMatrix(); }
        }
      }
      let n = 0;
      for (const q of PUDDLES) {
        if (n >= PUDDLE_CAP || Math.abs(q.x - me.x) > PUDDLE_R || Math.abs(q.z - me.z) > PUDDLE_R) continue;
        o.position.set(q.x, groundY(q.x, q.z) + 0.05, q.z); o.rotation.set(0, q.yaw, 0); o.scale.set(q.r * 0.6, 1, q.r);
        o.updateMatrix(); puddles.setMatrixAt(n++, o.matrix);
      }
      puddles.count = n; puddles.instanceMatrix.needsUpdate = true;
    },
    /** What is drawn: each sight shown or not, and the puddles laid. */
    state: () => ({ sights: sights.map((v) => ({ id: v.s.id, x: v.s.x, z: v.s.z, shown: v.g.visible })), puddles: puddles.count }),
  };
}
