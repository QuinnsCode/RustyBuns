//! src/sim/step.ts with spawn, physics, gulp, effects and hash: the same
//! arithmetic in the same order, so the state agrees bit for bit.
use crate::math::{between, cos_sin, int_between, js_round, len, next, pick};
use crate::rules::*;

#[derive(Clone, Copy, Default)]
pub struct Input { pub mv: f64, pub gulp: bool, pub bellow: bool }

#[derive(Clone, Copy, Default)]
pub struct Hippo {
    pub seat: i64, pub slide: f64, pub gulp: i64, pub cooldown: i64, pub sputter: i64, pub sore: i64,
    pub flooded: bool, pub dud: bool, pub score: i64, pub bellow: i64,
}

#[derive(Clone, Copy, Default)]
pub struct Drop { pub id: i64, pub kind: i64, pub x: f64, pub y: f64, pub vx: f64, pub vy: f64, pub age: i64 }

#[derive(Clone, Copy, Default)]
pub struct Slick { pub id: i64, pub x: f64, pub y: f64, pub life: i64 }

/// An event as [code, seat, kind, pts, x, y]. Codes follow the order of `Event` in src/sim/types.ts.
pub const EV_GULP: f64 = 0.0;
pub const EV_BELLOW: f64 = 1.0;
pub const EV_DUD: f64 = 2.0;
pub const EV_EAT: f64 = 3.0;
pub const EV_SPUTTER: f64 = 4.0;
pub const EV_SORE: f64 = 5.0;
pub const EV_FLOOD: f64 = 6.0;
pub const EV_SPAWN: f64 = 7.0;
pub const EV_SLICK: f64 = 8.0;
pub const EV_OVERFLOW: f64 = 9.0;
pub const EV_END: f64 = 10.0;
pub type Ev = [f64; 6];
fn ev(code: f64, seat: i64) -> Ev { [code, seat as f64, 0.0, 0.0, 0.0, 0.0] }

pub struct State {
    pub tick: i64, pub seed: f64, pub rng: u32, pub round_ticks: i64, pub over: bool,
    pub next_id: i64, pub spawn_cd: i64, pub burst: i64,
    pub hippos: [Hippo; SEATS], pub drops: Vec<Drop>, pub slicks: Vec<Slick>,
}

impl State {
    pub const fn empty() -> State {
        State {
            tick: 0, seed: 0.0, rng: 0, round_ticks: 0, over: false, next_id: 1, spawn_cd: 0, burst: 0,
            hippos: [Hippo { seat: 0, slide: 0.0, gulp: -1, cooldown: 0, sputter: 0, sore: 0, flooded: false, dud: false, score: 0, bellow: 0 }; SEATS],
            drops: Vec::new(), slicks: Vec::new(),
        }
    }

    pub fn reset(&mut self, seed: u32, round_ticks: i64) {
        *self = State::empty();
        self.seed = seed as f64;
        self.rng = seed ^ 0x9e37_79b9;
        self.round_ticks = round_ticks;
        self.spawn_cd = SPAWN_FIRST;
        for (i, h) in self.hippos.iter_mut().enumerate() { h.seat = i as i64; }
    }

    pub fn step(&mut self, inputs: &[Input; SEATS], out: &mut Vec<Ev>) {
        if self.over { return; }
        for h in self.hippos.iter_mut() { let seat = h.seat as usize; drive_hippo(h, &inputs[seat], out); }
        self.spawn(out);
        self.step_drops();
        self.resolve_gulps(out);
        self.step_effects(out);
        self.tick += 1;
        if self.tick == self.round_ticks - OVERFLOW_TICKS { out.push(ev(EV_OVERFLOW, 0)); }
        if self.tick >= self.round_ticks { self.over = true; out.push(ev(EV_END, 0)); }
    }

    // ---- spawn.ts --------------------------------------------------------
    fn in_overflow(&self) -> bool { self.tick >= self.round_ticks - OVERFLOW_TICKS }

    fn spawn_interval(&self) -> i64 {
        let p = (self.tick as f64 / self.round_ticks as f64).min(1.0);
        let base = SPAWN_START + (SPAWN_END - SPAWN_START) * p;
        let r = js_round(if self.in_overflow() { base * OVERFLOW_FACTOR } else { base });
        if r < 2.0 { 2 } else { r as i64 }
    }

    fn drip(&mut self, kind: i64, out: &mut Vec<Ev>) {
        let (c, s) = cos_sin(next(&mut self.rng) * core::f64::consts::PI * 2.0);
        let [lo, hi] = SPEED[kind as usize];
        let v = between(&mut self.rng, lo, hi) / TICK_HZ;
        self.drops.push(Drop { id: self.next_id, kind, x: c * 0.3, y: s * 0.3, vx: c * v, vy: s * v, age: 0 });
        self.next_id += 1;
        out.push([EV_SPAWN, 0.0, kind as f64, 0.0, 0.0, 0.0]);
    }

