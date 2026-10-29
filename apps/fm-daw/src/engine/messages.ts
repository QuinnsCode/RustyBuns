// The page <-> AudioWorklet protocol.
import type { Lane, Note } from "../project.ts";

export type ToWorklet =
  | { t: "load"; params: number[]; notes: Note[][]; auto: Lane[][]; bpm: number; swing: number; loopBeats: number; audible: boolean[]; space: number }
  | { t: "param"; track: number; i: number; v: number }
  | { t: "notes"; track: number; notes: Note[] }
  | { t: "audible"; mask: boolean[] }
  | { t: "tempo"; bpm: number; swing: number; loopBeats: number }
  | { t: "space"; amount: number }
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
  | { t: "engine"; kind: "ts" | "rust"; bytes?: ArrayBuffer };

export type FromWorklet =
  | { t: "tick"; pos: number; playing: boolean; countIn: number; peakL: number; peakR: number; minGain: number; nans: number }
  | { t: "rec"; track: number; note: Note }
  | { t: "engine"; kind: "ts" | "rust"; error?: string };
