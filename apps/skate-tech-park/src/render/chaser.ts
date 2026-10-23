// The chasing animal, a few lumpy primitives like the critters but big enough to read from the rider's
// camera. Facing local +z; it bobs as it runs.
import * as THREE from "three";
import type { Chaser, Species } from "../chaser.ts";

const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
const blob = (r: number, color: number, [sx, sy, sz]: [number, number, number], [x, y, z]: [number, number, number]) => {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), mat(color));
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true;
  return m;
};

const BUILD: Record<Species, (g: THREE.Group) => void> = {
  moose: (g) => {
    g.add(blob(1.3, 0x4a3425, [0.8, 0.9, 1.5], [0, 2.6, 0]), blob(0.6, 0x5a4230, [0.7, 0.9, 1.3], [0, 3.3, 1.9]));
    for (const s of [-1, 1]) {
      g.add(blob(0.9, 0xd9c9a3, [1.8, 0.12, 0.7], [s * 1.2, 4.1, 1.8]));
      for (const z of [-0.9, 0.9]) g.add(blob(0.3, 0x2f2218, [0.5, 4, 0.5], [s * 0.6, 1.1, z]));
    }
  },
  bear: (g) => {
    g.add(blob(1.2, 0x3b2a20, [0.9, 0.9, 1.4], [0, 1.6, 0]), blob(0.65, 0x3b2a20, [0.9, 0.9, 0.9], [0, 1.9, 1.8]), blob(0.25, 0xb08a60, [1, 0.8, 0.9], [0, 1.7, 2.45]));
    for (const s of [-1, 1]) for (const z of [-0.9, 0.9]) g.add(blob(0.35, 0x2c1f18, [0.8, 2.2, 0.8], [s * 0.7, 0.7, z]));
  },
  bigfoot: (g) => {
    g.add(blob(1.1, 0x4d3a2a, [0.9, 1.7, 0.7], [0, 3.2, 0]), blob(0.6, 0x4d3a2a, [0.9, 1, 0.9], [0, 5.1, 0.2]), blob(0.12, 0xe8dcc0, [1, 1, 1], [-0.2, 5.2, 0.8]), blob(0.12, 0xe8dcc0, [1, 1, 1], [0.2, 5.2, 0.8]));
    for (const s of [-1, 1]) g.add(blob(0.3, 0x3e2e21, [0.8, 5, 0.8], [s * 1.3, 3.2, 0]), blob(0.4, 0x3e2e21, [0.8, 3.4, 0.8], [s * 0.5, 1.2, 0]));
  },
};

export class ChaserView {
  readonly group = new THREE.Group();
  constructor(species: Species) { BUILD[species](this.group); }
  update(c: Chaser) {
    const bob = c.speed > 0 ? Math.abs(Math.sin(c.t * 9)) * 0.35 : 0;
    this.group.position.set(c.x, c.y + bob, c.z);
    this.group.rotation.y = c.yaw;
  }
}
