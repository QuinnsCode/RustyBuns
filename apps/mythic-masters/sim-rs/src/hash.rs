//! A fight's whole state as one 32-bit FNV-1a hash, every number by its f64 bits. scripts/sim-rust.ts `hashMatch`
//! walks the TS Match in this same order, so a tick where the two sims part shows up as the first hash that differs.
use crate::data::Delivery;
use crate::sim::{Event, How, Key, Match, State};
use std::rc::Rc;

pub struct Fnv(pub u32);
impl Fnv {
    fn word(&mut self, w: u32) {
        self.0 = (self.0 ^ w).wrapping_mul(16777619);
    }
    pub fn num(&mut self, x: f64) {
        if x.is_nan() {
            self.word(0);
            self.word(0x7ff80000);
            return;
        }
        let b = x.to_bits();
        self.word(b as u32);
        self.word((b >> 32) as u32);
    }
    fn flag(&mut self, b: bool) {
        self.num(if b { 1.0 } else { 0.0 });
    }
}

fn key(k: Key) -> f64 {
    k as u32 as f64
}
fn state(s: State) -> f64 {
    s as u32 as f64
}

pub fn hash_match(m: &Match) -> u32 {
    let mut h = Fnv(2166136261);
    h.num(m.tick);
    h.flag(m.over);
    h.num(m.winner.map_or(-1.0, |w| w as f64));
    for f in &m.f {
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
    h.num(m.areas.len() as f64);
    for a in &m.areas {
        let a = a.borrow();
        h.num(a.owner as f64);
        h.num(a.mv.slot as u32 as f64);
        for x in [
            a.power, a.at.x, a.at.y, a.at.z, a.from.x, a.from.y, a.from.z, a.dir.x, a.dir.y, a.dir.z, a.t, a.life, a.land, a.every, a.ramp, a.hits[0],
            a.hits[1],
        ] {
            h.num(x);
        }
        h.flag(a.struck[0]);
        h.flag(a.struck[1]);
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
    h.0
}
