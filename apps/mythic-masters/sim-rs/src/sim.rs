//! src/sim.ts, statement for statement: the same fight, tick for tick and bit for bit (test/sim-rust.test.ts
//! hashes both every tick). Read sim.ts for what the rules mean; the comments here only mark where Rust has to
//! spell out something JS does on its own (a shared object, `x || 1`, Math.round's halves).
//! Every number stays an f64, counters included, because that is what they are in JS.
use crate::data::{Body, Chart, Creature, Delivery, Move, Slot, Tempo, EMBER, FROST, GALE, GROVE, IRON, SHADOW, SPIRIT, STONE, STORM, TIDE, VENOM, WILD};
use crate::dmath::{atan2, clamp, cos, exp, hypot, lerp, max, min, or1, pow, round, sin, tan};
use std::cell::RefCell;
use std::rc::Rc;

pub const HZ: f64 = 60.0;
const DT: f64 = 1.0 / HZ;
pub const ARENA_RADIUS: f64 = 16.0;
const CEILING: f64 = 7.0;
const FALL_KO: f64 = -6.0;
const LAKE_X: f64 = 7.0;
const GRAVITY: f64 = 22.0;
pub const ROUND_TICKS: f64 = 99.0 * HZ;
const PI: f64 = std::f64::consts::PI;

#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct V3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// The buttons, in sim.ts Input's order (after mx and mz).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Key {
    Up,
    Down,
    Light,
    Heavy,
    Special,
    Ultimate,
    Guard,
    Dash,
    Big,
}

#[derive(Clone, Copy, Default, Debug, PartialEq)]
pub struct Input {
    pub mx: f64,
    pub mz: f64,
    pub up: bool,
    pub down: bool,
    pub light: bool,
    pub heavy: bool,
    pub special: bool,
    pub ultimate: bool,
    pub guard: bool,
    pub dash: bool,
    pub big: bool,
}
pub const IDLE: Input = Input {
    mx: 0.0,
    mz: 0.0,
    up: false,
    down: false,
    light: false,
    heavy: false,
    special: false,
    ultimate: false,
    guard: false,
    dash: false,
    big: false,
};
impl Input {
    pub fn get(&self, k: Key) -> bool {
        match k {
            Key::Up => self.up,
            Key::Down => self.down,
            Key::Light => self.light,
            Key::Heavy => self.heavy,
            Key::Special => self.special,
            Key::Ultimate => self.ultimate,
            Key::Guard => self.guard,
            Key::Dash => self.dash,
            Key::Big => self.big,
        }
    }
    pub fn set(&mut self, k: Key, v: bool) {
        match k {
            Key::Up => self.up = v,
            Key::Down => self.down = v,
            Key::Light => self.light = v,
            Key::Heavy => self.heavy = v,
            Key::Special => self.special = v,
            Key::Ultimate => self.ultimate = v,
            Key::Guard => self.guard = v,
            Key::Dash => self.dash = v,
            Key::Big => self.big = v,
        }
    }
}
/// sim.ts KEY: the button a slot's move is fired (and held) with.
fn key_of(s: Slot) -> Key {
    match s {
        Slot::Light => Key::Light,
        Slot::Heavy | Slot::Launcher => Key::Heavy,
        Slot::Special => Key::Special,
        Slot::Beam => Key::Big,
        Slot::Ultimate => Key::Ultimate,
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum State {
    Free,
    Attack,
    Stun,
    Guard,
    Dash,
    Ledge,
}

#[derive(Clone, Copy, Debug)]
pub struct Aim {
    pub yaw: f64,
    pub pitch: f64,
}

/// A live shape. In JS a stream's area is one object both `m.areas` and its caster's `act.area` hold, so it is
/// shared here too: identity (`Rc::ptr_eq`) is what sim.ts's `act.area !== a` asks.
pub type AreaRef = Rc<RefCell<Area>>;

#[derive(Clone, Debug)]
pub struct Area {
    pub owner: usize,
    pub mv: Move,
    pub d: Delivery,
    pub power: f64,
    pub at: V3,
    pub from: V3,
    pub dir: V3,
    pub t: f64,
    pub life: f64,
    pub land: f64,
    pub every: f64,
    pub ramp: f64,
    pub hits: [f64; 2],
    pub struck: [bool; 2],
}

#[derive(Clone, Debug)]
pub struct Act {
    pub mv: Move,
    pub hit: bool,
    pub dive: bool,
    pub tired: bool,
    pub aim: Option<Aim>,
    pub key: Option<Key>,
    pub hold: f64,
    pub lead: f64,
    pub area: Option<AreaRef>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Marks {
    pub dot: f64,
    pub dot_per: f64,
    pub dot_field: Option<u8>,
    pub chill: f64,
    pub root: f64,
}

#[derive(Clone, Debug)]
pub struct Fighter<'a> {
    pub c: &'a Creature,
    pub b: Body,
    pub pos: V3,
    pub vel: V3,
    pub yaw: f64,
    pub hp: f64,
    pub launch: f64,
    pub stamina: f64,
    pub energy: f64,
    pub state: State,
    pub t: f64,
    pub act: Option<Act>,
    pub stun: f64,
    pub clipped: f64,
    pub flying: bool,
    pub on_ground: bool,
    pub air_jumps: f64,
    pub rise: bool,
    pub exhausted: bool,
    pub prev: Input,
    pub invuln: f64,
    pub buf: Option<(Key, f64)>,
    pub hop: bool,
    pub ring: f64,
    pub spin: f64,
    pub orbit: f64,
    pub bearing: f64,
    pub red: f64,
    pub hurt: f64,
    pub fresh: bool,
    pub drop: f64,
    pub marks: Marks,
}
impl Fighter<'_> {
    pub fn mv(&self, s: Slot) -> &Move {
        &self.c.moves[s as usize]
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum How {
    Hp,
    RingOut,
    Time,
}

#[derive(Clone, Debug)]
pub enum Event {
    Hit {
        by: usize,
        on: usize,
        slot: Slot,
        field: u8,
        damage: f64,
        guarded: bool,
        rear: bool,
        spike: bool,
        at: V3,
    },
    Move {
        by: usize,
        slot: Slot,
        at: V3,
        yaw: f64,
        target: V3,
    },
    Land {
        who: usize,
        speed: f64,
    },
    Clipped {
        who: usize,
    },
    Ledge {
        who: usize,
    },
    Ko {
        who: usize,
        how: How,
    },
}

pub struct Match<'a> {
    pub chart: &'a Chart,
    pub tick: f64,
    pub f: [Fighter<'a>; 2],
    pub areas: Vec<AreaRef>,
    pub events: Vec<Event>,
    pub winner: Option<usize>,
    pub over: bool,
}

pub struct Frames {
    pub startup: f64,
    pub active: f64,
    pub recovery: f64,
}
pub fn frames(m: &Move, tired: bool) -> Frames {
    let ult = if m.slot == Slot::Ultimate { 12.0 } else { 0.0 };
    let (wind, rest) = WEIGHT[m.slot as usize];
    let recovery = round(8.0 + m.power / 8.0) + ult + rest;
    let startup = round((round(4.0 + m.power / 10.0) + ult + wind) * HEAVY);
    let active = if m.slot == Slot::Beam || m.slot == Slot::Special { 1.0 } else { 5.0 };
    Frames {
        startup,
        active,
        recovery: round((if tired { round(recovery * 1.5) } else { recovery }) * HEAVY),
    }
}
pub const HEAVY: f64 = 1.4;
const WEIGHT: [(f64, f64); 6] = [(0.0, 2.0), (8.0, 10.0), (5.0, 8.0), (0.0, 4.0), (4.0, 6.0), (4.0, 8.0)];
pub const COST: [f64; 6] = [0.0, 0.0, 0.0, 15.0, 35.0, 100.0];
const SWING: [f64; 6] = [0.12, 0.5, 0.4, 0.2, 0.35, 0.5];
const GUARD_COST: f64 = 0.1;
pub const TAKEOFF: f64 = 0.5;

fn fighter<'a>(c: &'a Creature, side: usize) -> Fighter<'a> {
    let b = c.body;
    Fighter {
        c,
        b,
        pos: V3 {
            x: if side == 1 { 6.0 } else { -6.0 },
            y: 0.0,
            z: 0.0,
        },
        vel: V3::default(),
        yaw: if side == 1 { PI } else { 0.0 },
        hp: b.hp,
        launch: 0.0,
        stamina: b.stamina,
        energy: 20.0,
        state: State::Free,
        t: 0.0,
        act: None,
        stun: 0.0,
        clipped: 0.0,
        flying: false,
        on_ground: true,
        air_jumps: 1.0,
        rise: true,
        exhausted: false,
        prev: IDLE,
        invuln: 0.0,
        ring: 0.0,
        buf: None,
        hop: false,
        spin: 0.0,
        orbit: 0.0,
        bearing: if side == 1 { 0.0 } else { PI },
        red: 0.0,
        hurt: 999.0,
        fresh: true,
        drop: 0.0,
        marks: Marks::default(),
    }
}
pub fn new_match<'a>(chart: &'a Chart, a: &'a Creature, b: &'a Creature) -> Match<'a> {
    Match {
        chart,
        tick: 0.0,
        f: [fighter(a, 0), fighter(b, 1)],
        areas: Vec::new(),
        events: Vec::new(),
        winner: None,
        over: false,
    }
}

