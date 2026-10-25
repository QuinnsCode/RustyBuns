// The landmarks by each world's keep, only for show: the sim's blocks are what stand in the way, and
// these dress them. Each returns what it animates each frame, if anything.
import * as THREE from "three";
import type { SectorKind } from "./contract.ts";
import type { instancer } from "./foliage.ts";
import type { Battle } from "./sim.ts";

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
  capital: ({ keep, ky, solid, std, builtMat }) => {
    solid(new THREE.BoxGeometry(8, 24, 8).translate(0, 12, 0), builtMat, keep.x, ky, keep.z - 18); // the palace's tower
    solid(new THREE.ConeGeometry(6.5, 8, 4).rotateY(Math.PI / 4), std(0x6b3a2a, 0.8), keep.x, ky + 28, keep.z - 18);
  },
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
  cannon: ({ keep, ky, solid, std }) => {
    solid(new THREE.CylinderGeometry(1.4, 1.8, 30, 16), std(0x5b6067, 0.4, { metalness: 0.5 }), keep.x - 12, ky + 16, keep.z - 22).rotation.x = -0.6;
  },
  canyon: ({ keep, ky, solid, std, builtMat }) => {
    solid(new THREE.BoxGeometry(2, 1, 30), std(0x6b5a48, 0.9), keep.x + 12, ky + 6, keep.z + 4); // the conveyor
    solid(new THREE.BoxGeometry(3, 16, 3).translate(0, 8, 0), builtMat, keep.x + 16, ky, keep.z - 16);
  },
  jungle: ({ keep, ky, solid, builtMat }) => {
    solid(new THREE.BoxGeometry(14, 4, 9), builtMat, keep.x, ky + 14, keep.z - 22);
    solid(new THREE.BoxGeometry(8, 4, 5), builtMat, keep.x, ky + 18, keep.z - 22);
    solid(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x9ff0d8 }), keep.x, ky + 21, keep.z - 22);
  },
};
