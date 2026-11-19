// A jam in a Qollab Studio room, as data: you (where you stand, which way you look, the spot you sit at, the
// camera), everyone else in the sesh as their live line says, and which keys play which FM DAW track at a spot.
// The page (main.ts) draws it and feeds it keys; the tests drive it with two clients and no DOM.
import { clamp } from "@rustybuns/util";
import type { Avatar } from "@rustybuns/util/avatar";
import type { Live, Project } from "../project.ts";
import { QWERTY } from "../ui/input.ts";
import { floorAt, propBlocks, propBox, thingBox, wallPieces, type Spot, type StudioDef } from "./room.ts";
import { pushOut as walkOut, type Rect } from "./walk.ts";

export const WALK = 2.2;           // metres a second
export const RADIUS = 0.3;         // your body, for walls and furniture
export const SIT_REACH = 1.4;      // how close to a seat you have to be to sit
export const EYE_STAND = 1.65, EYE_SIT = 1.2;
/** Where a seat's view starts, first person: looking down over your hands on the keys, and on the drums round your knees. */
export const SIT_PITCH = -0.65, KIT_PITCH = -0.62;
const sitPitch = (s: Spot | null) => (s?.kind === "drums" ? KIT_PITCH : SIT_PITCH);
/** How often your body goes on the live line, a second (others see you walk at this rate). */
export const BODY_HZ = 10;

export type Cam = "shoulder" | "first";
export interface Me { x: number; z: number; yaw: number; pitch: number; seat: string | null; cam: Cam }
/** Someone else in the room, from their live line: where they are, their seat, who they look like, the notes they hold. */
export interface Other { at: [number, number]; yaw: number; seat: string | null; avatar: Avatar | null; name: string; held: Set<string> }
/** `away`: who on the live line is in the sesh's gear room (src/room/), not this room: they have no body here. */
export interface Jam { def: StudioDef; me: Me; others: Map<number, Other>; away: Set<number> }
export interface Input { forward: number; right: number; turn: number }

export function newJam(def: StudioDef): Jam {
  return { def, me: { x: def.door.at[0], z: def.door.at[1], yaw: def.door.yaw, pitch: 0, seat: null, cam: "shoulder" }, others: new Map(), away: new Set() };
}

export const spotOf = (j: Jam, id: string | null) => (id ? j.def.spots.find((s) => s.id === id) ?? null : null);

/** Who sits at a spot: "me", another player's peer number, or null when it's free. */
export function sitter(j: Jam, id: string): "me" | number | null {
  if (j.me.seat === id) return "me";
  for (const [peer, o] of j.others) if (o.seat === id) return peer;
  return null;
}

export function solids(def: StudioDef): Rect[] {
  return [...def.walls.flatMap((w) => wallPieces(w)), ...def.spots.map(thingBox), ...(def.props ?? []).filter(propBlocks).map(propBox)];
}
const pushOut = (def: StudioDef, p: { x: number; z: number }) => walkOut(p, solids(def), def.size.w / 2, def.size.d / 2, RADIUS);

/** One tick of walking. Sitting, you only look around: stand up to walk. */
export function step(j: Jam, dt: number, i: Input) {
  const m = j.me;
  m.yaw += i.turn;
  if (m.seat) return;
  const len = Math.hypot(i.forward, i.right);
  if (len === 0) return;
  const k = (WALK * dt) / Math.max(1, len), fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw);
  m.x += (fx * i.forward - fz * i.right) * k;
  m.z += (fz * i.forward + fx * i.right) * k;
  pushOut(j.def, m);
}

