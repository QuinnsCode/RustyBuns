// The geyser's fluid. The same particle simulation exists twice: in Rust
// (native/crates/hippo_fluid, loaded as WebAssembly) and here in TypeScript.
// They run the same arithmetic in the same order on f64 with nothing but
// + - * / sqrt, so they agree bit for bit (test/fluid.test.ts holds them to it).
// If the wasm is missing or fails to load, this twin is used. It only decorates
// the pan: the game's rules never read it.

export const CAP = 1400;
export const STRIDE = 5;
const H = 0.55, NX = 30, NY = 22, NZ = 30, HALF = 8.0, NCELL = NX * NY * NZ;
const G = 9.8, REP = 30.0, COH = 14.0, VISC = 2.5, AMAX = 200.0;
const VENT_Y = 1.1, FLOOR = 0.12, WALL = 7.0;

export interface Fluid {
  readonly engine: "rust" | "ts";
  /** Spawn `emit` particles at `speed` (tint 0 oil, 1 gold), then advance `dt` seconds. */
  step(dt: number, emit: number, speed: number, tint: number): void;
  readonly count: number;
  /** count * STRIDE floats: x, y, z, radius, tint per live particle. */
  readonly out: Float32Array;
}

const clampi = (v: number, hi: number) => (v < 0 ? 0 : v > hi ? hi : v);
const clampf = (v: number, lim: number) => (v < -lim ? -lim : v > lim ? lim : v);

export class FluidTS implements Fluid {
  readonly engine = "ts";
  private rng: number;
  private cursor = 0;
  private x = new Float64Array(CAP); private y = new Float64Array(CAP); private z = new Float64Array(CAP);
  private vx = new Float64Array(CAP); private vy = new Float64Array(CAP); private vz = new Float64Array(CAP);
  private ax = new Float64Array(CAP); private ay = new Float64Array(CAP); private az = new Float64Array(CAP);
  private life = new Float64Array(CAP); private rad = new Float64Array(CAP); private tint = new Float64Array(CAP);
  private head = new Int32Array(NCELL).fill(-1); private next = new Int32Array(CAP).fill(-1);
  private buf = new Float32Array(CAP * STRIDE);
  count = 0;

  constructor(seed = 1) { this.rng = seed === 0 ? 1 : seed >>> 0; }

  get out() { return this.buf.subarray(0, this.count * STRIDE); }

  private rand(): number {
    let s = this.rng;
    s = (s ^ (s << 13)) >>> 0; s = (s ^ (s >>> 17)) >>> 0; s = (s ^ (s << 5)) >>> 0;
    this.rng = s;
    return s / 4294967296.0;
  }

  private spawn(speed: number, tint: number) {
    let found = CAP;
    for (let k = 0; k < CAP; k++) { const i = (this.cursor + k) % CAP; if (this.life[i]! <= 0.0) { found = i; break; } }
    if (found === CAP) return;
    this.cursor = (found + 1) % CAP;
    const i = found;
    const jx = (this.rand() - 0.5) * 0.25;
    const jz = (this.rand() - 0.5) * 0.25;
    const spread = 1.6 + speed * 0.35;
    const vx = (this.rand() - 0.5) * spread;
    const vz = (this.rand() - 0.5) * spread;
    const vy = speed * (0.75 + 0.5 * this.rand());
    const rad = 0.09 + 0.08 * this.rand();
    const life = 1.8 + 0.8 * this.rand();
    this.x[i] = jx; this.y[i] = VENT_Y; this.z[i] = jz;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.rad[i] = rad; this.life[i] = life; this.tint[i] = tint;
  }

