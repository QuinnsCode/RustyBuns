// The show at front of house: the bigger bar's room with the rig up and the band on stage, and you at the desk. Each of
// the band's five parts is a channel on the desk (trim, fader, up to three notches in its Shape EQ, a send to the
// singer's wedge), and the set list plays them as stems. The crowd meter climbs while the mix sits where the song wants
// it and falls while anything is wrong. Feedback is computed (packages/gear `feedback`): the vocal mic hears the wedge
// at the distance and angle they stand at, through the channel's trim, send and EQ, and above 0 dB a band rings.
// Through the set the band asks for things: "more me" (a hand at the wedge), a broken string (hand the spare guitar
// up), a dying cable on the bass (swap it at the bass rig). Plain data and one `stepShow`, no DOM.
import { clamp } from "@rustybuns/util";
import { type EqBand, type Feedback, UNITY_LOOP_DB, aimTo, feedback, offAxisLoss, source } from "@rustybuns/gear";
import { assist } from "../assists.ts";
import { REACH, type Answer, type Item, type Level, type World } from "../sim.ts";

export const SHOW: Level = {
  name: "show",
  bounds: { x0: -3.75, x1: 3.75, z0: 0.25, z1: 20.55 },
  room: { x0: -4, x1: 4, z0: 0, z1: 14, height: 3.2, door: 2.4 },
  outlets: [],
  start: { x: 0, z: 13.2, yaw: 0 },
  // The truck outside the door: after the set, the whole night comes down into it.
  truck: { x0: -1.2, x1: 1.2, z0: 15.8, z1: 20.8, h: 2.4 },
  items: [
    { key: "top-l", gear: "top-15-passive", x: -3.2, y: 0, z: 3.4, rot: 0.25 },
    { key: "top-r", gear: "top-15-passive", x: 3.2, y: 0, z: 3.4, rot: -0.25 },
    { key: "sub-l", gear: "sub-18", x: -2.4, y: 0, z: 3.4, rot: 0 },
    { key: "sub-r", gear: "sub-18", x: 2.4, y: 0, z: 3.4, rot: 0 },
    { key: "mic-vox", gear: "mic-stand", x: 0, y: 0, z: 1.75, rot: Math.PI },
    { key: "wedge-vox", gear: "wedge-12", x: 0, y: 0, z: 2.7, rot: Math.PI },
    { key: "amp-gtr", gear: "amp-head", x: -2.2, y: 0.76, z: 0.4, rot: 0 },
    { key: "cab-gtr", gear: "cab-4x12", x: -2.2, y: 0, z: 0.4, rot: 0 },
    { key: "guitar-spare", gear: "guitar", x: -3.4, y: 0, z: 0.5, rot: 0 },
    { key: "rack", gear: "amp-rack-4u", x: 3.3, y: 0, z: 0.6, rot: 0 },
    { key: "desk-case", gear: "road-case-m", x: 0, y: 0, z: 10, rot: 0 },
    { key: "desk", gear: "mixer-small", x: 0, y: 0.5, z: 10, rot: Math.PI },
  ],
};

/** Where the band stand: the singer behind the vocal mic, the guitarist by the amp, the bassist stage right. */
export const BAND = {
  singer: { x: 0, z: 1.45, head: 1.6 },
  guitarist: { x: -2.2, z: 1.3, head: 1.7 },
  bassist: { x: 2.2, z: 1.3, head: 1.7 },
} as const;

export const CHANNELS = ["kick", "snare", "bass", "guitar", "vocal"] as const;
export type Channel = (typeof CHANNELS)[number];

/** A channel strip: trim over the part's nominal, the fader to the house, the wedge send, and the notches in its Shape EQ. */
export type Strip = { trim: number; fader: number; send: number; eq: EqBand[] };
export type Desk = Record<Channel, Strip>;

/** How loud each part comes off the stage into the house at 0 trim and 0 fader, dB SPL at the desk. */
export const STEM_DB: Record<Channel, number> = { kick: 98, snare: 97, bass: 96, guitar: 96, vocal: 92 };
/** Where each part should sit at the desk, dB SPL: the vocal on top. A solo pushes the guitar by `SOLO_PUSH`. */
export const TARGET_DB: Record<Channel, number> = { kick: 98, snare: 96, bass: 96, guitar: 95, vocal: 99 };
export const SOLO_PUSH = 5;
/** Within this many dB of where it should sit, a part is right. */
export const MIX_WINDOW = 3;
/** A singer at this level on the grille, dB SPL. */
export const VOICE_DB = 94;
/** The wedge sits tilted up this far, radians, aimed at the singer's head. */
export const WEDGE_PITCH = 0.85;
export const NOTCHES = 3, NOTCH_DB = -9, NOTCH_Q = 4;

/** The desk as the band leaves it at line check: the vocal a touch low in the house, a little of it in the wedge. */
export function newDesk(): Desk {
  const strip = (fader: number, send = -Infinity): Strip => ({ trim: 0, fader, send, eq: [] });
  return { kick: strip(0), snare: strip(-1), bass: strip(0), guitar: strip(-1), vocal: strip(2, 4) };
}

