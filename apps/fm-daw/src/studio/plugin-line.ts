// A player's plugin track on the live line (#5266). The plugin (a CLAP the desktop app hosts, src/engine/plugins.ts)
// runs only where it is installed: every other page has the track in the project, keeps its FM voice quiet
// (src/engine/plugin-route.ts) and has nothing to play there. So the page that plays it sends its sound, the way a
// plugged-in guitar's goes: the audio thread cuts the track's own sound into SOUND_FRAMES slices stamped with the beat
// they're heard on, and PluginOut sends each as Opus (src/studio/opus.ts), or 16-bit PCM with no WebCodecs, after a
// `plugin` word on the line. FarSound is the other end, for guitars and plugin tracks alike: decoders per player and
// track, slices held for their beat and played through the remote line (`fm_remote_*`). No DOM: the tests drive both.
import { b64url } from "@rustybuns/util/bytes";
import { decodeTake, encodeTake } from "../take.ts";
import type { Live } from "../project.ts";
import type { ToWorklet } from "../engine/messages.ts";
import { Band } from "./band.ts";
import { OpusIn, OpusOut, type MakeDecoder, type MakeEncoder } from "./opus.ts";

/** One plugin track of yours going out: the audio thread's slices of it in, messages out to the live line. */
export class PluginOut {
  private opus: OpusOut | null;
  private stopped = false;

  /** `encoder` null: no WebCodecs, PCM. */
  constructor(readonly track: number, readonly name: string, private send: (e: Live) => void, bpm: () => number, encoder: MakeEncoder | null) {
    this.opus = encoder ? new OpusOut(encoder, send, bpm, () => (this.stopped ? null : track)) : null;
    this.hello();
  }

  /** Says which track your plugin voices: on starting, and again when someone comes in. */
  hello() { if (!this.stopped) this.send({ t: "plugin", track: this.track, name: this.name }); }

  /** A slice of the track's sound from the audio thread (mono at `rate`), heard here from `beat`. */
  slice(beat: number, pcm: Float32Array, rate: number) {
    if (this.stopped) return;
    const pcm16 = encodeTake(pcm, rate);
    if (this.opus && !this.opus.broken) this.opus.slice(beat, pcm16);
    else this.send(Band.slice(this.track, beat, pcm16, b64url));
  }

  /** The plugin stopped (or the track went): the far side drops what it holds of it. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.opus?.close();
    this.send({ t: "plugin", track: this.track, name: null });
  }
}

/**
 * Everyone else's sound coming in, for one page: slices of guitars and plugin tracks through the Opus decoders (or as
 * PCM) to the Band, held for their beat. A plugin track is heard from one player only (the first to say it voices it,
 * so two desktops with the plugin don't double it), and not at all on a page whose own plugin plays it (`mine`).
 * `heard` answers true for every event about sound, and its messages for the audio thread go to `send`.
 */
export class FarSound {
  /** peer -> track -> the plugin's name, in the order they said so. */
  private plugins = new Map<number, Map<number, string>>();
  /** peer -> the track their guitar is plugged into. */
  private guitars = new Map<number, number>();
  private opus: OpusIn | null = null;
  constructor(private band: Band, private send: (m: ToWorklet) => void, private mine: (track: number) => boolean = () => false) {}

  /** Opus decoding, once this page knows it has WebCodecs (without it, only PCM slices are heard). */
  decodeWith(make: MakeDecoder) {
    this.opus = new OpusIn(make, (peer, track, b, pcm) => { for (const m of this.band.sound(peer, track, b, pcm, this.isPlugin(peer, track))) this.send(m); });
  }

  /** Whether `track`'s slices from `peer` are a plugin's (heard even listening as it comes). */
  isPlugin(peer: number, track: number) { return this.plugins.get(peer)?.has(track) ?? false; }
  /** Who voices `track` with their own plugin, and which plugin, first first. */
  voicing(track: number): { peer: number; name: string }[] {
    return [...this.plugins].flatMap(([peer, m]) => { const name = m.get(track); return name === undefined ? [] : [{ peer, name }]; });
  }

  /** Everyone whose sound the live line plays right now (a guitar, a mic or a plugin track): each gets a channel on the desk. */
  players(): number[] { return [...new Set([...this.guitars.keys(), ...this.plugins.keys()])]; }

  /** Someone's live event: true when it was about sound (a slice, a guitar or plugin coming or going), handled here. */
  heard(from: number, e: Live): boolean {
    if (e.t === "sound") {
      const plugin = this.isPlugin(from, e.track);
      if (plugin && (this.mine(e.track) || this.voicing(e.track)[0]?.peer !== from)) return true;
      if (e.c === "opus") { if (this.band.hearsSlices(plugin)) this.opus?.hear(from, e); }
      else for (const m of this.band.sound(from, e.track, e.b, decodeTake([e.data]), plugin)) this.send(m);
      return true;
    }
    if (e.t === "guitar") {
      const was = this.guitars.get(from);
      if (was !== undefined && was !== e.track) this.stop(from, was);
      if (e.track === null) this.guitars.delete(from); else this.guitars.set(from, e.track);
      return true;
    }
    if (e.t !== "plugin") return false;
    let m = this.plugins.get(from);
    if (e.name !== null) {
      if (!m) this.plugins.set(from, (m = new Map()));
      m.set(e.track, e.name);
    } else if (m?.delete(e.track)) {
      if (!m.size) this.plugins.delete(from);
      this.stop(from, e.track);
    }
    return true;
  }

  /** They left: everything of theirs goes. */
  gone(from: number) {
    this.plugins.delete(from);
    this.guitars.delete(from);
    this.band.quiet(from);
    this.opus?.drop(from);
    this.send({ t: "quiet", peer: from });
  }

  /** Their sound into `track` stopped: what's held, decoding or buffered for it goes. */
  private stop(from: number, track: number) {
    this.band.quiet(from, track);
    this.opus?.drop(from, track);
    this.send({ t: "quiet", peer: from, track });
  }
}