/** Walk straight to (x, z), tick by tick, for probes and tests; the seconds it took. */
export function walkTo(j: Jam, x: number, z: number): number {
  let t = 0;
  for (; t < 30; t += 1 / 60) {
    const dx = x - j.me.x, dz = z - j.me.z;
    if (Math.hypot(dx, dz) < 0.05) break;
    j.me.yaw = Math.atan2(-dx, -dz);
    const bx = j.me.x, bz = j.me.z;
    step(j, Math.min(1 / 60, Math.hypot(dx, dz) / WALK), { forward: 1, right: 0, turn: 0 });
    if (Math.hypot(j.me.x - bx, j.me.z - bz) < 1e-4) break;   // something's in the way
  }
  return t;
}

/** The free seat nearest you within reach, the one a click or E sits you at. */
export function nearSpot(j: Jam): Spot | null {
  let best: Spot | null = null, bestD = SIT_REACH;
  for (const s of j.def.spots) {
    const d = Math.hypot(s.at[0] - j.me.x, s.at[1] - j.me.z);
    if (d <= bestD && sitter(j, s.id) === null) { best = s; bestD = d; }
  }
  return best;
}

export type Answer = { ok: true } | { ok: false; why: string };
/** Sit at a spot: you're put in its seat, facing its instrument, and the camera goes first person. */
export function sit(j: Jam, id: string): Answer {
  const s = spotOf(j, id);
  if (!s) return { ok: false, why: `There's no ${id} here` };
  const who = sitter(j, id);
  if (who === "me") return { ok: true };
  if (who !== null) return { ok: false, why: `${j.others.get(who)?.name || "Someone"} is at ${s.label}` };
  if (Math.hypot(s.at[0] - j.me.x, s.at[1] - j.me.z) > SIT_REACH) return { ok: false, why: `Walk up to ${s.label} first` };
  Object.assign(j.me, { x: s.at[0], z: s.at[1], yaw: s.yaw, pitch: sitPitch(s), seat: id, cam: "first" });
  return { ok: true };
}

/** Stand up a step back from the seat, and the camera goes back over your shoulder. */
export function stand(j: Jam) {
  const s = spotOf(j, j.me.seat);
  if (!s) return;
  j.me.seat = null;
  j.me.cam = "shoulder";
  j.me.pitch = 0;
  j.me.x -= -Math.sin(s.yaw) * 0.6;
  j.me.z -= -Math.cos(s.yaw) * 0.6;
  pushOut(j.def, j.me);
}

/** V: over the shoulder or first person, standing or sitting. */
export function toggleCam(j: Jam) { j.me.cam = j.me.cam === "first" ? "shoulder" : "first"; }

/** Is (x, z) somewhere a camera can't be: outside the room, or inside a wall (glass too, or you'd see the room from the next one)? */
function walled(def: StudioDef, x: number, z: number, pad = 0.15): boolean {
  if (Math.abs(x) > def.size.w / 2 - pad || Math.abs(z) > def.size.d / 2 - pad) return true;
  return def.walls.flatMap((w) => wallPieces(w)).some((s) => {
    const c = Math.cos(s.turn), sn = Math.sin(s.turn), dx = x - s.cx, dz = z - s.cz;
    return Math.abs(dx * c - dz * sn) < s.hw + pad && Math.abs(dx * sn + dz * c) < s.hd + pad;
  });
}

/** The full over-the-shoulder boom, metres behind you. */
export const BOOM = 2.1;
/** Seated over the shoulder: the camera up beside your right shoulder (metres back, out to the side, above your eyes), looking down past it at a point this far in front of the seat. */
export const SEAT_CAM = { back: 0.3, side: 0.5, up: 0.45, reach: 0.7, at: 0.75 };
/** First person, seated: your eyes this far (metres) back over the seat and up above EYE_SIT, where your figure's eyes
 *  are once it sits, so you look down over your own chest and arms at your hands, and the instrument sits below you. */
export const SIT_EYE = { back: 0.04, up: 0.15 };

/**
 * Where the camera is. Over the shoulder, its boom shortens to stay in front of a wall behind you (a camera pinned
 * to the wall would sit inside your head), and rises and looks down as it shortens so you see past yourself.
 * `boom` is how long it came out: the page stops drawing you when it's too short to see past. `head` is how solid to
 * draw your own head (1 solid): close to the camera, seated beside your shoulder, it fades so the keys and the kit show through.
 */
