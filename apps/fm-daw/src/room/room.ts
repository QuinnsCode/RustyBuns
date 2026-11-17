// Qollab Studio's gear room, pure (no DOM, no three.js): the gear it knows and where its jacks and knobs sit, you walking it
// in first person, what you look at, what a click does, and what you hear. The patch and who holds what are the
// sesh's own Studio (../studio.ts, the same ops friends' rooms apply); this file only adds the body and the hands.
// What you hear is a walk back along the cables: from the speaker cab to the guitar, or from a desk track's insert
// return to its send (the gear cabled into FM DAW's desk, #4902). Only the gear on that walk runs its circuits and
// machines, and gear cabled into nothing costs nothing.
import { AMPS, DEFAULT_ROOM, PEDALS, type Knobs } from "../circuit/amps.ts";
import type { AmpSettings, BoardPedal, BoardStep } from "../amp/messages.ts";
import { pushOut, type Rect } from "../studio/walk.ts";
import type { BbdMode, LoopSpec } from "@rustybuns/gear/circuit";
import type { BenchPedal } from "../circuit/bench.ts";
import { AUXES } from "../mixer.ts";
import { applyStudio, emptyStudio, MAX_KNOBS, type End, type Patch, type Placed, type Studio, type StudioOp } from "../studio.ts";

export type Vec3 = [number, number, number];
/** The face of a box a jack or knob sits on, in the box's own frame: front is +z. */
export type Face = "front" | "back" | "left" | "right" | "top";
export interface JackDef { name: string; dir: "in" | "out"; at: Vec3; face: Face }
/** A knob 0 to 1 (the patch's range); `circuit` is its 0 to 10 name in the amp or pedal it drives. */
export interface KnobDef { name: string; label: string; at: Vec3; face: Face; dflt: number }
export type Kind = "guitar" | "pedal" | "split" | "amp" | "cab" | "machine" | "desk";
/** The loop machines (Q Amp's Q Bucket, Q Tape, Q Spring) as boxes of their own. */
export type MachineKind = LoopSpec["kind"];
/** A piece of studio gear: its size (w, h, d in metres, standing on its bottom face), jacks and knobs, and the circuit or machine it runs. */
export interface GearDef { id: string; name: string; kind: Kind; size: Vec3; kg: number; jacks: JackDef[]; knobs: KnobDef[]; circuit?: string; loop?: MachineKind }

const AMP_KNOBS: (keyof Knobs)[] = ["gain", "bass", "mid", "treble", "master", "noise"];
const LABEL: Record<keyof Knobs, string> = { gain: "Gain", bass: "Bass", mid: "Middle", treble: "Treble", master: "Master", noise: "Noise", rate: "Rate", depth: "Depth" };
const PEDAL_DRIVE: Record<string, number> = { drive: 3, dist: 5, fuzz: 7 };

const ampGear = (a: (typeof AMPS)[number]): GearDef => ({
  id: `amp-${a.id}`, name: a.name, kind: "amp", size: [0.62, 0.26, 0.26], kg: 15, circuit: a.id,
  // On the back: the effects loop (send out to machines, return back in), a line out (the cab and mic, as a load box's
  // out, for a desk insert) and the speaker out.
  jacks: [
    { name: "in", dir: "in", at: [-0.26, 0.15, 0.13], face: "front" },
    { name: "send", dir: "out", at: [-0.2, 0.13, -0.13], face: "back" },
    { name: "return", dir: "in", at: [-0.12, 0.13, -0.13], face: "back" },
    { name: "line", dir: "out", at: [0.08, 0.13, -0.13], face: "back" },
    { name: "speaker", dir: "out", at: [0.22, 0.13, -0.13], face: "back" },
  ],
  knobs: (a.trem ? [...AMP_KNOBS, "rate", "depth"] as const : AMP_KNOBS).map((k, i) => ({
    name: k, label: LABEL[k], at: a.trem ? [-0.17 + i * 0.055, 0.15, 0.13] : [-0.14 + i * 0.075, 0.15, 0.13], face: "front", dflt: a.knobs[k] / 10,
  })),
});
const pedalGear = (p: (typeof PEDALS)[number]): GearDef => ({
  id: `pedal-${p.id}`, name: p.name, kind: "pedal", size: [0.12, 0.06, 0.2], kg: 0.5, circuit: p.id,
  jacks: [{ name: "in", dir: "in", at: [0.06, 0.035, -0.04], face: "right" }, { name: "out", dir: "out", at: [-0.06, 0.035, -0.04], face: "left" }],
  knobs: [{ name: "drive", label: p.knob ?? "Drive", at: [0, 0.06, -0.05], face: "top", dflt: (PEDAL_DRIVE[p.id] ?? 5) / 10 }],
});

/** A loop machine as a box on the floor: line in and out on the front, its knobs on top (Q Amp's loop pedals). */
function machineGear(loop: MachineKind, name: string, size: Vec3, kg: number, knobs: [string, string, number][]): GearDef {
  const [w, h, d] = size;
  return {
    id: `machine-${loop}`, name, kind: "machine", size, kg, loop,
    jacks: [{ name: "in", dir: "in", at: [w / 2 - 0.03, h / 2, d / 2], face: "front" }, { name: "out", dir: "out", at: [-w / 2 + 0.03, h / 2, d / 2], face: "front" }],
    knobs: knobs.map(([k, label, dflt], i) => ({ name: k, label, at: [-w / 2 + (w * (i + 1)) / (knobs.length + 1), h, d / 2 - 0.05], face: "top", dflt })),
  };
}

/**
 * Q Split: one signal to two sides and back. `send-a` and `send-b` carry the input out to the pedals on each side,
 * `return-a` and `return-b` bring them back, and Blend sets how much of each comes out (0 all A, 1 all B). A side cabled
 * straight from its send to its return is the dry signal. Pedals one after another need no box: cable them in a row.
 */
