// The island: palms that lean away from the action, ferns, fluted green peaks
// in the mist (think Kauai, think Isla Sorna), tiki torches, a rock rim.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { WALL_R } from "../../sim/rules.ts";
import { FLAME } from "./industry.ts";
import { bark, frond, rings } from "./textures.ts";

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// ---- the forest --------------------------------------------------------------
// Everything beyond the clearing is instanced: a handful of palm shapes, bushes
// and ferns, each one two draw calls however many are planted, swaying in the
// vertex shader. The clearing itself (the pan, the outposts, the view) stays open.
export const CLEARING = 26;                    // radius of the claimed ground

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

const swayUniform = { value: 0 };
/** Wind in the vertex shader: the higher a vertex, the more it leans, out of phase per instance. */
function swaying(m: THREE.MeshStandardMaterial, amp: number): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = swayUniform;
    sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float ph = instanceMatrix[3].x * 0.31 + instanceMatrix[3].z * 0.17;
      #else
        float ph = 0.0;
      #endif
      float h = max(position.y, 0.0);
      transformed.x += sin(uTime * 1.1 + ph) * ${amp.toFixed(3)} * h * h * 0.02;
      transformed.z += cos(uTime * 0.8 + ph * 1.3) * ${amp.toFixed(3)} * h * h * 0.015;`);
  };
  return m;
}

let barkMat: THREE.MeshStandardMaterial | null = null, leafMat: THREE.MeshStandardMaterial | null = null;
const materials = () => {
  barkMat ??= swaying(new THREE.MeshStandardMaterial({ map: bark(), roughness: 0.95 }), 0.25);
  leafMat ??= swaying(new THREE.MeshStandardMaterial({ map: frond(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7, color: 0xbfe8a0 }), 1);
  return { barkMat, leafMat };
};

/** A coconut palm as one geometry with two material groups: bark, then leaves. */
function palmGeometry(seed: number, height: number, lean: number): THREE.BufferGeometry {
  const r = rng(seed);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.15, height * 0.35, 0),
    new THREE.Vector3(lean * 0.55, height * 0.7, 0), new THREE.Vector3(lean, height, 0),
  ]);
  const segs: THREE.BufferGeometry[] = [], n = 9;
  for (let i = 0; i < n; i++) {                              // tapering trunk segments along the curve
    const a = curve.getPoint(i / n), b = curve.getPoint((i + 1) / n);
    const seg = new THREE.CylinderGeometry(0.2 * (1 - (i + 1) / n * 0.55), 0.2 * (1 - i / n * 0.55), a.distanceTo(b) * 1.04, 8);
    const m = new THREE.Matrix4().lookAt(b, a, new THREE.Vector3(0, 0, 1)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    m.setPosition(a.clone().add(b).multiplyScalar(0.5));
    segs.push(seg.applyMatrix4(m));
  }
  const top = curve.getPoint(1), cards: THREE.BufferGeometry[] = [], count = 11 + Math.floor(r() * 3);
  for (let i = 0; i < count; i++) {
    const yaw = (i / count) * Math.PI * 2 + r() * 0.3, pitch = 0.35 + r() * 0.75, s = 0.85 + r() * 0.45;
    const m = new THREE.Matrix4().makeTranslation(top.x, top.y, top.z).multiply(new THREE.Matrix4().makeRotationY(yaw))
      .multiply(new THREE.Matrix4().makeRotationX(-pitch)).multiply(new THREE.Matrix4().makeScale(s, s, s));
    cards.push(frondGeometry().clone().applyMatrix4(m));
  }
  return mergeGeometries([mergeGeometries(segs)!, mergeGeometries(cards)!], true)!;
}

/** A bush: a fan of fronds from one point (ferns are small ones). */
function bushGeometry(seed: number, fronds: number, scale: number): THREE.BufferGeometry {
  const r = rng(seed), cards: THREE.BufferGeometry[] = [];
  for (let k = 0; k < fronds; k++) {
    const s = scale * (0.7 + r() * 0.5), m = new THREE.Matrix4().makeRotationY(r() * 6.28)
      .multiply(new THREE.Matrix4().makeRotationX(-0.75 - r() * 0.6)).multiply(new THREE.Matrix4().makeScale(s, s, s));
    cards.push(frondGeometry().clone().applyMatrix4(m));
  }
  return mergeGeometries(cards)!;
}

/**
 * A dense jungle round a clearing. Palms keep out of a wedge between the camera
 * (to the south, +z) and the pan so nothing tall stands in the view; low bushes
 * and ferns fill that wedge instead.
 */
export function forest(): THREE.Group & { update(t: number): void } {
  const g = new THREE.Group() as THREE.Group & { update(t: number): void };
  const r = rng(99), { barkMat, leafMat } = materials();
  const place = (n: number, rMin: number, rMax: number, keep: (x: number, z: number, d: number) => boolean, gap: number) => {
    const out: { x: number; z: number; d: number; a: number }[] = [];
    for (let tries = 0; out.length < n && tries < n * 40; tries++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r() * (rMax * rMax - rMin * rMin) + rMin * rMin), x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!keep(x, z, d) || out.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < gap * gap)) continue;
      out.push({ x, z, d, a });
    }
    return out;
  };
  const inView = (x: number, z: number, d: number) => z > 0 && Math.abs(x) < 0.85 * z && d < 58;   // between the lens and the pan

  // palms: five shapes, instanced, leaning out of the clearing
  const palms = place(190, CLEARING + 1.5, 78, (x, z, d) => !inView(x, z, d), 2.4);
  const shapes = [0, 1, 2, 3, 4].map((i) => ({ geo: palmGeometry(i * 7 + 3, 8 + i * 1.7, 2 + i * 0.7), at: [] as typeof palms }));
  palms.forEach((p, i) => shapes[i % shapes.length]!.at.push(p));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  for (const sh of shapes) {
    const mesh = new THREE.InstancedMesh(sh.geo, [barkMat, leafMat], sh.at.length);
    sh.at.forEach((p, i) => {
      const s = (p.d < 36 ? 0.75 : 0.95) + r() * 0.5;                       // the edge palms are younger and shorter
      e.set(0, Math.atan2(-Math.sin(p.a), Math.cos(p.a)) + (r() - 0.5) * 0.9, 0); q.setFromEuler(e);   // lean away from the clearing
      m.compose(pos.set(p.x, -0.1, p.z), q, sc.set(s, s * (0.9 + r() * 0.25), s));
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = false; mesh.frustumCulled = false; g.add(mesh);
  }

  // bushes and ferns: thick everywhere beyond the cleared ground, including the view wedge
  const fill = (geo: THREE.BufferGeometry, n: number, rMin: number, rMax: number, size: [number, number], gap: number) => {
    const spots = place(n, rMin, rMax, () => true, gap);
    const mesh = new THREE.InstancedMesh(geo, leafMat, spots.length);
    spots.forEach((p, i) => { const s = size[0] + r() * (size[1] - size[0]); e.set(0, r() * 6.28, 0); q.setFromEuler(e); m.compose(pos.set(p.x, -0.05, p.z), q, sc.set(s, s, s)); mesh.setMatrixAt(i, m); });
    mesh.frustumCulled = false; g.add(mesh);
  };
  fill(bushGeometry(5, 9, 0.9), 420, CLEARING + 0.5, 70, [0.9, 1.7], 1.4);
  fill(bushGeometry(8, 7, 0.45), 360, CLEARING - 3, 55, [0.9, 1.5], 0.8);

  g.update = (t) => { swayUniform.value = t; };
  return g;
}

/** The claim: stumps and felled logs round the cleared edge, and stakes flying each baron's colour. */
export function claim(colors: number[]): THREE.Group {
  const g = new THREE.Group(), r = rng(55);
  const wood = new THREE.MeshStandardMaterial({ map: bark(), roughness: 0.95 }), cut = new THREE.MeshStandardMaterial({ map: rings(), roughness: 0.8 });
  for (let i = 0; i < 18; i++) {                              // stumps where the palms were cleared
    const a = r() * Math.PI * 2, d = CLEARING - 1 + r() * 2.2, h = 0.4 + r() * 0.5, rad = 0.35 + r() * 0.3;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad * 1.15, h, 10), [wood, cut, cut]);
    body.position.set(Math.cos(a) * d, h / 2, Math.sin(a) * d); body.castShadow = true; g.add(body);
  }
  for (let i = 0; i < 9; i++) {                               // felled trunks lying across the edge
    const a = r() * Math.PI * 2, d = CLEARING + 0.5 + r() * 2.5, len = 4 + r() * 3;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, len, 9), [wood, cut, cut]);
    log.rotation.set(Math.PI / 2, 0, a + Math.PI / 2 + (r() - 0.5) * 0.8); log.position.set(Math.cos(a) * d, 0.3, Math.sin(a) * d); log.castShadow = true; g.add(log);
  }
  const pole = new THREE.MeshStandardMaterial({ color: 0x8a7a3a, roughness: 0.7 });
  for (let i = 0; i < 24; i++) {                              // claim stakes with pennants, all the way round
    const a = (i / 24) * Math.PI * 2 + 0.05, d = CLEARING - 0.5;
    const stake = new THREE.Group(); stake.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 3.2, 6), pole); p.position.y = 1.6; p.castShadow = true; stake.add(p);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.5), new THREE.MeshStandardMaterial({ color: colors[i % colors.length]!, roughness: 0.8, side: THREE.DoubleSide }));
    flag.position.set(0.45, 2.95, 0); flag.rotation.y = -a; stake.add(flag);
    g.add(stake);
  }
  return g;
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
