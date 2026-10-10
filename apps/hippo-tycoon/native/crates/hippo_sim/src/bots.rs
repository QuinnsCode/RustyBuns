//! src/sim/bots.ts: the same arithmetic in the same order, and the same draws
//! from each bot's own mulberry32, so a bot presses the same buttons in both.
use crate::math::{cos_sin, len, next};
use crate::rules::*;
use crate::sim::{hippo_point, Input, State};

#[derive(Clone, Copy, Default)]
pub struct Personality { pub reaction: i64, pub aim_error: f64, pub greed: f64, pub caution: f64 }

/// BotMem, plus the bot's RNG and how it plays. `active` = a bot drives this seat.
#[derive(Default)]
pub struct Bot {
    pub active: bool, pub p: Personality,
    pub target: i64, pub err: f64, pub next_plan: i64, pub known: Vec<i64>, pub rng: u32,
}

impl Bot {
    pub const fn empty() -> Bot {
        Bot { active: false, p: Personality { reaction: 0, aim_error: 0.0, greed: 0.0, caution: 0.0 },
            target: 0, err: 0.0, next_plan: 0, known: Vec::new(), rng: 0 }
    }
}

const A_PEAK: f64 = A_REST - LUNGE;
const HORIZON: i64 = 40;
const FIRST_K: i64 = GULP_OUT + 1;
const BAND: f64 = SCOOP_R * 0.6;

struct Intercept { k: i64, aim: f64, off: f64 }

fn intercept(s: &State, seat: usize, id: i64, slide: f64, speed: f64) -> Option<Intercept> {
    let d = s.drops.iter().find(|x| x.id == id)?;
    let (c, sn) = cos_sin(seat_angle(seat));
    let (ax, ay, tx, ty) = (c, sn, -sn, c);
    let mut best: Option<Intercept> = None;
    for k in FIRST_K..=HORIZON {
        let kf = k as f64;
        let (x, y) = (d.x + d.vx * kf, d.y + d.vy * kf);
        if len(x, y) > WALL_R - DROP_R { break; }
        let (axial, lateral) = (x * ax + y * ay, x * tx + y * ty);
        let aim = lateral / RAIL_HALF;
        if aim.abs() > 1.0 { continue; }
        if (aim - slide).abs() / speed > kf { continue; }
        let off = (axial - A_PEAK).abs();
        if best.as_ref().is_none_or(|b| off < b.off) { best = Some(Intercept { k, aim, off }); }
    }
    best
}

fn is_bad(kind: i64) -> bool { kind == SLUDGE || kind == NAIL || kind == WATER }

fn knows(id: i64, kind: i64, b: &mut Bot) -> bool {
    if !is_bad(kind) { return false; }
    if !b.known.contains(&id) && next(&mut b.rng) < b.p.caution { b.known.push(id); }
    b.known.contains(&id)
}

fn worth(kind: i64, p: &Personality) -> f64 { if kind == GOLD { 1.0 + 2.0 * p.greed } else { 1.0 } }

fn bite_value(s: &State, seat: usize, slide: f64, k: i64, b: &mut Bot) -> f64 {
    let (jx, jy) = hippo_point(seat, slide, 1.0);
    let kf = k as f64;
    let mut v = 0.0;
    for d in &s.drops {
        let (dx, dy) = (d.x + d.vx * kf - jx, d.y + d.vy * kf - jy);
        if dx * dx + dy * dy > SCOOP_R * SCOOP_R { continue; }
        v += if knows(d.id, d.kind, b) { (POINTS[d.kind as usize] as f64).min(-0.5) } else { worth(d.kind, &b.p) };
    }
    v
}

fn clamp1(v: f64) -> f64 { (-1.0f64).max(1.0f64.min(v)) }

pub fn bot(s: &State, seat: usize, b: &mut Bot) -> Input {
    let h = &s.hippos[seat];
    let speed = SLIDE_SPEED * if h.sore > 0 { SORE_FACTOR } else { 1.0 };
    let idle = Input::default();

    if b.target != 0 && !s.drops.iter().any(|d| d.id == b.target) { b.target = 0; }
    if b.target == 0 && s.tick >= b.next_plan {
        b.next_plan = s.tick + b.p.reaction;
        let (mut best_id, mut best_v, mut best_k) = (0, 0.0, 1e9);
        for d in &s.drops {
            if knows(d.id, d.kind, b) { continue; }
            let v = worth(d.kind, &b.p);
            let Some(ic) = intercept(s, seat, d.id, h.slide, speed) else { continue };
            if ic.off > BAND * 2.0 { continue; }
            if v > best_v || (v == best_v && (ic.k as f64) < best_k) { best_id = d.id; best_v = v; best_k = ic.k as f64; }
        }
        if best_id != 0 { b.target = best_id; b.err = (next(&mut b.rng) * 2.0 - 1.0) * b.p.aim_error; }
    }
    if b.target == 0 { return idle; }

    let ic = match intercept(s, seat, b.target, h.slide, speed) {
        Some(ic) if !(ic.k == FIRST_K && ic.off > BAND) => ic,
        _ => { b.target = 0; return idle; }
    };
    let aim = clamp1(ic.aim + b.err);
    let mv = clamp1((aim - h.slide) / speed);
    let ready = h.cooldown == 0 && h.gulp < 0 && h.sputter == 0;
    let mut fire = ready && ic.k == FIRST_K && ic.off <= BAND;
    if fire && bite_value(s, seat, h.slide, FIRST_K, b) <= 0.0 { fire = false; b.target = 0; }
    if fire { b.target = 0; }
    Input { mv, gulp: fire, bellow: false }
}
