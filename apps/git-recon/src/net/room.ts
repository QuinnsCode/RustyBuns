// One battle, with no sockets: the world (world.ts) feeds it players and their inputs and
// sends out what it hands back. It runs the same Game the page runs on its own, with a mode
// and any number of players, steps it with each player's latest Input, and packs a snapshot
// for each of them holding only what's within VIEW of their soldier. Shots are the battle's
// call, never the page's. When a battle's decided it starts the next round on the same repo.

import { LEVELS, placeLevel, type LevelDef } from "../levels/levels.ts";
import { placeName } from "../levels/place.ts";
import { Game, type GameEvent, type Input } from "../sim/game.ts";
import { missionFor } from "../sim/missions.ts";
import type { ZoneData } from "../sim/terrain.ts";
import { ORDER } from "../sim/weapons.ts";
import { MAX_PLAYERS, packSoldier, VIEW, cleanInput, type FileState, type Look, type RosterEntry, type Setup, type ShotState, type Snap, type StashState } from "./wire.ts";

/** Seconds the result stays up before the next round. */
export const NEXT_ROUND = 10;
const MODES = ["coop", "ffa", "teams"];

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

export class Room {
  game: Game;
  /** Goes up with every new round: the world welcomes everyone again. */
  round = 0;
  private ids = new Map<string, number>();
  private names = new Map<string, string>();
  private looks = new Map<number, Look>();
  private held = new Map<number, Input>();
  /** Taps since the last step (a jump, a roll, a weapon, a single shot): they act even if the key's already up. */
  private taps = new Map<number, Pick<Input, "jump" | "roll" | "fire" | "weapon" | "reload">>();
  private events: GameEvent[] = [];
  private files = new Map<string, string>();
  private roster = "";
  private last: number | null = null;
  private endedAt: number | null = null;

  constructor(readonly setup: Setup) {
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
    this.ids.delete(key), this.names.delete(key), this.looks.delete(id), this.held.delete(id), this.taps.delete(id);
  }

  idOf(key: string): number | undefined { return this.ids.get(key); }

  input(key: string, raw: unknown) {
    const id = this.ids.get(key), i = cleanInput(raw);
    if (id === undefined || !i) return;
    this.held.set(id, i);
    const t = this.taps.get(id) ?? { jump: false, roll: false, fire: false, reload: false };
    this.taps.set(id, { jump: t.jump || i.jump, roll: t.roll || i.roll, fire: t.fire || i.fire, weapon: i.weapon ?? t.weapon, reload: t.reload || i.reload });
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
    this.events.push(...this.game.step(dt, inputs));
  }

  private nextRound() {
    const keys = [...this.ids.keys()];
    const looks = new Map(keys.map((k) => [k, this.looks.get(this.ids.get(k)!)!]));
    this.game = battleGame(this.setup);
    this.ids.clear(), this.looks.clear(), this.held.clear(), this.taps.clear(), this.files.clear();
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

  /** One player's snapshot: the soldiers and rounds within VIEW of them, everything else everyone gets. */
  snap(key: string, shared: ReturnType<Room["drain"]>): Snap | null {
    const id = this.ids.get(key), g = this.game, me = id === undefined ? undefined : g.soldiers[id];
    if (!me) return null;
    const near = (x: number, z: number) => Math.hypot(x - me.x, z - me.z) <= VIEW;
    const soldiers = g.soldiers.filter((s) => s.id === me.id || (!s.gone && near(s.x, s.z))).map(packSoldier);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const shots: ShotState[] = g.shots.filter((p) => near(p.x, p.z)).map((p) => [p.id, p.owner, p.team, p.weapon, r2(p.x), r2(p.y), r2(p.z), r2(p.vx), r2(p.vy), r2(p.vz), r2(p.age)]);
    const stashes: StashState[] = g.stashes.map((s) => [s.id, r2(s.x), r2(s.y), r2(s.z)]);
    return {
      t: "snap", time: g.time, status: g.status, winner: g.winner, soldiers,
      you: { ammo: ORDER.map((w) => me.ammo[w]), loaded: ORDER.map((w) => me.loaded[w]), reload: r2(me.reload), cd: r2(me.cd), heat: me.heat, shieldT: r2(me.shieldT), rollCd: r2(me.rollCd) },
      shots, stashes, pickups: g.pickups, objective: g.objective, cleared: g.cleared, files: shared.files, events: shared.events,
      ...(shared.roster ? { roster: shared.roster } : {}),
    };
  }
}
