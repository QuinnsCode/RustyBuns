// Rec in the jam room (#5295): one loop of a player's stamped slices (a friend's guitar or mic, or yours) as a take
// on a track, the way the sesh page's Input + Rec lays your own input down (src/take.ts). Every plugged-in input
// already goes out as slices stamped with the beat it was played on (src/studio/opus.ts), so a take is those
// slices laid end to end from the bar Rec starts on: where each lands is its stamp, not when it got here, so a
// friend across an ocean lands on the beat like your own. No DOM: the page feeds it and the tests drive it.
import { MAX_TAKE_FRAMES, MAX_TAKES, TAKE_RATE, clipsOf, encodeTake, newTakeId, soundIds, toChunks, type TakeBytes, type TakeRef } from "../take.ts";
import { BEATS_PER_BAR, loopBeats, type Project } from "../project.ts";
import type { Tap } from "./plugin-line.ts";

/**
 * The track a player's input lands on: `pick` when the leader names one, else the track they're plugged into, else
 * (a mic from the booth, or a guitar with no amp: straight in, -1) the first track with no take. A string says why none.
 */
export function takeTrack(p: Project, plugged: number, pick?: number): number | string {
  const track = pick ?? (plugged >= 0 ? plugged : p.tracks.findIndex((t) => !clipsOf(t).length));
  if (!p.tracks[track]) return pick === undefined ? "Every track has a take: take one off in the sesh first" : "No such track";
  if (soundIds({ tracks: p.tracks.filter((_, i) => i !== track) }).size >= MAX_TAKES) return `The sesh holds ${MAX_TAKES} takes at most`;
  return track;
}

/** One loop of one player's input on the live line, from a bar on the shared clock. */
export class SliceRec implements Tap {
  readonly frames: number;
  private buf: Float32Array;
  private end = 0;
  /**
   * `peer` (0: you) sending on live-line track `line` (-1: straight in), recorded from beat `from` for `beats` at `bpm`
   * onto `track`.
   */
  constructor(readonly peer: number, readonly line: number, readonly track: number, readonly from: number, readonly beats: number, private bpm: number) {
    this.frames = Math.min(MAX_TAKE_FRAMES, Math.round(((beats * 60) / bpm) * TAKE_RATE));
    this.buf = new Float32Array(this.frames);
  }

  /** Rec starts on the next bar after `beat`, so the take's seam falls on one. */
  static nextBar(beat: number) { return Math.ceil(beat / BEATS_PER_BAR) * BEATS_PER_BAR; }

  wants(peer: number, line: number) { return peer === this.peer && line === this.line && !this.done; }
  /** A slice (mono at TAKE_RATE) someone played from beat `b`: kept if it's this player's and inside the loop. True once the loop is in. */
  add(peer: number, line: number, b: number, pcm: Float32Array): boolean {
    if (!this.wants(peer, line)) return this.done;
    const at = Math.round(((b - this.from) * 60 * TAKE_RATE) / this.bpm);
    const s = Math.max(0, -at), e = Math.min(pcm.length, this.frames - at);
    if (e > s) { this.buf.set(pcm.subarray(s, e), at + s); this.end = Math.max(this.end, at + e); }
    return this.done;
  }
  get done() { return this.end >= this.frames; }
  /** Whether nothing more can come: the loop and a whole loop after it (a listener a loop late) have gone by at `beat`. */
  stale(beat: number) { return beat > this.from + 2 * this.beats; }

  /** Where the take sits in a loop of `loopBeats`. */
  beatIn(loopBeats: number) { return ((this.from % loopBeats) + loopBeats) % loopBeats; }
  /** What came in, up to the last slice heard (null: none). */
  take(): Float32Array | null { return this.end ? this.buf.slice(0, this.end) : null; }
}

/** What the page does for Rec: the sesh as it is, the shared beat (null before the clock is known), and a take to land. */
export interface RecHost {
  project(): Project;
  beat(): number | null;
  /** Its chunks to the sesh, then the edit that puts it on `track`; `pcm` is what everyone will hear (the 16-bit copy). */
  land(track: number, take: TakeRef, chunks: TakeBytes[], pcm: Float32Array): void;
  /** A line for the room's hint: Rec started, a take landed, or why not. */
  say(text: string): void;
}

/**
 * The jam room's Rec: one take at a time, of one player's input. It lands by itself once a loop is in, or when it
 * is stopped, or when that player unplugs or goes quiet, and says what happened.
 */
export class Recorder implements Tap {
  rec: SliceRec | null = null;
  constructor(private host: RecHost) {}

  /** Record `peer` (0: you), whose input is on live-line track `line`, from the next bar; onto `pick` if the leader named one. */
  start(peer: number, line: number, who: string, pick?: number) {
    if (this.rec) return this.land();
    const beat = this.host.beat(), p = this.host.project();
    if (beat === null) return this.host.say("Rec waits for the shared clock");
    const track = takeTrack(p, line, pick);
    if (typeof track === "string") return this.host.say(track);
    this.rec = new SliceRec(peer, line, track, SliceRec.nextBar(beat), loopBeats(p), p.bpm);
    this.host.say(`Rec: ${who} onto ${p.tracks[track].name}, one loop from the next bar. R stops it early`);
  }

  wants(peer: number, line: number) { return !!this.rec?.wants(peer, line); }
  add(peer: number, line: number, b: number, pcm: Float32Array) { if (this.rec?.add(peer, line, b, pcm)) this.land(); }

  /** Their input came out (or they left): what came in lands. */
  unplugged(peer: number) { if (this.rec?.peer === peer) this.land(); }
  /** Called now and then: a take nothing more can reach lands with what it has. */
  tick() { const b = this.host.beat(); if (this.rec && b !== null && this.rec.stale(b)) this.land(); }

  state() { const r = this.rec; return r && { peer: r.peer, line: r.line, track: r.track, from: r.from, frames: r.frames }; }

  /** R again, or the loop is in: what came in lands now. */
  land() {
    const r = this.rec;
    this.rec = null;
    const pcm = r?.take(), p = this.host.project();
    if (!r || !pcm) return this.host.say("Rec: nothing came in, no take");
    const s16 = encodeTake(pcm, TAKE_RATE), id = newTakeId();
    this.host.land(r.track, { id, beat: r.beatIn(loopBeats(p)), frames: s16.length }, toChunks(id, s16), Float32Array.from(s16, (v) => v / 32767));
    this.host.say(`A take on ${p.tracks[r.track]?.name ?? "the track"}, ${(s16.length / TAKE_RATE).toFixed(1)} s`);
  }
}
