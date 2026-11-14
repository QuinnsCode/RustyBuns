//! A fight's whole state as one flat list of numbers, in one order: `walk` feeds it to a sink. Hashed (FNV-1a over
//! every number's f64 bits) it is the tick-for-tick check against sim.ts; as a `Vec<f64>` it is what the page reads
//! every tick (src/sim-wasm.ts `readInto` walks it back into a Match). src/sim-wasm.ts `walk` writes a TS Match in this
//! same order, so a tick where the two sims part shows up as the first hash that differs.
//!
//! The layout: tick, over, winner (-1: none); each fighter (see `walk_fighter`); the live shapes (a count, then each);
//! this tick's events (a count, then each, led by its kind). `load_fighter` reads a fighter's part back in, for the
//! page's own writes (health carried between fights, a fighter put on the ledge).
use crate::data::{Delivery, FIELDS, SLOTS};
use crate::sim::{Act, Aim, Event, Fighter, How, Input, Key, Marks, Match, State, V3};
use std::rc::Rc;

pub trait Sink {
    fn num(&mut self, x: f64);
    fn flag(&mut self, b: bool) {
        self.num(if b { 1.0 } else { 0.0 });
    }
}

pub struct Fnv(pub u32);
impl Fnv {
    fn word(&mut self, w: u32) {
        self.0 = (self.0 ^ w).wrapping_mul(16777619);
    }
}
impl Sink for Fnv {
    fn num(&mut self, x: f64) {
        if x.is_nan() {
            self.word(0);
            self.word(0x7ff80000);
            return;
        }
        let b = x.to_bits();
        self.word(b as u32);
        self.word((b >> 32) as u32);
    }
}
impl Sink for Vec<f64> {
    fn num(&mut self, x: f64) {
        self.push(x);
    }
}

pub const KEYS: [Key; 9] = [
    Key::Up,
    Key::Down,
    Key::Light,
    Key::Heavy,
    Key::Special,
    Key::Ultimate,
    Key::Guard,
    Key::Dash,
    Key::Big,
];
const STATES: [State; 6] = [State::Free, State::Attack, State::Stun, State::Guard, State::Dash, State::Ledge];

fn key(k: Key) -> f64 {
    k as u32 as f64
}
fn state(s: State) -> f64 {
    s as u32 as f64
}

pub fn hash_match(m: &Match) -> u32 {
    let mut h = Fnv(2166136261);
    walk(m, &mut h);
    h.0
}

/// The whole state, as the page reads it.
pub fn flat(m: &Match, out: &mut Vec<f64>) {
    out.clear();
    walk(m, out);
}

pub fn walk(m: &Match, h: &mut impl Sink) {
    h.num(m.tick);
    h.flag(m.over);
    h.num(m.winner.map_or(-1.0, |w| w as f64));
    for f in &m.f {
        walk_fighter(m, f, h);
    }
    h.num(m.areas.len() as f64);
    for a in &m.areas {
        let a = a.borrow();
        h.num(a.owner as f64);
        h.num(a.mv.slot as u32 as f64);
        for x in [
            a.power, a.at.x, a.at.y, a.at.z, a.from.x, a.from.y, a.from.z, a.dir.x, a.dir.y, a.dir.z, a.t, a.life, a.land, a.every, a.ramp,
        ] {
            h.num(x);
        }
        // One per fighter: a slot nobody was caught in yet reads 0 (sim.ts's list starts two long, like this one).
        for k in 0..m.f.len() {
            h.num(a.hits.get(k).copied().unwrap_or(0.0));
        }
        for k in 0..m.f.len() {
            h.flag(a.struck.get(k).copied().unwrap_or(false));
        }
        h.num(a.d.index() as f64);
        match a.d {
            Delivery::Column { length, width, speed } => [length, width, speed].into_iter().for_each(|x| h.num(x)),
            Delivery::Wall { width, depth, travel, speed } => [width, depth, travel, speed].into_iter().for_each(|x| h.num(x)),
            Delivery::Cone { angle, length } => [angle, length].into_iter().for_each(|x| h.num(x)),
            Delivery::Blast { range, radius, flight } => [range, radius, flight].into_iter().for_each(|x| h.num(x)),
            Delivery::Nova { radius } => h.num(radius),
            Delivery::Touch => {}
        }
    }
    h.num(m.events.len() as f64);
    for e in &m.events {
        match e {
            Event::Hit {
                by,
                on,
                slot,
                field,
                damage,
                guarded,
                rear,
                spike,
                at,
            } => {
                h.num(0.0);
                h.num(*by as f64);
                h.num(*on as f64);
                h.num(*slot as u32 as f64);
                h.num(*field as f64);
                h.num(*damage);
                h.flag(*guarded);
                h.flag(*rear);
                h.flag(*spike);
                h.num(at.x);
                h.num(at.y);
                h.num(at.z);
            }
            Event::Move { by, slot, at, yaw, target } => {
                h.num(1.0);
                h.num(*by as f64);
                h.num(*slot as u32 as f64);
                for x in [at.x, at.y, at.z, *yaw, target.x, target.y, target.z] {
                    h.num(x);
                }
            }
            Event::Land { who, speed } => {
                h.num(2.0);
                h.num(*who as f64);
                h.num(*speed);
            }
            Event::Clipped { who } => {
                h.num(3.0);
                h.num(*who as f64);
            }
            Event::Ledge { who } => {
                h.num(4.0);
                h.num(*who as f64);
            }
            Event::Ko { who, how } => {
                h.num(5.0);
                h.num(*who as f64);
                h.num(match how {
                    How::Hp => 0.0,
                    How::RingOut => 1.0,
                    How::Time => 2.0,
                });
            }
        }
    }
}

