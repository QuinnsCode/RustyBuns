//! src/bot.ts, statement for statement. Its random stream is mulberry32 (`@rustybuns/util`), and every `rnd()`
//! sits behind the same `&&` and `||` as in TS, so the two draw the same numbers in the same order.
use crate::data::{Archetype, Slot};
use crate::dmath::{atan2, cos, hypot, max, min, or1, sin};
use crate::sim::{
    covers, frames, head, held, sweep, swing_phase, Fighter, Input, Key, Match, Phase, State, ARENA_RADIUS, COST, DIVE_TUCK, HZ, IDLE, ORBIT_FREE, ROUND_TICKS,
    TAKEOFF,
};

const RING: f64 = 0.8;
const COMMIT_CHANCE: f64 = 0.12;
const COMMIT_TICKS: f64 = 45.0;
const COMMIT_REST: f64 = 8.0;
fn sidestep(a: Archetype) -> f64 {
    match a {
        Archetype::Skirmisher => 0.1,
        Archetype::Flyer => 0.06,
        Archetype::Bruiser => 0.04,
        Archetype::Tank => 0.015,
    }
}
const WINGS_LAND: f64 = 0.1;
const WINGS_FLY: f64 = if TAKEOFF > 0.9 { TAKEOFF } else { 0.9 };

/// `@rustybuns/util` nextRandom: mulberry32 on a u32, the JS `>>> 0` and `Math.imul` as wrapping u32 math.
pub struct Rng(u32);
impl Rng {
    pub fn new(seed: f64) -> Self {
        // `seed >>> 0`: the seeds are small whole numbers.
        Rng((seed as i64) as u32)
    }
    pub fn float(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4294967296.0
    }
}

pub struct Bot {
    side: usize,
    rnd: Rng,
    hold: Input,
    hold_for: f64,
    flip: bool,
    turn: f64,
    rest: f64,
    commit: f64,
    dir: f64,
    orbit: f64,
}

/// What `think` is working on: the input it builds, and the bot's own state its `press` and `goTo` touch.
struct Ctx<'b> {
    i: Input,
    bot: &'b mut Bot,
}

impl Bot {
    pub fn new(side: usize, seed: f64) -> Self {
        let mut rnd = Rng::new(seed);
        let dir = if rnd.float() < 0.5 { 1.0 } else { -1.0 };
        let orbit = if rnd.float() < 0.5 { 1.0 } else { -1.0 };
        Bot {
            side,
            rnd,
            hold: IDLE,
            hold_for: 0.0,
            flip: false,
            turn: 120.0,
            rest: 0.0,
            commit: 0.0,
            dir,
            orbit,
        }
    }

    /// The bot's input this tick (bot.ts's returned function).
    pub fn act(&mut self, m: &Match) -> Input {
        let mut i = self.think(m);
        let me = &m.f[self.side];
        if me.hop && me.prev.up {
            i.up = true;
        }
        i
    }

    fn think(&mut self, m: &Match) -> Input {
        let side = self.side;
        let me = &m.f[side];
        let o = &m.f[1 - side];
        self.flip = !self.flip;
        if self.hold_for > 0.0 {
            self.hold_for -= 1.0;
            let mut i = self.hold;
            if !self.flip {
                i.light = false;
                i.heavy = false;
                i.special = false;
                i.ultimate = false;
                i.dash = false;
                i.up = false;
            }
            return i;
        }
        if me.state == State::Attack {
            if let Some(a) = me.act.as_ref() {
                if let Some(key) = a.key {
                    if a.area.is_some() || key == Key::Big {
                        let h = a.hold;
                        let keep = if let Some(area) = a.area.as_ref() {
                            let area = area.borrow();
                            covers(&area, o) || h < 30.0 + area.land
                        } else {
                            hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z) > 8.0 && o.state != State::Attack && h < 50.0
                        };
                        let mut i = IDLE;
                        if keep {
                            i.set(key, true);
                        }
                        return i;
                    }
                }
            }
        }
        if me.state == State::Attack || me.state == State::Stun {
            return IDLE;
        }
        let mut c = Ctx { i: IDLE, bot: self };
        let dx = o.pos.x - me.pos.x;
        let dz = o.pos.z - me.pos.z;
        let d = or1(hypot(dx, dz));
        let above = o.pos.y - me.pos.y;
        let reach = me.b.radius + o.b.radius + 1.0;
        let facing = (dx * cos(me.yaw) + dz * sin(me.yaw)) / d > 0.6;
        let in_reach = |slot: Slot| me.mv(slot).delivery.reach() + me.b.radius + o.b.radius;

