// What the amp page and its audio thread say to each other.
import type { Knobs } from "../circuit/amps.ts";
import type { Slot } from "./slots.ts";

/** The whole front panel and the board, every time: the audio thread works out what changed. */
export interface AmpSettings {
  amp: string;
  knobs: Knobs;
  /** The pedalboard in chain order, the amp's own slot among them: what comes after it is in the effects loop. */
  board: Slot[];
  /** The dry input straight through, to compare. */
  bypass: boolean;
  /** Circuit samples per output sample for what clips: 4 sounds cleanest, 2 (Eco) costs half. */
  oversample: 2 | 4;
}

export type ToAmp = { t: "set"; settings: AmpSettings };

export type FromAmp = {
  t: "meter";
  /** Each preamp tube's biggest swing in volts since the last report. */
  levels: number[];
  /** Peak of what went to the speakers, 0 to 1. */
  out: number;
  /** Share of the audio thread's time budget the board used, 0 to 1 (and more when it can't keep up). */
  load: number;
  /** Each slot that ran, in chain order, and its share of the budget (the amp's slot counts its tubes, tone stack and power stage). */
  slots: { id: string; load: number }[];
  /** The chain ends in two channels (a stereo effect is on). */
  stereo: boolean;
  /** The stages in order, as the audio thread built them. */
  chain: string;
  misses: number;
};
