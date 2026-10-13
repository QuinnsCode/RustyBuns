// What crosses the socket in a battle, and how a soldier packs into a few numbers for it.
// The page sends its Input; the world sends a welcome once, then a snapshot SNAP_HZ times a
// second. Positions go to the centimetre and angles to the milliradian: a soldier is a short
// array, not an object, so 32 players and their guards fit in a few kilobytes.

import type { RepoSnapshot } from "../sim/codemap.ts";
import type { GameEvent, Input, Mode, Objective, Pickup, Soldier, Team } from "../sim/game.ts";
import type { ZoneData } from "../sim/terrain.ts";
import { ORDER, type WeaponId } from "../sim/weapons.ts";

/** Snapshots a second, and players a room holds. */
export const SNAP_HZ = 20, MAX_PLAYERS = 32;
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
  | { t: "in"; i: Input };

export type FromWorld =
  | { t: "wait" }
  | { t: "welcome"; setup: Setup; me: number; roster: RosterEntry[]; files: FileState[]; snap: Snap }
  | Snap;

export interface Snap {
  t: "snap";
  time: number;
  status: "playing" | "won" | "lost";
  winner: string | null;
  soldiers: SoldierState[];
  you: Private | null;
  shots: ShotState[];
  stashes: StashState[];
  pickups: Pickup[];
  objective: Objective;
  cleared: boolean[];
  files: FileState[];
  events: GameEvent[];
  roster?: RosterEntry[];
}

const F = { alive: 1, grounded: 2, crouch: 4, prone: 8, scoped: 16, heavy: 32, gone: 64, burning: 128, tagged: 256 };
const r2 = (v: number) => Math.round(v * 100) / 100, r3 = (v: number) => Math.round(v * 1000) / 1000;

export function packSoldier(s: Soldier): SoldierState {
  const flags = (s.alive ? F.alive : 0) | (s.grounded ? F.grounded : 0) | (s.crouch ? F.crouch : 0) | (s.prone ? F.prone : 0) | (s.scoped ? F.scoped : 0)
    | (s.heavy ? F.heavy : 0) | (s.gone ? F.gone : 0) | (s.burn > 0 ? F.burning : 0) | (s.tagged > 0 ? F.tagged : 0);
  return [s.id, r2(s.x), r2(s.y), r2(s.z), r2(s.vx), r2(s.vy), r2(s.vz), r3(s.yaw), r3(s.pitch), Math.ceil(s.hp), Math.ceil(s.shield), flags, ORDER.indexOf(s.weapon), r2(s.roll)];
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
  };
}
