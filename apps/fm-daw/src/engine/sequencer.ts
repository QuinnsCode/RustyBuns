// The sequencer: loops the pattern, swings it, counts in, clicks the metronome
// and records live notes. It drives whichever FmEngine it's given, in the
// AudioWorklet (live) or in a plain loop (bounce, bench, golden test), so both
// engines hear exactly the same events.
//
// Timing is quantised to QUANTUM frames (1/3 ms at 48 kHz): events fire at
// the start of the sub-block they fall in. That keeps the event code simple
// and allocation-free; nobody hears a third of a millisecond.
import type { FmEngine } from "./engine.ts";
import { TRACKS } from "./params.ts";
import type { Lane, Note } from "../project.ts";

export const QUANTUM = 16;
const MAX_HELD = 256;
export const LIVE_ID = 2_000_000;

export interface RecordedNote { track: number; note: Note }

/** Swing: within each eighth, the first 16th stretches and the second shrinks. */
export function swingWarp(beat: number, swing: number): number {
  const seg = Math.floor(beat * 2) / 2;
  const q = beat - seg;
  return seg + (q < 0.25 ? q * (1 + swing) : 0.25 * (1 + swing) + (q - 0.25) * (1 - swing));
}

export class Sequencer {
  engine: FmEngine;
  readonly sr: number;
  bpm = 120;
  swing = 0;
  loopBeats = 8;
  metronome = false;
  recording = false;
  /** Seconds between what the player hears and when we hear about their key. */
  latency = 0;
  playing = false;
  /** Beats of count-in left before the transport starts. */
  countIn = 0;
  /** Unswung position in the loop, beats. */
  pos = 0;
  /** Beat repeat: while > 0, the last `repeat` beats (from where it was pressed, on its grid) loop. */
  private repeat = 0;
  private repFrom = 0;
  private notes: Note[][] = Array.from({ length: TRACKS }, () => []);
  private warped: Float64Array[] = Array.from({ length: TRACKS }, () => new Float64Array(0));
  private audible = new Uint8Array(TRACKS).fill(1);
  private lanes: { i: number; b: Float64Array; v: Float64Array; last: number }[][] = Array.from({ length: TRACKS }, () => []);
  // sounding sequenced notes: track, id, frames left
  private heldTrack = new Int32Array(MAX_HELD);
  private heldId = new Int32Array(MAX_HELD);
  private heldLeft = new Float64Array(MAX_HELD);
  private heldCount = 0;
  private nextId = 1;
  // live notes being recorded: start beat per track*128+midi, NaN when not held
  private recStart = new Float64Array(TRACKS * 128).fill(NaN);
  private recVel = new Float64Array(TRACKS * 128);
  onRecord: ((r: RecordedNote) => void) | null = null;

  constructor(engine: FmEngine, sampleRate: number) {
    this.engine = engine;
    this.sr = sampleRate;
  }

  setNotes(track: number, notes: Note[]) {
    if (track < 0 || track >= TRACKS) return;
    // sorted by start (sanitized notes already are; stable, so ties keep their order),
    // so each tick finds its notes by binary search: long songs stay cheap
    this.notes[track] = notes.slice().sort((a, b) => a.s - b.s);
    this.rewarp(track);
  }
  /** Automation for a track (already sanitized: sorted, clamped). */
  setAuto(track: number, lanes: Lane[]) {
    if (track < 0 || track >= TRACKS) return;
    this.lanes[track] = lanes.map((l) => ({ i: l.i, b: Float64Array.from(l.pts, (p) => p[0]), v: Float64Array.from(l.pts, (p) => p[1]), last: NaN }));
  }
  /** Forget what automation last sent (after an engine swap), so it's sent again. */
  resendAuto() { for (const ls of this.lanes) for (const l of ls) l.last = NaN; }
  setSwing(s: number) { this.swing = s; for (let t = 0; t < TRACKS; t++) this.rewarp(t); }
  setLoopBeats(b: number) { this.loopBeats = b; if (this.pos >= b) this.pos %= b; }
  setAudible(mask: boolean[]) {
    for (let t = 0; t < TRACKS; t++) {
      this.audible[t] = mask[t] ? 1 : 0;
      this.engine.setMute(t, !mask[t]);
    }
  }
  private rewarp(t: number) {
    const ns = this.notes[t];
    const w = new Float64Array(ns.length);
    for (let i = 0; i < ns.length; i++) w[i] = swingWarp(ns[i].s, this.swing);
    this.warped[t] = w;
  }

