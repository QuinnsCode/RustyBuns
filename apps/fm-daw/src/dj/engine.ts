// The two QDJ decks in Web Audio, for music you load yourself (analyze.ts does the arithmetic; panel.ts draws it;
// mixer.ts is the Qone mixer they play into). Each deck's voice is a worklet (deck-worklet.ts) that plays the track
// where the deck's motion says (player.ts `Motion`): at the speed the tempo fader sets (range 6 to 100 per cent),
// tempo and pitch together as on a turntable, or with master tempo on at the track's own key (stretch.ts). Play and
// pause start and stop it like a turntable's motor and brake over the START and BRAKE knobs' times (0: at once). Then the
// cue button a media player has (stopped: it marks where you are; held: it plays from the mark; let go: back to the
// mark), four hot cues, loops on the beat grid, LOOP IN / OUT / RELOOP with the jog moving a loop's edge, beat jumps, a
// jog nudge and sync. Deck A plays into the mixer's channel 2 and deck B into 3; what the mixer's master puts out goes
// to your speakers (at the booth level) and to `stream` (a MediaStream: what the room hears of your set).
import { pick, readTempo, settle, type Tempo, type TempoFrom } from "./tags.ts";
import { beatPhase, detectGrid, inLoop, keyOf, loopAt, phaseJump, rangeFor, snap, syncRate, type Grid, type Key } from "./analyze.ts";
import { ADJUST_S, adjustLoop, BRAKE_MAX_S, MIN_LOOP_S, rampS, speedAt, START_MAX_S, travel, type Motion } from "./player.ts";
import deckWorkletUrl from "./deck-worklet.ts?worker&url";
import { DECK_CHANNEL, Mixer, type ChannelKnob } from "./mixer.ts";

export type Side = 0 | 1;
/** What a deck has on: the file's name, its sound (mono copy for the waveform and the beat finder), its grid and key, and where the grid came from (tags.ts). */
export interface Track { name: string; buffer: AudioBuffer; mono: Float32Array; grid: Grid | null; key: Key | null; from?: TempoFrom }
/** Where another deck is, for sync: its grid, its rate, whether it plays and where (it may be on someone else's machine). */
export interface Beside { grid: Grid | null; rate: number; playing: boolean; pos: number }

/** A deck's state for the panel and the harness. */
export interface DeckState {
  name: string | null; playing: boolean; pos: number; length: number; rate: number; pitch: number; range: number;
  bpm: number | null; grid: Grid | null; key: Key | null; cue: number; hot: (number | null)[]; loop: { start: number; end: number; beats: number } | null; synced: boolean;
  /** Master tempo on; the START and BRAKE knobs (0 to 1); LOOP IN waiting for an OUT; the loop edge the jog moves; how fast it turns now. */
  keylock: boolean; ramp: { start: number; brake: number }; loopIn: number | null; adjust: "in" | "out" | null; speed: number;
}

/** Deck voices' worklet (deck-worklet.ts), added once per audio context. */
const voices = new WeakMap<BaseAudioContext, Promise<void>>();
function deckModule(ctx: AudioContext): Promise<void> {
  let p = voices.get(ctx);
  if (!p) { p = ctx.audioWorklet.addModule(deckWorkletUrl); voices.set(ctx, p); }
  return p;
}

/** Which edge of a loop the jog moves while it's being adjusted. */
export type LoopEdge = "in" | "out";
type Loop = { start: number; end: number; beats: number };

