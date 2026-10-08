import * as THREE from "three";
import { A_REST, SEATS, WALL_R, seatAngle } from "../../sim/rules.ts";
import { Geyser } from "./geyser.ts";
import { Smoke, type Animated } from "./industry.ts";
import { CLEARING, claim, forest, mountains, rockRim } from "./jungle.ts";
import { buildOffice } from "./office.ts";
import { LOOKS } from "./looks.ts";
import { basalt, dirt, moss } from "./textures.ts";

/** Sim (x, y) on the pan -> three.js (x, height, -y). */
export const at = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

/** The basin, the geyser, four outposts and the jungle round them. */
export class Arena {
  readonly group = new THREE.Group();
  readonly geyser: Geyser;
  private animated: Animated[] = [];
  private forest!: ReturnType<typeof forest>;
  private mist: Smoke;

  constructor() {
    const g = this.group;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(WALL_R, 96), new THREE.MeshPhysicalMaterial({ map: basalt(), roughness: 0.28, metalness: 0.55, clearcoat: 0.8, clearcoatRoughness: 0.15 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(WALL_R + 0.3, 0.5, 12, 96), new THREE.MeshStandardMaterial({ color: 0x35352f, roughness: 0.95 }));
    lip.rotation.x = Math.PI / 2; lip.position.y = 0.05; lip.receiveShadow = true; g.add(lip);
    g.add(rockRim());
    this.geyser = new Geyser(); g.add(this.geyser.group);

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
   * The oil clearing the hippos have claimed: packed, oil-stained ground, stumps
   * and felled trunks along its edge, claim stakes in each baron's colour, and
   * jungle pressing in on every side. The camera's side stays open (see forest()).
   */
  private plant() {
    const clearing = new THREE.Mesh(new THREE.CircleGeometry(CLEARING + 3, 64), new THREE.MeshStandardMaterial({ map: dirt(), transparent: true, depthWrite: false, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    clearing.rotation.x = -Math.PI / 2; clearing.position.y = -0.03; clearing.receiveShadow = true; this.group.add(clearing);
    this.group.add(claim(LOOKS.map((l) => l.accent)));
    this.forest = forest(); this.group.add(this.forest);
  }

  update(t: number, dt: number) {
    for (const a of this.animated) a.update(t);
    this.forest.update(t);
    this.geyser.update(t, dt);
    this.mist.update(dt, 0.2);
  }
}