const SPLIT: GearDef = {
  id: "split", name: "Q Split", kind: "split", size: [0.16, 0.06, 0.2], kg: 0.6,
  jacks: [
    { name: "in", dir: "in", at: [0.08, 0.035, -0.04], face: "right" },
    { name: "out", dir: "out", at: [-0.08, 0.035, -0.04], face: "left" },
    { name: "send-a", dir: "out", at: [-0.05, 0.035, 0.1], face: "front" },
    { name: "return-a", dir: "in", at: [-0.017, 0.035, 0.1], face: "front" },
    { name: "send-b", dir: "out", at: [0.017, 0.035, 0.1], face: "front" },
    { name: "return-b", dir: "in", at: [0.05, 0.035, 0.1], face: "front" },
  ],
  knobs: [{ name: "blend", label: "Blend", at: [0, 0.06, -0.05], face: "top", dflt: 0.5 }],
};

/** How many tracks the desk's patch bay has inserts for: `send-1` out to the gear, back into `return-1`. */
export const DESK_TRACKS = 4;
/** The desk's aux sends and returns (src/mixer.ts): `aux-send-1` out to an effect, back into `aux-return-1`, on its own fader. */
export const DESK_AUXES = AUXES;
const DESK: GearDef = {
  id: "desk", name: "FM DAW desk", kind: "desk", size: [1.2, 0.85, 0.6], kg: 30,
  jacks: Array.from({ length: DESK_TRACKS }, (_, i): JackDef[] => [
    { name: `send-${i + 1}`, dir: "out", at: [-0.45 + i * 0.3, 0.85, -0.2], face: "top" },
    { name: `return-${i + 1}`, dir: "in", at: [-0.37 + i * 0.3, 0.85, -0.2], face: "top" },
  ]).flat().concat(Array.from({ length: DESK_AUXES }, (_, i): JackDef[] => [
    { name: `aux-send-${i + 1}`, dir: "out", at: [-0.45 + i * 0.3, 0.85, -0.27], face: "top" },
    { name: `aux-return-${i + 1}`, dir: "in", at: [-0.37 + i * 0.3, 0.85, -0.27], face: "top" },
  ]).flat()),
  knobs: [],
};

/** Every piece of gear the studio has, by id. */
export const STUDIO_GEAR: Readonly<Record<string, GearDef>> = Object.fromEntries([
  { id: "guitar", name: "Guitar", kind: "guitar", size: [0.34, 1.0, 0.06], kg: 3.5, jacks: [{ name: "out", dir: "out", at: [0.1, 0.22, 0.03], face: "front" }], knobs: [] } satisfies GearDef,
  ...PEDALS.map(pedalGear),
  SPLIT,
  ...AMPS.map(ampGear),
  machineGear("bbd", "Q Bucket", [0.14, 0.07, 0.2], 0.7, [["mode", "Mode", 0], ["rate", "Rate", 0.3], ["depth", "Depth", 0.5]]),
  machineGear("tape", "Q Tape", [0.34, 0.14, 0.22], 4, [["time", "Time", 0.4], ["repeats", "Repeats", 0.4], ["mix", "Mix", 0.4]]),
  machineGear("spring", "Q Spring", [0.42, 0.12, 0.16], 3, [["dwell", "Dwell", 0.5], ["mix", "Mix", 0.4]]),
  DESK,
  { id: "cab-2x12", name: "2x12 cab", kind: "cab", size: [0.7, 0.55, 0.3], kg: 25, jacks: [{ name: "in", dir: "in", at: [0.25, 0.1, -0.15], face: "back" }], knobs: [] } satisfies GearDef,
].map((g) => [g.id, g]));

// ---- bench pedals: tscircuit boards dropped in the room (../circuit/bench.ts) ----

/** A bench pedal as studio gear: its def, the pedal, and each knob's pot on the board. */
interface Benched { def: GearDef; pedal: BenchPedal; pots: Record<string, string> }
/** The bench pedals this page has read, by gear id. A patch names a bench pedal by gear id like any other gear. */
const BENCH = new Map<string, Benched>();
const slug = (s: string, n: number) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, n).replace(/-+$/, "");
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/**
 * A bench pedal as gear the room knows: a box the size of its board's enclosure, a knob per pot along its lid,
 * the instrument jack in on its right end and the line out on its left, as the rack's pedals have them. Its gear
 * id is the bench's (cut to an id the patch takes); reading the same board again replaces it.
 */
export function benchGear(pedal: BenchPedal): GearDef {
  const { w, h, d } = pedal.gear.size, n = pedal.knobs.length;
  const id = slug(pedal.gear.id, 32) || "bench-pedal";
  const pots: Record<string, string> = {}, knobs: KnobDef[] = [];
  pedal.knobs.forEach((k, i) => {
    let name = slug(k.name, 28) || `pot-${i + 1}`;
    while (name in pots) name = `${name.slice(0, 28)}-${i + 1}`;
    pots[name] = k.name;
    knobs.push({ name, label: title(k.name), at: [-w / 2 + (w * (i + 1)) / (n + 1), h, -d * 0.15], face: "top", dflt: 0.5 });
  });
  const def: GearDef = {
    id, name: pedal.gear.what.replace(/, a pedal from the bench$/, ""), kind: "pedal", size: [w, h, d], kg: pedal.gear.kg, circuit: "bench",
    jacks: [{ name: "in", dir: "in", at: [w / 2, h * 0.5, d * 0.15], face: "right" }, { name: "out", dir: "out", at: [-w / 2, h * 0.5, d * 0.15], face: "left" }],
    knobs: knobs.slice(0, MAX_KNOBS),
  };
  BENCH.set(id, { def, pedal, pots });
  return def;
}

export const gearOf = (p: Placed): GearDef | undefined => STUDIO_GEAR[p.gear] ?? BENCH.get(p.gear)?.def;

