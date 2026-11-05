//! What the sim reads, as plain data: the roster's creatures with their bodies and moves, and the field chart.
//! scripts/sim-rust.ts writes all of it from the TS (roster.ts, moves.ts, fields.ts, balance.json), so the TS
//! stays the source of truth and this crate never keeps its own copy of a number a tuner might change.
use crate::json::Json;

/// fields.ts FIELDS, in order.
pub const FIELDS: usize = 12;
pub const STONE: u8 = 3;
pub const EMBER: u8 = 0;
pub const TIDE: u8 = 1;
pub const GALE: u8 = 2;
pub const FROST: u8 = 4;
pub const STORM: u8 = 5;
pub const GROVE: u8 = 6;
pub const VENOM: u8 = 7;
pub const SPIRIT: u8 = 8;
pub const SHADOW: u8 = 9;
pub const IRON: u8 = 10;
pub const WILD: u8 = 11;

/// moves.ts SLOTS, in order.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Slot {
    Light = 0,
    Heavy = 1,
    Launcher = 2,
    Special = 3,
    Beam = 4,
    Ultimate = 5,
}
pub const SLOTS: [Slot; 6] = [Slot::Light, Slot::Heavy, Slot::Launcher, Slot::Special, Slot::Beam, Slot::Ultimate];

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Delivery {
    Touch,
    Column { length: f64, width: f64, speed: f64 },
    Wall { width: f64, depth: f64, travel: f64, speed: f64 },
    Cone { angle: f64, length: f64 },
    Blast { range: f64, radius: f64, flight: f64 },
    Nova { radius: f64 },
}
impl Delivery {
    pub fn index(&self) -> u32 {
        match self {
            Delivery::Touch => 0,
            Delivery::Column { .. } => 1,
            Delivery::Wall { .. } => 2,
            Delivery::Cone { .. } => 3,
            Delivery::Blast { .. } => 4,
            Delivery::Nova { .. } => 5,
        }
    }
    pub fn is_touch(&self) -> bool {
        matches!(self, Delivery::Touch)
    }
    pub fn is_blast(&self) -> bool {
        matches!(self, Delivery::Blast { .. })
    }
    /// moves.ts reachOf.
    pub fn reach(&self) -> f64 {
        match *self {
            Delivery::Column { length, .. } | Delivery::Cone { length, .. } => length,
            Delivery::Wall { travel, depth, .. } => travel + depth,
            Delivery::Blast { range, radius, .. } => range + radius,
            Delivery::Nova { radius } => radius,
            Delivery::Touch => 0.0,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Tempo {
    Quick,
    Charge { full: f64, grow: f64, reach: f64 },
    Build { run: f64, from: f64 },
    Fade { run: f64, to: f64 },
}

#[derive(Clone, Copy, Debug)]
pub struct Move {
    pub slot: Slot,
    pub field: u8,
    pub power: f64,
    pub ranged: bool,
    pub drain: f64,
    pub delivery: Delivery,
    pub tempo: Tempo,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Archetype {
    Skirmisher,
    Flyer,
    Tank,
    Bruiser,
}

/// roster.ts Body.
#[derive(Clone, Copy, Debug)]
pub struct Body {
    pub mass: f64,
    pub radius: f64,
    pub height: f64,
    pub top_speed: f64,
    pub accel: f64,
    pub turn_rate: f64,
    pub spin_up: f64,
    pub lateral: f64,
    pub jump: f64,
    pub flight: bool,
    pub stamina: f64,
    pub lift: f64,
    pub hp: f64,
    pub armour: f64,
    pub dash_cost: f64,
    pub dodge: f64,
}

#[derive(Clone, Debug)]
pub struct Creature {
    pub archetype: Archetype,
    pub fields: Vec<u8>,
    /// vigor, might, guard, focus, will, speed
    pub stats: [f64; 6],
    pub edge: f64,
    pub body: Body,
    /// One per slot, in SLOTS order.
    pub moves: [Move; 6],
}
impl Creature {
    pub fn might(&self) -> f64 {
        self.stats[1]
    }
    pub fn guard(&self) -> f64 {
        self.stats[2]
    }
    pub fn focus(&self) -> f64 {
        self.stats[3]
    }
    pub fn will(&self) -> f64 {
        self.stats[4]
    }
    /// sim.ts statTotal, summed in the same order.
    pub fn stat_total(&self) -> f64 {
        let s = &self.stats;
        s[0] + s[1] + s[2] + s[3] + s[4] + s[5]
    }
}

/// fields.ts STRONG as a table: `strong[a][b]` when field a is strong against b.
#[derive(Clone, Debug)]
pub struct Chart {
    pub strong: [[bool; FIELDS]; FIELDS],
}
impl Chart {
    /// fields.ts typeMul.
    pub fn type_mul(&self, field: u8, target: &[u8]) -> f64 {
        let mut m = 1.0;
        for &t in target {
            if self.strong[field as usize][t as usize] {
                m += 0.125;
            } else if self.strong[t as usize][field as usize] || t == field {
                m -= 0.1;
            }
        }
        crate::dmath::clamp(m, 0.9, 1.125)
    }
}

pub struct Roster {
    pub chart: Chart,
    pub creatures: Vec<Creature>,
}

fn field_of(v: &Json) -> Result<u8, String> {
    let f = v.num()?;
    if f >= 0.0 && f < FIELDS as f64 && f.fract() == 0.0 {
        Ok(f as u8)
    } else {
        Err(format!("field {f}: not one of the {FIELDS}"))
    }
}

fn move_of(v: &Json, slot: Slot) -> Result<Move, String> {
    let d = v.get("delivery")?;
    let shape = d.get("shape")?.str()?;
    let n = |k: &str| d.field(k);
    let delivery = match shape {
        "touch" => Delivery::Touch,
        "column" => Delivery::Column {
            length: n("length")?,
            width: n("width")?,
            speed: n("speed")?,
        },
        "wall" => Delivery::Wall {
            width: n("width")?,
            depth: n("depth")?,
            travel: n("travel")?,
            speed: n("speed")?,
        },
        "cone" => Delivery::Cone {
            angle: n("angle")?,
            length: n("length")?,
        },
        "blast" => Delivery::Blast {
            range: n("range")?,
            radius: n("radius")?,
            flight: n("flight")?,
        },
        "nova" => Delivery::Nova { radius: n("radius")? },
        s => return Err(format!("shape {s}: unknown")),
    };
    let t = v.get("tempo")?;
    let k = |key: &str| t.field(key);
    let tempo = match t.get("kind")?.str()? {
        "quick" => Tempo::Quick,
        "charge" => Tempo::Charge {
            full: k("full")?,
            grow: k("grow")?,
            reach: k("reach")?,
        },
        "build" => Tempo::Build {
            run: k("run")?,
            from: k("from")?,
        },
        "fade" => Tempo::Fade { run: k("run")?, to: k("to")? },
        s => return Err(format!("tempo {s}: unknown")),
    };
    Ok(Move {
        slot,
        field: field_of(v.get("field")?)?,
        power: v.field("power")?,
        ranged: v.get("ranged")?.boolean()?,
        drain: v.field("drain")?,
        delivery,
        tempo,
    })
}

fn creature_of(v: &Json) -> Result<Creature, String> {
    let archetype = match v.get("archetype")?.str()? {
        "skirmisher" => Archetype::Skirmisher,
        "flyer" => Archetype::Flyer,
        "tank" => Archetype::Tank,
        "bruiser" => Archetype::Bruiser,
        s => return Err(format!("archetype {s}: unknown")),
    };
    let fields = v.get("fields")?.arr()?.iter().map(field_of).collect::<Result<Vec<_>, _>>()?;
    let s = v.get("stats")?.nums()?;
    if s.len() != 6 {
        return Err("stats: six numbers".into());
    }
    let b = v.get("body")?;
    let body = Body {
        mass: b.field("mass")?,
        radius: b.field("radius")?,
        height: b.field("height")?,
        top_speed: b.field("topSpeed")?,
        accel: b.field("accel")?,
        turn_rate: b.field("turnRate")?,
        spin_up: b.field("spinUp")?,
        lateral: b.field("lateral")?,
        jump: b.field("jump")?,
        flight: b.get("air")?.str()? == "flight",
        stamina: b.field("stamina")?,
        lift: b.field("lift")?,
        hp: b.field("hp")?,
        armour: b.field("armour")?,
        dash_cost: b.field("dashCost")?,
        dodge: b.field("dodge")?,
    };
    let ms = v.get("moves")?.arr()?;
    if ms.len() != 6 {
        return Err("moves: one per slot".into());
    }
    let mut moves = [Move {
        slot: Slot::Light,
        field: 0,
        power: 0.0,
        ranged: false,
        drain: 0.0,
        delivery: Delivery::Touch,
        tempo: Tempo::Quick,
    }; 6];
    for (i, slot) in SLOTS.iter().enumerate() {
        moves[i] = move_of(&ms[i], *slot).map_err(|e| format!("moves.{i}: {e}"))?;
    }
    Ok(Creature {
        archetype,
        fields,
        stats: [s[0], s[1], s[2], s[3], s[4], s[5]],
        edge: v.field("edge")?,
        body,
        moves,
    })
}

pub fn roster_of(v: &Json) -> Result<Roster, String> {
    let mut strong = [[false; FIELDS]; FIELDS];
    let rows = v.get("strong")?.arr()?;
    if rows.len() != FIELDS {
        return Err(format!("strong: one row per field ({FIELDS})"));
    }
    for (a, row) in rows.iter().enumerate() {
        for b in row.arr()? {
            strong[a][field_of(b)? as usize] = true;
        }
    }
    let creatures = v
        .get("creatures")?
        .arr()?
        .iter()
        .enumerate()
        .map(|(i, c)| creature_of(c).map_err(|e| format!("creatures.{i}: {e}")))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Roster {
        chart: Chart { strong },
        creatures,
    })
}
