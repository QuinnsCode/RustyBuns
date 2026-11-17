// The jam room, pure (no DOM, no three.js): you as your avatar in a studio (./def.ts), walking it with the camera over
// your shoulder, sitting at a spot (the camera goes first person and your keys play that spot's FM DAW track), and
// everyone else in the sesh where their bodies say they are. What you do goes out as live events (`out`, flushed by
// the page onto the sesh's live line, ../ui/net.ts): your body about 10 times a second, and each note you play.
import { defaultAvatar, type Avatar } from "@rustybuns/util/avatar";
import type { Live } from "../project.ts";
import { KIT } from "../presets.ts";
import { QWERTY } from "../ui/input.ts";
import { PARTITION_T, type Spot, type SpotKind, type StudioDef } from "./def.ts";
import { stepFeet, walkFeet, type Input, type Rect } from "./walk.ts";

/** Eye height standing and sitting, metres. */
export const EYE = 1.62, SEATED_EYE = 1.2;
/** How close to a seat you have to be to sit in it. */
export const SIT_REACH = 1.3;
/** Your body goes out this often, seconds; your avatar with every AVATAR_EVERY-th body. */
export const BODY_EVERY = 0.1, AVATAR_EVERY = 20;
/** Someone who played a note in this long shows playing. */
export const PLAYING_FOR = 0.5;
const HEARD_KEEP = 32;
/** The drum spot's keys: the home row from A, a kit piece each. */
export const KIT_KEYS = ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK"];

/** What stands at each kind of spot: its footprint (width, depth) and how far in front of the seat it is (behind: negative). */
export const GEAR_AT: Record<SpotKind, { w: number; d: number; ahead: number }> = {
  keys: { w: 1.3, d: 0.4, ahead: 0.5 },
  drums: { w: 1.5, d: 0.9, ahead: 0.75 },
  bass: { w: 0.6, d: 0.4, ahead: 0.8 },
  vocal: { w: 0.3, d: 0.3, ahead: 0.55 },
  desk: { w: 1.9, d: 0.6, ahead: 0.55 },
  couch: { w: 1.9, d: 0.7, ahead: -0.2 },
};

export interface Body { x: number; z: number; yaw: number; pitch: number; spot: string | null }
export interface Other { x: number; z: number; yaw: number; spot: string | null; avatar: Avatar; playingUntil: number }
export interface Heard { from: number; track: number; midi: number; vel: number; at: number }
export interface Jam {
  def: StudioDef;
  me: Body;
  avatar: Avatar;
  view: "third" | "first";
  /** Seconds since you walked in. */
  now: number;
  others: Map<number, Other>;
  /** The keyboard's octave shift (Z / X), and where each track's C sits (the sesh's project says; FM DAW's kit until then). */
  octave: number;
  roots: number[];
  /** Keys held down now: what they play, so letting go stops that note even after an octave change. */
  held: Map<string, { track: number; midi: number }>;
  /** Notes other people played, newest last. */
  heard: Heard[];
  /** Live events for the sesh, oldest first: the page sends them and empties it. */
  out: Live[];
  sinceBody: number;
  bodies: number;
}

export type Answer = { ok: true } | { ok: false; why: string };
const no = (why: string): Answer => ({ ok: false, why });

export function newJam(def: StudioDef, avatar: Avatar): Jam {
  return {
    def, avatar, view: "third", now: 0, others: new Map(), octave: 0, roots: KIT.map((k) => k.root), held: new Map(), heard: [], out: [], sinceBody: BODY_EVERY, bodies: 0,
    me: { x: def.door.at[0], z: def.door.at[1], yaw: def.door.yaw, pitch: -0.1, spot: null },
  };
}

export const spotOf = (j: Jam, id: string | null) => j.def.spots.find((s) => s.id === id);
const forward = (yaw: number): [number, number] => [-Math.sin(yaw), -Math.cos(yaw)];

/** Where a spot's gear stands, as a box seen from above. */
export function gearRect(s: Spot): Rect {
  const g = GEAR_AT[s.kind], [fx, fz] = forward(s.yaw);
  return { cx: s.at[0] + fx * g.ahead, cz: s.at[1] + fz * g.ahead, hw: g.w / 2, hd: g.d / 2, turn: s.yaw };
}

function partitionRects(def: StudioDef): Rect[] {
  return def.partitions.map((p) => {
    const dx = p.to[0] - p.from[0], dz = p.to[1] - p.from[1];
    return { cx: (p.from[0] + p.to[0]) / 2, cz: (p.from[1] + p.to[1]) / 2, hw: Math.hypot(dx, dz) / 2, hd: PARTITION_T / 2, turn: -Math.atan2(dz, dx) };
  });
}

/** Everything you can't walk through: the inside walls and the gear at every spot. */
export const solids = (def: StudioDef): Rect[] => [...partitionRects(def), ...def.spots.map(gearRect)];

