// The cannon sector's shore, for the eye only: sand running down into see-through shallows on the +x
// edge (ankle-deep at the field's edge, so nobody wades in over their boots), a sea with gentle waves
// past it, reefs under the water, and the headland the cannon sits on.
import * as THREE from "three";
import type { Battle } from "../sim.ts";
import { shoreX } from "../sim.ts";
import { texture } from "../models.ts";
import { mergeAll } from "../foliage.ts";
import type { Kit } from "../landmarks.ts";

type Noise = (x: number, z: number, octaves?: number) => number;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// How far east of the waterline a spot is (negative: inland); the waterline wanders with z.
// Past the field's two ends the coast bends inland, so the sea wraps round them and shows from the spawn
// and the keep, not only at the +x edge; the field itself keeps its straight shore.
export const shoreAt = (b: Battle, n: Noise, z: number) => shoreX(b) + n(z / 50, 9) * 10 - 150 * smooth(b.half + 5, b.half + 60, Math.abs(z));
export const coastOf = (b: Battle, n: Noise, x: number, z: number) => x - shoreAt(b, n, z);
// The headland behind the cannon's base: a steep-sided plateau of rock the gun looks out from.
export const headland = (b: Battle, x: number, z: number) => {
  const keep = b.posts.at(-1)!, d = Math.hypot(x - (keep.x - 12), z - (keep.z - 42));
  return 14 * Math.exp(-((d / 30) ** 4));
};

