// The dust sea: wind-carved hoodoos and dunes round the sim's cliffs, bones half in the sand, ruined
// moisture farms (domed huts and vaporator towers) and wrecked haulers, one half-buried by the keep
// under a tall mast. The huts and wrecks are sim blocks (kind "hut" and "wreck"); this dresses them.
import * as THREE from "three";
import { mergeAll } from "../foliage.ts";
import { texture } from "../models.ts";
import type { Kit } from "../landmarks.ts";

// Sandstone in warm layers, bright so the light carries it (the cliffs repeat it, the hoodoos show it once).
export const sandstone = (repeat = 1) => texture(`sandstone${repeat}`, 32, 128, [repeat, repeat], (c, r) => {
  for (let y = 0; y < 128; y += 2) { const v = 0.5 + 0.5 * Math.sin(y * 0.16 + Math.sin(y * 0.05) * 2); c.fillStyle = `rgb(${200 + 45 * v + r() * 10},${150 + 50 * v + r() * 10},${105 + 45 * v})`; c.fillRect(0, y, 32, 2); }
});

export function desert({ b, keep, ky, heightAt, solid, add, std, r, bare, anywhere, inst: { inst, put, done } }: Kit) {
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color();
  const at = (mesh: THREE.InstancedMesh, x: number, y: number, z: number, sx: number, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0, color?: THREE.Color) =>
    put(mesh, m.compose(p.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s.set(sx, sy, sz)), color);
  const outside = (x: number, z: number) => Math.max(Math.abs(x), Math.abs(z)) > b.half;
  const sand = std(0xffffff, 1), bone = std(0xe9e0c8, 0.8), rust = std(0x8b6446, 0.7, { metalness: 0.3 }), dark = std(0x2c2724, 0.9), metal = std(0xa5a49a, 0.4, { metalness: 0.5 });
  const plaster = std(0xffffff, 0.95);
  const tint = (h: number, sat: number, l: number) => c.setHSL(h, sat, l);

  // Dunes: long soft ellipsoids, low on the field and big beyond it; and the drifts piled against the cliffs.
  const dunes = inst(new THREE.SphereGeometry(1, 28, 14), sand, 150, false);
  for (let i = 0; i < 400 && dunes.count < 90; i++) {
    const a = anywhere(1.6), out = Math.max(Math.abs(a.x), Math.abs(a.z)) > b.half + 30;
    if (!out && (outside(a.x, a.z) || bare(a.x, a.z, 5))) continue;
    const w = out ? 30 + r() * 40 : 7 + r() * 10, h = out ? 4 + r() * 8 : 0.25 + r() * 0.3;
    at(dunes, a.x, heightAt(a.x, a.z) - h * 0.3, a.z, w, h, w * (0.3 + r() * 0.3), r() * 3, 0, 0, tint(0.1, 0.5, 0.56 + r() * 0.1));
  }
  for (const k of b.blocks) if (!k.kind && k.h >= 1.6) at(dunes, k.x + k.w * 0.4, heightAt(k.x, k.z) - 0.4, k.z + k.d * 0.3, k.w * 1.1, Math.min(2, k.h * 0.25), k.d * 0.8, 0.3, 0, 0, tint(0.1, 0.5, 0.58));

  // Hoodoos beyond the field: stacked, undercut sandstone, banded.
  const stack = mergeAll([[3, 5, 6, 0], [4.6, 3.6, 3, 7], [3.2, 4.2, 5, 11], [5.4, 3.4, 2.6, 15]].map(([r0, r1, h, y]) => new THREE.CylinderGeometry(r1!, r0!, h!, 9).translate(0, y! + h! / 2, 0)));
  stack.computeVertexNormals();
  const hoodoos = inst(stack, std(0xffffff, 0.95, { map: sandstone() }), 60, true);
  for (let i = 0; i < 300 && hoodoos.count < 46; i++) {
    const a = anywhere(1.7);
    if (!outside(a.x, a.z) && !(Math.abs(a.x) > 66 * (b.half / 180))) continue;
    const k = 0.8 + r() * 1.6;
    at(hoodoos, a.x, heightAt(a.x, a.z) - 1.5, a.z, k, k * (0.8 + r() * 1.1), k, r() * 6, 0, (r() - 0.5) * 0.08);
  }

  // Bones: ribcages standing in rows, spines, skulls with horns, and loose ones.
  const rib = inst(new THREE.TorusGeometry(1, 0.07, 5, 12, Math.PI), bone, 130, true);
  const spine = inst(new THREE.CylinderGeometry(0.12, 0.16, 1, 6).rotateX(Math.PI / 2), bone, 14, true);
  const skullGeo = mergeAll([new THREE.SphereGeometry(0.5, 10, 8).scale(1, 0.85, 1.5), new THREE.ConeGeometry(0.14, 0.9, 6).rotateX(Math.PI / 2).translate(0, -0.1, 1.0).scale(1.4, 1, 1), new THREE.ConeGeometry(0.09, 1.2, 5).rotateZ(-1.1).translate(0.55, 0.5, 0.2), new THREE.ConeGeometry(0.09, 1.2, 5).rotateZ(1.1).translate(-0.55, 0.5, 0.2)]);
  skullGeo.computeVertexNormals();
  const skulls = inst(skullGeo, bone, 12, true);
  const loose = inst(new THREE.CylinderGeometry(0.06, 0.08, 1, 5).rotateZ(Math.PI / 2), bone, 120, true);
  for (let i = 0; i < 400 && spine.count < 12; i++) {
    const a = anywhere(1.2);
    if (bare(a.x, a.z, 6)) continue;
    const size = 2 + r() * 2.4, yaw = r() * 6, n = 7 + Math.floor(r() * 3), y = heightAt(a.x, a.z);
    at(spine, a.x, y + size * 0.5, a.z, size, size, size * n * 0.42, yaw);
    for (let j = 0; j < n; j++) {
      const t = (j - (n - 1) / 2) * 0.42 * size, k = size * (0.55 + 0.45 * Math.cos((j - (n - 1) / 2) * 0.45));
      at(rib, a.x + Math.sin(yaw) * t, y + size * 0.15, a.z + Math.cos(yaw) * t, k, k, k, yaw + Math.PI / 2, 0, (r() - 0.5) * 0.15);
    }
    if (skulls.count < 8) at(skulls, a.x + Math.sin(yaw) * (n * 0.25 * size + 1), y + 0.3, a.z + Math.cos(yaw) * (n * 0.25 * size + 1), size * 0.8, size * 0.8, size * 0.8, yaw + Math.PI + (r() - 0.5), 0.1, (r() - 0.5) * 0.4);
  }
  for (let i = 0; i < 400 && loose.count < 100; i++) { const a = anywhere(1.2); if (!bare(a.x, a.z, 3)) at(loose, a.x, heightAt(a.x, a.z) + 0.05, a.z, 0.6 + r() * 1.6, 1, 1, r() * 6, 0, 0, tint(0.12, 0.3, 0.8 + r() * 0.15)); }
  for (let i = 0; i < 80 && skulls.count < 12; i++) { const a = anywhere(1.2); if (!bare(a.x, a.z, 3)) at(skulls, a.x, heightAt(a.x, a.z) + 0.1, a.z, 0.4 + r() * 0.5, 0.4 + r() * 0.5, 0.4 + r() * 0.5, r() * 6, 0.2, (r() - 0.5) * 0.6); }

  // Moisture farms: domed huts on the sim's hut blocks, with vaporator towers round them.
  const wall = inst(new THREE.CylinderGeometry(3.4, 3.5, 1.8, 14).translate(0, 0.9, 0), plaster, 8, true);
  const dome = inst(new THREE.SphereGeometry(3.4, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1).translate(0, 1.8, 0), plaster, 8, true);
  const door = inst(new THREE.BoxGeometry(1.3, 1.5, 0.6).translate(0, 0.75, 3.4), dark, 8, true);
  const tower = mergeAll([new THREE.CylinderGeometry(0.16, 0.22, 7, 6).translate(0, 3.5, 0), ...[2.5, 4.4, 6.2].map((y) => new THREE.CylinderGeometry(0.2, 1.0, 0.7, 8).translate(0, y, 0)), new THREE.SphereGeometry(0.3, 6, 4).translate(0, 7.2, 0)]);
  tower.computeVertexNormals();
  const towers = inst(tower, metal, 40, true);
  const huts = b.blocks.filter((k) => k.kind === "hut");
  for (const k of huts) {
    const y = heightAt(k.x, k.z) - 0.1, face = r() * 6;
    const t = tint(0.11, 0.3, 0.8 + r() * 0.1);
    at(wall, k.x, y, k.z, 1, 1, 1, face, 0, 0, t); at(dome, k.x, y, k.z, 1, 1, 1, face, 0, 0, t); at(door, k.x, y, k.z, 1, 1, 1, face);
    for (let i = 0; i < 4; i++) {
      const a = face + 1.2 + i * 1.4, d = 6 + r() * 5, x = k.x + Math.cos(a) * d, z = k.z + Math.sin(a) * d;
      if (bare(x, z, 2)) continue;
      const lean = r() < 0.3 ? (r() - 0.5) * 0.8 : 0;
      at(towers, x, heightAt(x, z) - 0.2, z, 1, 0.7 + r() * 0.5, 1, r() * 6, 0, lean, tint(0.1, 0.1, 0.55 + r() * 0.3));
    }
  }

  // Wrecked haulers: a hull sunk in the sand, a cab fallen forward, a drift against one side, ribs of frame.
  for (const k of b.blocks.filter((o) => o.kind === "wreck")) {
    const y = heightAt(k.x, k.z), big = Math.hypot(k.x - keep.x, k.z - keep.z) < 25, along = k.w >= k.d, yaw = along ? 0 : Math.PI / 2;
    const L = Math.max(k.w, k.d), W = Math.min(k.w, k.d);
    const g = new THREE.Group();
    g.position.set(k.x, y, k.z);
    g.rotation.set(0.05, yaw, (r() - 0.5) * 0.14);
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, py: number, z: number, rz = 0, rx = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, py, z); o.rotation.set(rx, 0, rz); o.castShadow = o.receiveShadow = true; g.add(o); return o; };
    part(new THREE.BoxGeometry(L, k.h * 0.8, W), rust, 0, k.h * 0.3 - 0.5, 0);
    part(new THREE.BoxGeometry(L * 0.3, k.h * 1.2, W * 0.95), std(0x6f4f3a, 0.7, { metalness: 0.3 }), L * 0.38, k.h * 0.5 - 0.3, 0, 0, 0.1);
    part(new THREE.BoxGeometry(L * 0.18, k.h * 0.35, W * 0.7), dark, L * 0.5 - 0.05, k.h * 0.9, 0); // the cab's blown-out windows
    for (let i = 0; i < 4; i++) part(new THREE.CylinderGeometry(0.12, 0.12, k.h * (1 + r()), 5), metal, -L * 0.45 + i * 1.1, k.h * 0.9, (r() - 0.5) * W * 0.6, (r() - 0.5) * 0.9, (r() - 0.5) * 0.9);
    part(new THREE.CylinderGeometry(k.h * 0.45, k.h * 0.45, 0.8, 10).rotateX(Math.PI / 2), dark, -L * 0.15, k.h * 0.05 - 0.4, W / 2 + 0.2); // a wheel
    part(new THREE.CylinderGeometry(k.h * 0.45, k.h * 0.45, 0.8, 10).rotateX(Math.PI / 2), dark, L * 0.28, k.h * 0.05 - 0.4, -W / 2 - 0.2);
    add(g);
    at(dunes, k.x - 1, y - 0.5, k.z + W * 0.7, L * 0.9, k.h * 0.55, W * 0.7, yaw + 0.3, 0, 0, tint(0.1, 0.5, 0.58));
    if (big) {
      // The keep: a tall mast with rings and a lamp, rigged with a torn sail, seen from across the field.
      const mx = k.x - L * 0.55, mz = k.z - 3;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.7, 40, 8).translate(0, 20, 0), metal);
      mast.position.set(mx, heightAt(mx, mz) - 0.5, mz);
      mast.castShadow = true;
      add(mast);
      for (let h = 8; h < 40; h += 8) solid(new THREE.CylinderGeometry(2.2, 2.2, 0.25, 10), std(h % 16 ? 0xc9c1ad : 0xb0382a, 0.7), mx, mast.position.y + h, mz);
      solid(new THREE.SphereGeometry(1.1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffa040 }), mx, mast.position.y + 41, mz);
      const sail = solid(new THREE.PlaneGeometry(10, 16, 4, 6).translate(5, -8, 0), std(0xb0382a, 0.9, { side: THREE.DoubleSide }), mx, mast.position.y + 38, mz);
      sail.rotation.set(0, 0.5, 0.05);
    }
  }
  done(dunes, hoodoos, rib, spine, skulls, loose, wall, dome, door, towers);
  void ky;
}
