// What is left of the oil business, gone to rust and vines in the jungle: a
// derrick, a nodding pump-jack, barrels. Plus the steam that drifts off the vent.
import * as THREE from "three";
import { puff } from "./textures.ts";

export const RUST = new THREE.MeshStandardMaterial({ color: 0x7a3f22, metalness: 0.8, roughness: 0.75 });
export const DARK_IRON = new THREE.MeshStandardMaterial({ color: 0x2c2a28, metalness: 0.8, roughness: 0.65 });
export const BRASS = new THREE.MeshStandardMaterial({ color: 0xc9971c, metalness: 1, roughness: 0.3 });
export const VINE = new THREE.MeshStandardMaterial({ color: 0x3f6a22, roughness: 0.8 });
export const FLAME = new THREE.MeshStandardMaterial({ color: 0xffb04a, emissive: 0xff7a1a, emissiveIntensity: 2.6, transparent: true, opacity: 0.95 });

export interface Animated { update(t: number): void }

const part = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
};

/** A nodding donkey pump-jack. The beam rocks about its pivot. */
export function pumpJack(phase: number): THREE.Group & Animated {
  const g = new THREE.Group() as THREE.Group & Animated;
  part(g, new THREE.BoxGeometry(2.8, 0.3, 1.2), DARK_IRON, 0, 0.15, 0);
  for (const s of [-1, 1]) part(g, new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), RUST, 0, 1.4, s * 0.35);
  const beam = new THREE.Group(); beam.position.set(0, 2.6, 0); g.add(beam);
  part(beam, new THREE.BoxGeometry(3.6, 0.22, 0.3), RUST, 0, 0, 0);
  const head = part(beam, new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14, 1, false, 0, Math.PI), RUST, 1.8, -0.1, 0); head.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  part(beam, new THREE.BoxGeometry(0.7, 0.6, 0.5), DARK_IRON, -1.5, -0.25, 0);
  part(g, new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), BRASS, 1.95, 1.5, 0);
  // a vine has taken the samson post
  part(g, new THREE.TorusGeometry(0.5, 0.04, 6, 14, Math.PI * 1.6), VINE, 0, 1.4, 0.35).rotation.y = Math.PI / 2;
  g.update = (t) => { beam.rotation.z = Math.sin(t * 1.3 + phase) * 0.22; };
  return g;
}

/** A lattice derrick, rusted, with vines hanging off it. */
export function derrick(h = 6): THREE.Group {
  const g = new THREE.Group();
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const leg = part(g, new THREE.CylinderGeometry(0.05, 0.09, h, 6), RUST, sx * 0.35, h / 2, sz * 0.35); leg.rotation.set(sz * 0.1, 0, -sx * 0.1);
  }
  for (let i = 1; i <= 4; i++) {
    const y = (i / 5) * h, w = 1.05 - (i / 5) * 0.8;
    part(g, new THREE.BoxGeometry(w, 0.06, w), RUST, 0, y, 0);
    part(g, new THREE.BoxGeometry(w * 1.3, 0.04, 0.04), RUST, 0, y + 0.3, 0).rotation.z = 0.7;
  }
  part(g, new THREE.BoxGeometry(0.4, 0.3, 0.4), DARK_IRON, 0, h + 0.1, 0);
  for (const [x, z, len] of [[0.4, 0.4, 3.2], [-0.4, 0.3, 2.2], [0.2, -0.4, 4.0]] as const) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, h - 0.3, z), new THREE.Vector3(x + 0.3, h - len * 0.4, z + 0.2), new THREE.Vector3(x + 0.1, h - len, z + 0.1)]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.035, 5), VINE));
  }
  return g;
}

/** Oil barrels, stacked by the hut. */
export function barrels(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0x1d1d20, metalness: 0.7, roughness: 0.5 }), band = new THREE.MeshStandardMaterial({ color: 0xb23a22, metalness: 0.5, roughness: 0.6 });
  for (const [x, y, z] of [[0, 0.5, 0], [1.05, 0.5, 0.2], [0.5, 1.5, 0.1]] as const) {
    part(g, new THREE.CylinderGeometry(0.46, 0.46, 1, 14), body, x, y, z);
    for (const dy of [-0.28, 0.28]) part(g, new THREE.CylinderGeometry(0.475, 0.475, 0.09, 14), band, x, y + dy, z);
  }
  return g;
}

interface Emitter { at: THREE.Vector3; rate: number; size: number; tint: number }
/** Soft sprites that rise, swell and fade: the steam off the geyser, the mist in the valley. */
export class Smoke {
  readonly group = new THREE.Group();
  private puffs: { s: THREE.Sprite; e: Emitter; t: number; life: number }[] = [];
  private tex = puff();
  constructor(emitters: Emitter[], per = 9, private rise = 9, private peak = 0.34) {
    for (const e of emitters) for (let i = 0; i < per; i++) {
      const mat = new THREE.SpriteMaterial({ map: this.tex, color: e.tint, transparent: true, depthWrite: false, opacity: 0 });
      const s = new THREE.Sprite(mat); this.group.add(s);
      this.puffs.push({ s, e, t: (i / per) * 6, life: 6 });
    }
  }
  update(dt: number, wind = 0.5) {
    for (const p of this.puffs) {
      p.t += dt * p.e.rate;
      if (p.t >= p.life) p.t -= p.life;
      const k = p.t / p.life;
      p.s.position.set(p.e.at.x + wind * k * 6 + Math.sin(p.t * 1.7) * 0.3, p.e.at.y + k * this.rise, p.e.at.z);
      p.s.scale.setScalar(p.e.size * (0.6 + k * 2.6));
      (p.s.material as THREE.SpriteMaterial).opacity = Math.sin(Math.min(1, k * 1.2) * Math.PI) * this.peak;
    }
  }
}
