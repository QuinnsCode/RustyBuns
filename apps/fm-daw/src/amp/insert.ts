// A track's Amp insert on FM DAW's audio thread: the track's take, and the guitar coming in live when the
// track is armed and Monitor is on, through one of Q Amp's heads (src/amp/live.ts builds and turns it),
// out to both sides at line level through the amp's own limiter. The bounce plays it the same way.
import { AMPS, DEFAULT_ROOM } from "../circuit/amps.ts";
import { applySettings, limit, type Live } from "./live.ts";
import type { AmpSettings } from "./messages.ts";
import type { TrackAmp } from "./track-amp.ts";
import type { TakeDeck } from "../take.ts";

/**
 * Circuit samples per output sample on a track. Q Amp's own page plays at 4; beside the synth engine, 2
 * (its Eco) costs half and keeps the tube stages clean enough (the rigs run 2.3 to 3.1x real time at 4).
 */
export const INSERT_OVERSAMPLE = 2;

/** Q Amp's settings for a track's amp: no pedal, the mic where the page starts it, no hiss while the track is quiet. */
export function insertSettings(a: TrackAmp): AmpSettings {
  const head = AMPS.find((x) => x.id === a.amp) ?? AMPS[0];
  const { gain, bass, mid, treble, master, rate, depth } = a;
  return {
    amp: head.id, pedal: null, drive: 0, swaps: {}, mic: DEFAULT_ROOM.mic, bypass: false, oversample: INSERT_OVERSAMPLE,
    knobs: { ...head.knobs, gain, bass, mid, treble, master, rate, depth, noise: 0 },
  };
}

/** The live input heading into a track's amp this block: mono samples, and which track. */
export interface LiveIn { track: number; input: Float32Array }

export class AmpInserts {
  private live: (Live | null)[];
  private dry = new Float32Array(256);
  private wet = new Float32Array(256);
  constructor(tracks: number, private sampleRate: number) { this.live = Array.from({ length: tracks }, () => null); }

  /** A track's amp, or null to take it out. Knobs turn the rig in place; a new head builds a new one. */
  set(track: number, amp: TrackAmp | null) {
    if (track < 0 || track >= this.live.length) return;
    this.live[track] = amp ? applySettings(insertSettings(amp), this.live[track], this.sampleRate) : null;
  }

  has(track: number) { return !!this.live[track]; }
  get any() { return this.live.some(Boolean); }
  /** Newton steps that didn't converge, every track's amp together (0 when the circuits keep up). */
  get misses() { return this.live.reduce((n, l) => n + (l?.rig.misses ?? 0), 0); }

  /**
   * Every audible track's take into interleaved stereo `out`, through its amp when it has one, plus the live
   * input through its track's amp. An amp only runs while it has something to play: a take while the
   * transport runs, or the input. `gain` is the master's, as on a take without an amp.
   */
  mix(deck: TakeDeck, out: Float32Array, frames: number, pos: number, bpm: number, loopBeats: number, audible: (t: number) => boolean, gain: number, playing: boolean, input?: LiveIn) {
    if (playing && deck.any) deck.mix(out, frames, pos, bpm, loopBeats, (t) => audible(t) && !this.live[t], gain);
    if (this.dry.length < frames) { this.dry = new Float32Array(frames); this.wet = new Float32Array(frames); }
    for (let t = 0; t < this.live.length; t++) {
      const l = this.live[t];
      if (!l || !audible(t)) continue;
      const hear = input?.track === t, take = playing && deck.has(t);
      if (!hear && !take) continue;
      const dry = this.dry, wet = this.wet;
      if (hear) dry.set(input.input.subarray(0, frames)); else dry.fill(0, 0, frames);
      if (take) deck.one(t, dry, frames, pos, bpm, loopBeats, 1);
      l.rig.process(dry, wet, frames);
      for (let f = 0; f < frames; f++) {
        const y = limit(wet[f] / l.scale) * gain;
        out[f * 2] += y; out[f * 2 + 1] += y;
      }
    }
  }
}
