// The round's audio cues, from the phase and the countdown: one beep per number,
// a high one for "CHOMP!", a fanfare at the podium. Pure, so a rematch (podium ->
// countdown) can be tested to beep each number exactly once.
import type { Phase } from "../engine/match.ts";
import { TICK_HZ } from "../sim/rules.ts";

export type Cue = "tick" | "go" | "fanfare";
export interface CueState { phase: Phase | ""; cd: number }
export const newCues = (): CueState => ({ phase: "", cd: -1 });

/** The cues this frame brings (usually none). Updates `st`. */
export function cuesFor(st: CueState, phase: Phase, countdownTicks: number): Cue[] {
  const out: Cue[] = [];
  if (phase === "countdown") {
    const cd = Math.ceil(countdownTicks / TICK_HZ);
    if (st.phase !== "countdown" || cd !== st.cd) out.push(cd > 0 ? "tick" : "go");
    st.cd = cd;
  } else {
    if (phase === "playing" && st.phase !== "playing" && st.cd !== 0) out.push("go");
    if (phase === "podium" && st.phase !== "podium") out.push("fanfare");
    st.cd = -1;
  }
  st.phase = phase;
  return out;
}
