import * as THREE from "three";
import { LOOKS } from "./looks.ts";
import type { Animated } from "./industry.ts";

function rng(seed: number) {
  let x = seed >>> 0;
  return () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 4294967296);
}

export interface Office { group: THREE.Group; animated: Animated[] }

/**
 * Not a building any more: the spot a hippo has fought its way to. A shoulder of
 * mossy boulders behind it, an old log, churned mud, and a patch of flowers in
 * its colour. Local +z points away from the pan. The camera-side seat (0) gets
 * only low stones so nothing hides the player.
 */
export function buildOffice(seat: number): Office {
  const L = LOOKS[seat]!, g = new THREE.Group(), r = rng(seat * 31 + 5);
  const stone = new THREE.MeshStandardMaterial({ color: 0x3d4234, roughness: 0.97 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x4a3a28, roughness: 0.95 });
  const mud = new THREE.MeshStandardMaterial({ color: 0x1d160f, roughness: 0.6, metalness: 0.1 });
  const put = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };

  // churned mud where the hippo has been scrapping
  for (let i = 0; i < 6; i++) {
    const p = put(new THREE.CircleGeometry(0.9 + r() * 1.4, 18), mud, (r() - 0.5) * 9, 0.025, 1.2 + r() * 2.2);
    p.rotation.x = -Math.PI / 2; p.castShadow = false;
  }
  // boulders behind it: tall and dark for the far seats, low and out of the way for the camera's
  const tall = seat !== 0;
  for (let i = 0; i < (tall ? 9 : 5); i++) {
    const geo = new THREE.IcosahedronGeometry(1, 2), p = geo.attributes.position!;
    for (let k = 0; k < p.count; k++) { const j = 0.88 + r() * 0.24; p.setXYZ(k, p.getX(k) * j, p.getY(k) * j, p.getZ(k) * j); }
    geo.computeVertexNormals();
    const s = tall ? 0.9 + r() * 1.5 : 0.35 + r() * 0.35, x = (i / (tall ? 8 : 4) - 0.5) * 15 + (r() - 0.5) * 2, z = (tall ? 3.4 : 2.6) + r() * (tall ? 3 : 1.2);
    const m = put(geo, stone, x, s * 0.45, z); m.scale.set(s * 1.3, s * 0.85, s); m.rotation.y = r() * 6;
  }
  // a windfall palm trunk across the back, for the camera-facing seats' neighbours
  if (tall) { const log = put(new THREE.CylinderGeometry(0.38, 0.44, 9, 9), wood, (r() - 0.5) * 3, 0.45, 6.4); log.rotation.set(Math.PI / 2, 0, Math.PI / 2 + (r() - 0.5) * 0.3); }
  // flowers in the hippo's colour, so you can tell whose ground this is
  const petals = new THREE.MeshStandardMaterial({ color: L.accent, emissive: L.accent, emissiveIntensity: 0.35, roughness: 0.6 });
  const stem = new THREE.MeshStandardMaterial({ color: 0x2f5a22, roughness: 0.8 });
  for (let i = 0; i < 14; i++) {
    const x = (r() - 0.5) * 12, z = 2.0 + r() * 2.4, h = 0.5 + r() * 0.5;
    put(new THREE.CylinderGeometry(0.02, 0.025, h, 4), stem, x, h / 2, z);
    put(new THREE.SphereGeometry(0.13 + r() * 0.07, 8, 6), petals, x, h + 0.05, z).castShadow = false;
  }
  return { group: g, animated: [] };
}
