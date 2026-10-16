// What a park level looks like beyond its pieces and rails: the real ground as a mesh, the sequoias,
// and the pickups. Sampled from the level, so it needs nothing the sim doesn't already know.
import * as THREE from "three";
import type { ParkLevel } from "./park.ts";

const STEP = 4;

export function groundMesh(level: ParkLevel): THREE.Mesh {
  const R = level.ground.R, n = Math.round((2 * R) / STEP) + 1;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), idx: number[] = [];
  const grass = new THREE.Color(0x7d8f55), rock = new THREE.Color(0x8e857a), c = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -R + i * STEP, z = -R + j * STEP, h = level.ground.height(x, z), k = (j * n + i) * 3;
    pos.set([x, h, z], k);
    const slope = Math.hypot(level.ground.height(x + 1, z) - level.ground.height(x - 1, z), level.ground.height(x, z + 1) - level.ground.height(x, z - 1)) / 2;
    c.copy(grass).lerp(rock, Math.min(1, slope * 1.6));
    col.set([c.r, c.g, c.b], k);
    if (i < n - 1 && j < n - 1) { const a = j * n + i; idx.push(a, a + n, a + 1, a + 1, a + n, a + n + 1); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  m.receiveShadow = true;
  return m;
}

/** The trees and the pickups. `pickups[i]` is the mesh for `level.pickups[i]`. */
export function props(level: ParkLevel) {
  const group = new THREE.Group(), bark = new THREE.MeshStandardMaterial({ color: 0x8a4a2b, roughness: 1 });
  for (const t of level.trees) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.8, t.r, t.tall, 14), bark);
    m.position.set(t.x, level.ground.height(t.x, t.z) + t.tall / 2, t.z);
    m.castShadow = true;
    group.add(m);
  }
  const gold = new THREE.MeshStandardMaterial({ color: 0xe2572b, emissive: 0xe2572b, emissiveIntensity: 0.4 });
  const pickups = level.pickups.map((p) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 8, 20), gold);
    m.position.set(p.x, p.y, p.z);
    group.add(m);
    return m;
  });
  return { group, pickups };
}