class Deck {
  track: Track | null = null;
  playing = false;
  /** The tempo fader, -1 to 1 of `range` per cent. */
  pitch = 0;
  range = 8;
  /** Master tempo: the tempo moves and the key stays put (the pitch correction a club player calls MT). */
  keylock = false;
  /** The motor start and the brake, knobs 0 to 1 (0 is instant, as a CD player; up is a turntable's slow start and stop). */
  ramp = { start: 0, brake: 0 };
  cue = 0;
  hot: (number | null)[] = [null, null, null, null];
  loop: Loop | null = null;
  /** LOOP IN pressed, waiting for an OUT (seconds), or null. */
  loopIn: number | null = null;
  /** The last loop played, for RELOOP once it's been exited. */
  lastLoop: Loop | null = null;
  /** The loop edge the jog moves (IN or OUT pressed again while it loops), or null: the jog does what it always does. */
  adjust: LoopEdge | null = null;
  /** Held cue: playing from the mark until it's let go. */
  cueHeld = false;
  synced = false;
  private m: Motion = { from: 0, at: 0, r0: 0, r1: 0, T: 0 };
  private bend = 1;
  private node: AudioWorkletNode | null = null;
  constructor(private ctx: AudioContext, readonly into: AudioNode) {
    deckModule(ctx).then(() => {
      this.node = new AudioWorkletNode(ctx, "q-deck", { numberOfInputs: 0, outputChannelCount: [2] });
      this.node.connect(into);
      if (this.track) this.sendTrack();
      this.post();
    }).catch(() => { /* no worklet: the decks keep time, silently */ });
  }

  /** The speed the tempo fader and a nudge set (track seconds a second); the deck runs at it once it's up to speed. */
  rate() { return Math.max(0, (1 + (this.pitch * this.range) / 100) * this.bend); }
  /** How fast the deck turns now: up to `rate()` as the motor starts, down to 0 as it brakes. */
  speed() { return speedAt(this.m, this.ctx.currentTime - this.m.at); }
  /** Where the deck is now, seconds into its track; at the end of the track with no loop, it stops there. */
  pos(): number {
    if (!this.track) return 0;
    const len = this.track.buffer.duration, e = this.ctx.currentTime - this.m.at;
    const p = inLoop(this.m.from + travel(this.m, e), this.loop);
    if (p >= len && !this.loop && (this.m.r1 > 0 || speedAt(this.m, e) > 0)) {
      this.playing = false; this.m = { from: len, at: this.ctx.currentTime, r0: 0, r1: 0, T: 0 }; this.post();
      return len;
    }
    return Math.min(len, Math.max(0, p));
  }
  /** Seconds left of the motor start or the brake, 0 when the deck runs steady. */
  private rampLeft() { const e = this.ctx.currentTime - this.m.at; return this.m.T > 0 && e < this.m.T ? this.m.T - e : 0; }
  /** From here and now, head for speed `r1` over `T` seconds (0: at once). */
  private move(r1: number, T = 0) {
    const from = this.pos(), r0 = T > 0 ? this.speed() : r1;
    this.m = { from, at: this.ctx.currentTime, r0, r1, T: T > 0 ? T : 0 };
    this.post();
  }
  /** The fader or a nudge moved: the new speed now, or at the end of a start or brake already under way. */
  private aim() { this.move(this.playing ? this.rate() : 0, this.rampLeft()); }
  private post() {
    this.node?.port.postMessage({ motion: this.m, loop: this.loop ? { start: this.loop.start, end: this.loop.end } : null, keylock: this.keylock });
  }
  /** The track's sound to the voice: a copy, moved there (not copied again on the way). */
  private sendTrack() {
    const b = this.track?.buffer;
    if (!this.node) return;
    if (!b) { this.node.port.postMessage({ track: null }); return; }
    const chans = Array.from({ length: Math.min(2, b.numberOfChannels) }, (_, c) => b.getChannelData(c).slice());
    this.node.port.postMessage({ track: { chans, rate: b.sampleRate } }, chans.map((c) => c.buffer));
  }
  private beats(l: { start: number; end: number }) { const g = this.track?.grid; return g ? ((l.end - l.start) * g.bpm) / 60 : 0; }
  /** A loop point here: on the nearest beat with quantize on. */
  private point(pos: number, quantize: boolean) {
    const g = this.track?.grid;
    return quantize && g ? Math.max(0, snap(pos + 30 / g.bpm, g)) : pos;
  }