/** The board's netlist at its knobs as the patch has them turned: what the cabled bench pedal `id` plays. */
function benchNet(patch: Patch, p: Placed) {
  const b = BENCH.get(p.gear);
  if (!b) return undefined;
  const turns = Object.fromEntries(b.def.knobs.map((k) => [b.pots[k.name], patch.knobs[p.id]?.[k.name] ?? k.dflt]));
  return b.pedal.net(turns);
}

// ---- the room ----

/** The live room: x from -HALF_W to HALF_W, z from -HALF_D (the back wall, with the rack) to HALF_D. */
export const HALF_W = 3.5, HALF_D = 3, WALL_H = 2.8;
export const EYE = 1.62, RADIUS = 0.25, WALK = 1.5;
/** How far your hands reach from your eyes, metres. */
export const REACH = 2.1;
/** The wall rack: a frame against the back wall, its shelves' tops in metres. */
export const RACK = { x0: -2, x1: 2, z0: -HALF_D, z1: -HALF_D + 0.45, shelves: [0.45, 0.95, 1.45] };

/** The pedal wall: ledges on the left wall, where the pedals and Q Split hang until you take one down. */
export const PEDAL_WALL = { x0: -HALF_W, x1: -HALF_W + 0.25, z0: -1.9, z1: -0.1, shelves: [1.0, 1.4] };
/** Everything with shelves: what blocks your walk and what a box set down can land on. */
const SHELVING = [RACK, PEDAL_WALL];

const at = (x: number, y: number, z: number) => [x, y, z];
const rackZ = (RACK.z0 + RACK.z1) / 2, wallX = (PEDAL_WALL.x0 + PEDAL_WALL.x1) / 2, facing = Math.PI / 2;
/** The room as it starts: the pedals on the pedal wall, the amps and machines on the rack, the cab and the desk on the floor, the guitar on its stand, no cables. */
export function startPatch(): Patch {
  return {
    placed: [
      { id: "drive", gear: "pedal-drive", at: at(wallX, PEDAL_WALL.shelves[0], -1.7), turn: facing },
      { id: "fuzz", gear: "pedal-fuzz", at: at(wallX, PEDAL_WALL.shelves[0], -1.35), turn: facing },
      { id: "dist", gear: "pedal-dist", at: at(wallX, PEDAL_WALL.shelves[0], -1.0), turn: facing },
      { id: "comp", gear: "pedal-comp", at: at(wallX, PEDAL_WALL.shelves[0], -0.65), turn: facing },
      { id: "split", gear: "split", at: at(wallX, PEDAL_WALL.shelves[0], -0.3), turn: facing },
      { id: "bucket", gear: "machine-bbd", at: at(0.05, RACK.shelves[0], rackZ), turn: 0 },
      { id: "tape", gear: "machine-tape", at: at(0.5, RACK.shelves[0], rackZ), turn: 0 },
      { id: "spring", gear: "machine-spring", at: at(1.2, RACK.shelves[0], rackZ), turn: 0 },
      { id: "brit", gear: "amp-brit", at: at(-1.1, RACK.shelves[1], rackZ), turn: 0 },
      { id: "triple", gear: "amp-triple", at: at(1.1, RACK.shelves[1], rackZ), turn: 0 },
      { id: "lead", gear: "amp-lead", at: at(0, RACK.shelves[2], rackZ), turn: 0 },
      { id: "cab", gear: "cab-2x12", at: at(1.4, 0, -0.6), turn: -0.4 },
      { id: "guitar", gear: "guitar", at: at(-1.6, 0, 0.2), turn: 0.5 },
      { id: "desk", gear: "desk", at: at(-2.5, 0, 1.9), turn: 0 },
    ],
    cables: [],
    knobs: {},
  };
}

/** A room saved before some gear came in gets it, where the room starts with it (a box of each kind it lacks). */
export function furnish(p: Patch): Patch {
  const have = new Set(p.placed.map((x) => x.gear)), ids = new Set(p.placed.map((x) => x.id));
  const add = startPatch().placed.filter((x) => !have.has(x.gear) && !ids.has(x.id));
  return add.length ? { ...p, placed: [...p.placed, ...add] } : p;
}

export interface You { x: number; z: number; yaw: number; pitch: number }
/** You in the room: your body, and the sesh's studio (the patch and what your hand holds as player `me`). */
export interface Room { studio: Studio; you: You; me: number; /** How far you turned what you hold from where you face. */ heldTurn: number }

export function newRoom(patch: Patch = startPatch()): Room {
  return { studio: { ...emptyStudio(), patch }, you: { x: 0, z: 1.8, yaw: 0, pitch: -0.15 }, me: 1, heldTurn: 0 };
}

export type Answer = { ok: true } | { ok: false; why: string };
const no = (why: string): Answer => ({ ok: false, why });
const OK: Answer = { ok: true };

/** Do `op` as you; false if the studio said no (it hands back the same studio then). */
function act(r: Room, op: StudioOp): boolean {
  const next = applyStudio(r.studio, r.me, op);
  if (next === r.studio) return false;
  r.studio = next;
  return true;
}

export const hand = (r: Room) => r.studio.held[String(r.me)];
export const heldId = (r: Room) => { const h = hand(r); return h && "item" in h ? h.item : null; };
export const item = (r: Room, id: string) => r.studio.patch.placed.find((p) => p.id === id);
const nameOf = (r: Room, id: string) => { const p = item(r, id); return (p && gearOf(p)?.name) ?? id; };

// ---- geometry ----