/// One fighter: body and gauges, state, the press buffer, footwork, its team and whether it is out, marks, last tick's input, and the move in hand
/// (-1, or its slot and the rest; `area` is an index into the live shapes, -1 for one no longer in them, -2 for none).
pub fn walk_fighter(m: &Match, f: &Fighter, h: &mut impl Sink) {
    for x in [f.pos.x, f.pos.y, f.pos.z, f.vel.x, f.vel.y, f.vel.z, f.yaw, f.hp, f.launch, f.stamina, f.energy] {
        h.num(x);
    }
    h.num(state(f.state));
    h.num(f.t);
    h.num(f.stun);
    h.num(f.clipped);
    h.flag(f.flying);
    h.flag(f.on_ground);
    h.num(f.air_jumps);
    h.flag(f.rise);
    h.flag(f.exhausted);
    h.num(f.invuln);
    h.num(f.buf.map_or(-1.0, |b| key(b.0)));
    h.num(f.buf.map_or(0.0, |b| b.1));
    h.flag(f.hop);
    for x in [f.ring, f.spin, f.orbit, f.bearing, f.red, f.hurt] {
        h.num(x);
    }
    h.flag(f.fresh);
    h.num(f.drop);
    h.num(f.team as f64);
    h.flag(f.down);
    let k = &f.marks;
    h.num(k.dot);
    h.num(k.dot_per);
    h.num(k.dot_field.map_or(-1.0, |x| x as f64));
    h.num(k.chill);
    h.num(k.root);
    let p = &f.prev;
    h.num(p.mx);
    h.num(p.mz);
    for b in [p.up, p.down, p.light, p.heavy, p.special, p.ultimate, p.guard, p.dash, p.big] {
        h.flag(b);
    }
    match &f.act {
        None => h.num(-1.0),
        Some(a) => {
            h.num(a.mv.slot as u32 as f64);
            h.flag(a.hit);
            h.flag(a.dive);
            h.flag(a.tired);
            match a.aim {
                Some(aim) => {
                    h.num(1.0);
                    h.num(aim.yaw);
                    h.num(aim.pitch);
                }
                None => h.num(0.0),
            }
            h.num(a.key.map_or(-1.0, key));
            h.num(a.hold);
            h.num(a.lead);
            h.num(match &a.area {
                None => -2.0,
                Some(p) => m.areas.iter().position(|q| Rc::ptr_eq(p, q)).map_or(-1.0, |i| i as f64),
            });
        }
    }
}

/// Reads `s` front to back; anything past the end, or out of range, is an error rather than a guess.
struct Reader<'s> {
    s: &'s [f64],
    at: usize,
}
impl Reader<'_> {
    fn num(&mut self) -> Result<f64, String> {
        let x = *self.s.get(self.at).ok_or("fighter: too short")?;
        self.at += 1;
        Ok(x)
    }
    fn flag(&mut self) -> Result<bool, String> {
        Ok(self.num()? != 0.0)
    }
    fn index(&mut self, len: usize, what: &str) -> Result<Option<usize>, String> {
        let x = self.num()?;
        if x < 0.0 {
            return Ok(None);
        }
        if x.fract() != 0.0 || x as usize >= len {
            return Err(format!("fighter: {what} {x}"));
        }
        Ok(Some(x as usize))
    }
    fn v3(&mut self) -> Result<V3, String> {
        Ok(V3 {
            x: self.num()?,
            y: self.num()?,
            z: self.num()?,
        })
    }
}