#[inline]
fn fwd(yaw: f64) -> (f64, f64) {
    (cos(yaw), sin(yaw))
}
#[inline]
fn angle_to(a: V3, b: V3) -> f64 {
    atan2(b.z - a.z, b.x - a.x)
}
#[inline]
pub fn wrap(a: f64) -> f64 {
    a - TAU * round(a / TAU)
}
const TAU: f64 = 2.0 * PI;
#[inline]
fn turn(from: f64, to: f64, max_: f64) -> f64 {
    from + clamp(wrap(to - from), -max_, max_)
}
#[inline]
fn flat(a: V3, b: V3) -> f64 {
    hypot(b.x - a.x, b.z - a.z)
}
fn in_lake(p: V3) -> bool {
    p.x > LAKE_X && hypot(p.x, p.z) < ARENA_RADIUS
}
fn over_ring(p: V3) -> bool {
    hypot(p.x, p.z) <= ARENA_RADIUS
}
fn pressed(f: &Fighter, i: &Input, k: Key) -> bool {
    i.get(k) && !f.prev.get(k)
}
fn drops(f: &Fighter, i: &Input) -> bool {
    i.down || (i.guard && !f.on_ground)
}

/// The buttons that act on a press, highest first.
const PRESSES: [Key; 7] = [Key::Ultimate, Key::Big, Key::Special, Key::Heavy, Key::Light, Key::Dash, Key::Up];
pub const BUFFER: f64 = 8.0;
const TRACTION: f64 = 3.0;
const SHORT_HOP: f64 = 0.55;
const FAST_FALL: f64 = 11.0;
pub const DIVE_FALL: f64 = 12.0;
pub const DIVE_TUCK: f64 = 4.0;
const LEDGE_REACH: f64 = 0.6;
const LEDGE_BELOW: f64 = 1.5;
pub const ORBIT_FREE: f64 = 1.2;
const ORBIT_SPAN: f64 = 2.0;
const ORBIT_SLOW: f64 = 0.25;
const ORBIT_DRAIN: f64 = 0.6;
const ORBIT_BLEED: f64 = 0.6;
const ORBIT_STILL: f64 = 0.3;
const RED_SHARE: f64 = 0.5;
const RED_REGEN: f64 = 5.0;
const RED_WAIT: f64 = 90.0;
const RED_WINDOW: f64 = 90.0;
const ENERGY_DEALT: f64 = 6.0;
const ENERGY_TAKEN: f64 = 5.0;
const ENERGY_STILL: f64 = 2.0;
const CORNERED_PER: f64 = 3.0;
const CORNERED_CAP: f64 = 0.5;
const CORNERED_EVEN: f64 = 0.95;
fn cornered(a: &Fighter, d: &Fighter) -> f64 {
    if a.c.stat_total() < d.c.stat_total() * CORNERED_EVEN {
        return 1.0;
    }
    1.0 + min(CORNERED_CAP, CORNERED_PER * max(0.0, d.hp / d.b.hp - a.hp / a.b.hp))
}
const AIM_NUDGE: f64 = PI / 6.0;
const AIM_TRACK: f64 = 1.5;
const AIM_LOB: f64 = 4.0;
const PULSE_EVERY: f64 = 10.0;
const PULSE_STUN: f64 = 8.0;
const PULSE_STREAM: f64 = 0.08;
const PULSE_TAIL: f64 = 0.15;
const PULSE_MIN: f64 = 12.0;
const PULSE_START: f64 = 8.0;
/// moves.ts LOW.
const LOW: f64 = 0.55;

/// sim.ts held.
pub fn held(f: &Fighter) -> f64 {
    match (&f.act, f.state) {
        (Some(a), State::Attack) => a.hold,
        _ => 0.0,
    }
}
fn level(act: &Act) -> f64 {
    match act.mv.tempo {
        Tempo::Charge { full, .. } => clamp(act.hold / (full * HZ), 0.0, 1.0),
        _ => 0.0,
    }
}
const LUNGE_TRACK: f64 = 3.0;
const LUNGE_LOCK: f64 = 0.5;
const LUNGE_STEP: f64 = 0.6;
const LUNGE_RUSH: f64 = 2.5;
const SWEEP_LIGHT: f64 = 0.7;
const SWEEP_HEAVY: f64 = 1.1;
const SWEEP_AHEAD_LIGHT: f64 = 0.35;
const SWEEP_AHEAD_HEAVY: f64 = 0.5;
/// sim.ts sweep: (reach, ahead).
pub fn sweep(f: &Fighter, o: &Fighter, slot: Slot) -> (f64, f64) {
    let heavy = slot == Slot::Heavy || slot == Slot::Launcher;
    let step = if heavy || slot == Slot::Ultimate { LUNGE_STEP + f.b.radius } else { 0.0 };
    (
        f.b.radius + o.b.radius + (if slot == Slot::Light { SWEEP_LIGHT } else { SWEEP_HEAVY }) + step,
        if heavy { SWEEP_AHEAD_HEAVY } else { SWEEP_AHEAD_LIGHT },
    )
}
#[derive(PartialEq, Eq, Clone, Copy)]
pub enum Phase {
    Tracking,
    Locked,
}
pub fn swing_phase(f: &Fighter) -> Option<Phase> {
    let a = f.act.as_ref()?;
    let slot = a.mv.slot;
    if f.state != State::Attack || a.dive || !a.mv.delivery.is_touch() || (slot != Slot::Heavy && slot != Slot::Launcher) {
        return None;
    }
    let fr = frames(&a.mv, a.tired);
    if f.t >= fr.startup + fr.active {
        return None;
    }
    Some(if f.t < round(fr.startup * LUNGE_LOCK) {
        Phase::Tracking
    } else {
        Phase::Locked
    })
}
const HANG_MAX: f64 = 90.0;
const HANG_SAFE: f64 = 24.0;
const HANG_CLIMB: f64 = 12.0;
const HANG_ROLL: f64 = 3.2;
const HANG_ROLL_SAFE: f64 = 18.0;
const HANG_REGRAB: f64 = 20.0;
const SPIKE_DOWN: f64 = 0.75;
const SPIKE_STUN: f64 = 14.0;

