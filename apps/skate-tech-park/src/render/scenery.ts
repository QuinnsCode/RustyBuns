// Small things for scale: tiny pines and rocks strewn over a park's ground, so the board reads as
// giant beside them. `scatter` picks the spots (seeded, so a park always looks the same, and clear of
// every piece, rail, tree and spawn); `sceneryMeshes` draws them as two instanced meshes.
import { mulberry32 } from "@rustybuns/util";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Level, onRail } from "../level.ts";

export type Kind = "pine" | "rock" | "aspen" | "cairn" | "tent" | "sign" | "stump";
export type Spot = { kind: Kind; x: number; z: number; y: number; size: number; yaw: number };
type Ground = { R: number; height(x: number, z: number): number };

const CELL = 7; // one candidate per cell, jittered
const MAX_SLOPE = 0.55;
const CLEAR = 3; // metres kept between a spot and a piece, rail or spawn

/** Pines (0.5..1.5 m tall) and rocks (0.2..0.7 m): toys beside a board 4.4 m long, so the park reads as giant. */
export const PINE = { min: 0.5, max: 1.5 }, ROCK = { min: 0.2, max: 0.7 };
/**
 * What else a park has strewn over it, with how likely each is out of the spots that survive the
 * clearance checks (the rest is pines and rocks), its size range, and how far it sinks into the ground.
 * Rarer things sit last so a park's pines and rocks fall where they always did.
 */
const EXTRA: (Range & { chance: number })[] = [
  { kind: "aspen", chance: 0.12, min: 0.8, max: 1.6 },
  { kind: "stump", chance: 0.06, min: 0.2, max: 0.4 },
  { kind: "cairn", chance: 0.03, min: 0.3, max: 0.5 },
  { kind: "sign", chance: 0.02, min: 0.5, max: 0.6 },
  { kind: "tent", chance: 0.015, min: 0.6, max: 0.8 },
];

type Range = { kind: Kind; min: number; max: number };

/** Some pine and rock spots become one of the rarer things, by a hash of where they are (so the rng stream is untouched). */
function pickExtra(x: number, z: number, fallback: Range): Range {
  const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
  let acc = 0;
  return EXTRA.find((e) => h < (acc += e.chance)) ?? fallback;
}

/** Spots for pines and rocks, off anything the rider can use. */
export function scatter(level: Level, ground: Ground, seed = 7): Spot[] {
  const rng = mulberry32(seed), spots: Spot[] = [], R = ground.R;
  const raised = (x: number, z: number) => level.height(x, z) - ground.height(x, z) > 0.02;
  const near = (x: number, z: number) => {
    for (const [dx, dz] of [[0, 0], [CLEAR, 0], [-CLEAR, 0], [0, CLEAR], [0, -CLEAR], [CLEAR, CLEAR], [-CLEAR, -CLEAR], [CLEAR, -CLEAR], [-CLEAR, CLEAR]]) if (raised(x + dx, z + dz)) return true;
    if (level.rails.some((r) => { const o = onRail(r, x, z); return o.t > -0.05 && o.t < 1.05 && o.off < CLEAR; })) return true;
    if (level.spawns.some((s) => Math.hypot(s.x - x, s.z - z) < 12)) return true;
    return (level.obstacles ?? []).some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 4);
  };
  for (let gz = -R; gz < R; gz += CELL) for (let gx = -R; gx < R; gx += CELL) {
    const x = gx + rng() * CELL, z = gz + rng() * CELL, roll = rng(), size = rng(), yaw = rng() * Math.PI * 2;
    if (Math.hypot(x, z) > R - 6 || roll > 0.7) continue;
    const y = ground.height(x, z);
    if (Math.hypot(ground.height(x + 1, z) - ground.height(x - 1, z), ground.height(x, z + 1) - ground.height(x, z - 1)) / 2 > MAX_SLOPE) continue;
    if (near(x, z)) continue;
    const range = roll < 0.5 ? { kind: "pine" as Kind, ...PINE } : { kind: "rock" as Kind, ...ROCK };
    const kind = pickExtra(x, z, range);
    spots.push({ kind: kind.kind, x, z, y, size: kind.min + size * (kind.max - kind.min), yaw });
  }
  return spots;
}

/** Pieces in vertex colours merged into one geometry, about 1 m tall, so one material draws a whole kind. */
function solid(parts: [THREE.BufferGeometry, number][]) {
  return mergeGeometries(parts.map(([g, color]) => {
    const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g.index ? g.toNonIndexed() : g;
  }))!;
}

