//! The game's rules, src/sim/step.ts, in Rust. Same arithmetic in the same order
//! as the TypeScript (all f64, only + - * / sqrt floor; cos/sin are the series
//! in src/sim/trig.ts), so the state hash matches on every tick
//! (test/sim-native.test.ts).
//!
//! C ABI, no wasm-bindgen. One state lives in the module:
//!   sim_new(seed, round_ticks)       a fresh round, like newState()
//!   sim_input(seat, move, gulp, bellow), then sim_step() -> event count
//!   sim_events() -> *const f64       EV_STRIDE f64 per event
//!   sim_hash() -> u32                hashState()
//!   sim_save() -> len, sim_buf()     the state as f64s (layout in `save`)
//!   sim_reserve(len) -> *mut f64, then sim_load(len)   replace the state
//!
//! Resident play (the state and the bots never leave the module):
//!   sim_reserve + sim_bot_load(seat, len)   a seat's bot (or none), sim_bot_save(seat) -> len
//!   sim_input for the human seats, then sim_tick() -> event count (the bots press their own)
//!   sim_view() -> len, sim_buf()     what a renderer needs (layout in `sim_view`)
//!   sim_over() -> 0/1

mod bots;
mod math;
mod rules;
mod sim;

use bots::{Bot, Personality};
use rules::SEATS;
use sim::{Drop, Ev, Hippo, Input, Slick, State};

pub use sim::State as SimState;

const EV_STRIDE: usize = 6;
const HEAD: usize = 10;
const HIPPO: usize = 10;
const DROP: usize = 7;
const SLICK: usize = 4;
const BOT: usize = 10;
const NO_BOT: Bot = Bot::empty();

struct Module { s: State, inputs: [Input; SEATS], events: Vec<Ev>, buf: Vec<f64>, bots: [Bot; SEATS] }

static mut M: Module = Module {
    s: State::empty(),
    bots: [NO_BOT; SEATS],
    inputs: [Input { mv: 0.0, gulp: false, bellow: false }; SEATS],
    events: Vec::new(),
    buf: Vec::new(),
};

fn m() -> &'static mut Module { unsafe { &mut *std::ptr::addr_of_mut!(M) } }
fn b(v: bool) -> f64 { if v { 1.0 } else { 0.0 } }
fn push_hippo(o: &mut Vec<f64>, h: &Hippo) {
    o.extend_from_slice(&[h.seat as f64, h.slide, h.gulp as f64, h.cooldown as f64, h.sputter as f64, h.sore as f64,
        b(h.flooded), b(h.dud), h.score as f64, h.bellow as f64]);
}

#[no_mangle]
pub extern "C" fn sim_new(seed: u32, round_ticks: u32) { m().s.reset(seed, round_ticks as i64); }

#[no_mangle]
pub extern "C" fn sim_input(seat: u32, mv: f64, gulp: u32, bellow: u32) {
    if let Some(i) = m().inputs.get_mut(seat as usize) { *i = Input { mv, gulp: gulp != 0, bellow: bellow != 0 }; }
}

#[no_mangle]
pub extern "C" fn sim_step() -> u32 {
    let m = m();
    m.events.clear();
    m.s.step(&m.inputs, &mut m.events);
    m.inputs = [Input::default(); SEATS];
    m.events.len() as u32
}

/// Every bot seat reads the state and presses its input, then one step.
#[no_mangle]
pub extern "C" fn sim_tick() -> u32 {
    let m = m();
    for (seat, b) in m.bots.iter_mut().enumerate() { if b.active { m.inputs[seat] = bots::bot(&m.s, seat, b); } }
    sim_step()
}

#[no_mangle] pub extern "C" fn sim_over() -> u32 { m().s.over as u32 }
#[no_mangle] pub extern "C" fn sim_events() -> *const f64 { m().events.as_ptr() as *const f64 }
#[no_mangle] pub extern "C" fn sim_hash() -> u32 { m().s.hash() }
#[no_mangle] pub extern "C" fn sim_buf() -> *const f64 { m().buf.as_ptr() }

#[no_mangle]
pub extern "C" fn sim_reserve(len: u32) -> *mut f64 {
    let m = m();
    m.buf.clear();
    m.buf.resize(len as usize, 0.0);
    m.buf.as_mut_ptr()
}

/// [tick, seed, rng, roundTicks, over, nextId, spawnCd, burst, drops, slicks],
/// then per hippo [seat, slide, gulp, cooldown, sputter, sore, flooded, dud, score, bellow],
/// per drop [id, kind, x, y, vx, vy, age], per slick [id, x, y, life].
#[no_mangle]
pub extern "C" fn sim_save() -> u32 {
    let m = m();
    let s = &m.s;
    let o = &mut m.buf;
    o.clear();
    o.extend_from_slice(&[s.tick as f64, s.seed, s.rng as f64, s.round_ticks as f64, b(s.over), s.next_id as f64,
        s.spawn_cd as f64, s.burst as f64, s.drops.len() as f64, s.slicks.len() as f64]);
    for h in &s.hippos { push_hippo(o, h); }
    for d in &s.drops { o.extend_from_slice(&[d.id as f64, d.kind as f64, d.x, d.y, d.vx, d.vy, d.age as f64]); }
    for k in &s.slicks { o.extend_from_slice(&[k.id as f64, k.x, k.y, k.life as f64]); }
    o.len() as u32
}

