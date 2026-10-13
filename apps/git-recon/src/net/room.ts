// One battle, with no sockets: the world (world.ts) feeds it players and their inputs and
// sends out what it hands back. It runs the same Game the page runs on its own, with a mode
// and any number of players, steps it with each player's latest Input, and packs a snapshot
// for each of them holding only what's within VIEW of their soldier, as a delta against the
// last one that player acked. Shots are the battle's call, never the page's. When a battle's
// decided it starts the next round on the same repo.

import { LEVELS, placeLevel, type LevelDef } from "../levels/levels.ts";
import { placeName } from "../levels/place.ts";
import { Game, MAX_REWIND, type GameEvent, type Input } from "../sim/game.ts";
import { missionFor } from "../sim/missions.ts";
import type { ZoneData } from "../sim/terrain.ts";
import { ORDER } from "../sim/weapons.ts";
import { cleanInput, diffShot, diffSoldier, fly, KEPT, MAX_PLAYERS, packSoldier, VIEW, type FileState, type Look, type RosterEntry, type Setup, type ShotState, type Snap, type SoldierDelta, type SoldierState, type StashState } from "./wire.ts";

/** Seconds the result stays up before the next round. */
export const NEXT_ROUND = 10;
const MODES = ["coop", "ffa", "teams"];
/** Snapshots a player's kept to be acked against: past this many unacked, the next goes whole. */
const HISTORY = 64;

/** What a player was sent in one snapshot, whole: their soldiers, and the kept fields as JSON. */
interface Sent { time: number; soldiers: Map<number, SoldierState>; shots: Map<number, ShotState>; kept: Record<string, string> }
/** A player's snapshots: the newest they've acked, and the ones sent since that they might. */
interface Line { acked: number; sent: Map<number, Sent> }

/** A setup off the wire, checked: a level the world has (or a lat/long one with its ground), a mode, and a repo shaped like one. */
export function cleanSetup(raw: unknown): Setup | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, any>, repo = s.repo;
  if (!MODES.includes(s.mode)) return null;
  if (!repo || typeof repo.name !== "string" || typeof repo.ref !== "string" || !Array.isArray(repo.files) || repo.files.length > 5000) return null;
  if (!repo.files.every((f: any) => f && typeof f.path === "string" && f.path.length < 400 && typeof f.lines === "number" && Number.isFinite(f.lines))) return null;
  if (LEVELS.some((l) => l.id === s.level)) return { level: s.level, mode: s.mode, repo };
  const zone = cleanZone(s.zone);
  if (!zone || s.level !== `place:${zone.id}`) return null;
  try {
    levelOf({ level: s.level, mode: s.mode, repo, zone });
  } catch {
    return null;
  }
  return { level: s.level, mode: s.mode, repo, zone };
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * A lat/long level's ground off the wire: a place on the map, a sane size, and exactly n*n
 * heights. Its id and name are made again from the place, never taken from the sender.
 */
export function cleanZone(raw: unknown): ZoneData | null {
  if (!raw || typeof raw !== "object") return null;
  const z = raw as Record<string, any>, [lon, lat] = Array.isArray(z.center) ? z.center : [];
  if (typeof lat !== "number" || typeof lon !== "number" || !(Math.abs(lat) <= 84) || !(Math.abs(lon) <= 180)) return null;
  if (typeof z.realRadius !== "number" || !(z.realRadius >= 100 && z.realRadius <= 10_000)) return null;
  if (!Number.isInteger(z.n) || z.n < 2 || z.n > 257) return null;
  if (typeof z.heights !== "string" || z.heights.length !== 4 * Math.ceil((z.n * z.n * 2) / 3) || !BASE64.test(z.heights)) return null;
  return { id: `${lat.toFixed(4)},${lon.toFixed(4)}`, name: placeName(lat, lon), center: [lon, lat], realRadius: z.realRadius, n: z.n, heights: z.heights };
}

// placeLevel tries a few seeds over the ground; a battle asks for the same place every round.
let placed: { key: string; def: LevelDef } | null = null;

/** The level a setup is on: a built-in one, or the lat/long it carries the ground of. */
export function levelOf(setup: Setup): LevelDef {
  const def = LEVELS.find((l) => l.id === setup.level);
  if (def) return def;
  if (!setup.zone) throw new Error(`no level ${setup.level}`);
  const key = `${setup.zone.id}:${setup.zone.realRadius}:${setup.zone.heights}`;
  if (placed?.key !== key) placed = { key, def: placeLevel(setup.zone) };
  return placed.def;
}

/** The battle a setup makes: the same on the world and on every page, guards and all. */
export function battleGame(setup: Setup): Game {
  const def = levelOf(setup);
  return Game.fromRepo(def.ground(), setup.repo, def.seed, missionFor(def.id), setup.mode);
}

/**
 * Whether a player's snapshot carries an event. The ones every round makes (a shot, a reload,
 * an impact, a hit) go only to those who can see where it happened or are in it; the rest go
 * to everyone.
 */
