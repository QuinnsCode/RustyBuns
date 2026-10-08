import * as THREE from "three";
import { A_REST, SEATS, WALL_R, seatAngle } from "../../sim/rules.ts";
import { Geyser } from "./geyser.ts";
import { Smoke, type Animated } from "./industry.ts";
import { ferns, mountains, palm, rockRim, type Palm } from "./jungle.ts";
import { buildOffice } from "./office.ts";
import { basalt, moss } from "./textures.ts";
import type { Particles } from "./fx.ts";

/** Sim (x, y) on the pan -> three.js (x, height, -y). */
export const at = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/** The basin, the geyser, four outposts and the jungle round them. */
export class Arena {
  readonly group = new THREE.Group();
  readonly geyser: Geyser;
  private animated: Animated[] = [];
  private palms: Palm[] = [];
  private mist: Smoke;

  constructor(fx: Particles) {
    const g = this.group;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(WALL_R, 96), new THREE.MeshPhysicalMaterial({ map: basalt(), roughness: 0.28, metalness: 0.55, clearcoat: 0.8, clearcoatRoughness: 0.15 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(WALL_R + 0.3, 0.5, 12, 96), new THREE.MeshStandardMaterial({ color: 0x35352f, roughness: 0.95 }));
    lip.rotation.x = Math.PI / 2; lip.position.y = 0.05; lip.receiveShadow = true; g.add(lip);
    g.add(rockRim());
    this.geyser = new Geyser(fx); g.add(this.geyser.group);

    const mossTex = moss(48, 48);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(170, 64), new THREE.MeshStandardMaterial({ map: mossTex, bumpMap: mossTex, bumpScale: 1.5, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; ground.receiveShadow = true; g.add(ground);
    g.add(mountains());

    for (let i = 0; i < SEATS; i++) {
      const o = buildOffice(i), a = seatAngle(i);
      o.group.position.set(Math.cos(a) * A_REST, 0, -Math.sin(a) * A_REST);
      o.group.rotation.y = Math.atan2(Math.cos(a), -Math.sin(a));
      g.add(o.group); this.animated.push(...o.animated);
    }
    this.plant();
    this.mist = new Smoke(Array.from({ length: 7 }, (_, i) => { const a = (i / 7) * Math.PI * 2 + 0.4; return { at: new THREE.Vector3(Math.cos(a) * 46, 1.5, Math.sin(a) * 46), rate: 0.3, size: 14, tint: 0xcfe0cf }; }), 5, 5, 0.1);
    g.add(this.mist.group);
  }

  /**
   * Palms and ferns. The camera sits to the south looking north, so nothing tall
   * goes in that wedge near the pan: the trees crowd the far side and the flanks,
   * lean outward, and the ones that do stand south are far back and short.
   */
  private plant() {
    const r = rng(99);
    for (let i = 0; i < 34; i++) {
      const a = r() * Math.PI * 2, d = 27 + r() * 26;
      const x = Math.cos(a), z = Math.sin(a);                      // z > 0 is toward the camera
      if (z > 0.35 && d < 44) continue;                            // keep the camera's side clear
      const tall = z > 0.2 ? 5.5 + r() * 2.5 : 6.5 + r() * 3.5;
      const p = palm(i + 1, tall, x * (1.5 + r() * 2.5), z * (1.5 + r() * 2.5));
      p.group.position.set(x * d, 0, z * d); p.group.rotation.y = r() * 6.28;
      this.group.add(p.group); this.palms.push(p);
    }
    for (let i = 0; i < 26; i++) {                                  // ground cover between the outposts and in the rim gaps
      const a = r() * Math.PI * 2, d = WALL_R + 8 + r() * 14;
      if (Math.sin(a) > 0.55 && d < 24) continue;
      const f = ferns(i + 200, 5); f.position.set(Math.cos(a) * d, 0, Math.sin(a) * d); f.scale.setScalar(1 + r() * 0.8);
      this.group.add(f);
    }
  }

  update(t: number, dt: number) {
    for (const a of this.animated) a.update(t);
    for (const p of this.palms) { p.crown.rotation.z = Math.sin(t * 0.9 + p.phase) * 0.05; p.crown.rotation.x = Math.cos(t * 0.7 + p.phase) * 0.04; }
    this.geyser.update(t, dt);
    this.mist.update(dt, 0.2);
  }
}
