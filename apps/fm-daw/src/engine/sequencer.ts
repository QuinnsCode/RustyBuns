// The sequencer: loops the pattern, swings it, counts in, clicks the metronome
// and records live notes and performance moves. It drives whichever FmEngine it's given, in the
// AudioWorklet (live) or in a plain loop (bounce, bench, golden test), so both
// engines hear exactly the same events.
//
// Timing is quantised to QUANTUM frames (1/3 ms at 48 kHz): events fire at
// the start of the sub-block they fall in. That keeps the event code simple
// and allocation-free; nobody hears a third of a millisecond.
import type { FmEngine } from "./engine.ts";
import { TRACKS, LANE_BEND, LANE_STUTTER } from "./params.ts";
import type { Lane, Note } from "../project.ts";

export const QUANTUM = 16;
const MAX_HELD = 256;
/** Live notes waiting for their beat (someone else's, heard a loop late or at the desk); past it the oldest go. */
const MAX_DUE = 512;
/**
 * Following the shared clock: further off than this many beats, the transport jumps to it (joining, a tempo change);
 * closer, it runs up to MAX_PULL fast or slow until it's there, so nobody hears it move.
 */
export const SNAP_BEATS = 0.25, MAX_PULL = 0.002, PULL = 0.5;
export const LIVE_ID = 2_000_000;
/** In place of a pitch on Sequencer.liveAt: a bend (the value is semitones) or a stutter (beats, 0 off), not a note. */
export const BEND = -1, REPEAT = -2;

