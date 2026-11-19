// The worklet's side of a plugin track (#5265). The plugin runs on the desktop host, in another process from the
// webview, so its sound can't share memory with the worklet: the host renders it a block at a time and the page
// carries each block in (src/ui/plugins.ts). This keeps two blocks queued or asked for, so a note is heard a block or
// two after it's played (512 frames is about 11 ms at 48 kHz), and the rest of the mix never waits on the host.
//
// The sequencer and the live keys keep talking to an FmEngine; `wrap` hands them one where a plugin track's notes
// become events for the host instead of FM voices, so the track's FM synth stays silent and the plugin plays.
import type { FmEngine } from "./engine.ts";
import { TRACKS } from "./params.ts";
import type { PluginEvent } from "../plugin-track.ts";

/** Frames the host renders per ask. */
export const PLUGIN_BLOCK = 512;
/** Frames kept queued or asked for: the latency a note on a plugin track has, on top of the output's. */
export const PLUGIN_AHEAD = 2 * PLUGIN_BLOCK;
/** How fast the level follows the fader, per sample (the engine's own gain smoothing), so a move doesn't click. */
const SMOOTH = 0.002;

/** An ask for more of a plugin track's sound, and the notes since the last one. */
export interface PluginAsk { track: number; frames: number; events: PluginEvent[] }

interface Lane {
  events: PluginEvent[];
  /** Blocks come in, interleaved stereo; `at` is how far into the first one has been played. */
  blocks: Float32Array[];
  at: number;
  queued: number;
  asked: number;
  /** Sequencer note id to the key it plays, so a note-off finds its key. */
  keys: Map<number, number>;
  level: number;
  /** The host said the plugin failed: no more asks, silence until it's chosen again. */
  dead: boolean;
  /** A block has come: from then on an empty queue is a miss (before it, the plugin is still starting). */
  heard: boolean;
}
const lane = (): Lane => ({ events: [], blocks: [], at: 0, queued: 0, asked: 0, keys: new Map(), level: 0, dead: false, heard: false });

export class PluginRoute {
  private lanes: (Lane | null)[] = Array.from({ length: TRACKS }, () => null);
  /** Frames a plugin track had nothing queued for: the host fell behind. */
  misses = 0;

  get any() { return this.lanes.some((l) => l !== null); }
  has(t: number) { return !!this.lanes[t]; }

  /** A plugin on track `t` (or off): either way it starts clean, so a plugin chosen again gets another go. */
  set(t: number, on: boolean) {
    if (t < 0 || t >= TRACKS) return;
    const was = this.lanes[t];
    if (!on) { this.lanes[t] = null; return; }
    if (was && !was.dead) return;
    this.lanes[t] = lane();
  }

  /** A slider moved: it goes to the host with the next ask, in order with the notes. */
  param(t: number, id: number, v: number) { this.lanes[t]?.events.push({ t: "set", id, v }); }

  /** Every key a plugin track holds lets go (stop, panic). */
  allOff() {
    for (const l of this.lanes) {
      if (!l) continue;
      for (const key of new Set(l.keys.values())) l.events.push({ t: "off", key });
      l.keys.clear();
    }
  }

  /** The engine the sequencer plays: a plugin track's notes go to its plugin, everything else on to `engine`. */
  wrap(engine: FmEngine): FmEngine {
    return {
      setParam: (t, i, v) => engine.setParam(t, i, v),
      setMute: (t, m) => engine.setMute(t, m),
      setMaster: (g) => engine.setMaster(g),
      setTempo: (b) => engine.setTempo(b),
      setBeat: (b) => engine.setBeat(b),
      setBend: (t, s) => engine.setBend(t, s),
      noteOn: (t, id, midi, vel) => {
        const l = this.lanes[t];
        if (!l) return engine.noteOn(t, id, midi, vel);
        l.keys.set(id, midi);
        l.events.push({ t: "on", key: midi, vel });
      },
      noteOff: (t, id) => {
        const l = this.lanes[t];
        if (!l) return engine.noteOff(t, id);
        const key = l.keys.get(id);
        if (key === undefined) return;
        l.keys.delete(id);
        // another id still holding the key (a live key over a sequenced one) keeps it sounding
        if (![...l.keys.values()].includes(key)) l.events.push({ t: "off", key });
      },
      allOff: () => { this.allOff(); engine.allOff(); },
      panic: () => { this.allOff(); engine.panic(); },
      click: (a) => engine.click(a),
      setTrackBand: (...a) => engine.setTrackBand(...a),
      setTap: (t, on) => engine.setTap(t, on),
      render: (out, frames, send, taps) => engine.render(out, frames, send, taps),
      meter: (out) => engine.meter(out),
      free: () => engine.free?.(),
    };
  }

  /** What to ask the host for now: each live plugin track below PLUGIN_AHEAD gets a block's worth, with its notes. */
  asks(): PluginAsk[] {
    const out: PluginAsk[] = [];
    this.lanes.forEach((l, track) => {
      if (!l || l.dead) return;
      while (l.queued + l.asked < PLUGIN_AHEAD) {
        out.push({ track, frames: PLUGIN_BLOCK, events: l.events });
        l.events = [];
        l.asked += PLUGIN_BLOCK;
      }
    });
    return out;
  }

  /** A block came back (`ok` false: the plugin failed, and from then on the track is silent). */
  push(t: number, pcm: Float32Array, ok: boolean) {
    const l = this.lanes[t];
    if (!l) return;
    const frames = pcm.length >> 1;
    l.asked = Math.max(0, l.asked - PLUGIN_BLOCK);
    if (!ok) { l.dead = true; l.blocks = []; l.queued = 0; return; }
    if (frames) { l.blocks.push(pcm); l.queued += frames; l.heard = true; }
  }

  /** Adds `frames` of each plugin track into `out` (interleaved stereo), at the level `gain(t)` says (0 when muted). */
  mix(out: Float32Array, frames: number, gain: (t: number) => number) {
    this.lanes.forEach((l, t) => {
      if (!l) return;
      const target = gain(t);
      for (let f = 0; f < frames; f++) {
        l.level += (target - l.level) * SMOOTH;
        const b = l.blocks[0];
        if (!b) { if (l.heard && !l.dead) this.misses += frames - f; break; }
        out[2 * f] += b[l.at] * l.level;
        out[2 * f + 1] += b[l.at + 1] * l.level;
        l.at += 2;
        l.queued--;
        if (l.at >= b.length) { l.blocks.shift(); l.at = 0; }
      }
    });
  }
}
