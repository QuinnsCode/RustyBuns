// Two decks in Web Audio, for music you load yourself (analyze.ts does the arithmetic; panel.ts draws it; mixer.ts is
// the four-channel mixer they play into). Each deck plays a decoded file at a rate the pitch fader sets (the tempo and
// the pitch move together, as on a turntable) with play and pause, the cue button a media player has (stopped: it marks
// where you are; held: it plays from the mark; let go: back to the mark), four hot cues, loops on the beat grid, beat
// jumps, a jog nudge and sync. Deck A plays into the mixer's channel 2 and deck B into 3; what the mixer's master puts
// out goes to your speakers (at the booth level) and to `stream` (a MediaStream: what the room hears of your set).
import { beatPhase, detectGrid, inLoop, keyOf, loopAt, phaseJump, snap, syncRate, type Grid, type Key } from "./analyze.ts";
import { DECK_CHANNEL, Mixer, type ChannelKnob } from "./mixer.ts";

export type Side = 0 | 1;
/** What a deck has on: the file's name, its sound (mono copy for the waveform and the beat finder), its grid and key. */
export interface Track { name: string; buffer: AudioBuffer; mono: Float32Array; grid: Grid | null; key: Key | null }
/** Where another deck is, for sync: its grid, its rate, whether it plays and where (it may be on someone else's machine). */
export interface Beside { grid: Grid | null; rate: number; playing: boolean; pos: number }

/** A deck's state for the panel and the harness. */
export interface DeckState {
  name: string | null; playing: boolean; pos: number; length: number; rate: number; pitch: number; range: number;
  bpm: number | null; grid: Grid | null; key: Key | null; cue: number; hot: (number | null)[]; loop: { start: number; end: number; beats: number } | null; synced: boolean;
}

class Deck {
  track: Track | null = null;
  playing = false;
  /** The pitch fader, -1 to 1 of `range` per cent. */
  pitch = 0;
  range = 8;
  cue = 0;
  hot: (number | null)[] = [null, null, null, null];
  loop: { start: number; end: number; beats: number } | null = null;
  /** Held cue: playing from the mark until it's let go. */
  cueHeld = false;
  synced = false;
  private src: AudioBufferSourceNode | null = null;
  /** Where the track was (seconds) at `at` on the context's clock, and the rate since. */
  private from = 0;
  private at = 0;
  private bend = 1;
  constructor(private ctx: AudioContext, readonly into: AudioNode) {}

  rate() { return (1 + (this.pitch * this.range) / 100) * this.bend; }
  /** Where the deck is now, seconds into its track. */
  pos(): number {
    if (!this.track) return 0;
    const raw = this.playing ? this.from + (this.ctx.currentTime - this.at) * this.rate() : this.from;
    const p = inLoop(raw, this.loop);
    return Math.min(this.track.buffer.duration, Math.max(0, p));
  }
  /** Rebase: the clock now, where it is now; then any change of rate counts from here. */
  private mark() { this.from = this.pos(); this.at = this.ctx.currentTime; }
  private start() {
    this.stopSrc();
    if (!this.track) return;
    const s = this.ctx.createBufferSource();
    s.buffer = this.track.buffer;
    s.playbackRate.value = this.rate();
    if (this.loop) { s.loop = true; s.loopStart = this.loop.start; s.loopEnd = this.loop.end; }
    s.connect(this.into);
    s.onended = () => { if (this.src === s && this.playing && !this.loop) { this.from = this.track?.buffer.duration ?? 0; this.playing = false; this.src = null; } };
    s.start(0, Math.min(this.from, this.track.buffer.duration));
    this.at = this.ctx.currentTime;
    this.src = s;
  }
  private stopSrc() { if (this.src) { this.src.onended = null; try { this.src.stop(); } catch { /* not started */ } this.src.disconnect(); this.src = null; } }

