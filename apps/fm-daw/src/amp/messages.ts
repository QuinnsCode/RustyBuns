// What the amp page and its audio thread say to each other.
import type { Knobs } from "../circuit/amps.ts";
import type { Swaps } from "../circuit/circuits.ts";
import type { LoopSpec, Mic, Netlist } from "@rustybuns/gear/circuit";

/** The whole front panel, every time: the audio thread works out what changed. */
export interface AmpSettings {
  amp: string;
  /** The pedal switched on, or null. */
  pedal: string | null;
  /** The board on the bench, at its knobs' turn: played when `pedal` is "bench" (src/circuit/bench.ts). */
  bench?: Netlist;
  /** Its one knob (Drive, Rate, Treadle...), 0 to 10. */
  drive: number;
  /** The player's parts on that pedal's board (circuits.ts `Swaps`). */
  swaps: Swaps;
  knobs: Knobs;
  /** Where the mic sits on the cab. */
  mic: Mic;
  /** The dry input straight through, to compare. */
  bypass: boolean;
  /** Circuit samples per output sample: 4 sounds cleanest, 2 (Eco) costs half. */
  oversample: 2 | 4;
  /** The machines switched on in the effects loop, in order (none if left out). */
  loop?: LoopSpec[];
  /** No amp: the pedal and the loop straight into a desk insert's return, at line level (no power stage, no cab). */
  direct?: boolean;
}

export type ToAmp = { t: "set"; settings: AmpSettings };

export type FromAmp = {
  t: "meter";
  /** Each link's biggest swing in volts since the last report (pedal first if one is on, then each tube, then the tone stack). */
  levels: number[];
  /** Peak of what went to the speakers, 0 to 1. */
  out: number;
  /** Share of the audio thread's time budget the rig used, 0 to 1 (and more when it can't keep up). */
  load: number;
  misses: number;
};