/** A point in a box's own frame to the room's, as three.js turns an object by rotation.y. */
export function toWorld(p: Placed, local: Vec3): Vec3 {
  const c = Math.cos(p.turn), s = Math.sin(p.turn);
  return [p.at[0] + local[0] * c + local[2] * s, p.at[1] + local[1], p.at[2] - local[0] * s + local[2] * c];
}
const toLocal = (p: Placed, w: Vec3): Vec3 => {
  const dx = w[0] - p.at[0], dz = w[2] - p.at[2], c = Math.cos(p.turn), s = Math.sin(p.turn);
  return [dx * c - dz * s, w[1] - p.at[1], dx * s + dz * c];
};
export const eye = (r: Room): Vec3 => [r.you.x, EYE, r.you.z];
/** Where you look: yaw 0 looks down -z, as a three.js camera does. */
export const lookDir = (y: You): Vec3 => [-Math.sin(y.yaw) * Math.cos(y.pitch), Math.sin(y.pitch), -Math.cos(y.yaw) * Math.cos(y.pitch)];

export function jackAt(r: Room, end: End): Vec3 | null {
  const p = item(r, end[0]), j = p && gearOf(p)?.jacks.find((x) => x.name === end[1]);
  return p && j ? toWorld(placedNow(r, p), j.at) : null;
}

/** Where a box is drawn now: where it stands, or in your hands if you carry it. */
export function placedNow(r: Room, p: Placed): Placed {
  return heldId(r) === p.id ? { ...p, ...holdPose(r, p) } : p;
}

/** Where the held box sits: in front of you at the height you look, turned as you turned it. */
export function holdPose(r: Room, p: Placed): { at: number[]; turn: number } {
  const g = gearOf(p), [, h, d] = g?.size ?? [0.3, 0.3, 0.3];
  const out = 0.45 + d / 2, f = lookDir({ ...r.you, pitch: 0 });
  const y = Math.min(1.7, Math.max(0, EYE + Math.tan(r.you.pitch) * out - h / 2 - 0.25));
  return { at: [r.you.x + f[0] * out, y, r.you.z + f[2] * out], turn: r.you.yaw + r.heldTurn };
}

/** Ray against a box standing at `p`: the distance along the ray, or null. */
function hitBox(p: Placed, size: Vec3, o: Vec3, d: Vec3): number | null {
  const lo = toLocal(p, o), c = Math.cos(p.turn), s = Math.sin(p.turn);
  const ld: Vec3 = [d[0] * c - d[2] * s, d[1], d[0] * s + d[2] * c];
  const min: Vec3 = [-size[0] / 2, 0, -size[2] / 2], max: Vec3 = [size[0] / 2, size[1], size[2] / 2];
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) { if (lo[i] < min[i] || lo[i] > max[i]) return null; continue; }
    let a = (min[i] - lo[i]) / ld[i], b = (max[i] - lo[i]) / ld[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}
function hitBall(c: Vec3, rad: number, o: Vec3, d: Vec3): number | null {
  const m = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const b = m[0] * d[0] + m[1] * d[1] + m[2] * d[2], cc = m[0] ** 2 + m[1] ** 2 + m[2] ** 2 - rad * rad;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : cc <= 0 ? 0 : null;
}

export type Aim = { t: "item"; id: string } | { t: "jack"; end: End } | { t: "knob"; id: string; knob: string };
const PART_R = 0.03;

/** What you look at within reach: a jack or knob before the box it is on, the nearest box otherwise. */
export function aimed(r: Room): Aim | null {
  const o = eye(r), d = lookDir(r.you), held = heldId(r);
  const hits: { t: number; aim: Aim }[] = [];
  const offer = (t: number | null, aim: Aim) => { if (t !== null && t <= REACH) hits.push({ t, aim }); };
  for (const p of r.studio.patch.placed) {
    const g = gearOf(p);
    if (!g || p.id === held) continue;
    offer(hitBox(p, g.size, o, d), { t: "item", id: p.id });
    // A small part wins over the face it sits on: it is nearer than the face by a hair, or should be.
    for (const j of g.jacks) { const t = hitBall(toWorld(p, j.at), PART_R, o, d); offer(t === null ? null : t - 0.05, { t: "jack", end: [p.id, j.name] }); }
    for (const k of g.knobs) { const t = hitBall(toWorld(p, k.at), PART_R, o, d); offer(t === null ? null : t - 0.05, { t: "knob", id: p.id, knob: k.name }); }
  }
  hits.sort((a, b) => a.t - b.t);
  return hits[0]?.aim ?? null;
}

/** Turn to look straight at a box, or at one of its jacks or knobs. */
export function lookAt(r: Room, id: string, part?: string): boolean {
  const p = item(r, id), g = p && gearOf(p);
  if (!p || !g) return false;
  const local = g.jacks.find((j) => j.name === part)?.at ?? g.knobs.find((k) => k.name === part)?.at ?? [0, g.size[1] * 0.85, 0];
  const w = toWorld(p, local), o = eye(r), dx = w[0] - o[0], dy = w[1] - o[1], dz = w[2] - o[2];
  r.you.yaw = Math.atan2(-dx, -dz);
  r.you.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return true;
}

// ---- walking ----

export interface Input { forward: number; right: number; turn: number }

function solids(r: Room): Rect[] {
  const held = heldId(r);
  const gear = r.studio.patch.placed.filter((p) => p.id !== held && p.at[1] < 0.5).flatMap((p) => {
    const g = gearOf(p);
    return g ? [{ cx: p.at[0], cz: p.at[2], hw: g.size[0] / 2, hd: g.size[2] / 2, turn: p.turn }] : [];
  });
  const shelving = SHELVING.map((s) => ({ cx: (s.x0 + s.x1) / 2, cz: (s.z0 + s.z1) / 2, hw: (s.x1 - s.x0) / 2, hd: (s.z1 - s.z0) / 2, turn: 0 }));
  return [...shelving, ...gear];
}

/** Push you out of the walls, the rack and the gear standing on the floor. */
const collide = (r: Room) => pushOut(r.you, solids(r), HALF_W, HALF_D, RADIUS);

