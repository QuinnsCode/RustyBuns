// What crosses the socket in a battle, and how a soldier packs into a few numbers for it.
// The page sends its Input; the world sends a welcome once (JSON), then a snapshot SNAP_HZ times
// a second as a binary frame. Positions go to the centimetre and angles to the milliradian. A
// snapshot is a delta against the last one the page acked (it says which with each Input): only
// the soldiers that changed, and of those only the fields that did; the soldiers that left your
// view by id. A round in flight comes once and the page flies it on, again only if it strays
// from that (gravity, homing, a bounce). Your ammo and clocks, and the events, are binary too;
// the rarer stuff (pickups, the objective, files, the roster) rides as a short JSON tail, and
// only when it changed.

import type { RepoSnapshot } from "../sim/codemap.ts";
import type { GameEvent, Input, Mode, Objective, Pickup, PickupKind, Soldier, Team } from "../sim/game.ts";
import type { ZoneData } from "../sim/terrain.ts";
import type { VehicleKind } from "../sim/vehicles.ts";
import { ORDER, type WeaponId } from "../sim/weapons.ts";

/** Snapshots a second, and players a room holds. */
export const SNAP_HZ = 20, MAX_PLAYERS = 64;
/** How far off a soldier or a round still comes in your snapshot, in metres. */
export const VIEW = 90;

/**
 * What a battle is: a level, a repo on it, and a mode. The host picks; everyone gets the same.
 * A lat/long level ("place:<lat>,<lon>") brings its ground along, read in the host's page.
 */
export interface Setup { level: string; mode: Mode; repo: RepoSnapshot; zone?: ZoneData }

/** How a player looks: a head and a build, by id. Looks only. */
export interface Look { head: string; build: string }

export interface RosterEntry { id: number; name: string; team: Team; score: number; deaths: number; look: Look }

/** A file's height and lines left, by path; a height of 0 is razed. */
export type FileState = [path: string, h: number, lines: number];

/** [id, x, y, z, vx, vy, vz, yaw, pitch, hp, shield, flags, weapon, roll] */
export type SoldierState = number[];
export type ShotState = [id: number, owner: number, team: Team, weapon: WeaponId, x: number, y: number, z: number, vx: number, vy: number, vz: number, age: number];
export type StashState = [id: number, x: number, y: number, z: number];

/** What only your own soldier needs: ammo per weapon (in ORDER), cooldowns, the shield's clock. */
export interface Private { ammo: number[]; loaded: number[]; reload: number; cd: number; heat: number; shieldT: number; rollCd: number }

export type ToWorld =
  | { t: "setup"; setup: Setup }
  /** ack: the newest snapshot this page has applied, to send the next ones against. */
  | { t: "in"; i: Input; ack?: number };

export type FromWorld =
  | { t: "wait" }
  | { t: "welcome"; setup: Setup; me: number; roster: RosterEntry[]; files: FileState[]; snap: Snap }
  | Snap;

/** How far a round can be from where the page flies it before it's sent again, in metres. */
export const STRAY = 0.05;

/** A soldier against the base: its id, then each field, or null where it's the same as there. */
export type SoldierDelta = (number | null)[];

/**
 * A snapshot as it goes out: against snapshot `base` (0: against nothing, so everything's in it).
 * Soldiers are the ones new or changed since the base; gone, the base's that aren't in it now.
 * Shots are the rounds new or off the line flown on from the base; spent, the base's that are
 * gone. An optional field left out is as it was in the base.
 */
export interface Snap {
  t: "snap";
  seq: number;
  base: number;
  /** The newest of your inputs the world had heard (its seq): your frames after it get played again. */
  input: number;
  time: number;
  status: Status;
  soldiers: SoldierDelta[];
  gone: number[];
  shots: ShotState[];
  spent: number[];
  stashes: StashState[];
  winner?: string | null;
  you?: Private | null;
  pickups?: Pickup[];
  objective?: Objective;
  cleared?: boolean[];
  files: FileState[];
  events: GameEvent[];
  roster?: RosterEntry[];
}

