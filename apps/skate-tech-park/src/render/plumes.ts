// Thruster exhaust as puffs of condensing gas: a pooled ring of points that start small and bright
// at the nozzle, swell as they cool and fade out, drawn in one call. Landing kicks a ring of dust.
import * as THREE from "three";

const SIZE = 1024;
const MATERIAL = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { scale: { value: 600 } },
  vertexShader: `attribute float aSize; attribute float aAlpha; varying float vAlpha; uniform float scale;
    void main() { vAlpha = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying float vAlpha;
    void main() { float d = length(gl_PointCoord - 0.5) * 2.0; if (d > 1.0) discard; gl_FragColor = vec4(vec3(0.93, 0.96, 1.0), vAlpha * (1.0 - d * d)); }`,
});

/** A pool of puffs: each has a position, a velocity, an age and a size that grows as it fades. */
export class Puffs {
  readonly points: THREE.Points;
  private pos = new Float32Array(SIZE * 3);
  private vel = new Float32Array(SIZE * 3);
  private age = new Float32Array(SIZE).fill(Infinity);
  private life = new Float32Array(SIZE).fill(1);
  private size0 = new Float32Array(SIZE);
  private size = new Float32Array(SIZE);
  private alpha = new Float32Array(SIZE);
  private next = 0;
  /** Something is alive (or just died and still needs its zero uploaded); an idle pool skips the loop and the upload. */
  private busy = false;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    g.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.points = new THREE.Points(g, MATERIAL);
    this.points.frustumCulled = false;
  }

  /** The oldest puff is recycled when the pool is full. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number) {
    const i = this.next;
    this.next = (i + 1) % SIZE;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0; this.life[i] = life; this.size0[i] = size;
    this.busy = true;
  }

  get live() {
    let n = 0;
    for (let i = 0; i < SIZE; i++) if (this.age[i] < this.life[i]) n++;
    return n;
  }

  update(dt: number) {
    if (!this.busy) return;
    let alive = false;
    const drag = Math.exp(-3 * dt);
    for (let i = 0; i < SIZE; i++) {
      const t = (this.age[i] += dt) / this.life[i];
      if (t >= 1) { this.size[i] = 0; this.alpha[i] = 0; continue; }
      alive = true;
      for (let k = 0; k < 3; k++) { this.vel[i * 3 + k] *= drag; this.pos[i * 3 + k] += this.vel[i * 3 + k] * dt; }
      this.size[i] = this.size0[i] * (1 + 4 * t);
      this.alpha[i] = 0.6 * (1 - t) ** 1.5;
    }
    for (const a of ["position", "aSize", "aAlpha"]) (this.points.geometry.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;
    this.busy = alive;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const RATE = 70; // puffs a second from each firing nozzle
const SPEED = 9; // m/s out of the bell

/** Puffs for a car's nozzles, plus a puff of dust on landing. */
export class Plumes {
  readonly puffs = new Puffs();
  private owed = new Map<THREE.Object3D, number>();
  private at = new THREE.Vector3();
  private dir = new THREE.Vector3();

  /** Emit from each nozzle that is `on`, flying with the car's velocity (m/s). */
  update(dt: number, nozzles: { mount: THREE.Object3D }[], on: boolean[], vx: number, vy: number, vz: number) {
    nozzles.forEach((n, i) => {
      if (!on[i]) return this.owed.delete(n.mount);
      n.mount.updateWorldMatrix(true, false);
      this.at.setFromMatrixPosition(n.mount.matrixWorld);
      this.dir.copy(UP).transformDirection(n.mount.parent!.matrixWorld);
      let owe = (this.owed.get(n.mount) ?? Math.random()) + RATE * dt;
      for (; owe >= 1; owe--) {
        const s = SPEED * (0.7 + Math.random() * 0.6);
        this.puffs.emit(this.at.x, this.at.y, this.at.z, vx * 0.5 + this.dir.x * s + (Math.random() - 0.5), vy * 0.5 + this.dir.y * s + (Math.random() - 0.5), vz * 0.5 + this.dir.z * s + (Math.random() - 0.5), 0.4 + Math.random() * 0.25, 0.45);
      }
      this.owed.set(n.mount, owe);
    });
    this.puffs.update(dt);
  }

  /** A ring of dust thrown out from where the car touches down. */
  landed(x: number, y: number, z: number, hardness: number) {
    const n = Math.min(28, 10 + Math.round(hardness * 3));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3, s = 2 + Math.random() * 2 + hardness * 0.3;
      this.puffs.emit(x + Math.sin(a) * 1.4, y + 0.1, z + Math.cos(a) * 1.4, Math.sin(a) * s, 0.4 + Math.random() * 0.6, Math.cos(a) * s, 0.5 + Math.random() * 0.3, 0.35);
    }
  }
}