/// (this side, the other side), both mutable.
fn pair<'m, 'a>(fs: &'m mut [Fighter<'a>; 2], side: usize) -> (&'m mut Fighter<'a>, &'m mut Fighter<'a>) {
    let (a, b) = fs.split_at_mut(1);
    if side == 0 {
        (&mut a[0], &mut b[0])
    } else {
        (&mut b[0], &mut a[0])
    }
}

fn start(m: &mut Match, side: usize, slot: Slot, i: &Input) {
    let (f, o) = pair(&mut m.f, side);
    let mv = *f.mv(slot);
    let tempo = mv.tempo;
    let pours = matches!(tempo, Tempo::Build { .. }) && slot != Slot::Ultimate;
    let on_release = matches!(tempo, Tempo::Charge { .. }) && !mv.delivery.is_touch() && slot != Slot::Ultimate;
    let s = slot as usize;
    if f.energy < (if pours { min(COST[s], PULSE_START) } else { COST[s] }) {
        return;
    }
    if !pours && !on_release {
        f.energy -= COST[s];
    }
    let tired = f.exhausted || f.stamina < SWING[s];
    f.stamina = max(0.0, f.stamina - SWING[s]);
    if f.stamina <= 0.0 {
        f.exhausted = true;
    }
    let dive = slot == Slot::Heavy && f.flying && drops(f, i);
    f.state = State::Attack;
    f.t = 0.0;
    let mut act = Act {
        mv,
        hit: false,
        dive,
        tired,
        aim: None,
        key: None,
        hold: 0.0,
        lead: 0.0,
        area: None,
    };
    if !dive && matches!(tempo, Tempo::Charge { .. } | Tempo::Build { .. }) {
        act.key = Some(key_of(slot));
    }
    if !mv.delivery.is_touch() {
        act.aim = Some(Aim {
            yaw: angle_to(f.pos, o.pos),
            pitch: clamp(
                atan2(o.pos.y + o.b.height / 2.0 - (f.pos.y + f.b.height / 2.0), max(1.0, flat(f.pos, o.pos))),
                -0.9,
                0.9,
            ),
        });
    }
    f.act = Some(act);
    f.flying = f.flying && slot != Slot::Launcher && !dive;
    if dive {
        let a = angle_to(f.pos, o.pos);
        let sp = min(f.b.top_speed * 1.6, flat(f.pos, o.pos) * 3.5);
        f.vel.x = cos(a) * sp;
        f.vel.z = sin(a) * sp;
        f.vel.y = -DIVE_FALL;
        f.t = max(0.0, frames(&mv, false).startup - DIVE_TUCK);
    }
    if slot == Slot::Launcher && !f.on_ground && f.rise {
        f.rise = false;
        f.vel.y = max(f.vel.y, f.b.jump);
        f.vel.x = i.mx * f.b.top_speed * 0.8;
        f.vel.z = i.mz * f.b.top_speed * 0.8;
    }
}

fn control(m: &mut Match, side: usize, i: &Input) {
    let f = &mut m.f[side];
    let b = f.b;
    let moving = hypot(i.mx, i.mz) > 0.1;
    if f.state == State::Ledge {
        let inward = moving && (i.mx * -f.pos.x + i.mz * -f.pos.z) / or1(hypot(i.mx, i.mz) * hypot(f.pos.x, f.pos.z)) > 0.5;
        return ledge(m, side, i, inward);
    }
    if f.state == State::Guard && !i.guard {
        f.state = State::Free;
    }
    if let Some(&k) = PRESSES.iter().find(|&&k| pressed(f, i, k)) {
        f.buf = Some((k, BUFFER));
    }
    let chain = f.state == State::Attack
        && f.act.as_ref().is_some_and(|a| {
            let fr = frames(&a.mv, a.tired);
            a.hit && a.mv.slot == Slot::Light && f.t >= fr.startup + fr.active && matches!(f.buf, Some((Key::Light | Key::Heavy, _)))
        });
    if f.state != State::Free && f.state != State::Guard && !chain {
        return;
    }
    let use_ = |f: &mut Fighter, k: Key| {
        if matches!(f.buf, Some((b, _)) if b == k) {
            f.buf = None;
            true
        } else {
            false
        }
    };
    if use_(f, Key::Ultimate) {
        return start(m, side, Slot::Ultimate, i);
    }
    if use_(f, Key::Big) {
        return start(m, side, Slot::Beam, i);
    }
    if use_(f, Key::Special) {
        return start(m, side, Slot::Special, i);
    }
    if use_(f, Key::Heavy) {
        let launcher = i.up || (!f.on_ground && !f.flying && f.pos.y < 0.0 && f.rise);
        return start(m, side, if launcher { Slot::Launcher } else { Slot::Heavy }, i);
    }
    if use_(f, Key::Light) {
        return start(m, side, Slot::Light, i);
    }
    if matches!(f.buf, Some((Key::Dash, _))) && !f.exhausted && f.stamina >= b.dash_cost && f.marks.root == 0.0 {
        f.buf = None;
        let (dx, dz) = if moving {
            (i.mx, i.mz)
        } else {
            let k = fwd(f.yaw);
            (-k.0, -k.1)
        };
        let n = or1(hypot(dx, dz));
        f.vel.x = (dx / n) * b.top_speed * 2.4;
        f.vel.z = (dz / n) * b.top_speed * 2.4;
        f.stamina -= b.dash_cost;
        f.state = State::Dash;
        f.t = 0.0;
        f.invuln = b.dodge;
        return;
    }
    if i.guard && f.on_ground && !f.exhausted {
        if f.state != State::Guard {
            f.stamina = max(0.0, f.stamina - GUARD_COST);
        }
        f.state = State::Guard;
        return;
    }
    if matches!(f.buf, Some((Key::Up, _))) && f.marks.root == 0.0 {
        f.buf = None;
        if f.on_ground {
            f.vel.y = b.jump;
            f.on_ground = false;
            f.hop = true;
        } else if b.flight && !f.flying && !f.exhausted && f.stamina >= b.stamina * TAKEOFF && f.clipped == 0.0 {
            f.flying = true;
            f.vel.y = max(f.vel.y, 0.0);
        } else if f.air_jumps > 0.0 {
            f.vel.y = b.jump * 0.85;
            f.air_jumps -= 1.0;
        }
    }
}

