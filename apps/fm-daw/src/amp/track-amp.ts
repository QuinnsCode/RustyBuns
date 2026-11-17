// A track's Amp insert as the project keeps it: which Q Amp head and its knobs. The project and the world
// read it, so it imports nothing from the circuits; src/amp/insert.ts builds the rig from it on the audio thread.
import { num, obj, oneOf, type Of } from "@rustybuns/util/guard";

/** The heads in src/circuit/amps.ts `AMPS`, by id (a test keeps the two lists the same). */
export const AMP_IDS = ["brit", "lead", "triple", "clean"] as const;

const knob = (d: number) => num(0, 10, d);
/** The amp's knobs a track keeps, 0 to 10. There's no noise knob: a track's amp doesn't hiss while the track is quiet. */
export const TrackAmp = obj({
  amp: oneOf(AMP_IDS, "brit"),
  gain: knob(7), bass: knob(5), mid: knob(5), treble: knob(6), master: knob(5),
  /** The bias tremolo's, heard only on a head that has one (Q Clean T). */
  rate: knob(5), depth: knob(0),
});
export type TrackAmp = Of<typeof TrackAmp>;

/** The knobs a track shows, in panel order. */
export const AMP_KNOBS = ["gain", "bass", "mid", "treble", "master"] as const;
export const TREM_KNOBS = ["rate", "depth"] as const;
