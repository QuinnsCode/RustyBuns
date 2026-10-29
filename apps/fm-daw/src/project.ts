// The project document and the ops that change it. Shared by the page (local
// state, undo), the world (persists and rebroadcasts) and the bounce. The world
// may face the internet on the edge, so everything that arrives is sanitized.
import { arr, Bad, bool, check, int, maybe, num, obj, oneOf, opt, raw, str, type Guard } from "@rustybuns/util/guard";
import { TRACKS, NPARAMS, BEND_RANGE, clampParam } from "./engine/params.ts";

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
/**
 * space: the reverb and delay send after the engine, 0 dry to 1 drenched (src/engine/space.ts).
 * squash: the multiband up/down compressor on the master, 0 off to 1 over the top (src/engine/squash.ts).
 */
export interface Project { v: 1; bpm: number; swing: number; space: number; squash: number; bars: number; tracks: TrackDoc[] }

export type Op =
  | { t: "param"; track: number; i: number; v: number }
  | { t: "notes"; track: number; notes: Note[] }
  | { t: "track"; track: number; mute?: boolean; solo?: boolean; name?: string }
  | { t: "global"; bpm?: number; swing?: number; space?: number; squash?: number; bars?: number }
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
const PROJECT = obj({ tracks: arr(raw, TRACKS, { min: 1 }), bars: raw, bpm: num(40, 240, 120), swing: num(0, 0.6, 0), space: num(0, 1, 0), squash: num(0, 1, 0) });

export function sanitize(x: unknown): Project | null {
  const p = check(PROJECT, x);
  if (!p) return null;
  const bars = okBars(p.bars) ? p.bars : 2, beats = bars * BEATS_PER_BAR;
  // older projects had fewer tracks: pad with silent synth tracks (gain 0)
  const tracks = [...p.tracks, ...Array.from({ length: TRACKS - p.tracks.length }, () => ({ kind: "synth" }))];
  return { v: 1, bpm: p.bpm, swing: p.swing, space: p.space, squash: p.squash, bars, tracks: tracks.map((v, ti) => track(v, ti, beats)) };
}

function track(v: unknown, ti: number, beats: number): TrackDoc {
  const t = obj({ name: str(24, { min: 0, dflt: `Track ${ti + 1}` }), kind: oneOf(["drum", "synth"], "drum"), root: int(0, 127, 60),
    params: arr(raw, NPARAMS, { drop: true }), notes: raw, auto: raw, mute: bool(false), solo: bool(false) })(typeof v === "object" && v ? v : {});
  return { ...t, params: Array.from({ length: NPARAMS }, (_, i) => clampParam(i, Number(t.params[i]))), notes: sanitizeNotes(t.notes, beats), auto: sanitizeLanes(t.auto, beats) };
}

const tag = <T extends string>(t: T) => oneOf([t]);
const TRACK = int(0, TRACKS - 1), real = num(-Infinity, Infinity);
const PROJ = (v: unknown) => sanitize(v) ?? bad("a project");
// An edit off the wire: each field its type; apply() still fits values to the project (loop length, param ranges).
const OPS: Guard<Op>[] = [
  obj({ t: tag("param"), track: TRACK, i: int(0, NPARAMS - 1), v: real }),
  obj({ t: tag("notes"), track: TRACK, notes: (v: unknown) => sanitizeNotes(v, MAX_BARS * BEATS_PER_BAR) }),
  obj({ t: tag("track"), track: TRACK, mute: maybe(bool()), solo: maybe(bool()), name: maybe(str(Infinity, { min: 0 })) }),
  obj({ t: tag("global"), bpm: maybe(real), swing: maybe(real), space: maybe(real), squash: maybe(real), bars: maybe(BARS) }),
  obj({ t: tag("replace"), project: PROJ }),
];
export const decodeOp = (v: unknown): Op | null => OPS.reduce<Op | null>((got, g) => got ?? check(g, v), null);
const OP = (v: unknown) => decodeOp(v) ?? bad("an edit");

/**
 * The live line: what a player's hands do, like a MIDI cable run to everyone in the room.
 * The world passes each one on in the order it came and keeps none of them: nothing is
 * saved, undone or recorded into anyone else's take.
 */
export type Live =
  | { t: "on"; track: number; midi: number; vel: number }
  | { t: "off"; track: number; midi: number }
  | { t: "bend"; track: number; semis: number }
  | { t: "repeat"; beats: number }
  | { t: "play" }
  | { t: "stop" }
  /** Where their pointer is, as a share of the window (0..1 across and down), so others can see it. */
  | { t: "cursor"; x: number; y: number };
const MIDI = int(0, 127);
const LIVE: Guard<Live>[] = [
  obj({ t: tag("on"), track: TRACK, midi: MIDI, vel: num(0, 1, 0.8) }),
  obj({ t: tag("off"), track: TRACK, midi: MIDI }),
  obj({ t: tag("bend"), track: TRACK, semis: num(-BEND_RANGE, BEND_RANGE, 0) }),
  obj({ t: tag("repeat"), beats: num(0, BEATS_PER_BAR, 0) }),
  obj({ t: tag("play") }), obj({ t: tag("stop") }),
  obj({ t: tag("cursor"), x: num(0, 1, 0), y: num(0, 1, 0) }),
];
const LIVE_EVENT = (v: unknown) => LIVE.reduce<Live | null>((got, g) => got ?? check(g, v), null) ?? bad("a live event");