  load(t: Track) {
    this.track = t; this.playing = false; this.m = { from: 0, at: this.ctx.currentTime, r0: 0, r1: 0, T: 0 };
    this.cue = t.grid?.offset ?? 0; this.hot = [null, null, null, null]; this.loop = null; this.loopIn = null; this.lastLoop = null; this.adjust = null; this.synced = false;
    this.sendTrack(); this.post();
  }
  /** Take the track off (someone else loaded onto this deck in the booth). */
  unload() {
    this.track = null; this.playing = false; this.m = { from: 0, at: this.ctx.currentTime, r0: 0, r1: 0, T: 0 };
    this.cue = 0; this.loop = null; this.loopIn = null; this.lastLoop = null; this.adjust = null; this.synced = false; this.cueHeld = false;
    this.sendTrack(); this.post();
  }
  /** Play; `ramp`: as the motor starts, over the START knob's time (the play button's way; a cue or a scratch starts at once). */
  play(ramp = false) {
    if (!this.track || this.playing) return;
    this.playing = true;
    const r = this.rate(), T = ramp && r > 0 ? rampS(this.ramp.start, START_MAX_S) * (1 - Math.min(1, this.speed() / r)) : 0;
    this.move(r, T);
  }
  /** Pause; `ramp`: as a turntable brakes, over the BRAKE knob's time, the pitch falling with it. */
  pause(ramp = false) {
    if (!this.playing) { if (!ramp && this.speed() !== 0) this.move(0); return; }
    this.playing = false;
    const r = this.rate(), T = ramp && r > 0 ? rampS(this.ramp.brake, BRAKE_MAX_S) * Math.min(1, this.speed() / r) : 0;
    this.move(0, T);
  }
  /** Play / pause, with the motor start and brake; pressed while the cue is held, the deck plays on from there. */
  toggle() { if (this.cueHeld) { this.cueHeld = false; return; } if (this.playing) this.pause(true); else this.play(true); }
  seek(s: number) {
    if (!this.track) return;
    const from = Math.min(this.track.buffer.duration, Math.max(0, s)), left = this.rampLeft();
    if (this.loop && (from < this.loop.start || from > this.loop.end)) { this.loop = null; this.adjust = null; }
    this.m = { from, at: this.ctx.currentTime, r0: left ? this.speed() : this.m.r1, r1: this.m.r1, T: left };
    this.post();
  }
  /** The cue button pressed: playing, back to the mark and stop; stopped, mark here (on the beat) and play while held. */
  cueDown(quantize: boolean) {
    if (!this.track) return;
    if (this.playing && !this.cueHeld) { this.pause(); this.seek(this.cue); return; }
    if (!this.playing) {
      const here = this.pos();
      if (Math.abs(here - this.cue) > 0.01) this.cue = quantize && this.track.grid ? Math.max(0, snap(here + 0.02, this.track.grid)) : here;
      this.pause(); this.seek(this.cue);
      this.cueHeld = true;
      this.play();
    }
  }
  cueUp() { if (!this.cueHeld) return; this.cueHeld = false; this.pause(); this.seek(this.cue); }
  /** Hot cue `i`: set it here when empty, else jump to it (playing on if playing). */
  hotCue(i: number, quantize: boolean) {
    if (!this.track) return;
    const h = this.hot[i];
    if (h == null) { const p = this.pos(); this.hot[i] = quantize && this.track.grid ? Math.max(0, snap(p + 0.02, this.track.grid)) : p; return; }
    this.seek(h);
  }
  clearHot(i: number) { this.hot[i] = null; }
  setPitch(p: number) { this.pitch = Math.min(1, Math.max(-1, p)); this.synced = false; this.aim(); }
  /** The tempo range, per cent either way: the tempo stays where it is, the fader moves to it (or to its end). */
  setRange(r: number) { const keep = (this.pitch * this.range) / r; this.range = r; this.pitch = Math.min(1, Math.max(-1, keep)); this.aim(); }
  /** Master tempo on or off. */
  setKeylock(on: boolean) { this.keylock = on; this.post(); }
  /** The START or BRAKE knob, 0 to 1. */
  setRamp(which: "start" | "brake", v: number) { this.ramp[which] = Math.min(1, Math.max(0, v)); }
  /** The jog wheel: a push ahead or a drag back while it's held (1 lets go). */
  nudge(bend: number) { this.bend = bend; this.aim(); }
  /** A loop of `beats` from the beat here, or off when one is on and `beats` is null. */
  setLoop(beats: number | null) {
    if (!this.track) return;
    this.adjust = null; this.loopIn = null;
    if (beats === null || !this.track.grid) { if (this.loop) { this.aim(); this.lastLoop = this.loop; this.loop = null; this.post(); } return; }
    const pos = this.pos(), l = this.loop && this.loop.start <= pos ? { start: this.loop.start, end: this.loop.start + (beats * 60) / this.track.grid.bpm } : loopAt(pos, beats, this.track.grid);
    this.aim();
    this.loop = { ...l, beats }; this.lastLoop = this.loop;
    this.post();
    if (pos > l.end) this.seek(l.start);
  }
  /**
   * LOOP IN: marks where a loop starts (on the beat with quantize on). While a loop plays, it picks the loop's in point
   * for the jog to move instead (again: done).
   */
  loopInPress(quantize: boolean) {
    if (!this.track) return;
    if (this.loop) { this.adjust = this.adjust === "in" ? null : "in"; return; }
    this.loopIn = this.point(this.pos(), quantize);
  }
  /**
   * LOOP OUT: after an IN, the loop ends here and plays round from the IN. Pressed again while it loops, the jog moves
   * the out point: clockwise makes the loop longer, back makes it shorter; OUT once more (or RELOOP) is done.
   */
  loopOutPress(quantize: boolean) {
    if (!this.track) return;
    if (this.loop) { this.adjust = this.adjust === "out" ? null : "out"; return; }
    if (this.loopIn === null) return;
    const pos = this.pos(), start = this.loopIn;
    let end = this.point(pos, quantize);
    if (end - start < MIN_LOOP_S) end = pos;
    if (end - start < MIN_LOOP_S) return;
    this.aim();
    this.loop = { start, end, beats: this.beats({ start, end }) }; this.lastLoop = this.loop; this.loopIn = null;
    this.post();
    if (pos >= end) this.seek(start + (pos - end));
  }
  /** RELOOP / EXIT: looping, the deck plays on out of the loop; not, it jumps back into the last loop and loops it. */
  reloop() {
    if (!this.track) return;
    this.adjust = null;
    if (this.loop) { this.aim(); this.lastLoop = this.loop; this.loop = null; this.post(); return; }
    if (!this.lastLoop) return;
    const l = this.lastLoop;
    this.loop = l; this.loopIn = null;
    this.seek(l.start);
  }
  /** The jog turned `turns` (clockwise on) while a loop's edge is picked: that edge moves. */
  adjustTurn(turns: number) {
    const l = this.loop, t = this.track;
    if (!l || !t || !this.adjust || !turns) return;
    this.aim();
    const next = adjustLoop(l, this.adjust, turns * ADJUST_S, t.buffer.duration);
    this.loop = { ...next, beats: this.beats(next) }; this.lastLoop = this.loop;
    this.post();
    if (this.m.from >= next.end || this.m.from < next.start) this.seek(next.start);
  }
  /** Jump `beats` beats on (back when negative), on the grid. */
  jump(beats: number) { if (!this.track?.grid) return; this.seek(this.pos() + (beats * 60) / this.track.grid.bpm); }
  /** Match the other deck: its tempo now, and (both playing) its beat. */
  sync(other: Beside) {
    const g = this.track?.grid, og = other.grid;
    if (!g || !og) return false;
    let target = og.bpm * other.rate;
    // the same beat at double or half time is in step too: take the nearer
    for (const k of [2, 0.5]) if (Math.abs(target * k - g.bpm) < Math.abs(target - g.bpm)) target *= k;
    const p = (syncRate(g.bpm, target) - 1) * 100;
    if (Math.abs(p) > this.range) this.range = rangeFor(p);
    this.pitch = Math.min(1, Math.max(-1, p / this.range));
    this.aim();
    if (this.playing && other.playing) this.seek(this.pos() + phaseJump(this.pos(), g, beatPhase(other.pos, og)));
    this.synced = true;
    return true;
  }
  /** Beats played since the grid's first downbeat at audio time `t` (the LFO keeps to it); null when not running steady or no grid. */
  beatAt(t: number): number | null {
    const g = this.track?.grid;
    if (!g || !this.playing || this.rampLeft()) return null;
    return ((inLoop(this.m.from + travel(this.m, t - this.m.at), this.loop) - g.offset) * g.bpm) / 60;
  }
  state(): DeckState {
    const g = this.track?.grid ?? null;
    return {
      name: this.track?.name ?? null, playing: this.playing, pos: this.pos(), length: this.track?.buffer.duration ?? 0, rate: this.playing ? this.speed() : this.rate(), pitch: this.pitch, range: this.range,
      bpm: g ? Math.round(g.bpm * this.rate() * 10) / 10 : null, grid: g, key: this.track?.key ?? null, cue: this.cue, hot: [...this.hot], loop: this.loop, synced: this.synced,
      keylock: this.keylock, ramp: { ...this.ramp }, loopIn: this.loopIn, adjust: this.adjust, speed: this.speed(),
    };
  }
  stop() { this.playing = false; this.m = { from: this.pos(), at: this.ctx.currentTime, r0: 0, r1: 0, T: 0 }; this.post(); this.node?.disconnect(); }
}