function heard(e: GameEvent, me: number, seen: Map<number, unknown>, near: (x: number, z: number) => boolean): boolean {
  switch (e.kind) {
    case "fire": case "reload": case "shield": return e.id === me || seen.has(e.id);
    case "hit": return e.by === me || e.target === me || seen.has(e.target);
    case "impact": case "boom": return near(e.x, e.z);
    default: return true;
  }
}

export class Room {
  game: Game;
  /** Goes up with every new round: the world welcomes everyone again. */
  round = 0;
  private ids = new Map<string, number>();
  private names = new Map<string, string>();
  private looks = new Map<number, Look>();
  private held = new Map<number, Input>();
  /** The newest input seq from each player, echoed in their snapshot. */
  private lastInput = new Map<number, number>();
  /** Taps since the last step (a jump, a roll, a weapon, a single shot): they act even if the key's already up. */
  private taps = new Map<number, Pick<Input, "jump" | "roll" | "fire" | "weapon" | "reload">>();
  private events: GameEvent[] = [];
  private files = new Map<string, string>();
  private roster = "";
  private last: number | null = null;
  private endedAt: number | null = null;
  private lines = new Map<string, Line>();

  /** seq: the last snapshot number used, by this room or the one it replaces (so a stale ack never matches). */
  constructor(readonly setup: Setup, public seq = 0) {
    this.game = battleGame(setup);
  }

  /** Players in the battle now. */
  get count(): number { return this.ids.size; }

  /** A player in, by a key that stays theirs (a rejoin under it gets the same soldier back). Null when it's full. */
  join(key: string, name: string, look: Look): number | null {
    const have = this.ids.get(key);
    if (have !== undefined) return have;
    if (this.ids.size >= MAX_PLAYERS) return null;
    const s = this.game.join(name.slice(0, 24) || "soldier");
    this.ids.set(key, s.id), this.names.set(key, s.name), this.looks.set(s.id, look);
    return s.id;
  }

  leave(key: string) {
    const id = this.ids.get(key);
    if (id === undefined) return;
    this.game.leave(id);
    this.ids.delete(key), this.names.delete(key), this.looks.delete(id), this.held.delete(id), this.taps.delete(id), this.lastInput.delete(id), this.lines.delete(key);
  }

  idOf(key: string): number | undefined { return this.ids.get(key); }

  input(key: string, raw: unknown) {
    const id = this.ids.get(key), i = cleanInput(raw);
    if (id === undefined || !i) return;
    this.held.set(id, i);
    if (i.seq !== undefined) this.lastInput.set(id, i.seq);
    // How far behind the battle they see everyone else (the link both ways, and the page's INTERP): their rounds are checked that far back.
    if (i.view !== undefined) this.game.lags.set(id, Math.max(0, Math.min(MAX_REWIND, this.game.time - i.view)));
    const t = this.taps.get(id) ?? { jump: false, roll: false, fire: false, reload: false };
    this.taps.set(id, { jump: t.jump || i.jump, roll: t.roll || i.roll, fire: t.fire || i.fire, weapon: i.weapon ?? t.weapon, reload: t.reload || i.reload });
  }

  /** The newest snapshot a player has applied: the next ones go against it. Older or unknown acks do nothing. */
  ack(key: string, seq: unknown) {
    const line = this.lines.get(key);
    if (!line || typeof seq !== "number" || seq <= line.acked || !line.sent.has(seq)) return;
    line.acked = seq;
    for (const s of line.sent.keys()) if (s < seq) line.sent.delete(s);
  }