/** Who sits at a spot (their peer number), if anyone else does. */
export function takenBy(j: Jam, id: string): number | undefined {
  for (const [peer, o] of j.others) if (o.spot === id) return peer;
  return undefined;
}

/** The free seat nearest you, within reach. */
export function nearSpot(j: Jam): Spot | undefined {
  let best: Spot | undefined, bestD = SIT_REACH;
  for (const s of j.def.spots) {
    const d = Math.hypot(s.at[0] - j.me.x, s.at[1] - j.me.z);
    if (d <= bestD && takenBy(j, s.id) === undefined) { best = s; bestD = d; }
  }
  return best;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function sendBody(j: Jam) {
  const avatar = j.bodies % AVATAR_EVERY === 0 ? j.avatar : undefined;
  j.out.push({ t: "body", at: [j.me.x, 0, j.me.z], yaw: wrap(j.me.yaw), ...(j.me.spot ? { spot: j.me.spot } : {}), ...(avatar ? { avatar } : {}) });
  j.bodies++;
  j.sinceBody = 0;
}

/** One tick: the clock, walking (standing only: sat, your keys are notes), and your body out to the sesh 10 times a second. */
export function step(j: Jam, dt: number, input: Input) {
  j.now += dt;
  if (j.me.spot) j.me.yaw += input.turn;
  else stepFeet(j.me, dt, input, solids(j.def), j.def.size[0] / 2, j.def.size[1] / 2);
  j.sinceBody += dt;
  if (j.sinceBody >= BODY_EVERY) sendBody(j);
}

/** Walk straight to (x, z); the seconds it took. */
export const walkTo = (j: Jam, x: number, z: number) => j.me.spot ? 0 : walkFeet(j.me, x, z, (dt, i) => step(j, dt, i));

/** Sit at a spot (the nearest free one when `id` is left out): the camera goes first person and your keys play there. */
export function sit(j: Jam, id?: string): Answer {
  if (j.me.spot) return no("you're sitting already");
  const s = id ? spotOf(j, id) : nearSpot(j);
  if (!s) return no(id ? `no spot called ${id}` : "walk up to a spot to sit");
  if (takenBy(j, s.id) !== undefined) return no(`someone is at the ${s.name.toLowerCase()}`);
  if (Math.hypot(s.at[0] - j.me.x, s.at[1] - j.me.z) > SIT_REACH) return no(`walk up to the ${s.name.toLowerCase()}`);
  Object.assign(j.me, { x: s.at[0], z: s.at[1], yaw: s.yaw, pitch: -0.55, spot: s.id });
  j.view = "first";
  sendBody(j);
  return { ok: true };
}

/** Get up: every note you hold stops, and the camera goes back over your shoulder. */
export function stand(j: Jam): Answer {
  const s = spotOf(j, j.me.spot);
  if (!s) return no("you're standing");
  for (const code of [...j.held.keys()]) release(j, code);
  // a step back from the seat, away from the gear
  const [fx, fz] = forward(s.yaw), back = GEAR_AT[s.kind].ahead > 0 ? -0.45 : 0.6;
  j.me.x += fx * back; j.me.z += fz * back;
  j.me.spot = null;
  j.me.pitch = -0.1;
  j.view = "third";
  step(j, 0, { forward: 0, right: 0, turn: 0 }); // out of anything the step back put you in
  sendBody(j);
  return { ok: true };
}

export const toggleView = (j: Jam) => { j.view = j.view === "first" ? "third" : "first"; };

/** What a key plays at your spot: a track and a note, or null (standing, a seat with no instrument, a key that isn't one). */
export function keyNote(j: Jam, code: string): { track: number; midi: number } | null {
  const s = spotOf(j, j.me.spot);
  if (!s) return null;
  if (s.kit) {
    const i = KIT_KEYS.indexOf(code), track = s.kit[i];
    return track === undefined ? null : { track, midi: j.roots[track] ?? 60 };
  }
  const semi = QWERTY[code];
  if (s.track === undefined || semi === undefined) return null;
  const midi = (j.roots[s.track] ?? 60) + j.octave * 12 + semi;
  return midi >= 0 && midi <= 127 ? { track: s.track, midi } : null;
}

/** What a MIDI keyboard's note plays at your spot: that note on the spot's track, or on a drum spot a kit piece per key from C2. */
export function midiNote(j: Jam, note: number): { track: number; midi: number } | null {
  const s = spotOf(j, j.me.spot);
  if (s?.kit?.length) { const track = s.kit[(((note - 36) % s.kit.length) + s.kit.length) % s.kit.length]; return { track, midi: j.roots[track] ?? 60 }; }
  return s?.track === undefined ? null : { track: s.track, midi: note };
}

/** A key down at your spot (`code` a key's code, or "midi:<n>" with `n` from midiNote): the note to play here, and the same note out to the sesh. */
export function press(j: Jam, code: string, vel = 0.8, n = keyNote(j, code)): { track: number; midi: number } | null {
  if (!n || j.held.has(code)) return null;
  j.held.set(code, n);
  j.out.push({ t: "on", track: n.track, midi: n.midi, vel });
  return n;
}

/** That key let go: the note it played, which the page stops too. */
export function release(j: Jam, code: string): { track: number; midi: number } | null {
  const n = j.held.get(code);
  if (!n) return null;
  j.held.delete(code);
  j.out.push({ t: "off", track: n.track, midi: n.midi });
  return n;
}

/** Z / X: the keyboard an octave down or up, three each way. */
export const shiftOctave = (j: Jam, d: -1 | 1) => { j.octave = Math.max(-3, Math.min(3, j.octave + d)); };

/** Someone else's live event: where their body is, or a note they played. */
export function onLive(j: Jam, from: number, e: Live) {
  if (e.t === "body") {
    const had = j.others.get(from);
    const o: Other = had ?? { x: 0, z: 0, yaw: 0, spot: null, avatar: defaultAvatar(`guest ${from}`), playingUntil: 0 };
    Object.assign(o, { x: e.at[0], z: e.at[2], yaw: e.yaw, spot: e.spot && spotOf(j, e.spot) ? e.spot : null });
    if (e.avatar) o.avatar = e.avatar;
    j.others.set(from, o);
  } else if (e.t === "on") {
    j.heard.push({ from, track: e.track, midi: e.midi, vel: e.vel, at: j.now });
    if (j.heard.length > HEARD_KEEP) j.heard.shift();
    const o = j.others.get(from);
    if (o) o.playingUntil = j.now + PLAYING_FOR;
  }
}

/** Someone left the sesh. */
export const gone = (j: Jam, from: number) => { j.others.delete(from); };

// ---- the camera ----

/** Does the floor segment a-b cross an inside wall? */
function throughWall(def: StudioDef, a: [number, number], b: [number, number]) {
  const cross = (o: number[], p: number[], q: number[]) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  return def.partitions.some((w) => {
    const d1 = cross(w.from, w.to, a), d2 = cross(w.from, w.to, b), d3 = cross(a, b, w.from), d4 = cross(a, b, w.to);
    return d1 * d2 < 0 && d3 * d4 < 0;
  });
}

/** Where the camera is and which way it looks: in your eyes (first person), or behind and over your right shoulder. */
export function camera(j: Jam): { at: [number, number, number]; yaw: number; pitch: number } {
  const { me, def } = j, eye = me.spot ? SEATED_EYE : EYE;
  if (j.view === "first") {
    const [fx, fz] = forward(me.yaw);
    return { at: [me.x + fx * 0.12, eye, me.z + fz * 0.12], yaw: me.yaw, pitch: me.pitch };
  }
  const [fx, fz] = forward(me.yaw), rx = -fz, rz = fx; // right of the way you face
  const hw = def.size[0] / 2 - 0.15, hd = def.size[1] / 2 - 0.15;
  const head: [number, number] = [me.x + rx * 0.35, me.z + rz * 0.35];
  // pull the boom in until the camera is inside the room and on your side of every inside wall
  let back = 2.2;
  for (; back > 0.4; back -= 0.1) {
    const p: [number, number] = [head[0] - fx * back, head[1] - fz * back];
    if (Math.abs(p[0]) < hw && Math.abs(p[1]) < hd && !throughWall(def, [me.x, me.z], p)) break;
  }
  return { at: [head[0] - fx * back, eye + 0.4, head[1] - fz * back], yaw: me.yaw, pitch: me.pitch - 0.12 };
}

// ---- the harness's view ----

const r2 = (v: number) => Math.round(v * 100) / 100;
/** The room as data (scripts/probe.ts HANDLES): you, the camera, the spots and who sits where, everyone else, what you heard. */
export function snapshot(j: Jam) {
  const near = nearSpot(j);
  return {
    room: j.def.id,
    you: { x: r2(j.me.x), z: r2(j.me.z), yaw: r2(j.me.yaw), pitch: r2(j.me.pitch), spot: j.me.spot },
    view: j.view,
    camera: (({ at, yaw, pitch }) => ({ at: at.map(r2), yaw: r2(yaw), pitch: r2(pitch) }))(camera(j)),
    near: near?.id ?? null,
    octave: j.octave,
    held: [...j.held.values()],
    spots: j.def.spots.map((s) => ({ id: s.id, name: s.name, at: s.at, track: s.track ?? null, kit: s.kit ?? null, by: s.id === j.me.spot ? "you" : takenBy(j, s.id) ?? null })),
    others: [...j.others].map(([peer, o]) => ({ peer, x: r2(o.x), z: r2(o.z), yaw: r2(o.yaw), spot: o.spot, playing: o.playingUntil > j.now })),
    heard: j.heard.slice(-8).map(({ from, track, midi }) => ({ from, track, midi })),
  };
}

