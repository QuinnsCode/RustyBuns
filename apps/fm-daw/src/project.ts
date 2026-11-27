// The project document and the ops that change it. Shared by the page (local
// state, undo), the world (persists and rebroadcasts) and the bounce. The world
// may face the internet on the edge, so everything that arrives is sanitized.
import { arr, Bad, bool, check, int, maybe, nul, num, obj, oneOf, opt, raw, str, type Guard } from "@rustybuns/util/guard";
import { EQ_LANES, clampEqLane, eqLaneBand, sanitizeEq, type EqDoc } from "./engine/eq.ts";
import { TrackAmp } from "./amp/track-amp.ts";
import { DeskEdit, emptySeshDesk, plainSeshDesk, SeshDesk, withDeskEdit, type Channel } from "./desk.ts";
import { TrackPlugin } from "./plugin-track.ts";
import { ClipGuard, MAX_CLIPS, MAX_TAKES, MIN_CLIP_FRAMES, TAKE_RATE, TakeBytesGuard, clipsOf, soundIds, spanOf, takeRef, windowed, type Clip, type TakeBytes, type TakeRef } from "./take.ts";
import { ROOM_M } from "./studio.ts";
import { Instrument, MAX_MADE } from "./studio/made.ts";
import { cleanAvatar, type Avatar } from "@rustybuns/util/avatar";
import { SYSTEM_IDS, type SystemId } from "@rustybuns/gear";
import { Studio } from "./studio/builder.ts";
import type { StudioDef } from "./studio/room.ts";
import { RUNG, type Rung } from "./rewind.ts";
import { DeckPress, DeckSay, MixSay } from "./dj/booth.ts";
import { SOUND_MAX_FRAMES } from "./clock.ts";
import { Chain, MAX_CHAIN, Song, relayoutLanes, relayoutNotes, relink, relinkLanes } from "./song.ts";
import { TRACKS, NPARAMS, BEND_RANGE, LANE_BEND, LANE_STUTTER, clampLane, clampParam } from "./engine/params.ts";

export interface Note { s: number; l: number; m: number; v: number } // start/length in beats, midi, velocity 0..1
/**
 * One automation lane: param `i` follows straight lines between points
 * ([beat, value]) across the loop; two points on one beat make a jump (a cut).
 * The sequencer applies it, so both engines hear the same thing. Besides the
 * params, `i` can be LANE_BEND or LANE_STUTTER: moves recorded off the Perform panel.
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
  /** Shape on this track alone, before the sum (src/engine/eq.ts); absent when flat. */
  eq?: EqDoc;
  /** Audio recorded onto this track (src/take.ts): its sound travels apart from the project, under the id. */
  take?: TakeRef;
  /**
   * The track's audio once someone cut or trimmed it: clips, each a window onto a take's sound (src/take.ts).
   * A track has `take` (one whole sound) or `clips`, never both: clipsOf() reads either, withClips() writes the right one.
   */
  clips?: Clip[];
  /** An Amp insert (src/amp/insert.ts): the take and the live input through a Q Amp head; absent when off. */
  amp?: TrackAmp;
  /** A hosted CLAP plugin plays this track's notes instead of its FM voice (src/plugin-track.ts); absent for FM. */
  plugin?: TrackPlugin;
  /** No instrument: the notes stay, show, record and go out (MIDI out, the live line) but make no sound here; absent for a voice. */
  voiceless?: true;
  /** A web plugin the track's FM sound goes through on its way to the mix (a Web Audio Module effect, src/ui/wam.ts); absent for none. */
  insert?: TrackPlugin;
  mute: boolean;
  solo: boolean;
}
/**
 * space: the reverb and delay send after the engine, 0 dry to 1 drenched (src/engine/space.ts).
 * squash: the multiband up/down compressor on the master, 0 off to 1 over the top (src/engine/squash.ts).
 * eq: Shape, the master EQ before it: a slot per band, null when empty (src/engine/eq.ts).
 * eqAuto: its automation, a lane per band and setting (eqLane), only on bands that are there.
 * eqLinear: Shape in linear phase (src/engine/linear.ts), only there when on.
 * instruments: the ones made in the jam room (src/studio/made.ts), each a seat at its track; only there when there are some.
 * desk: the players' channels and the aux 2 return on the sesh's desk (src/desk.ts); only there once one was moved.
 * studio: the jam room's studio (src/studio/rooms/), by id; the leader moves the sesh to another, and everyone walks into it. Only there once set.
 * rig: the open-air rig on the sand (@rustybuns/gear systems.ts), the leader's to change; only there once set.
 * master: the room's level, dB (MASTER_MIN to 0), on top of each listener's own; set from the remote (src/remote/), only there below 0. A bounce leaves it out.
 * song: song mode (src/song.ts), the loop as a chain of patterns, bars × chain slots long; only there when on.
 */
export interface Project { v: 1; bpm: number; swing: number; space: number; squash: number; master?: number; eq: EqDoc; eqAuto?: Lane[]; eqLinear?: boolean; bars: number; tracks: TrackDoc[]; instruments?: Instrument[]; desk?: SeshDesk; studio?: string; rig?: SystemId; built?: StudioDef; song?: Song }