const GEOMETRY: Record<Exclude<Kind, "rock">, () => THREE.BufferGeometry> = {
  pine: () => solid([
    [new THREE.CylinderGeometry(0.05, 0.07, 0.25, 6).translate(0, 0.125, 0), 0x6b4429],
    [new THREE.ConeGeometry(0.34, 0.55, 8).translate(0, 0.5, 0), 0x2f5d3a],
    [new THREE.ConeGeometry(0.24, 0.5, 8).translate(0, 0.8, 0), 0x3b6e45],
  ]),
  // A pale trunk under a gold crown: the autumn grove.
  aspen: () => solid([
    [new THREE.CylinderGeometry(0.03, 0.05, 0.7, 6).translate(0, 0.35, 0), 0xe6e2d3],
    [new THREE.IcosahedronGeometry(0.28, 0).scale(1, 1.2, 1).translate(0, 0.78, 0), 0xe0b43c],
  ]),
  stump: () => solid([
    [new THREE.CylinderGeometry(0.4, 0.5, 0.6, 8).translate(0, 0.3, 0), 0x6b4429],
    [new THREE.CylinderGeometry(0.34, 0.34, 0.02, 8).translate(0, 0.6, 0), 0xc9a06a],
  ]),
  // A trail cairn: stacked stones, widest at the bottom.
  cairn: () => solid([0, 1, 2, 3].map((i): [THREE.BufferGeometry, number] => [new THREE.IcosahedronGeometry(0.34 - i * 0.07, 0).scale(1, 0.6, 1).translate(0, 0.1 + i * 0.2, 0), i % 2 ? 0x9c9388 : 0x7d766c])),
  // A trail marker: a post with a board across its top.
  sign: () => solid([
    [new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6).translate(0, 0.4, 0), 0x6b4429],
    [new THREE.BoxGeometry(0.5, 0.2, 0.04).translate(0.05, 0.8, 0), 0xb58a4f],
  ]),
  // A two-person tent: a triangular prism in park-ranger orange.
  tent: () => solid([[new THREE.CylinderGeometry(0.5, 0.5, 1, 3, 1).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.6, 1).translate(0, 0.25, 0), 0xe2572b]]),
};

const BY_KIND = (kind: Kind) =>
  kind === "rock"
    ? { geo: new THREE.IcosahedronGeometry(0.5, 0), mat: new THREE.MeshStandardMaterial({ color: 0x8e857a, roughness: 1, flatShading: true }) }
    : { geo: GEOMETRY[kind](), mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }) };

/** Scenery is only for looking at: riders pass through it, so a spot shrinks away as one nears. */
export const SQUASH = 3; // metres
export const squash = (spot: Spot, d: number) => (d >= SQUASH ? 1 : Math.max(0, d / SQUASH) ** 2);

export class Scenery {
  readonly group = new THREE.Group();
  private meshes = new Map<Kind, { mesh: THREE.InstancedMesh; mine: Spot[]; shrunk: Set<number> }>();
  private o = new THREE.Object3D();

  constructor(spots: Spot[]) {
    const make = (kind: Kind, geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const mine = spots.filter((s) => s.kind === kind);
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, mine.length));
      mesh.count = mine.length;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes.set(kind, { mesh, mine, shrunk: new Set() });
      mine.forEach((s, i) => this.place(mesh, s, i, 1));
    };
    for (const kind of ["pine", "rock", "aspen", "stump", "cairn", "sign", "tent"] as Kind[]) {
      const { geo, mat } = BY_KIND(kind);
      make(kind, geo, mat);
    }
  }

  private place(mesh: THREE.InstancedMesh, s: Spot, i: number, k: number) {
    const o = this.o, h = s.kind === "rock" ? s.size * 0.7 : s.size;
    o.position.set(s.x, s.y - (s.kind === "rock" ? s.size * 0.15 : 0), s.z);
    o.rotation.set(0, s.yaw, 0);
    o.scale.set(s.size * k, h * k, s.size * k);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    mesh.instanceMatrix.needsUpdate = true;
  }

  /** Shrink what is within SQUASH of any of `points` (the rider, the camera); restore what they left behind. */
  update(points: { x: number; z: number }[]) {
    for (const { mesh, mine, shrunk } of this.meshes.values()) {
      mine.forEach((s, i) => {
        let d = Infinity;
        for (const p of points) d = Math.min(d, Math.hypot(p.x - s.x, p.z - s.z));
        if (d < SQUASH) { this.place(mesh, s, i, squash(s, d)); shrunk.add(i); }
        else if (shrunk.delete(i)) this.place(mesh, s, i, 1);
      });
    }
  }

  /** Instance scale of the i-th spot of a kind, for tests. */
  scaleOf(kind: Kind, i: number) {
    const m = new THREE.Matrix4();
    this.meshes.get(kind)!.mesh.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixScale(m).x / this.meshes.get(kind)!.mine[i]!.size;
  }
}
