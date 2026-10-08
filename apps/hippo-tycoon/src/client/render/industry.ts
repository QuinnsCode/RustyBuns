// The props that make it a Victorian oil town: cogs, a nodding pump-jack, a
// derrick, gaslamps, smoke. All primitives and extrusions; nothing loaded.
import * as THREE from "three";
import { puff } from "./textures.ts";

export const BRASS = new THREE.MeshStandardMaterial({ color: 0xc9971c, metalness: 1, roughness: 0.28 });
export const COPPER = new THREE.MeshStandardMaterial({ color: 0xb4622e, metalness: 1, roughness: 0.35 });
export const IRON = new THREE.MeshStandardMaterial({ color: 0x33363b, metalness: 0.85, roughness: 0.5 });
export const SOOT = new THREE.MeshStandardMaterial({ color: 0x1b1714, roughness: 0.95 });
export const GLOW = new THREE.MeshStandardMaterial({ color: 0xffb45a, emissive: 0xff9a3a, emissiveIntensity: 2.2 });

/** A cog: a toothed disc with a hub hole, extruded. */
export function gear(radius: number, teeth: number, mat: THREE.Material = BRASS, depth = 0.22): THREE.Mesh {
  const s = new THREE.Shape(), inner = radius * 0.82;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2, step = (Math.PI * 2) / teeth;
    const pts: [number, number][] = [[inner, a], [radius, a + step * 0.18], [radius, a + step * 0.42], [inner, a + step * 0.6]];
    pts.forEach(([r, ang], k) => { const x = Math.cos(ang) * r, y = Math.sin(ang) * r; if (i === 0 && k === 0) s.moveTo(x, y); else s.lineTo(x, y); });
  }
  s.closePath();
  const hole = new THREE.Path(); hole.absarc(0, 0, radius * 0.22, 0, Math.PI * 2, true); s.holes.push(hole);
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }), mat);
  m.castShadow = true;
  return m;
}

export interface Animated { update(t: number): void }

/** A nodding donkey pump-jack. The beam rocks about its pivot. */
export function pumpJack(phase: number): THREE.Group & Animated {
  const g = new THREE.Group() as THREE.Group & Animated;
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  add(new THREE.BoxGeometry(2.8, 0.3, 1.2), SOOT, 0, 0.15, 0);
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.07, 0.07, 2.6, 6), IRON, 0, 1.4, s * 0.35).rotation.z = 0;       // the samson posts
  const beam = new THREE.Group(); beam.position.set(0, 2.6, 0); g.add(beam);
  add(new THREE.BoxGeometry(3.6, 0.22, 0.3), COPPER, 0, 0, 0, beam);
  const head = add(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14, 1, false, 0, Math.PI), COPPER, 1.8, -0.1, 0, beam); head.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  add(new THREE.BoxGeometry(0.7, 0.6, 0.5), IRON, -1.5, -0.25, 0, beam);                                                   // counterweight
  add(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 6), BRASS, 1.95, 1.5, 0);                                                // polished rod
  g.update = (t) => { beam.rotation.z = Math.sin(t * 1.3 + phase) * 0.22; };
  return g;
}

/** A lattice derrick: four leaning legs, braces, a crown block. */
export function derrick(h = 6): THREE.Group {
  const g = new THREE.Group();
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, h, 6), IRON);
    leg.position.set(sx * 0.35, h / 2, sz * 0.35); leg.rotation.set(sz * 0.1, 0, -sx * 0.1); leg.castShadow = true; g.add(leg);
  }
  for (let i = 1; i <= 4; i++) {
    const y = (i / 5) * h, w = 1.05 - (i / 5) * 0.8;
    const ring = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, w), IRON); ring.position.y = y; g.add(ring);
    const x = new THREE.Mesh(new THREE.BoxGeometry(w * 1.3, 0.04, 0.04), IRON); x.position.y = y + 0.3; x.rotation.z = 0.7; g.add(x);
  }
  const crown = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), BRASS); crown.position.y = h + 0.1; g.add(crown);
  return g;
}

/** A gaslamp: iron post, brass collar, a lantern that actually glows (bloom does the rest). */
export function gasLamp(): THREE.Group & Animated {
  const g = new THREE.Group() as THREE.Group & Animated;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 3.2, 8), IRON); post.position.y = 1.6; post.castShadow = true; g.add(post);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.16, 8), BRASS); collar.position.y = 2.4; g.add(collar);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.5, 0.38), GLOW.clone()); lantern.position.y = 3.45; g.add(lantern);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.26, 4), IRON); cap.position.y = 3.83; cap.rotation.y = Math.PI / 4; g.add(cap);
  const mat = lantern.material as THREE.MeshStandardMaterial;
  g.update = (t) => { mat.emissiveIntensity = 2.2 + Math.sin(t * 9) * 0.15 + Math.sin(t * 23.7) * 0.1; };
  return g;
}

interface Emitter { at: THREE.Vector3; rate: number; size: number; tint: number }
/** Chimney smoke: a ring of soft sprites per stack that rise, swell and fade. */
export class Smoke {
  readonly group = new THREE.Group();
  private puffs: { s: THREE.Sprite; e: Emitter; t: number; life: number }[] = [];
  private tex = puff();
  constructor(private emitters: Emitter[], per = 9) {
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
      p.s.position.set(p.e.at.x + wind * k * 6 + Math.sin(p.t * 1.7) * 0.3, p.e.at.y + k * 9, p.e.at.z);
      p.s.scale.setScalar(p.e.size * (0.6 + k * 2.6));
      (p.s.material as THREE.SpriteMaterial).opacity = Math.sin(Math.min(1, k * 1.2) * Math.PI) * 0.34;
    }
  }
}