fn ledge(m: &mut Match, side: usize, i: &Input, inward: bool) {
    let f = &mut m.f[side];
    if let Some(&k) = PRESSES.iter().find(|&&k| pressed(f, i, k)) {
        f.buf = Some((k, BUFFER));
    }
    let r = or1(hypot(f.pos.x, f.pos.z));
    let onto = |f: &mut Fighter, inset: f64| {
        let k = (ARENA_RADIUS - f.b.radius - inset) / r;
        f.pos.x *= k;
        f.pos.z *= k;
        f.pos.y = 0.0;
        f.vel = V3::default();
        f.state = State::Free;
        f.t = 0.0;
        f.on_ground = true;
        f.fresh = true;
    };
    let k = f.buf.map(|b| b.0);
    if k == Some(Key::Light) || k == Some(Key::Heavy) {
        f.buf = None;
        onto(f, 0.2);
        f.invuln = HANG_CLIMB;
        return start(m, side, Slot::Light, i);
    }
    if k == Some(Key::Dash) {
        f.buf = None;
        onto(f, HANG_ROLL);
        f.invuln = HANG_ROLL_SAFE;
        return;
    }
    if k == Some(Key::Up) || inward {
        f.buf = None;
        onto(f, 0.2);
        f.invuln = HANG_CLIMB;
        return;
    }
    if i.guard || i.down || f.t >= HANG_MAX {
        f.state = State::Free;
        f.t = 0.0;
        f.drop = HANG_REGRAB;
        f.vel.y = -1.0;
    }
}

fn move_body(m: &mut Match, side: usize, i: &Input) {
    let (f, o) = pair(&mut m.f, side);
    let b = f.b;
    if f.state == State::Ledge {
        f.vel = V3::default();
        f.hurt += 1.0;
        return;
    }
    let can_steer = f.state == State::Free || f.state == State::Attack;
    let slow = (if f.exhausted { 0.6 } else { 1.0 })
        * (if f.marks.chill != 0.0 { 0.65 } else { 1.0 })
        * (if in_lake(f.pos) && f.on_ground {
            if f.c.fields.contains(&TIDE) {
                1.15
            } else {
                0.6
            }
        } else {
            1.0
        });
    let (mut wx, mut wz) = if can_steer {
        (i.mx * b.top_speed * slow, i.mz * b.top_speed * slow)
    } else {
        (0.0, 0.0)
    };
    let rising = f.state == State::Attack && f.act.as_ref().is_some_and(|a| a.mv.slot == Slot::Launcher) && !f.on_ground;
    if f.state == State::Attack && !rising {
        wx *= 0.3;
        wz *= 0.3;
    }
    let lock = f.on_ground && !f.flying && f.state == State::Free;
    if lock {
        let a = angle_to(f.pos, o.pos);
        let ux = cos(a);
        let uz = sin(a);
        let d = flat(f.pos, o.pos);
        let along = wx * ux + wz * uz;
        let tired = clamp((f.orbit.abs() - ORBIT_FREE) / ORBIT_SPAN, 0.0, 1.0);
        let sideways = (wx * -uz + wz * ux) * b.lateral * (1.0 - (1.0 - ORBIT_SLOW) * tired);
        if sideways.abs() > along.abs() * 2.0 * b.lateral && f.ring > 0.0 {
            let radial = along + (d - f.ring) * 4.0;
            wx = -uz * sideways + ux * radial;
            wz = ux * sideways + uz * radial;
        } else {
            f.ring = d;
            wx = ux * along - uz * sideways;
            wz = uz * along + ux * sideways;
        }
    }
    let braking = wx * f.vel.x + wz * f.vel.z < 0.25 * hypot(f.vel.x, f.vel.z) * hypot(wx, wz) || hypot(wx, wz) < 0.1;
    let grip = if f.state == State::Stun || f.state == State::Dash {
        2.0
    } else if f.on_ground {
        b.accel * (if braking { TRACTION } else { 1.0 })
    } else {
        b.accel * (if f.flying { 0.8 } else { 0.35 })
    };
    let k = min(1.0, grip * DT / max(1.0, b.top_speed));
    let stun_k = if f.state == State::Stun { 0.15 } else { 1.0 };
    f.vel.x += (wx - f.vel.x) * k * stun_k;
    f.vel.z += (wz - f.vel.z) * k * stun_k;
    if f.state == State::Stun || !f.on_ground {
        let drag = exp(-(if f.on_ground {
            6.0
        } else if f.state == State::Stun {
            2.2
        } else {
            1.2
        }) * DT);
        f.vel.x *= drag;
        f.vel.z *= drag;
    }

    let want = if lock || f.flying || f.state == State::Attack || f.state == State::Guard || hypot(wx, wz) < 0.5 {
        angle_to(f.pos, o.pos)
    } else {
        atan2(wz, wx)
    };
    let phase = swing_phase(f);
    if let Some(aim) = f.act.as_ref().and_then(|a| a.aim) {
        f.yaw = aim.yaw;
        f.spin = 0.0;
    } else if phase == Some(Phase::Locked) {
        f.spin = 0.0;
    } else if f.state != State::Stun {
        let swing = phase == Some(Phase::Tracking);
        let top = (b.turn_rate + (if swing { LUNGE_TRACK } else { 0.0 })) * (if f.marks.chill != 0.0 { 0.65 } else { 1.0 });
        let err = wrap(want - f.yaw);
        let goal = clamp(err * 8.0, -top, top);
        let spin_up = b.spin_up * (if swing { 2.0 } else { 1.0 });
        f.spin += clamp(goal - f.spin, -spin_up * DT, spin_up * DT);
        f.yaw = wrap(f.yaw + f.spin * DT);
    } else {
        f.spin *= 0.8;
    }

    if f.hop && (f.vel.y <= 0.0 || f.flying) {
        f.hop = false;
    }
    if f.hop && !i.up {
        f.vel.y = min(f.vel.y, b.jump * SHORT_HOP);
        f.hop = false;
    }
    if f.flying {
        let lift = (if i.up { 4.0 } else { 0.0 }) - (if drops(f, i) { 5.0 } else { 0.0 });
        f.vel.y += (lift - f.vel.y) * min(1.0, 6.0 * DT);
        if f.pos.y >= CEILING && f.vel.y > 0.0 {
            f.vel.y = 0.0;
        }
    } else {
        f.vel.y -= GRAVITY * DT;
        if !f.on_ground && f.vel.y <= 0.0 && f.state != State::Stun && drops(f, i) {
            f.vel.y = min(f.vel.y, -FAST_FALL);
        }
    }

    f.pos.x += f.vel.x * DT;
    f.pos.y += f.vel.y * DT;
    f.pos.z += f.vel.z * DT;
    let was_ground = f.on_ground;
    if f.pos.y <= 0.0 && over_ring(f.pos) && f.pos.y > -1.0 {
        f.pos.y = 0.0;
        if f.vel.y < 0.0 {
            if !was_ground {
                m.events.push(Event::Land { who: side, speed: -f.vel.y });
            }
            f.vel.y = 0.0;
        }
        f.on_ground = true;
        f.flying = false;
        f.air_jumps = 1.0;
        f.rise = true;
        f.fresh = true;
    } else {
        f.on_ground = false;
    }
    let r = hypot(f.pos.x, f.pos.z);
    if f.drop > 0.0 {
        f.drop -= 1.0;
    }
    if !f.on_ground
        && f.state != State::Stun
        && f.drop == 0.0
        && f.vel.y <= 1.0
        && r > ARENA_RADIUS
        && r < ARENA_RADIUS + f.b.radius + LEDGE_REACH
        && f.pos.y < 0.3
        && f.pos.y > -LEDGE_BELOW
    {
        let k = (ARENA_RADIUS + f.b.radius * 0.5) / r;
        f.pos.x *= k;
        f.pos.z *= k;
        f.pos.y = -f.b.height * 0.6;
        f.vel = V3::default();
        f.flying = false;
        f.air_jumps = 1.0;
        f.rise = true;
        f.state = State::Ledge;
        f.act = None;
        f.t = 0.0;
        f.buf = None;
        f.yaw = atan2(-f.pos.z, -f.pos.x);
        f.spin = 0.0;
        if f.fresh {
            f.invuln = HANG_SAFE;
            f.fresh = false;
        }
        m.events.push(Event::Ledge { who: side });
        return;
    }
    if !was_ground && f.on_ground && f.state == State::Stun {
        f.stun = min(f.stun, 12.0);
    }

    let bearing = angle_to(o.pos, f.pos);
    let went = wrap(bearing - f.bearing);
    f.bearing = bearing;
    if f.on_ground && !f.flying && f.state != State::Stun {
        f.orbit += went;
    }
    if went.abs() < ORBIT_STILL * DT {
        f.orbit -= clamp(f.orbit, -ORBIT_BLEED * DT, ORBIT_BLEED * DT);
    }
    let tired = clamp((f.orbit.abs() - ORBIT_FREE) / ORBIT_SPAN, 0.0, 1.0);
    let speed = hypot(f.vel.x, f.vel.z);
    if f.flying {
        f.stamina -= DT * b.lift * (1.0 + (if i.up { 0.4 } else { 0.0 }));
    } else if f.state == State::Guard {
        f.stamina -= DT * 0.4;
    } else if f.on_ground && speed > b.top_speed * 0.7 {
        f.stamina -= DT * 0.2;
    } else if f.on_ground && f.state != State::Attack {
        f.stamina += DT * (1.0 - tired);
    }
    if tired > 0.0 {
        f.stamina -= DT * ORBIT_DRAIN * tired;
    }
    f.stamina = clamp(f.stamina, 0.0, b.stamina);
    if f.stamina <= 0.0 {
        f.exhausted = true;
        f.flying = false;
        if f.state == State::Guard {
            f.state = State::Stun;
            f.stun = 50.0;
        }
    }
    if f.exhausted && f.stamina >= b.stamina * 0.35 {
        f.exhausted = false;
    }
    f.hurt += 1.0;
    if f.red > 0.0 && f.hurt > RED_WAIT {
        let back = min(f.red, RED_REGEN * DT);
        f.red -= back;
        f.hp = min(b.hp, f.hp + back);
    }
    if f.state == State::Free && f.on_ground && speed < 0.5 {
        f.energy = min(100.0, f.energy + DT * ENERGY_STILL);
    }
}

