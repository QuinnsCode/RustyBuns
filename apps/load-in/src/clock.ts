// The clock to doors: each venue opens its doors a set time after you arrive, and the dial stretches that window
// (Cozy runs no clock at all). Late doors cost pay and crowd mood, a minute at a time, after the dial's grace. Plain
// numbers in game seconds (`World.t`), so the test and the page read the same clock.
import { type Dial, assist, currentDial } from "./assists.ts";

/** A venue's real load-in window (seconds until doors on the Sim stop), what the gig pays, and after the show the
 * seconds to curfew (out by then or pay `fine` a minute; null: your own garage keeps no curfew). */
export const VENUES: Record<string, { window: number; fee: number; curfew: number | null; fine: number }> = {
  garage: { window: 180, fee: 0, curfew: null, fine: 0 },
  "dive-bar": { window: 300, fee: 150, curfew: 360, fine: 25 },
  "bigger-bar": { window: 480, fee: 300, curfew: 540, fine: 50 },
  // The park: a long push from the truck and long runs, so a longer window.
  park: { window: 720, fee: 400, curfew: 900, fine: 75 },
  // The arena: sixteen boxes off the truck and flown, so the crew needs its time. No load-out here yet (no truck in the level).
  arena: { window: 1800, fee: 1500, curfew: null, fine: 0 },
  // The small arena: four hangs, each box carried to its point and every motor at 4 m a minute.
  "small-arena": { window: 1800, fee: 1500, curfew: null, fine: 0 },
  // The show: the rig is up, so the clock is the minutes to set the desk before the band walks on.
  show: { window: 120, fee: 300, curfew: null, fine: 0 },
  // The desert: a 30 m walk over sand for every box, and a wall to stack.
  desert: { window: 1200, fee: 600, curfew: null, fine: 0 },
};
const FALLBACK = { window: 300, fee: 0, curfew: null, fine: 0 };

/** Pay lost per minute late, as a share of the fee; and crowd mood lost per minute late, out of 100. */
export const PAY_PER_MIN = 0.1, MOOD_PER_MIN = 8, MOOD_FLOOR = 20;

/** Seconds from arrival to doors at this venue and stop; null when the stop runs no clock. */
export function doorsAt(level: string, d: Dial = currentDial()): number | null {
  if (!assist("clock", d)) return null;
  return (VENUES[level] ?? FALLBACK).window * assist("doorsScale", d);
}

export type Doors = {
  /** Seconds left to doors (negative once they're open); null with no clock. */
  left: number | null;
  /** Seconds late past doors and grace, 0 on time. */
  late: number;
  pay: number;
  fee: number;
  /** Out of 100. */
  mood: number;
};

/** Where the clock stands at `t` game seconds. */
export function doors(level: string, t: number, d: Dial = currentDial()): Doors {
  const at = doorsAt(level, d), fee = (VENUES[level] ?? FALLBACK).fee;
  if (at === null) return { left: null, late: 0, pay: fee, fee, mood: 100 };
  const late = Math.max(0, t - at - assist("grace", d)), min = Math.ceil(late / 60);
  return {
    left: at - t, late,
    pay: Math.round(fee * Math.max(0, 1 - PAY_PER_MIN * min)),
    fee,
    mood: Math.max(MOOD_FLOOR, 100 - MOOD_PER_MIN * min),
  };
}

/** A room score as the crowd takes it: the sound, scaled by their mood. */
export const showScore = (room: number, mood: number) => Math.round((room * mood) / 100);

/** The clock as a fixed-width "m:ss" (a minus sign once doors have passed). */
export function clockText(left: number): string {
  const s = Math.abs(Math.trunc(left)), sign = left < 0 ? "-" : " ";
  return `${sign}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type Curfew = {
  /** Seconds left to curfew (negative once it has passed); null with no clock or no curfew. */
  left: number | null;
  /** Seconds past curfew and the dial's grace, 0 on time. */
  late: number;
  /** What the venue charges for those minutes. */
  fine: number;
};

/** Where curfew stands `since` seconds into the load-out: the same dial as the doors, the venue's own fine a minute. */
export function curfew(level: string, since: number, d: Dial = currentDial()): Curfew {
  const v = VENUES[level] ?? FALLBACK;
  if (!assist("clock", d) || v.curfew === null) return { left: null, late: 0, fine: 0 };
  const at = v.curfew * assist("doorsScale", d), late = Math.max(0, since - at - assist("grace", d));
  return { left: at - since, late, fine: v.fine * Math.ceil(late / 60) };
}