  load(t: Track) { this.stopSrc(); this.track = t; this.playing = false; this.from = 0; this.cue = t.grid?.offset ?? 0; this.hot = [null, null, null, null]; this.loop = null; this.synced = false; }
  /** Take the track off (someone else loaded onto this deck in the booth). */
  unload() { this.stopSrc(); this.track = null; this.playing = false; this.from = 0; this.cue = 0; this.loop = null; this.synced = false; this.cueHeld = false; }
  play() { if (!this.track || this.playing) return; this.playing = true; this.start(); }
  pause() { if (!this.playing) return; this.mark(); this.playing = false; this.stopSrc(); }
  /** Play / pause; pressed while the cue is held, the deck plays on from there (letting go of the cue no longer stops it). */
  toggle() { if (this.cueHeld) { this.cueHeld = false; return; } if (this.playing) this.pause(); else this.play(); }
  seek(s: number) {
    if (!this.track) return;
    this.from = Math.min(this.track.buffer.duration, Math.max(0, s));
    if (this.loop && (this.from < this.loop.start || this.from > this.loop.end)) this.loop = null;
    this.at = this.ctx.currentTime;
    if (this.playing) this.start();
  }
  /** The cue button pressed: playing, back to the mark and stop; stopped, mark here (on the beat) and play while held. */
  cueDown(quantize: boolean) {
    if (!this.track) return;
    if (this.playing && !this.cueHeld) { this.pause(); this.seek(this.cue); return; }
    if (!this.playing) {
      const here = this.pos();
      if (Math.abs(here - this.cue) > 0.01) this.cue = quantize && this.track.grid ? Math.max(0, snap(here + 0.02, this.track.grid)) : here;
      this.seek(this.cue);
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
  setPitch(p: number) { this.mark(); this.pitch = Math.min(1, Math.max(-1, p)); this.synced = false; this.applyRate(); }
  setRange(r: number) { this.mark(); const keep = (this.pitch * this.range) / r; this.range = r; this.pitch = Math.min(1, Math.max(-1, keep)); this.applyRate(); }
  /** The jog wheel: a push ahead or a drag back while it's held (1 lets go). */
  nudge(bend: number) { this.mark(); this.bend = bend; this.applyRate(); }
  private applyRate() { if (this.src) this.src.playbackRate.setTargetAtTime(this.rate(), this.ctx.currentTime, 0.005); }
  /** A loop of `beats` from the beat here, or off when one is on and `beats` is null. */
  setLoop(beats: number | null) {
    if (!this.track) return;
    if (beats === null || !this.track.grid) { if (this.loop) { this.mark(); this.loop = null; if (this.src) this.src.loop = false; } return; }
    const pos = this.pos(), l = this.loop && this.loop.start <= pos ? { start: this.loop.start, end: this.loop.start + (beats * 60) / this.track.grid.bpm } : loopAt(pos, beats, this.track.grid);
    this.mark();
    this.loop = { ...l, beats };
    if (this.src) { this.src.loop = true; this.src.loopStart = l.start; this.src.loopEnd = l.end; }
    if (this.from > l.end) this.seek(l.start);
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
    const r = syncRate(g.bpm, target);
    const p = (r - 1) * 100;
    if (Math.abs(p) > this.range) this.range = p > 50 || p < -50 ? 50 : Math.abs(p) > 16 ? 50 : Math.abs(p) > 8 ? 16 : 8;
    this.mark();
    this.pitch = Math.min(1, Math.max(-1, p / this.range));
    this.applyRate();
    if (this.playing && other.playing) this.seek(this.pos() + phaseJump(this.pos(), g, beatPhase(other.pos, og)));
    this.synced = true;
    return true;
  }
  state(): DeckState {
    const g = this.track?.grid ?? null;
    return {
      name: this.track?.name ?? null, playing: this.playing, pos: this.pos(), length: this.track?.buffer.duration ?? 0, rate: this.rate(), pitch: this.pitch, range: this.range,
      bpm: g ? Math.round(g.bpm * this.rate() * 10) / 10 : null, grid: g, key: this.track?.key ?? null, cue: this.cue, hot: [...this.hot], loop: this.loop, synced: this.synced,
    };
  }
  stop() { this.stopSrc(); this.playing = false; }
}

/** The decks and the mixer (mixer.ts): deck A into channel 2, deck B into 3. `stream` is the master, for the room. */
export class Decks {
  readonly decks: [Deck, Deck];
  readonly mixer: Mixer;
  quantize = true;

  constructor(readonly ctx: AudioContext, speakers: AudioNode = ctx.destination) {
    this.mixer = new Mixer(ctx, speakers);
    this.decks = [new Deck(ctx, this.mixer.channels[DECK_CHANNEL[0]]!.input), new Deck(ctx, this.mixer.channels[DECK_CHANNEL[1]]!.input)];
  }
  get stream(): MediaStream { return this.mixer.stream; }
  get xfader(): number { return this.mixer.xfader; }

  /** Decode a file the DJ picked, find its beat, and put it on deck `side`. */
  async load(side: Side, name: string, bytes: ArrayBuffer): Promise<Track> {
    const t = await this.decode(name, bytes);
    this.decks[side].load(t);
    return t;
  }
  /** A track from samples already made (the demo tracks), mono at `rate`. */
  fromSamples(name: string, mono: Float32Array, rate: number): Track {
    const buffer = this.ctx.createBuffer(1, mono.length, rate);
    buffer.copyToChannel(Float32Array.from(mono), 0);
    return { name, buffer, mono, grid: detectGrid(mono, rate), key: keyOf(mono, rate) };
  }
  /** Decode a file and find its beat, for the library. */
  async decode(name: string, bytes: ArrayBuffer): Promise<Track> {
    const buffer = await this.ctx.decodeAudioData(bytes);
    const mono = new Float32Array(buffer.length);
    for (let c = 0; c < buffer.numberOfChannels; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i]! += d[i]! / buffer.numberOfChannels; }
    return { name, buffer, mono, grid: detectGrid(mono, buffer.sampleRate), key: keyOf(mono, buffer.sampleRate) };
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
