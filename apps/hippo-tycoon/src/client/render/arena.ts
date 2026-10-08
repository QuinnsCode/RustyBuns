import * as THREE from "three";
import { A_REST, SEATS, WALL_R, seatAngle } from "../../sim/rules.ts";
import { BRASS, IRON, SOOT, Smoke, type Animated } from "./industry.ts";
import { buildOffice } from "./office.ts";
import { cobble, iron } from "./textures.ts";

/** Sim (x, y) on the pan -> three.js (x, height, -y). */
export const at = (x: number, y: number, h = 0) => new THREE.Vector3(x, h, -y);

function skyline(): THREE.Group {
  const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: 0x18110e, roughness: 1 });
  const win = new THREE.MeshBasicMaterial({ color: 0xffb45a });
  let x = 7;
  const r = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + r() * 0.05, d = 52 + r() * 14, w = 5 + r() * 7, h = 6 + r() * 12;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 5 + r() * 5), mat);
    b.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d); b.rotation.y = -a; g.add(b);
    for (let k = 0; k < 3; k++) if (r() < 0.6) {
      const wn = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.3), win);
      wn.position.set(Math.cos(a) * (d - 2.6) + (r() - 0.5) * 2, 2 + r() * (h - 3), Math.sin(a) * (d - 2.6)); wn.lookAt(0, wn.position.y, 0); g.add(wn);
    }
    if (r() < 0.45) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 14 + r() * 8, 8), mat);
      st.position.set(Math.cos(a + 0.04) * (d + 3), 7 + h / 2, Math.sin(a + 0.04) * (d + 3)); g.add(st);
    }
  }
  return g;
}

/** The pan, the town round it, and everything that moves without being asked. */
export class Arena {
  readonly group = new THREE.Group();
  private animated: Animated[] = [];
  private smoke: Smoke;

  constructor() {
    const g = this.group;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(WALL_R, 96), new THREE.MeshPhysicalMaterial({ map: iron(), roughness: 0.3, metalness: 0.9, clearcoat: 0.7, clearcoatRoughness: 0.2 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; g.add(floor);
    const rimIron = new THREE.Mesh(new THREE.TorusGeometry(WALL_R + 0.45, 0.55, 14, 96), IRON);
    rimIron.rotation.x = Math.PI / 2; rimIron.position.y = 0.25; rimIron.castShadow = true; g.add(rimIron);
    const rimBrass = new THREE.Mesh(new THREE.TorusGeometry(WALL_R + 0.05, 0.14, 10, 96), BRASS);
    rimBrass.rotation.x = Math.PI / 2; rimBrass.position.y = 0.42; g.add(rimBrass);
    const rivets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.16, 8, 6), BRASS, 72);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 72; i++) { const a = (i / 72) * Math.PI * 2; m.setPosition(Math.cos(a) * (WALL_R + 0.5), 0.82, Math.sin(a) * (WALL_R + 0.5)); rivets.setMatrixAt(i, m); }
    g.add(rivets);
    // the drip spout in the middle
    const spout = new THREE.Mesh(new THREE.LatheGeometry([[0.9, 0], [0.9, 0.18], [0.55, 0.3], [0.45, 0.7], [0.62, 0.78], [0.62, 0.9], [0.0, 0.9]].map(([x, y]) => new THREE.Vector2(x, y)), 24), BRASS);
    spout.castShadow = true; g.add(spout);
    const drain = new THREE.Mesh(new THREE.CircleGeometry(0.34, 20), SOOT); drain.rotation.x = Math.PI / 2; drain.position.y = 0.91; g.add(drain);

    const cob = cobble(70, 70);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshStandardMaterial({ map: cob, bumpMap: cob, bumpScale: 2, roughness: 0.95, color: 0x8a7a6c }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.06; ground.receiveShadow = true; g.add(ground);
    g.add(skyline());

    const stacks: { at: THREE.Vector3; rate: number; size: number; tint: number }[] = [];
    for (let i = 0; i < SEATS; i++) {
      const o = buildOffice(i), a = seatAngle(i);
      o.group.position.set(Math.cos(a) * A_REST, 0, -Math.sin(a) * A_REST);
      o.group.rotation.y = Math.atan2(Math.cos(a), -Math.sin(a));
      g.add(o.group);
      this.animated.push(...o.animated);
      o.group.updateMatrixWorld(true);
      stacks.push({ at: o.group.localToWorld(o.smokeAt.clone()), rate: 1, size: 2.2, tint: 0x8a8076 });
    }
    // far-off mills smoke too
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + 0.3; stacks.push({ at: new THREE.Vector3(Math.cos(a) * 58, 24, Math.sin(a) * 58), rate: 0.6, size: 6, tint: 0x6a5f55 }); }
    this.smoke = new Smoke(stacks);
    g.add(this.smoke.group);
  }

  update(t: number, dt: number) {
    for (const a of this.animated) a.update(t);
    this.smoke.update(dt);
  }
}