  /** Steps the battle to now (ms), and starts the next round once a decided one has been up NEXT_ROUND seconds. */
  tick(now: number) {
    const dt = this.last === null ? 0 : Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.game.status !== "playing") {
      this.endedAt ??= now;
      if (now - this.endedAt >= NEXT_ROUND * 1000) this.nextRound();
      return;
    }
    const inputs = new Map<number, Input>();
    for (const [id, i] of this.held) {
      const t = this.taps.get(id);
      inputs.set(id, t ? { ...i, jump: t.jump, roll: t.roll, fire: i.fire || t.fire, weapon: t.weapon, reload: t.reload } : { ...i, jump: false, roll: false, weapon: undefined, reload: false });
    }
    this.taps.clear();
    const r2 = (v: number) => Math.round(v * 100) / 100;
    for (const e of this.game.step(dt, inputs))
      this.events.push(e.kind === "impact" || e.kind === "boom" || e.kind === "stashed" ? { ...e, x: r2(e.x), y: r2(e.y), z: r2(e.z) } : e.kind === "hit" ? { ...e, damage: r2(e.damage) } : e);
  }

  private nextRound() {
    const keys = [...this.ids.keys()];
    const looks = new Map(keys.map((k) => [k, this.looks.get(this.ids.get(k)!)!]));
    this.game = battleGame(this.setup);
    this.ids.clear(), this.looks.clear(), this.held.clear(), this.taps.clear(), this.lastInput.clear(), this.files.clear(), this.lines.clear();
    this.events = [], this.roster = "", this.endedAt = null, this.round++;
    for (const k of keys) {
      const s = this.game.join(this.names.get(k) ?? "soldier");
      this.ids.set(k, s.id), this.looks.set(s.id, looks.get(k)!);
    }
  }

  rosterNow(): RosterEntry[] {
    return this.game.players().map((s) => ({ id: s.id, name: s.name, team: s.team, score: s.score, deaths: s.deaths, look: this.looks.get(s.id) ?? { head: "ball", build: "average" } }));
  }

  /** Every file that has lost lines so far: what a newcomer needs to see the field as it stands. */
  filesNow(): FileState[] {
    const out: FileState[] = [], standing = new Set(this.game.map.blocks.map((b) => b.path));
    for (const b of this.game.map.blocks) if (this.game.hit(b)) out.push([b.path, Math.round(b.h * 100) / 100, b.lines]);
    for (const path of this.game.razedPaths()) if (!standing.has(path)) out.push([path, 0, 0]);
    return out;
  }

  /**
   * What happened since the last call, the same for everyone: the events, the files that changed,
   * and the roster when it did. Call it once per send round, then snap() each player with it.
   */
  drain(): { events: GameEvent[]; files: FileState[]; roster?: RosterEntry[] } {
    const events = this.events;
    this.events = [];
    const files: FileState[] = [];
    for (const f of this.filesNow()) {
      const k = `${f[1]},${f[2]}`;
      if (this.files.get(f[0]) !== k) this.files.set(f[0], k), files.push(f);
    }
    const roster = this.rosterNow(), key = JSON.stringify(roster);
    if (key === this.roster) return { events, files };
    this.roster = key;
    return { events, files, roster };
  }

  /**
   * One player's snapshot: the soldiers and rounds within VIEW of them, everything else everyone
   * gets, against the last snapshot they acked. whole: against nothing (a welcome), which also
   * forgets what they were sent before, since the page that has it is gone.
   */
  snap(key: string, shared: ReturnType<Room["drain"]>, whole = false): Snap | null {
    const id = this.ids.get(key), g = this.game, me = id === undefined ? undefined : g.soldiers[id];
    if (!me) return null;
    let line = this.lines.get(key);
    if (!line || whole) this.lines.set(key, (line = { acked: 0, sent: new Map() }));
    const base = line.sent.get(line.acked);
    const near = (x: number, z: number) => Math.hypot(x - me.x, z - me.z) <= VIEW;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const now = new Map(g.soldiers.filter((s) => s.id === me.id || (!s.gone && near(s.x, s.z))).map((s) => [s.id, packSoldier(s)]));
    const soldiers: SoldierDelta[] = [];
    for (const [sid, st] of now) {
      const d = diffSoldier(base?.soldiers.get(sid), st);
      if (d) soldiers.push(d);
    }
    const gone = base ? [...base.soldiers.keys()].filter((sid) => !now.has(sid)) : [];
    const kept = {
      winner: g.winner,
      you: { ammo: ORDER.map((w) => me.ammo[w]), loaded: ORDER.map((w) => me.loaded[w]), reload: r2(me.reload), cd: r2(me.cd), heat: r2(me.heat), shieldT: r2(me.shieldT), rollCd: r2(me.rollCd) },
      pickups: g.pickups.map((p) => ({ ...p, x: r2(p.x), y: r2(p.y), z: r2(p.z) })),
      objective: g.objective,
      cleared: g.cleared,
    };
    const json: Record<string, string> = {}, changed: Partial<typeof kept> = {};
    for (const k of KEPT) {
      json[k] = JSON.stringify(kept[k]);
      if (json[k] !== base?.kept[k]) (changed as any)[k] = kept[k];
    }
    // A round the page would fly to about where it is stays out; what the page has is the flown one.
    const flying = new Map<number, ShotState>(), shots: ShotState[] = [];
    for (const p of g.shots) {
      if (!near(p.x, p.z)) continue;
      const st: ShotState = [p.id, p.owner, p.team, p.weapon, r2(p.x), r2(p.y), r2(p.z), r2(p.vx), r2(p.vy), r2(p.vz), r2(p.age)];
      const was = base?.shots.get(p.id), flown = was && fly(was, g.time - base!.time), d = diffShot(flown, st);
      if (d) shots.push(d);
      flying.set(p.id, d ?? flown!);
    }
    const spent = base ? [...base.shots.keys()].filter((sid) => !flying.has(sid)) : [];
    const seq = ++this.seq;
    line.sent.set(seq, { time: g.time, soldiers: now, shots: flying, kept: json });
    for (const s of line.sent.keys()) if (line.sent.size > HISTORY) line.sent.delete(s);
    const stashes: StashState[] = g.stashes.map((s) => [s.id, r2(s.x), r2(s.y), r2(s.z)]);
    return {
      t: "snap", seq, base: base ? line.acked : 0, input: this.lastInput.get(me.id) ?? 0, time: g.time, status: g.status, soldiers, gone, shots, spent, stashes, ...changed,
      files: shared.files, events: shared.events.filter((e) => heard(e, me.id, now, near)), ...(shared.roster ? { roster: shared.roster } : {}),
    };
  }
}
