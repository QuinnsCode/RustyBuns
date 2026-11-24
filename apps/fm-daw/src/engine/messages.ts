// The page <-> AudioWorklet protocol.
import type { Lane, Note } from "../project.ts";
import type { RecordedMove } from "./sequencer.ts";
import type { EqDoc, EqListen } from "./eq.ts";
import type { TrackAmp } from "../amp/track-amp.ts";
import type { PluginEvent } from "../plugin-track.ts";
import type { Channel, ShapeAt } from "../desk.ts";
import type { AmpSettings } from "../amp/messages.ts";
import type { DeckClip } from "../take.ts";

export type ToWorklet =
  | { t: "load"; params: number[]; notes: Note[][]; auto: Lane[][]; bpm: number; swing: number; loopBeats: number; audible: boolean[]; space: number; squash: number; eq: EqDoc; eqAuto: Lane[]; trackEq: EqDoc[]; eqLinear: boolean; amps: (TrackAmp | null)[]; plugins: boolean[]; voiceless: boolean[] }
  | { t: "param"; track: number; i: number; v: number }
  | { t: "notes"; track: number; notes: Note[] }
  | { t: "auto"; track: number; lanes: Lane[] }
  | { t: "audible"; mask: boolean[] }
  /** Tracks with no instrument: their notes reach no voice (src/project.ts `voiceless`). */
  | { t: "voiceless"; mask: boolean[] }
  | { t: "tempo"; bpm: number; swing: number; loopBeats: number }
  | { t: "space"; amount: number }
  | { t: "squash"; amount: number }
  /**
   * The sesh's desk beyond its tracks (src/mixer.ts `deskPlays`): each player's channel by their live-line number, every
   * solo worked out, and the aux 2 return: its fader, its mute and the gear cabled into it (null: nothing whole, silent).
   */
  | { t: "desk"; players: { peer: number; channel: Channel }[]; aux2: { gear: AmpSettings | null; fader: number; mute: boolean; eq?: EqDoc }; space?: EqDoc }
  /** Shape, the master EQ: every slot at once (it is small), and its automation. */
  | { t: "eq"; bands: EqDoc; lanes: Lane[] }
  /** A track's Shape, its EQ insert before the sum (not automated). */
  | { t: "trackEq"; track: number; bands: EqDoc }
  /** A track's Amp insert (src/amp/insert.ts), or null for none. */
  | { t: "amp"; track: number; amp: TrackAmp | null }
  /** A hosted plugin plays this track (src/engine/plugin-route.ts), or its FM voice again. */
  | { t: "plugin"; track: number; on: boolean }
  /**
   * A web effect runs on this track (src/ui/wam.ts): its FM sound leaves the sum for the worklet's second output, a
   * channel a track, and comes back through the effect on the page's plugin bus. Off: the sound stays in the sum.
   */
  | { t: "insert"; track: number; on: boolean }
  /** A plugin slider moved: on to the host in order with the notes. */
  | { t: "pluginParam"; track: number; id: number; v: number }
  /** A block of a plugin track's sound from the host, interleaved stereo at the context's rate; `ok` false: it failed. */
  | { t: "pluginBlock"; track: number; pcm: Float32Array; ok: boolean }
  /** Hear the input through the armed track's amp. Every `arm` turns it off, so the input starts muted. Not saved. */
  | { t: "monitor"; on: boolean }
  /** A held dot: hear only this range until null. Not saved, not bounced. */
  | { t: "eqListen"; band: EqListen | null }
  /** Shape in linear phase (true) or minimum phase. Linear holds the whole mix back by its latency. */
  | { t: "eqPhase"; linear: boolean }
  | { t: "master"; gain: number }
  | { t: "play"; countIn: number }
  | { t: "stop" }
  | { t: "rec"; on: boolean }
  | { t: "metro"; on: boolean }
  | { t: "latency"; seconds: number }
  | { t: "on"; track: number; midi: number; vel: number; rec?: boolean }
  | { t: "off"; track: number; midi: number }
  | { t: "panic" }
  /** Performance, not saved: pitch bend in semitones, and beat repeat (0 off). */
  | { t: "bend"; track: number; semis: number }
  | { t: "repeat"; beats: number }
  /** A Perform move of yours, sent beside the bend, repeat or param that makes the sound: recorded as automation while recording. */
  | { t: "move"; track: number; i: number; v: number; was: number }
  | { t: "engine"; kind: "ts" | "rust"; bytes?: ArrayBuffer }
  /** A track's clips to play (each its 16-bit sound decoded, at TAKE_RATE, and its window); none for no take. */
  | { t: "take"; track: number; clips: DeckClip[] }
  /** Record the input onto this track while recording (-1: no track). `inLatency`: seconds the input arrives late. */
  | { t: "arm"; track: number; inLatency: number }
  /** The shared clock (src/clock.ts): sound at context time `ctx` is heard on `beat`; null runs free again. */
  | { t: "grid"; ctx: number; beat: number | null }
  /** Someone else's note to sound on beat `at` (vel < 0: let it go then). */
  | { t: "due"; at: number; track: number; midi: number; vel: number }
  /** Someone else's bend (semitones) or stutter (beats, 0 off) to take hold on beat `at`, in order with their notes. */
  | { t: "dueBend"; at: number; track: number; semis: number }
  | { t: "dueRepeat"; at: number; beats: number }
  /** A slice of someone's guitar or plugin track (mono at TAKE_RATE) to play from beat `at`, into `track` (-1: straight in). */
  | { t: "sound"; peer: number; track: number; at: number; pcm: Float32Array }
  /** Their sound stopped (unplugged, left): drop what's buffered, into `track` or (none) every track. */
  | { t: "quiet"; peer: number; track?: number }
  /** The loudest anyone else's slices may be here, dBFS, through the jam room's per-person limiter (src/studio/limiter.ts); null: as they come. */
  | { t: "peerCeiling"; db: number | null }
  /**
   * Send plugin track `track`'s own sound to the sesh in stamped slices (`on`), or stop: this page's plugin plays it.
   * `web`: a plugin in the page (src/ui/wam.ts), whose sound is the track's channel of the fourth input.
   */
  | { t: "pluginSend"; track: number; on: boolean; web?: boolean }
  /** Send the input out in slices, each with the beat it was played on (`inLatency`: seconds the input comes in late). */
  | { t: "send"; on: boolean; inLatency: number }
  /**
   * Copy this channel's sound (a track's, a player's or a return's, after its Shape) to the third output, for the
   * spectrum on its Shape, while that Shape is open; the channel stays in the mix. Null (or the master): none.
   */
  | { t: "listen"; at: ShapeAt | null };

export type FromWorklet =
  | { t: "tick"; pos: number; abs: number; synced: boolean; late: number; playing: boolean; countIn: number; peakL: number; peakR: number; minGain: number; nans: number; ampMisses: number; pluginMisses: number }
  | { t: "rec"; track: number; note: Note }
  /** The master EQ as its automation plays it right now, sent when it changes (null: as saved). */
  | { t: "eqPlayed"; doc: EqDoc | null }
  /** More of a plugin track's sound, please, and the notes and slider moves since the last ask. */
  | { t: "pluginAsk"; track: number; frames: number; events: PluginEvent[] }
  | ({ t: "move" } & RecordedMove)
  | { t: "engine"; kind: "ts" | "rust"; error?: string }
  /** A pass of the input recorded on the armed track: mono at `rate`, starting where the player heard `beat`. */
  | { t: "taken"; track: number; beat: number; pcm: Float32Array; rate: number }
  /** A slice of the input to send (`track`: of that plugin track's sound instead): mono at `rate`, played on `beat` (abs, on the shared clock). */
  | { t: "sound"; beat: number; pcm: Float32Array; rate: number; track?: number };