export type Op =
  | { t: "param"; track: number; i: number; v: number }
  | { t: "notes"; track: number; notes: Note[] }
  | { t: "auto"; track: number; lanes: Lane[] }
  | { t: "track"; track: number; mute?: boolean; solo?: boolean; name?: string }
  | { t: "global"; bpm?: number; swing?: number; space?: number; squash?: number; bars?: number; master?: number }
  /** Shape on the master, or with `track` that track's own. */
  | { t: "eq"; bands: EqDoc; track?: number }
  | { t: "eqAuto"; lanes: Lane[] }
  | { t: "eqPhase"; linear: boolean }
  /** A recorded take onto a track (its chunks went first), or null to take it off. */
  | { t: "take"; track: number; take: TakeRef | null }
  /** A track's clips as they now are, after a cut, trim, slip, move or delete (cutClip and the rest below). */
  | { t: "clips"; track: number; clips: Clip[] }
  /** An Amp on a track, at these knobs, or null to take it off. */
  | { t: "amp"; track: number; amp: TrackAmp | null }
  /** A plugin playing a track (with the sliders moved), or null to give it its FM voice back. */
  | { t: "plugin"; track: number; plugin: TrackPlugin | null }
  /** An effect on a track's sound (with its sliders moved), or null to take it off. */
  | { t: "insert"; track: number; insert: TrackPlugin | null }
  /** No instrument on a track (its notes kept, unheard here), or its sound back. */
  | { t: "voiceless"; track: number; on: boolean }
  /** A new instrument in the jam room: its track gets this patch and its name, emptied of notes, and the room a seat at it. */
  | { t: "instrument"; inst: Instrument; params: number[]; root: number }
  /** The desk beyond its tracks (src/desk.ts): a player's channel as it now is, the aux 2 return's fader, mute and Shape, or the Space return's Shape. */
  | { t: "desk"; player?: Channel; aux2?: SeshDesk["aux2"]; space?: SeshDesk["space"] }
  /** The leader moves the sesh to this studio (a room id, or "yours": each person's own built one). */
  | { t: "studio"; id: string; built?: StudioDef }
  /** The leader brings another open-air rig to the sand (@rustybuns/gear systems.ts): its boxes and their sound, for everyone. */
  | { t: "rig"; id: SystemId }
  /** Song mode: the patterns each slot plays (the first time, the loop as it is becomes pattern A), or null to leave it (the notes stay). */
  | { t: "song"; chain: number[] | null }
  | { t: "replace"; project: Project };

/** The room's level at its lowest, dB: silence. */
export const MASTER_MIN = -60;
/** The room's level as a gain, to multiply each listener's own master by. */
export const roomGain = (p: Project) => (p.master ?? 0) <= MASTER_MIN ? 0 : Math.pow(10, (p.master ?? 0) / 20);
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

/** Which lanes a list may hold, how each value fits, and how many. */
interface LaneKind { lane: Guard<number>; fit(i: number, v: number): number; max: number }
const TRACK_LANES: LaneKind = { lane: (v) => (v === LANE_BEND || v === LANE_STUTTER ? v : int(0, NPARAMS - 1)(v)), fit: clampLane, max: MAX_LANES };
const EQ_AUTO: LaneKind = { lane: int(0, EQ_LANES - 1), fit: clampEqLane, max: EQ_LANES };

export function sanitizeLanes(x: unknown, beats: number, kind = TRACK_LANES): Lane[] {
  const lane = (v: unknown): Lane => {
    const { i, pts } = obj({ i: kind.lane, pts: raw })(v);
    const point = (pt: unknown): [number, number] =>
      Array.isArray(pt) && Number.isFinite(pt[0]) && Number.isFinite(pt[1]) ? [num(0, beats, 0)(pt[0]), kind.fit(i, pt[1])] : bad("a point");
    const out = arr(point, MAX_POINTS, { drop: true })(pts).sort((a, b) => a[0] - b[0]);
    return out.length ? { i, pts: out } : bad("no points");
  };
  return arr(lane, kind.max, { drop: true })(x);
}
/** Shape's lanes, fitted, and only for bands the EQ has (a removed band takes its moves with it). */
export const sanitizeEqAuto = (x: unknown, beats: number, eq: EqDoc) => sanitizeLanes(x, beats, EQ_AUTO).filter((l) => eq[eqLaneBand(l.i)]);
/** eqAuto only when there is some, so a project without moves reads the same as before it had the field. */
const eqAutoOf = (lanes: Lane[]) => (lanes.length ? { eqAuto: lanes } : {});
/** A track with this Shape: the field only when a slot is filled, so a flat track reads as it did before tracks had one. */
function withTrackEq(t: TrackDoc, eq: EqDoc): TrackDoc {
  const { eq: _, ...rest } = t;
  return eq.some(Boolean) ? { ...rest, eq } : rest;
}
/** eqLinear the same way: only when on. */
const linearOf = (on: boolean) => (on ? { eqLinear: true } : {});

/**
 * A recorded take into a track's lanes: lane `i` between the take's first and
 * last beat becomes the take (points [beat, value] in the order played), and
 * the lane is made if it wasn't there. Flat runs and points closer than 1/64 of
 * a beat are thinned, so a pitch wheel doesn't fill the lane in a few bars.
 */