/** A held room still passes these, so a guest's notes, stutter and bend are let go everywhere. */
export const lettingGo = (e: Live) =>
  e.t === "off" || e.t === "cursor" || (e.t === "repeat" && e.beats === 0) || (e.t === "bend" && e.semis === 0);

/**
 * Who may change a sesh. Whoever made it is its maker (a key kept in their browser). Free, the
 * freezone: everyone edits and plays. Held (the maker pressed Esc): only the maker edits and plays
 * into the room; everyone else listens and can play along, heard only by themselves. Closed: the
 * jam is over, the groove is kept as the maker left it and only the maker gets in, to reopen it.
 */
export type Floor = "free" | "held" | "closed";
const FLOOR = oneOf(["free", "held", "closed"]);

/**
 * Why a world turned a socket away: every seat in this room is taken, every room is open, the maker
 * closed it, the sesh is private and the code was missing or wrong, or this address got it wrong too often lately.
 */
export type Full = "room" | "rooms" | "closed" | "code" | "tries";
/** A private sesh's code: what the maker types and every joiner types after. */
export const CODE = str(32, { min: 4 });

/** Page to world: seed an empty room with this project, one edit, one live event, or (the maker only) set the floor or the code ("" opens the sesh). */
export type ClientMsg = { t: "init"; project: Project } | { t: "op"; op: Op } | { t: "live"; e: Live } | { t: "floor"; state: Floor } | { t: "lock"; code: string };
/**
 * World to page: the saved project (null in an empty room), someone else's edit, how many are in,
 * someone's live event (`from` is that socket's number), that someone left (let go of their
 * notes), the floor and whether you're its maker, or no room for you (the socket closes after it).
 * `lock` says whether the sesh is private: on joining, and with the new code to everyone in when the maker changes it.
 */
export type ServerMsg =
  | { t: "snapshot"; project: Project | null } | { t: "op"; op: Op } | { t: "peers"; n: number }
  | { t: "live"; from: number; e: Live } | { t: "gone"; from: number } | { t: "full"; why: Full }
  | { t: "floor"; state: Floor; host: boolean } | { t: "lock"; on: boolean; code?: string };
const PEER = int(1, Infinity);
const CLIENT: Guard<ClientMsg>[] = [obj({ t: tag("init"), project: PROJ }), obj({ t: tag("op"), op: OP }), obj({ t: tag("live"), e: LIVE_EVENT }), obj({ t: tag("floor"), state: FLOOR }),
  obj({ t: tag("lock"), code: (v: unknown) => (v === "" ? "" : CODE(v)) })];
const SERVER: Guard<ServerMsg>[] = [
  obj({ t: tag("snapshot"), project: (v: unknown) => sanitize(v) }), obj({ t: tag("op"), op: OP }), obj({ t: tag("peers"), n: int(0, Infinity) }),
  obj({ t: tag("live"), from: PEER, e: LIVE_EVENT }), obj({ t: tag("gone"), from: PEER }), obj({ t: tag("full"), why: oneOf(["room", "rooms", "closed", "code", "tries"]) }),
  obj({ t: tag("floor"), state: FLOOR, host: bool() }), obj({ t: tag("lock"), on: bool(), code: opt(str(32, { min: 0 })) }),
];
export const decodeClient = (v: unknown): ClientMsg | null => CLIENT.reduce<ClientMsg | null>((got, g) => got ?? check(g, v), null);
export const decodeServer = (v: unknown): ServerMsg | null => SERVER.reduce<ServerMsg | null>((got, g) => got ?? check(g, v), null);

/** Pure: returns a new project, or the same one if the op is invalid. */
export function apply(p: Project, op: Op): Project {
  switch (op.t) {
    case "param": {
      return withTrack(p, op.track, (t) => {
        const params = t.params.slice();
        params[op.i] = clampParam(op.i, op.v);
        return { ...t, params };
      });
    }
    case "notes":
      return withTrack(p, op.track, (t) => ({ ...t, notes: sanitizeNotes(op.notes, loopBeats(p)) }));
    case "track":
      return withTrack(p, op.track, (t) => ({
        ...t,
        ...(op.mute !== undefined ? { mute: op.mute } : {}),
        ...(op.solo !== undefined ? { solo: op.solo } : {}),
        ...(op.name !== undefined ? { name: op.name.slice(0, 24) } : {}),
      }));
    case "global": {
      const bars = op.bars ?? p.bars;
      const next: Project = {
        ...p,
        bpm: num(40, 240, p.bpm)(op.bpm),
        swing: num(0, 0.6, p.swing)(op.swing),
        space: num(0, 1, p.space)(op.space),
        squash: num(0, 1, p.squash)(op.squash),
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