  /** Stutter: loop the current slice of `beats` (1, 1/2, 1/4...) until called with 0. */
  setRepeat(beats: number) {
    if (!(beats > 0) || beats > this.loopBeats) { this.repeat = 0; return; }
    if (this.repeat === beats) return;
    this.repeat = beats;
    this.repFrom = Math.floor(this.pos / beats) * beats;
  }

  play(countInBeats = 0) {
    this.pos = 0;
    this.countIn = countInBeats;
    this.playing = countInBeats <= 0;
    if (countInBeats > 0) this.engine.click(true);
  }
  stop() {
    this.playing = false;
    this.countIn = 0;
    this.releaseHeld();
    this.recStart.fill(NaN);
  }

  /** Live input. Ids are per track+pitch, so a key can't release someone else's note. */
  liveOn(track: number, midi: number, vel: number) {
    if (track < 0 || track >= TRACKS || midi < 0 || midi > 127) return;
    const id = LIVE_ID + track * 128 + midi;
    this.engine.noteOff(track, id);
    this.engine.noteOn(track, id, midi, vel);
    if (this.recording && this.playing) {
      const k = track * 128 + midi;
      this.recStart[k] = this.wrap(this.pos - this.latency * (this.bpm / 60));
      this.recVel[k] = vel;
    }
  }
  liveOff(track: number, midi: number) {
    if (track < 0 || track >= TRACKS || midi < 0 || midi > 127) return;
    this.engine.noteOff(track, LIVE_ID + track * 128 + midi);
    const k = track * 128 + midi;
    const s = this.recStart[k];
    if (Number.isNaN(s)) return;
    this.recStart[k] = NaN;
    const end = this.wrap(this.pos - this.latency * (this.bpm / 60));
    let l = end - s;
    if (l <= 0) l += this.loopBeats;
    this.onRecord?.({ track, note: { s, l: Math.max(l, 1 / 64), m: midi, v: this.recVel[k] } });
  }

  private wrap(b: number) { const L = this.loopBeats; return ((b % L) + L) % L; }

  private releaseHeld() {
    for (let i = 0; i < this.heldCount; i++) this.engine.noteOff(this.heldTrack[i], this.heldId[i]);
    this.heldCount = 0;
  }

  private hold(track: number, id: number, frames: number) {
    if (this.heldCount === MAX_HELD) {
      // full: release the oldest rather than leave anything stuck
      this.engine.noteOff(this.heldTrack[0], this.heldId[0]);
      this.heldTrack.copyWithin(0, 1); this.heldId.copyWithin(0, 1); this.heldLeft.copyWithin(0, 1);
      this.heldCount--;
    }
    const i = this.heldCount++;
    this.heldTrack[i] = track; this.heldId[i] = id; this.heldLeft[i] = frames;
  }

  /** Render `frames` of interleaved stereo into out, firing events on the way. */
  process(out: Float32Array, frames: number, send?: Float32Array) {
    this.engine.setTempo(this.bpm);
    for (let at = 0; at < frames; at += QUANTUM) {
      const n = Math.min(QUANTUM, frames - at);
      this.tick(n);
      this.engine.render(out.subarray(at * 2, (at + n) * 2), n, send?.subarray(at * 2, (at + n) * 2));
    }
  }

