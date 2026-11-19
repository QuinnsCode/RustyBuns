// The jam room's half of the shared clock (src/clock.ts), with no DOM so the tests drive the page's own logic:
// pinging the leader (or, leading, answering), the beat to stamp a note with, where the audio thread's grid is,
// and what to do with someone else's note or slice of sound under this listener's mode.
import { Clock, DESK_MS, beatAt, playAt, type ClockClient, type ClockServer, type Listen } from "../clock.ts";
import type { Live } from "../project.ts";
import type { ToWorklet } from "../engine/messages.ts";

/** A slice of someone's sound waits on the page until this many seconds before its beat (the ring holds 2.7 s). */
export const HOLD_S = 1;

export class Band {
  readonly clock = new Clock();
  /** Slices waiting to go to the audio thread, oldest first. */
  private held: Extract<ToWorklet, { t: "sound" }>[] = [];
  /** `tempo` gives the sesh's bpm and loop length, `now` this page's clock (ms). */
  constructor(private tempo: () => { bpm: number; loopBeats: number }, private now: () => number) {}

  /** This page leads the sesh (or stopped leading): its own clock is everyone's. */
  leading(yes: boolean) { if (yes && this.clock.source !== "me") this.clock.lead(); else if (!yes && this.clock.source === "me") this.clock.source = null; }
  get leads() { return this.clock.source === "me"; }

  /** The next ping, or null when this page leads. */
  ping(): ClockClient | null { return this.leads ? null : { t: "tick", ...this.clock.ping(this.now()) }; }
  /** A clock message from the World: a ping to answer (leading), or an answer to ours. */
  onClock(m: ClockServer): ClockClient | null {
    if (m.t === "tick") return this.leads ? { t: "tock", to: m.from, n: m.n, sent: m.sent, at: this.now() } : null;
    this.clock.answer(m, this.now());
    return null;
  }
  /** Follow the estimate for the time since the last call (slowly while the groove plays). */
  step(playing: boolean) { this.clock.step(this.now(), playing); }

  get synced() { return this.clock.source !== null; }
  /** The beat heard here at `at` (this page's clock, default now): a note played now was played on it. */
  beat(at = this.now()) { return this.clock.heard(at, this.tempo().bpm); }
  /** A stamp for something you play now, or nothing before the clock is known. */
  stamp(): { b?: number } { return this.synced ? { b: this.beat() } : {}; }

  /** The audio thread's grid: sound at context time `ctx` reaches the speakers at `at` on this page's clock. */
  grid(ctx: number, at: number): ToWorklet { return { t: "grid", ctx, beat: this.synced ? this.beat(at) : null }; }

  set listen(l: Listen) { this.clock.listen = l; }
  get listen() { return this.clock.listen; }
  /** How far behind the band this listener hears, ms: a loop, the desk's delay, or nothing. */
  behind(): number { const { bpm, loopBeats } = this.tempo(); return this.listen === "loop" ? (loopBeats * 60000) / bpm : this.listen === "desk" ? DESK_MS : 0; }

  /** The beat this listener hears a stamped event on, or null: unstamped, no clock yet, or listening as it comes. */
  onBeat(e: Live): number | null {
    return "b" in e && e.b !== undefined && this.synced ? playAt(e.b, this.listen, this.tempo().loopBeats) : null;
  }

  /**
   * Someone else's live event, as messages for the audio thread: a stamped note, bend or stutter on the beat this
   * listener hears it on (so a bend lands on the note it bends); anything else (and everything when listening as it
   * comes) now. Slices of sound go through FarSound (src/studio/plugin-line.ts) to sound().
   */
  heard(from: number, e: Live): ToWorklet[] {
    const at = this.onBeat(e);
    if (e.t === "on") return [at === null ? { t: "on", track: e.track, midi: e.midi, vel: e.vel } : { t: "due", at, track: e.track, midi: e.midi, vel: e.vel }];
    if (e.t === "off") return [at === null ? { t: "off", track: e.track, midi: e.midi } : { t: "due", at, track: e.track, midi: e.midi, vel: -1 }];
    if (e.t === "bend") return [at === null ? { t: "bend", track: e.track, semis: e.semis } : { t: "dueBend", at, track: e.track, semis: e.semis }];
    // a stutter only on the shared beat: as it comes it would chop the groove wherever this page is
    if (e.t === "repeat") return at === null ? [] : [{ t: "dueRepeat", at, beats: e.beats }];
    return [];
  }

  /**
   * A slice of someone's sound (mono at TAKE_RATE) played from beat `b`: held until near the beat this listener hears it on.
   * As it comes, a guitar is the WebRTC call (src/guitar.ts); a plugin track has only its slices, so it plays the desk's delay behind.
   */
  sound(from: number, track: number, b: number, pcm: Float32Array, plugin = false): ToWorklet[] {
    const at = !this.synced ? null : plugin && this.listen === "now" ? b + beatAt(DESK_MS, this.tempo().bpm) : playAt(b, this.listen, this.tempo().loopBeats);
    if (at === null) return [];
    this.held.push({ t: "sound", peer: from, track, at, pcm });
    return this.due();
  }
  /** Whether a slice of a guitar's sound (`plugin`: of a plugin track's) would be heard here now, before the page spends a decode on it. */
  hearsSlices(plugin = false) { return this.synced && (plugin || this.listen !== "now"); }

  /** The held slices whose beat is under HOLD_S away, to send to the audio thread now. */
  due(): ToWorklet[] {
    const soon = this.beat() + (HOLD_S * this.tempo().bpm) / 60;
    const go = this.held.filter((s) => s.at < soon);
    this.held = this.held.filter((s) => s.at >= soon);
    return go;
  }
  /** They left (no track), or unplugged or stopped a plugin on `track`: their held sound there goes. */
  quiet(peer: number, track?: number) { this.held = this.held.filter((s) => s.peer !== peer || (track !== undefined && s.track !== track)); }
  get waiting() { return this.held.length; }

  /** The audio thread's slice of your input, as the live line carries it. */
  static slice(track: number, beat: number, pcm16: Int16Array, b64: (b: Uint8Array) => string): Live {
    return { t: "sound", track, b: beat, data: b64(new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)) };
  }
}