fn nudge(f: &mut Fighter, o: &Fighter, i: &Input) {
    let pos = f.pos;
    let Some(act) = f.act.as_mut() else { return };
    let Some(aim) = act.aim.as_mut() else { return };
    let base = angle_to(pos, o.pos);
    let ux = cos(base);
    let uz = sin(base);
    aim.yaw = turn(aim.yaw, base + clamp(i.mx * -uz + i.mz * ux, -1.0, 1.0) * AIM_NUDGE, AIM_TRACK * DT);
    if act.mv.delivery.is_blast() {
        act.lead = clamp(act.lead + (i.mx * ux + i.mz * uz) * AIM_LOB * DT, -AIM_LOB, AIM_LOB);
    }
}

fn attack_frames(m: &mut Match, side: usize, i: &Input) {
    let (f, o) = pair(&mut m.f, side);
    if f.state != State::Attack || f.act.is_none() {
        return;
    }
    let (mv, dive, fr, down) = {
        let a = f.act.as_ref().unwrap();
        (a.mv, a.dive, frames(&a.mv, a.tired), a.key.is_some_and(|k| i.get(k)))
    };
    let tempo = mv.tempo;
    f.t += 1.0;
    if let Tempo::Charge { full, .. } = tempo {
        let hold = f.act.as_ref().unwrap().hold;
        if down && f.t == fr.startup && hold < full * HZ {
            f.t -= 1.0;
            f.act.as_mut().unwrap().hold = hold + 1.0;
            nudge(f, o, i);
            return;
        }
    }
    let stream = f.act.as_ref().unwrap().area.clone();
    if let (Tempo::Build { run, .. }, Some(stream)) = (tempo, stream) {
        if f.t == fr.startup + 1.0 {
            let run = run * HZ;
            let h = f.act.as_ref().unwrap().hold;
            let land = stream.borrow().land;
            if (down || h < PULSE_MIN + land) && h < run + land && (f.energy > 0.0 || mv.slot == Slot::Ultimate) {
                f.t -= 1.0;
                f.act.as_mut().unwrap().hold = h + 1.0;
                if mv.slot != Slot::Ultimate && h >= land {
                    f.energy = max(0.0, f.energy - COST[mv.slot as usize] / run);
                }
                nudge(f, o, i);
                let aim = f.act.as_ref().unwrap().aim.unwrap_or(Aim { yaw: f.yaw, pitch: 0.0 });
                let k = fwd(aim.yaw);
                let mut s = stream.borrow_mut();
                let flat_aim = if matches!(s.d, Delivery::Cone { .. } | Delivery::Wall { .. }) {
                    0.0
                } else {
                    aim.pitch
                };
                s.dir = V3 {
                    x: k.0 * cos(flat_aim),
                    y: sin(flat_aim),
                    z: k.1 * cos(flat_aim),
                };
                if !s.d.is_blast() {
                    s.at = if matches!(s.d, Delivery::Nova { .. }) { f.pos } else { mouth(f, &s.d, k) };
                }
                s.ramp = clamp((h + 1.0 - land) / run, 0.0, 1.0);
                return;
            }
            f.act.as_mut().unwrap().area = None;
        }
    }
    if dive && !f.on_ground && f.t == fr.startup + 1.0 {
        f.t = fr.startup;
    } else if f.t == fr.startup && mv.delivery.is_touch() {
        m.events.push(Event::Move {
            by: side,
            slot: mv.slot,
            at: f.pos,
            yaw: f.yaw,
            target: o.pos,
        });
    }
    if f.t == fr.startup && !mv.delivery.is_touch() {
        if matches!(tempo, Tempo::Charge { .. }) && mv.slot != Slot::Ultimate {
            f.energy = max(0.0, f.energy - COST[mv.slot as usize]);
        }
        let area = loose(f, side, &mv, mv.delivery, o.pos);
        let target = if area.d.is_blast() { area.at } else { o.pos };
        let area = Rc::new(RefCell::new(area));
        if matches!(tempo, Tempo::Build { .. }) {
            f.act.as_mut().unwrap().area = Some(area.clone());
        }
        m.areas.push(area);
        m.events.push(Event::Move {
            by: side,
            slot: mv.slot,
            at: f.pos,
            yaw: f.yaw,
            target,
        });
    }
    let melee = mv.delivery.is_touch();
    let live = f.t >= fr.startup && f.t < fr.startup + fr.active;
    if melee && !f.act.as_ref().unwrap().hit && f.on_ground && matches!(mv.slot, Slot::Heavy | Slot::Launcher | Slot::Ultimate) && live {
        let k = fwd(f.yaw);
        let room = flat(f.pos, o.pos) - f.b.radius - o.b.radius - 0.2;
        let rush = if mv.slot == Slot::Ultimate {
            LUNGE_RUSH * level(f.act.as_ref().unwrap())
        } else {
            0.0
        };
        let step_by = min(max(0.0, room), (LUNGE_STEP + f.b.radius + rush) / fr.active);
        f.pos.x += k.0 * step_by;
        f.pos.z += k.1 * step_by;
    }
    if melee && !f.act.as_ref().unwrap().hit && live && o.invuln == 0.0 {
        let reach = f.b.radius + o.b.radius + (if mv.slot == Slot::Light { SWEEP_LIGHT } else { SWEEP_HEAVY });
        let k = fwd(f.yaw);
        let dx = o.pos.x - f.pos.x;
        let dz = o.pos.z - f.pos.z;
        let d = hypot(dx, dz);
        let ahead = d < 0.01 || (dx * k.0 + dz * k.1) / d > sweep(f, o, mv.slot).1;
        let dy = o.pos.y - f.pos.y;
        let v_reach = if mv.slot == Slot::Launcher { 4.5 } else { f.b.height + 0.5 };
        let below = if dive { -(o.b.height + 1.0) } else { -1.5 };
        if d <= reach && ahead && dy > below && dy < v_reach {
            let at = if d < 0.01 {
                o.pos
            } else {
                V3 {
                    x: o.pos.x - (dx / d) * o.b.radius,
                    y: o.pos.y + o.b.height * 0.55,
                    z: o.pos.z - (dz / d) * o.b.radius,
                }
            };
            let power = mv.power
                * (if let Tempo::Charge { grow, .. } = tempo {
                    lerp(1.0, grow, level(f.act.as_ref().unwrap()))
                } else {
                    1.0
                });
            f.act.as_mut().unwrap().hit = true;
            let from = f.pos;
            hit(m, side, 1 - side, &mv, power, from, at, false);
            let f = &mut m.f[side];
            if dive {
                f.vel.y = f.b.jump;
                f.vel.x *= -0.4;
                f.vel.z *= -0.4;
                f.on_ground = false;
                if let Some(a) = f.act.as_mut() {
                    a.dive = false;
                }
            }
        }
    }
    let f = &mut m.f[side];
    if f.t >= fr.startup + fr.active + fr.recovery {
        f.state = State::Free;
        f.act = None;
        f.t = 0.0;
    }
}

