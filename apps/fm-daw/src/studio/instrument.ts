// Making an instrument in the jam room: a free FM DAW track gets a patch (FM or analog) and a name, and the room a
// seat at a synth grown from a seed, somewhere clear of the walls, the furniture and the doors. Pure: the page and
// an agent's tools (agent.ts) both build the same `instrument` edit with it, and the World applies it like any other.
import { int, num, obj, oneOf, opt, or, str, type Of } from "@rustybuns/util/guard";
import { NPARAMS, P, clampParam } from "../engine/params.ts";
import { KIT, patch } from "../presets.ts";
import { SOUNDS } from "../sounds.ts";
import type { Op, Project } from "../project.ts";
import { VOICES, type Instrument } from "./made.ts";
import { solids } from "./jam.ts";
import { thingBox, type Spot, type StudioDef } from "./room.ts";

/** A made synth's footprint in front of its seat: the widest the model grows (61 keys), so every seed fits. */
export const MADE_THING = { w: 1.1, d: 0.45, h: 0.95, ahead: 0.5, color: "#2a2c30" };

/** The room with its made instruments, each a keys seat at its own track. */
export function roomWith(def: StudioDef, p: Project | null): StudioDef {
  const made = p?.instruments ?? [];
  if (!made.length) return def;
  return { ...def, spots: [...def.spots.filter((s) => !made.some((m) => m.id === s.id)), ...made.map(madeSpot)] };
}

export const madeSpot = (m: Instrument): Spot => ({
  id: m.id, kind: "keys", label: m.name, at: [m.at[0], m.at[1]], yaw: m.yaw, thing: MADE_THING, ix: m.track, made: { seed: m.seed, voice: m.voice },
});

const unit = num(0, 1);
/** What a patch can say, every field optional: a sound to start from (a SOUNDS or kit name), then knobs over it. */
export const PatchArgs = obj({
  sound: opt(str(40)),
  /** Amp envelope, in seconds (sustain 0..1). */
  attack: opt(num(0.0005, 5)), decay: opt(num(0.01, 5)), sustain: opt(unit), release: opt(num(0.01, 5)),
  /** FM: the modulator's ratio to the carrier and how loud it is (brightness). */
  ratio: opt(num(0.5, 16)), brightness: opt(unit),
  /** Analog: the low-pass and its resonance, saw detune, sub, drive, glide. */
  cutoff: opt(unit), res: opt(unit), detune: opt(unit), sub: opt(unit), drive: opt(unit), glide: opt(unit),
  gain: opt(unit), send: opt(unit),
  /** Where the keys' lowest C sits (MIDI). */
  root: opt(int(12, 108)),
});
export type PatchArgs = Of<typeof PatchArgs>;

/** A spot to put it at: by another spot's id ("near the keys"), or a place on the floor. */
const Where = (v: unknown): { near: string } | { x: number; z: number } =>
  typeof v === "string" ? { near: str(24)(v) } : obj({ x: num(-50, 50), z: num(-50, 50) })(v);
export const MakeArgs = obj({ name: str(24, { min: 1 }), voice: oneOf(VOICES, "fm"), patch: or(PatchArgs, {}), spot: opt(Where) });
export type MakeArgs = Of<typeof MakeArgs>;

/** The track's parameters and root for a voice and patch. */
export function patchFor(voice: Instrument["voice"], a: PatchArgs): { params: number[]; root: number } {
  const want = a.sound?.toLowerCase();
  const from = want ? [...SOUNDS, ...KIT.filter((k) => k.kind === "synth")].find((s) => s.name.toLowerCase() === want) : undefined;
  const base = from?.params.slice() ?? (voice === "analog"
    ? patch({ ops: { 0: [1, 1, 0.005, 0.6, 0.7, 0.25] }, analog: { detune: 0.3, sub: 0.3, cutoff: 0.55, res: 0.25 }, gain: 0.45 })
    : patch({ ops: { 0: [1, 1, 0.002, 0.9, 0.4, 0.3], 1: [2, 0.4, 0.002, 0.6, 0.2, 0.3] }, gain: 0.45 }));
  const set = (i: number, v: number | undefined) => { if (v !== undefined) base[i] = v; };
  base[P.MODE] = voice === "analog" ? 1 : 0;
  set(P.attack(0), a.attack); set(P.decay(0), a.decay); set(P.sustain(0), a.sustain); set(P.release(0), a.release);
  set(P.ratio(1), a.ratio); set(P.level(1), a.brightness);
  set(P.CUTOFF, a.cutoff); set(P.RES, a.res); set(P.DETUNE, a.detune); set(P.SUB, a.sub); set(P.DRIVE, a.drive); set(P.GLIDE, a.glide);
  set(P.GAIN, a.gain); set(P.SEND, a.send);
  const bassy = /bass|reese|growl|sub/i.test(`${a.sound ?? ""}`);
  return { params: Array.from({ length: NPARAMS }, (_, i) => clampParam(i, base[i] ?? 0)), root: a.root ?? (bassy ? 36 : 60) };
}

/**
 * The track a new instrument takes: a synth with no notes that no seat in the room plays, last first (the kit's
 * spare synths sit at the end). With none, the oldest made instrument's track. -1 when the groove has neither.
 */