export function punchLane(lanes: Lane[], i: number, take: [number, number][]): Lane[] {
  if (!take.length) return lanes;
  const from = take[0][0], to = take[take.length - 1][0];
  const thin: [number, number][] = [];
  for (const pt of take) {
    const a = thin[thin.length - 2], b = thin[thin.length - 1];
    // b sits in the middle of a run (flat, or too close to its neighbours), unless it ends a jump
    const middle = a && b && a[0] !== b[0] && b[0] !== pt[0] && ((a[1] === b[1] && b[1] === pt[1]) || pt[0] - a[0] < 1 / 64);
    if (middle) thin[thin.length - 1] = pt; else thin.push(pt);
  }
  const old = lanes.find((l) => l.i === i)?.pts ?? [];
  const pts = [...old.filter(([b]) => b < from), ...thin, ...old.filter(([b]) => b > to)];
  return [...lanes.filter((l) => l.i !== i), { i, pts }];
}

/** Beats without a move that count as the hand holding still. */
const HELD = 1 / 16;

/** Performance moves coming back from a recording, gathered per lane until they're punched in. */
export class Take {
  private lanes = new Map<number, { track: number; i: number; pts: [number, number][] }>();
  /**
   * Lane `i` on `track` went from `was` to `v` at beat `b`. False when that's
   * behind the lane's last move (the loop came round): flush, then add it again.
   */
  add(m: { track: number; i: number; b: number; v: number; was: number }): boolean {
    let s = this.lanes.get(m.track * 1024 + m.i);
    if (s && m.b < s.pts[s.pts.length - 1][0]) return false;
    // a lane starts from where it was, and stays there while the hand is still (rather than
    // sliding to the next move); a stutter is all jumps, never a slide from one length to another
    if (!s) this.lanes.set(m.track * 1024 + m.i, (s = { track: m.track, i: m.i, pts: [[m.b, m.was]] }));
    else if (m.i === LANE_STUTTER || m.b - s.pts[s.pts.length - 1][0] > HELD) s.pts.push([m.b, m.was]);
    s.pts.push([m.b, m.v]);
    return true;
  }
  /** Everything gathered, emptied out: punch each into its track's lanes (punchLane), one after another. */
  flush() { const out = [...this.lanes.values()]; this.lanes.clear(); return out; }
}

const bad = (why: string): never => { throw new Bad(why); };
const PROJECT = obj({ tracks: arr(raw, TRACKS, { min: 1 }), bars: raw, bpm: num(40, 240, 120), swing: num(0, 0.6, 0), space: num(0, 1, 0), squash: num(0, 1, 0), master: num(MASTER_MIN, 0, 0), eq: raw, eqAuto: raw, eqLinear: bool(false), instruments: raw, desk: raw, studio: raw, rig: raw, built: raw, song: raw });
/** A studio's id, as the rooms name them. */
const STUDIO_ID = (v: unknown) => (typeof v === "string" && /^[a-z0-9-]{1,64}$/.test(v) ? v : bad("a studio id"));
const studioOf = (v: unknown): { studio?: string } => { const id = check(STUDIO_ID, v); return id ? { studio: id } : {}; };
const builtOf = (v: unknown): { built?: StudioDef } => { const b = check(Studio, v); return b ? { built: b } : {}; };
const rigOf = (v: unknown): { rig?: SystemId } => { const id = check(oneOf(SYSTEM_IDS), v); return id ? { rig: id } : {}; };

export function sanitize(x: unknown): Project | null {
  const p = check(PROJECT, x);
  if (!p) return null;
  const bars = okBars(p.bars) ? p.bars : 2, beats = bars * BEATS_PER_BAR;
  // older projects had fewer tracks: pad with silent synth tracks (gain 0)
  const tracks = [...p.tracks, ...Array.from({ length: TRACKS - p.tracks.length }, () => ({ kind: "synth" }))];
  const eq = sanitizeEq(p.eq);
  const song = songOf(p.song, bars).song;
  const out: Project = { v: 1, bpm: p.bpm, swing: p.swing, space: p.space, squash: p.squash, ...masterOf(p.master), eq, ...eqAutoOf(sanitizeEqAuto(p.eqAuto, beats, eq)), ...linearOf(p.eqLinear), bars, tracks: fitTakes(tracks.map((v, ti) => track(v, ti, beats))), ...madeOf(arr(Instrument, MAX_MADE, { drop: true })(p.instruments ?? [])), ...deskOf(check(SeshDesk, p.desk) ?? emptySeshDesk()), ...studioOf(p.studio), ...rigOf(p.rig), ...builtOf(p.built), ...songOf(p.song, bars) };
  return song ? laidOut(out, song, song) : out;
}

/** song only when it fits the loop exactly. */
const songOf = (v: unknown, bars: number): { song?: Song } => { const s = check(Song, v); return s && s.bars * s.chain.length === bars ? { song: s } : {}; };

/**
 * Every track's notes and automation lanes, and Shape's moves, each pattern as chain `was` held it, laid out along
 * `song` (what falls past the end goes). With `was` the same song, every slot plays its pattern again.
 */
