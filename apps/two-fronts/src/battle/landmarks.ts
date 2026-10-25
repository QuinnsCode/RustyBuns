// The landmarks by each world's keep, only for show: the sim's blocks are what stand in the way, and
// these dress them. Each returns what it animates each frame, if anything.
import * as THREE from "three";
import type { SectorKind } from "./contract.ts";
import type { instancer } from "./foliage.ts";
import type { Battle } from "./sim.ts";
import { desert } from "./worlds/desert.ts";
import { ruinedCity } from "./worlds/capital.ts";
import { cannonCoast } from "./worlds/beach.ts";

export interface Kit {
  b: Battle;
  keep: { x: number; z: number };
  ky: number; // the floor's height at the keep
  heightAt(x: number, z: number): number;
  solid(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh;
  add(o: THREE.Object3D): void;
  std(color: number, roughness?: number, extra?: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial;
  builtMat: THREE.Material;
  // For a world's own props scattered over the field: the scenery's seeded random, its noise, whether
  // a spot must stay clear (the trail, the posts, the blocks), and an instancer to draw them in few calls.
  r(): number;
  n(x: number, z: number, octaves?: number): number;
  bare(x: number, z: number, room?: number): boolean;
  anywhere(spread?: number): { x: number; z: number };
  inst: ReturnType<typeof instancer>;
}
type Landmark = (k: Kit) => ((t: number) => void) | void;

export const LANDMARKS: Record<SectorKind, Landmark> = {
  // The shield's dome over the generator, the dish on its core, and its humming pylons.
  shield: ({ keep, ky, solid, add, builtMat }) => {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(26, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
    dome.position.set(keep.x, ky, keep.z);
    add(dome);
    solid(new THREE.SphereGeometry(5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), builtMat, keep.x - 6, ky + 11, keep.z - 6).rotation.x = Math.PI;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      solid(new THREE.CylinderGeometry(0.5, 0.9, 12, 8), builtMat, keep.x + Math.cos(a) * 20, ky + 6, keep.z + Math.sin(a) * 20);
      solid(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: 0x9fe6ff }), keep.x + Math.cos(a) * 20, ky + 12.4, keep.z + Math.sin(a) * 20);
    }
    return (t) => { (dome.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.03 * Math.sin(t * 2); };
  },
  // The ruined city: shattered towers, burning wrecks, fallen overpasses and smoke, all in worlds/capital.ts.
  capital: ruinedCity,
  // The docking pads (a lit disc and ring of lights at two posts), a beacon over the fuel depot, and the command deck's tower cab and dish.
  spaceport: ({ b, keep, add, solid, std, inst }) => {
    const padMat = std(0x232a31, 0.5, { metalness: 0.4 }), ring = new THREE.RingGeometry(8, 8.5, 48).rotateX(-Math.PI / 2);
    const lights = inst.inst(new THREE.BoxGeometry(0.6, 0.12, 0.6), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 40, false, false);
    const tint = new THREE.Color(), at = new THREE.Matrix4();
    for (const [post, color] of [[b.posts[0]!, 0x40e0d0], [b.posts[2]!, 0xffa030]] as const) {
      solid(new THREE.CylinderGeometry(10, 10.3, 0.12, 40), padMat, post.x, 0.06, post.z);
      const edge = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      edge.position.set(post.x, 0.2, post.z);
      add(edge);
      for (let i = 0; i < 16; i++) inst.put(lights, at.makeTranslation(post.x + Math.cos(i * 0.3927) * 9.2, 0.22, post.z + Math.sin(i * 0.3927) * 9.2), tint.setHex(color));
    }
    inst.done(lights);
    const depot = b.posts[1]!;
    solid(new THREE.CylinderGeometry(0.3, 0.3, 9, 8), std(0x39414a, 0.5), depot.x, 4.5, depot.z);
    solid(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffa030, toneMapped: false }), depot.x, 9.4, depot.z);
    solid(new THREE.BoxGeometry(7, 3, 7), std(0x2a3038, 0.3, { metalness: 0.4, emissive: 0x16303c }), keep.x + 10, 23.5, keep.z - 10); // the tower's cab
    solid(new THREE.SphereGeometry(4, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), std(0xb8c2cc, 0.4), keep.x - 4, 9, keep.z - 24).rotation.x = Math.PI / 5; // the deck's dish
  },
  // The cannon on its rock-clad base, a headland behind it, and the shore: worlds/beach.ts.
  cannon: cannonCoast,
  canyon: desert,
  // An overgrown shrine glowing from inside: light in its slits and doorway, a crystal on the top, roots over it.
  jungle: ({ keep, ky, solid, add, std }) => {
    const at = { x: keep.x, z: keep.z - 22 }, front = at.z + 7.05, lit = (c: number) => new THREE.MeshBasicMaterial({ color: c });
    const stone = std(0x4a3f7a, 0.8, { emissive: 0x1c1445 });
    solid(new THREE.BoxGeometry(14, 4, 9), stone, at.x, ky + 14, at.z);
    solid(new THREE.BoxGeometry(8, 4, 5), stone, at.x, ky + 18, at.z);
    const door = lit(0x6af8e0), slit = lit(0xff5ad0);
    solid(new THREE.BoxGeometry(3.4, 6, 0.3), door, at.x, ky + 3, front);
    for (const x of [-7.5, -5, 5, 7.5]) solid(new THREE.BoxGeometry(0.5, 6, 0.3), slit, at.x + x, ky + 6.5, front);
    for (const x of [-4.5, -1.5, 1.5, 4.5]) solid(new THREE.BoxGeometry(0.5, 2.4, 0.3), slit, at.x + x, ky + 14, at.z + 4.55);
    // Roots and vines over the stone, and a moss cap.
    const root = std(0x1fa090, 0.9, { emissive: 0x0a5a50 });
    for (let i = 0; i < 9; i++) {
      const x = at.x - 9 + i * 2.25, h = 6 + (i % 3) * 3;
      solid(new THREE.CylinderGeometry(0.18, 0.4, h, 6), root, x, ky + 14 - h / 2 + 4, front + 0.2).rotation.z = ((i % 4) - 1.5) * 0.15;
    }
    solid(new THREE.SphereGeometry(5, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), root, at.x, ky + 20, at.z).scale.set(1, 0.35, 0.7);
    const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.8), lit(0x9ffff0));
    crystal.scale.y = 2;
    crystal.position.set(at.x, ky + 25, at.z);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x6af8e0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    halo.scale.setScalar(26);
    halo.position.copy(crystal.position);
    const light = new THREE.PointLight(0x6af8e0, 900, 70, 2);
    light.position.set(at.x, ky + 22, at.z + 6);
    add(crystal); add(halo); add(light);
    return (t) => { crystal.rotation.y = t * 0.6; light.intensity = 800 + 150 * Math.sin(t * 1.3); halo.material.opacity = 0.45 + 0.1 * Math.sin(t * 1.3); };
  },
};
