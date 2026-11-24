// Step dust: a little puff kicks up off the floor at each footfall, more at a speed walk, and a ring of it where a hop
// lands, so you see everyone moving about the room. Outdoors, on sand, it's thicker; indoors, a faint scuff.
// One Points cloud for the whole room, a fixed pool of motes reused oldest first (no allocation per frame).
import * as THREE from "three";

/** How many motes there are at once. */
const POOL = 240;
/** How long a mote lives, seconds. */
const LIFE = 0.9;

/** Each walker's stride: how far it went since its last footfall, and which foot is next. */
export class Strides {
  private walked = new Map<number | "me", { d: number; foot: 1 | -1; air: boolean }>();
  /**
   * `moved` metres this frame at `speed` m/s, `up` off the floor: the footfalls (or a landing) to puff. A step is
   * about 0.7 m at a walk, longer brisk.
   */
  step(who: number | "me", moved: number, speed: number, up: number): { foot: 1 | -1 | 0; n: number } | null {
    let w = this.walked.get(who);
    if (!w) this.walked.set(who, (w = { d: 0, foot: 1, air: false }));
    if (up > 0.02) { w.air = true; return null; }
    if (w.air) { w.air = false; w.d = 0; return { foot: 0, n: 10 }; }
    w.d += moved;
    const stride = 0.55 + speed * 0.12;
    if (w.d < stride || speed < 0.3) return null;
    w.d = 0;
    w.foot = w.foot > 0 ? -1 : 1;
    return { foot: w.foot, n: speed > 2 ? 5 : 3 };
  }
  forget(who: number | "me") { this.walked.delete(who); }
}

export class Dust {
  private at = new Float32Array(POOL * 3);
  private vel = new Float32Array(POOL * 3);
  private age = new Float32Array(POOL).fill(LIFE);
  private alpha = new Float32Array(POOL);
  private size = new Float32Array(POOL);
  private next = 0;
  private geo = new THREE.BufferGeometry();
  readonly points: THREE.Points;
  private strides = new Strides();
  constructor(scene: THREE.Scene, private thick = 1, color = "#c9b89a") {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.at, 3));
    this.geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { color: { value: new THREE.Color(color) }, scale: { value: 400 } },
      vertexShader: `attribute float alpha; attribute float size; varying float a; uniform float scale;
        void main() { a = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; varying float a;
        void main() { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(color, a * (1.0 - d * d)); }`,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    scene.add(this.points);
  }
  /** `n` motes at (x, y, z), thrown out round it; `ring`: out all round (a landing), else back from a heel. */
  puff(x: number, y: number, z: number, n: number, ring = false) {
    for (let k = 0; k < Math.round(n * this.thick); k++) {
      const i = this.next, a = Math.random() * Math.PI * 2, out = (ring ? 0.7 : 0.25) * (0.4 + Math.random());
      this.next = (this.next + 1) % POOL;
      this.at.set([x + Math.cos(a) * 0.06, y + 0.03, z + Math.sin(a) * 0.06], i * 3);
      this.vel.set([Math.cos(a) * out, 0.25 + Math.random() * 0.35, Math.sin(a) * out], i * 3);
      this.age[i] = 0;
      this.size[i] = 0.05 + Math.random() * 0.06;
    }
  }
  /** A walker's frame: at (x, floor, z) facing `yaw`, `moved` metres since last frame at `speed`, `up` off the floor. */
  walker(who: number | "me", x: number, floor: number, z: number, yaw: number, moved: number, speed: number, up: number) {
    const s = this.strides.step(who, moved, speed, up);
    if (!s) return;
    if (s.foot === 0) return this.puff(x, floor, z, s.n, true);
    // the foot that came down: a hand's width to that side
    const rx = Math.cos(yaw) * 0.11 * s.foot, rz = -Math.sin(yaw) * 0.11 * s.foot;
    this.puff(x + rx, floor, z + rz, s.n);
  }
  forget(who: number | "me") { this.strides.forget(who); }
  frame(dt: number) {
    for (let i = 0; i < POOL; i++) {
      if (this.age[i]! >= LIFE) { this.alpha[i] = 0; continue; }
      const age = (this.age[i]! += dt), k = age / LIFE, j = i * 3;
      this.vel[j + 1] = this.vel[j + 1]! - 0.5 * dt;
      for (let c = 0; c < 3; c++) { this.vel[j + c] = this.vel[j + c]! * Math.exp(-dt * 3); this.at[j + c] = this.at[j + c]! + this.vel[j + c]! * dt; }
      this.size[i] = this.size[i]! + dt * 0.12;
      this.alpha[i] = 0.4 * (1 - k) * Math.min(1, k * 8);
    }
    for (const n of ["position", "alpha", "size"]) this.geo.getAttribute(n).needsUpdate = true;
  }
}