export type Move = { trim?: number; fader?: number; send?: number };
/** Nudge a channel's trim, fader and send by dB (trim -12..12, fader -40..10, send -30..12). */
export function nudge(d: Desk, ch: Channel, m: Move) {
  const s = d[ch];
  if (m.trim) s.trim = clamp(s.trim + m.trim, -12, 12);
  if (m.fader) s.fader = clamp(s.fader + m.fader, -40, 10);
  if (m.send) s.send = clamp((Number.isFinite(s.send) ? s.send : -30) + m.send, -30, 12);
}

/** Put a notch at `hz` (or take the one there out). A channel has room for three. */
export function notch(d: Desk, ch: Channel, hz: number): Answer {
  const eq = d[ch].eq, at = eq.findIndex((b) => b.hz === hz);
  if (at >= 0) return eq.splice(at, 1), { ok: true };
  if (eq.length >= NOTCHES) return { ok: false, why: `the ${ch} channel has no notch left` };
  eq.push({ hz, db: NOTCH_DB, q: NOTCH_Q });
  return { ok: true };
}

/** A song in the set: its tempo and root (for the stems), how long it runs, and the bars where the guitar solos. */
export type Song = { name: string; bpm: number; root: number; seconds: number; solo?: [number, number] };
export const SET_LIST: readonly Song[] = [
  { name: "Low Ceiling", bpm: 112, root: 82.41, seconds: 70 },
  { name: "Brake Lights", bpm: 128, root: 98, seconds: 75, solo: [40, 58] },
  { name: "Last Orders", bpm: 96, root: 73.42, seconds: 70 },
];
export const SET_SECONDS = SET_LIST.reduce((s, x) => s + x.seconds, 0);

export type CueKind = "more-me" | "broken-string" | "dying-cable";
/** When each thing goes wrong, seconds into the set. */
export const CUES: readonly { kind: CueKind; at: number }[] = [
  { kind: "more-me", at: 20 },
  { kind: "broken-string", at: 95 },
  { kind: "dying-cable", at: 160 },
];
/** What each cue looks like from the desk, and what fixes it. */
export const CUE_TEXT: Record<CueKind, { seen: string; fix: string }> = {
  "more-me": { seen: "The singer points at the wedge: more me", fix: "raise the vocal send" },
  "broken-string": { seen: "The guitar stops, a string hanging off", fix: "take the spare guitar up to the guitarist" },
  "dying-cable": { seen: "The bass crackles and cuts out", fix: "swap the cable at the bass rig" },
};

export type Cue = { kind: CueKind; since: number; /** more-me: the wedge level asked for at the singer's head, dB SPL. */ wants?: number };

export type Show = {
  /** Seconds into the set; the show is on between `start` and the last song's end. */
  t: number;
  on: boolean;
  done: boolean;
  /** The crowd meter, 0 to 100. */
  crowd: number;
  open: Cue[];
  fixed: CueKind[];
  missed: CueKind[];
  /** Seconds the PA rang, over the whole set. */
  rang: number;
  next: number;
};

export const newShow = (): Show => ({ t: 0, on: false, done: false, crowd: 60, open: [], fixed: [], missed: [], rang: 0, next: 0 });

/** Doors: the set starts. */
export function startShow(s: Show): Answer {
  if (s.on || s.done) return { ok: false, why: s.done ? "the set is over" : "the band is already on" };
  s.on = true;
  return { ok: true };
}

/** The song playing at `t` seconds into the set, and how far into it. */
export function songAt(t: number): { song: Song; index: number; at: number } {
  let start = 0;
  for (let i = 0; i < SET_LIST.length; i++) {
    const song = SET_LIST[i]!;
    if (t < start + song.seconds || i === SET_LIST.length - 1) return { song, index: i, at: t - start };
    start += song.seconds;
  }
  throw new Error("an empty set list");
}

export const soloOn = (t: number) => {
  const { song, at } = songAt(t);
  return !!song.solo && at >= song.solo[0] && at < song.solo[1];
};

const item = (w: World, key: string): Item => {
  const i = w.items.find((x) => x.key === key);
  if (!i) throw new Error(`the show needs ${key}`);
  return i;
};

/** The wedge as a source, where it sits and how it is turned. */
export const wedgeSource = (w: World) => {
  const i = item(w, "wedge-vox");
  return source("wedge-12", { x: i.x, y: i.y + 0.2, z: i.z }, { yaw: i.rot, pitch: WEDGE_PITCH });
};

/** The vocal loop: the mic on its stand at the singer's mouth, through the channel, out of the wedge. */
export function ring(w: World, d: Desk): Feedback {
  const m = item(w, "mic-vox"), v = d.vocal;
  return feedback({
    mic: { pos: { x: m.x, y: BAND.singer.head, z: m.z }, yaw: m.rot, pitch: 0, pattern: "cardioid" },
    gainDb: v.trim, eq: v.eq, wedges: [{ wedge: wedgeSource(w), sendDb: v.send }],
  });
}