export function cameraPose(j: Jam): { at: [number, number, number]; yaw: number; pitch: number; boom: number; head: number } {
  const p = pose(j), m = j.me, eye = m.seat ? EYE_SIT : EYE_STAND, lift = floorAt(j.def, m.x, m.z);
  // up on a riser, the camera rides up with you
  return { ...p, at: [p.at[0], p.at[1] + lift, p.at[2]], head: headFade(Math.hypot(p.at[0] - m.x, p.at[1] - eye, p.at[2] - m.z)) };
}

/** How solid your head is drawn, the camera this far (metres) from it: solid out on the full boom, see-through up close. */
export function headFade(d: number): number { return clamp((d - HEAD_FADE.near) / (HEAD_FADE.far - HEAD_FADE.near), HEAD_FADE.min, 1); }
/** Nearer than `near` the head is `min` solid (0: not drawn, no haze over the keys); past `far`, solid. The seated shoulder camera is about 0.7 m away, the full boom 2.2. */
export const HEAD_FADE = { near: 1.3, far: 1.9, min: 0 };

function pose(j: Jam): { at: [number, number, number]; yaw: number; pitch: number; boom: number } {
  const m = j.me, eye = m.seat ? EYE_SIT : EYE_STAND;
  const fx = -Math.sin(m.yaw), fz = -Math.cos(m.yaw), side = 0.45 / BOOM;
  // first person, seated: your eyes sit back over the seat, not out over the instrument
  if (m.cam === "first") { const b = m.seat ? SIT_EYE.back : 0, y = eye + (m.seat ? SIT_EYE.up : 0); return { at: [m.x - fx * b, y, m.z - fz * b], yaw: m.yaw, pitch: m.pitch, boom: 0 }; }
  if (m.seat) {
    // seated: beside you, not behind your head, so your hands and the instrument are in view; it comes in toward you
    // until it's clear of a wall
    const c = SEAT_CAM;
    for (let i = 10; i >= 3; i--) {
      const k = i / 10, x = m.x - fx * c.back * k - fz * c.side * k, z = m.z - fz * c.back * k + fx * c.side * k;
      if (i > 3 && walled(j.def, x, z)) continue;
      const y = eye + c.up, tx = m.x + fx * c.reach, tz = m.z + fz * c.reach, dx = tx - x, dz = tz - z;
      const pitch = clamp(Math.atan2(c.at - y, Math.hypot(dx, dz)) + m.pitch - sitPitch(spotOf(j, m.seat)), -1.4, 1.2);
      return { at: [x, y, z], yaw: Math.atan2(-dx, -dz), pitch, boom: BOOM * k };
    }
  }
  // back along the boom from your head, a few centimetres at a time, until a wall is next
  let boom = 0;
  for (let b = 0.05; b <= BOOM + 1e-9; b += 0.05) {
    if (walled(j.def, m.x - (fx + fz * side) * b, m.z - (fz - fx * side) * b)) break;
    boom = b;
  }
  const short = 1 - boom / BOOM;
  return { at: [m.x - (fx + fz * side) * boom, eye + 0.35 + short * 0.5, m.z - (fz - fx * side) * boom], yaw: m.yaw, pitch: m.pitch - 0.12 - short * 0.35, boom };
}

/** What goes on the live line about you. */
export function body(j: Jam): Live {
  const m = j.me, r = (v: number) => Math.round(v * 100) / 100;
  const yaw = Math.atan2(Math.sin(m.yaw), Math.cos(m.yaw));
  return { t: "body", at: [r(m.x), 0, r(m.z)], yaw: r(yaw), ...(m.seat ? { seat: m.seat } : {}) };
}

