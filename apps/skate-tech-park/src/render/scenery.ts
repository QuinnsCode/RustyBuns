// Small things for scale: tiny pines and rocks strewn over a park's ground, so the board reads as
// giant beside them. `scatter` picks the spots (seeded, so a park always looks the same, and clear of
// every piece, rail, tree and spawn); `sceneryMeshes` draws them as two instanced meshes.
import { mulberry32 } from "@rustybuns/util";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { type Level, onRail } from "../level.ts";

export type Spot = { kind: "pine" | "rock"; x: number; z: number; y: number; size: number; yaw: number };
type Ground = { R: number; height(x: number, z: number): number };

const CELL = 7; // one candidate per cell, jittered
const MAX_SLOPE = 0.55;
const CLEAR = 3; // metres kept between a spot and a piece, rail or spawn

/** Pines (0.5..1.5 m tall) and rocks (0.2..0.7 m): toys beside a board 4.4 m long, so the park reads as giant. */
export const PINE = { min: 0.5, max: 1.5 }, ROCK = { min: 0.2, max: 0.7 };

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
    spots.push(roll < 0.5 ? { kind: "pine", x, z, y, size: PINE.min + size * (PINE.max - PINE.min), yaw } : { kind: "rock", x, z, y, size: ROCK.min + size * (ROCK.max - ROCK.min), yaw });
  }
  return spots;
}

/** A pine in vertex colours (a trunk and two tiers of needles), 1 m tall, so one material draws it. */
function pineGeometry() {
  const part = (g: THREE.BufferGeometry, color: number) => {
    const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    return g.toNonIndexed();
  };
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.05, 0.07, 0.25, 6).translate(0, 0.125, 0), 0x6b4429),
    part(new THREE.ConeGeometry(0.34, 0.55, 8).translate(0, 0.5, 0), 0x2f5d3a),
    part(new THREE.ConeGeometry(0.24, 0.5, 8).translate(0, 0.8, 0), 0x3b6e45),
  ])!;
}

/** Scenery is only for looking at: riders pass through it, so a spot shrinks away as one nears. */
export const SQUASH = 3; // metres
export const squash = (spot: Spot, d: number) => (d >= SQUASH ? 1 : Math.max(0, d / SQUASH) ** 2);

export class Scenery {
  readonly group = new THREE.Group();
  private meshes = new Map<Spot["kind"], { mesh: THREE.InstancedMesh; mine: Spot[]; shrunk: Set<number> }>();
  private o = new THREE.Object3D();

  constructor(spots: Spot[]) {
    const make = (kind: Spot["kind"], geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const mine = spots.filter((s) => s.kind === kind);
      const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, mine.length));
      mesh.count = mine.length;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.meshes.set(kind, { mesh, mine, shrunk: new Set() });
      mine.forEach((s, i) => this.place(mesh, s, i, 1));
    };
    make("pine", pineGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    make("rock", new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: 0x8e857a, roughness: 1, flatShading: true }));
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
  scaleOf(kind: Spot["kind"], i: number) {
    const m = new THREE.Matrix4();
    this.meshes.get(kind)!.mesh.getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixScale(m).x / this.meshes.get(kind)!.mine[i]!.size;
  }
}
