//! The oil geyser's fluid: a small particle simulation (pressure, cohesion and
//! viscosity between neighbours, gravity, a floor) that only decorates the
//! pan. It has a TypeScript twin (src/client/render/fluid.ts) that does the same
//! arithmetic in the same order, so the two agree bit for bit: everything is f64,
//! and nothing but + - * / sqrt is used (no trig, no pow, whose last bits differ
//! between libms). The game's rules never read it.
//!
//! C ABI, no wasm-bindgen: fl_init, fl_step, fl_count, fl_out.

const CAP: usize = 1400;
const H: f64 = 0.55;                 // interaction radius, also the grid cell
const NX: usize = 30;
const NY: usize = 22;
const NZ: usize = 30;
const HALF: f64 = 8.0;               // the grid covers x, z in [-8, 8)
const NCELL: usize = NX * NY * NZ;
const G: f64 = 9.8;
const REP: f64 = 30.0;
const COH: f64 = 14.0;
const VISC: f64 = 2.5;
const AMAX: f64 = 200.0;
const VENT_Y: f64 = 1.1;
const FLOOR: f64 = 0.12;
const WALL: f64 = 7.0;
const STRIDE: usize = 5;

struct State {
    rng: u32,
    cursor: usize,
    x: [f64; CAP], y: [f64; CAP], z: [f64; CAP],
    vx: [f64; CAP], vy: [f64; CAP], vz: [f64; CAP],
    ax: [f64; CAP], ay: [f64; CAP], az: [f64; CAP],
    life: [f64; CAP], rad: [f64; CAP], tint: [f64; CAP],
    head: [i32; NCELL], next: [i32; CAP],
    count: u32,
    out: [f32; CAP * STRIDE],
}

static mut ST: State = State {
    rng: 1, cursor: 0,
    x: [0.0; CAP], y: [0.0; CAP], z: [0.0; CAP], vx: [0.0; CAP], vy: [0.0; CAP], vz: [0.0; CAP],
    ax: [0.0; CAP], ay: [0.0; CAP], az: [0.0; CAP], life: [0.0; CAP], rad: [0.0; CAP], tint: [0.0; CAP],
    head: [-1; NCELL], next: [-1; CAP], count: 0, out: [0.0; CAP * STRIDE],
};

fn st() -> &'static mut State { unsafe { &mut *std::ptr::addr_of_mut!(ST) } }

impl State {
    fn rand(&mut self) -> f64 {
        let mut s = self.rng;
        s ^= s << 13; s ^= s >> 17; s ^= s << 5;
        self.rng = s;
        s as f64 / 4294967296.0
    }

    fn spawn(&mut self, speed: f64, tint: f64) {
        let mut found = CAP;
        for k in 0..CAP {
            let i = (self.cursor + k) % CAP;
            if self.life[i] <= 0.0 { found = i; break; }
        }
        if found == CAP { return; }
        self.cursor = (found + 1) % CAP;
        let i = found;
        let jx = (self.rand() - 0.5) * 0.25;
        let jz = (self.rand() - 0.5) * 0.25;
        let spread = 2.8 + speed * 0.6;
        let vx = (self.rand() - 0.5) * spread;
        let vz = (self.rand() - 0.5) * spread;
        let vy = speed * (0.7 + 0.4 * self.rand());
        let rad = 0.09 + 0.08 * self.rand();
        let life = 1.8 + 0.8 * self.rand();
        self.x[i] = jx; self.y[i] = VENT_Y; self.z[i] = jz;
        self.vx[i] = vx; self.vy[i] = vy; self.vz[i] = vz;
        self.rad[i] = rad; self.life[i] = life; self.tint[i] = tint;
    }
}

fn cell(x: f64, y: f64, z: f64) -> usize {
    let cx = clampi(((x + HALF) / H).floor() as i64, NX as i64 - 1);
    let cy = clampi((y / H).floor() as i64, NY as i64 - 1);
    let cz = clampi(((z + HALF) / H).floor() as i64, NZ as i64 - 1);
    (cx as usize) + NX * ((cy as usize) + NY * (cz as usize))
}
fn clampi(v: i64, hi: i64) -> i64 { if v < 0 { 0 } else if v > hi { hi } else { v } }
fn clampf(v: f64, lim: f64) -> f64 { if v < -lim { -lim } else if v > lim { lim } else { v } }

#[no_mangle]
pub extern "C" fn fl_init(seed: u32) {
    let s = st();
    s.rng = if seed == 0 { 1 } else { seed };
    s.cursor = 0; s.count = 0;
    for i in 0..CAP { s.life[i] = 0.0; }
}

