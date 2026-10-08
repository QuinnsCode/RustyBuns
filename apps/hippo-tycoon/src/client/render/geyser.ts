// The oil geyser: a low lava-rock vent with an oil-filled crater, and a gush of
// droplets from a particle fluid (Rust/wasm, or its TypeScript twin) that fans
// out, falls and splashes into the basin. It surges every time a drop is fired
// (DropLayer lofts the drop out of the vent in an arc), so the basin visibly
// drinks from it. Nothing here touches the game's rules.
import * as THREE from "three";
import { GOLD } from "../../sim/rules.ts";
import { CAP, FluidTS, STRIDE, type Fluid } from "./fluid.ts";
import { Smoke } from "./industry.ts";

const STEP = 1 / 60;                                   // the fluid runs at its own fixed rate
const OIL = new THREE.MeshPhysicalMaterial({ color: 0x060504, metalness: 0.3, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.04 });
const DROPLET = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.45, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 });
const OIL_COLOR = new THREE.Color(0.035, 0.028, 0.02), GOLD_COLOR = new THREE.Color(1, 0.72, 0.16);

export class Geyser {
  readonly group = new THREE.Group();
  private fluid: Fluid = new FluidTS(1);
  private drops: THREE.InstancedMesh;
  private surge = 0;
  private goldFor = 0;
  private acc = 0;
  private emitAcc = 0;
  private steam: Smoke;
  private m = new THREE.Matrix4();

  constructor() {
    const g = this.group, rock = new THREE.MeshStandardMaterial({ color: 0x3a3a34, roughness: 0.95, flatShading: true });
    // a broad, low lava-rock mound with a crater full of oil, and the pool that has spilled round it
    const pool = new THREE.Mesh(new THREE.CircleGeometry(2.6, 40), OIL); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.02; g.add(pool);
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.9, 0.85, 18, 2, true), rock); mound.position.y = 0.42; mound.castShadow = true; g.add(mound);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, s = 0.34 + (i % 3) * 0.1;
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 1), rock);
      r.position.set(Math.cos(a) * (1.25 + (i % 2) * 0.35), 0.2 + (i % 2) * 0.28, Math.sin(a) * (1.25 + (i % 2) * 0.35)); r.scale.set(1, 0.7, 1); r.rotation.set(i, i * 2, 0); r.castShadow = true; g.add(r);
    }
    const crater = new THREE.Mesh(new THREE.CircleGeometry(0.98, 28), OIL); crater.rotation.x = -Math.PI / 2; crater.position.y = 0.84; g.add(crater);

    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), DROPLET, CAP);
    this.drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.drops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.drops.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.drops.frustumCulled = false; this.drops.castShadow = true; this.drops.count = 0;
    g.add(this.drops);

    this.steam = new Smoke([{ at: new THREE.Vector3(0, 1.4, 0), rate: 0.8, size: 2.6, tint: 0xe4efe8 }], 6, 6, 0.14);
    g.add(this.steam.group);
  }

  /** Swap in the Rust build once it has loaded (or keep the TypeScript twin). */
  setFluid(f: Fluid) { this.fluid = f; }
  get engine() { return this.fluid.engine; }

  /** A drop was fired: the vent surges (gold surges gold). */
  erupt(kind: number) {
    this.surge = Math.min(1.4, this.surge + (kind === GOLD ? 1 : 0.7));
    if (kind === GOLD) this.goldFor = 0.45;
  }

  update(_t: number, dt: number) {
    this.surge *= Math.pow(0.04, dt);                       // settles in about a second
    this.goldFor = Math.max(0, this.goldFor - dt);
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.emitAcc += 0.4 + this.surge * 4.2;               // a steady bubble, and a gush on every shot
      const emit = Math.floor(this.emitAcc); this.emitAcc -= emit;
      this.fluid.step(STEP, emit, 4.2 + this.surge * 4.6, this.goldFor > 0 ? 1 : 0);
    }
    const n = this.fluid.count, o = this.fluid.out, ic = this.drops.instanceColor!.array as Float32Array, im = this.drops.instanceMatrix.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const s = o[k * STRIDE + 3]! * 2.3;            // drawn fatter than simulated: oil, not mist
      this.m.makeScale(s, s, s).setPosition(o[k * STRIDE]!, o[k * STRIDE + 1]!, -o[k * STRIDE + 2]!);
      this.m.toArray(im, k * 16);
      const c = o[k * STRIDE + 4]! > 0.5 ? GOLD_COLOR : OIL_COLOR;
      ic[k * 3] = c.r; ic[k * 3 + 1] = c.g; ic[k * 3 + 2] = c.b;
    }
    this.drops.count = n;
    this.drops.instanceMatrix.needsUpdate = true; this.drops.instanceColor!.needsUpdate = true;
    this.steam.update(dt, 0.3);
  }
}
