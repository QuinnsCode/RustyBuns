// The chase camera, for a board the size of a car: low and close enough that the deck fills the
// view, wide enough that the park reads as big, and wider still at speed.
import * as THREE from "three";
import type { State } from "../sim.ts";
import type { Skin } from "./skins.ts";

export const FOV = { base: 66, fast: 82 }; // degrees: resting and flat out
const RIG: Record<Skin, { back: number; up: number }> = { fingerboard: { back: 10, up: 3.4 }, roadster: { back: 10.5, up: 3.8 } };

/** How far to scale the rig so the board is as big on screen at `fov` as at the resting lens. */
export const fitDistance = (fov: number) => Math.tan((FOV.base * Math.PI) / 360) / Math.tan((fov * Math.PI) / 360);

const MIN_IN = 0.4; // the nearest the camera comes, as a fraction of its distance
const MARGIN = 0.8; // metres the camera keeps above the ground or a piece

export class Chase {
  readonly pos = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  /** The player's view settings: zoom above 1 brings the camera in, tilt rolls it, in degrees. */
  view = { zoom: 1, tilt: 0 };
  private rel = new THREE.Vector3();
  private board = new THREE.Vector3(); // where the board was when the camera last moved
  private want = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  /** Snap to the usual spot behind `s`. */
  snap(s: State, skin: Skin) {
    const r = RIG[skin];
    this.pos.set(s.x - Math.sin(s.yaw) * r.back, s.y + r.up, s.z - Math.cos(s.yaw) * r.back);
    this.look.set(s.x, s.y + 1, s.z);
    this.board.set(s.x, s.y, s.z);
  }

  /** Chase from behind and above; in the air, hold back along the flight so the spin reads. The rig is
   * kept relative to the board, so speed never stretches the gap, and as the lens widens it moves in
   * so the board stays one size on screen. */
  update(s: State, skin: Skin, dt: number) {
    const r = RIG[skin];
    const dir = Math.hypot(s.vx, s.vz) > 3 && s.air ? Math.atan2(s.vx, s.vz) : s.yaw + (s.speed < -0.5 ? Math.PI : 0);
    const k = 1 - Math.exp(-5 * dt), kl = 1 - Math.exp(-14 * dt);
    const fast = Math.min(1, Math.hypot(s.vx, s.vz) / 30);
    this.camera.fov += (FOV.base + (FOV.fast - FOV.base) * fast - this.camera.fov) * k;
    this.camera.updateProjectionMatrix();
    const zoom = fitDistance(this.camera.fov) / this.view.zoom;
    const rel = this.rel.copy(this.pos).sub(this.board); // the rig, relative to where the board was
    this.board.set(s.x, s.y, s.z);
    rel.lerp(this.want.set(-Math.sin(dir) * r.back * zoom, r.up * zoom, -Math.cos(dir) * r.back * zoom), k);
    this.pos.copy(this.board).add(rel);
    this.look.set(s.x, this.look.y + (s.y + 1 - this.look.y) * kl, s.z); // level with the board, eased only up and down
  }

  /** Put the camera where the rig says, kept inside `box` and out of the ground and pieces: if the
   * line from the board to the camera runs into one, the camera comes in along it until it clears. */
  apply(box: { minX: number; maxX: number; minZ: number; maxZ: number }, height?: (x: number, z: number) => number) {
    this.pos.x = THREE.MathUtils.clamp(this.pos.x, box.minX + 1, box.maxX - 1);
    this.pos.z = THREE.MathUtils.clamp(this.pos.z, box.minZ + 1, box.maxZ - 1);
    if (height) this.clear(height);
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    if (this.view.tilt) this.camera.rotateZ(THREE.MathUtils.degToRad(this.view.tilt));
  }

  private clear(height: (x: number, z: number) => number) {
    const a = this.look, b = this.pos, STEPS = 16;
    for (let i = 3; i <= STEPS; i++) { // from the board outward (its own ramp or floor is not in the way): stop short of the first thing that is
      const t = i / STEPS, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t;
      if (y < height(x, z) + 0.2) {
        const u = Math.max(MIN_IN, (i - 1) / STEPS); // never so close the board fills the view; lifted clear below
        b.set(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, a.z + (b.z - a.z) * u);
        break;
      }
    }
    b.y = Math.max(b.y, height(b.x, b.z) + MARGIN);
  }
}
