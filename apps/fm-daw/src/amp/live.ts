// The amp's live chain, apart from the audio thread so a test can play it:
// settings in, a board out (rebuilding only what changed), and the speaker limiter.
import { POWER_VOLTS } from "../circuit/rig.ts";
import { Board } from "./board.ts";
import { ampOf } from "./slots.ts";
import type { AmpSettings } from "./messages.ts";

/** Volts at the speaker for full scale: the power stage's ceiling plus the cabinet's bumps. */
export const FULL_SCALE = POWER_VOLTS * 1.5;
const CEILING = 0.89; // −1 dBFS

/** Under 0.7 untouched, then a soft knee that never passes −1 dBFS. NaN comes out as silence. */
export function limit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  const a = Math.abs(x);
  if (a <= 0.7) return x;
  return Math.sign(x) * (0.7 + (CEILING - 0.7) * Math.tanh((a - 0.7) / (CEILING - 0.7)));
}

/**
 * The board for these settings. A knob sets its link in place (a tone knob
 * rebuilds the tone stack's circuit, Drive the pedal's, a pot or the master is
 * just set); a pedal on or off, a reorder, another amp or another oversampling
 * builds a new chain that takes over every stage it still has, state and all.
 */
export function applySettings(s: AmpSettings, live: Board | null, sampleRate: number): Board {
  return new Board({ amp: ampOf(s.amp), knobs: s.knobs, slots: s.board, oversample: s.oversample }, sampleRate, live ?? undefined);
}
