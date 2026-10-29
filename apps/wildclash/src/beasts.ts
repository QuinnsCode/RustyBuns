// A fighter's body is a beast: modelled by blender/beast.py from its sheet in beasts/, given bones and skin
// weights by auto-rig's voxel rigger (scripts/beasts.ts writes public/models/<id>.rig.json), and driven here
// by closed-chain IK. The root rides the fighter, the feet plant on the ground and step when they're left
// behind, and everything else (tail, wings, horns) follows its bones.
import * as THREE from "three";
import { arr, int, num, obj, str, type Of } from "@rustybuns/util/guard";
import { getJson } from "@rustybuns/util/http";
import { rigFromWire } from "../../auto-rig/src/rig/codec.ts";
import type { RigResult } from "../../auto-rig/src/rig/analyze.ts";
import { IkRig } from "../../auto-rig/src/ui/ik.ts";
import { loadGlb, type Model } from "../../auto-rig/src/ui/model.ts";
import type { Archetype } from "./roster.ts";
import type { Body } from "./roster.ts";
import type { Fighter } from "./sim.ts";

/** Which beast each archetype wears until the folklore roster lands (#2706). */
export const BEASTS: Partial<Record<Archetype, string>> = { skirmisher: "jackalope", flyer: "jersey-devil", tank: "hodag", bruiser: "agropelter" };

const B64 = str(1 << 24, { min: 0, re: /^[A-Za-z0-9+/=]*$/ });
/** The rig sidecar: auto-rig's result over the wire, plus which tips are feet. The model is normalized
 * (standing on y = 0, bounding box diagonal 2, facing +x), so `height` and `extent` are in that space. */
export const BeastRig = obj({
  joints: B64, parents: B64, skinIndex: B64, skinWeight: B64,
  grid: obj({ dims: arr(num(1, 4096), 3, { min: 3 }), h: num(0, 10), origin: arr(num(-10, 10), 3, { min: 3 }), solid: num(0, 1e9) }),
  timings: obj({ voxelize: num(0, 1e6), distance: num(0, 1e6), skeleton: num(0, 1e6), weights: num(0, 1e6) }),
  tips: arr(int(0, 1023), 64), feet: arr(int(0, 1023), 8), wings: arr(int(0, 1023), 8), height: num(0.01, 2), extent: num(0.01, 2),
});
export type BeastRig = Of<typeof BeastRig>;

/** Tips low enough to stand on: within `frac` of the model's height off the ground. */
export function feetOf(rig: RigResult, tips: number[], height: number, frac = 0.15): number[] {
  return tips.filter((t) => rig.joints[t * 3 + 1] < height * frac);
}

/** Tips that are wings: high up and far out to the side. */
export function wingsOf(rig: RigResult, tips: number[], height: number, extent: number): number[] {
  return tips.filter((t) => rig.joints[t * 3 + 1] > height * 0.5 && Math.abs(rig.joints[t * 3 + 2]!) > extent * 0.3);
}

export interface Beast { model: Model; rig: RigResult; sheet: BeastRig }
const cache = new Map<string, Promise<Beast | null>>();

/** The beast's model and rig, fetched once per id; null when either file is missing. */
export function loadBeast(id: string): Promise<Beast | null> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      const [glb, sheet] = await Promise.all([fetch(`/models/${id}.glb`), getJson(`/models/${id}.rig.json`, BeastRig)]);
      if (!glb.ok || !sheet) return null;
      const model = await loadGlb(await glb.arrayBuffer(), id);
      const three = (a: number[]): [number, number, number] => [a[0]!, a[1]!, a[2]!];
      const rig = rigFromWire({ ...sheet, grid: { ...sheet.grid, dims: three(sheet.grid.dims), origin: three(sheet.grid.origin) } });
      return { model, rig, sheet };
    })().catch((e) => { console.warn("[beasts]", id, e); return null; });
    cache.set(id, p);
  }
  return p;
}

interface Foot { tip: number; home: THREE.Vector3; planted: THREE.Vector3; from: THREE.Vector3; to: THREE.Vector3; t: number; swing: number }

const SWING = 0.14;      // seconds a step takes at a walk; a sprint's steps are quicker
const STEP = 0.22;       // how far (as a fraction of the model's height) a foot is left behind before it steps
const LIFT = 0.12;       // how high a stepping foot lifts, as a fraction of the model's height