/// `walk_fighter` backwards: fighter `side` takes the numbers in `s`. Its creature and body stay; a move in hand is
/// that creature's move in the slot, and its stream is the live shape at that index (-1 keeps the one it holds).
pub fn load_fighter(m: &mut Match, side: usize, s: &[f64]) -> Result<(), String> {
    let mut r = Reader { s, at: 0 };
    let (pos, vel) = (r.v3()?, r.v3()?);
    let (yaw, hp, launch, stamina, energy) = (r.num()?, r.num()?, r.num()?, r.num()?, r.num()?);
    let st = STATES[r.index(STATES.len(), "state")?.ok_or("fighter: state")?];
    let (t, stun, clipped) = (r.num()?, r.num()?, r.num()?);
    let (flying, on_ground, air_jumps, rise, exhausted, invuln) = (r.flag()?, r.flag()?, r.num()?, r.flag()?, r.flag()?, r.num()?);
    let buf_key = r.index(KEYS.len(), "buffered key")?;
    let buf_left = r.num()?;
    let hop = r.flag()?;
    let (ring, spin, orbit, bearing, red, hurt) = (r.num()?, r.num()?, r.num()?, r.num()?, r.num()?, r.num()?);
    let (fresh, drop) = (r.flag()?, r.num()?);
    let team = r.index(2, "team")?.ok_or("fighter: team")?;
    let down = r.flag()?;
    let (dot, dot_per) = (r.num()?, r.num()?);
    let dot_field = r.index(FIELDS, "mark field")?.map(|x| x as u8);
    let (chill, root) = (r.num()?, r.num()?);
    let mut prev = Input {
        mx: r.num()?,
        mz: r.num()?,
        ..Input::default()
    };
    for k in KEYS {
        prev.set(k, r.flag()?);
    }
    let act = match r.index(SLOTS.len(), "slot")? {
        None => None,
        Some(slot) => {
            let mv = *m.f[side].mv(SLOTS[slot]);
            let (hit, dive, tired) = (r.flag()?, r.flag()?, r.flag()?);
            let aim = if r.flag()? {
                Some(Aim {
                    yaw: r.num()?,
                    pitch: r.num()?,
                })
            } else {
                None
            };
            let key = r.index(KEYS.len(), "held key")?.map(|k| KEYS[k]);
            let (hold, lead) = (r.num()?, r.num()?);
            let area = match r.num()? {
                -2.0 => None,
                -1.0 => m.f[side].act.as_ref().and_then(|a| a.area.clone()),
                x => Some(
                    m.areas
                        .get(x as usize)
                        .filter(|_| x >= 0.0 && x.fract() == 0.0)
                        .ok_or(format!("fighter: area {x}"))?
                        .clone(),
                ),
            };
            Some(Act {
                mv,
                hit,
                dive,
                tired,
                aim,
                key,
                hold,
                lead,
                area,
            })
        }
    };
    if r.at != s.len() {
        return Err(format!("fighter: {} numbers, read {}", s.len(), r.at));
    }
    let f = &mut m.f[side];
    (f.pos, f.vel, f.yaw, f.hp, f.launch, f.stamina, f.energy) = (pos, vel, yaw, hp, launch, stamina, energy);
    (f.state, f.t, f.stun, f.clipped) = (st, t, stun, clipped);
    (f.flying, f.on_ground, f.air_jumps, f.rise, f.exhausted, f.invuln) = (flying, on_ground, air_jumps, rise, exhausted, invuln);
    f.buf = buf_key.map(|k| (KEYS[k], buf_left));
    f.hop = hop;
    (f.team, f.down) = (team, down);
    (f.ring, f.spin, f.orbit, f.bearing, f.red, f.hurt, f.fresh, f.drop) = (ring, spin, orbit, bearing, red, hurt, fresh, drop);
    f.marks = Marks {
        dot,
        dot_per,
        dot_field,
        chill,
        root,
    };
    f.prev = prev;
    f.act = act;
    Ok(())
}
