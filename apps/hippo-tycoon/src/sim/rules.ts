// Every tuning number lives here. Distances are world units, times are ticks
// (the sim runs at a fixed 30 Hz), speeds are units per tick unless noted.

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
export const secs = (s: number) => Math.round(s * TICK_HZ);

export const SEATS = 4;
export const SEAT_NAMES = ["Baron Gulpington", "Crude Carl", "Big Barrel Bertha", "Gusher Gus"] as const;

// ---- arena -----------------------------------------------------------------
export const WALL_R = 10.4;       // the pan's rim
export const DROP_R = 0.45;       // every drop's radius
export const MAX_DROPS = 40;

// ---- hippos ----------------------------------------------------------------
// Seat i faces the centre along the axis at angle seatAngle(i). A hippo shuffles
// along a straight lip across its office mouth (RAIL_HALF each way, about 60
// degrees of the pan's rim) and chomps in along the axis.
export const A_REST = 8.6;        // axis distance of a hippo at rest in its office
export const RAIL_HALF = 4.9;
export const SLIDE_SPEED = 0.085; // slide units (-1..1) per tick, about 0.8 s edge to edge
export const LUNGE = 5.5;         // how far a chomp reaches in from A_REST
export const SCOOP_R = 1.5;       // eat radius around the jaws' centre at the peak
export const GULP_OUT = 4;        // ticks from press to the peak (the chomp lands)
export const GULP_BACK = 5;       // ticks to haul back
export const GULP_COOLDOWN = 11;  // ticks from press until the next press counts (~370 ms)
export const BELLOW_TICKS = 9;

export const seatAngle = (seat: number) => -Math.PI / 2 + seat * (Math.PI / 2);

// ---- drops -----------------------------------------------------------------
export const OIL = 0, GOLD = 1, SLUDGE = 2, NAIL = 3, WATER = 4;
export const KIND_NAMES = ["oil", "gold", "sludge", "nail", "water"] as const;
export const POINTS = [1, 3, -1, -2, 0] as const;
/** Launch speed range per kind, units per second. */
export const SPEED: readonly (readonly [number, number])[] = [[4, 7], [7, 10], [3, 5.5], [3.5, 6], [3.5, 6]];
export const FRICTION = 0.992;    // per tick
export const MIN_SPEED = 1.6;     // units per second: oil never quite stops sloshing
export const MAX_SPEED = 13;
export const RESTITUTION = 0.9;
export const MIN_SCORE = 0;

// ---- effects ---------------------------------------------------------------
export const SPUTTER_TICKS = secs(1);   // sludge: choking: no sliding, no chomping
export const SORE_TICKS = secs(3);      // nail: sore jaw, slide speed halved
export const SORE_FACTOR = 0.5;

// ---- slicks ----------------------------------------------------------------
export const SLICK_AGE = secs(6);       // an uneaten gold drop splatters at this age
export const SLICK_LIFE = secs(10);
export const SLICK_R = 2.2;
export const SLICK_BOOST = 1.045;       // per tick speed multiplier inside a slick

// ---- spawning --------------------------------------------------------------
export const SPAWN_FIRST = secs(0.5);
export const SPAWN_START = secs(0.9);   // ticks between drips at round start...
export const SPAWN_END = secs(0.45);    // ...ramping to this by the end
export const OVERFLOW_TICKS = secs(10); // the last 10 s
export const OVERFLOW_FACTOR = 0.5;     // spawn interval multiplier in overflow
export const BURST_GAP = 4;             // ticks between drops of a gold burst
export const BURST_EXTRA: readonly [number, number] = [1, 3];
/** Spawn weights [oil, gold, sludge, nail, water], normal and overflow. */
export const WEIGHTS: readonly number[] = [58, 7, 12, 8, 10];
export const WEIGHTS_OVERFLOW: readonly number[] = [46, 14, 12, 18, 10];

// ---- round -----------------------------------------------------------------
export const ROUND_SECS = [30, 60, 90] as const;
export const COUNTDOWN_TICKS = secs(3);
export const DEFAULT_ROUND_SECS = 60;

// ---- bots ------------------------------------------------------------------
export interface Personality {
  /** Ticks between re-planning. */
  reaction: number;
  /** Slide units of random aim error, fixed per plan. */
  aimError: number;
  /** 0..1: how much more a bot wants gold than oil. */
  greed: number;
  /** 0..1: chance (per drop, per plan) that the bot reads a bad drop correctly. */
  caution: number;
}
export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "normal", "hard"];
export const PERSONALITIES: Record<Difficulty, Personality> = {
  easy: { reaction: 22, aimError: 0.45, greed: 0.2, caution: 0.15 },
  normal: { reaction: 7, aimError: 0.16, greed: 0.6, caution: 0.7 },
  hard: { reaction: 2, aimError: 0.05, greed: 1, caution: 1 },
};

// ---- pan -------------------------------------------------------------------
/** The pan is dished: a gentle pull to the middle keeps drops off the rim. Units per tick squared at the rim. */
export const DISH = 0.0009;
