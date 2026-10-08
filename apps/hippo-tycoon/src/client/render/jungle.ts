// The island: palms that lean away from the action, ferns, fluted green peaks
// in the mist (think Kauai, think Isla Sorna), tiki torches, a rock rim.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WALL_R } from "../../sim/rules.ts";
import { FLAME } from "./industry.ts";
import { bark, frond } from "./textures.ts";

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// ---- palms -------------------------------------------------------------------
let frondGeo: THREE.BufferGeometry | null = null;
/** One drooping frond card, bent along its length. */
function frondGeometry(): THREE.BufferGeometry {
  if (frondGeo) return frondGeo;
  const g = new THREE.PlaneGeometry(2.6, 5.4, 1, 10);
  g.translate(0, 2.7, 0);                                   // the stem end sits at the origin
  const p = g.attributes.position!;
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, -0.075 * y * y); }   // the droop
  g.computeVertexNormals();
  return (frondGeo = g);
}

let barkMat: THREE.Material | null = null, leafMat: THREE.Material | null = null;
const materials = () => {
  barkMat ??= new THREE.MeshStandardMaterial({ map: bark(), roughness: 0.95 });
  leafMat ??= new THREE.MeshStandardMaterial({ map: frond(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7, color: 0xbfe8a0 });
  return { barkMat, leafMat };
};

export interface Palm { group: THREE.Group; crown: THREE.Group; phase: number }

/** A coconut palm: a curved trunk and a crown of fronds, each merged into one mesh. */
export function palm(seed: number, height: number, leanX: number, leanZ: number): Palm {
  const r = rng(seed), { barkMat, leafMat } = materials();
  const group = new THREE.Group(), crown = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(leanX * 0.15, height * 0.35, leanZ * 0.15),
    new THREE.Vector3(leanX * 0.55, height * 0.7, leanZ * 0.55), new THREE.Vector3(leanX, height, leanZ),
  ]);
  const segs: THREE.BufferGeometry[] = [];
  const n = 9;
  for (let i = 0; i < n; i++) {                              // tapering trunk segments along the curve
    const a = curve.getPoint(i / n), b = curve.getPoint((i + 1) / n);
    const len = a.distanceTo(b), seg = new THREE.CylinderGeometry(0.2 * (1 - (i + 1) / n * 0.55), 0.2 * (1 - i / n * 0.55), len * 1.04, 8);
    const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 0, 1)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    segs.push(seg.applyMatrix4(m));
  }
  const trunk = new THREE.Mesh(mergeGeometries(segs)!, barkMat);
  trunk.castShadow = true; group.add(trunk);

  crown.position.copy(curve.getPoint(1));
  const cards: THREE.BufferGeometry[] = [];
  const count = 11 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + r() * 0.3, pitch = 0.35 + r() * 0.75, s = 0.85 + r() * 0.45;
    const m = new THREE.Matrix4().makeRotationY(yaw).multiply(new THREE.Matrix4().makeRotationX(-pitch)).multiply(new THREE.Matrix4().makeScale(s, s, s));
    cards.push(frondGeometry().clone().applyMatrix4(m));
  }
  const nuts = new THREE.MeshStandardMaterial({ color: 0x4a3a1c, roughness: 0.7 });
  for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), nuts); c.position.set((r() - 0.5) * 0.5, -0.25, (r() - 0.5) * 0.5); crown.add(c); }
  crown.add(new THREE.Mesh(mergeGeometries(cards)!, leafMat));
  group.add(crown);
  return { group, crown, phase: r() * 6.28 };
}

/** Low ferns for the ground cover: clusters of small fronds. */
export function ferns(seed: number, count: number): THREE.Mesh {
  const r = rng(seed), { leafMat } = materials(), cards: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const cx = (r() - 0.5) * 0.9, cz = (r() - 0.5) * 0.9, n = 5 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const s = 0.28 + r() * 0.22, m = new THREE.Matrix4().makeTranslation(cx, 0, cz)
        .multiply(new THREE.Matrix4().makeRotationY(r() * 6.28)).multiply(new THREE.Matrix4().makeRotationX(-0.9 - r() * 0.5)).multiply(new THREE.Matrix4().makeScale(s, s, s));
      cards.push(frondGeometry().clone().applyMatrix4(m));
    }
  }
  return new THREE.Mesh(mergeGeometries(cards)!, leafMat);
}