// Water lying over the shallows: clear and pale over the sand, deepening to blue, waves rolling in, a
// few foam lines running up the beach. Returns the per-frame update.
export function buildSea(scene: THREE.Scene, b: Battle, n: Noise, level: number, heightAt: (x: number, z: number) => number) {
  const x0 = shoreX(b) - 190, W = 790, D = b.half * 5, SX = 128, SZ = 280;
  const geo = new THREE.PlaneGeometry(W, D, SX, SZ).rotateX(-Math.PI / 2).translate(x0 + W / 2, level, 0);
  const pos = geo.attributes.position as THREE.BufferAttribute, rgba: number[] = [];
  const shallow = new THREE.Color(0x6fe0d0), deep = new THREE.Color(0x0a4f8c), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const depth = level - heightAt(pos.getX(i), pos.getZ(i));
    c.copy(shallow).lerp(deep, smooth(0.3, 6, depth));
    rgba.push(c.r, c.g, c.b, depth < 0 ? 0 : 0.2 + 0.7 * smooth(0, 5, depth));
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(rgba, 4));
  const uTime = { value: 0 };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.12, metalness: 0.05, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = "uniform float uTime;\n" + sh.vertexShader
      .replace("#include <beginnormal_vertex>", `#include <beginnormal_vertex>
        float wa = position.x * 0.21 + uTime * 0.9, wb = position.z * 0.16 - uTime * 0.7;
        objectNormal = normalize(vec3(-cos(wa) * 0.0126 - cos(wb * 2.1) * 0.02, 1.0, -cos(wb) * 0.0096 + cos(wa * 1.7) * 0.015));`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
        transformed.y += sin(wa) * 0.06 + sin(wb) * 0.05;`);
  };
  const sea = new THREE.Mesh(geo, mat);
  sea.renderOrder = 1;
  scene.add(sea);

  // Foam: lines of surf following the waterline, each rolling up the beach and fading as it goes.
  const foamTex = texture("surf", 256, 32, [60, 1], (g, r) => {
    g.clearRect(0, 0, 256, 32);
    for (let i = 0; i < 420; i++) { g.fillStyle = `rgba(255,255,255,${0.25 + r() * 0.6})`; g.beginPath(); g.ellipse(r() * 256, 4 + r() * 24, 2 + r() * 6, 1 + r() * 1.8, 0, 0, 7); g.fill(); }
    const fade = g.createLinearGradient(0, 0, 0, 32);
    fade.addColorStop(0, "rgba(0,0,0,1)"); fade.addColorStop(0.35, "rgba(0,0,0,0)"); fade.addColorStop(0.65, "rgba(0,0,0,0)"); fade.addColorStop(1, "rgba(0,0,0,1)");
    g.globalCompositeOperation = "destination-out"; g.fillStyle = fade; g.fillRect(0, 0, 256, 32);
  });
  const foamMat = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, opacity: 0.8, fog: true });
  const zs = Array.from({ length: 121 }, (_, i) => -b.half * 2.5 + (i * b.half * 5) / 120);
  const lines = [0, 1, 2].map((i) => {
    const ribbon = new THREE.BufferGeometry(), v: number[] = [], uv: number[] = [], idx: number[] = [];
    zs.forEach((z, j) => {
      const x = shoreAt(b, n, z);
      v.push(x - 1.4, 0, z, x + 1.4, 0, z);
      uv.push(j / 4, 0, j / 4, 1);
      if (j) { const a = j * 2; idx.push(a - 2, a - 1, a, a - 1, a + 1, a); }
    });
    ribbon.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    ribbon.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    ribbon.setIndex(idx);
    const mesh = new THREE.Mesh(ribbon, foamMat.clone());
    mesh.renderOrder = 2;
    scene.add(mesh);
    return { mesh, phase: i / 3 };
  });
  return (t: number) => {
    uTime.value = t;
    for (const l of lines) {
      const f = (t * 0.07 + l.phase) % 1; // 0 at the waterline, 1 far out in the shallows
      l.mesh.position.set(8 + f * 48, level + 0.1, 0);
      (l.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * Math.sin(Math.PI * Math.min(1, f * 1.1)) ** 1.5;
    }
  };
}

// What the shore is dressed with: palms, driftwood, tide pools, shells, tank traps on the sand, reefs
// under the water, and the cannon on its headland. Returns what moves each frame (the gun's slow sweep).
export function cannonCoast(k: Kit) {
  const { b, keep, heightAt, solid, std, r, bare, inst, wind } = k;
  const { inst: mk, put, done } = inst;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color(), e = new THREE.Euler();
  const UP = new THREE.Vector3(0, 1, 0);
  const at = (x: number, y: number, z: number, ry: number, sx: number, sy = sx, sz = sx) => m.compose(p.set(x, y, z), q.setFromAxisAngle(UP, ry), s.set(sx, sy, sz));
  const level = -0.02, shore = shoreX(b);
  const spot = (ok: (x: number, z: number, h: number) => boolean, spread = 1.05) => {
    for (let i = 0; i < 40; i++) {
      const a = k.anywhere(spread), h = heightAt(a.x, a.z);
      if (ok(a.x, a.z, h)) return a;
    }
    return null;
  };
  const dry = (x: number, z: number, h: number) => h > level + 0.9 && !bare(x, z, 3) && Math.hypot(x - keep.x, z - keep.z + 24) > 14;

  // Palms: a leaning trunk and a crown of drooping fronds, most of them on the dunes towards the sea.
  const frondTex = texture("palm-frond", 64, 256, [1, 1], (g, rr) => {
    g.clearRect(0, 0, 64, 256);
    g.strokeStyle = "#cfcfcf"; g.lineWidth = 3; g.beginPath(); g.moveTo(32, 256); g.lineTo(32, 4); g.stroke();
    for (let y = 250; y > 8; y -= 5) {
      const len = 8 + 22 * Math.sin(((256 - y) / 256) * Math.PI * 0.9);
      for (const sd of [-1, 1]) { g.fillStyle = `rgb(${190 + rr() * 65},${190 + rr() * 65},${190 + rr() * 65})`; g.beginPath(); g.ellipse(32 + sd * len * 0.5, y + 4, len * 0.5, 1.8, sd * 0.7, 0, 7); g.fill(); }
    }
  });
  const frond = new THREE.PlaneGeometry(0.9, 5, 1, 8).translate(0, 2.5, 0);
  const fp = frond.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < fp.count; i++) { const f = fp.getY(i) / 5; fp.setXYZ(i, fp.getX(i), 5 * (0.55 * f - 0.9 * f * f * 0.5), -5 * f * 0.9); }
  const crownGeo = mergeAll(Array.from({ length: 9 }, (_, i) => frond.clone().rotateX(-0.08 * (i % 3)).rotateY((i / 9) * Math.PI * 2 + (i % 2) * 0.3)));
  crownGeo.computeVertexNormals();
  const nPalms = Math.round(70 * Math.min(1.6, (b.half / 180) ** 2));
  const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 5.5, 0), new THREE.Vector3(3.8, 10, 0));
  const trunkGeo = new THREE.TubeGeometry(curve, 8, 1, 6, false);
  const tp = trunkGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) { // thin towards the top: the tube is unit radius, so shrink each ring about its centre
    const f = Math.floor(i / 7) / 8, ctr = curve.getPoint(f), ring = 0.22 - 0.1 * f;
    tp.setXYZ(i, ctr.x + (tp.getX(i) - ctr.x) * ring, tp.getY(i), tp.getZ(i) * ring);
  }
  trunkGeo.computeVertexNormals();
  const trunks = mk(trunkGeo, wind.patch(std(0x9a8062, 0.95), { h: 10, amp: 0.12, bend: 0.3 }), nPalms, true);
  const crowns = mk(crownGeo, wind.patch(std(0xffffff, 0.8, { map: frondTex, alphaTest: 0.45, side: THREE.DoubleSide }), { h: 5, amp: 0.4, bend: 2.5 }), nPalms, true);
  for (let i = 0; i < nPalms * 12 && trunks.count < nPalms; i++) {
    const a = spot((x, z, h) => dry(x, z, h) && (r() < 0.7 ? x > shore - 70 && x < shore - 4 : x > -b.half), 1);
    if (!a) continue;
    const h = 7 + r() * 6, ry = r() * 6.3, y = heightAt(a.x, a.z);
    c.setHSL(0.09, 0.2, 0.4 + r() * 0.1);
    put(trunks, at(a.x, y - 0.1, a.z, ry, h / 10), c);
    p.set(0.38 * h, h, 0).applyQuaternion(q.setFromAxisAngle(UP, ry));
    c.setHSL(0.25 + r() * 0.05, 0.55, 0.28 + r() * 0.08);
    put(crowns, at(a.x + p.x, y + p.y - 0.2, a.z + p.z, r() * 6, 1.3 + r() * 0.5), c);
  }
  done(trunks, crowns);

  // Driftwood bleached by the sun, in drifts along the tide line; the rest of it lies in the sim's cover.
  const wood = mk(new THREE.CylinderGeometry(0.1, 0.14, 1, 6).rotateZ(Math.PI / 2), std(0xffffff, 1), 44, true);
  for (let i = 0; i < 400 && wood.count < 44; i++) {
    const a = spot((x, z, h) => h > level + 0.15 && h < level + 1 && !bare(x, z, 1), 1);
    if (!a) continue;
    const len = 1.2 + r() * 4.5, y = heightAt(a.x, a.z);
    c.setHSL(0.09, 0.15, 0.55 + r() * 0.2);
    q.setFromEuler(e.set((r() - 0.5) * 0.2, r() * 6.3, (r() - 0.5) * 0.2));
    put(wood, m.compose(p.set(a.x, y + 0.1, a.z), q, s.set(len, 1 + r(), 1 + r())), c);
  }
  done(wood);

  // Tide pools on the wet sand, ringed in stones, with shells scattered about.
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x66d6d2, roughness: 0.05, transparent: true, opacity: 0.72, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const pools = mk(new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), poolMat, 16, false, false);
  const stones = mk(new THREE.IcosahedronGeometry(0.5, 0), std(0xffffff, 0.9, { flatShading: true }), 16 * 9, true);
  for (let i = 0; i < 600 && pools.count < 16; i++) {
    const a = spot((x, z, h) => h > level + 0.2 && h < level + 0.8 && !bare(x, z, 0), 1);
    if (!a) continue;
    const rad = 1.4 + r() * 2.6, y = heightAt(a.x, a.z);
    put(pools, at(a.x, y + 0.04, a.z, 0, rad, 1, rad * (0.7 + r() * 0.4)));
    for (let j = 0; j < 9; j++) {
      const an = (j / 9) * 6.3 + r() * 0.5, sz = 0.3 + r() * 0.5;
      c.setHSL(0.1, 0.08, 0.3 + r() * 0.25);
      put(stones, at(a.x + Math.cos(an) * rad * 1.05, y + sz * 0.15, a.z + Math.sin(an) * rad * 0.9, r() * 6, sz * 1.3, sz * 0.7, sz), c);
    }
  }
  done(pools, stones);
  const shells = mk(new THREE.ConeGeometry(0.5, 0.8, 7).rotateX(Math.PI / 2).translate(0, 0.1, 0), std(0xffffff, 0.5), 180, false);
  for (let i = 0; i < 700 && shells.count < 180; i++) {
    const a = spot((x, z, h) => h > level + 0.1 && h < level + 1.6 && !bare(x, z, 0), 1);
    if (!a) continue;
    c.setHSL(0.05 + r() * 0.05, 0.4, 0.75 + r() * 0.2);
    q.setFromEuler(e.set(0, r() * 6.3, 0));
    put(shells, m.compose(p.set(a.x, heightAt(a.x, a.z) + 0.03, a.z), q, s.set(0.3, 0.3, 0.4).multiplyScalar(0.7 + r() * 0.8)), c);
  }
  done(shells);

  // Czech hedgehogs: three crossed girders to stop landing craft, rusted, along the shallows.
  const girder = mergeAll([new THREE.BoxGeometry(0.35, 3, 0.35).rotateZ(0.8), new THREE.BoxGeometry(0.35, 3, 0.35).rotateX(0.8).rotateY(1), new THREE.BoxGeometry(0.35, 3, 0.35).rotateZ(-0.8).rotateY(2)]);
  girder.computeVertexNormals();
  const traps = mk(girder, std(0x7a5a44, 0.8, { metalness: 0.3 }), 26, true);
  for (let i = 0; i < 300 && traps.count < 26; i++) {
    const a = spot((x, z, h) => x > shore - 10 && h > level - 0.4 && h < level + 0.6 && !bare(x, z, 2), 1);
    if (!a) continue;
    c.setHSL(0.05, 0.4, 0.2 + r() * 0.12);
    put(traps, at(a.x, heightAt(a.x, a.z) + 1.1, a.z, r() * 6, 1, 1, 1), c);
  }
  done(traps);

  // Reefs under the water: dark rock with coral growing off it, clustered, so they glow through the shallows.
  const coralGeo = mergeAll([0, 1, 2, 3, 4].map((i) => new THREE.ConeGeometry(0.22, 1.2, 5).translate(0, 0.6, 0).rotateZ((i - 2) * 0.35).rotateY(i * 1.3)));
  coralGeo.computeVertexNormals();
  const reefRock = mk(new THREE.IcosahedronGeometry(0.5, 1), std(0xffffff, 0.95, { flatShading: true }), 150, false);
  const coral = mk(coralGeo, std(0xffffff, 0.7), 380, false);
  for (let i = 0; i < 40; i++) {
    const a = spot((x, z, h) => h < level - 0.1 && h > level - 5 && x < b.half + 70, 1.3);
    if (!a) continue;
    const reefs = 4 + Math.floor(r() * 5);
    for (let j = 0; j < reefs; j++) {
      const x = a.x + (r() - 0.5) * 22, z = a.z + (r() - 0.5) * 22, y = heightAt(x, z);
      if (y > level - 0.1 || x < shore + 6) continue;
      const sz = 0.8 + r() * 2.2;
      c.setHSL(0.08, 0.3, 0.12 + r() * 0.12);
      put(reefRock, at(x, y + sz * 0.1, z, r() * 6, sz * 1.5, sz * 0.7, sz), c);
      for (let f = 0; f < 3; f++) {
        const cx = x + (r() - 0.5) * sz * 1.4, cz = z + (r() - 0.5) * sz * 1.4, cy = heightAt(cx, cz), w = 0.4 + r() * 0.8;
        c.setHSL([0.0, 0.95, 0.85, 0.75, 0.08][Math.floor(r() * 5)]! + r() * 0.03, 0.75, 0.52);
        put(coral, at(cx, cy, cz, r() * 6, w, w * (0.8 + r()), w), c);
      }
    }
  }
  done(reefRock, coral);

  // The gun on its base: a sandbagged ring, a long barrel on a cradle, ammunition stacked beside it, a flag.
  const bx = keep.x - 12, bz = keep.z - 28, top = heightAt(bx, bz);
  const iron = std(0x4a5058, 0.45, { metalness: 0.55 }), canvas = std(0xcfc3a0, 0.95), pale = std(0xe9e1cc, 0.9);
  const ring = mk(new THREE.CapsuleGeometry(0.28, 0.9, 2, 6).rotateZ(Math.PI / 2), canvas, 120, true);
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 28; i++) {
    const a = (i / 28) * 6.283 + layer * 0.11, rad = 6.2;
    c.setHSL(0.11, 0.25, 0.5 + r() * 0.1);
    if (Math.cos(a) * 1 < -0.2 && Math.sin(a) < -0.3) continue; // open at the back, where the shells come up
    put(ring, at(bx + Math.cos(a) * rad, top + 0.25 + layer * 0.5, bz + Math.sin(a) * rad, -a + Math.PI / 2, 1), c);
  }
  done(ring);
  solid(new THREE.CylinderGeometry(3.2, 3.6, 0.6, 20), std(0x6a6a62, 0.8), bx, top + 0.3, bz);
  const turret = new THREE.Group();
  turret.position.set(bx, top + 0.6, bz);
  const cradle = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.4, 3.4).translate(0, 1.2, 0), iron);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 4.4).translate(2, 2.6, 0), std(0x5f666e, 0.5, { metalness: 0.4 }));
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.1, 17, 14).translate(0, 8.5, 0), iron);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.8, 1.6, 14).translate(0, 17.4, 0), std(0x2e3338, 0.5, { metalness: 0.5 }));
  const gun = new THREE.Group();
  gun.add(barrel, muzzle);
  gun.position.set(0, 2.4, 0);
  gun.rotation.set(0, 0, -1.22); // up and out over the sea
  gun.rotation.order = "ZYX";
  turret.add(cradle, shield, gun);
  turret.traverse((o) => { o.castShadow = o.receiveShadow = true; });
  k.add(turret);
  for (let i = 0; i < 6; i++) solid(new THREE.CylinderGeometry(0.4, 0.4, 1.4, 10), pale, bx - 4.4 + (i % 3) * 0.95, top + 0.7 + Math.floor(i / 3) * 0.02, bz + 2.8 - Math.floor(i / 3) * 0.95).rotation.z = 0;
  const pole = solid(new THREE.CylinderGeometry(0.06, 0.06, 7, 6), pale, bx - 6.8, top + 3.5, bz - 5.6);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.2).translate(1.1, 0, 0), new THREE.MeshStandardMaterial({ color: 0xd2492a, side: THREE.DoubleSide, roughness: 0.9 }));
  flag.position.set(0, 2.6, 0);
  pole.add(flag);

  // Boulders stepping up the headland to the gun, and the rock at the foot of the base.
  const cliff = mk(new THREE.IcosahedronGeometry(0.5, 1), std(0xffffff, 0.95, { flatShading: true }), 90, true);
  for (let i = 0; i < 90; i++) {
    const an = r() * 6.283, d = 6 + r() * 26, x = bx + Math.cos(an) * d * 1.2 + 2, z = bz - 8 - Math.abs(Math.sin(an)) * d;
    const y = heightAt(x, z), sz = 1.2 + r() * 3.6;
    if (heightAt(x, z) < 0.8) continue;
    c.setHSL(0.11, 0.18, 0.45 + r() * 0.2);
    q.setFromEuler(e.set(r() * 0.5, r() * 6.3, r() * 0.5));
    put(cliff, m.compose(p.set(x, y + sz * 0.2, z), q, s.set(sz * 1.3, sz * 0.8, sz)), c);
  }
  done(cliff);
  return (t: number) => { turret.rotation.y = -0.4 + Math.sin(t * 0.12) * 0.35; };
}