export interface RecordedNote { track: number; note: Note }
/** The "track" a move on the master (Shape's dots) is recorded on: past the last real track. */
export const MASTER = TRACKS;
/** A performance move while recording: lane `i` went from `was` to `v` at beat `b`. */
export interface RecordedMove { track: number; i: number; b: number; v: number; was: number }

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
  /**
   * Beats counted from the shared clock's 0 (src/clock.ts) once `sync` has been called, else from Play: where the
   * stamps on live notes and sound are. `pos` is this within the loop. Runs whether the transport plays or not.
   */
  abs = 0;
  /** Following the shared clock: Play joins it where it is rather than starting the loop over. */
  synced = false;
  /** How fast the beats run against this sound card: 1, or a hair off while catching up with the shared clock. */
  rate = 1;
  // live notes, bends and stutters due on a beat (abs), in the order they came: beat, track, midi (BEND, REPEAT),
  // velocity (-1: a note off; a bend's semitones, a stutter's beats)
  private dueAt = new Float64Array(MAX_DUE);
  private dueTrack = new Int32Array(MAX_DUE);
  private dueMidi = new Int32Array(MAX_DUE);
  private dueVel = new Float64Array(MAX_DUE);
  private dueCount = 0;
  /**
   * Beat repeat: while > 0, the notes come from the slice of `repeat` beats it
   * was pressed in (on its grid), over and over. The transport runs on
   * underneath, so letting go lands where the song would have been, and a
   * recorded stutter plays back on the same beats.
   */
  private repeat = 0;
  private repFrom = 0;
  private notes: Note[][] = Array.from({ length: TRACKS }, () => []);
  private warped: Float64Array[] = Array.from({ length: TRACKS }, () => new Float64Array(0));
  private audible = new Uint8Array(TRACKS).fill(1);
  /** Tracks with no instrument: their notes run (and record) but reach no voice. */
  private voiceless = new Uint8Array(TRACKS);
  private lanes: AutoLane[][] = Array.from({ length: TRACKS }, () => []);
  /** Shape's lanes: each change goes to onEq, which the worklet and the bounce turn into the EQ they play. */
  private eqLanes: AutoLane[] = [];
  onEq: ((i: number, v: number) => void) | null = null;
  /** Lanes a player is moving while recording (track * 1024 + i): they don't play over the hand until the loop comes round. */
  private touched = new Set<number>();
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
  onMove: ((m: RecordedMove) => void) | null = null;

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
    this.lanes[track] = lanes.map(autoLane);
  }
  /** Shape's automation (sanitized); every lane is sent again on the next tick. */
  setEqAuto(lanes: Lane[]) { this.eqLanes = lanes.map(autoLane); }
  /** Forget what automation last sent (after an engine swap), so it's sent again. */
  resendAuto() { for (const ls of [...this.lanes, this.eqLanes]) for (const l of ls) l.last = NaN; }
  /**
   * A move on the Perform panel (bend, stutter, the pad's params), already
   * heard: while recording, it goes out to become automation on `track`.
   */
  move(track: number, i: number, v: number, was: number) {
    if (!this.recording || !this.playing || track < 0 || track > MASTER) return;
    this.touched.add(track * 1024 + i);
    this.onMove?.({ track, i, b: this.pos, v, was });
  }
  /** Recording stopped: every lane plays again. */
  untouch() { this.touched.clear(); }
  setSwing(s: number) { this.swing = s; for (let t = 0; t < TRACKS; t++) this.rewarp(t); }
  setLoopBeats(b: number) { this.loopBeats = b; this.pos = this.synced ? this.wrap(this.abs) : this.pos >= b ? this.pos % b : this.pos; }

  /**
   * The shared clock says this block's first frame is heard on `beat` (abs); NaN lets go of it. Stopped or far
   * off, the count jumps there; playing and close, it is pulled in gently.
   */
  sync(beat: number) {
    if (!Number.isFinite(beat)) { this.synced = false; this.rate = 1; return; }
    const err = beat - this.abs;
    if (!this.synced || !this.playing || Math.abs(err) > SNAP_BEATS) {
      this.abs = beat; this.rate = 1;
      this.pos = this.wrap(beat);
    } else this.rate = 1 + Math.max(-MAX_PULL, Math.min(MAX_PULL, err * PULL));
    this.synced = true;
  }

  /** Live bends as the hand left them, per track (an engine swap keeps them). */
  readonly bends = new Float64Array(TRACKS);
  liveBend(track: number, semis: number) {
    if (track < 0 || track >= TRACKS) return;
    this.bends[track] = semis; this.engine.setBend(track, semis);
  }

  /**
   * A live note (vel < 0: a note off) to sound on beat `at` (abs); one already past sounds now. `midi` BEND or
   * REPEAT: a bend of `vel` semitones or a stutter of `vel` beats instead, in order with the notes.
   */
  liveAt(at: number, track: number, midi: number, vel: number) {
    if (track < 0 || track >= TRACKS || midi < REPEAT || midi > 127 || !Number.isFinite(at)) return;
    if (this.dueCount === MAX_DUE) this.fireDue(Infinity, 1);
    const i = this.dueCount++;
    this.dueAt[i] = at; this.dueTrack[i] = track; this.dueMidi[i] = midi; this.dueVel[i] = vel;
  }
  /** How many live notes, bends and stutters wait for their beat. */
  get due() { return this.dueCount; }

  /** Live notes due before beat `b` (at most `max` of them, oldest first) sound now, as someone else's. */
  private fireDue(b: number, max = MAX_DUE) {
    let fired = 0;
    for (let i = 0; i < this.dueCount; ) {
      if (fired < max && this.dueAt[i] < b) {
        if (this.dueMidi[i] === BEND) this.liveBend(this.dueTrack[i], this.dueVel[i]);
        else if (this.dueMidi[i] === REPEAT) this.setRepeat(this.dueVel[i]);
        else if (this.dueVel[i] < 0) this.liveOff(this.dueTrack[i], this.dueMidi[i]);
        else this.liveOn(this.dueTrack[i], this.dueMidi[i], this.dueVel[i], false);
        fired++;
        this.dueCount--;
        this.dueAt.copyWithin(i, i + 1, this.dueCount + 1); this.dueTrack.copyWithin(i, i + 1, this.dueCount + 1);
        this.dueMidi.copyWithin(i, i + 1, this.dueCount + 1); this.dueVel.copyWithin(i, i + 1, this.dueCount + 1);
      } else i++;
    }
  }
  setAudible(mask: boolean[]) {
    for (let t = 0; t < TRACKS; t++) {
      this.audible[t] = mask[t] ? 1 : 0;
      this.engine.setMute(t, !mask[t]);
    }
  }
  /** No instrument on these tracks: what they hold now lets go, and their notes from here on sound nowhere. */
  setVoiceless(mask: boolean[]) {
    for (let t = 0; t < TRACKS; t++) {
      const on = mask[t] ? 1 : 0;
      if (on && !this.voiceless[t]) this.letGo(t);
      this.voiceless[t] = on;
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
    // on the shared clock the loop is where the band is; alone it starts over
    if (!this.synced) { this.pos = 0; this.abs = 0; }
    this.countIn = countInBeats;
    this.playing = countInBeats <= 0;
    if (countInBeats > 0) this.engine.click(true);
  }
  stop() {
    this.playing = false;
    this.countIn = 0;
    this.releaseHeld();
    this.recStart.fill(NaN);
    this.touched.clear();
    // a recorded bend or stutter lets go with the transport, like a hand would
    for (let t = 0; t < TRACKS; t++) for (const l of this.lanes[t]) {
      if (l.i === LANE_BEND && l.last !== 0) this.engine.setBend(t, 0);
      else if (l.i === LANE_STUTTER && l.last > 0) this.setRepeat(0);
      l.last = NaN;
    }
  }

  /** Live input. Ids are per track+pitch, so a key can't release someone else's note. `rec` false: someone
   * else in the room played it, so it sounds here but goes into their take, not this one. */
  liveOn(track: number, midi: number, vel: number, rec = true) {
    if (track < 0 || track >= TRACKS || midi < 0 || midi > 127) return;
    const id = LIVE_ID + track * 128 + midi;
    this.engine.noteOff(track, id);
    if (!this.voiceless[track]) this.engine.noteOn(track, id, midi, vel);
    if (rec && this.recording && this.playing) {
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

  /** Track `t`'s sequenced notes that are sounding let go now. */
  private letGo(t: number) {
    let k = 0;
    for (let i = 0; i < this.heldCount; i++) {
      if (this.heldTrack[i] === t) { this.engine.noteOff(t, this.heldId[i]); continue; }
      this.heldTrack[k] = this.heldTrack[i]; this.heldId[k] = this.heldId[i]; this.heldLeft[k] = this.heldLeft[i]; k++;
    }
    this.heldCount = k;
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
  /** The engine's render in QUANTUM steps, events between; `taps` as FmEngine.render's (frames * TRACKS). */
  process(out: Float32Array, frames: number, send?: Float32Array, taps?: Float32Array, send2?: Float32Array) {
    this.engine.setTempo(this.bpm);
    for (let at = 0; at < frames; at += QUANTUM) {
      const n = Math.min(QUANTUM, frames - at);
      this.tick(n);
      this.engine.render(out.subarray(at * 2, (at + n) * 2), n, send?.subarray(at * 2, (at + n) * 2), taps?.subarray(at * TRACKS, (at + n) * TRACKS), send2?.subarray(at * 2, (at + n) * 2));
    }
  }

  private tick(n: number) {
    const bpf = (this.bpm / 60 / this.sr) * this.rate;
    const span = n * bpf;
    const a0 = this.abs;
    if (this.dueCount) this.fireDue(a0 + span);
    this.abs = a0 + span;
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
      if (this.countIn <= 0) { this.countIn = 0; this.playing = true; if (!this.synced) { this.pos = 0; this.abs = 0; } }
      else if (Math.ceil(this.countIn) < Math.ceil(before)) this.engine.click(false);
      if (!this.playing) return;
    }
    if (!this.playing) return;
    const L = this.loopBeats;
    const b0 = this.pos, b1 = b0 + span;
    for (let t = 0; t < TRACKS; t++) {
      const ls = this.lanes[t];
      for (let j = 0; j < ls.length; j++) {
        const l = ls[j];
        if (this.touched.size && this.touched.has(t * 1024 + l.i)) continue;
        const v = laneAt(l.b, l.v, b0);
        if (v === l.last) continue;
        l.last = v;
        if (l.i === LANE_BEND) this.engine.setBend(t, v);
        else if (l.i === LANE_STUTTER) this.setRepeat(v);
        else this.engine.setParam(t, l.i, v);
      }
    }
    for (const l of this.eqLanes) {
      if (this.touched.size && this.touched.has(MASTER * 1024 + l.i)) continue;
      const v = laneAt(l.b, l.v, b0);
      if (v === l.last) continue;
      l.last = v;
      this.onEq?.(l.i, v);
    }
    if (this.metronome || this.recording) {
      const beat = Math.ceil(b0);
      if (beat < b1) this.engine.click((beat % L) % 4 === 0);
    }
    if (this.repeat > 0) {
      // where the slice is up to (synced LFOs follow it, so the wobble repeats too)
      const r0 = this.repFrom + ((((b0 - this.repFrom) % this.repeat) + this.repeat) % this.repeat);
      const end = this.repFrom + this.repeat;
      this.engine.setBeat(r0);
      if (r0 + span > end) {
        this.fireRange(r0, end, bpf);
        this.fireRange(this.repFrom, this.repFrom + Math.min(r0 + span - end, this.repeat), bpf);
      } else this.fireRange(r0, r0 + span, bpf);
    } else {
      this.engine.setBeat(b0);
      this.fireRange(b0, b1, bpf);
    }
    if (b1 >= L) { this.pos = b1 - L; this.touched.clear(); } else this.pos = b1;
    if (this.synced) this.pos = this.wrap(this.abs);
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
    if (this.voiceless[t]) return;
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
interface AutoLane { i: number; b: Float64Array; v: Float64Array; last: number }
const autoLane = (l: Lane): AutoLane => ({ i: l.i, b: Float64Array.from(l.pts, (p) => p[0]), v: Float64Array.from(l.pts, (p) => p[1]), last: NaN });

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
  /**
   * Runs on each block once it's rendered, before the next: Shape, so its automation lands in time. With
   * `tapping`, the block's taps (FmEngine.render's) come too, for the tracks' Amp inserts.
   */
  post?: (block: Float32Array, frames: number, taps?: Float32Array) => void,
  tapping = false,
  /** The desk's aux 2 bus, as `send`. */
  send2?: Float32Array,
): Float32Array {
  const seq = new Sequencer(engine, sampleRate);
  setup(seq);
  seq.play();
  const frames = Math.round(seconds * sampleRate);
  const out = new Float32Array(frames * 2);
  const BLOCK = 128;
  const taps = tapping ? new Float32Array(BLOCK * TRACKS) : undefined;
  for (let at = 0; at < frames; at += BLOCK) {
    const n = Math.min(BLOCK, frames - at);
    seq.process(out.subarray(at * 2, (at + n) * 2), n, send?.subarray(at * 2, (at + n) * 2), taps, send2?.subarray(at * 2, (at + n) * 2));
    post?.(out.subarray(at * 2, (at + n) * 2), n, taps);
  }
  return out;
}