function laidOut(p: Project, was: Song, song: Song): Project {
  const beats = song.bars * song.chain.length * BEATS_PER_BAR, { eqAuto, ...rest } = p;
  const tracks = p.tracks.map((t) => ({ ...t, notes: relayoutNotes(t.notes, was, song, BEATS_PER_BAR), ...(t.auto ? { auto: sanitizeLanes(relayoutLanes(t.auto, was, song, BEATS_PER_BAR), beats) } : {}) }));
  return { ...rest, tracks, ...eqAutoOf(sanitizeEqAuto(relayoutLanes(eqAuto ?? [], was, song, BEATS_PER_BAR), beats, p.eq)) };
}

/** desk only when something on it was moved, so a groove nobody mixed players in reads as it did. */
const deskOf = (d: SeshDesk): { desk?: SeshDesk } => (plainSeshDesk(d) ? {} : { desk: d });

/** The room's level only below 0 dB, so a groove nobody turned down reads as before it had the field. */
const masterOf = (db: number): { master?: number } => (db < 0 ? { master: db } : {});

/** instruments only when there are some, so a groove nobody made one in reads as it did, one per track. */
function madeOf(list: Instrument[]): { instruments?: Instrument[] } {
  const seen = new Set<number>(), ids = new Set<string>();
  const kept = list.filter((x) => !seen.has(x.track) && !ids.has(x.id) && (seen.add(x.track), ids.add(x.id), true));
  return kept.length ? { instruments: kept } : {};
}

/** Clips only on a beat inside the loop, MAX_CLIPS a track, and no more than MAX_TAKES sounds, first tracks first. */
function fitTakes(tracks: TrackDoc[], beats?: number): TrackDoc[] {
  const sounds = new Set<string>();
  return tracks.map((t) => {
    const was = clipsOf(t);
    if (!was.length) return t;
    const kept = was.filter((c) => (beats === undefined || c.beat < beats) && (sounds.has(c.id) || sounds.size < MAX_TAKES)).slice(0, MAX_CLIPS);
    for (const c of kept) sounds.add(c.id);
    return kept.length === was.length ? t : withClips(t, kept);
  });
}

/** The track holding these clips, in the form a track nobody cut always had: one whole sound is `take`. */
export function withClips(t: TrackDoc, clips: readonly Clip[]): TrackDoc {
  const { take: _, clips: __, ...rest } = t;
  if (!clips.length) return rest;
  const [c] = clips;
  if (clips.length === 1 && c.from === undefined && c.to === undefined) return { ...rest, take: { id: c.id, beat: c.beat, frames: c.frames } };
  return { ...rest, clips: [...clips].sort((a, b) => a.beat - b.beat) };
}

// Clip edits: pure, on a track's clips, beats as the caller gives them (snap first for a grid). Each hands back the
// new list, which goes in a "clips" op; the sound never changes, only which part of it plays where.
const framesPerBeat = (bpm: number) => (60 / bpm) * TAKE_RATE;
/** The beat a clip stops sounding on, at this tempo. */
export function clipEnd(c: Clip, bpm: number): number { const { from, to } = spanOf(c); return c.beat + (to - from) / framesPerBeat(bpm); }
const replaced = (clips: readonly Clip[], i: number, by: Clip[]) => [...clips.slice(0, i), ...by, ...clips.slice(i + 1)];

/** Cut the clip under `beat` in two there (both share its sound); unchanged when no clip is, or a piece would be too short. */
export function cutClip(clips: readonly Clip[], beat: number, bpm: number): readonly Clip[] {
  if (clips.length >= MAX_CLIPS) return clips;
  const i = clips.findIndex((c) => c.beat < beat && beat < clipEnd(c, bpm));
  if (i < 0) return clips;
  const c = clips[i], { from, to } = spanOf(c), at = from + (beat - c.beat) * framesPerBeat(bpm);
  if (at - from < MIN_CLIP_FRAMES || to - at < MIN_CLIP_FRAMES) return clips;
  return replaced(clips, i, [windowed(c, from, at), { ...windowed(c, at, to), beat }]);
}

/**
 * Move clip `i`'s start or end edge to `beat`. The sound stays where it is in time: only the window
 * moves, so a trimmed start begins later in the sound and later in the loop. Kept inside the sound and
 * at least MIN_CLIP_FRAMES long.
 */
export function trimClip(clips: readonly Clip[], i: number, edge: "start" | "end", beat: number, bpm: number): readonly Clip[] {
  const c = clips[i];
  if (!c) return clips;
  const { from, to } = spanOf(c), fpb = framesPerBeat(bpm);
  if (edge === "end") return replaced(clips, i, [windowed(c, from, Math.max(from + MIN_CLIP_FRAMES, Math.min(c.frames, from + (beat - c.beat) * fpb)))]);
  // the sound's frame 0 sits at c.beat - from / fpb, and can't start before the loop does
  const lo = Math.max(0, from - c.beat * fpb);
  const at = Math.max(lo, Math.min(to - MIN_CLIP_FRAMES, from + (beat - c.beat) * fpb));
  return replaced(clips, i, [{ ...windowed(c, at, to), beat: c.beat + (at - from) / fpb }]);
}

