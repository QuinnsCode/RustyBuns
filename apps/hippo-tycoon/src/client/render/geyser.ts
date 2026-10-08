// The oil geyser: a glossy black column that surges every time a drop is
// fired, throws spray, and steams. Drops are launched from its top (DropLayer
// lofts them in an arc), so the pan visibly drinks from this vent.
import * as THREE from "three";
import { GOLD } from "../../sim/rules.ts";
import type { Particles } from "./fx.ts";
import { Smoke } from "./industry.ts";

const OIL = new THREE.MeshPhysicalMaterial({ color: 0x060504, metalness: 0.3, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04, transparent: true, opacity: 0.94 });

export class Geyser {
  readonly group = new THREE.Group();
  private column: THREE.Mesh;
  private cap: THREE.Mesh;
  private surge = 0;
  private steam: Smoke;

  constructor(private fx: Particles) {
    const g = this.group, rock = new THREE.MeshStandardMaterial({ color: 0x3a3a34, roughness: 0.95, flatShading: true });
    // a lava-rock mound with a crater, and the oil that has pooled round it
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.1, 36), OIL); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.02; g.add(pool);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2, s = 0.5 + (i % 3) * 0.12;
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), rock);
      r.position.set(Math.cos(a) * 0.95, 0.28 + (i % 2) * 0.1, Math.sin(a) * 0.95); r.scale.set(1, 0.7, 1); r.rotation.set(i, i * 2, 0); r.castShadow = true; g.add(r);
    }
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.92, 1, 24, 14, true), OIL);
    this.column.castShadow = true; g.add(this.column);
    this.cap = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), OIL); g.add(this.cap);
    this.steam = new Smoke([{ at: new THREE.Vector3(0, 4.4, 0), rate: 0.9, size: 3, tint: 0xe4efe8 }], 8, 7, 0.22);
    g.add(this.steam.group);
  }

  /** A drop was fired: surge the column and throw spray (gold throws a golden one). */
  erupt(kind: number) {
    this.surge = Math.min(1.4, this.surge + (kind === GOLD ? 1 : 0.7));
    const top = new THREE.Vector3(0, 3.2 + this.surge * 2.2, 0);
    this.fx.emit(top, kind === GOLD ? 0xffc933 : 0xb07a30, kind === GOLD ? 40 : 26, 3.4, 1.0, 9, 2.7);   // oil spray catching the low sun
    if (kind !== GOLD) this.fx.emit(top, 0xe0b060, 8, 3, 0.8, 9, 2.4);
  }

  update(t: number, dt: number) {
    this.surge *= Math.pow(0.04, dt);                      // settles in about a second
    const h = 2.6 + this.surge * 3.2 + Math.sin(t * 3.1) * 0.2 + Math.sin(t * 7.3) * 0.08;
    this.column.scale.set(1 + Math.sin(t * 19) * 0.05 * this.surge, h, 1 + Math.cos(t * 17) * 0.05 * this.surge);
    this.column.position.y = h / 2;
    this.cap.position.y = h + 0.1; this.cap.scale.set(1.15 + this.surge * 0.3, 1 + this.surge * 0.35, 1.15 + this.surge * 0.3);   // the head of the gush
    this.steam.update(dt, 0.3);
  }
}