        if me.state == State::Ledge {
            if me.t < 6.0 || c.bot.rnd.float() > 0.035 {
                return c.i;
            }
            let waiting = hypot(o.pos.x - me.pos.x, o.pos.z - me.pos.z) < me.b.radius + o.b.radius + 1.5;
            let r = c.bot.rnd.float();
            let k = if waiting {
                if r < 0.6 {
                    Key::Dash
                } else if r < 0.85 {
                    Key::Light
                } else {
                    Key::Up
                }
            } else if r < 0.5 {
                Key::Up
            } else if r < 0.75 {
                Key::Dash
            } else {
                Key::Light
            };
            c.press(me, k);
            return c.i;
        }
        let threat = m.areas.iter().any(|a| {
            let a = a.borrow();
            a.owner != side
                && (covers(&a, me) || {
                    let h = head(&a);
                    hypot(h.x - me.pos.x, h.z - me.pos.z) < 4.0
                })
        });
        let off = me.pos.y < -0.5 || hypot(me.pos.x, me.pos.z) > ARENA_RADIUS;

        if off {
            c.go_to(me, 0.0, 0.0);
            if me.b.mass < 30.0 && me.pos.y > 0.0 && !me.exhausted && me.stamina >= me.b.dash_cost {
                c.press(me, Key::Dash);
                if c.i.dash {
                    return c.i;
                }
            }
            let can_fly = me.b.flight && me.clipped == 0.0 && !me.exhausted;
            if me.flying {
                c.i.up = true;
            } else if me.vel.y < 1.0 {
                if me.air_jumps > 0.0 || can_fly {
                    c.press(me, Key::Up);
                } else if me.rise {
                    c.i.up = true;
                    c.press(me, Key::Heavy);
                }
            }
            return c.i;
        }

        let o_dive = o.act.as_ref().is_some_and(|a| a.dive);
        if o_dive && me.state == State::Guard {
            c.i.guard = true;
            return c.i;
        }
        if o_dive && me.on_ground && d < reach + 4.0 && c.bot.rnd.float() < 0.5 {
            if frames(me.mv(Slot::Launcher), false).startup <= DIVE_TUCK + 6.0 || me.exhausted {
                c.i.up = true;
                c.press(me, Key::Heavy);
                return c.i;
            }
            c.i.guard = true;
            return c.i;
        }

        if above > 1.2 && above < 4.5 && d < reach + 1.0 && c.bot.rnd.float() < 0.5 {
            c.i.up = true;
            c.press(me, Key::Heavy);
            return c.i;
        }

        if swing_phase(o) == Some(Phase::Locked)
            && o.act.as_ref().is_some_and(|a| o.t < frames(&a.mv, a.tired).startup)
            && me.on_ground
            && !me.exhausted
            && me.stamina >= me.b.dash_cost
        {
            let (sreach, ahead) = sweep(o, me, o.act.as_ref().unwrap().mv.slot);
            let kx = cos(o.yaw);
            let kz = sin(o.yaw);
            let in_sweep = d < sreach + 0.4 && (-dx * kx - dz * kz) / d > ahead - 0.15;
            if in_sweep && c.bot.rnd.float() < sidestep(me.c.archetype) {
                let s = if -dx * -kz + -dz * kx >= 0.0 { 1.0 } else { -1.0 };
                c.i.mx = -kz * s;
                c.i.mz = kx * s;
                c.press(me, Key::Dash);
                if c.i.dash {
                    return c.i;
                }
            }
        }

        if threat && !me.exhausted && c.bot.rnd.float() < (if me.b.mass < 30.0 { 0.08 } else { 0.03 }) {
            let k = if side == 1 { -1.0 } else { 1.0 };
            c.i.mx = -dz / d * k;
            c.i.mz = dx / d * k;
            c.press(me, Key::Dash);
            return c.i;
        }

