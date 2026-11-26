// What the amp page and its audio thread say to each other.
import type { Knobs } from "../circuit/amps.ts";
import type { Swaps } from "../circuit/circuits.ts";
import type { LoopSpec, Mic, Netlist, ScopeAt } from "@rustybuns/gear/circuit";

/** A pedal on a board: which (a PEDALS id, or "bench" with its netlist), its one knob, 0 to 10, and the player's part swaps. */
export interface BoardPedal { pedal: string; drive: number; bench?: Netlist; swaps?: Swaps }
/** Pedals one after another, or a split: its sides side by side (an empty side is dry), blended back by `mix`. */
export type BoardStep = BoardPedal | { split: BoardPedal[][]; mix: number[] };
/**
 * One slot on Q Amp's pedalboard, in the order the signal goes: a pedal (or a split), a machine, or the amp
 * itself. What comes after the amp is in its effects loop. A `stereo` machine makes two sides out of one.
 */
export type ChainSlot = BoardStep | { machine: LoopSpec; stereo?: boolean } | { amp: true };

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
  /** Pedals in series and in parallel ahead of the amp: when set, it plays in place of `pedal`, `bench`, `drive` and `swaps`. */
  board?: BoardStep[];
  /** The pedalboard, the amp one of its slots: when set, it plays in place of `pedal`, `bench`, `drive`, `swaps`, `loop` and `board`. */
  chain?: ChainSlot[];
  /** No amp: the pedal and the loop straight into a desk insert's return, at line level (no power stage, no cab). */
  direct?: boolean;
}

/**
 * Settings, and with `cuts` the rig split across threads there (ring.ts): `v` numbers them, so each part
 * plays a frame with the settings the part before it played it with. `rings` hands the threads their rings.
 */
export type ToAmp =
  | { t: "set"; settings: AmpSettings; v?: number; cuts?: number[] }
  | { t: "rings"; rings: SharedArrayBuffer[] | null }
  /** A scope on one link's net, numbered across the whole rig (`ScopeAt`), or none: the thread playing that link sends its volts back. */
  | { t: "scope"; at: ScopeAt | null };
/** A worker playing part `index` of a split rig (part-worker.ts): its rings first, then the same settings as the audio thread. */
export type ToPart = { t: "start"; rings: SharedArrayBuffer[]; index: number; sampleRate: number } | Extract<ToAmp, { t: "set" | "scope" }> | { t: "stop" };

export type FromAmp = {
  t: "meter";
  /** Each link's biggest swing in volts since the last report (pedal first if one is on, then each tube, then the tone stack). */
  levels: number[];
  /** Peak of what went to the speakers, 0 to 1. */
  out: number;
  /** Share of the audio thread's time budget the rig used, 0 to 1 (and more when it can't keep up). */
  load: number;
  /** With a `chain`: each slot's share of that budget, in chain order (the amp's includes its power stage and cab). */
  slots?: number[];
  misses: number;
  /** Each link's work since the last report, then the power stage's, loop's and cab's (`Rig.work`): what a split is cut by. */
  work?: number[];
  /** Blocks a split rig's last part didn't hand back in time. */
  late?: number;
  /** Which part of a split rig this thread plays (0, the audio thread, when left out). */
  part?: number;
  /** With a scope on a link this thread plays: its volts, one per output sample since the last report, oldest first. */
  scope?: number[];
};
