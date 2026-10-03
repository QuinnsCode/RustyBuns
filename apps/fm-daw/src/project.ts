// The project document and the ops that change it. Shared by the page (local
// state, undo), the world (persists and rebroadcasts) and the bounce. The world
// may face the internet on the edge, so everything that arrives is sanitized.
import { TRACKS, NPARAMS, clampParam } from "./engine/params.ts";

export interface Note { s: number; l: number; m: number; v: number } // start/length in beats, midi, velocity 0..1
export interface TrackDoc {
  name: string;
  kind: "drum" | "synth";
  /** Drums: the note a step plays. Synths: where the keyboard's C sits. */
  root: number;
  params: number[];
  notes: Note[];
  mute: boolean;
  solo: boolean;
}
export interface Project { v: 1; bpm: number; swing: number; bars: number; tracks: TrackDoc[] }

export type Op =
  | { t: "param"; track: number; i: number; v: number }
  | { t: "notes"; track: number; notes: Note[] }
  | { t: "track"; track: number; mute?: boolean; solo?: boolean; name?: string }
  | { t: "global"; bpm?: number; swing?: number; bars?: number }
  | { t: "replace"; project: Project };

export const BEATS_PER_BAR = 4;
export const MAX_NOTES = 512;
export const BAR_CHOICES = [1, 2, 4] as const;
export const loopBeats = (p: Project) => p.bars * BEATS_PER_BAR;

const num = (x: unknown, lo: number, hi: number, d: number) =>
  typeof x === "number" && Number.isFinite(x) ? Math.min(Math.max(x, lo), hi) : d;

export function sanitizeNotes(x: unknown, beats: number): Note[] {
  if (!Array.isArray(x)) return [];
  const out: Note[] = [];
  for (const n of x.slice(0, MAX_NOTES)) {
    if (!n || typeof n !== "object") continue;
    const s = num((n as Note).s, 0, beats - 1e-6, -1);
    if (s < 0) continue;
    out.push({
      s,
      l: num((n as Note).l, 1 / 64, beats, 0.25),
      m: Math.round(num((n as Note).m, 0, 127, 60)),
      v: num((n as Note).v, 0, 1, 0.8),
    });
  }
  return out.sort((a, b) => a.s - b.s || a.m - b.m);
}

export function sanitize(x: unknown): Project | null {
  if (!x || typeof x !== "object") return null;
  const p = x as Project;
  if (!Array.isArray(p.tracks) || p.tracks.length !== TRACKS) return null;
  const bars = BAR_CHOICES.includes(p.bars as 1) ? p.bars : 2;
  const beats = bars * BEATS_PER_BAR;
  return {
    v: 1,
    bpm: num(p.bpm, 40, 240, 120),
    swing: num(p.swing, 0, 0.6, 0),
    bars,
    tracks: p.tracks.map((t, ti) => ({
      name: typeof t?.name === "string" ? t.name.slice(0, 24) : `Track ${ti + 1}`,
      kind: t?.kind === "synth" ? "synth" : "drum",
      root: Math.round(num(t?.root, 0, 127, 60)),
      params: Array.from({ length: NPARAMS }, (_, i) => clampParam(i, Number(t?.params?.[i]))),
      notes: sanitizeNotes(t?.notes, beats),
      mute: t?.mute === true,
      solo: t?.solo === true,
    })),
  };
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
      const bars = BAR_CHOICES.includes(op.bars as 1) ? op.bars! : p.bars;
      const next: Project = {
        ...p,
        bpm: op.bpm === undefined ? p.bpm : num(op.bpm, 40, 240, p.bpm),
        swing: op.swing === undefined ? p.swing : num(op.swing, 0, 0.6, p.swing),
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
