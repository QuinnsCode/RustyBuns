// The worklet's side of a plugin track (#5265). The plugin runs on the desktop host, in another process from the
// webview, so its sound can't share memory with the worklet: the host renders it a block at a time and the page
// carries each block in (src/ui/plugins.ts). This keeps two blocks queued or asked for, so a note is heard a block or
// two after it's played (512 frames is about 11 ms at 48 kHz), and the rest of the mix never waits on the host.
// Each note goes with the frame it was played on, so that wait is the same for every note (#5301).
//
// The sequencer and the live keys keep talking to an FmEngine; `wrap` hands them one where a plugin track's notes
// become events for the host instead of FM voices, so the track's FM synth stays silent and the plugin plays.
//
// The plugin's sound then goes down the track's strip as an FM voice's does (#5301): PAN, the track's own Shape,
// its fader, and its SEND to Space. The bounce (src/engine/offline.ts) plays a whole rendered track through `mix` too.
import type { FmEngine } from "./engine.ts";
import { TsEq, flatEq, type EqDoc } from "./eq.ts";
import { TRACKS } from "./params.ts";
import type { PluginEvent } from "../plugin-track.ts";

/** Frames the host renders per ask. */
export const PLUGIN_BLOCK = 512;
/** Frames kept queued or asked for: the latency a note on a plugin track has, on top of the output's. */
export const PLUGIN_AHEAD = 2 * PLUGIN_BLOCK;
/** How fast the level and pan follow their sliders, per sample (the engine's own gain smoothing), so a move doesn't click. */
const SMOOTH = 0.002;

/** An ask for more of a plugin track's sound, and the notes since the last one (each `at` its frame of this block). */
export interface PluginAsk { track: number; frames: number; events: PluginEvent[] }

/** A plugin track's strip, read once a block: its level (fader, mute and master: 0..1), PAN (-1..1) and SEND (0..1). */
export interface Strip { gain(t: number): number; pan(t: number): number; send(t: number): number }

interface Lane {
  /** Notes and slider moves not asked with yet; `at` is the route's clock when each was played. */
  events: PluginEvent[];
  /** The clock at the last ask: an event's place in the next block is how long after this it came. */
  mark: number;
  /** Blocks come in, interleaved stereo; `at` is how far into the first one has been played. */
  blocks: Float32Array[];
  at: number;
  queued: number;
  asked: number;
  /** Sequencer note id to the key it plays, so a note-off finds its key. */
  keys: Map<number, number>;
  /** Where the fader and the pan are now (level NaN: not heard yet, so the first block starts where they sit). */
  level: number;
  panL: number;
  panR: number;
  /** The track's Shape. */
  eq: TsEq;
  /** The host said the plugin failed: no more asks, silence until it's chosen again. */
  dead: boolean;
  /** A block has come: from then on an empty queue is a miss (before it, the plugin is still starting). */
  heard: boolean;
}

export class PluginRoute {
  private lanes: (Lane | null)[] = Array.from({ length: TRACKS }, () => null);
  private docs: EqDoc[] = Array.from({ length: TRACKS }, flatEq);
  private mono = new Float32Array(0);
  private dry = new Float64Array(0);
  /** Frames the wrapped engine has rendered: the clock notes are placed on. */
  private now = 0;
  /** Frames a plugin track had nothing queued for: the host fell behind. */
  misses = 0;

  constructor(private readonly sampleRate: number) {}

  get any() { return this.lanes.some((l) => l !== null); }
  has(t: number) { return !!this.lanes[t]; }

  /** A plugin on track `t` (or off): either way it starts clean, so a plugin chosen again gets another go. */
  set(t: number, on: boolean) {
    if (t < 0 || t >= TRACKS) return;
    const was = this.lanes[t];
    if (!on) { this.lanes[t] = null; return; }
    if (was && !was.dead) return;
    const eq = new TsEq(this.sampleRate);
    eq.set(this.docs[t]); eq.reset();
    this.lanes[t] = { events: [], mark: this.now, blocks: [], at: 0, queued: 0, asked: 0, keys: new Map(), level: NaN, panL: 1, panR: 1, eq, dead: false, heard: false };
  }

  /** Track `t`'s Shape: a plugin on it plays through this (the FM voice's is inside the engine). */
  shape(t: number, doc: EqDoc) {
    if (t < 0 || t >= TRACKS) return;
    this.docs[t] = doc;
    this.lanes[t]?.eq.set(doc);
  }

  /** A slider moved: it goes to the host with the next ask, in order with the notes. */
  param(t: number, id: number, v: number) { this.lanes[t]?.events.push({ t: "set", id, v, at: this.now }); }

  /** Every key a plugin track holds lets go (stop, panic). */
  allOff() {
    for (const l of this.lanes) {
      if (!l) continue;
      for (const key of new Set(l.keys.values())) l.events.push({ t: "off", key, at: this.now });
      l.keys.clear();
    }
  }