/// Advance by `dt` seconds, first spawning `emit` particles at `speed` (tint 0 oil, 1 gold).
#[no_mangle]
pub extern "C" fn fl_step(dt: f64, emit: u32, speed: f64, tint: f64) {
    let s = st();
    for _ in 0..emit { s.spawn(speed, tint); }

    for c in 0..NCELL { s.head[c] = -1; }
    for i in 0..CAP {
        s.ax[i] = 0.0; s.ay[i] = 0.0; s.az[i] = 0.0;
        if s.life[i] > 0.0 {
            let c = cell(s.x[i], s.y[i], s.z[i]);
            s.next[i] = s.head[c];
            s.head[c] = i as i32;
        }
    }

    for i in 0..CAP {
        if s.life[i] <= 0.0 { continue; }
        let (xi, yi, zi) = (s.x[i], s.y[i], s.z[i]);
        let cx = clampi(((xi + HALF) / H).floor() as i64, NX as i64 - 1);
        let cy = clampi((yi / H).floor() as i64, NY as i64 - 1);
        let cz = clampi(((zi + HALF) / H).floor() as i64, NZ as i64 - 1);
        for dz in -1i64..=1 { for dy in -1i64..=1 { for dx in -1i64..=1 {
            let (nx, ny, nz) = (cx + dx, cy + dy, cz + dz);
            if nx < 0 || ny < 0 || nz < 0 || nx >= NX as i64 || ny >= NY as i64 || nz >= NZ as i64 { continue; }
            let mut j = s.head[(nx as usize) + NX * ((ny as usize) + NY * (nz as usize))];
            while j != -1 {
                let ju = j as usize;
                if ju > i {
                    let (ddx, ddy, ddz) = (xi - s.x[ju], yi - s.y[ju], zi - s.z[ju]);
                    let d2 = ddx * ddx + ddy * ddy + ddz * ddz;
                    if d2 < H * H && d2 > 1e-12 {
                        let d = d2.sqrt();
                        let q = d / H;
                        let f = if q < 0.55 { REP * (0.55 - q) } else { -COH * (q - 0.55) * (1.0 - q) * 4.0 };
                        let (ux, uy, uz) = (ddx / d, ddy / d, ddz / d);
                        let w = 1.0 - q;
                        let (dvx, dvy, dvz) = (s.vx[ju] - s.vx[i], s.vy[ju] - s.vy[i], s.vz[ju] - s.vz[i]);
                        let (fx, fy, fz) = (f * ux + VISC * w * dvx, f * uy + VISC * w * dvy, f * uz + VISC * w * dvz);
                        s.ax[i] += fx; s.ay[i] += fy; s.az[i] += fz;
                        s.ax[ju] -= fx; s.ay[ju] -= fy; s.az[ju] -= fz;
                    }
                }
                j = s.next[ju];
            }
        }}}
    }

    let drag = 1.0 - 0.4 * dt;
    for i in 0..CAP {
        if s.life[i] <= 0.0 { continue; }
        s.vx[i] = (s.vx[i] + clampf(s.ax[i], AMAX) * dt) * drag;
        s.vy[i] = (s.vy[i] + (clampf(s.ay[i], AMAX) - G) * dt) * drag;
        s.vz[i] = (s.vz[i] + clampf(s.az[i], AMAX) * dt) * drag;
        s.x[i] += s.vx[i] * dt; s.y[i] += s.vy[i] * dt; s.z[i] += s.vz[i] * dt;
        if s.y[i] < FLOOR {                       // splash onto the basin and soak in
            s.y[i] = FLOOR;
            if s.vy[i] < 0.0 { s.vy[i] = -s.vy[i] * 0.12; }
            s.vx[i] *= 0.7; s.vz[i] *= 0.7;
            s.life[i] -= 0.05;
        }
        let rr = (s.x[i] * s.x[i] + s.z[i] * s.z[i]).sqrt();
        if rr > WALL { let k = WALL / rr; s.x[i] *= k; s.z[i] *= k; s.vx[i] *= 0.2; s.vz[i] *= 0.2; }
        s.life[i] -= dt;
        if s.life[i] < 0.0 { s.life[i] = 0.0; }
    }

    let mut n = 0usize;
    for i in 0..CAP {
        if s.life[i] <= 0.0 { continue; }
        let fade = if s.life[i] < 0.5 { s.life[i] / 0.5 } else { 1.0 };
        let o = n * STRIDE;
        s.out[o] = s.x[i] as f32; s.out[o + 1] = s.y[i] as f32; s.out[o + 2] = s.z[i] as f32;
        s.out[o + 3] = (s.rad[i] * fade) as f32; s.out[o + 4] = s.tint[i] as f32;
        n += 1;
    }
    s.count = n as u32;
}

#[no_mangle] pub extern "C" fn fl_count() -> u32 { st().count }
#[no_mangle] pub extern "C" fn fl_out() -> *const f32 { st().out.as_ptr() }
#[no_mangle] pub extern "C" fn fl_stride() -> u32 { STRIDE as u32 }
