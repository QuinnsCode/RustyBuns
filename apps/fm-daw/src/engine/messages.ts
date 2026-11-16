// The page <-> AudioWorklet protocol.
import type { Lane, Note } from "../project.ts";
import type { RecordedMove } from "./sequencer.ts";
import type { EqDoc, EqListen } from "./eq.ts";

export type ToWorklet =
  | { t: "load"; params: number[]; notes: Note[][]; auto: Lane[][]; bpm: number; swing: number; loopBeats: number; audible: boolean[]; space: number; squash: number; eq: EqDoc; eqAuto: Lane[]; trackEq: EqDoc[]; eqLinear: boolean }
  | { t: "param"; track: number; i: number; v: number }
  | { t: "notes"; track: number; notes: Note[] }
  | { t: "auto"; track: number; lanes: Lane[] }
  | { t: "audible"; mask: boolean[] }
  | { t: "tempo"; bpm: number; swing: number; loopBeats: number }
  | { t: "space"; amount: number }
  | { t: "squash"; amount: number }
  /** Shape, the master EQ: every slot at once (it is small), and its automation. */
  | { t: "eq"; bands: EqDoc; lanes: Lane[] }
  /** A track's Shape, its EQ insert before the sum (not automated). */
  | { t: "trackEq"; track: number; bands: EqDoc }
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
  /** A track's take to play (16-bit sound decoded, at TAKE_RATE), or null for none. */
  | { t: "take"; track: number; pcm: Float32Array | null; beat: number }
  /** Record the input onto this track while recording (-1: no track). `inLatency`: seconds the input arrives late. */
  | { t: "arm"; track: number; inLatency: number };

export type FromWorklet =
  | { t: "tick"; pos: number; playing: boolean; countIn: number; peakL: number; peakR: number; minGain: number; nans: number }
  | { t: "rec"; track: number; note: Note }
  | ({ t: "move" } & RecordedMove)
  | { t: "engine"; kind: "ts" | "rust"; error?: string }
  /** A pass of the input recorded on the armed track: mono at `rate`, starting where the player heard `beat`. */
  | { t: "taken"; track: number; beat: number; pcm: Float32Array; rate: number };
