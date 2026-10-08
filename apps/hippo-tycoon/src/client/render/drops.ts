import * as THREE from "three";
import { DROP_R, GOLD, NAIL, SLICK_R, SLUDGE, WATER } from "../../sim/rules.ts";
import { at } from "./arena.ts";

const oilMat = new THREE.MeshPhysicalMaterial({ color: 0x060606, metalness: 0.5, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.05 });
const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc933, metalness: 1, roughness: 0.18, emissive: 0xffa800, emissiveIntensity: 0.55, flatShading: true });
const sludgeMat = new THREE.MeshStandardMaterial({ color: 0x4b3318, roughness: 0.95, flatShading: true });
const steel = new THREE.MeshStandardMaterial({ color: 0xa5abb2, metalness: 1, roughness: 0.3 });
const waterMat = new THREE.MeshPhysicalMaterial({ color: 0x55b6ff, roughness: 0.05, transparent: true, opacity: 0.8, emissive: 0x0a3d66, emissiveIntensity: 0.5 });

function lump(): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(DROP_R * 1.05, 1);
  const p = geo.attributes.position!;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + 0.22 * Math.sin(i * 12.9898) * Math.cos(i * 4.1414);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, sludgeMat);
}

function bolt(): THREE.Group {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(DROP_R * 0.28, DROP_R * 0.28, DROP_R * 2, 8), steel));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(DROP_R * 0.62, DROP_R * 0.62, DROP_R * 0.4, 6), steel);
  head.position.y = DROP_R; g.add(head);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(DROP_R * 0.28, DROP_R * 0.7, 8), steel);
  tip.position.y = -DROP_R * 1.3; tip.rotation.x = Math.PI; g.add(tip);
  for (let i = 0; i < 4; i++) {   // the spikes that say "do not eat"
    const sp = new THREE.Mesh(new THREE.ConeGeometry(DROP_R * 0.14, DROP_R * 0.8, 5), steel);
    const a = (i / 4) * Math.PI * 2; sp.position.set(Math.cos(a) * DROP_R * 0.55, 0, Math.sin(a) * DROP_R * 0.55);
    sp.rotation.set(Math.sin(a) * 1.2, 0, -Math.cos(a) * 1.2); g.add(sp);
  }
  g.rotation.x = Math.PI / 2;
  const w = new THREE.Group(); w.add(g);
  return w;
}

/** A teardrop standing on its round end: water reads by shape, not only by blue. */
function tear(): THREE.Mesh {
  const R = DROP_R * 0.95, pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); pts.push(new THREE.Vector2(Math.cos(a) * R, Math.sin(a) * R)); }   // a round bottom
  for (let i = 1; i <= 10; i++) { const s = i / 10; pts.push(new THREE.Vector2(R * (1 - s) ** 1.6, s * R * 1.7)); }                                // tapering to a point
  return new THREE.Mesh(new THREE.LatheGeometry(pts, 18), waterMat);
}

// Every kind has its own silhouette as well as its own colour (for colour-blind players):
// oil a smooth ball, gold a faceted gem, sludge a lumpy clod, a nail a spiky bolt, water a teardrop.
function make(kind: number): THREE.Object3D {
  switch (kind) {
    case GOLD: return new THREE.Mesh(new THREE.OctahedronGeometry(DROP_R * 1.3, 0), goldMat);
    case SLUDGE: return lump();
    case NAIL: return bolt();
    case WATER: return tear();
    default: return new THREE.Mesh(new THREE.SphereGeometry(DROP_R, 20, 14), oilMat);
  }
}

export interface DropPos { id: number; kind: number; x: number; y: number }

/** One mesh per live drop id. */
export class DropLayer {
  readonly group = new THREE.Group();
  private live = new Map<number, THREE.Object3D>();
  private slicks = new Map<number, THREE.Mesh>();

  sync(drops: DropPos[], t: number) {
    const seen = new Set<number>();
    for (const d of drops) {
      seen.add(d.id);
      let m = this.live.get(d.id);
      if (!m) { m = make(d.kind); this.live.set(d.id, m); this.group.add(m); }
      // fresh drops are fired from the geyser: loft them in an arc that lands as they clear the vent
      const r = Math.hypot(d.x, d.y), loft = r < 2.6 ? 2.7 * (1 - (r / 2.6) ** 2) : 0;
      m.position.copy(at(d.x, d.y, DROP_R + 0.02 + loft));
      if (d.kind === NAIL || d.kind === SLUDGE) m.rotation.y = t * 3 + d.id;
      if (d.kind === GOLD) { m.scale.setScalar(1 + Math.sin(t * 9 + d.id) * 0.06); m.rotation.y = t * 2 + d.id; }
    }
    for (const [id, m] of this.live) if (!seen.has(id)) { this.group.remove(m); this.live.delete(id); }
  }

  syncSlicks(slicks: { id: number; x: number; y: number; life: number }[]) {
    const seen = new Set<number>();
    for (const k of slicks) {
      seen.add(k.id);
      let m = this.slicks.get(k.id);
      if (!m) {
        m = new THREE.Mesh(new THREE.CircleGeometry(SLICK_R, 28), new THREE.MeshStandardMaterial({ color: 0x241033, metalness: 0.9, roughness: 0.12, emissive: 0x3a1a00, emissiveIntensity: 0.5, transparent: true, opacity: 0.9 }));
        m.rotation.x = -Math.PI / 2; this.slicks.set(k.id, m); this.group.add(m);
      }
      m.position.copy(at(k.x, k.y, 0.03));
      (m.material as THREE.MeshStandardMaterial).opacity = Math.min(0.9, k.life / 60);
    }
    for (const [id, m] of this.slicks) if (!seen.has(id)) { this.group.remove(m); this.slicks.delete(id); }
  }
}