  private tick(n: number) {
    const bpf = this.bpm / 60 / this.sr;
    const span = n * bpf;
    // sequenced note-offs
    for (let i = 0; i < this.heldCount; ) {
      this.heldLeft[i] -= n;
      if (this.heldLeft[i] <= 0) {
        this.engine.noteOff(this.heldTrack[i], this.heldId[i]);
        const last = --this.heldCount;
        this.heldTrack[i] = this.heldTrack[last]; this.heldId[i] = this.heldId[last]; this.heldLeft[i] = this.heldLeft[last];
      } else i++;
    }
    if (this.countIn > 0) {
      const before = this.countIn;
      this.countIn -= span;
      if (this.countIn <= 0) { this.countIn = 0; this.playing = true; this.pos = 0; }
      else if (Math.ceil(this.countIn) < Math.ceil(before)) this.engine.click(false);
      if (!this.playing) return;
    }
    if (!this.playing) return;
    this.engine.setBeat(this.pos);
    const L = this.loopBeats;
    const b0 = this.pos, b1 = b0 + span;
    for (let t = 0; t < TRACKS; t++) {
      const ls = this.lanes[t];
      for (let j = 0; j < ls.length; j++) {
        const l = ls[j], v = laneAt(l.b, l.v, b0);
        if (v !== l.last) { l.last = v; this.engine.setParam(t, l.i, v); }
      }
    }
    if (this.metronome || this.recording) {
      const beat = Math.ceil(b0);
      if (beat < b1) this.engine.click((beat % L) % 4 === 0);
    }
    const end = this.repFrom + this.repeat;
    if (this.repeat > 0 && b1 >= end) {
      // the stutter's slice ends inside this tick: play to its end, jump back, play the rest
      this.fireRange(b0, end, bpf);
      const rest = Math.min(b1 - end, this.repeat);
      this.fireRange(this.repFrom, this.repFrom + rest, bpf);
      this.pos = this.repFrom + rest;
      return;
    }
    this.fireRange(b0, b1, bpf);
    this.pos = b1 >= L ? b1 - L : b1;
  }

  private fireRange(b0: number, b1: number, bpf: number) {
    const L = this.loopBeats;
    for (let t = 0; t < TRACKS; t++) {
      if (!this.audible[t]) continue;
      const ns = this.notes[t], w = this.warped[t];
      for (let i = firstAtOrAfter(w, b0); i < ns.length && w[i] < b1; i++) this.fire(t, ns[i], bpf);
      if (b1 > L) for (let i = 0; i < ns.length && w[i] < b1 - L; i++) this.fire(t, ns[i], bpf);
    }
  }

  private fire(t: number, n: Note, bpf: number) {
    const id = this.nextId;
    this.nextId = this.nextId >= LIVE_ID - 1 ? 1 : this.nextId + 1;
    this.engine.noteOn(t, id, n.m, n.v);
    this.hold(t, id, Math.max(1, Math.round(n.l / bpf)));
  }
}

/** Index of the first value >= x in a sorted array (length if none). */
function firstAtOrAfter(a: Float64Array, x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

/** A lane's value at beat `b`: straight lines between points, held past the ends. */
export function laneAt(bs: Float64Array, vs: Float64Array, b: number): number {
  const n = bs.length;
  if (n === 0) return NaN;
  if (b < bs[0]) return vs[0];
  // the last point at or before b (binary search: lanes can be long)
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bs[mid] <= b) lo = mid; else hi = mid - 1; }
  const i = lo;
  if (i === n - 1) return vs[i];
  return vs[i] + (vs[i + 1] - vs[i]) * ((b - bs[i]) / (bs[i + 1] - bs[i]));
}

/** Offline: render `seconds` of a pattern. Bounce, bench and the golden test use this. */
export function renderPattern(
  engine: FmEngine,
  sampleRate: number,
  seconds: number,
  setup: (seq: Sequencer) => void,
  /** Filled with the Space send bus when given (same length as the result). */
  send?: Float32Array,
): Float32Array {
  const seq = new Sequencer(engine, sampleRate);
  setup(seq);
  seq.play();
  const frames = Math.round(seconds * sampleRate);
  const out = new Float32Array(frames * 2);
  const BLOCK = 128;
  for (let at = 0; at < frames; at += BLOCK) {
    const n = Math.min(BLOCK, frames - at);
    seq.process(out.subarray(at * 2, (at + n) * 2), n, send?.subarray(at * 2, (at + n) * 2));
  }
  return out;
}