#[allow(clippy::too_many_arguments)]
fn hit(m: &mut Match, by: usize, on: usize, mv: &Move, power: f64, from: V3, at: V3, repeat: bool) {
    let selfhit = by == on;
    let ranged = !mv.delivery.is_touch();
    let (atk, a_edge, corner, a_yaw, a_pos_y, a_dive) = {
        let a = &m.f[by];
        let d = &m.f[on];
        (
            if ranged { a.c.focus() } else { a.c.might() },
            a.c.edge,
            cornered(a, d),
            a.yaw,
            a.pos.y,
            a.act.as_ref().is_some_and(|x| x.dive),
        )
    };
    let chart = m.chart;
    let d = &mut m.f[on];
    let def = if ranged { d.c.will() } else { d.c.guard() };
    let facing_away = wrap(angle_to(d.pos, from) - d.yaw).abs();
    let guarded = d.state == State::Guard && facing_away < 1.2 && !mv.delivery.is_blast();
    let rear = !ranged && facing_away > 2.2;
    let mut damage = 1.1 * pow(power, 0.7) * (atk / def).sqrt() * chart.type_mul(mv.field, &d.c.fields);
    damage *= a_edge * corner;
    if guarded {
        damage *= if mv.field == IRON { 0.4 } else { 0.2 };
    }
    if rear {
        damage *= 1.35;
    }
    if !guarded {
        if d.hurt < RED_WINDOW {
            d.red = 0.0;
        }
        d.red += damage * RED_SHARE;
        d.hurt = 0.0;
    }
    d.hp -= damage;
    d.red = min(d.red, max(0.0, d.b.hp - d.hp));
    d.launch += if guarded {
        0.0
    } else {
        damage * 0.8 * (if mv.field == STONE { 1.3 } else { 1.0 })
    };
    if !selfhit && !repeat {
        let a = &mut m.f[by];
        a.energy = min(100.0, a.energy + ENERGY_DEALT + (if mv.field == WILD { 5.0 } else { 0.0 }));
        let d = &mut m.f[on];
        d.energy = min(100.0, d.energy + ENERGY_TAKEN);
    }
    if mv.drain != 0.0 && !selfhit {
        let a = &mut m.f[by];
        a.hp = min(a.b.hp, a.hp + damage * mv.drain / 100.0);
    }
    let d = &mut m.f[on];
    let spike = !guarded
        && (mv.slot == Slot::Heavy || a_dive)
        && !selfhit
        && !d.on_ground
        && a_pos_y + 0.3 >= d.pos.y
        && (d.state == State::Ledge || hypot(d.pos.x, d.pos.z) > ARENA_RADIUS - 0.3);
    m.events.push(Event::Hit {
        by,
        on,
        slot: mv.slot,
        field: mv.field,
        damage,
        guarded,
        rear,
        spike,
        at,
    });
    if guarded {
        d.stamina -= power / 100.0;
        return;
    }
    mark(d, mv.field, damage);

    if !rear && mv.field != SHADOW && d.state == State::Attack && d.act.as_ref().is_some_and(|x| x.mv.power >= 60.0) && power < 70.0 && d.b.armour > 0.3 {
        return;
    }
    let up = if spike {
        -SPIKE_DOWN
    } else {
        min(
            0.95,
            (if mv.slot == Slot::Launcher {
                0.9
            } else if mv.slot == Slot::Heavy || mv.slot == Slot::Ultimate {
                0.45
            } else {
                0.25
            }) + (if mv.field == GALE { 0.15 } else { 0.0 }),
        )
    };
    let kb = (2.5 + power * 0.05)
        * (1.0 + d.launch / 80.0)
        * pow(70.0 / (d.b.mass + 10.0), 0.4)
        * (1.0 - d.b.armour * 0.4)
        * (if mv.field == TIDE { 1.2 } else { 1.0 });
    let ang = if flat(from, d.pos) > 0.05 { angle_to(from, d.pos) } else { a_yaw };
    let h = (1.0 - up * up).sqrt();
    d.vel.x = cos(ang) * kb * h;
    d.vel.z = sin(ang) * kb * h;
    d.vel.y = kb * up;
    if d.vel.y > 0.0 {
        d.on_ground = false;
    }
    d.state = State::Stun;
    d.stun = round(10.0 + power / 6.0 + d.launch / 12.0 + (if rear { 4.0 } else { 0.0 }) + (if mv.field == STORM { 6.0 } else { 0.0 }));
    d.act = None;
    d.t = 0.0;
    if spike {
        d.stun = min(d.stun, SPIKE_STUN);
    }
    if repeat {
        d.stun = min(d.stun, PULSE_STUN);
    }
    if d.flying && power >= 70.0 {
        d.flying = false;
        d.clipped = 3.0 * HZ;
        m.events.push(Event::Clipped { who: on });
    } else {
        d.flying = false;
    }
}

