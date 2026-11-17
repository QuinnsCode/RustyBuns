// How a dance floor takes a DJ set (#5029 step 12), from the decks alone: what each deck sends to the master and its
// tempo. A blend near matched tempos lifts the floor, two tracks clashing clears it, silence drops it fast, and a
// master run hot tires it. Plain numbers: every page in a crew room works it out from the same shared decks.

/** The floor's mood, 0 (gone) to 100, the seconds the master has been silent, and what the floor is taking it as. */
export type SetMood = { mood: number; quiet: number; say: "warming up" | "in the mix" | "locked in" | "trainwreck" | "dead air" | "too hot" };
export const newSetMood = (): SetMood => ({ mood: 50, quiet: 0, say: "warming up" });

/** A deck counts as in the mix above this gain; tempos within LOCK are beat-matched, past CLASH they fight. */
const AUDIBLE = 0.25, LOCK = 0.01, CLASH = 0.03;
/** Seconds of nothing before the floor notices, and the summed gain past which the master's limiter is working. */
export const DEAD_AIR_S = 3, HOT = 1.4;

/** `dt` seconds of the set: `gains` is what each deck sends to the master (0 to 1), `bpms` each deck's tempo now. */
export function tickSetMood(m: SetMood, gains: readonly [number, number], bpms: readonly [number, number], dt: number): SetMood {
  const [a, b] = gains, both = a > AUDIBLE && b > AUDIBLE, gap = Math.abs(bpms[0] - bpms[1]) / Math.max(1, bpms[0]);
  const quiet = a + b < 0.05 ? m.quiet + dt : 0;
  let rate: number, say: SetMood["say"];
  if (quiet > DEAD_AIR_S) { rate = -30; say = "dead air"; }
  else if (quiet > 0) { rate = 0; say = m.say; }
  else if (both && gap > CLASH) { rate = -25; say = "trainwreck"; }
  else if (a + b > HOT) { rate = -5; say = "too hot"; }
  else if (both && gap <= LOCK) { rate = 12; say = "locked in"; }
  else { rate = 5; say = "in the mix"; }
  return { mood: Math.max(0, Math.min(100, m.mood + rate * dt)), quiet, say };
}