export type Status = "playing" | "won" | "lost";

/** A snapshot whole: a base, and what a delta against it builds. */
export interface Frame {
  time: number;
  soldiers: Map<number, SoldierState>;
  shots: Map<number, ShotState>;
  winner: string | null;
  you: Private | null;
  pickups: Pickup[];
  objective: Objective;
  cleared: boolean[];
}

/** The fields a delta leaves out when they're the same as the base's. */
export const KEPT = ["winner", "you", "pickups", "objective", "cleared"] as const;

/** The frame a snapshot builds on its base (which it needs unless it's against nothing). */
export function rebuild(base: Frame | undefined, snap: Snap): Frame {
  const soldiers = new Map(base?.soldiers);
  for (const id of snap.gone) soldiers.delete(id);
  for (const d of snap.soldiers) {
    const id = d[0]!, was = soldiers.get(id);
    soldiers.set(id, d.map((v, i) => v ?? was?.[i] ?? 0));
  }
  const shots = new Map<number, ShotState>(), spent = new Set(snap.spent);
  if (base) for (const [id, p] of base.shots) if (!spent.has(id)) shots.set(id, fly(p, snap.time - base.time));
  for (const p of snap.shots) shots.set(p[0], p);
  const out = { time: snap.time, soldiers, shots, winner: null, you: null, pickups: [], objective: { kind: "clear" }, cleared: [] } as Frame;
  for (const k of KEPT) (out as any)[k] = snap[k] !== undefined ? snap[k] : base ? base[k] : out[k];
  return out;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A round flown on dt seconds in a straight line, to the centimetre: the same sum on the world and the page. */
export function fly(p: ShotState, dt: number): ShotState {
  const [id, owner, team, weapon, x, y, z, vx, vy, vz, age] = p;
  return [id, owner, team, weapon, r2(x + vx * dt), r2(y + vy * dt), r2(z + vz * dt), vx, vy, vz, r2(age + dt)];
}

/** A round against where the page would fly it from the base: null while it's on that line. */
export function diffShot(flown: ShotState | undefined, now: ShotState): ShotState | null {
  if (!flown || [7, 8, 9].some((i) => flown[i] !== now[i])) return now;
  return Math.hypot(flown[4] - now[4], flown[5] - now[5], flown[6] - now[6]) <= STRAY ? null : now;
}

/** A soldier against its state in the base: null if nothing changed, all of it if the base hadn't got it. */
export function diffSoldier(was: SoldierState | undefined, now: SoldierState): SoldierDelta | null {
  if (!was) return now;
  const d = now.map((v, i) => (i === 0 || v !== was[i] ? v : null));
  return d.some((v, i) => i > 0 && v !== null) ? d : null;
}

// Each SoldierState field after the id: how it's scaled to an integer, and the integer's width.
type Kind = "i8" | "u8" | "i16" | "u16" | "i32";
const SOLDIER: [scale: number, kind: Kind][] = [
  [100, "i32"], [100, "i32"], [100, "i32"], // x y z
  [100, "i16"], [100, "i16"], [100, "i16"], // vx vy vz, to 327 m/s
  [1000, "i32"], [1000, "i16"], // yaw (it winds on), pitch
  [1, "u16"], [1, "u16"], [1, "u16"], [1, "u8"], // hp shield flags weapon
  [100, "i16"], // roll
];
const RANGE: Record<Kind, [number, number]> = { i8: [-128, 127], u8: [0, 255], i16: [-32768, 32767], u16: [0, 65535], i32: [-(2 ** 31), 2 ** 31 - 1] };
/** v as the wire carries it: scaled, rounded, clamped to the width, and scaled back. */
const fit = (v: number, scale: number, kind: Kind) => {
  const [lo, hi] = RANGE[kind];
  return Math.max(lo, Math.min(hi, Math.round(v * scale))) / scale;
};

const F = { alive: 1, grounded: 2, crouch: 4, prone: 8, scoped: 16, heavy: 32, gone: 64, burning: 128, tagged: 256 };

export function packSoldier(s: Soldier): SoldierState {
  const flags = (s.alive ? F.alive : 0) | (s.grounded ? F.grounded : 0) | (s.crouch ? F.crouch : 0) | (s.prone ? F.prone : 0) | (s.scoped ? F.scoped : 0)
    | (s.heavy ? F.heavy : 0) | (s.gone ? F.gone : 0) | (s.burn > 0 ? F.burning : 0) | (s.tagged > 0 ? F.tagged : 0);
  const raw = [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.yaw, s.pitch, Math.ceil(s.hp), Math.ceil(s.shield), flags, ORDER.indexOf(s.weapon), s.roll];
  return [s.id, ...raw.map((v, i) => fit(v, ...SOLDIER[i]!))];
}

/** Puts a packed soldier's public state onto s. Burning and tagged come back as on or off. */
export function unpackSoldier(st: SoldierState, s: Soldier) {
  const [, x, y, z, vx, vy, vz, yaw, pitch, hp, shield, flags, weapon, roll] = st as [number, number, number, number, number, number, number, number, number, number, number, number, number, number];
  Object.assign(s, {
    x, y, z, vx, vy, vz, yaw, pitch, hp, shield, roll,
    alive: !!(flags & F.alive), grounded: !!(flags & F.grounded), crouch: !!(flags & F.crouch), prone: !!(flags & F.prone), scoped: !!(flags & F.scoped),
    heavy: !!(flags & F.heavy), gone: !!(flags & F.gone), burn: flags & F.burning ? 1 : 0, tagged: flags & F.tagged ? 1 : 0,
    weapon: ORDER[weapon] ?? "commit",
  });
}

const num = (v: unknown, lo: number, hi: number, d = 0) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

/** A player's Input as it came off the wire, made safe: numbers in range, a weapon that exists, an aim point that's a point. */
export function cleanInput(raw: unknown): Input | null {
  if (!raw || typeof raw !== "object") return null;
  const i = raw as Record<string, unknown>, a = i.aim as Record<string, unknown> | undefined;
  const aim = a && typeof a === "object" && [a.x, a.y, a.z].every((v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e4)
    ? { x: a.x as number, y: a.y as number, z: a.z as number } : undefined;
  return {
    right: num(i.right, -1, 1), forward: num(i.forward, -1, 1),
    yaw: num(i.yaw, -1e6, 1e6), pitch: num(i.pitch, -1.6, 1.6),
    jump: i.jump === true, roll: i.roll === true, crouch: i.crouch === true, prone: i.prone === true, scope: i.scope === true, fire: i.fire === true, reload: i.reload === true,
    aim, weapon: ORDER.includes(i.weapon as WeaponId) ? (i.weapon as WeaponId) : undefined,
    ...(typeof i.seq === "number" && Number.isInteger(i.seq) && i.seq >= 0 ? { seq: i.seq } : {}),
    ...(typeof i.view === "number" && Number.isFinite(i.view) ? { view: i.view } : {}),
  };
}

// ---- the binary frame -------------------------------------------------------
//
//   u8 1 · u32 seq · u32 base · u32 input · f64 time · u8 status
//   u16 n · n × (u16 id · u16 mask · the fields the mask names, as SOLDIER says)
//   u16 n · n × u16 gone id
//   u16 n · n × shot (u32 id · u16 owner · u8 team · u8 weapon · i32 x y z vx vy vz in cm · u16 age in cs)
//   u16 n · n × u32 spent id
//   u16 n · n × stash (u32 id · i32 x y z in cm)
//   you: u8 0 (as in the base), 1 (none), or 2 then u8 n · n × (i16 ammo · i16 loaded) · i16 reload cd heat shieldT rollCd in cs
//   u16 n · n × event (u8 kind, as EVENTS orders them · its fields, as EVENTS says)
//   the rest: UTF-8 JSON of the optional fields that are there, to the end

const TAG = 1;
const STATUS: Status[] = ["playing", "won", "lost"];
const TEAMS: Team[] = ["you", "conflict", "ours", "theirs"];
const SIZE: Record<Kind, number> = { i8: 1, u8: 1, i16: 2, u16: 2, i32: 4 };
const TAIL = ["winner", "pickups", "objective", "cleared", "files", "roster"] as const;
const CLOCKS = ["reload", "cd", "heat", "shieldT", "rollCd"] as const;

// Each event kind's fields, in order, and how each goes: a soldier id (u16), any other id or
// count (i32), a length in cm (i32), a weapon, a yes/no, a string, or one of a few words (u8).
type EventField = "soldier" | "int" | "cm" | "weapon" | "bool" | "str" | readonly string[];
const VEHICLE: VehicleKind[] = ["roadster", "heli"], PICKUP: PickupKind[] = ["ammo", "health", "reset"];
const EVENTS: { [K in GameEvent["kind"]]: [keyof Extract<GameEvent, { kind: K }>, EventField][] } = {
  fire: [["id", "soldier"], ["weapon", "weapon"]],
  hit: [["target", "soldier"], ["by", "int"], ["damage", "cm"], ["shield", "bool"]],
  shield: [["id", "soldier"], ["state", ["broke", "charging", "full"]]],
  boom: [["x", "cm"], ["y", "cm"], ["z", "cm"], ["r", "cm"]],
  down: [["id", "soldier"], ["by", "int"]],
  respawn: [["id", "soldier"], ["lives", "int"]],
  cleared: [["compound", "int"]],
  pickup: [["id", "soldier"], ["item", PICKUP]],
  blamed: [["id", "soldier"]],
  reverted: [["id", "soldier"]],
  stashed: [["x", "cm"], ["y", "cm"], ["z", "cm"]],
  impact: [["x", "cm"], ["y", "cm"], ["z", "cm"], ["weapon", "weapon"]],
  razed: [["path", "str"], ["lines", "int"], ["by", "int"], ["x", "cm"], ["y", "cm"], ["z", "cm"], ["w", "cm"], ["h", "cm"], ["d", "cm"]],
  objective: [["text", "str"]],
  reload: [["id", "soldier"], ["weapon", "weapon"]],
  streak: [["vehicle", VEHICLE], ["kills", "int"]],
  board: [["vehicle", VEHICLE], ["on", "bool"]],
  vehicleHit: [["id", "int"], ["damage", "cm"]],
  wrecked: [["id", "int"], ["vehicle", VEHICLE]],
  won: [],
  lost: [],
  joined: [["id", "soldier"]],
  left: [["id", "soldier"]],
};
const KINDS = Object.keys(EVENTS) as GameEvent["kind"][];

const text = new TextEncoder(), untext = new TextDecoder();

class Out {
  private buf = new ArrayBuffer(1024);
  private v = new DataView(this.buf);
  at = 0;
  private room(n: number) {
    if (this.at + n <= this.buf.byteLength) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.at + n));
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.at));
    this.buf = next, this.v = new DataView(next);
  }
  put(kind: Kind | "u32" | "f64", n: number) {
    this.room(8);
    const v = this.v, at = this.at;
    if (kind === "i8") v.setInt8(at, n); else if (kind === "u8") v.setUint8(at, n);
    else if (kind === "i16") v.setInt16(at, n, true); else if (kind === "u16") v.setUint16(at, n, true);
    else if (kind === "i32") v.setInt32(at, n, true); else if (kind === "u32") v.setUint32(at, n, true);
    else v.setFloat64(at, n, true);
    this.at += kind === "f64" ? 8 : kind === "u32" ? 4 : SIZE[kind];
  }
  /** n scaled to an integer of that width, clamped. */
  num(n: number, scale: number, kind: Kind) { this.put(kind, Math.round(fit(n, scale, kind) * scale)); }
  bytes(b: Uint8Array) { this.room(b.length); new Uint8Array(this.buf).set(b, this.at); this.at += b.length; }
  str(t: string) { const b = text.encode(t); this.put("u16", b.length), this.bytes(b); }
  done(): Uint8Array { return new Uint8Array(this.buf, 0, this.at); }
}