// ---- the far island ------------------------------------------------------------
/** Fluted, jungle-covered peaks fading into the haze, with one thin waterfall. */
export function mountains(): THREE.Group {
  const g = new THREE.Group(), r = rng(31);
  const peaks = 11;
  for (let i = 0; i < peaks; i++) {
    const a = (i / peaks) * Math.PI * 2 + r() * 0.2, d = 120 + r() * 40, h = 55 + r() * 45, w = 34 + r() * 22;
    const geo = new THREE.ConeGeometry(w, h, 56, 16, true);
    const p = geo.attributes.position!, col = new Float32Array(p.count * 3), phase = r() * 9;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), y = p.getY(k), z = p.getZ(k), ang = Math.atan2(z, x), t = (y + h / 2) / h;
      const flute = 1 + 0.2 * Math.sin(ang * 9 + phase) + 0.1 * Math.sin(ang * 21 + phase * 2) * (1 - t);   // sheer green ridges
      p.setX(k, x * flute); p.setZ(k, z * flute);
      p.setY(k, y + Math.sin(ang * 5 + phase) * 3 * t);
      const mist = Math.pow(1 - t, 2.2) * 0.55 + t * 0.12, base = new THREE.Color().setHSL(0.27 - t * 0.02, 0.5, 0.17 + t * 0.1);
      base.lerp(new THREE.Color(0x9fb59a), mist);
      col.set([base.r, base.g, base.b], k * 3);
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    m.position.set(Math.cos(a) * d, h / 2 - 6, Math.sin(a) * d);
    g.add(m);
    if (i === 3) {                                          // a waterfall down the face toward the pan
      const wf = new THREE.Mesh(new THREE.PlaneGeometry(2.4, h * 0.75), new THREE.MeshBasicMaterial({ color: 0xeaf6f2, transparent: true, opacity: 0.6, fog: true }));
      wf.position.set(Math.cos(a) * (d - w * 0.62), h * 0.42 - 6, Math.sin(a) * (d - w * 0.62)); wf.lookAt(0, wf.position.y, 0);
      g.add(wf);
    }
  }
  return g;
}

/** A ring of mossy boulders on the basin's lip. */
export function rockRim(): THREE.InstancedMesh {
  const r = rng(77), n = 52;
  const geo = new THREE.IcosahedronGeometry(1, 2), p = geo.attributes.position!;
  for (let i = 0; i < p.count; i++) { const k = 0.92 + r() * 0.16; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
  geo.computeVertexNormals();
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.97 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.06, s = 0.45 + r() * 0.45;
    e.set(r() * 3, r() * 3, r() * 3); q.setFromEuler(e);
    m.compose(new THREE.Vector3(Math.cos(a) * (WALL_R + 0.55), 0.15, Math.sin(a) * (WALL_R + 0.55)), q, new THREE.Vector3(s * 1.25, s * 0.85, s * 1.1));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, new THREE.Color().setHSL(0.2 + r() * 0.08, 0.14 + r() * 0.2, 0.045 + r() * 0.06));
  }
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

/** A tiki torch: a bamboo pole, a bowl and a flickering flame. */
export function torch(): THREE.Group & { update(t: number): void } {
  const g = new THREE.Group() as THREE.Group & { update(t: number): void };
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 3, 8), new THREE.MeshStandardMaterial({ color: 0x8a7a3a, roughness: 0.7 }));
  pole.position.y = 1.5; pole.castShadow = true; g.add(pole);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.1, 0.22, 10), new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 }));
  bowl.position.y = 3.05; g.add(bowl);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.6, 8), FLAME.clone()); flame.position.y = 3.4; g.add(flame);
  g.update = (t) => { flame.scale.set(1 + Math.sin(t * 17) * 0.1, 1 + Math.sin(t * 11 + 1) * 0.22 + Math.sin(t * 29) * 0.1, 1 + Math.cos(t * 13) * 0.1); };
  return g;
}