/**
 * Slip clip `i`'s sound `by` beats (later when positive) under a window that stays put: what lines a drum's
 * transient up with the beat. Stops where the window would leave the sound.
 */
export function slipClip(clips: readonly Clip[], i: number, by: number, bpm: number): readonly Clip[] {
  const c = clips[i];
  if (!c) return clips;
  const { from, to } = spanOf(c), d = Math.max(-from, Math.min(c.frames - to, -by * framesPerBeat(bpm)));
  return replaced(clips, i, [windowed(c, from + d, to + d)]);
}

/** Clip `i` to start on `beat` (not before the loop's start), sound and window as they were. */
export function moveClip(clips: readonly Clip[], i: number, beat: number): readonly Clip[] {
  const c = clips[i];
  return c ? replaced(clips, i, [{ ...c, beat: Math.max(0, beat) }]) : clips;
}

/** Clip `i` off the track (its sound goes once no clip plays it). */
export const deleteClip = (clips: readonly Clip[], i: number): readonly Clip[] => (clips[i] ? replaced(clips, i, []) : clips);

/** voiceless only when on, so a track with a voice reads as it did before tracks could have none. */
const voicelessOf = (on: boolean): { voiceless?: true } => (on ? { voiceless: true } : {});

function track(v: unknown, ti: number, beats: number): TrackDoc {
  const t = obj({ name: str(24, { min: 0, dflt: `Track ${ti + 1}` }), kind: oneOf(["drum", "synth"], "drum"), root: int(0, 127, 60),
    params: arr(raw, NPARAMS, { drop: true }), notes: raw, auto: raw, eq: raw, take: maybe(takeRef(beats)), clips: maybe(arr(ClipGuard, MAX_CLIPS, { drop: true })), amp: maybe(TrackAmp), plugin: maybe(TrackPlugin), insert: maybe(TrackPlugin), voiceless: bool(false), mute: bool(false), solo: bool(false) })(typeof v === "object" && v ? v : {});
  const { eq, take, clips, amp, plugin, insert, voiceless, ...rest } = t;
  return withTrackEq(withClips({ ...rest, ...(amp ? { amp } : {}), ...(plugin ? { plugin } : {}), ...voicelessOf(voiceless), ...(insert ? { insert } : {}), params: Array.from({ length: NPARAMS }, (_, i) => clampParam(i, Number(t.params[i]))), notes: sanitizeNotes(t.notes, beats), auto: sanitizeLanes(t.auto, beats) }, (clips?.length ? clips : take ? [take] : []).filter((c) => c.beat < beats)), sanitizeEq(eq));
}