  /**
   * The engine the sequencer plays: a plugin track's notes go to its plugin, everything else on to `engine`.
   * `moved` hears every param the sequencer sets (a lane playing), so the strip follows a lane on Level, Pan or Send.
   */
  wrap(engine: FmEngine, moved?: (t: number, i: number, v: number) => void): FmEngine {
    return {
      setParam: (t, i, v) => { moved?.(t, i, v); engine.setParam(t, i, v); },
      setMute: (t, m) => engine.setMute(t, m),
      setMaster: (g) => engine.setMaster(g),
      setTempo: (b) => engine.setTempo(b),
      setBeat: (b) => engine.setBeat(b),
      setBend: (t, s) => engine.setBend(t, s),
      noteOn: (t, id, midi, vel) => {
        const l = this.lanes[t];
        if (!l) return engine.noteOn(t, id, midi, vel);
        l.keys.set(id, midi);
        l.events.push({ t: "on", key: midi, vel, at: this.now });
      },
      noteOff: (t, id) => {
        const l = this.lanes[t];
        if (!l) return engine.noteOff(t, id);
        const key = l.keys.get(id);
        if (key === undefined) return;
        l.keys.delete(id);
        // another id still holding the key (a live key over a sequenced one) keeps it sounding
        if (![...l.keys.values()].includes(key)) l.events.push({ t: "off", key, at: this.now });
      },
      allOff: () => { this.allOff(); engine.allOff(); },
      panic: () => { this.allOff(); engine.panic(); },
      click: (a) => engine.click(a),
      setTrackBand: (...a) => engine.setTrackBand(...a),
      setTap: (t, on) => engine.setTap(t, on),
      // the sequencer renders between its events (QUANTUM frames at a time), so the clock is where each one falls
      render: (out, frames, send, taps, send2) => { engine.render(out, frames, send, taps, send2); this.now += frames; },
      meter: (out) => engine.meter(out),
      free: () => engine.free?.(),
    };
  }

  /**
   * What to ask the host for now: each live plugin track below PLUGIN_AHEAD gets a block's worth, with its notes,
   * each on the frame of the block that is as long after the last ask as the note was.
   */
  asks(): PluginAsk[] {
    const out: PluginAsk[] = [];
    this.lanes.forEach((l, track) => {
      if (!l || l.dead) return;
      while (l.queued + l.asked < PLUGIN_AHEAD) {
        const from = l.mark;
        out.push({ track, frames: PLUGIN_BLOCK, events: l.events.map((e) => ({ ...e, at: Math.max(0, Math.min(PLUGIN_BLOCK - 1, (e.at ?? from) - from)) })) });
        l.events = [];
        l.mark = this.now;
        l.asked += PLUGIN_BLOCK;
      }
    });
    return out;
  }

  /** Track `t`'s notes not asked with yet, each `at` the frame it was played on since the route began (the bounce's score). */
  score(t: number): PluginEvent[] { return this.lanes[t]?.events ?? []; }

  /** A block came back (`ok` false: the plugin failed, and from then on the track is silent). */
  push(t: number, pcm: Float32Array, ok: boolean) {
    const l = this.lanes[t];
    if (!l) return;
    const frames = pcm.length >> 1;
    l.asked = Math.max(0, l.asked - PLUGIN_BLOCK);
    if (!ok) { l.dead = true; l.blocks = []; l.queued = 0; return; }
    if (frames) { l.blocks.push(pcm); l.queued += frames; l.heard = true; }
  }

  /**
   * Adds `frames` of each plugin track into `out` (interleaved stereo) down its strip: panned (a stereo plugin's two
   * sides are balanced on the engine's own pan law, and at centre it comes as it is), through the track's Shape, at
   * its level, and that times its SEND into `send`, the Space bus, when given.
   * `tap`, if given, also gets each track's own sound, mono and before its strip (the sesh hears it: src/studio/plugin-line.ts).
   */
  mix(out: Float32Array, frames: number, strip: Strip, send?: Float32Array, tap?: (t: number, mono: Float32Array, frames: number) => void) {
    if (tap && this.mono.length < frames) this.mono = new Float32Array(frames);
    if (this.dry.length < 2 * frames) this.dry = new Float64Array(2 * frames);
    const dry = this.dry;
    this.lanes.forEach((l, t) => {
      if (!l) return;
      const target = strip.gain(t), sa = strip.send(t), mono = tap ? this.mono.fill(0, 0, frames) : null;
      const angle = ((Math.max(-1, Math.min(1, strip.pan(t) || 0)) + 1) * Math.PI) / 4;
      const tl = Math.SQRT2 * Math.cos(angle), tr = Math.SQRT2 * Math.sin(angle);
      if (Number.isNaN(l.level)) { l.level = target; l.panL = tl; l.panR = tr; }
      let n = 0;
      for (; n < frames; n++) {
        const b = l.blocks[0];
        if (!b) { if (l.heard && !l.dead) this.misses += frames - n; break; }
        l.panL += (tl - l.panL) * SMOOTH;
        l.panR += (tr - l.panR) * SMOOTH;
        const x = b[l.at], y = b[l.at + 1];
        dry[2 * n] = x * l.panL;
        dry[2 * n + 1] = y * l.panR;
        if (mono) mono[n] = (x + y) / 2;
        l.at += 2;
        l.queued--;
        if (l.at >= b.length) { l.blocks.shift(); l.at = 0; }
      }
      if (n && l.eq.live()) l.eq.insert(dry, n);
      for (let f = 0; f < n; f++) {
        l.level += (target - l.level) * SMOOTH;
        const a = dry[2 * f] * l.level, c = dry[2 * f + 1] * l.level;
        out[2 * f] += a;
        out[2 * f + 1] += c;
        if (send) { send[2 * f] += a * sa; send[2 * f + 1] += c * sa; }
      }
      if (mono) tap?.(t, mono, frames);
    });
  }
}
