// The chase camera, for a board the size of a car: low and close enough that the deck fills the
// view, wide enough that the park reads as big, and wider still at speed.
import * as THREE from "three";
import type { State } from "../sim.ts";
import type { Skin } from "./skins.ts";

export const FOV = { base: 66, fast: 82 }; // degrees: resting and flat out
const RIG: Record<Skin, { back: number; up: number }> = { fingerboard: { back: 10, up: 3.4 }, roadster: { back: 10.5, up: 3.8 } };

export class Chase {
  readonly pos = new THREE.Vector3();
  readonly look = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Snap to the usual spot behind `s`. */
  snap(s: State, skin: Skin) {
    const r = RIG[skin];
    this.pos.set(s.x - Math.sin(s.yaw) * r.back, s.y + r.up, s.z - Math.cos(s.yaw) * r.back);
    this.look.set(s.x, s.y + 1, s.z);
  }

  /** Chase from behind and above; in the air, hold back along the flight so the spin reads. */
  update(s: State, skin: Skin, dt: number) {
    const r = RIG[skin];
    const dir = Math.hypot(s.vx, s.vz) > 3 && s.air ? Math.atan2(s.vx, s.vz) : s.yaw + (s.speed < -0.5 ? Math.PI : 0);
    const k = 1 - Math.exp(-5 * dt), kl = 1 - Math.exp(-14 * dt);
    this.pos.lerp(new THREE.Vector3(s.x - Math.sin(dir) * r.back, s.y + r.up, s.z - Math.cos(dir) * r.back), k);
    this.look.lerp(new THREE.Vector3(s.x, s.y + 1, s.z), kl);
    const fast = Math.min(1, Math.hypot(s.vx, s.vz) / 30);
    this.camera.fov += (FOV.base + (FOV.fast - FOV.base) * fast - this.camera.fov) * k;
    this.camera.updateProjectionMatrix();
  }

  /** Put the camera where the rig says, kept inside `box`. */
  apply(box: { minX: number; maxX: number; minZ: number; maxZ: number }) {
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, box.minX + 1, box.maxX - 1);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, box.minZ + 1, box.maxZ - 1);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }
}