        let o_off = o.state == State::Ledge || (!o.on_ground && hypot(o.pos.x, o.pos.z) > ARENA_RADIUS);
        if o_off && me.on_ground && me.c.archetype != Archetype::Flyer && !me.exhausted {
            let or = or1(hypot(o.pos.x, o.pos.z));
            let lip = ARENA_RADIUS - me.b.radius - 0.4;
            let tx = (o.pos.x / or) * lip - me.pos.x;
            let tz = (o.pos.z / or) * lip - me.pos.z;
            let tn = hypot(tx, tz);
            if tn > 0.3 {
                c.i.mx = tx / tn;
                c.i.mz = tz / tn;
            }
            let open = if o.state == State::Ledge {
                o.invuln == 0.0
            } else {
                o.state != State::Stun && o.pos.y <= me.pos.y + 0.3 && o.pos.y > -1.5
            };
            if open && d < reach + 0.4 && facing && c.bot.rnd.float() < 0.5 {
                c.i.mx = 0.0;
                c.i.mz = 0.0;
                c.press(me, Key::Heavy);
            }
            return c.i;
        }
        let resting = me.c.archetype == Archetype::Flyer && me.on_ground && me.stamina < me.b.stamina * WINGS_FLY;
        let plays = if resting { Archetype::Bruiser } else { me.c.archetype };
        match plays {
            Archetype::Skirmisher => {
                let back = (o.pos.x - cos(o.yaw) * (o.b.radius + 1.3), o.pos.z - sin(o.yaw) * (o.b.radius + 1.3));
                let behind = (dx * cos(o.yaw) + dz * sin(o.yaw)) / d > 0.0;
                let open = behind
                    || o.state == State::Stun
                    || held(o) > 0.0
                    || (o.state == State::Attack && o.act.as_ref().is_some_and(|a| o.t > frames(&a.mv, false).startup + 2.0));
                let orbit = c.bot.orbit;
                if !behind && d < reach + 3.0 && me.stamina > me.b.dash_cost * 3.0 && c.bot.rnd.float() < 0.05 {
                    c.i.mx = (-dz / d) * orbit + (dx / d) * 0.4;
                    c.i.mz = (dx / d) * orbit + (dz / d) * 0.4;
                    c.press(me, Key::Dash);
                    return c.i;
                }
                let gap = d - (reach + 1.5);
                let dizzy = me.orbit.abs() > ORBIT_FREE;
                if dizzy {
                    c.go_to(me, o.pos.x - (dx / d) * (reach - 0.4), o.pos.z - (dz / d) * (reach - 0.4));
                } else if !behind && d < reach + 3.0 {
                    c.go_to(
                        me,
                        me.pos.x - (dz / d) * orbit * 3.0 + (dx / d) * gap,
                        me.pos.z + (dx / d) * orbit * 3.0 + (dz / d) * gap,
                    );
                } else {
                    c.go_to(me, back.0, back.1);
                }
                if d < reach && above.abs() < 2.0 && (open || (dizzy && c.bot.rnd.float() < 0.25)) {
                    let k = if o.state == State::Stun && c.bot.rnd.float() < 0.3 {
                        Key::Heavy
                    } else {
                        Key::Light
                    };
                    c.press(me, k);
                    return c.i;
                }
                if d < reach + 0.5 && !open && o.state == State::Attack && me.stamina > me.b.dash_cost * 2.0 && c.bot.rnd.float() < 0.4 {
                    c.i.mx = (-dz / d) * orbit;
                    c.i.mz = (dx / d) * orbit;
                    c.press(me, Key::Dash);
                    return c.i;
                }
                if me.energy >= 100.0 && d < 8.0 {
                    c.press(me, Key::Ultimate);
                    return c.i;
                }
                if above > 1.5 && d > 3.0 && me.energy >= COST[Slot::Special as usize] && c.bot.rnd.float() < 0.12 {
                    c.i.mx = 0.0;
                    c.i.mz = 0.0;
                    c.press(me, Key::Special);
                    return c.i;
                }
                if d > 7.0 && d < in_reach(Slot::Special) && me.energy >= COST[Slot::Special as usize] && c.bot.rnd.float() < 0.04 {
                    c.i.mx = 0.0;
                    c.i.mz = 0.0;
                    c.press(me, Key::Special);
                    return c.i;
                }
                if d > 6.0 && c.bot.rnd.float() < 0.08 && me.stamina > me.b.dash_cost * 3.0 {
                    c.i.mx = dx / d;
                    c.i.mz = dz / d;
                    c.press(me, Key::Dash);
                }
                c.i
            }
            Archetype::Flyer => {
                let low = me.stamina < me.b.stamina * WINGS_LAND;
                let late = m.tick > ROUND_TICKS - 40.0 * HZ && me.hp / me.b.hp < o.hp / o.b.hp;
                let want = if late { 2.0 } else { 8.0 };
                let r = or1(hypot(o.pos.x, o.pos.z));
                let mid = min(1.0, r / 6.0);
                let ax = -dx / d * (1.0 - mid) - (o.pos.x / r) * mid;
                let az = -dz / d * (1.0 - mid) - (o.pos.z / r) * mid;
                let an = or1(hypot(ax, az));
                c.go_to(me, o.pos.x + (ax / an) * want, o.pos.z + (az / an) * want);
                let wings = if me.flying { !low } else { me.stamina >= me.b.stamina * WINGS_FLY };
                if wings && me.clipped == 0.0 && !me.exhausted {
                    if !me.flying {
                        c.press(me, Key::Up);
                    } else if me.pos.y < 4.0 {
                        c.i.up = true;
                    }
                } else if me.flying {
                    c.i.down = true;
                }
                let busy = o.state == State::Attack && o.act.as_ref().is_some_and(|a| o.t < frames(&a.mv, false).startup);
                if me.flying && -above > 2.0 && d > 1.5 && d < 3.0 + -above && !busy && c.bot.rnd.float() < 0.2 {
                    c.i.mx = dx / d;
                    c.i.mz = dz / d;
                    c.i.down = true;
                    return c.swing(me, Key::Heavy);
                }
                if d < reach && facing && above.abs() < 1.5 {
                    let k = if c.bot.rnd.float() < 0.6 { Key::Heavy } else { Key::Light };
                    return c.swing(me, k);
                }
                let melee = !me.mv(Slot::Ultimate).ranged;
                if me.energy >= 100.0 && (!melee || d < reach + 0.5) {
                    return c.swing(me, Key::Ultimate);
                }
                let beam = COST[Slot::Beam as usize];
                if facing && d > 3.0 && d < min(11.0, in_reach(Slot::Beam)) && me.energy >= beam && c.bot.rnd.float() < 0.12 {
                    return c.swing(me, Key::Big);
                }
                if facing && me.energy >= beam + COST[Slot::Special as usize] && c.bot.rnd.float() < 0.04 {
                    c.i.mx = 0.0;
                    c.i.mz = 0.0;
                    return c.swing(me, Key::Special);
                }
                c.i
            }
            _ => {
                let fr = o.act.as_ref().map(|a| frames(&a.mv, false));
                let wind = o.state == State::Attack && fr.as_ref().is_some_and(|fr| o.t < fr.startup);
                let recovering = o.state == State::Attack && fr.as_ref().is_some_and(|fr| o.t >= fr.startup + fr.active);
                let open = recovering || o.state == State::Stun || held(o) > 0.0;
                let winding = wind && o.act.as_ref().is_some_and(|a| a.mv.power >= 60.0 && !a.mv.ranged) && !o.b.flight;
                if me.c.archetype == Archetype::Tank && winding && d < reach + 1.5 && facing && !me.exhausted {
                    c.i.guard = true;
                    return c.i;
                }
                let low = me.exhausted || me.stamina < me.b.stamina * 0.3;
                c.bot.turn -= 1.0;
                if c.bot.turn <= 0.0 {
                    c.bot.dir = -c.bot.dir;
                    c.bot.turn = 90.0 + (c.bot.rnd.float() * 180.0).floor();
                }
                if c.bot.rest > 0.0 {
                    c.bot.rest -= 1.0;
                }
                if c.bot.commit > 0.0 {
                    c.bot.commit -= 1.0;
                } else if c.bot.rest == 0.0 && !low && !wind && d < reach + RING + 0.6 && c.bot.rnd.float() < COMMIT_CHANCE {
                    c.bot.commit = COMMIT_TICKS;
                }
                let inside = open || c.bot.commit > 0.0;
                let range = if inside {
                    reach - 0.4
                } else if low {
                    reach + 3.5
                } else {
                    reach + RING
                };
                let theta = atan2(-dz, -dx);
                let lead = if inside || d > reach + RING + 1.5 { 0.0 } else { 0.3 };
                let dir = c.bot.dir;
                c.go_to(me, o.pos.x + cos(theta + dir * lead) * range, o.pos.z + sin(theta + dir * lead) * range);
                if low && d < reach + 2.0 && (wind || o.state == State::Attack) {
                    if !me.exhausted {
                        c.i.guard = true;
                    }
                    c.i.mx = 0.0;
                    c.i.mz = 0.0;
                    return c.i;
                }
                if d < reach + 0.3 && facing && (open || (c.bot.commit > 0.0 && !wind && !low)) {
                    let chart = m.chart;
                    if chart.type_mul(me.mv(Slot::Launcher).field, &o.c.fields) > chart.type_mul(me.mv(Slot::Heavy).field, &o.c.fields)
                        && c.bot.rnd.float() < 0.3
                    {
                        c.i.up = true;
                    }
                    c.bot.rest = COMMIT_REST + (c.bot.rnd.float() * COMMIT_REST).floor();
                    c.bot.commit = 0.0;
                    let k = if c.i.up || open || c.bot.rnd.float() < 0.5 { Key::Heavy } else { Key::Light };
                    c.press(me, k);
                    return c.i;
                }
                if !open && !low && !wind && c.bot.rest == 0.0 && d > reach + 0.4 && d < reach + 1.4 && facing && c.bot.rnd.float() < 0.006 {
                    c.bot.rest = 40.0;
                    c.press(me, Key::Light);
                    return c.i;
                }
                if me.energy >= 100.0 {
                    c.press(me, Key::Ultimate);
                    return c.i;
                }
                if d > min(6.0, in_reach(Slot::Beam) - 2.0)
                    && d < in_reach(Slot::Beam)
                    && facing
                    && me.energy >= COST[Slot::Beam as usize]
                    && c.bot.rnd.float() < 0.03
                {
                    c.press(me, Key::Big);
                    return c.i;
                }
                if threat && d > 4.0 && c.bot.rnd.float() < 0.5 {
                    c.i.mx = 0.0;
                    c.i.mz = 0.0;
                    c.i.guard = true;
                }
                c.i
            }
        }
    }
}