export function freeTrack(p: Project, def: StudioDef): number {
  const room = roomWith(def, p), used = new Set<number>();
  for (const s of room.spots) {
    if (s.ix !== undefined) { used.add(s.ix); continue; }
    if (!s.track) continue;
    const want = s.track.toLowerCase(), named = p.tracks.findIndex((t) => t.name.toLowerCase().includes(want));
    if (named >= 0) used.add(named);
  }
  for (let i = p.tracks.length - 1; i >= 0; i--) if (p.tracks[i].kind === "synth" && !p.tracks[i].notes.length && !p.tracks[i].take && !used.has(i)) return i;
  return p.instruments?.[0]?.track ?? -1;
}

type Box = { cx: number; cz: number; hw: number; hd: number; turn: number };
const inside = (b: Box, x: number, z: number, m: number) => {
  const c = Math.cos(b.turn), s = Math.sin(b.turn), dx = x - b.cx, dz = z - b.cz;
  return Math.abs(dx * c - dz * s) <= b.hw + m && Math.abs(dx * s + dz * c) <= b.hd + m;
};
const corners = (b: Box) => {
  const c = Math.cos(b.turn), s = Math.sin(b.turn);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, -1], [0, 1]].map(([u, v]) => {
    const lx = u * b.hw, lz = v * b.hd;
    return [b.cx + lx * c + lz * s, b.cz - lx * s + lz * c];
  });
};

/**
 * A clear place for a new seat and its synth, nearest `want`: inside the room, off the walls and furniture, a step
 * from every seat, and out of the doorways. Null when there's no room left.
 */
export function place(def: StudioDef, want: [number, number]): { at: [number, number]; yaw: number } | null {
  const solid = solids(def), seats = def.spots.map((s) => s.at);
  const doors = [def.door.at, ...def.walls.flatMap((w) => (w.gaps ?? []).map(([a, b]) => {
    const [x0, z0] = w.from, [x1, z1] = w.to, len = Math.hypot(x1 - x0, z1 - z0), k = (a + b) / 2 / len;
    return [x0 + (x1 - x0) * k, z0 + (z1 - z0) * k] as [number, number];
  }))];
  const hw = def.size.w / 2 - 0.35, hd = def.size.d / 2 - 0.35, tries: { at: [number, number]; yaw: number; d: number }[] = [];
  for (let x = -hw; x <= hw; x += 0.25) for (let z = -hd; z <= hd; z += 0.25) {
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) tries.push({ at: [x, z], yaw, d: Math.hypot(x - want[0], z - want[1]) });
  }
  tries.sort((a, b) => a.d - b.d);
  for (const t of tries) {
    const box = thingBox({ id: "", kind: "keys", label: "", at: t.at, yaw: t.yaw, thing: MADE_THING });
    const pts = [t.at, ...corners(box)];
    if (pts.some(([x, z]) => Math.abs(x) > hw || Math.abs(z) > hd)) continue;
    if (pts.some(([x, z]) => solid.some((s) => inside(s, x, z, 0.2)))) continue;
    if (solid.some((s) => corners(s).some(([x, z]) => inside(box, x, z, 0.2)))) continue;
    if (seats.some(([x, z]) => Math.hypot(x - t.at[0], z - t.at[1]) < 0.9 || inside(box, x, z, 0.3))) continue;
    if (doors.some(([x, z]) => pts.some(([px, pz]) => Math.hypot(px - x, pz - z) < 1.1))) continue;
    return { at: [Math.round(t.at[0] * 100) / 100, Math.round(t.at[1] * 100) / 100], yaw: t.yaw };
  }
  return null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 18) || "synth";
/** A seed from the name and the track, so the same make grows the same synth everywhere. */
function seedOf(s: string) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) % 2 ** 31; }

export type Made = { ok: true; op: Extract<Op, { t: "instrument" }>; inst: Instrument } | { ok: false; why: string };

/** The edit that makes an instrument, or why it can't be made. `from`: where whoever makes it stands. */
export function makeInstrument(p: Project, def: StudioDef, a: MakeArgs, from: [number, number]): Made {
  const room = roomWith(def, p), track = freeTrack(p, def);
  if (track < 0) return { ok: false, why: "Every track in this groove is in use" };
  // a newer one on a reused track takes the old one's place: its seat is free again
  const others = { ...room, spots: room.spots.filter((s) => s.ix !== track) };
  let want = from;
  const spot = a.spot;
  if (spot && "near" in spot) {
    const near = others.spots.find((s) => s.id === spot.near);
    if (!near) return { ok: false, why: `There's no ${spot.near} here. Spots: ${others.spots.map((s) => s.id).join(", ")}` };
    want = near.at;
  } else if (spot) want = [spot.x, spot.z];
  const at = place(others, want);
  if (!at) return { ok: false, why: "There's no clear floor left for another instrument" };
  let id = `made-${slug(a.name)}`;
  for (let n = 2; others.spots.some((s) => s.id === id); n++) id = `made-${slug(a.name).slice(0, 15)}-${n}`;
  const inst: Instrument = { id, name: a.name, voice: a.voice, track, at: at.at, yaw: at.yaw, seed: seedOf(`${id}:${track}`) };
  return { ok: true, op: { t: "instrument", inst, ...patchFor(a.voice, a.patch) }, inst };
}