fn mark(d: &mut Fighter, field: u8, damage: f64) {
    let k = &mut d.marks;
    if field == EMBER || field == VENOM {
        let (frames, share) = if field == EMBER { (3.0 * HZ, 0.1) } else { (5.0 * HZ, 0.2) };
        k.dot = frames;
        k.dot_per = (damage * share) / frames;
        k.dot_field = Some(field);
    }
    if field == FROST {
        k.chill = 2.0 * HZ;
    }
    if field == GROVE {
        k.root = HZ;
    }
    if field == SPIRIT {
        d.energy = max(0.0, d.energy - 8.0);
    }
}

pub const WALL_HEIGHT: f64 = 1.8;
const CONE_FRAMES: f64 = 10.0;
const NOVA_FRAMES: f64 = 8.0;

fn mouth(f: &Fighter, d: &Delivery, k: (f64, f64)) -> V3 {
    V3 {
        x: f.pos.x + k.0 * f.b.radius,
        y: f.pos.y + (if matches!(d, Delivery::Wall { .. }) { 0.0 } else { f.b.height * 0.6 }),
        z: f.pos.z + k.1 * f.b.radius,
    }
}

fn grown(d: Delivery, by: f64) -> Delivery {
    match d {
        Delivery::Column { length, width, speed } => Delivery::Column {
            length: length * by,
            width,
            speed,
        },
        Delivery::Wall { width, depth, travel, speed } => Delivery::Wall {
            width,
            depth,
            travel: travel * by,
            speed,
        },
        Delivery::Cone { angle, length } => Delivery::Cone { angle, length: length * by },
        Delivery::Blast { range, radius, flight } => Delivery::Blast {
            range,
            radius: radius * by,
            flight,
        },
        Delivery::Nova { radius } => Delivery::Nova { radius: radius * by },
        Delivery::Touch => Delivery::Touch,
    }
}

fn loose(f: &Fighter, side: usize, mv: &Move, shape: Delivery, target: V3) -> Area {
    let aim = f.act.as_ref().and_then(|a| a.aim).unwrap_or(Aim { yaw: f.yaw, pitch: 0.0 });
    let k = fwd(aim.yaw);
    let tempo = mv.tempo;
    let full = f.act.as_ref().map_or(0.0, level);
    let d = if let Tempo::Charge { reach, .. } = tempo {
        grown(shape, lerp(1.0, reach, full))
    } else {
        shape
    };
    let flat_aim = if matches!(d, Delivery::Wall { .. } | Delivery::Cone { .. }) {
        0.0
    } else {
        aim.pitch
    };
    let dir = V3 {
        x: k.0 * cos(flat_aim),
        y: sin(flat_aim),
        z: k.1 * cos(flat_aim),
    };
    let from = mouth(f, &d, k);
    let power =
        mv.power * (if mv.slot == Slot::Ultimate { 1.4 } else { 1.0 }) * (if let Tempo::Charge { grow, .. } = tempo { lerp(1.0, grow, full) } else { 1.0 });
    let lasts = match tempo {
        Tempo::Build { run, .. } => run * HZ + PULSE_MIN + 1.0,
        Tempo::Fade { run, .. } => round(run * HZ),
        _ => 0.0,
    };
    let mut a = Area {
        owner: side,
        mv: *mv,
        d,
        power,
        at: from,
        from,
        dir,
        t: 0.0,
        life: 0.0,
        land: 0.0,
        every: if lasts != 0.0 { PULSE_EVERY } else { 0.0 },
        ramp: 0.0,
        hits: [0.0, 0.0],
        struck: [false, false],
    };
    match d {
        Delivery::Column { length, speed, .. } => a.life = max(lasts, ((length / speed) * HZ).ceil() + 4.0),
        Delivery::Wall { travel, speed, .. } => a.life = max(lasts, ((travel / speed) * HZ).ceil()),
        Delivery::Cone { .. } => a.life = max(lasts, CONE_FRAMES),
        Delivery::Nova { .. } => {
            a.at = f.pos;
            a.from = f.pos;
            a.life = max(lasts, NOVA_FRAMES);
        }
        Delivery::Blast { range, flight, .. } => {
            let r = clamp(flat(f.pos, target) + f.act.as_ref().map_or(0.0, |x| x.lead), 0.0, range);
            let ang = angle_to(f.pos, target);
            let land = max(1.0, round(flight * HZ)) + 1.0;
            a.at = V3 {
                x: f.pos.x + cos(ang) * r,
                y: 0.0,
                z: f.pos.z + sin(ang) * r,
            };
            a.land = land;
            a.life = land + lasts;
        }
        Delivery::Touch => {}
    }
    a
}

/// sim.ts head.
pub fn head(a: &Area) -> V3 {
    let s = a.t / HZ;
    let along = |n: f64| V3 {
        x: a.at.x + a.dir.x * n,
        y: a.at.y + a.dir.y * n,
        z: a.at.z + a.dir.z * n,
    };
    match a.d {
        Delivery::Column { length, speed, .. } => along(min(length, speed * s)),
        Delivery::Wall { travel, speed, depth, .. } => along(min(travel, speed * s) + depth / 2.0),
        Delivery::Cone { length, .. } => along(length / 2.0),
        Delivery::Nova { .. } | Delivery::Touch => a.at,
        Delivery::Blast { .. } => {
            let k = min(1.0, a.t / (a.land - 1.0));
            let top = 2.0 + flat(a.from, a.at) * 0.35;
            V3 {
                x: a.from.x + (a.at.x - a.from.x) * k,
                y: a.from.y + (a.at.y - a.from.y) * k + 4.0 * top * k * (1.0 - k),
                z: a.from.z + (a.at.z - a.from.z) * k,
            }
        }
    }
}

/// sim.ts covers.
pub fn covers(a: &Area, t: &Fighter) -> bool {
    let r = t.b.radius;
    let dx = t.pos.x - a.at.x;
    let dz = t.pos.z - a.at.z;
    let h = or1(hypot(a.dir.x, a.dir.z));
    let ux = a.dir.x / h;
    let uz = a.dir.z / h;
    let along = dx * ux + dz * uz;
    let side = (-dx * uz + dz * ux).abs();
    let s = a.t / HZ;
    match a.d {
        Delivery::Column { length, width, speed } => {
            let tip = min(length, speed * s) * h;
            let half = width / 2.0;
            if along < -r || along > tip + r || side > half + r {
                return false;
            }
            let y = a.at.y + (along / h) * a.dir.y;
            y > t.pos.y - half && y < t.pos.y + t.b.height + half
        }
        Delivery::Wall { width, depth, travel, speed } => {
            let near = min(travel, speed * s);
            along > near - r && along < near + depth + r && side < width / 2.0 + r && t.pos.y < a.at.y + WALL_HEIGHT
        }
        Delivery::Cone { angle, length } => {
            let dist = hypot(dx, dz);
            let half = (angle * PI) / 360.0;
            if dist > length + r || along <= 0.0 {
                return false;
            }
            let off = atan2(side, along) - atan2(r, max(dist, 0.01));
            off < half && (t.pos.y + t.b.height / 2.0 - a.at.y).abs() < max(1.5, dist * tan(half))
        }
        Delivery::Nova { radius } => {
            let g = radius * min(1.0, (a.t + 1.0) / NOVA_FRAMES);
            hypot(dx, dz) < g + r && (t.pos.y - a.at.y).abs() < radius
        }
        Delivery::Blast { radius, .. } => a.t >= a.land - 1.0 && hypot(dx, dz) < radius + r && t.pos.y < a.at.y + radius,
        Delivery::Touch => false,
    }
}