class In {
  private v: DataView;
  at = 0;
  constructor(readonly b: Uint8Array) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  get(kind: Kind | "u32" | "f64"): number {
    const v = this.v, at = this.at;
    this.at += kind === "f64" ? 8 : kind === "u32" ? 4 : SIZE[kind];
    return kind === "i8" ? v.getInt8(at) : kind === "u8" ? v.getUint8(at) : kind === "i16" ? v.getInt16(at, true) : kind === "u16" ? v.getUint16(at, true)
      : kind === "i32" ? v.getInt32(at, true) : kind === "u32" ? v.getUint32(at, true) : v.getFloat64(at, true);
  }
  num(scale: number, kind: Kind) { return this.get(kind) / scale; }
  str(): string {
    const n = this.get("u16"), at = this.at;
    if (at + n > this.b.length) throw new RangeError("short string");
    this.at += n;
    return untext.decode(this.b.subarray(at, at + n));
  }
}

export function encodeSnap(s: Snap): Uint8Array {
  const o = new Out();
  o.put("u8", TAG), o.put("u32", s.seq), o.put("u32", s.base), o.put("u32", s.input), o.put("f64", s.time), o.put("u8", STATUS.indexOf(s.status));
  o.put("u16", s.soldiers.length);
  for (const d of s.soldiers) {
    let mask = 0;
    for (let i = 1; i < d.length; i++) if (d[i] != null) mask |= 1 << (i - 1);
    o.put("u16", d[0]!), o.put("u16", mask);
    SOLDIER.forEach(([scale, kind], i) => { if (mask & (1 << i)) o.num(d[i + 1]!, scale, kind); });
  }
  o.put("u16", s.gone.length);
  for (const id of s.gone) o.put("u16", id);
  o.put("u16", s.shots.length);
  for (const [id, owner, team, weapon, x, y, z, vx, vy, vz, age] of s.shots) {
    o.put("u32", id), o.put("u16", owner), o.put("u8", TEAMS.indexOf(team)), o.put("u8", ORDER.indexOf(weapon));
    for (const n of [x, y, z, vx, vy, vz]) o.num(n, 100, "i32");
    o.num(age, 100, "u16");
  }
  o.put("u16", s.spent.length);
  for (const id of s.spent) o.put("u32", id);
  o.put("u16", s.stashes.length);
  for (const [id, x, y, z] of s.stashes) {
    o.put("u32", id);
    for (const n of [x, y, z]) o.num(n, 100, "i32");
  }
  o.put("u8", s.you === undefined ? 0 : s.you === null ? 1 : 2);
  if (s.you) {
    o.put("u8", s.you.ammo.length);
    s.you.ammo.forEach((n, i) => (o.num(n, 1, "i16"), o.num(s.you!.loaded[i] ?? 0, 1, "i16")));
    for (const k of CLOCKS) o.num(s.you[k], 100, "i16");
  }
  o.put("u16", s.events.length);
  for (const e of s.events) {
    o.put("u8", KINDS.indexOf(e.kind));
    for (const [k, f] of EVENTS[e.kind] as [string, EventField][]) {
      const v = (e as any)[k];
      if (f === "soldier") o.num(v, 1, "u16"); else if (f === "int") o.num(v, 1, "i32"); else if (f === "cm") o.num(v, 100, "i32");
      else if (f === "weapon") o.put("u8", ORDER.indexOf(v)); else if (f === "bool") o.put("u8", v ? 1 : 0);
      else if (f === "str") o.str(v); else o.put("u8", f.indexOf(v));
    }
  }
  const tail: Record<string, unknown> = {};
  for (const k of TAIL) {
    const v = s[k];
    if (v !== undefined && !(k === "files" && !s.files.length)) tail[k] = v;
  }
  if (Object.keys(tail).length) o.bytes(text.encode(JSON.stringify(tail)));
  return o.done();
}