impl Ctx<'_> {
    /// bot.ts goTo.
    fn go_to(&mut self, me: &Fighter, gx: f64, gz: f64) {
        let gr = hypot(gx, gz);
        let cap = ARENA_RADIUS - 2.0;
        let x = if gr > cap { (gx / gr) * cap } else { gx };
        let z = if gr > cap { (gz / gr) * cap } else { gz };
        let r = hypot(me.pos.x, me.pos.z);
        let edge = max(0.0, r - (ARENA_RADIUS - 3.0)) / 3.0;
        let mut vx = x - me.pos.x - (me.pos.x / or1(r)) * edge * 6.0;
        let mut vz = z - me.pos.z - (me.pos.z / or1(r)) * edge * 6.0;
        let n = hypot(vx, vz);
        if n > 0.3 {
            vx /= n;
            vz /= n;
            self.i.mx = vx;
            self.i.mz = vz;
        }
    }
    /// bot.ts press, two frames held.
    fn press(&mut self, me: &Fighter, k: Key) {
        if k == Key::Dash && hypot(me.pos.x + self.i.mx * 5.0, me.pos.z + self.i.mz * 5.0) > ARENA_RADIUS - 1.0 {
            return;
        }
        let mut h = self.i;
        h.set(k, true);
        self.bot.hold = h;
        self.bot.hold_for = 2.0;
        self.i.set(k, !me.prev.get(k));
    }
    /// The flyer's swing: let go of up first (heavy with up held is the launcher).
    fn swing(&mut self, me: &Fighter, k: Key) -> Input {
        self.i.up = false;
        self.press(me, k);
        self.i
    }
}
