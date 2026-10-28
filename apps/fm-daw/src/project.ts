// The project document and the ops that change it. Shared by the page (local
// state, undo), the world (persists and rebroadcasts) and the bounce. The world
// may face the internet on the edge, so everything that arrives is sanitized.
import { arr, Bad, bool, check, int, num, obj, oneOf, raw, str } from "@rustybuns/util/guard";
import { TRACKS, NPARAMS, clampParam } from "./engine/params.ts";

export interface Note { s: number; l: number; m: number; v: number } // start/length in beats, midi, velocity 0..1
/**
 * One automation lane: param `i` follows straight lines between points
 * ([beat, value]) across the loop; two points on one beat make a jump (a cut).
 * The sequencer applies it, so both engines hear the same thing.
 */
export interface Lane { i: number; pts: [number, number][] }
export interface TrackDoc {
  name: string;
  kind: "drum" | "synth";
  /** Drums: the note a step plays. Synths: where the keyboard's C sits. */
  root: number;
  params: number[];
  notes: Note[];
  auto?: Lane[];
  mute: boolean;
  solo: boolean;
}
/** space: the reverb and delay send after the engine, 0 dry to 1 drenched (src/engine/space.ts). */
export interface Project { v: 1; bpm: number; swing: number; space: number; bars: number; tracks: TrackDoc[] }

export type Op =
  | { t: "param"; track: number; i: number; v: number }
  | { t: "notes"; track: number; notes: Note[] }
  | { t: "track"; track: number; mute?: boolean; solo?: boolean; name?: string }
  | { t: "global"; bpm?: number; swing?: number; space?: number; bars?: number }
  | { t: "replace"; project: Project };

export const BEATS_PER_BAR = 4;
export const MAX_NOTES = 8192;
export const MAX_LANES = 16;
export const MAX_POINTS = 1024;
export const MAX_BARS = 512;
/** The loop-length buttons; a song can be any whole number of bars up to MAX_BARS. */
export const BAR_CHOICES = [1, 2, 4, 8, 16, 32] as const;
const BARS = int(1, MAX_BARS);
const okBars = (b: unknown): b is number => check(BARS, b) !== null;
export const loopBeats = (p: Project) => p.bars * BEATS_PER_BAR;

/** Notes past the loop's end are dropped; the rest of a note is made to fit. */
export function sanitizeNotes(x: unknown, beats: number): Note[] {
  const note = obj({ s: num(0, beats - 1e-6), l: num(1 / 64, beats, 0.25), m: int(0, 127, 60), v: num(0, 1, 0.8) });
  return arr(note, MAX_NOTES, { drop: true })(x).sort((a, b) => a.s - b.s || a.m - b.m);
}

export function sanitizeLanes(x: unknown, beats: number): Lane[] {
  const lane = (v: unknown): Lane => {
    const { i, pts } = obj({ i: int(0, NPARAMS - 1), pts: raw })(v);
    const point = (pt: unknown): [number, number] =>
      Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1]) ? [num(0, beats, 0)(pt[0]), clampParam(i, pt[1])] : bad("a point");
    const out = arr(point, MAX_POINTS, { drop: true })(pts).sort((a, b) => a[0] - b[0]);
    return out.length ? { i, pts: out } : bad("no points");
  };
  return arr(lane, MAX_LANES, { drop: true })(x);
}

const bad = (why: string): never => { throw new Bad(why); };
const PROJECT = obj({ tracks: arr(raw, TRACKS, { min: 1 }), bars: raw, bpm: num(40, 240, 120), swing: num(0, 0.6, 0), space: num(0, 1, 0) });

export function sanitize(x: unknown): Project | null {
  const p = check(PROJECT, x);
  if (!p) return null;
  const bars = okBars(p.bars) ? p.bars : 2, beats = bars * BEATS_PER_BAR;
  // older projects had fewer tracks: pad with silent synth tracks (gain 0)
  const tracks = [...p.tracks, ...Array.from({ length: TRACKS - p.tracks.length }, () => ({ kind: "synth" }))];
  return { v: 1, bpm: p.bpm, swing: p.swing, space: p.space, bars, tracks: tracks.map((v, ti) => track(v, ti, beats)) };
}

function track(v: unknown, ti: number, beats: number): TrackDoc {
  const t = obj({ name: str(24, { min: 0, dflt: `Track ${ti + 1}` }), kind: oneOf(["drum", "synth"], "drum"), root: int(0, 127, 60),
    params: arr(raw, NPARAMS, { drop: true }), notes: raw, auto: raw, mute: bool(false), solo: bool(false) })(typeof v === "object" && v ? v : {});
  return { ...t, params: Array.from({ length: NPARAMS }, (_, i) => clampParam(i, Number(t.params[i]))), notes: sanitizeNotes(t.notes, beats), auto: sanitizeLanes(t.auto, beats) };
}

/** Pure: returns a new project, or the same one if the op is invalid. */
export function apply(p: Project, op: Op): Project {
  const okTrack = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) < TRACKS;
  switch (op?.t) {
    case "param": {
      if (!okTrack(op.track) || !Number.isInteger(op.i) || op.i < 0 || op.i >= NPARAMS) return p;
      return withTrack(p, op.track, (t) => {
        const params = t.params.slice();
        params[op.i] = clampParam(op.i, op.v);
        return { ...t, params };
      });
    }
    case "notes":
      if (!okTrack(op.track)) return p;
      return withTrack(p, op.track, (t) => ({ ...t, notes: sanitizeNotes(op.notes, loopBeats(p)) }));
    case "track":
      if (!okTrack(op.track)) return p;
      return withTrack(p, op.track, (t) => ({
        ...t,
        ...(typeof op.mute === "boolean" ? { mute: op.mute } : {}),
        ...(typeof op.solo === "boolean" ? { solo: op.solo } : {}),
        ...(typeof op.name === "string" ? { name: op.name.slice(0, 24) } : {}),
      }));
    case "global": {
      const bars = okBars(op.bars) ? op.bars : p.bars;
      const next: Project = {
        ...p,
        bpm: num(40, 240, p.bpm)(op.bpm),
        swing: num(0, 0.6, p.swing)(op.swing),
        space: num(0, 1, p.space)(op.space),
        bars,
      };
      // shrinking the loop drops notes past the new end
      return bars < p.bars ? { ...next, tracks: next.tracks.map((t) => ({ ...t, notes: sanitizeNotes(t.notes, bars * BEATS_PER_BAR) })) } : next;
    }
    case "replace":
      return sanitize(op.project) ?? p;
    default:
      return p;
  }
}

function withTrack(p: Project, i: number, f: (t: TrackDoc) => TrackDoc): Project {
  const tracks = p.tracks.slice();
  tracks[i] = f(tracks[i]);
  return { ...p, tracks };
}

/** Which tracks the sequencer should play: solo wins, then mute. */
export function audible(p: Project): boolean[] {
  const anySolo = p.tracks.some((t) => t.solo);
  return p.tracks.map((t) => (anySolo ? t.solo : !t.mute));
}