  step(dt: number, emit: number, speed: number, tint: number) {
    const { x, y, z, vx, vy, vz, ax, ay, az, life, head, next } = this;
    for (let n = 0; n < emit; n++) this.spawn(speed, tint);

    head.fill(-1);
    for (let i = 0; i < CAP; i++) {
      ax[i] = 0.0; ay[i] = 0.0; az[i] = 0.0;
      if (life[i]! > 0.0) {
        const cx = clampi(Math.floor((x[i]! + HALF) / H), NX - 1), cy = clampi(Math.floor(y[i]! / H), NY - 1), cz = clampi(Math.floor((z[i]! + HALF) / H), NZ - 1);
        const c = cx + NX * (cy + NY * cz);
        next[i] = head[c]!; head[c] = i;
      }
    }

    for (let i = 0; i < CAP; i++) {
      if (life[i]! <= 0.0) continue;
      const xi = x[i]!, yi = y[i]!, zi = z[i]!;
      const cx = clampi(Math.floor((xi + HALF) / H), NX - 1), cy = clampi(Math.floor(yi / H), NY - 1), cz = clampi(Math.floor((zi + HALF) / H), NZ - 1);
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = cx + dx, ny = cy + dy, nz = cz + dz;
        if (nx < 0 || ny < 0 || nz < 0 || nx >= NX || ny >= NY || nz >= NZ) continue;
        let j = head[nx + NX * (ny + NY * nz)]!;
        while (j !== -1) {
          if (j > i) {
            const ddx = xi - x[j]!, ddy = yi - y[j]!, ddz = zi - z[j]!;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
            if (d2 < H * H && d2 > 1e-12) {
              const d = Math.sqrt(d2), q = d / H;
              const f = q < 0.55 ? REP * (0.55 - q) : -COH * (q - 0.55) * (1.0 - q) * 4.0;
              const ux = ddx / d, uy = ddy / d, uz = ddz / d, w = 1.0 - q;
              const dvx = vx[j]! - vx[i]!, dvy = vy[j]! - vy[i]!, dvz = vz[j]! - vz[i]!;
              const fx = f * ux + VISC * w * dvx, fy = f * uy + VISC * w * dvy, fz = f * uz + VISC * w * dvz;
              ax[i] += fx; ay[i] += fy; az[i] += fz;
              ax[j] -= fx; ay[j] -= fy; az[j] -= fz;
            }
          }
          j = next[j]!;
        }
      }
    }

    const drag = 1.0 - 0.4 * dt;
    for (let i = 0; i < CAP; i++) {
      if (life[i]! <= 0.0) continue;
      vx[i] = (vx[i]! + clampf(ax[i]!, AMAX) * dt) * drag;
      vy[i] = (vy[i]! + (clampf(ay[i]!, AMAX) - G) * dt) * drag;
      vz[i] = (vz[i]! + clampf(az[i]!, AMAX) * dt) * drag;
      x[i] += vx[i]! * dt; y[i] += vy[i]! * dt; z[i] += vz[i]! * dt;
      if (y[i]! < FLOOR) {                         // splash onto the basin and soak in
        y[i] = FLOOR;
        if (vy[i]! < 0.0) vy[i] = -vy[i]! * 0.12;
        vx[i] *= 0.7; vz[i] *= 0.7;
        life[i] -= 0.05;
      }
      const rr = Math.sqrt(x[i]! * x[i]! + z[i]! * z[i]!);
      if (rr > WALL) { const k = WALL / rr; x[i] *= k; z[i] *= k; vx[i] *= 0.2; vz[i] *= 0.2; }
      life[i] -= dt;
      if (life[i]! < 0.0) life[i] = 0.0;
    }

    let n = 0;
    for (let i = 0; i < CAP; i++) {
      if (life[i]! <= 0.0) continue;
      const fade = life[i]! < 0.5 ? life[i]! / 0.5 : 1.0;
      const o = n * STRIDE;
      this.buf[o] = x[i]!; this.buf[o + 1] = y[i]!; this.buf[o + 2] = z[i]!;
      this.buf[o + 3] = this.rad[i]! * fade; this.buf[o + 4] = this.tint[i]!;
      n++;
    }
    this.count = n;
  }
}

interface FluidExports {
  memory: WebAssembly.Memory;
  fl_init(seed: number): void;
  fl_step(dt: number, emit: number, speed: number, tint: number): void;
  fl_count(): number;
  fl_out(): number;
}

/** The Rust build, from bytes. Throws if the module is not the fluid. */
export async function fluidFromWasm(bytes: BufferSource, seed = 1): Promise<Fluid> {
  const { instance } = (await WebAssembly.instantiate(bytes, {})) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
  const e = instance.exports as unknown as FluidExports;
  if (typeof e.fl_step !== "function" || !e.memory) throw new Error("not the hippo_fluid module");
  e.fl_init(seed);
  return {
    engine: "rust",
    step: (dt, emit, speed, tint) => e.fl_step(dt, emit, speed, tint),
    get count() { return e.fl_count(); },
    get out() { return new Float32Array(e.memory.buffer, e.fl_out(), e.fl_count() * STRIDE); },
  };
}

/** Rust/wasm when public/hippo_fluid.wasm is there, else the TypeScript twin. */
export async function loadFluid(seed = 1, url = "/hippo_fluid.wasm"): Promise<Fluid> {
  try {
    const r = await fetch(url);
    if (!r.ok || !(r.headers.get("content-type") ?? "").includes("wasm")) throw new Error(`no wasm at ${url}`);
    return await fluidFromWasm(await r.arrayBuffer(), seed);
  } catch { return new FluidTS(seed); }
}