/** The decks and the mixer (mixer.ts): deck A into channel 2, deck B into 3. `stream` is the master, for the room. */
export class Decks {
  readonly decks: [Deck, Deck];
  readonly mixer: Mixer;
  quantize = true;

  constructor(readonly ctx: AudioContext, speakers: AudioNode = ctx.destination) {
    this.mixer = new Mixer(ctx, speakers);
    this.decks = [new Deck(ctx, this.mixer.channels[DECK_CHANNEL[0]]!.input), new Deck(ctx, this.mixer.channels[DECK_CHANNEL[1]]!.input)];
    // each filter's LFO keeps to a deck's tempo and beat
    this.mixer.follow = (side) => {
      const d = this.decks[side], g = d.track?.grid;
      return g ? { bpm: g.bpm * d.rate(), beatAt: (t: number) => d.beatAt(t) } : null;
    };
  }
  get stream(): MediaStream { return this.mixer.stream; }
  get xfader(): number { return this.mixer.xfader; }

  /** Decode a file the DJ picked, find its beat, and put it on deck `side`. */
  async load(side: Side, name: string, bytes: ArrayBuffer, known?: Tempo | null): Promise<Track> {
    const t = await this.decode(name, bytes, known);
    this.decks[side].load(t);
    return t;
  }
  /** A track from samples already made (the demo tracks), mono at `rate`. */
  fromSamples(name: string, mono: Float32Array, rate: number): Track {
    const buffer = this.ctx.createBuffer(1, mono.length, rate);
    buffer.copyToChannel(Float32Array.from(mono), 0);
    const grid = detectGrid(mono, rate);
    return { name, buffer, mono, grid, key: keyOf(mono, rate), from: grid ? "ear" : undefined };
  }
  /** Decode a file and find its beat (from its tags or `known`, a dropped collection's, before listening), for the library. */
  async decode(name: string, bytes: ArrayBuffer, known?: Tempo | null): Promise<Track> {
    const told = pick(readTempo(new Uint8Array(bytes)), known); // before decoding, which takes the bytes
    const buffer = await this.ctx.decodeAudioData(bytes);
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i]! += d[i]! / buffer.numberOfChannels; }
    return { name, buffer, mono, ...settle(told, () => detectGrid(mono, buffer.sampleRate)), key: keyOf(mono, buffer.sampleRate) };
  }
  /** Put a track already decoded on a deck (the library's). */
  put(side: Side, t: Track) { this.decks[side].load(t); }

  /** Deck `side`'s own channel: a knob, its headphone cue. */
  knob(side: Side, k: ChannelKnob, v: number) { this.mixer.set(DECK_CHANNEL[side], k, v); }
  cue(side: Side, on: boolean) { this.mixer.cue(DECK_CHANNEL[side], on); }
  cross(x: number) { this.mixer.cross(x); }
  /** Sync deck `side` to the other deck here, or to `to` (the other deck, played on someone else's machine). */
  sync(side: Side, to?: Beside) {
    const o = this.decks[side === 0 ? 1 : 0];
    return this.decks[side].sync(to ?? { grid: o.track?.grid ?? null, rate: o.rate(), playing: o.playing, pos: o.pos() });
  }

  state() { return { decks: this.decks.map((d) => d.state()), quantize: this.quantize, ...this.mixer.state() }; }
  close() { for (const d of this.decks) d.stop(); }
}
