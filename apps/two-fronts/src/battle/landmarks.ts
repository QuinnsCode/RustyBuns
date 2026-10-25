// The landmarks by each world's keep, only for show: the sim's blocks are what stand in the way, and
// these dress them. Each returns what it animates each frame, if anything.
import * as THREE from "three";
import type { SectorKind } from "./contract.ts";
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
  spaceport: ({ b, keep, ky, heightAt, solid, std }) => {
    const padMat = std(0x5d6168, 0.7), padLight = new THREE.MeshBasicMaterial({ color: 0xffb040 });
    const pads = b.posts[0]!;
    for (const [dx, dz] of [[-24, -18], [24, -18], [-24, 22], [24, 22]] as const) {
      const x = pads.x + dx, z = pads.z + dz, y = heightAt(x, z);
      solid(new THREE.CylinderGeometry(9, 9.4, 0.6, 32), padMat, x, y + 0.3, z);
      for (let i = 0; i < 8; i++) solid(new THREE.SphereGeometry(0.25, 6, 4), padLight, x + Math.cos(i * 0.785) * 8.6, y + 0.65, z + Math.sin(i * 0.785) * 8.6);
    }
    solid(new THREE.BoxGeometry(10, 4, 10), std(0x2a3038, 0.3, { metalness: 0.4, emissive: 0x16303c }), keep.x + 10, ky + 24, keep.z - 10); // the tower's cab
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
