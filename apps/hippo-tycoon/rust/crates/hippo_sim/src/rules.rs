//! The numbers of src/sim/rules.ts that step() reads. `secs(x)` is spelled out
//! as ticks (30 Hz).

pub const TICK_HZ: f64 = 30.0;
pub const SEATS: usize = 4;

pub const WALL_R: f64 = 10.4;
pub const DROP_R: f64 = 0.45;
pub const MAX_DROPS: usize = 40;

pub const A_REST: f64 = 8.6;
pub const RAIL_HALF: f64 = 4.9;
pub const SLIDE_SPEED: f64 = 0.085;
pub const LUNGE: f64 = 5.5;
pub const SCOOP_R: f64 = 1.5;
pub const GULP_OUT: i64 = 4;
pub const GULP_BACK: i64 = 5;
pub const GULP_COOLDOWN: i64 = 11;
pub const BELLOW_TICKS: i64 = 9;

pub const GOLD: i64 = 1;
pub const SLUDGE: i64 = 2;
pub const NAIL: i64 = 3;
pub const WATER: i64 = 4;
pub const POINTS: [i64; 5] = [1, 3, -1, -2, 0];
pub const SPEED: [[f64; 2]; 5] = [[4.0, 7.0], [7.0, 10.0], [3.0, 5.5], [3.5, 6.0], [3.5, 6.0]];
pub const FRICTION: f64 = 0.992;
pub const MIN_SPEED: f64 = 1.6;
pub const MAX_SPEED: f64 = 13.0;
pub const RESTITUTION: f64 = 0.9;
pub const MIN_SCORE: i64 = 0;

pub const SPUTTER_TICKS: i64 = 30;
pub const SORE_TICKS: i64 = 90;
pub const SORE_FACTOR: f64 = 0.5;

pub const SLICK_AGE: i64 = 180;
pub const SLICK_LIFE: i64 = 300;
pub const SLICK_R: f64 = 2.2;
pub const SLICK_BOOST: f64 = 1.045;

pub const SPAWN_FIRST: i64 = 15;
pub const SPAWN_START: f64 = 27.0;
pub const SPAWN_END: f64 = 14.0;
pub const OVERFLOW_TICKS: i64 = 300;
pub const OVERFLOW_FACTOR: f64 = 0.5;
pub const BURST_GAP: i64 = 4;
pub const BURST_EXTRA: [i64; 2] = [1, 3];
pub const WEIGHTS: [f64; 5] = [58.0, 7.0, 12.0, 8.0, 10.0];
pub const WEIGHTS_OVERFLOW: [f64; 5] = [46.0, 14.0, 12.0, 18.0, 10.0];

pub const DISH: f64 = 0.0009;

pub fn seat_angle(seat: usize) -> f64 {
    -core::f64::consts::PI / 2.0 + seat as f64 * (core::f64::consts::PI / 2.0)
}