const tag = <T extends string>(t: T) => oneOf([t]);
const TRACK = int(0, TRACKS - 1), real = num(-Infinity, Infinity);
const PROJ = (v: unknown) => sanitize(v) ?? bad("a project");
// An edit off the wire: each field its type; apply() still fits values to the project (loop length, param ranges).
const OPS: Guard<Op>[] = [
  obj({ t: tag("param"), track: TRACK, i: int(0, NPARAMS - 1), v: real }),
  obj({ t: tag("notes"), track: TRACK, notes: (v: unknown) => sanitizeNotes(v, MAX_BARS * BEATS_PER_BAR) }),
  obj({ t: tag("auto"), track: TRACK, lanes: (v: unknown) => sanitizeLanes(v, MAX_BARS * BEATS_PER_BAR) }),
  obj({ t: tag("track"), track: TRACK, mute: maybe(bool()), solo: maybe(bool()), name: maybe(str(Infinity, { min: 0 })) }),
  obj({ t: tag("global"), bpm: maybe(real), swing: maybe(real), space: maybe(real), squash: maybe(real), bars: maybe(BARS), master: maybe(real) }),
  obj({ t: tag("eq"), bands: sanitizeEq, track: maybe(TRACK) }),
  obj({ t: tag("eqAuto"), lanes: (v: unknown) => sanitizeLanes(v, MAX_BARS * BEATS_PER_BAR, EQ_AUTO) }),
  obj({ t: tag("eqPhase"), linear: bool() }),
  obj({ t: tag("take"), track: TRACK, take: nul(takeRef(MAX_BARS * BEATS_PER_BAR)) }),
  obj({ t: tag("clips"), track: TRACK, clips: arr(ClipGuard, MAX_CLIPS) }),
  obj({ t: tag("amp"), track: TRACK, amp: nul(TrackAmp) }),
  obj({ t: tag("plugin"), track: TRACK, plugin: nul(TrackPlugin) }),
  obj({ t: tag("insert"), track: TRACK, insert: nul(TrackPlugin) }),
  obj({ t: tag("voiceless"), track: TRACK, on: bool() }),
  obj({ t: tag("instrument"), inst: Instrument, params: arr(real, NPARAMS, { min: NPARAMS }), root: int(0, 127) }),
  obj({ t: tag("desk"), player: maybe(DeskEdit.player), aux2: maybe(DeskEdit.aux2), space: maybe(DeskEdit.space) }),
  obj({ t: tag("studio"), id: STUDIO_ID, built: opt(Studio) }),
  obj({ t: tag("rig"), id: oneOf(SYSTEM_IDS) }),
  obj({ t: tag("song"), chain: nul(Chain) }),
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
  /** `b`: the beat it was played on, on the sesh's shared clock (src/clock.ts), so a listener can place it. */
  | { t: "on"; track: number; midi: number; vel: number; b?: number }
  | { t: "off"; track: number; midi: number; b?: number }
  | { t: "bend"; track: number; semis: number; b?: number }
  | { t: "repeat"; beats: number; b?: number }
  | { t: "play" }
  | { t: "stop" }
  /** Where their pointer is, as a share of the window (0..1 across and down), so others can see it. */
  | { t: "cursor"; x: number; y: number }
  /**
   * Where they stand in the studio and which way they face, so others see them and what's in their hand (src/studio.ts).
   * In the jam room (src/studio/) also the spot they sit at, if any: that seat shows them playing it. `room`: they are
   * in the sesh's gear room (src/room/), not the jam room: each room draws only the people in it.
   */
  | { t: "body"; at: number[]; yaw: number; seat?: string; room?: "gear" }
  /** Who they look like in the jam room: their eqosys avatar and name, said on joining and when someone new comes in. */
  | { t: "wear"; avatar: Avatar; name: string }
  /**
   * Their guitar is plugged into this track (-1: straight in, no amp), or unplugged (null): its sound comes by WebRTC
   * (src/guitar.ts). `mic`: it's their voice, from the vocal booth's mic, straight in.
   */
  | { t: "guitar"; track: number | null; mic?: boolean }
  /**
   * Their own plugin (a CLAP the desktop app hosts, src/engine/plugins.ts) voices this track, named so others can see what
   * it is, or stopped (null). Nobody else has the plugin: they keep that track quiet and hear its sound in slices (below).
   */
  | { t: "plugin"; track: number; name: string | null }
  /**
   * They're playing a set to the room over the PA (src/studio/pa-line.ts: the DJ decks' master, in stereo, by WebRTC), or
   * stopped (`on` false). `name` is what's on, for the room to read.
   */
  | { t: "pa"; on: boolean; name?: string }
  /**
   * The setup lesson they're in at the gear wall (src/studio/lessons.ts), for the room's class card (src/studio/class.ts,
   * #6087): which one (null: none), each step's words and whether it's done, what's in the way of the next one, and the
   * lessons they've finished in this room.
   */
  | { t: "lesson"; id: string | null; steps: { job: string; done: boolean }[]; why?: string; finished: string[] }
  /** What's on one of their DJ decks, for the booth (src/dj/booth.ts); a press on someone else's deck, for its player; or where their mixer's controls sit. */
  | DeckSay | DeckPress | MixSay
  /**
   * A slice of their guitar's or plugin track's sound for whoever hears it a loop late or at the desk: it starts on beat `b` (the input's
   * latency taken off), into `track` (-1: straight in): base64url of Opus packets (`c: "opus"`, src/studio/opus.ts),
   * or of 16-bit samples at TAKE_RATE from a browser with no WebCodecs.
   */
  | { t: "sound"; track: number; b: number; c?: "opus"; data: string };
const MIDI = int(0, 127);
/** A beat on the shared clock: the leader's time 0 is beat 0, so it is big, never negative. */
const STAMP = num(0, 1e13);
const LESSON_ID = str(24, { re: /^[a-z]+$/ });
const SOUND_CHARS =Math.ceil((SOUND_MAX_FRAMES * 2 * 4) / 3);
const LIVE: Guard<Exclude<Live, DeckSay | DeckPress | MixSay>>[] = [
  obj({ t: tag("on"), track: TRACK, midi: MIDI, vel: num(0, 1, 0.8), b: opt(STAMP) }),
  obj({ t: tag("off"), track: TRACK, midi: MIDI, b: opt(STAMP) }),
  obj({ t: tag("bend"), track: TRACK, semis: num(-BEND_RANGE, BEND_RANGE, 0), b: opt(STAMP) }),
  obj({ t: tag("repeat"), beats: num(0, BEATS_PER_BAR, 0), b: opt(STAMP) }),
  obj({ t: tag("play") }), obj({ t: tag("stop") }),
  obj({ t: tag("cursor"), x: num(0, 1, 0), y: num(0, 1, 0) }),
  obj({ t: tag("body"), at: arr(num(-ROOM_M, ROOM_M), 3, { min: 3 }), yaw: num(-Math.PI * 2, Math.PI * 2), seat: opt(str(24, { re: /^[a-z0-9-]+$/ })), room: opt(oneOf(["gear"])) }),
  obj({ t: tag("wear"), avatar: (v: unknown) => cleanAvatar(v) ?? bad("an avatar"), name: str(40, { min: 0, dflt: "" }) }),
  obj({ t: tag("guitar"), track: nul(int(-1, TRACKS - 1)), mic: opt(bool()) }),
  obj({ t: tag("plugin"), track: TRACK, name: nul(str(500)) }),
  obj({ t: tag("pa"), on: bool(), name: opt(str(120, { min: 0 })) }),
  obj({ t: tag("lesson"), id: nul(LESSON_ID), steps: arr(obj({ job: str(200), done: bool() }), 16, { min: 0 }), why: opt(str(300)), finished: arr(LESSON_ID, 16, { min: 0 }) }),
  obj({ t: tag("sound"), track: int(-1, TRACKS - 1), b: STAMP, c: opt(oneOf(["opus"])), data: str(SOUND_CHARS, { min: 4, re: /^[A-Za-z0-9_-]+$/ }) }),
];
const LIVE_EVENT = (v: unknown): Live => LIVE.reduce<Live | null>((got, g) => got ?? check(g, v), null) ?? check(DeckSay, v) ?? check(DeckPress, v) ?? check(MixSay, v) ?? bad("a live event");

/** A held room still passes these, so a guest's notes, stutter and bend are let go everywhere. */
export const lettingGo = (e: Live) =>
  e.t === "off" || (e.t === "guitar" && e.track === null) || (e.t === "plugin" && e.name === null) || (e.t === "pa" && !e.on) || e.t === "cursor" || e.t === "body" || e.t === "wear" || e.t === "lesson" || (e.t === "repeat" && e.beats === 0) || (e.t === "bend" && e.semis === 0);

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
export type Full = "room" | "rooms" | "closed" | "code" | "tries" | "blocked";
/** A private sesh's code: what the maker types and every joiner types after. */
export const CODE = str(32, { min: 4 });

/**
 * Page to world: seed an empty room with this project, one edit, one live event, (the maker only) set the floor or the code
 * ("" opens the sesh), or ask for the groove as it was `ago` minutes back, for this page alone (src/rewind.ts).
 */
export type ClientMsg = TakeBytes | { t: "init"; project: Project } | { t: "op"; op: Op } | { t: "live"; e: Live } | { t: "floor"; state: Floor } | { t: "lock"; code: string } | { t: "rewind"; ago: Rung };
/**
 * World to page: the saved project (null in an empty room), someone else's edit, how many are in,
 * someone's live event (`from` is that socket's number), that someone left (let go of their
 * notes), the floor and whether you're its maker, or no room for you (the socket closes after it).
 * `lock` says whether the sesh is private: on joining, and with the new code to everyone in when the maker changes it.
 * `rewound` answers this page's `rewind`: the groove as of `at` (ms), or null when the sesh doesn't go back that far.
 */
export type ServerMsg =
  | TakeBytes
  | { t: "snapshot"; project: Project | null } | { t: "op"; op: Op } | { t: "peers"; n: number }
  | { t: "live"; from: number; e: Live } | { t: "gone"; from: number } | { t: "full"; why: Full }
  | { t: "floor"; state: Floor; host: boolean } | { t: "lock"; on: boolean; code?: string }
  | { t: "rewound"; ago: Rung; at: number; project: Project | null };
const PEER = int(1, Infinity);
const CLIENT: Guard<ClientMsg>[] = [TakeBytesGuard, obj({ t: tag("init"), project: PROJ }), obj({ t: tag("op"), op: OP }), obj({ t: tag("live"), e: LIVE_EVENT }), obj({ t: tag("floor"), state: FLOOR }),
  obj({ t: tag("lock"), code: (v: unknown) => (v === "" ? "" : CODE(v)) }), obj({ t: tag("rewind"), ago: RUNG })];
const SERVER: Guard<ServerMsg>[] = [
  TakeBytesGuard,
  obj({ t: tag("snapshot"), project: (v: unknown) => sanitize(v) }), obj({ t: tag("op"), op: OP }), obj({ t: tag("peers"), n: int(0, Infinity) }),
  obj({ t: tag("live"), from: PEER, e: LIVE_EVENT }), obj({ t: tag("gone"), from: PEER }), obj({ t: tag("full"), why: oneOf(["room", "rooms", "closed", "code", "tries", "blocked"]) }),
  obj({ t: tag("floor"), state: FLOOR, host: bool() }), obj({ t: tag("lock"), on: bool(), code: opt(str(32, { min: 0 })) }),
  obj({ t: tag("rewound"), ago: RUNG, at: int(0, Infinity), project: nul(PROJ) }),
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
    case "notes": {
      const song = p.song;
      return withTrack(p, op.track, (t) => {
        const notes = sanitizeNotes(op.notes, loopBeats(p));
        return { ...t, notes: song ? relink(t.notes, notes, song, BEATS_PER_BAR) : notes };
      });
    }
    case "auto": {
      const song = p.song, beats = loopBeats(p);
      return withTrack(p, op.track, (t) => {
        const auto = sanitizeLanes(op.lanes, beats);
        return { ...t, auto: song ? sanitizeLanes(relinkLanes(t.auto ?? [], auto, song, BEATS_PER_BAR), beats) : auto };
      });
    }
    case "track":
      return withTrack(p, op.track, (t) => ({
        ...t,
        ...(op.mute !== undefined ? { mute: op.mute } : {}),
        ...(op.solo !== undefined ? { solo: op.solo } : {}),
        ...(op.name !== undefined ? { name: op.name.slice(0, 24) } : {}),
      }));
    case "global": {
      // in song mode the chain sets the loop's length
      const bars = p.song ? p.bars : op.bars ?? p.bars;
      const next: Project = {
        ...p,
        bpm: num(40, 240, p.bpm)(op.bpm),
        swing: num(0, 0.6, p.swing)(op.swing),
        space: num(0, 1, p.space)(op.space),
        squash: num(0, 1, p.squash)(op.squash),
        bars,
      };
      if (op.master !== undefined) { delete next.master; Object.assign(next, masterOf(num(MASTER_MIN, 0, p.master ?? 0)(op.master))); }
      // shrinking the loop drops notes past the new end
      return bars < p.bars ? { ...next, tracks: fitTakes(next.tracks.map((t) => ({ ...t, notes: sanitizeNotes(t.notes, bars * BEATS_PER_BAR) })), bars * BEATS_PER_BAR) } : next;
    }
    case "eq": {
      const eq = sanitizeEq(op.bands);
      if (op.track !== undefined) return withTrack(p, op.track, (t) => withTrackEq(t, eq));
      const { eqAuto, ...rest } = p;
      return { ...rest, eq, ...eqAutoOf(sanitizeEqAuto(eqAuto, loopBeats(p), eq)) };
    }
    case "eqAuto": {
      const { eqAuto: was, ...rest } = p, beats = loopBeats(p), lanes = sanitizeEqAuto(op.lanes, beats, p.eq);
      return { ...rest, ...eqAutoOf(p.song ? sanitizeEqAuto(relinkLanes(was ?? [], lanes, p.song, BEATS_PER_BAR), beats, p.eq) : lanes) };
    }
    case "eqPhase": {
      const { eqLinear: _, ...rest } = p;
      return { ...rest, ...linearOf(op.linear) };
    }
    case "take":
    case "clips": {
      // a take lands as the track's one clip (or takes them all off); a sesh holds MAX_TAKES sounds at most
      const clips = op.t === "clips" ? op.clips : op.take ? [op.take] : [];
      if (clips.length > MAX_CLIPS || clips.some((c) => c.beat >= loopBeats(p))) return p;
      const others = soundIds({ tracks: p.tracks.filter((_, i) => i !== op.track) });
      for (const c of clips) others.add(c.id);
      if (others.size > MAX_TAKES) return p;
      return withTrack(p, op.track, (t) => withClips(t, clips));
    }
    case "amp":
      return withTrack(p, op.track, (t) => { const { amp: _, ...rest } = t; return op.amp ? { ...rest, amp: op.amp } : rest; });
    case "plugin":
      return withTrack(p, op.track, (t) => { const { plugin: _, ...rest } = t; return op.plugin ? { ...rest, plugin: op.plugin } : rest; });
    case "insert":
      return withTrack(p, op.track, (t) => { const { insert: _, ...rest } = t; return op.insert ? { ...rest, insert: op.insert } : rest; });
    case "voiceless":
      if (!!p.tracks[op.track]?.voiceless === op.on) return p;
      return withTrack(p, op.track, (t) => { const { voiceless: _, ...rest } = t; return { ...rest, ...voicelessOf(op.on) }; });
    case "instrument": {
      const { inst } = op;
      const was = (p.instruments ?? []).filter((x) => x.id !== inst.id && x.track !== inst.track);
      const next = withTrack(p, inst.track, (t) => ({ name: inst.name, kind: "synth", root: op.root, params: op.params.map((v, i) => clampParam(i, v)), notes: [], auto: [], mute: false, solo: false, ...(t.eq ? { eq: t.eq } : {}), ...(t.amp ? { amp: t.amp } : {}), ...(t.insert ? { insert: t.insert } : {}) }));
      // the oldest goes when the room is full
      return { ...next, ...madeOf([...was, inst].slice(-MAX_MADE)) };
    }
    case "desk": {
      const { desk, ...rest } = p;
      return { ...rest, ...deskOf(withDeskEdit(desk ?? emptySeshDesk(), op)) };
    }
    case "studio": {
      // "yours" carries the leader's built room, so everyone walks into the same one; any other studio drops it
      const { built: _, ...rest } = p;
      if (op.id === "yours" && op.built) return { ...rest, studio: op.id, built: op.built };
      return op.id === p.studio && !p.built ? p : { ...rest, studio: op.id };
    }
    case "rig":
      return op.id === p.rig ? p : { ...p, rig: op.id };
    case "replace": {
      // an undo or a loaded groove keeps the room where the leader put it: moving it is the leader's alone
      const next = sanitize(op.project);
      if (!next) return p;
      const { studio: _, rig: __, built: ___, ...rest } = next;
      return { ...rest, ...studioOf(p.studio), ...rigOf(p.rig), ...builtOf(p.built) };
    }
    case "song": {
      if (!op.chain) { const { song: _, ...rest } = p; return rest; }
      const was = p.song ?? { bars: p.bars, chain: [0] }, song: Song = { bars: was.bars, chain: op.chain.slice(0, MAX_CHAIN) };
      const bars = song.bars * song.chain.length;
      if (bars > MAX_BARS || !song.chain.length) return p;
      // each pattern as the old chain had it, laid out along the new one
      const next = laidOut({ ...p, bars, song }, was, song);
      return { ...next, tracks: fitTakes(next.tracks, bars * BEATS_PER_BAR) };
    }
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

/** Which tracks have no instrument: the sequencer plays their notes to nothing (their take still sounds). */
export const voiceless = (p: Project): boolean[] => p.tracks.map((t) => !!t.voiceless);
