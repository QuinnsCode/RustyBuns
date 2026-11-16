// The cozy-to-sim dial: one setting, three stops, like a flight sim's assists. Each assist is a named rule the code
// asks for (`assist("autoCoil")`) instead of an if on the dial wherever it matters, so a new stop or a tweak is a row
// in RULES and nothing else.
//
//   cozy  no clock, gear weighs half, cables coil themselves, ramps snap into place, jacks glow, breakers never trip
//   crew  in between: a clock with a few minutes' grace, gear at three quarters, ramps snap, jacks glow
//   sim   real weights, the clock to doors with no grace, breakers trip, a short cable is short
export const DIALS = ["cozy", "crew", "sim"] as const;
export type Dial = (typeof DIALS)[number];

export const DIAL_NAMES: Record<Dial, string> = { cozy: "Cozy", crew: "Crew", sim: "Sim" };

type Rules = {
  /** Gear weighs this share of its real weight, for carry pace and what one person can lift. */
  weight: number;
  /** A clock runs to doors. */
  clock: boolean;
  /** Seconds after doors before lateness costs anything. */
  grace: number;
  /** Doors come this many times later than the venue's real load-in window. */
  doorsScale: number;
  /** A cable let go of coils itself up neatly instead of lying where it fell. */
  autoCoil: boolean;
  /** A ramp set down near a cable run snaps square over it. */
  rampSnap: boolean;
  /** The jacks that would take what you hold light up. */
  jackGlow: boolean;
  /** Too much on one circuit trips its breaker. */
  breakersTrip: boolean;
  /** Metres of reach a cable gives beyond its real length. */
  cableSlack: number;
};

export const RULES: Record<Dial, Rules> = {
  cozy: { weight: 0.5, clock: false, grace: Infinity, doorsScale: 2, autoCoil: true, rampSnap: true, jackGlow: true, breakersTrip: false, cableSlack: 2 },
  crew: { weight: 0.75, clock: true, grace: 120, doorsScale: 1.5, autoCoil: false, rampSnap: true, jackGlow: true, breakersTrip: true, cableSlack: 0.5 },
  sim: { weight: 1, clock: true, grace: 0, doorsScale: 1, autoCoil: false, rampSnap: false, jackGlow: false, breakersTrip: true, cableSlack: 0 },
};

export type Assist = keyof Rules;

// The plain sim (tests, the harness before the page turns it) runs on real numbers; the page starts a new player on Crew.
let dial: Dial = "sim";

/** Where the dial sits now. */
export const currentDial = () => dial;

export const isDial = (d: unknown): d is Dial => DIALS.some((x) => x === d);

/** Turn the dial; anything that isn't a stop leaves it where it was. */
export function setDial(d: unknown): Dial {
  if (isDial(d)) dial = d;
  return dial;
}

/** One rule at the dial's stop (or the stop given). */
export function assist<K extends Assist>(name: K, d: Dial = dial): Rules[K] {
  return RULES[d][name];
}

/** Weight as the dial feels it: kg times the stop's weight share. */
export const feltKg = (kg: number, d: Dial = dial) => kg * assist("weight", d);