/// The inverse of `sim_save`, from the first `len` f64s of the buffer. Returns 0 if it is malformed.
#[no_mangle]
pub extern "C" fn sim_load(len: u32) -> u32 {
    let m = m();
    let i = &m.buf[..(len as usize).min(m.buf.len())];
    if i.len() < HEAD + SEATS * HIPPO { return 0; }
    let (nd, ns) = (i[8] as usize, i[9] as usize);
    if i.len() != HEAD + SEATS * HIPPO + nd * DROP + ns * SLICK { return 0; }
    let s = &mut m.s;
    s.tick = i[0] as i64; s.seed = i[1]; s.rng = i[2] as u32; s.round_ticks = i[3] as i64; s.over = i[4] != 0.0;
    s.next_id = i[5] as i64; s.spawn_cd = i[6] as i64; s.burst = i[7] as i64;
    for (k, h) in s.hippos.iter_mut().enumerate() {
        let r = &i[HEAD + k * HIPPO..];
        h.seat = r[0] as i64; h.slide = r[1]; h.gulp = r[2] as i64; h.cooldown = r[3] as i64; h.sputter = r[4] as i64;
        h.sore = r[5] as i64; h.flooded = r[6] != 0.0; h.dud = r[7] != 0.0; h.score = r[8] as i64; h.bellow = r[9] as i64;
    }
    let at = HEAD + SEATS * HIPPO;
    s.drops.clear();
    for r in i[at..at + nd * DROP].chunks_exact(DROP) {
        s.drops.push(Drop { id: r[0] as i64, kind: r[1] as i64, x: r[2], y: r[3], vx: r[4], vy: r[5], age: r[6] as i64 });
    }
    s.slicks.clear();
    for r in i[at + nd * DROP..].chunks_exact(SLICK) { s.slicks.push(Slick { id: r[0] as i64, x: r[1], y: r[2], life: r[3] as i64 }); }
    1
}

/// A seat's bot from the first `len` f64s of the buffer:
/// [active, reaction, aimError, greed, caution, target, err, nextPlan, rng, known count], then the known drop ids.
/// Returns 0 if it is malformed.
#[no_mangle]
pub extern "C" fn sim_bot_load(seat: u32, len: u32) -> u32 {
    let m = m();
    let i = &m.buf[..(len as usize).min(m.buf.len())];
    let Some(b) = m.bots.get_mut(seat as usize) else { return 0 };
    if i.len() < BOT || i.len() != BOT + i[9] as usize { return 0; }
    *b = Bot {
        active: i[0] != 0.0,
        p: Personality { reaction: i[1] as i64, aim_error: i[2], greed: i[3], caution: i[4] },
        target: i[5] as i64, err: i[6], next_plan: i[7] as i64, rng: i[8] as u32,
        known: i[BOT..].iter().map(|&k| k as i64).collect(),
    };
    1
}

/// The inverse of `sim_bot_load` into the buffer. Returns its length.
#[no_mangle]
pub extern "C" fn sim_bot_save(seat: u32) -> u32 {
    let m = m();
    let o = &mut m.buf;
    o.clear();
    let Some(t) = m.bots.get(seat as usize) else { return 0 };
    o.extend_from_slice(&[b(t.active), t.p.reaction as f64, t.p.aim_error, t.p.greed, t.p.caution,
        t.target as f64, t.err, t.next_plan as f64, t.rng as f64, t.known.len() as f64]);
    o.extend(t.known.iter().map(|&k| k as f64));
    o.len() as u32
}

/// What a renderer needs, into the buffer: [tick, roundTicks, over, drops, slicks],
/// then per hippo the `sim_save` layout, per drop [id, kind, x, y], per slick [id, x, y, life].
#[no_mangle]
pub extern "C" fn sim_view() -> u32 {
    let m = m();
    let s = &m.s;
    let o = &mut m.buf;
    o.clear();
    o.extend_from_slice(&[s.tick as f64, s.round_ticks as f64, b(s.over), s.drops.len() as f64, s.slicks.len() as f64]);
    for h in &s.hippos { push_hippo(o, h); }
    for d in &s.drops { o.extend_from_slice(&[d.id as f64, d.kind as f64, d.x, d.y]); }
    for k in &s.slicks { o.extend_from_slice(&[k.id as f64, k.x, k.y, k.life as f64]); }
    o.len() as u32
}

#[no_mangle] pub extern "C" fn sim_ev_stride() -> u32 { EV_STRIDE as u32 }
