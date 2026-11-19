// A track's Amp insert on FM DAW's audio thread: the track's synth voices (the engine's tap, after the track's
// Shape), its take, and the guitar coming in live when the track is armed and Monitor is on, through one of Q Amp's heads (src/amp/live.ts builds and turns it),
// out to both sides at line level through the amp's own limiter. The bounce plays it the same way.
import { applySettings, limit, type Live } from "./live.ts";
import { guitarSettings } from "../guitar.ts";
import type { TrackAmp } from "./track-amp.ts";
import type { TakeDeck } from "../take.ts";
import { TRACKS } from "../engine/params.ts";

/** Quieter than this the whole block, a track's synth gives its amp nothing to play. */
const HUSH = 1e-6;

/** The live input heading into a track's amp this block: mono samples, and which track. */
export interface LiveIn { track: number; input: Float32Array }
/** Someone else's guitar coming in on its beat (src/engine/remote.ts), bound for a track's amp. */
export interface RemoteIn { has(track: number): boolean; add(track: number, dry: Float32Array, frames: number): void }

export class AmpInserts {
  private live: (Live | null)[];
  private dry = new Float32Array(256);
  private wet = new Float32Array(256);
  constructor(tracks: number, private sampleRate: number) { this.live = Array.from({ length: tracks }, () => null); }

  /** A track's amp, or null to take it out. Knobs turn the rig in place; a new head builds a new one. */
  set(track: number, amp: TrackAmp | null) {
    if (track < 0 || track >= this.live.length) return;
    this.live[track] = amp ? applySettings(guitarSettings(amp), this.live[track], this.sampleRate) : null;
  }

  has(track: number) { return !!this.live[track]; }
  get any() { return this.live.some(Boolean); }
  /** Newton steps that didn't converge, every track's amp together (0 when the circuits keep up). */
  get misses() { return this.live.reduce((n, l) => n + (l?.rig.misses ?? 0), 0); }

  /**
   * Every audible track's take into interleaved stereo `out`, through its amp when it has one, plus the live
   * input and the track's synth (`synth`, the engine's taps: `[f * TRACKS + t]`, before master) through its
   * track's amp, and `remote`: the other players' guitars plugged into a track. An amp only runs while it has
   * something to play: a take while the transport runs, the input, a remote guitar, or its synth sounding. `gain` is the master's, as on a take without an amp.
   */
  mix(deck: TakeDeck, out: Float32Array, frames: number, pos: number, bpm: number, loopBeats: number, audible: (t: number) => boolean, gain: number, playing: boolean, input?: LiveIn, synth?: Float32Array, remote?: RemoteIn) {
    const n = TRACKS;
    if (playing && deck.any) deck.mix(out, frames, pos, bpm, loopBeats, (t) => audible(t) && !this.live[t], gain);
    if (this.dry.length < frames) { this.dry = new Float32Array(frames); this.wet = new Float32Array(frames); }
    for (let t = 0; t < this.live.length; t++) {
      const l = this.live[t];
      if (!l || !audible(t)) continue;
      const hear = input?.track === t, take = playing && deck.has(t), far = !!remote?.has(t);
      let voice = false;
      if (synth) for (let f = 0; f < frames && !voice; f++) voice = Math.abs(synth[f * n + t]) > HUSH;
      if (!hear && !take && !voice && !far) continue;
      const dry = this.dry, wet = this.wet;
      if (hear) dry.set(input.input.subarray(0, frames)); else dry.fill(0, 0, frames);
      if (take) deck.one(t, dry, frames, pos, bpm, loopBeats, 1);
      if (far && remote) remote.add(t, dry, frames);
      if (voice && synth) for (let f = 0; f < frames; f++) dry[f] += synth[f * n + t];
      l.rig.process(dry, wet, frames);
      for (let f = 0; f < frames; f++) {
        const y = limit(wet[f] / l.scale) * gain;
        out[f * 2] += y; out[f * 2 + 1] += y;
      }
    }
  }
}