    fn spawn(&mut self, out: &mut Vec<Ev>) {
        self.spawn_cd -= 1;
        if self.spawn_cd > 0 { return; }
        if self.drops.len() >= MAX_DROPS { self.spawn_cd = 3; return; }
        if self.burst > 0 {
            self.burst -= 1;
            self.drip(GOLD, out);
            self.spawn_cd = if self.burst > 0 { BURST_GAP } else { self.spawn_interval() };
            return;
        }
        let weights = if self.in_overflow() { &WEIGHTS_OVERFLOW } else { &WEIGHTS };
        let kind = pick(&mut self.rng, weights) as i64;
        self.drip(kind, out);
        if kind == GOLD { self.burst = int_between(&mut self.rng, BURST_EXTRA[0], BURST_EXTRA[1]); }
        self.spawn_cd = if self.burst > 0 { BURST_GAP } else { self.spawn_interval() };
    }

    // ---- physics.ts ------------------------------------------------------
    fn step_drops(&mut self) {
        let (min_v, max_v) = (MIN_SPEED / TICK_HZ, MAX_SPEED / TICK_HZ);
        for d in self.drops.iter_mut() {
            d.age += 1;
            let mut slick = false;
            for k in &self.slicks {
                let (dx, dy) = (d.x - k.x, d.y - k.y);
                if dx * dx + dy * dy < SLICK_R * SLICK_R { slick = true; break; }
            }
            let r = len(d.x, d.y);
            if r > 1e-6 { let pull = DISH * (r / WALL_R); d.vx -= (d.x / r) * pull; d.vy -= (d.y / r) * pull; }
            let sp = len(d.vx, d.vy);
            if sp > 1e-9 {
                let f = if slick { SLICK_BOOST } else { FRICTION };
                let mut target = sp * f;
                if target < min_v { target = min_v; }
                if target > max_v { target = max_v; }
                d.vx *= target / sp; d.vy *= target / sp;
            }
            d.x += d.vx; d.y += d.vy;
            wall(d);
        }
        collide(&mut self.drops);
    }

    // ---- gulp.ts ---------------------------------------------------------
    fn resolve_gulps(&mut self, out: &mut Vec<Ev>) {
        let mut jaws: [(usize, f64, f64); SEATS] = [(0, 0.0, 0.0); SEATS];
        let mut n = 0;
        for (i, h) in self.hippos.iter().enumerate() {
            if h.gulp == GULP_OUT { let (x, y) = hippo_point(h.seat as usize, h.slide, 1.0); jaws[n] = (i, x, y); n += 1; }
        }
        if n == 0 { return; }
        for &(i, _, _) in &jaws[..n] { if self.hippos[i].dud { out.push(ev(EV_DUD, self.hippos[i].seat)); } }
        let hippos = &mut self.hippos;
        self.drops.retain(|d| {
            let mut best: Option<usize> = None;
            let mut best_d = f64::INFINITY;
            for &(i, x, y) in &jaws[..n] {
                if hippos[i].dud { continue; }
                let (dx, dy) = (d.x - x, d.y - y);
                let d2 = dx * dx + dy * dy;
                if d2 <= SCOOP_R * SCOOP_R && d2 < best_d { best = Some(i); best_d = d2; }
            }
            let Some(i) = best else { return true };
            let h = &mut hippos[i];
            let pts = POINTS[d.kind as usize];
            h.score = (h.score + pts).max(MIN_SCORE);
            out.push([EV_EAT, h.seat as f64, d.kind as f64, pts as f64, d.x, d.y]);
            if d.kind == SLUDGE { h.sputter = SPUTTER_TICKS; out.push(ev(EV_SPUTTER, h.seat)); }
            else if d.kind == NAIL { h.sore = SORE_TICKS; out.push(ev(EV_SORE, h.seat)); }
            else if d.kind == WATER { h.flooded = true; out.push(ev(EV_FLOOD, h.seat)); }
            false
        });
    }

    // ---- effects.ts ------------------------------------------------------
    fn step_effects(&mut self, out: &mut Vec<Ev>) {
        let (slicks, next_id) = (&mut self.slicks, &mut self.next_id);
        self.drops.retain(|d| {
            if !(d.kind == GOLD && d.age >= SLICK_AGE) { return true; }
            slicks.push(Slick { id: *next_id, x: d.x, y: d.y, life: SLICK_LIFE });
            *next_id += 1;
            out.push([EV_SLICK, 0.0, 0.0, 0.0, d.x, d.y]);
            false
        });
        for k in self.slicks.iter_mut() { k.life -= 1; }
        self.slicks.retain(|k| k.life > 0);
    }