/** One tick: turn and walk by the input. */
export function step(r: Room, dt: number, i: Input) {
  const y = r.you;
  y.yaw += i.turn;
  const len = Math.hypot(i.forward, i.right);
  if (len > 0) {
    const k = (WALK * dt) / Math.max(1, len), f = lookDir({ ...y, pitch: 0 });
    y.x += (f[0] * i.forward - f[2] * i.right) * k;
    y.z += (f[2] * i.forward + f[0] * i.right) * k;
  }
  collide(r);
}

/** Walk straight to (x, z) tick by tick; the seconds it took. Stops at the rack or a box in the way. */
export function walkTo(r: Room, x: number, z: number): number {
  const dt = 1 / 30;
  let t = 0;
  for (let n = 0; n < 900; n++) {
    const dx = x - r.you.x, dz = z - r.you.z, d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const yaw = r.you.yaw;
    r.you.yaw = Math.atan2(-dx, -dz);
    const before = [r.you.x, r.you.z];
    step(r, dt, { forward: Math.min(1, d / (WALK * dt)), right: 0, turn: 0 });
    r.you.yaw = yaw;
    t += dt;
    if (Math.hypot(r.you.x - before[0], r.you.z - before[1]) < 1e-4) break;
  }
  return Math.round(t * 10) / 10;
}

// ---- hands ----

const reachable = (r: Room, p: Placed) => Math.hypot(p.at[0] - r.you.x, p.at[1] + 0.1 - EYE, p.at[2] - r.you.z) <= REACH + 0.4;

export function pickUp(r: Room, id: string): Answer {
  const p = item(r, id);
  if (!p) return no(`no ${id} in the room`);
  if (hand(r)) return no("your hands are full");
  if (!reachable(r, p)) return no(`${nameOf(r, id)} is out of reach`);
  const stacked = r.studio.patch.placed.find((q) => q.id !== id && q.at[1] > p.at[1] + 0.01 && sitsOn(q, p));
  if (stacked) return no(`${nameOf(r, stacked.id)} is on top of it`);
  if (!act(r, { t: "pick", id })) return no(`someone else has ${nameOf(r, id)}`);
  r.heldTurn = p.turn - r.you.yaw;
  return OK;
}

/** Whether `q`'s middle stands within `p`'s footprint. */
function sitsOn(q: Placed, p: Placed): boolean {
  const g = gearOf(p);
  if (!g) return false;
  const l = toLocal(p, [q.at[0], q.at[1], q.at[2]]);
  return Math.abs(l[0]) <= g.size[0] / 2 && Math.abs(l[2]) <= g.size[2] / 2;
}

/** What a box set down at (x, z) from `fromY` lands on: the highest shelf or box top under it, or the floor. */
function landing(r: Room, id: string, x: number, z: number, fromY: number): number {
  let y = 0;
  const below = (top: number) => { if (top <= fromY + 0.08 && top > y) y = top; };
  for (const s of SHELVING) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) s.shelves.forEach(below);
  for (const p of r.studio.patch.placed) {
    const g = gearOf(p);
    if (g && p.id !== id && sitsOn({ id, gear: "", at: [x, 0, z], turn: 0 }, p)) below(p.at[1] + g.size[1]);
  }
  return y;
}