fn where_(a: &Area, t: &Fighter) -> f64 {
    let dx = t.pos.x - a.at.x;
    let dz = t.pos.z - a.at.z;
    let h = or1(hypot(a.dir.x, a.dir.z));
    match a.d {
        Delivery::Column { length, .. } => clamp((dx * a.dir.x + dz * a.dir.z) / h / h / length, 0.0, 1.0),
        Delivery::Wall { travel, speed, .. } => clamp(min(travel, (speed * a.t) / HZ) / travel, 0.0, 1.0),
        Delivery::Cone { length, .. } => clamp(hypot(dx, dz) / length, 0.0, 1.0),
        Delivery::Blast { radius, .. } | Delivery::Nova { radius } => clamp(hypot(dx, dz) / radius, 0.0, 1.0),
        Delivery::Touch => 0.0,
    }
}

fn strength(a: &Area, on: usize, t: &Fighter) -> f64 {
    let curve = match a.mv.tempo {
        Tempo::Build { from, .. } => PULSE_STREAM * lerp(from, 1.0, a.ramp),
        Tempo::Fade { to, .. } => lerp(1.0, to, a.t / a.life) * (if a.hits[on] != 0.0 { PULSE_TAIL } else { 1.0 }),
        _ => 1.0,
    };
    a.power * curve * lerp(1.0, LOW, where_(a, t))
}

fn areas(m: &mut Match) {
    for idx in 0..m.areas.len() {
        let rc = m.areas[idx].clone();
        {
            let mut a = rc.borrow_mut();
            if matches!(a.mv.tempo, Tempo::Build { .. }) {
                let mine = m.f[a.owner].act.as_ref().and_then(|x| x.area.as_ref()).is_some_and(|p| Rc::ptr_eq(p, &rc));
                if !mine {
                    a.life = min(a.life, a.t + 1.0);
                }
            }
            if a.every != 0.0 && a.t % a.every == 0.0 {
                a.struck = [false, false];
            }
        }
        for on in 0..2 {
            let (hit_it, power, repeat, from, at, mv, owner) = {
                let mut a = rc.borrow_mut();
                let t = &m.f[on];
                if a.struck[on] || t.invuln > 0.0 || (on == a.owner && !a.d.is_blast()) {
                    continue;
                }
                if !covers(&a, t) {
                    continue;
                }
                a.struck[on] = true;
                let power = strength(&a, on, t);
                let before = a.hits[on];
                a.hits[on] += 1.0;
                let repeat = before > 0.0 || matches!(a.mv.tempo, Tempo::Build { .. });
                let from = if matches!(a.d, Delivery::Column { .. } | Delivery::Cone { .. } | Delivery::Wall { .. }) {
                    m.f[a.owner].pos
                } else {
                    a.at
                };
                (
                    true,
                    power,
                    repeat,
                    from,
                    V3 {
                        x: t.pos.x,
                        y: t.pos.y + t.b.height / 2.0,
                        z: t.pos.z,
                    },
                    a.mv,
                    a.owner,
                )
            };
            if hit_it {
                hit(m, owner, on, &mv, power, from, at, repeat);
            }
        }
        rc.borrow_mut().t += 1.0;
    }
    m.areas.retain(|a| {
        let a = a.borrow();
        a.t < a.life
    });
}

/// One tick. Events from this tick only are in `m.events`.
pub fn step(m: &mut Match, inputs: [Input; 2]) {
    m.events.clear();
    if m.over {
        return;
    }
    m.tick += 1.0;
    for side in 0..2 {
        let f = &mut m.f[side];
        if f.state == State::Stun {
            f.stun -= 1.0;
            if f.stun <= 0.0 {
                f.state = State::Free;
            }
        }
        if f.state == State::Dash {
            f.t += 1.0;
            if f.t >= 12.0 {
                f.state = State::Free;
                f.t = 0.0;
            }
        }
        if f.state == State::Ledge {
            f.t += 1.0;
        }
        if f.invuln > 0.0 {
            f.invuln -= 1.0;
        }
        if let Some((k, left)) = f.buf {
            f.buf = if left - 1.0 <= 0.0 { None } else { Some((k, left - 1.0)) };
        }
        let k = &mut f.marks;
        if k.dot > 0.0 {
            k.dot -= 1.0;
            f.hp -= k.dot_per;
        }
        if k.chill > 0.0 {
            k.chill -= 1.0;
        }
        if k.root > 0.0 {
            k.root -= 1.0;
        }
        if f.clipped > 0.0 {
            f.clipped -= 1.0;
        }
        control(m, side, &inputs[side]);
    }
    for side in 0..2 {
        attack_frames(m, side, &inputs[side]);
    }
    for side in 0..2 {
        move_body(m, side, &inputs[side]);
    }
    areas(m);
    {
        let [a, b] = &mut m.f;
        let d = flat(a.pos, b.pos);
        let min_ = a.b.radius + b.b.radius;
        if d < min_ && d > 1e-6 && (a.pos.y - b.pos.y).abs() < max(a.b.height, b.b.height) {
            let push = min_ - d;
            let wa = b.b.mass / (a.b.mass + b.b.mass);
            let nx = (b.pos.x - a.pos.x) / d;
            let nz = (b.pos.z - a.pos.z) / d;
            a.pos.x -= nx * push * wa;
            a.pos.z -= nz * push * wa;
            b.pos.x += nx * push * (1.0 - wa);
            b.pos.z += nz * push * (1.0 - wa);
        }
    }
    for side in 0..2 {
        m.f[side].prev = inputs[side];
    }
    for side in 0..2 {
        let f = &m.f[side];
        let how = if f.hp <= 0.0 {
            Some(How::Hp)
        } else if f.pos.y < FALL_KO {
            Some(How::RingOut)
        } else {
            None
        };
        if let Some(how) = how {
            return end(m, 1 - side, Event::Ko { who: side, how });
        }
    }
    if m.tick >= ROUND_TICKS {
        let p = m.f[0].hp / m.f[0].b.hp;
        let q = m.f[1].hp / m.f[1].b.hp;
        end(
            m,
            if p >= q { 0 } else { 1 },
            Event::Ko {
                who: if p >= q { 1 } else { 0 },
                how: How::Time,
            },
        );
    }
}
fn end(m: &mut Match, winner: usize, e: Event) {
    m.over = true;
    m.winner = Some(winner);
    m.events.push(e);
}
