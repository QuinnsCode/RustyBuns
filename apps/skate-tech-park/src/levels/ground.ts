// What a park level looks like beyond its pieces and rails: the real ground as a mesh, the sequoias,
// and the pickups. Sampled from the level, so it needs nothing the sim doesn't already know.
import * as THREE from "three";
import type { Landmark, ParkLevel } from "./park.ts";

const STEP = 4;

export function groundMesh(level: ParkLevel): THREE.Mesh {
  const R = level.ground.R, n = Math.round((2 * R) / STEP) + 1;
  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3), idx: number[] = [];
  const grass = new THREE.Color(0x6f8250), rock = new THREE.Color(0xbfb8ab), c = new THREE.Color();
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -R + i * STEP, z = -R + j * STEP, h = level.ground.height(x, z), k = (j * n + i) * 3;
    pos.set([x, h, z], k);
    const slope = Math.hypot(level.ground.height(x + 1, z) - level.ground.height(x - 1, z), level.ground.height(x, z + 1) - level.ground.height(x, z - 1)) / 2;
    c.copy(grass).lerp(rock, Math.min(1, Math.max(Math.max(0, slope - 0.6) * 2.5, (h - level.granite) / 12))); // steep ground is bare granite
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

/** One landmark as meshes, standing on the ground where it is placed. */
function landmark(level: ParkLevel, l: Landmark): THREE.Object3D {
  const g = new THREE.Group(), at = (x: number, z: number) => level.ground.height(x, z);
  if (l.kind === "plume") {
    const steam = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xcfd6dc, emissiveIntensity: 0.8, transparent: true, opacity: 0.8, roughness: 1, depthWrite: false });
    for (let i = 0; i < 8; i++) {
      const k = i / 7, puff = new THREE.Mesh(new THREE.SphereGeometry(l.r * (0.7 + k * 1.3), 16, 12), steam);
      puff.position.set(l.x + k * k * l.r * 1.5, at(l.x, l.z) + l.r * 0.5 + (l.tall - l.r) * k, l.z);
      g.add(puff);
    }
  } else if (l.kind === "rings") {
    // Terraces stepping up toward the middle, outermost lowest, so the colours read from a low angle too.
    const y = at(l.x, l.z);
    l.rings.forEach((r, i) => {
      const hgt = 0.5 * (i + 1), disc = new THREE.Mesh(new THREE.CylinderGeometry(r.r, r.r, hgt, 48), new THREE.MeshStandardMaterial({ color: r.color, roughness: 0.6 }));
      disc.position.set(l.x, y + hgt / 2, l.z);
      g.add(disc);
    });
  } else {
    // A ribbon of white water laid along the slope between the two points.
    const n = 24, pos: number[] = [], idx: number[] = [];
    const dx = l.to.x - l.from.x, dz = l.to.z - l.from.z, len = Math.hypot(dx, dz), px = -dz / len, pz = dx / len;
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = l.from.x + dx * t, z = l.from.z + dz * t, y = at(x, z) + 1.5;
      pos.push(x - px * l.width / 2, y, z - pz * l.width / 2, x + px * l.width / 2, y, z + pz * l.width / 2);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xf4f9ff, emissive: 0xdfeeff, emissiveIntensity: 0.5, side: THREE.DoubleSide })));
  }
  return g;
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
  for (const l of level.landmarks) group.add(landmark(level, l));
  const gold = new THREE.MeshStandardMaterial({ color: 0xe2572b, emissive: 0xe2572b, emissiveIntensity: 0.4 });
  const pickups = level.pickups.map((p) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.12, 8, 20), gold);
    m.position.set(p.x, p.y, p.z);
    group.add(m);
    return m;
  });
  return { group, pickups };
}