/** A binary frame back into a Snap; null if it isn't one. */
export function decodeSnap(bytes: ArrayBuffer | Uint8Array): Snap | null {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const r = new In(b);
  try {
    if (r.get("u8") !== TAG) return null;
    const seq = r.get("u32"), base = r.get("u32"), input = r.get("u32"), time = r.get("f64"), status = STATUS[r.get("u8")] ?? "playing";
    const soldiers: SoldierDelta[] = [];
    for (let n = r.get("u16"); n > 0; n--) {
      const id = r.get("u16"), mask = r.get("u16");
      soldiers.push([id, ...SOLDIER.map(([scale, kind], i) => (mask & (1 << i) ? r.num(scale, kind) : null))]);
    }
    const gone: number[] = [];
    for (let n = r.get("u16"); n > 0; n--) gone.push(r.get("u16"));
    const shots: ShotState[] = [];
    for (let n = r.get("u16"); n > 0; n--) {
      const id = r.get("u32"), owner = r.get("u16"), team = TEAMS[r.get("u8")] ?? "you", weapon = ORDER[r.get("u8")] ?? "commit";
      const [x, y, z, vx, vy, vz] = [0, 0, 0, 0, 0, 0].map(() => r.num(100, "i32")) as [number, number, number, number, number, number];
      shots.push([id, owner, team, weapon, x, y, z, vx, vy, vz, r.num(100, "u16")]);
    }
    const spent: number[] = [];
    for (let n = r.get("u16"); n > 0; n--) spent.push(r.get("u32"));
    const stashes: StashState[] = [];
    for (let n = r.get("u16"); n > 0; n--) stashes.push([r.get("u32"), r.num(100, "i32"), r.num(100, "i32"), r.num(100, "i32")]);
    const has = r.get("u8");
    let you: Private | null | undefined = has === 0 ? undefined : null;
    if (has === 2) {
      const ammo: number[] = [], loaded: number[] = [];
      for (let n = r.get("u8"); n > 0; n--) ammo.push(r.get("i16")), loaded.push(r.get("i16"));
      you = { ammo, loaded } as Private;
      for (const k of CLOCKS) you[k] = r.num(100, "i16");
    }
    const events: GameEvent[] = [];
    for (let n = r.get("u16"); n > 0; n--) {
      const kind = KINDS[r.get("u8")];
      if (!kind) return null;
      const e: Record<string, unknown> = { kind };
      for (const [k, f] of EVENTS[kind] as [string, EventField][]) {
        e[k] = f === "soldier" ? r.get("u16") : f === "int" ? r.get("i32") : f === "cm" ? r.num(100, "i32")
          : f === "weapon" ? ORDER[r.get("u8")] ?? "commit" : f === "bool" ? r.get("u8") === 1 : f === "str" ? r.str() : f[r.get("u8")] ?? f[0];
      }
      events.push(e as GameEvent);
    }
    const tail = r.at < b.length ? JSON.parse(untext.decode(b.subarray(r.at))) : {};
    const snap: Snap = { t: "snap", seq, base, input, time, status, soldiers, gone, shots, spent, stashes, files: tail.files ?? [], events };
    if (you !== undefined) snap.you = you;
    for (const k of TAIL) if (tail[k] !== undefined) (snap as any)[k] = tail[k];
    return snap;
  } catch {
    return null;
  }
}