function other(j: Jam, from: number): Other {
  let o = j.others.get(from);
  if (!o) j.others.set(from, (o = { at: [j.def.door.at[0], j.def.door.at[1]], yaw: j.def.door.yaw, seat: null, avatar: null, name: "", held: new Set() }));
  return o;
}

/** Someone's live event: their body, their look, or a note they play. */
export function hear(j: Jam, from: number, e: Live) {
  // a body in the gear room: they are in the sesh but not in this room, whatever else they say
  if (e.t === "body" && e.room) { j.others.delete(from); j.away.add(from); return; }
  if (j.away.has(from)) return;
  if (e.t === "body") {
    const o = other(j, from);
    o.at = [e.at[0], e.at[2]];
    o.yaw = e.yaw;
    o.seat = e.seat && spotOf(j, e.seat) ? e.seat : null;
    return;
  }
  if (e.t === "wear") { const o = other(j, from); o.avatar = e.avatar; o.name = e.name; return; }
  if (e.t === "on") other(j, from).held.add(`${e.track}:${e.midi}`);
  else if (e.t === "off") j.others.get(from)?.held.delete(`${e.track}:${e.midi}`);
}

/** They left: their avatar goes, and so do the notes they held. */
export function gone(j: Jam, from: number) { j.others.delete(from); j.away.delete(from); }

/** The FM DAW track a spot plays in this project, or -1. */
export function trackFor(s: Spot, p: Project): number {
  if (s.ix !== undefined) return s.ix < p.tracks.length ? s.ix : -1;
  if (!s.track) return -1;
  const want = s.track.toLowerCase();
  const named = p.tracks.findIndex((t) => t.name.toLowerCase().includes(want));
  if (named >= 0) return named;
  // no track by that name: keys take the first synth that isn't a bass, bass the first synth
  const synths = p.tracks.map((t, i) => ({ t, i })).filter((x) => x.t.kind === "synth");
  return (s.kind === "bass" ? synths[0] : synths.find((x) => !x.t.name.toLowerCase().includes("bass")))?.i ?? -1;
}

/** The kit's keys, one drum track each in order: A kick, S snare, and so on along the home row. */
export const DRUM_KEYS = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL"];

/** The note a key plays at the spot you sit at, or null (not seated, not an instrument, not one of its keys). */
export function keyNote(j: Jam, p: Project, code: string, octave = 0): { track: number; midi: number } | null {
  const s = spotOf(j, j.me.seat);
  if (!s) return null;
  if (s.kind === "drums") {
    const drums = p.tracks.map((t, i) => ({ t, i })).filter((x) => x.t.kind === "drum");
    const d = drums[DRUM_KEYS.indexOf(code)];
    return d ? { track: d.i, midi: d.t.root } : null;
  }
  const track = trackFor(s, p), semi = QWERTY[code];
  if (track < 0 || semi === undefined) return null;
  const midi = p.tracks[track].root + 12 * octave + semi;
  return midi >= 0 && midi <= 127 ? { track, midi } : null;
}

/** What a probe or a test reads. */
export function snapshot(j: Jam, p: Project | null) {
  const m = j.me, r = (v: number) => Math.round(v * 100) / 100, s = spotOf(j, m.seat);
  return {
    room: j.def.id,
    you: { x: r(m.x), z: r(m.z), yaw: r(m.yaw), pitch: r(m.pitch), seat: m.seat, cam: m.cam, plays: s && p ? trackFor(s, p) : -1 },
    near: nearSpot(j)?.id ?? null,
    spots: j.def.spots.map((x) => ({ id: x.id, kind: x.kind, at: x.at, by: sitter(j, x.id), track: p ? trackFor(x, p) : -1 })),
    others: [...j.others].map(([peer, o]) => ({ peer, name: o.name, at: o.at.map(r), yaw: r(o.yaw), seat: o.seat, dressed: !!o.avatar, playing: [...o.held] })),
  };
}