/** How loud the singer hears the voice in the wedge, dB SPL at the singer's head (what "more me" asks to go up). */
export function meDb(w: World, d: Desk): number {
  const v = d.vocal, src = wedgeSource(w), head = { x: BAND.singer.x, y: BAND.singer.head, z: BAND.singer.z };
  if (!Number.isFinite(v.send)) return -Infinity;
  const { h, v: vv, d: dist } = aimTo(src, head);
  return VOICE_DB + UNITY_LOOP_DB + v.trim + v.send - 20 * Math.log10(Math.max(dist, 0.3)) - offAxisLoss(src.speaker, h, vv);
}

/** A channel in the house: its level at the desk, where the song wants it, and whether it is right (a dead one never is). */
export type Mixed = { db: number; target: number; ok: boolean; dead: boolean };
export function mix(d: Desk, s: Show): Record<Channel, Mixed> {
  const one = (ch: Channel): Mixed => {
    const dead = (ch === "guitar" && s.open.some((c) => c.kind === "broken-string")) || (ch === "bass" && s.open.some((c) => c.kind === "dying-cable"));
    const db = STEM_DB[ch] + d[ch].trim + d[ch].fader;
    const target = TARGET_DB[ch] + (ch === "guitar" && soloOn(s.t) ? SOLO_PUSH : 0);
    return { db: Math.round(db * 10) / 10, target, ok: !dead && Math.abs(db - target) <= MIX_WINDOW, dead };
  };
  return { kick: one("kick"), snare: one("snare"), bass: one("bass"), guitar: one("guitar"), vocal: one("vocal") };
}

/** Crowd meter per second: up 1.5 with every part right, down while parts are off, fast while it rings, a little per open cue. */
const CROWD = { right: 1.5, off: 0.6, ring: 8, cue: 0.5, missed: 10 };

/**
 * One tick of the set: open the cues that are due, close the ones the desk has answered (more-me: the singer hears what
 * was asked for), let the ones past the dial's window go as missed, and move the crowd meter.
 */
export function stepShow(w: World, d: Desk, s: Show, dt: number): { ringing: number[] } {
  if (!s.on) return { ringing: [] };
  s.t += dt;
  while (s.next < CUES.length && CUES[s.next]!.at <= s.t) {
    const kind = CUES[s.next++]!.kind;
    s.open.push({ kind, since: s.t, ...(kind === "more-me" ? { wants: Math.round((meDb(w, d) + 3) * 10) / 10 } : {}) });
  }
  for (const c of [...s.open]) {
    const done = c.kind === "more-me" && meDb(w, d) >= c.wants!;
    const late = s.t - c.since > assist("cueSeconds");
    if (!done && !late) continue;
    s.open.splice(s.open.indexOf(c), 1);
    (done ? s.fixed : s.missed).push(c.kind);
    if (!done) s.crowd -= CROWD.missed;
  }
  const r = ring(w, d), m = Object.values(mix(d, s));
  const right = m.filter((x) => x.ok).length;
  const rate = right === m.length ? CROWD.right : -CROWD.off * (m.length - right);
  s.crowd = clamp(s.crowd + dt * (rate - (r.ringing.length ? CROWD.ring : 0) - CROWD.cue * s.open.length), 0, 100);
  if (r.ringing.length) s.rang += dt;
  if (s.t >= SET_SECONDS) s.on = false, s.done = true;
  return { ringing: r.ringing };
}

const near = (w: World, p: { x: number; z: number }) => Math.hypot(w.you.x - p.x, w.you.z - p.z) <= REACH;

/** Fix a cue that needs your hands on stage: the spare guitar to the guitarist, a new cable on the bass. */
export function fixOnStage(w: World, s: Show, kind: "broken-string" | "dying-cable"): Answer {
  const c = s.open.find((x) => x.kind === kind);
  if (!c) return { ok: false, why: kind === "broken-string" ? "the strings are fine" : "the bass cable is fine" };
  const who = kind === "broken-string" ? BAND.guitarist : BAND.bassist;
  if (!near(w, who)) return { ok: false, why: kind === "broken-string" ? "the guitarist is out of reach" : "the bass rig is out of reach" };
  s.open.splice(s.open.indexOf(c), 1);
  s.fixed.push(kind);
  return { ok: true };
}

/** Whether you stand at the desk, close enough to work it. */
export const atDesk = (w: World) => near(w, item(w, "desk"));

/** What the harness reads: the set, the crowd, the cues, the mix, the loop and the singer's wedge level. */
export function showState(w: World, d: Desk, s: Show) {
  const r = ring(w, d), { song, index, at } = songAt(s.t);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    on: s.on, done: s.done, t: r1(s.t), song: song.name, index, at: r1(at), solo: s.on && soloOn(s.t), crowd: Math.round(s.crowd),
    open: s.open.map((c) => c.kind), fixed: s.fixed, missed: s.missed, rang: r1(s.rang),
    ringing: r.ringing, margin: r1(r.margin), worstHz: r.worst.hz, me: r1(meDb(w, d)), wants: s.open.find((c) => c.wants)?.wants ?? null,
    mix: mix(d, s), desk: d, atDesk: atDesk(w),
  };
}