    // ---- hash.ts ---------------------------------------------------------
    pub fn hash(&self) -> u32 {
        let mut h: u32 = 0x811c_9dc5;
        let mut mix = |n: f64| {
            let mut v = js_round(n * 10000.0) as i64 as u32;      // `| 0`, then `>>>` as unsigned
            for _ in 0..4 { h ^= v & 0xff; h = h.wrapping_mul(0x0100_0193); v >>= 8; }
        };
        mix(self.tick as f64); mix(self.rng as i32 as f64); mix(self.next_id as f64); mix(self.spawn_cd as f64);
        mix(self.burst as f64); mix(if self.over { 1.0 } else { 0.0 });
        for c in &self.hippos {
            mix(c.slide); mix(c.gulp as f64); mix(c.cooldown as f64); mix(c.sputter as f64); mix(c.sore as f64);
            mix(if c.flooded { 1.0 } else { 0.0 }); mix(if c.dud { 1.0 } else { 0.0 }); mix(c.score as f64); mix(c.bellow as f64);
        }
        for d in &self.drops { mix(d.id as f64); mix(d.kind as f64); mix(d.x); mix(d.y); mix(d.vx); mix(d.vy); mix(d.age as f64); }
        for k in &self.slicks { mix(k.id as f64); mix(k.x); mix(k.y); mix(k.life as f64); }
        h
    }
}

fn clamp(v: f64, lo: f64, hi: f64) -> f64 { if v < lo { lo } else if v > hi { hi } else { v } }

fn drive_hippo(h: &mut Hippo, inp: &Input, out: &mut Vec<Ev>) {
    if h.cooldown > 0 { h.cooldown -= 1; }
    if h.sputter > 0 { h.sputter -= 1; }
    if h.sore > 0 { h.sore -= 1; }
    if h.bellow > 0 { h.bellow -= 1; }
    if h.gulp >= 0 { h.gulp += 1; if h.gulp > GULP_OUT + GULP_BACK { h.gulp = -1; h.dud = false; } }

    if h.sputter == 0 {
        let speed = SLIDE_SPEED * if h.sore > 0 { SORE_FACTOR } else { 1.0 };
        h.slide = clamp(h.slide + clamp(inp.mv, -1.0, 1.0) * speed, -1.0, 1.0);
        if inp.gulp && h.cooldown == 0 && h.gulp < 0 {
            h.gulp = 0; h.cooldown = GULP_COOLDOWN;
            h.dud = h.flooded; h.flooded = false;
            out.push(ev(EV_GULP, h.seat));
        }
    }
    if inp.bellow { h.bellow = BELLOW_TICKS; out.push(ev(EV_BELLOW, h.seat)); }
}

/// geom.ts hippoPoint.
fn hippo_point(seat: usize, slide: f64, lunge: f64) -> (f64, f64) {
    let (c, s) = cos_sin(seat_angle(seat));
    let (ax, ay, tx, ty) = (c, s, -s, c);
    let axial = A_REST - LUNGE * lunge;
    let lateral = slide * RAIL_HALF;
    (ax * axial + tx * lateral, ay * axial + ty * lateral)
}

fn wall(d: &mut Drop) {
    let lim = WALL_R - DROP_R;
    let r = len(d.x, d.y);
    if r <= lim { return; }
    let (nx, ny) = (d.x / r, d.y / r);
    d.x = nx * lim; d.y = ny * lim;
    let vn = d.vx * nx + d.vy * ny;
    if vn > 0.0 { d.vx -= (1.0 + RESTITUTION) * vn * nx; d.vy -= (1.0 + RESTITUTION) * vn * ny; }
}

fn collide(ds: &mut [Drop]) {
    let min = 2.0 * DROP_R;
    for i in 0..ds.len() {
        for j in i + 1..ds.len() {
            let (a, b) = (ds[i], ds[j]);
            let (dx, dy) = (b.x - a.x, b.y - a.y);
            let d2 = dx * dx + dy * dy;
            if d2 >= min * min { continue; }
            let q = d2.sqrt();
            let d = if q == 0.0 || q.is_nan() { 1e-6 } else { q };   // `Math.sqrt(d2) || 1e-6`
            let (nx, ny, push) = (dx / d, dy / d, (min - d) / 2.0);
            let (a, b) = { let (l, r) = ds.split_at_mut(j); (&mut l[i], &mut r[0]) };
            a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
            let vn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
            if vn <= 0.0 { continue; }
            let imp = (vn * (1.0 + RESTITUTION)) / 2.0;
            a.vx -= imp * nx; a.vy -= imp * ny; b.vx += imp * nx; b.vy += imp * ny;
        }
    }
}