export function putDown(r: Room): Answer {
  const id = heldId(r), p = id ? item(r, id) : undefined;
  if (!id || !p) return no("you aren't carrying anything");
  const pose = holdPose(r, p);
  const x = Math.max(-HALF_W + 0.2, Math.min(HALF_W - 0.2, pose.at[0]));
  const z = Math.max(-HALF_D + 0.2, Math.min(HALF_D - 0.2, pose.at[2]));
  const y = landing(r, id, x, z, pose.at[1]);
  const notch = Math.PI / 12, turn = Math.round(pose.turn / notch) * notch;
  act(r, { t: "put", at: [x, y, z], turn: ((turn % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) });
  r.heldTurn = 0;
  return OK;
}

/**
 * A board off the bench onto the floor: the pedal stands a step in front of you (or at `x`, `z`), facing you, as a
 * new box with its own id. Your hands have to be free: it passes through them as any box brought in does.
 */
export function benchIn(r: Room, pedal: BenchPedal, spot?: { x: number; z: number }): Answer & { id?: string } {
  if (hand(r)) return no("your hands are full");
  const g = benchGear(pedal);
  let n = 1;
  while (item(r, `bench-${n}`)) n++;
  const id = `bench-${n}`, f = lookDir({ ...r.you, pitch: 0 });
  const x = Math.max(-HALF_W + 0.2, Math.min(HALF_W - 0.2, spot?.x ?? r.you.x + f[0] * 0.8));
  const z = Math.max(-HALF_D + 0.2, Math.min(HALF_D - 0.2, spot?.z ?? r.you.z + f[2] * 0.8));
  const turn = ((r.you.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (!act(r, { t: "bring", id, gear: g.id, at: [x, 0, z], turn })) return no("the room is full");
  act(r, { t: "put", at: [x, landing(r, id, x, z, 0), z], turn });
  return { ok: true, id };
}

/** Turn what you hold by a 15 degree step (Q and E): -1 left, 1 right. */
export function turnHeld(r: Room, dir: number) { if (heldId(r)) r.heldTurn += (dir * Math.PI) / 12; }

const same = (a: End, b: End) => a[0] === b[0] && a[1] === b[1];
const jackDef = (r: Room, end: End) => { const p = item(r, end[0]); return p ? gearOf(p)?.jacks.find((j) => j.name === end[1]) : undefined; };
export const cableIn = (r: Room, end: End) => r.studio.patch.cables.find((c) => same(c.from, end) || same(c.to, end));
const label = (r: Room, end: End) => `${nameOf(r, end[0])}'s ${end[1]}`;

/** Take a cable from a free jack: its other end is in your hand. */
export function lead(r: Room, end: End): Answer {
  if (!jackDef(r, end)) return no(`no jack ${end[1]} on ${end[0]}`);
  if (hand(r)) return no("your hands are full");
  if (cableIn(r, end)) return no(`${label(r, end)} has a cable in it`);
  return act(r, { t: "lead", from: end }) ? OK : no(`can't take a cable from ${label(r, end)}`);
}

/** Push the cable in your hand into a jack: an output into an input, never a box into itself. */
export function plug(r: Room, to: End): Answer {
  const h = hand(r), j = jackDef(r, to);
  if (!h || !("lead" in h)) return no("you have no cable in your hand");
  if (!j) return no(`no jack ${to[1]} on ${to[0]}`);
  if (h.lead[0] === to[0]) return no(`that's ${nameOf(r, to[0])} into itself`);
  const from = jackDef(r, h.lead);
  if (from && from.dir === j.dir) return no(`two ${j.dir === "out" ? "outputs" : "inputs"}: ${label(r, h.lead)} and ${label(r, to)}`);
  if (cableIn(r, to)) return no(`${label(r, to)} has a cable in it`);
  return act(r, { t: "plug", to }) ? OK : no(`can't plug into ${label(r, to)}`);
}

/** Pull a cable out of a jack: the end comes into your hand, its other end stays plugged in. */
export function unplug(r: Room, at: End): Answer {
  const c = cableIn(r, at);
  if (!c) return no(`nothing in ${label(r, at)}`);
  if (hand(r)) return no("your hands are full");
  const other = same(c.from, at) ? c.to : c.from;
  act(r, { t: "unplug", at });
  act(r, { t: "lead", from: other });
  return OK;
}

/** Let go of the cable in your hand: it is put away. */
export function drop(r: Room): Answer { return act(r, { t: "drop" }) ? OK : no("you have no cable in your hand"); }

/** A knob to `v` (0 to 1). */
export function setKnob(r: Room, id: string, knob: string, v: number): Answer {
  const p = item(r, id), k = p && gearOf(p)?.knobs.find((x) => x.name === knob);
  if (!k) return no(`no knob ${knob} on ${id}`);
  act(r, { t: "knob", id, knob, v: Math.max(0, Math.min(1, Math.round(v * 1000) / 1000)) });
  return OK;
}
export const knobValue = (patch: Patch, id: string, k: KnobDef) => patch.knobs[id]?.[k.name] ?? k.dflt;

/** A click (or F) on what you look at: set down, plug, unplug, take a cable, pick up, or let go of a cable. */
export function use(r: Room, a: Aim | null = aimed(r)): Answer {
  const h = hand(r);
  if (h && "item" in h) return putDown(r);
  if (a?.t === "jack") return h ? plug(r, a.end) : cableIn(r, a.end) ? unplug(r, a.end) : lead(r, a.end);
  if (a?.t === "knob") return no("drag to turn it");
  if (a?.t === "item") return h ? no("plug the cable into a jack") : pickUp(r, a.id);
  return h ? drop(r) : no("nothing in reach");
}

// ---- cables ----

/** A cable hanging from `a` to `b`: `n` points on a curve that sags as a cable of that length would, resting on the floor. */
export function sag(a: Vec3, b: Vec3, n = 20): Vec3[] {
  const span = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = span * 1.15 + 0.3, depth = Math.sqrt((3 * Math.max(span, 0.05) * (len - span)) / 8);
  return Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [a[0] + (b[0] - a[0]) * t, Math.max(0.008, a[1] + (b[1] - a[1]) * t - depth * 4 * t * (1 - t)), a[2] + (b[2] - a[2]) * t] as Vec3;
  });
}

/** Where your hand is, for the free end of a cable you carry. */
export const handAt = (r: Room): Vec3 => { const f = lookDir(r.you); return [r.you.x + f[0] * 0.5, EYE - 0.4 + f[1] * 0.5, r.you.z + f[2] * 0.5]; };

// ---- what you hear ----

/** A desk track's insert: the gear between its send and its return, in signal order. */
export interface Insert {
  track: number;
  /** Desk, the gear, desk: when the gear between send and return is cabled through. */
  chain: string[];
  whole: boolean;
  problems: string[];
}

export interface Heard {
  playing: boolean;
  /** Source to speaker along the cables (guitar to cab, or desk send to desk return), when there is a whole chain. */
  chain: string[];
  /** The items whose circuits and machines run (the pedal, the amp and the machines on the chain), nothing else. */
  running: string[];
  settings: AmpSettings | null;
  problems: string[];
  /** Each desk track with a cable in its send or return. The room plays the first whole one (the riff stands in for the track) when no cab is playing. */
  inserts: Insert[];
  /** Each desk aux with a cable in its send or return: the effect cabled in, which the desk's return plays (src/mixer.ts `RigReturn`). */
  returns: AuxReturn[];
}

/** A desk aux: the gear between its send and its return, in signal order, and what the rig plays for it when it is whole. */
export interface AuxReturn {
  aux: number;
  chain: string[];
  whole: boolean;
  problems: string[];
  settings: AmpSettings | null;
  running: string[];
}

const BBD_MODES: BbdMode[] = ["chorus", "flanger", "delay"];

/** A machine's knobs (0 to 1) as Q Amp's loop takes them (0 to 10). */
export function loopSpec(g: GearDef, knobs: Record<string, number> = {}): LoopSpec | null {
  const k = (name: string) => (knobs[name] ?? g.knobs.find((x) => x.name === name)?.dflt ?? 0.5) * 10;
  if (g.loop === "tape") return { kind: "tape", time: k("time"), repeats: k("repeats"), mix: k("mix"), heads: [1, 3] };
  if (g.loop === "spring") return { kind: "spring", dwell: k("dwell"), mix: k("mix") };
  if (g.loop === "bbd") return { kind: "bbd", mode: BBD_MODES[Math.min(2, Math.floor(k("mode") / (10 / 3)))], rate: k("rate"), depth: k("depth") };
  return null;
}

/**
 * What the room plays. First a cab: back from its input to an amp's speaker out, from the amp's input back
 * through pedals and machines to the guitar (and, if the amp's return has a cable in, its loop back to its send).
 * Then, if no cab plays, the desk: back from a track's return through pedals, machines and an amp's line out to
 * that track's send. Pedals run in cable order, any number of them; a Q Split runs the pedals on its two sides side
 * by side and blends them back. Then the amp, then the machines in cable order. Anything else is a problem and is silent.
 */
export function listen(patch: Patch, oversample: 2 | 4 = 4): Heard {
  const byId = new Map(patch.placed.map((p) => [p.id, p]));
  const kind = (id: string) => { const p = byId.get(id); return p ? gearOf(p) : undefined; };
  const other = (end: End): End | null => {
    const c = patch.cables.find((x) => same(x.from, end) || same(x.to, end));
    return c ? (same(c.from, end) ? c.to : c.from) : null;
  };
  const name = (id: string) => kind(id)?.name ?? id;

  /** Back from input jack `into` to the source jack: the gear between, first first, or why it stops. */
  type Walk = { items: string[]; amp: string | null; why: string | null };
  /** Each Q Split on a walk: the pedals on side A and side B, first first. */
  const sides = new Map<string, string[][]>(), inSplit = new Set<string>();
  /** A walk's items with each split's side pedals after it. */
  const expand = (ids: string[]) => ids.flatMap((id) => [id, ...(sides.get(id)?.flat() ?? [])]);
  /** A split's two sides, or why it doesn't pass a signal. */
  const splitSides = (id: string): string[][] | string => {
    const got: string[][] = [];
    for (const side of ["a", "b"]) {
      const w = walk([id, `return-${side}`], (e) => same(e, [id, `send-${side}`]), false);
      if (w.why) return w.why;
      const odd = w.items.find((x) => kind(x)?.kind !== "pedal");
      if (odd) return `${name(odd)} is on ${name(id)}'s side ${side.toUpperCase()}: a split's sides take pedals`;
      got.push(w.items);
    }
    return got;
  };
  const walk = (into: End, source: (e: End) => boolean, lineAmp: boolean): Walk => {
    const items: string[] = [];
    let amp: string | null = null, at = other(into), who = into[0];
    if (!at) return { items, amp, why: `nothing plugged into ${name(into[0])}'s ${into[1]}` };
    while (at) {
      if (source(at)) return { items, amp, why: null };
      const g = kind(at[0]);
      const split = g?.kind === "split" && at[1] === "out" && !items.includes(at[0]) && !inSplit.has(at[0]);
      if (split) {
        inSplit.add(at[0]);
        const got = splitSides(at[0]);
        inSplit.delete(at[0]);
        if (typeof got === "string") return { items, amp, why: got };
        sides.set(at[0], got);
      }
      const box = (g?.kind === "pedal" || g?.kind === "machine" || split) && at[1] === "out";
      const line = lineAmp && !amp && g?.kind === "amp" && at[1] === "line";
      if ((!box && !line) || items.includes(at[0])) return { items, amp, why: `${name(who)}'s ${who === into[0] && into[1] !== "in" ? into[1] : "input"} goes to ${name(at[0])}'s ${at[1]}` };
      if (line) amp = at[0];
      items.unshift(at[0]);
      who = at[0];
      at = other([at[0], "in"]);
      if (!at) return { items, amp, why: `nothing plugged into ${name(who)}'s input` };
    }
    return { items, amp, why: null };
  };

  /** The rig for a whole chain: `amp` (or straight into the desk), the pedals and machines on it, the amp's loop. */
  const rig = (amp: string | null, items: string[], loop: string[]): { settings: AmpSettings; running: string[]; problems: string[] } => {
    const problems: string[] = [];
    const isFront = (id: string) => kind(id)?.kind === "pedal" || kind(id)?.kind === "split";
    const fronts = items.filter(isFront);
    const machines = [...items.filter((id) => kind(id)?.kind === "machine"), ...loop];
    const ampAt = amp ? items.indexOf(amp) : -1;
    const late = items.filter((id, i) => (isFront(id) && (i > ampAt && ampAt >= 0 || items.slice(0, i).some((x) => kind(x)?.kind === "machine"))) || (kind(id)?.kind === "machine" && i < ampAt));
    if (late.length) problems.push(`the rig plays the pedals, then the amp, then the machines for now: ${late.map(name).join(", ")} moved to its place`);
    const kinds = machines.map((id) => kind(id)?.loop);
    const twice = machines.filter((_, i) => kinds.indexOf(kinds[i]) !== i);
    if (twice.length) problems.push(`one of each machine plays for now: ${twice.map(name).join(", ")} passed straight through`);
    const runMachines = machines.filter((id) => !twice.includes(id));
    /** A pedal as the board plays it: its circuit at its knob, or a bench board's netlist at its pots. */
    const pedalOf = (id: string): BoardPedal => {
      const g = kind(id), at = byId.get(id);
      if (g?.circuit === "bench" && at) return { pedal: "bench", drive: 0, bench: benchNet(patch, at) };
      return { pedal: g?.circuit ?? "", drive: (patch.knobs[id]?.drive ?? g?.knobs[0]?.dflt ?? 0.5) * 10 };
    };
    const board: BoardStep[] = fronts.map((id) => {
      const s = sides.get(id);
      if (!s) return pedalOf(id);
      const b = patch.knobs[id]?.blend ?? 0.5;
      return { split: s.map((side) => side.map(pedalOf)), mix: [1 - b, b] };
    });
    const onBoard = fronts.flatMap((id) => [id, ...(sides.get(id)?.flat() ?? [])]);
    const ampDef = AMPS.find((a) => a.id === (amp && kind(amp)?.circuit)) ?? AMPS[0];
    const turned = (k: keyof Knobs) => (amp ? (patch.knobs[amp]?.[k] ?? ampDef.knobs[k] / 10) * 10 : ampDef.knobs[k]);
    const knobs: Knobs = { gain: turned("gain"), bass: turned("bass"), mid: turned("mid"), treble: turned("treble"), master: turned("master"), noise: turned("noise"), rate: turned("rate"), depth: turned("depth") };
    const specs = runMachines.flatMap((id) => { const g = kind(id), s = g && loopSpec(g, patch.knobs[id]); return s ? [s] : []; });
    return {
      settings: { amp: ampDef.id, pedal: null, drive: 0, swaps: {}, board, knobs, mic: DEFAULT_ROOM.mic, bypass: false, oversample, loop: specs, ...(amp ? {} : { direct: true }) },
      running: [...onBoard, ...(amp ? [amp] : []), ...runMachines],
      problems,
    };
  };

  /** An amp's effects loop: nothing (no cable in the return), or the machines from its send to its return. */
  const ampLoop = (amp: string): Walk => {
    if (!other([amp, "return"])) return { items: [], amp: null, why: null };
    const w = walk([amp, "return"], (e) => same(e, [amp, "send"]), false);
    const pedal = w.items.find((id) => kind(id)?.kind === "pedal" || kind(id)?.kind === "split");
    if (!w.why && pedal) return { ...w, why: `${name(pedal)} is in ${name(amp)}'s loop: the loop takes machines (Q Bucket, Q Tape, Q Spring)` };
    return w.why ? { ...w, why: `${name(amp)}'s loop is open (its return is in, so nothing else gets through): ${w.why}` } : w;
  };

  const why: string[] = [];
  const fail = (w: string) => { if (!why.length) why.push(w); };
  let found: Omit<Heard, "inserts" | "returns"> | null = null;
  const cabs = patch.placed.filter((p) => kind(p.id)?.kind === "cab");
  for (const cab of cabs) {
    const src = other([cab.id, "in"]);
    if (!src) { fail(`nothing plugged into ${name(cab.id)}`); continue; }
    if (kind(src[0])?.kind !== "amp" || src[1] !== "speaker") { fail(`${name(cab.id)} is cabled to ${name(src[0])}'s ${src[1]}: only an amp's speaker out drives a cab`); continue; }
    const front = walk([src[0], "in"], (e) => kind(e[0])?.kind === "guitar", false);
    if (front.why) { fail(front.why); continue; }
    const loop = ampLoop(src[0]);
    if (loop.why) { fail(loop.why); continue; }
    const guitar = other(front.items.length ? [front.items[0], "in"] : [src[0], "in"]);
    const r = rig(src[0], [...front.items, src[0]], loop.items);
    found = { playing: true, chain: [guitar?.[0] ?? "guitar", ...expand(front.items), src[0], ...loop.items, cab.id], ...r };
    break;
  }
  if (!cabs.length) fail("no speaker cab in the room");

  const inserts: Insert[] = [], returns: AuxReturn[] = [];
  for (const desk of patch.placed.filter((p) => kind(p.id)?.kind === "desk")) {
    for (let a = 1; a <= DESK_AUXES; a++) {
      const ret: End = [desk.id, `aux-return-${a}`], send: End = [desk.id, `aux-send-${a}`];
      if (!other(ret) && !other(send) || returns.some((x) => x.aux === a)) continue;
      const w = walk(ret, (e) => same(e, send), true);
      const loop = !w.why && w.amp ? ampLoop(w.amp) : null;
      const problem = w.why ?? loop?.why ?? (w.items.length ? null : `aux ${a}'s send goes straight back into its return: no effect on it`);
      const r = problem ? null : rig(w.amp, w.items, loop?.items ?? []);
      returns.push({ aux: a, chain: r ? [desk.id, ...expand(w.items), ...(loop?.items ?? []), desk.id] : [], whole: !!r, problems: problem ? [problem] : r?.problems ?? [], settings: r?.settings ?? null, running: r?.running ?? [] });
    }
    for (let t = 1; t <= DESK_TRACKS; t++) {
      const ret: End = [desk.id, `return-${t}`], send: End = [desk.id, `send-${t}`];
      if (!other(ret) && !other(send)) continue;
      const w = walk(ret, (e) => same(e, send), true);
      const loop = !w.why && w.amp ? ampLoop(w.amp) : null;
      const problem = w.why ?? loop?.why ?? (w.items.length ? null : `track ${t}'s send goes straight back into its return: nothing in the insert`);
      const chain = [desk.id, ...expand(w.items), ...(loop?.items ?? []), desk.id];
      inserts.push({ track: t, chain: problem ? [] : chain, whole: !problem, problems: problem ? [problem] : [] });
      if (!found && !problem) found = { playing: true, chain, ...rig(w.amp, w.items, loop?.items ?? []) };
    }
  }
  if (found) return { ...found, inserts, returns };
  const insertWhy = inserts.find((i) => !i.whole)?.problems[0];
  return { playing: false, chain: [], running: [], settings: null, problems: [...(insertWhy ? [insertWhy] : []), ...why], inserts, returns };
}

// ---- for probes and tests ----

const cm = (v: number) => Math.round(v * 100) / 100;
const deg = (v: number) => Math.round((v * 180) / Math.PI);

/** What a test or an agent reads: you, what you hold and look at, every box, cable and knob, and what you hear. */
export function snapshot(r: Room) {
  return {
    you: { x: cm(r.you.x), z: cm(r.you.z), yaw: deg(r.you.yaw), pitch: deg(r.you.pitch) },
    holding: hand(r) ?? null,
    aimed: aimed(r),
    items: r.studio.patch.placed.map((p) => { const q = placedNow(r, p); return { id: p.id, gear: p.gear, at: q.at.map(cm), turn: deg(q.turn), held: heldId(r) === p.id }; }),
    cables: r.studio.patch.cables,
    knobs: r.studio.patch.knobs,
    heard: listen(r.studio.patch),
  };
}