/** A beast skinned to its skeleton and posed by IK each frame to follow a fighter. */
export class Puppet {
  readonly group = new THREE.Group();
  readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly bones: THREE.Bone[] = [];
  private readonly ik: IkRig;
  private readonly feet: Foot[];
  private readonly wings: { tip: number; rest: THREE.Vector3 }[];
  private flapping = false;
  private readonly rest: THREE.Vector3;
  private readonly scale: number;
  private readonly inv = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private readonly pm = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private landed = false;

  constructor(readonly beast: Beast, b: Body) {
    const { model, rig, sheet } = beast;
    // Fit the hurtbox: as tall as the body says, and no wider than the ring it fights in.
    this.scale = Math.min(b.height / sheet.height, (b.radius * 4) / sheet.extent);
    const J = rig.parents.length;
    for (let j = 0; j < J; j++) {
      const bone = new THREE.Bone();
      const p = rig.parents[j]!;
      if (p < 0) bone.position.set(rig.joints[0]!, rig.joints[1]!, rig.joints[2]!);
      else bone.position.set(rig.joints[j * 3]! - rig.joints[p * 3]!, rig.joints[j * 3 + 1]! - rig.joints[p * 3 + 1]!, rig.joints[j * 3 + 2]! - rig.joints[p * 3 + 2]!);
      this.bones.push(bone);
      if (p >= 0) this.bones[p]!.add(bone);
    }
    const inner = new THREE.Group();
    inner.add(this.bones[0]!);
    inner.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    for (const part of model.parts) {
      const g = part.geometry.clone();
      g.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(rig.skinIndex.slice(part.start * 4, (part.start + part.count) * 4), 4));
      g.setAttribute("skinWeight", new THREE.Float32BufferAttribute(rig.skinWeight.slice(part.start * 4, (part.start + part.count) * 4), 4));
      const mats = Array.isArray(part.material) ? part.material : [part.material];
      const own = mats.map((m) => m.clone());
      for (const m of own) if (m instanceof THREE.MeshStandardMaterial) this.materials.push(m);
      const sm = new THREE.SkinnedMesh(g, own.length === 1 ? own[0]! : own);
      sm.bind(skeleton, new THREE.Matrix4());
      sm.frustumCulled = false;
      sm.castShadow = true;
      inner.add(sm);
    }
    inner.scale.setScalar(this.scale);
    this.group.add(inner);
    this.ik = new IkRig(rig.joints, rig.parents);
    const isFoot = new Set(sheet.feet);
    for (const t of this.ik.tips) if (!isFoot.has(t)) this.ik.setPinned(t, false);
    this.rest = new THREE.Vector3(...this.ik.worldPosition(0));
    this.wings = sheet.wings.map((tip) => ({ tip, rest: new THREE.Vector3(...this.ik.worldPosition(tip)) }));
    this.feet = sheet.feet.map((tip) => {
      const [x, , z] = this.ik.worldPosition(tip);
      const home = new THREE.Vector3(x, 0, z);
      return { tip, home, planted: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, swing: SWING };
    });
  }

  /** Pose for this frame: the fighter's position and heading, then the feet plant, step or hang. */
  update(f: Fighter, dt: number, tick: number) {
    const g = this.group;
    g.position.set(f.pos.x, f.pos.y, f.pos.z);
    g.rotation.y = -f.yaw;
    g.updateMatrixWorld(true);
    this.inv.copy(g.matrixWorld).invert();
    const h = this.beast.sheet.height, s = this.scale;
    const grounded = f.onGround && !f.flying;
    if (grounded && !this.landed) for (const ft of this.feet) { ft.planted.copy(ft.home).multiplyScalar(s).applyMatrix4(g.matrixWorld); ft.t = 1; }
    this.landed = grounded;
    if (grounded) {
      const speed = Math.hypot(f.vel.x, f.vel.z);
      const swinging = this.feet.filter((ft) => ft.t < 1).length;
      const due = this.feet.filter((ft) => ft.t >= 1)
        .map((ft) => ({ ft, d: ft.planted.distanceTo(this.tmp.copy(ft.home).multiplyScalar(s).applyMatrix4(g.matrixWorld)) }))
        .filter(({ d }) => d > STEP * h * s).sort((a, b) => b.d - a.d);
      let budget = Math.max(1, Math.floor(this.feet.length / 2)) - swinging;
      const stride = STEP * h * s;
      for (const { ft } of due) {
        if (budget-- <= 0) break;
        ft.from.copy(ft.planted);
        ft.swing = Math.max(0.05, Math.min(SWING, (stride / Math.max(speed, 0.01)) * 0.8));
        // land where home will be when the foot comes down, and a little ahead, the way a stride does
        ft.to.copy(ft.home).multiplyScalar(s).applyMatrix4(g.matrixWorld).add(this.tmp.set(f.vel.x, 0, f.vel.z).multiplyScalar(ft.swing));
        if (speed > 0.1) ft.to.add(this.tmp.set(f.vel.x, 0, f.vel.z).normalize().multiplyScalar(stride * 0.3));
        ft.to.y = f.pos.y;
        ft.t = 0;
      }
      for (const ft of this.feet) {
        if (ft.t < 1) {
          ft.t = Math.min(1, ft.t + dt / ft.swing);
          ft.planted.lerpVectors(ft.from, ft.to, ft.t);
          ft.planted.y += Math.sin(ft.t * Math.PI) * LIFT * h * s;
        }
        // the IK works in the model's own space: the group's frame, before the scale
        this.tmp.copy(ft.planted).applyMatrix4(this.inv).multiplyScalar(1 / s);
        this.ik.moveGoal(ft.tip, this.tmp.x, this.tmp.y, this.tmp.z);
      }
    } else {
      // in the air the legs hang at rest, trailing a touch behind the motion
      for (const ft of this.feet) {
        this.tmp.copy(ft.home).setY(-0.03 * h);
        this.tmp2.set(f.vel.x, 0, f.vel.z).applyMatrix4(this.inv.clone().setPosition(0, 0, 0)).multiplyScalar(-0.02 * h);
        this.tmp.add(this.tmp2);
        this.ik.moveGoal(ft.tip, this.tmp.x, this.tmp.y, this.tmp.z);
      }
    }
    // wings beat while flying, pulled up and down at their tips; on the ground they hang from their bones
    if (f.flying !== this.flapping) { for (const w of this.wings) this.ik.setPinned(w.tip, f.flying); this.flapping = f.flying; }
    if (f.flying) for (const w of this.wings) {
      const beat = Math.sin(tick * 0.35);
      this.ik.moveGoal(w.tip, w.rest.x, w.rest.y + beat * 0.22 * h, w.rest.z * (1 - Math.abs(beat) * 0.12));
    }
    // the body breathes, and bobs with each stride
    const bob = grounded ? Math.abs(Math.sin(tick * 0.25)) * 0.015 * h * Math.min(1, Math.hypot(f.vel.x, f.vel.z) / 3) : 0;
    this.ik.moveRoot(this.rest.x, this.rest.y + Math.sin(tick * 0.08) * 0.006 * h + bob, this.rest.z);
    this.ik.solve();
    for (let j = 0; j < this.bones.length; j++) {
      this.m.fromArray(this.ik.matrixWorld(j) as number[]);
      const p = this.ik.parents[j]!;
      if (p >= 0) this.m.premultiply(this.pm.fromArray(this.ik.matrixWorld(p) as number[]).invert());
      this.m.decompose(this.bones[j]!.position, this.bones[j]!.quaternion, this.bones[j]!.scale);
    }
  }

  /** Where each foot is right now, in the world. */
  feetWorld(): THREE.Vector3[] {
    return this.feet.map((ft) => new THREE.Vector3(...this.ik.worldPosition(ft.tip)).multiplyScalar(this.scale).applyMatrix4(this.group.matrixWorld));
  }

  /** How far a foot is left behind before it steps, in the world. */
  stride() { return STEP * this.beast.sheet.height * this.scale; }

  /** The furthest any foot is from where it would rest under the body, in the world. */
  drift() {
    return Math.max(...this.feet.map((ft, k) => this.feetWorld()[k]!.distanceTo(this.tmp.copy(ft.home).multiplyScalar(this.scale).applyMatrix4(this.group.matrixWorld))));
  }

  /** Light the skin up (a hit, a charge) by `intensity` in `color`. */
  flash(color: number, intensity: number) {
    for (const m of this.materials) { m.emissive.setHex(color); m.emissiveIntensity = intensity; }
  }
}
