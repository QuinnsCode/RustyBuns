// The whole game, with no rendering: a toy-soldier third-person shooter on a codebase.
// You run, strafe, jump, crouch, go prone, lean out round corners and dive-roll (direct hits
// pass through you early in the roll) round a repo's compounds and take each one by downing its
// guards. Jump at a wall and you mantle up onto it; fall from high up and a parachute opens. The
// level's mission (missions.ts) says what wins it. Go down and you come back from the
// reflog, three times. Crates in the field and in cleared yards hold ammo and health.
// Guns fire from a magazine and have to be reloaded (R, or by themselves when it runs dry).
// What you carry is your role (roles.ts), picked for your next life. Steep ground is slow
// to climb, and too steep and you slide. Build artifacts (barrels) in the yards blow up
// when shot, setting each other off. Down 15 guards and a rocket roadster drops in; 25, an attack
// helicopter (vehicles.ts).
// The files are the cover, and they don't last: blasts, fire and bullets delete their
// lines, a file sinks as it loses them, and one with none left is gone.
//
// Battles (a mode) put any number of players in the same repo: side by side against
// the guards on the level's mission (coop), every player for themselves (ffa), or two
// sides (teams), with the guards fighting everyone. Players come back from the reflog
// for as long as the battle lasts; the first to the score, or the best when time runs
// out, wins. room.ts runs a battle for a world and sends each player what they need.
//
// Coordinates as in terrain.ts: x east, z south, y up. Facing: yaw 0 looks
// along -z; forward is (-sin yaw, -cos yaw).

import { gateDir, mapRepo, mulberry32, reachable, SMOKE_SEE, type Block, type CodeMap, type RepoSnapshot } from "./codemap.ts";
import { BRANCH_RADIUS, HEAD_RADIUS, OVERRUN, type Mission } from "./missions.ts";
import { CLIFF, slope, wet, type Terrain } from "@rustybuns/terrain";
import { ORDER, rangeDamage, splashDamage, WEAPONS, type Weapon, type WeaponId } from "./weapons.ts";
import { ROLES, type RoleId } from "./roles.ts";
import { BOARD_REACH, HELI_CEILING, HELI_FLOOR, RUN_OVER, STREAKS, THRUST_LIFT, THRUST_REFILL, THRUST_SECONDS, VEHICLES, type Vehicle, type VehicleKind } from "./vehicles.ts";

/** "you" are the players on their own or side by side; "ours" and "theirs" the two sides of a team battle; "conflict" the guards. */
export type Team = "you" | "conflict" | "ours" | "theirs";
/** A battle's mode: side by side on the mission, every player for themselves, or two sides. */
export type Mode = "coop" | "ffa" | "teams";

export interface Brain {
  home: { x: number; z: number };
  alert: boolean;
  /** Seconds until it reacts to what it saw. */
  wait: number;
  /** Seconds since it last saw you (or a stash it took for you). */
  lost: number;
  /** Where it's shooting: you, or the stash it's been fooled by. */
  seen: { x: number; y: number; z: number } | null;
  strafe: number;
  strafeT: number;
  burst: number;
  think: number;
  /**
   * Its job in the squad on you, handed out by how many of them there are (tacticFor): pin you from the
   * front, flank round your side, or rush you. `side` is which way a flanker swings.
   */
  role: Job;
  side: number;
  /** What the squad it's in is doing, and how many are in it, as of its last think. */
  tactic: Tactic;
  pack: number;
  /** The squad is pushing in: a flanker has the angle on you. */
  advance: boolean;
  /** Lying in wait behind a hedgerow (a farm's), unseen and unmoving till you're nearly on it or a gun goes off nearby. */
  ambush: boolean;
  /** Where it's taking cover, and for how long it stays down there. */
  cover: { x: number; z: number } | null;
  coverT: number;
  /** HP last time it thought: a drop sends it into cover. */
  lastHp: number;
  /** Sent at the branch in a defend mission: it goes there, whatever it sees. */
  raid: boolean;
  /** How far along its yard's way to the branch a raider has got (raidRoute), as a point index. */
  leg: number;
  /** Where it last heard a gun go off, and seconds left hunting towards it (0: not hunting). */
  heard: { x: number; z: number } | null;
  hunt: number;
}

export interface Soldier {
  id: number;
  team: Team;
  name: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number;
  pitch: number;
  hp: number;
  maxHp: number;
  /** An energy shield over the HP: it soaks hits first, and refills SHIELD_DELAY seconds after the last one. */
  shield: number;
  maxShield: number;
  /** Seconds since anything hurt it. */
  shieldT: number;
  alive: boolean;
  /** A big compound's heavy: more HP, slower, carries the launcher. */
  heavy: boolean;
  weapon: WeaponId;
  /** Rounds left of each, the magazine included (-1: spare magazines never run out). */
  ammo: Record<WeaponId, number>;
  /** Rounds in each gun's magazine now. */
  loaded: Record<WeaponId, number>;
  /** Seconds left putting a fresh magazine in (0: not reloading). */
  reload: number;
  /** What it carries: its role's weapons, and git reset --hard once found. */
  kit: WeaponId[];
  /** The vehicle it's in, by id, or -1 on foot. */
  vehicle: number;
  cd: number;
  /** Seconds left in a dive-roll, and seconds until the next one. */
  roll: number;
  rollCd: number;
  rollDir: { x: number; z: number };
  grounded: boolean;
  /** Seconds since its feet left the ground (a jump is still allowed for a moment: coyote time), and seconds a jump pressed just before landing stays pending. */
  air: number;
  jumpBuf: number;
  crouch: boolean;
  prone: boolean;
  /** Looking down the rebase scope: the sight sways. */
  scoped: boolean;
  /** Leaning out round a corner: -1 left to 1 right, eased; the upper body, gun and camera go with it. */
  lean: number;
  /** A parachute open over it: it falls slowly and steers. */
  chute: boolean;
  /** Seconds left of a git blame tag: you see it through walls. */
  tagged: number;
  /** Radians of spread a held machine gun has climbed to; it cools off when you stop. */
  heat: number;
  /** Seconds left on fire (a dive-roll or water puts it out), who lit it, and the time to the next lick. */
  burn: number;
  burnBy: number;
  burnT: number;
  /** Where it has been, one sample every TRAIL_EVERY seconds, oldest first: what git revert sends it back to. */
  trail: { x: number; y: number; z: number }[];
  /** For guards: the compound they hold. */
  compound: number;
  brain: Brain | null;
  /** In a battle: players this one has downed, times it went down, seconds until it's back, and whether it has left. */
  score: number;
  deaths: number;
  respawn: number;
  gone: boolean;
  /** Out of view (a battle sends only what's near you): the page doesn't draw it. */
  hidden?: boolean;
}

export interface Shot {
  id: number;
  owner: number;
  team: Team;
  weapon: WeaponId;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number;
  dead: boolean;
  /** Seconds back in time its hits on soldiers are checked: the shooter's view of them (a battle player's lag). */
  rewind?: number;
  /** The soldier a cherry-pick picked. */
  target?: number;
  /** A sticky round that has landed: on soldier `id` at this offset from it (-1: on the ground or a file, where it is). */
  stuck?: { id: number; dx: number; dy: number; dz: number };
}

/** A build artifact in a yard: shoot it and it blows up, and sets off any others near it. */
export interface Barrel { id: number; x: number; y: number; z: number; hp: number; /** Seconds till it goes off once lit (-1: not lit), and who lit it. */ fuse: number; by: number }
export const BARREL_HP = 30, BARREL_RADIUS = 0.45, BARREL_HEIGHT = 1.1, BARRELS = 3;
/** A barrel's blast, and a wrecked vehicle's. */
export const BARREL_BLAST: Weapon = { ...WEAPONS.push, damage: 110, splash: 5.5, knock: 15, wreck: 1.2 };
export const VEHICLE_BLAST: Weapon = { ...WEAPONS.push, damage: 120, splash: 7, knock: 18, wreck: 1.5 };
/** A strike a set piece calls in on you (director.ts): it throws you a long way and leaves you STRIKE_LEAVES HP. */
export const STRIKE_BLAST: Weapon = { ...WEAPONS.push, damage: 140, splash: 7, knock: 26, wreck: 1.5 };
export const STRIKE_LEAVES = 30;

/** Ground steeper than this (rise over run) slides you back down. */
export const SLIDE = 0.75;
/** How much of your speed is left walking up (positive) or down (negative) a slope this steep. */
export function climb(grade: number): number {
  if (grade <= 0) return 1 + Math.min(0.15, -grade * 0.3);
  return 1 / (1 + (grade * 2.2) ** 2);
}

/** A git stash on the ground: cover you hide behind, and a decoy the guards shoot at. */
export interface Stash extends Block {
  id: number;
  hp: number;
  /** Seconds before it pops by itself. */
  ttl: number;
}

export type PickupKind = "ammo" | "health" | "reset";
export interface Pickup { id: number; kind: PickupKind; x: number; y: number; z: number }

export type Objective =
  | { kind: "clear" }
  /** by: the soldier carrying it, or -1. */
  | { kind: "carry"; x: number; y: number; z: number; carried: boolean; delivered: boolean; by: number }
  | { kind: "defend"; x: number; z: number; seconds: number; wave: number; held: number; overrun: number; raids: number };

export interface Input {
  /** -1..1: strafe right (+) and forward (+). */
  right: number;
  forward: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  roll: boolean;
  crouch: boolean;
  prone?: boolean;
  /** Looking down the rebase scope. */
  scope?: boolean;
  /** Lean out round a corner: -1 left, 1 right. */
  lean?: number;
  fire: boolean;
  /** Put a fresh magazine in; get in or out of a vehicle (edge-triggered). */
  reload?: boolean;
  use?: boolean;
  /** Held: a helicopter climbs, or drops; a roadster fires its thrusters. */
  up?: boolean;
  down?: boolean;
  /** What the crosshair is on; shots go from the muzzle to here. Without it, straight along yaw and pitch. */
  aim?: { x: number; y: number; z: number };
  weapon?: WeaponId;
  /** In a battle: the page's count of its inputs, which the world echoes, and the battle time it drew everyone else at. */
  seq?: number;
  view?: number;
}

export type GameEvent =
  | { kind: "fire"; id: number; weapon: WeaponId }
  | { kind: "hit"; target: number; by: number; damage: number; shield: boolean; head: boolean }
  /** A shield popping, starting to refill, or full again. */
  | { kind: "shield"; id: number; state: "broke" | "charging" | "full" }
  | { kind: "boom"; x: number; y: number; z: number; r: number }
  | { kind: "down"; id: number; by: number }
  | { kind: "respawn"; id: number; lives: number }
  /** A parachute opening or being cut. */
  | { kind: "chute"; id: number; open: boolean }
  | { kind: "cleared"; compound: number }
  | { kind: "pickup"; id: number; item: PickupKind }
  | { kind: "blamed"; id: number }
  | { kind: "reverted"; id: number }
  | { kind: "stashed"; x: number; y: number; z: number }
  /** A round that stopped on the ground or a file, not a soldier: dust and chips. */
  | { kind: "impact"; x: number; y: number; z: number; weapon: WeaponId }
  /** A file with no lines left: gone. */
  | { kind: "razed"; path: string; lines: number; by: number; x: number; y: number; z: number; w: number; h: number; d: number }
  | { kind: "objective"; text: string }
  | { kind: "reload"; id: number; weapon: WeaponId }
  /** A kill streak earned a vehicle, which is dropping in. */
  | { kind: "streak"; vehicle: VehicleKind; kills: number }
  | { kind: "board"; vehicle: VehicleKind; on: boolean }
  | { kind: "vehicleHit"; id: number; damage: number }
  | { kind: "wrecked"; id: number; vehicle: VehicleKind }
  | { kind: "won" }
  | { kind: "lost" }
  /** A player joining or leaving a battle. */
  | { kind: "joined"; id: number }
  | { kind: "left"; id: number };

export const RUN = 7.5, CROUCH_SPEED = 3.2, PRONE_SPEED = 1.5, GRAVITY = 26, JUMP = 8.5;
/** A dive-roll: short and slower than a run, with a real wait before the next, so it's a dodge, not a way to travel. Direct hits pass through only its first ROLL_SAFE. */
export const ROLL_TIME = 0.38, ROLL_SPEED = 7, ROLL_COOLDOWN = 1.4, ROLL_SAFE = 0.6, ROLL_RECOVER = 0.3;
/** How far the upper body goes out when you lean, in metres, and how fast the lean eases in and out. */
export const LEAN_REACH = 0.6, LEAN_RATE = 9;
/** A ledge within this much above your feet can be mantled from a jump. */
export const MANTLE = 2.4;
/** The parachute: opens by itself falling this far above the ground, by hand (Space) above this much, then sinks and drifts at these speeds. */
export const CHUTE_AUTO = 7, CHUTE_MIN = 3.5, CHUTE_FALL = 3.5, CHUTE_DRIFT = 6.5;
/** Jumping feels fair: a jump still works this long after walking off a ledge, and one pressed this long before landing fires on touchdown. */
export const COYOTE = 0.12, JUMP_BUFFER = 0.12;
/** Falling is heavier than rising (gravity times this once you're on the way down), so a jump arcs instead of floating. */
export const FALL_BOOST = 1.35;
/** Landing faster than this (metres per second) costs half your run, unless a dive-roll takes it. */
export const HARD_LAND = 11;
export const RADIUS = 0.45, HEIGHT = 1.8, CROUCH_HEIGHT = 1.2, PRONE_HEIGHT = 0.5, STEP = 0.6;
/** A round above this much of the body's height is a headshot. */
export const HEAD_FROM = 0.8;
export const MAX_HP = 100, HEAVY_HP = 260, LIVES = 3;
/** Your shield and a heavy's; guards have none. It waits this long after a hit, then refills this much a second. */
export const MAX_SHIELD = 70, HEAVY_SHIELD = 80, SHIELD_DELAY = 4, SHIELD_RATE = 35;
/** How far a guard sees, and how far it strays from home chasing you. */
export const SIGHT = 55, LEASH = 45;

/** What a squad does, by how many of them are on you: one is careful, two split, three to five work you, six to nine swamp you, ten or more just come. */
export type Tactic = "lone" | "pair" | "squad" | "platoon" | "horde";
export type Job = "pin" | "flank" | "rush";
export const tacticFor = (n: number): Tactic => (n <= 1 ? "lone" : n === 2 ? "pair" : n <= 5 ? "squad" : n <= 9 ? "platoon" : "horde");
/** The range a squad fights you at, [near, far] metres, by tactic; ADVANCE is where a squad closes to once a flanker has the angle. */
export const BANDS: Record<Tactic, [number, number]> = { lone: [14, 26], pair: [12, 24], squad: [10, 22], platoon: [7, 16], horde: [0, 4] };
export const ADVANCE: [number, number] = [6, 13];
/** Guards on a target within this far of each other's count as one squad; a pinner keeps a hidden target's last spot under fire this long; the angle off the pinner's line a flanker needs; a lone guard falls back below this share of its HP. */
export const PACK = 45, SUPPRESS = 3, FLANK_ANGLE = Math.PI / 3, FLANK_OUT = 14, LONE_RETREAT = 0.5;
/** How near you have to come to an ambush for it to rise, and how near a gun has to go off. */
export const AMBUSH_SEE = 11, AMBUSH_HEAR = 30;
/** How many rounds a guard fires before it pauses, by job (a heavy more), and the chance it reloads from cover. */
export const BURSTS: Record<Job, number> = { pin: 6, flank: 5, rush: 9 };
/** How far a gun is heard (times the weapon's loudness), how long guards hunt towards it, and how far from home they'll go to. */
export const HEAR = 85, HUNT_SECONDS = 14, HUNT_LEASH = 130;
/** git revert sends a guard back this many seconds (as far as its trail goes). */
export const TRAIL_EVERY = 0.25, TRAIL_SECONDS = 3;
/** The furthest back a battle player's rounds are checked against where soldiers were, in seconds. */
export const MAX_REWIND = 0.3;
export const STASH_HP = 150, STASH_TTL = 30, STASHES = 2, BLAME_SECONDS = 20;
/** What a crate gives. */
export const HEALTH_CRATE = 40;
export const AMMO_CRATE: Partial<Record<WeaponId, number>> = { add: 8, fetch: 40, clean: 60, push: 2, merge: 2, rebase: 3, cherry: 2, revert: 1, stash: 1, blame: 2, squash: 1 };
/** How much a file takes before it's gone: more lines, more to delete. */
export const fileHp = (lines: number) => 40 + lines * 0.15;
/** A file shorter than this is rubble, and gone. */
export const RUBBLE = 0.15;
/** Damage a second while burning; spread a held machine gun climbs to, and how fast it cools. */
export const BURN_DPS = 10, MAX_HEAT = 0.06, HEAT_COOL = 0.08;
/** Field crates a level scatters, besides the one git reset --hard. */
export const FIELD_PICKUPS = 6;
/** A battle: seconds down before you're back, players downed to win (a side's total in teams), and how long it runs. */
export const RESPAWN = 3, FFA_SCORE = 15, TEAM_SCORE = 30, BATTLE_SECONDS = 600;
export const TICK = 1 / 120;

/** A full magazine for a gun with this much ammo. */
const full = (w: WeaponId, ammo: number) => (ammo < 0 ? WEAPONS[w].mag : Math.min(WEAPONS[w].mag, ammo));
const fwd = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

export const bodyHeight = (s: Soldier) => (s.prone ? PRONE_HEIGHT : s.crouch ? CROUCH_HEIGHT : HEIGHT);

/** How far a leaning soldier's body is off its feet at a height h up it (the hips stay put, the head goes LEAN_REACH). */
export function leanOffset(s: Soldier, h = bodyHeight(s)): { x: number; z: number } {
  if (!s.lean) return { x: 0, z: 0 };
  const f = fwd(s.yaw), k = Math.max(0, Math.min(1, h / bodyHeight(s))) * s.lean * LEAN_REACH;
  return { x: -f.z * k, z: f.x * k };
}

/** Where to go next, for the HUD's marker: a point, what it is, and whether it's a thing to take or a place to get to. */
export interface Waypoint { x: number; y: number; z: number; label: string; kind: "compound" | "commit" | "head" | "branch" }

/** How far the rebase scope wanders off where you point it, in radians of yaw and pitch, at time t. Steadier crouched, steadiest prone. */
export function scopeSway(t: number, stance: "stand" | "crouch" | "prone"): { yaw: number; pitch: number } {
  const a = stance === "prone" ? 0.0025 : stance === "crouch" ? 0.006 : 0.013;
  return { yaw: a * Math.sin(t * 1.3) + a * 0.4 * Math.sin(t * 3.1), pitch: a * 0.7 * Math.sin(t * 1.9 + 1) };
}
export const stanceOf = (s: Soldier): "stand" | "crouch" | "prone" => (s.prone ? "prone" : s.crouch ? "crouch" : "stand");

export class Game {
  readonly map: CodeMap;
  readonly terrain: Terrain;
  readonly mission: Mission;
  readonly soldiers: Soldier[] = [];
  shots: Shot[] = [];
  stashes: Stash[] = [];
  pickups: Pickup[] = [];
  barrels: Barrel[] = [];
  vehicles: Vehicle[] = [];
  /** Guards you've downed this level, which earn the vehicles. */
  kills = 0;
  /** What you carry (null: everything, for the sandbox), and what you'll carry from your next life. */
  role: RoleId | null;
  nextRole: RoleId | null = null;
  objective: Objective;
  events: GameEvent[] = [];
  time = 0;
  lives = LIVES;
  status: "playing" | "won" | "lost" = "playing";
  /** A battle's mode; undefined is single player. */
  readonly mode?: Mode;
  /** Who won a battle: a player's name or a side. */
  winner: string | null = null;
  /** The soldier this page plays: 0 on your own, your player in a battle. */
  me = 0;
  /** In a battle, how far behind the battle each player sees everyone else, in seconds, by soldier id. */
  readonly lags = new Map<number, number>();
  /** Where the theirs side comes in: the reachable flat ground farthest from HEAD. */
  private far: { x: number; z: number; yaw: number } | null = null;
  readonly cleared: boolean[];
  /** A file's full size, kept the first time something hits it: its height and lines shrink from there. */
  private wrecks = new Map<Block, { hp: number; maxHp: number; tall: number; lines: number }>();
  private rand: () => number;
  private nextId = 1;
  private acc = 0;
  private trailT = 0;
  /** In a battle, where each soldier has been over the last MAX_REWIND seconds: [time, x, y, z, height] per tick. */
  private past = new Map<number, number[]>();
  /** A soldier a strike throws but doesn't finish (-1: nobody). */
  private spared = -1;

  constructor(map: CodeMap, seed = 1, mission: Mission = { kind: "clear" }, mode?: Mode, role: RoleId | null = null) {
    // Files get knocked down: the game's own copies, so the map it was given stays whole.
    this.map = { ...map, blocks: map.blocks.map((b) => ({ ...b })) };
    this.terrain = map.terrain;
    // A battle that isn't side by side is won on downs, not the level's mission.
    this.mode = mode;
    this.mission = mode && mode !== "coop" ? { kind: "clear" } : mission;
    this.rand = mulberry32(seed);
    this.cleared = map.compounds.map(() => false);
    this.role = role;
    // On your own you're soldier 0; a battle's players join after the guards.
    if (!mode) {
      this.soldiers.push(this.soldier("you", "you", map.spawn.x, map.spawn.z, map.spawn.yaw, -1));
      if (role) this.arm(this.you(), role);
    }
    this.map.compounds.forEach((c, ci) => {
      for (let g = 0; g < c.guards; g++) {
        const a = (g / c.guards) * Math.PI * 2 + this.rand(), d = 2 + this.rand() * 2;
        // A farm's odd guards lie in ambush behind the hedgerows along the lane in, flat and facing the way you'll come.
        const hide = c.style === "farm" && c.hides?.length && g % 2 === 1 ? c.hides[((g - 1) / 2) % c.hides.length]! : null;
        const s = this.soldier("conflict", `${c.folder} #${g + 1}`, hide ? hide.x : c.x + Math.cos(a) * d, hide ? hide.z : c.z + Math.sin(a) * d, this.rand() * 6.28, ci);
        if (hide) {
          const out = gateDir(c.gate ?? 0);
          Object.assign(s.brain!, { ambush: true, home: { x: hide.x, z: hide.z } });
          s.prone = true, s.yaw = yawTo(out.x, out.z);
        }
        // The jobs in a squad are handed out once a fight starts (regroup). A big compound's first guard is its heavy.
        s.brain!.side = g % 2 === 1 ? 1 : -1;
        if (g === 0 && c.guards >= 3) {
          s.heavy = true, s.hp = s.maxHp = HEAVY_HP, s.shield = s.maxShield = HEAVY_SHIELD, s.ammo.push = 4;
          s.name = `${c.folder} heavy`;
        }
        this.soldiers.push(s);
      }
    });
    this.scatterPickups(seed);
    this.placeBarrels();
    this.objective = this.brief(this.mission);
    if (mode === "teams") this.far = this.farGround(seed);
  }

  static fromRepo(ground: Terrain, repo: RepoSnapshot, seed = 1, mission?: Mission, mode?: Mode, role?: RoleId): Game {
    return new Game(mapRepo(ground, repo, seed), seed, mission, mode, role ?? null);
  }

  /** Hands a soldier a role's kit: its first gun with spare magazines for ever, the rest as they come. A found reset stays. */
  arm(s: Soldier, role: RoleId) {
    const r = ROLES[role];
    for (const w of ORDER) {
      if (w === "reset") continue;
      s.ammo[w] = !r.weapons.includes(w) ? 0 : w === r.weapons[0] ? -1 : WEAPONS[w].ammo;
      s.loaded[w] = full(w, s.ammo[w]);
    }
    s.kit = [...r.weapons, ...(s.ammo.reset > 0 ? (["reset"] as const) : [])];
    s.weapon = r.weapons[0]!, s.reload = 0;
  }

  you(): Soldier { return this.soldiers[this.me]!; }

  /** The players in it (not the guards, not anyone who left). */
  players(): Soldier[] { return this.soldiers.filter((s) => !s.brain && !s.gone); }

  /** Whether a and b fight each other. In a free-for-all every player is on their own. */
  hostile(a: { id: number; team: Team }, b: { id: number; team: Team }): boolean {
    if (a.id === b.id) return false;
    if (this.mode === "ffa" && a.team === "you" && b.team === "you") return true;
    return a.team !== b.team;
  }

  /**
   * A player into the battle, on the side with fewer players in teams; a left player's slot is
   * taken first, so ids stay small. Returns their soldier.
   */
  join(name: string, team?: Team): Soldier {
    if (!this.mode) throw new Error("join is for battles");
    const players = this.players();
    const side: Team = this.mode !== "teams" ? "you"
      : team === "ours" || team === "theirs" ? team
      : players.filter((p) => p.team === "theirs").length < players.filter((p) => p.team === "ours").length ? "theirs" : "ours";
    const at = this.spawnPoint(side);
    const slot = this.soldiers.find((s) => s.gone);
    const s = this.soldier(side, name, at.x, at.z, at.yaw, -1, slot?.id);
    if (slot) this.soldiers[slot.id] = s;
    else this.soldiers.push(s);
    this.events.push({ kind: "joined", id: s.id });
    return s;
  }

  /** A player out of the battle: gone from the field, its slot free for the next to join. */
  leave(id: number) {
    const s = this.soldiers[id];
    if (!s || s.brain || s.gone) return;
    this.dropCommit(s);
    s.gone = true, s.alive = false;
    this.lags.delete(id);
    this.events.push({ kind: "left", id });
  }

  /** On a page's copy of a battle: soldier id as the battle has it, a player on team (guards are already there). */
  ensurePlayer(id: number, team: Team, name: string): Soldier {
    while (this.soldiers.length <= id) {
      const s = this.soldier("you", "", this.map.spawn.x, this.map.spawn.z, 0, -1);
      s.gone = true, s.alive = false;
      this.soldiers.push(s);
    }
    const s = this.soldiers[id]!;
    if (!s.brain) s.team = team, s.name = name, s.gone = false;
    return s;
  }

  /** Where a player comes in: round HEAD (theirs at the far end), a few metres apart. */
  spawnPoint(team: Team): { x: number; z: number; yaw: number } {
    const base = team === "theirs" && this.far ? this.far : this.map.spawn;
    if (!this.mode) return base;
    for (let tries = 0; tries < 8; tries++) {
      const a = this.rand() * Math.PI * 2, d = 2 + this.rand() * 5, x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
      if (Math.hypot(x, z) < this.terrain.R - 2 && !wet(this.terrain, x, z) && !this.blockAt(x, this.terrain.height(x, z) + 0.5, z)) return { x, z, yaw: base.yaw };
    }
    return base;
  }

  /**
   * The theirs side's end: of some flat, dry spots you can walk to from HEAD, one as far from it
   * as from the compounds' guards (coming in under fire is no start). Null: they share HEAD.
   */
  private farGround(seed: number): { x: number; z: number; yaw: number } | null {
    // Walkable from HEAD on the finished ground (its trails cut): nothing steeper than what slides you back.
    const r = mulberry32(seed ^ 0x5eed), { spawn, compounds } = this.map, R = this.terrain.R, canReach = reachable(this.terrain, spawn.x, spawn.z, 2, SLIDE);
    let best: { x: number; z: number; yaw: number } | null = null, bestScore = 0;
    for (let i = 0; i < 600; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * (R - 14), x = Math.cos(a) * d, z = Math.sin(a) * d;
      const far = Math.hypot(x - spawn.x, z - spawn.z);
      if (far < 40 || slope(this.terrain, x, z) > 0.5 || wet(this.terrain, x, z) || !canReach(x, z)) continue;
      const clear = Math.min(SIGHT, ...compounds.map((c) => Math.hypot(c.x - x, c.z - z) - c.r));
      if (clear < 15) continue;
      // Out of the guards' sight counts most; then the farther from HEAD the better.
      const score = clear * 2 + far;
      if (score > bestScore) best = { x, z, yaw: Math.atan2(x - spawn.x, z - spawn.z) }, bestScore = score;
    }
    return best;
  }

  private soldier(team: Team, name: string, x: number, z: number, yaw: number, compound: number, id = this.soldiers.length): Soldier {
    const player = team !== "conflict";
    const ammo = Object.fromEntries(ORDER.map((w) => [w, player ? WEAPONS[w].ammo : w === "commit" ? -1 : 0])) as Record<WeaponId, number>;
    const loaded = Object.fromEntries(ORDER.map((w) => [w, full(w, ammo[w])])) as Record<WeaponId, number>;
    return {
      id, team, name, x, y: this.ground(x, z, Infinity), z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0,
      hp: MAX_HP, maxHp: MAX_HP, shield: player ? MAX_SHIELD : 0, maxShield: player ? MAX_SHIELD : 0, shieldT: SHIELD_DELAY, alive: true, heavy: false, weapon: "commit", ammo, loaded, reload: 0, kit: ORDER.filter((w) => ammo[w] !== 0), vehicle: -1, cd: 0, roll: 0, rollCd: 0, rollDir: { x: 0, z: 0 },
      grounded: true, air: 0, jumpBuf: 0, crouch: false, prone: false, scoped: false, lean: 0, chute: false, tagged: 0, heat: 0, burn: 0, burnBy: -1, burnT: 0, trail: [], compound,
      brain: player ? null : {
        home: { x, z }, alert: false, wait: 0, lost: 0, seen: null, strafe: 1, strafeT: 0, burst: 0, think: 0,
        role: "pin", side: 1, tactic: "lone", pack: 1, advance: false, ambush: false, cover: null, coverT: 0, lastHp: MAX_HP, raid: false, leg: 0, heard: null, hunt: 0,
      },
      score: 0, deaths: 0, respawn: 0, gone: false,
    };
  }

  /** Crates out in the field, beside the field's own crates (the files from elsewhere), on the side facing the start. The farthest holds git reset --hard. */
  private scatterPickups(seed: number) {
    const r = mulberry32(seed ^ 0x9e3779b9), { spawn } = this.map;
    const field = this.map.blocks.filter((b) => b.compound < 0)
      .map((b) => ({ b, d: Math.hypot(b.x - spawn.x, b.z - spawn.z) }))
      .sort((a, b) => a.d - b.d);
    if (!field.length) return;
    const at = (b: Block) => {
      const dx = spawn.x - b.x, dz = spawn.z - b.z, d = Math.hypot(dx, dz) || 1, off = Math.max(b.w, b.d) / 2 + 1.2;
      const x = b.x + (dx / d) * off, z = b.z + (dz / d) * off;
      return { x, y: this.terrain.height(x, z), z };
    };
    const n = Math.min(FIELD_PICKUPS, field.length - 1);
    for (let i = 0; i < n; i++) {
      const pick = field[Math.min(field.length - 2, Math.floor(((i + r()) / n) * (field.length - 1)))]!;
      this.pickups.push({ id: this.nextId++, kind: i % 2 ? "health" : "ammo", ...at(pick.b) });
    }
    this.pickups.push({ id: this.nextId++, kind: "reset", ...at(field[field.length - 1]!.b) });
  }

  private brief(m: Mission): Objective {
    if (m.kind === "carry") {
      // The commit sits in the yard of the compound farthest from HEAD.
      const { spawn } = this.map;
      const far = [...this.map.compounds].sort((a, b) => Math.hypot(b.x - spawn.x, b.z - spawn.z) - Math.hypot(a.x - spawn.x, a.z - spawn.z))[0];
      const x = far?.x ?? spawn.x, z = far?.z ?? spawn.z;
      return { kind: "carry", x, y: this.terrain.height(x, z), z, carried: false, delivered: false, by: -1 };
    }
    if (m.kind === "defend") return { kind: "defend", x: this.map.spawn.x, z: this.map.spawn.z, seconds: m.seconds, wave: m.wave, held: 0, overrun: 0, raids: 0 };
    return { kind: "clear" };
  }

  /* ---------------- the world's solids ---------------- */

  /** The files on the ground, and any stashes thrown down among them. */
  blocks(): Block[] {
    return this.stashes.length ? [...this.map.blocks, ...this.stashes] : this.map.blocks;
  }

  /** The highest thing to stand on under (x, z) that a body whose feet are at y can step up onto. */
  ground(x: number, z: number, y: number): number {
    let g = this.terrain.height(x, z);
    for (const b of this.blocks()) {
      const top = b.y + b.h;
      if (top <= g || top > y + STEP) continue;
      if (Math.abs(x - b.x) < b.w / 2 + RADIUS * 0.5 && Math.abs(z - b.z) < b.d / 2 + RADIUS * 0.5) g = top;
    }
    return g;
  }

  /** The block a point is inside, if any. */
  blockAt(x: number, y: number, z: number): Block | null {
    for (const b of this.blocks()) {
      if (y >= b.y - 0.5 && y <= b.y + b.h && Math.abs(x - b.x) <= b.w / 2 && Math.abs(z - b.z) <= b.d / 2) return b;
    }
    return null;
  }

  /** Nothing solid between two points: no ridge of ground, no block. */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const d = Math.hypot(bx - ax, by - ay, bz - az), n = Math.ceil(d / 0.8);
    for (let i = 1; i < n; i++) {
      const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      if (y < this.terrain.height(x, z) || this.blockAt(x, y, z)) return false;
    }
    return true;
  }

  /* ---------------- the loop ---------------- */

  /**
   * Advances by dt seconds, in fixed ticks. Events since the last call are in this.events.
   * One Input plays you; a battle passes each player's, by soldier id.
   */
  step(dt: number, input: Input | Map<number, Input>): GameEvent[] {
    this.events = [];
    this.acc = Math.min(this.acc + dt, 0.25);
    let inputs = input instanceof Map ? input : new Map([[this.me, input]]);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick(TICK, inputs);
      // Edge-triggered inputs act once.
      inputs = new Map([...inputs].map(([id, i]) => [id, { ...i, jump: false, roll: false, weapon: undefined, use: false, reload: false }]));
    }
    return this.events;
  }

  /**
   * Your own soldier a frame ahead of the battle's word on it: moves only, no shots, nobody
   * else. The page plays this between snapshots so your soldier answers the keys at once.
   */
  predict(id: number, input: Input, dt: number) {
    const s = this.soldiers[id];
    if (!s?.alive || this.status !== "playing") return;
    // Fire's damage is the battle's to deal, and so are the events.
    const burn = s.burn;
    s.burn = 0;
    this.control(s, { ...input, fire: false }, dt);
    this.move(s, dt);
    s.burn = burn, this.events = [];
  }

  private tick(dt: number, inputs: Map<number, Input>) {
    this.time += dt;
    if (this.status !== "playing") return;
    for (const [id, input] of inputs) {
      const s = this.soldiers[id];
      if (s?.alive && !s.brain) this.control(s, input, dt);
    }
    if (this.mode) this.comeBack(dt);
    for (const s of this.soldiers) if (s.alive && s.brain) this.think(s, dt);
    for (const s of this.soldiers) if (s.alive) this.move(s, dt);
    for (const v of this.vehicles) if (v.driver < 0) this.settle(v, dt);
    this.separate();
    this.fly(dt);
    this.fuses(dt);
    this.record(dt);
    if (this.mode) this.remember();
    for (const st of this.stashes) st.ttl -= dt;
    this.stashes = this.stashes.filter((st) => st.hp > 0 && st.ttl > 0);
    this.collect();
    this.pursue(dt);
    if (this.mode && this.mode !== "coop" && this.time >= BATTLE_SECONDS) this.decide();
  }

  /** Battle players back from the reflog once they've been down long enough. */
  private comeBack(dt: number) {
    for (const s of this.soldiers) {
      if (s.alive || s.brain || s.gone) continue;
      s.respawn -= dt;
      if (s.respawn > 0) continue;
      const { x, z, yaw } = this.spawnPoint(s.team);
      Object.assign(s, { x, z, y: this.ground(x, z, Infinity), vx: 0, vy: 0, vz: 0, yaw, hp: s.maxHp, shield: s.maxShield, shieldT: SHIELD_DELAY, alive: true, roll: 0, cd: 0.5, burn: 0, trail: [], reload: 0, lean: 0, chute: false });
      this.events.push({ kind: "respawn", id: s.id, lives: -1 });
    }
  }

  private record(dt: number) {
    this.trailT += dt;
    if (this.trailT < TRAIL_EVERY) return;
    this.trailT -= TRAIL_EVERY;
    const keep = Math.round(TRAIL_SECONDS / TRAIL_EVERY) + 1;
    // A battle's players too: a revert sends them back as well.
    for (const s of this.soldiers) if (s.alive && (s.team !== "you" || this.mode)) {
      s.trail.push({ x: s.x, y: s.y, z: s.z });
      if (s.trail.length > keep) s.trail.shift();
    }
  }

  private remember() {
    for (const s of this.soldiers) {
      if (!s.alive) {
        this.past.delete(s.id);
        continue;
      }
      let p = this.past.get(s.id);
      if (!p) this.past.set(s.id, (p = []));
      p.push(this.time, s.x, s.y, s.z, bodyHeight(s));
      // Keep one sample from before the window, to ease from.
      while (p.length >= 10 && p[5]! <= this.time - MAX_REWIND) p.splice(0, 5);
    }
  }

  /** Where s was at time t, eased between ticks: now's, past what it remembers. */
  private where(s: Soldier, t: number): { x: number; y: number; z: number; h: number } {
    const p = this.past.get(s.id);
    if (!p?.length || t >= p[p.length - 5]!) return { x: s.x, y: s.y, z: s.z, h: bodyHeight(s) };
    let i = 0;
    while (p[i + 5]! <= t) i += 5;
    const k = Math.max(0, Math.min(1, (t - p[i]!) / (p[i + 5]! - p[i]!)));
    const at = (j: number) => p[i + j]! + (p[i + 5 + j]! - p[i + j]!) * k;
    return { x: at(1), y: at(2), z: at(3), h: k < 0.5 ? p[i + 4]! : p[i + 9]! };
  }

  private control(s: Soldier, input: Input, dt: number) {
    if (input.use) this.toggleVehicle(s);
    if (s.vehicle >= 0) {
      const v = this.vehicles.find((v) => v.id === s.vehicle);
      if (v) return this.drive(s, v, input, dt);
      s.vehicle = -1;
    }
    s.yaw = input.yaw;
    s.pitch = input.pitch;
    s.prone = !!input.prone && s.grounded;
    s.crouch = !s.prone && input.crouch && s.grounded;
    s.scoped = !!input.scope && s.weapon === "rebase";
    // Leaning: out round a corner on your feet, never prone, mid-roll or in the air.
    const wantLean = s.grounded && !s.prone && s.roll <= 0 ? Math.max(-1, Math.min(1, input.lean ?? 0)) : 0;
    s.lean += (wantLean - s.lean) * Math.min(1, LEAN_RATE * dt);
    if (Math.abs(s.lean) < 0.01) s.lean = 0;
    if (input.weapon && input.weapon !== s.weapon && s.ammo[input.weapon] !== 0) s.weapon = input.weapon, s.reload = 0;
    if (input.reload) this.startReload(s);
    const f = fwd(s.yaw), r = { x: -f.z, z: f.x };
    let mx = f.x * input.forward + r.x * input.right, mz = f.z * input.forward + r.z * input.right;
    const m = Math.hypot(mx, mz);
    if (m > 1) mx /= m, mz /= m;
    if (input.roll && s.grounded && s.roll <= 0 && s.rollCd <= 0) {
      // Prone: a log roll to the side (right unless you're pushing left). Otherwise dive the way
      // you're moving, so strafing out from behind cover goes sideways, or forward standing still.
      const side = input.right < 0 ? -1 : 1;
      const dir = s.prone ? { x: r.x * side, z: r.z * side } : m > 0.1 ? { x: mx / Math.max(m, 1e-6), z: mz / Math.max(m, 1e-6) } : f;
      s.roll = ROLL_TIME, s.rollCd = ROLL_TIME + ROLL_COOLDOWN, s.rollDir = dir;
    }
    const carrying = this.objective.kind === "carry" && this.objective.carried && this.objective.by === s.id;
    this.walk(s, mx, mz, dt, (input.forward < 0 ? 0.75 : 1) * (carrying ? 0.85 : 1));
    if (input.jump && (s.grounded || (s.air < COYOTE && s.vy <= 0.5 && !s.chute)) && s.roll <= 0 && !s.prone) s.vy = JUMP, s.grounded = false, s.air = COYOTE;
    else if (input.jump && !s.grounded) {
      // Close to the ground the press waits for touchdown; higher up it works the parachute.
      if (s.y - this.ground(s.x, s.z, Infinity) < CHUTE_MIN) s.jumpBuf = JUMP_BUFFER;
      else this.chute(s, !s.chute, CHUTE_MIN);
    }
    if (input.fire) this.fire(s, input.aim);
  }

  /** Opens the parachute (if there's room under you) or cuts it. */
  private chute(s: Soldier, open: boolean, above: number) {
    if (open === s.chute || s.vehicle >= 0) return;
    if (open && s.y - this.ground(s.x, s.z, Infinity) < above) return;
    s.chute = open;
    this.events.push({ kind: "chute", id: s.id, open });
  }

  /** Steers velocity towards the wished direction; a roll overrides it. */
  private walk(s: Soldier, mx: number, mz: number, dt: number, k = 1) {
    if (s.roll > 0) {
      const v = s.prone ? ROLL_SPEED * 0.45 : ROLL_SPEED;
      s.vx = s.rollDir.x * v, s.vz = s.rollDir.z * v;
      return;
    }
    // Uphill is slow going, the steeper the slower; downhill a little quicker.
    const m = Math.hypot(mx, mz);
    if (s.grounded && m > 0.05) {
      const ux = mx / m, uz = mz / m, here = this.terrain.height(s.x, s.z);
      k *= climb((this.terrain.height(s.x + ux * 0.8, s.z + uz * 0.8) - here) / 0.8);
    }
    // Getting up out of a roll is slow for a moment, so rolling is never a quicker way across open ground.
    if (s.rollCd > ROLL_COOLDOWN - ROLL_RECOVER) k *= 0.5;
    const top = s.chute ? CHUTE_DRIFT : (s.prone ? PRONE_SPEED : s.crouch ? CROUCH_SPEED : RUN) * k * (s.heavy ? 0.7 : 1), accel = s.grounded ? 60 : s.chute ? 14 : 16;
    let tx = mx * top, tz = mz * top;
    // Too steep to stand on (and not on a file): it slides you back down, the steeper the faster.
    if (s.grounded && this.ground(s.x, s.z, s.y) <= this.terrain.height(s.x, s.z) + 0.05) {
      const e = 0.5, gx = (this.terrain.height(s.x + e, s.z) - this.terrain.height(s.x - e, s.z)) / (2 * e);
      const gz = (this.terrain.height(s.x, s.z + e) - this.terrain.height(s.x, s.z - e)) / (2 * e), g = Math.hypot(gx, gz);
      if (g > SLIDE) tx -= (gx / g) * (g - SLIDE) * 14, tz -= (gz / g) * (g - SLIDE) * 14;
    }
    const dx = tx - s.vx, dz = tz - s.vz, d = Math.hypot(dx, dz), a = Math.min(d, accel * dt);
    if (d > 0) s.vx += (dx / d) * a, s.vz += (dz / d) * a;
  }

  private move(s: Soldier, dt: number) {
    s.cd = Math.max(0, s.cd - dt);
    s.roll = Math.max(0, s.roll - dt);
    s.rollCd = Math.max(0, s.rollCd - dt);
    s.jumpBuf = Math.max(0, s.jumpBuf - dt);
    s.tagged = Math.max(0, s.tagged - dt);
    s.heat = Math.max(0, s.heat - HEAT_COOL * dt);
    if (s.reload > 0 && (s.reload -= dt) <= 0) s.reload = 0, s.loaded[s.weapon] = full(s.weapon, s.ammo[s.weapon]);
    if (s.alive && s.shield < s.maxShield) {
      if (s.shieldT < SHIELD_DELAY && s.shieldT + dt >= SHIELD_DELAY) this.events.push({ kind: "shield", id: s.id, state: "charging" });
      if (s.shieldT + dt >= SHIELD_DELAY) {
        s.shield = Math.min(s.maxShield, s.shield + SHIELD_RATE * dt);
        if (s.shield >= s.maxShield) this.events.push({ kind: "shield", id: s.id, state: "full" });
      }
    }
    s.shieldT += dt;
    if (s.burn > 0) {
      // Stop, drop and roll: a dive-roll puts it out, and so does wading in.
      if (s.roll > 0 || wet(this.terrain, s.x, s.z)) s.burn = 0;
      else {
        s.burn -= dt, s.burnT += dt;
        if (s.burnT >= 0.25) s.burnT -= 0.25, this.hurt(s, BURN_DPS * 0.25, s.burnBy);
      }
    }
    if (!s.alive || s.vehicle >= 0) return;
    const R = this.terrain.R;
    const tryTo = (nx: number, nz: number) => {
      // Cliffs: no walking up ground that rises faster than CLIFF, unless you're already above it.
      const here = this.terrain.height(s.x, s.z), there = this.terrain.height(nx, nz), run = Math.hypot(nx - s.x, nz - s.z);
      if (there > s.y + STEP * 0.5 && run > 0 && (there - here) / run > CLIFF) return false;
      if (Math.hypot(nx, nz) > R - 1) return false;
      s.x = nx, s.z = nz;
      return true;
    };
    const nx = s.x + s.vx * dt, nz = s.z + s.vz * dt;
    if (!tryTo(nx, nz)) {
      if (tryTo(nx, s.z)) s.vz *= 0.5;
      else if (tryTo(s.x, nz)) s.vx *= 0.5;
      else s.vx = 0, s.vz = 0;
    }
    this.pushOutOfBlocks(s);
    if (!s.grounded && !s.prone && !s.brain) this.mantle(s);

    // Under a parachute you sink at a walking pace; otherwise you fall, and a long fall opens one by itself.
    if (s.chute) s.vy += (-CHUTE_FALL - s.vy) * Math.min(1, 4 * dt);
    else {
      s.vy -= GRAVITY * (s.vy < 0 ? FALL_BOOST : 1) * dt;
      if (!s.grounded && !s.brain && s.vy < -9) this.chute(s, true, CHUTE_AUTO);
    }
    s.y += s.vy * dt;
    const g = this.ground(s.x, s.z, s.y);
    // A shove (a push round) carries you through the air; on the ground, walk() steers it away.
    // Grounded and going downhill: stick to the slope rather than hop down it.
    if (s.y <= g || (s.grounded && s.vy <= 0 && s.y - g < 0.4)) {
      // A hard landing takes the legs out from under a run; a dive-roll soaks it up, a chute never lands hard.
      if (!s.grounded && s.vy < -HARD_LAND && s.roll <= 0) s.vx *= 0.5, s.vz *= 0.5;
      s.y = g, s.vy = Math.max(0, s.vy), s.grounded = true, s.air = 0;
      if (s.chute) this.chute(s, false, 0);
      // A jump pressed just before touchdown goes straight off the ground.
      if (s.jumpBuf > 0 && s.roll <= 0 && !s.prone && !s.brain) s.vy = JUMP, s.grounded = false, s.air = COYOTE, s.jumpBuf = 0;
    } else if (s.y > g + 0.05) s.grounded = false, s.air += dt;
  }

  /** A ledge just above you that you're pushing into: up and onto it. */
  private mantle(s: Soldier) {
    if (s.vy > 3) return;
    const f = fwd(s.yaw);
    for (const b of this.blocks()) {
      const top = b.y + b.h;
      if (top <= s.y + STEP || top > s.y + MANTLE) continue;
      const px = Math.max(b.x - b.w / 2, Math.min(s.x, b.x + b.w / 2)), pz = Math.max(b.z - b.d / 2, Math.min(s.z, b.z + b.d / 2));
      if (Math.hypot(s.x - px, s.z - pz) > RADIUS + 0.3) continue;
      // Only a ledge you face and are moving into, so passing a wall sideways doesn't pull you onto it.
      const tx = b.x - s.x, tz = b.z - s.z;
      if (f.x * tx + f.z * tz <= 0 || s.vx * tx + s.vz * tz < -0.5) continue;
      // Nothing solid stacked on it where you'd stand.
      if (this.blockAt(px + (b.x - px) * 0.05, top + 0.3, pz + (b.z - pz) * 0.05)) continue;
      s.y = top, s.vy = 0, s.grounded = true;
      const d = Math.hypot(tx, tz) || 1;
      s.x += (tx / d) * (RADIUS + 0.05), s.z += (tz / d) * (RADIUS + 0.05);
      if (s.chute) this.chute(s, false, 0);
      return;
    }
  }

  private pushOutOfBlocks(s: Soldier) {
    const h = bodyHeight(s);
    for (const b of this.blocks()) {
      if (s.y >= b.y + b.h - STEP || s.y + h <= b.y) continue;
      const px = Math.max(b.x - b.w / 2, Math.min(s.x, b.x + b.w / 2)), pz = Math.max(b.z - b.d / 2, Math.min(s.z, b.z + b.d / 2));
      const dx = s.x - px, dz = s.z - pz, d = Math.hypot(dx, dz);
      if (d >= RADIUS) continue;
      if (d > 1e-6) {
        s.x = px + (dx / d) * RADIUS, s.z = pz + (dz / d) * RADIUS;
        // Slide along the wall rather than keep pushing into it.
        const into = s.vx * (dx / d) + s.vz * (dz / d);
        if (into < 0) s.vx -= into * (dx / d), s.vz -= into * (dz / d);
      } else {
        // Centre inside the box: out the nearest face.
        const ox = b.w / 2 + RADIUS - Math.abs(s.x - b.x), oz = b.d / 2 + RADIUS - Math.abs(s.z - b.z);
        if (ox < oz) s.x += Math.sign(s.x - b.x || 1) * ox;
        else s.z += Math.sign(s.z - b.z || 1) * oz;
      }
    }
  }

  private separate() {
    const live = this.soldiers.filter((s) => s.alive);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const a = live[i]!, b = live[j]!, dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
      if (d >= RADIUS * 2 || d < 1e-6 || Math.abs(a.y - b.y) > HEIGHT) continue;
      const push = (RADIUS * 2 - d) / 2;
      a.x -= (dx / d) * push, a.z -= (dz / d) * push, b.x += (dx / d) * push, b.z += (dz / d) * push;
    }
  }

  /* ---------------- pickups and the mission ---------------- */

  private collect() {
    for (const s of this.soldiers) if (s.alive && !s.brain) this.collectFor(s);
  }

  private collectFor(you: Soldier) {
    const near = (x: number, y: number, z: number) => Math.hypot(x - you.x, z - you.z) < 1.5 && Math.abs(y - you.y) < 2.2;
    this.pickups = this.pickups.filter((p) => {
      if (!near(p.x, p.y, p.z)) return true;
      if (p.kind === "health") {
        // A full-health soldier leaves it for later.
        if (you.hp >= you.maxHp) return true;
        you.hp = Math.min(you.maxHp, you.hp + HEALTH_CRATE);
      } else if (p.kind === "ammo") {
        for (const [w, n] of Object.entries(AMMO_CRATE) as [WeaponId, number][]) if (you.kit.includes(w) && you.ammo[w] >= 0) you.ammo[w] += n;
      } else {
        you.ammo.reset++, you.loaded.reset = full("reset", you.ammo.reset);
        if (!you.kit.includes("reset")) you.kit.push("reset");
      }
      this.events.push({ kind: "pickup", id: you.id, item: p.kind });
      return false;
    });
    const o = this.objective;
    if (o.kind === "carry" && !o.carried && near(o.x, o.y, o.z)) {
      o.carried = true, o.by = you.id;
      this.events.push({ kind: "objective", text: "got the commit: carry it to HEAD" });
    }
  }

  /** The mission's own clock and win: a carried commit reaching HEAD, a branch held or overrun. */
  private pursue(dt: number) {
    if (this.status !== "playing") return;
    const o = this.objective;
    if (o.kind === "carry") {
      const you = this.soldiers[o.by];
      if (!o.carried || !you) return;
      o.x = you.x, o.y = you.y + HEIGHT + 0.4, o.z = you.z;
      const { spawn } = this.map;
      if (Math.hypot(you.x - spawn.x, you.z - spawn.z) < HEAD_RADIUS) {
        o.delivered = true;
        this.events.push({ kind: "objective", text: "commit landed on HEAD" });
        this.win();
      }
    } else if (o.kind === "defend") {
      o.held += dt;
      // A raid every wave seconds, nearest compound first, the first a few seconds in.
      const due = Math.floor((o.held + o.wave - 5) / o.wave);
      if (due > o.raids) this.raid(o);
      for (const g of this.soldiers) if (g.alive && g.team === "conflict" && Math.hypot(g.x - o.x, g.z - o.z) < BRANCH_RADIUS) o.overrun += dt;
      if (o.overrun >= OVERRUN) return this.lose();
      if (o.held >= o.seconds) {
        this.events.push({ kind: "objective", text: "main held" });
        this.win();
      }
    }
  }

  private raid(o: Extract<Objective, { kind: "defend" }>) {
    o.raids++;
    // The nearest yard that still has guards at home: once a yard has sent everyone, the next one goes.
    const home = (i: number) => this.soldiers.some((g) => g.alive && g.brain && g.compound === i && !g.brain.raid);
    const order = this.map.compounds.map((c, i) => ({ i, d: Math.hypot(c.x - o.x, c.z - o.z) })).filter(({ i }) => !this.cleared[i] && home(i)).sort((a, b) => a.d - b.d);
    const next = order[0];
    if (!next) return;
    for (const g of this.soldiers) if (g.alive && g.brain && g.compound === next.i && !g.brain.raid) {
      Object.assign(g.brain, { raid: true, leg: 0, alert: true, wait: 0.5, home: { x: o.x, z: o.z }, cover: null, coverT: 0 });
    }
    this.events.push({ kind: "objective", text: `${this.map.compounds[next.i]!.folder} is raiding main` });
  }

  private win(winner: string | null = null) {
    if (this.status !== "playing") return;
    this.status = "won";
    this.winner = winner;
    this.events.push({ kind: "won" });
  }

  /** A side's downs in a team battle. */
  teamScore(team: Team): number {
    return this.soldiers.reduce((n, s) => n + (s.team === team && !s.brain ? s.score : 0), 0);
  }

  /** A battle won on downs: the first to the score, or when time's up whoever has most (a draw goes to nobody). */
  private decide() {
    if (this.mode === "teams") {
      const ours = this.teamScore("ours"), theirs = this.teamScore("theirs");
      if (ours >= TEAM_SCORE || theirs >= TEAM_SCORE || this.time >= BATTLE_SECONDS) this.win(ours > theirs ? "ours" : theirs > ours ? "theirs" : null);
    } else if (this.mode === "ffa") {
      const top = [...this.players()].sort((a, b) => b.score - a.score);
      if ((top[0]?.score ?? 0) >= FFA_SCORE || this.time >= BATTLE_SECONDS) this.win(top[0] && top[0].score > (top[1]?.score ?? -1) ? top[0].name : null);
    }
  }

  private lose() {
    if (this.status !== "playing") return;
    this.status = "lost";
    this.events.push({ kind: "lost" });
  }

  /* ---------------- shooting ---------------- */

  muzzle(s: Soldier) {
    const f = fwd(s.yaw), eye = s.prone ? 0.35 : s.crouch ? 1.0 : 1.4, lean = leanOffset(s, eye);
    // Held at the right hip, a little ahead: the over-the-shoulder camera sees it go. A lean carries it out round the corner.
    return { x: s.x + f.x * 0.5 - f.z * 0.3 + lean.x, y: s.y + eye, z: s.z + f.z * 0.5 + f.x * 0.3 + lean.z };
  }

  /** Starts putting a fresh magazine in, if there's one to put in and this one isn't full. */
  startReload(s: Soldier) {
    if (s.reload > 0 || s.loaded[s.weapon] >= full(s.weapon, s.ammo[s.weapon])) return;
    s.reload = WEAPONS[s.weapon].reload;
    this.events.push({ kind: "reload", id: s.id, weapon: s.weapon });
  }

  fire(s: Soldier, aim?: { x: number; y: number; z: number }, extraSpread = 0) {
    if (s.cd > 0 || s.roll > 0 || s.reload > 0) return;
    if (s.ammo[s.weapon] === 0) {
      s.weapon = s.kit.find((w) => s.ammo[w] !== 0) ?? "commit";
      return;
    }
    if (s.loaded[s.weapon] <= 0) return this.startReload(s);
    const w = WEAPONS[s.weapon];
    this.shoot(s, s.weapon, this.muzzle(s), aim, extraSpread);
    s.heat = Math.min(MAX_HEAT, s.heat + w.bloom);
    s.cd = w.cooldown;
    s.loaded[s.weapon]--;
    if (s.ammo[s.weapon]! > 0) s.ammo[s.weapon]!--;
    this.events.push({ kind: "fire", id: s.id, weapon: s.weapon });
    if (!s.brain) this.heard(s, w);
    // The magazine's dry: straight into the reload.
    if (s.loaded[s.weapon] <= 0 && s.ammo[s.weapon] !== 0) this.startReload(s);
  }

  /** Sends a weapon's rounds from m towards aim (or along s's facing). */
  private shoot(s: Soldier, weapon: WeaponId, m: { x: number; y: number; z: number }, aim?: { x: number; y: number; z: number }, extraSpread = 0) {
    const w = WEAPONS[weapon];
    let dx: number, dy: number, dz: number;
    if (aim) dx = aim.x - m.x, dy = aim.y - m.y, dz = aim.z - m.z;
    else {
      // No crosshair point: along the facing, with the scope's sway on it.
      const sw = s.scoped ? scopeSway(this.time, stanceOf(s)) : { yaw: 0, pitch: 0 };
      const f = fwd(s.yaw + sw.yaw), p = s.pitch + sw.pitch;
      dx = f.x * Math.cos(p), dy = Math.sin(p), dz = f.z * Math.cos(p);
    }
    const d = Math.hypot(dx, dy, dz) || 1;
    // Lying down steadies a rifle; crouching, a little. A held machine gun climbs off target, and a sniper rifle fired from the hip is a guess.
    const spread = (w.spread + extraSpread + s.heat + (w.hipSpread && !s.scoped ? w.hipSpread : 0)) * (s.prone ? 0.3 : s.crouch ? 0.6 : 1);
    for (let i = 0; i < w.pellets; i++) {
      let ux = dx / d + (this.rand() - 0.5) * 2 * spread, uy = dy / d + (this.rand() - 0.5) * 2 * spread, uz = dz / d + (this.rand() - 0.5) * 2 * spread;
      // A lob goes up a little more than you aim, so a grenade clears the crate in front of you.
      if (w.gravity > 5) uy += 0.25;
      const n = Math.hypot(ux, uy, uz);
      ux /= n, uy /= n, uz /= n;
      const shot: Shot = { id: this.nextId++, owner: s.id, team: s.team, weapon, x: m.x, y: m.y, z: m.z, vx: ux * w.speed, vy: uy * w.speed, vz: uz * w.speed, age: 0, dead: false };
      if (w.homing > 0) shot.target = this.pickTarget(s, m, ux, uy, uz);
      const lag = s.brain ? 0 : Math.min(MAX_REWIND, this.lags.get(s.id) ?? 0);
      if (lag > 0) shot.rewind = lag;
      this.shots.push(shot);
    }
  }

  /** The enemy closest to the line of fire, within 20 degrees of it and 90 m: what a cherry-pick follows. */
  private pickTarget(s: Soldier, m: { x: number; y: number; z: number }, ux: number, uy: number, uz: number): number | undefined {
    let best: Soldier | undefined, bestA = 0.35;
    for (const t of this.soldiers) {
      if (!t.alive || !this.hostile(s, t)) continue;
      const dx = t.x - m.x, dy = t.y + 1 - m.y, dz = t.z - m.z, d = Math.hypot(dx, dy, dz);
      if (d > 90 || d < 1e-6) continue;
      const a = Math.acos(Math.max(-1, Math.min(1, (dx * ux + dy * uy + dz * uz) / d)));
      if (a < bestA) bestA = a, best = t;
    }
    return best?.id;
  }

  private fly(dt: number) {
    for (const p of this.shots) {
      const w = WEAPONS[p.weapon];
      p.age += dt;
      if (p.stuck) {
        // Stuck on a soldier it rides along; the fuse runs the same wherever it is. If its host goes down, it drops.
        const host = p.stuck.id >= 0 ? this.soldiers[p.stuck.id] : undefined;
        if (host?.alive) p.x = host.x + p.stuck.dx, p.y = host.y + p.stuck.dy, p.z = host.z + p.stuck.dz;
        else if (p.stuck.id >= 0) p.stuck = undefined;
        if (p.stuck) {
          p.vx = p.vy = p.vz = 0;
          if (p.age >= w.life) this.land(p, null);
          continue;
        }
      }
      p.vy -= w.gravity * dt;
      const t = p.target !== undefined ? this.soldiers[p.target] : undefined;
      if (w.homing > 0 && t?.alive) {
        // Turn towards it, keeping speed.
        const dx = t.x - p.x, dy = t.y + bodyHeight(t) / 2 - p.y, dz = t.z - p.z, d = Math.hypot(dx, dy, dz) || 1, k = Math.min(1, w.homing * dt);
        p.vx += ((dx / d) * w.speed - p.vx) * k, p.vy += ((dy / d) * w.speed - p.vy) * k, p.vz += ((dz / d) * w.speed - p.vz) * k;
        const v = Math.hypot(p.vx, p.vy, p.vz) || 1;
        p.vx *= w.speed / v, p.vy *= w.speed / v, p.vz *= w.speed / v;
      }
      const len = Math.hypot(p.vx, p.vy, p.vz) * dt, n = Math.max(1, Math.ceil(len / 0.5));
      for (let i = 0; i < n && !p.dead; i++) {
        const ox = p.x, oy = p.y, oz = p.z;
        p.x += (p.vx * dt) / n, p.y += (p.vy * dt) / n, p.z += (p.vz * dt) / n;
        const hit = this.soldierAt(p);
        if (hit) {
          if (w.sticky) p.stuck = { id: hit.s.id, dx: p.x - hit.s.x, dy: p.y - hit.s.y, dz: p.z - hit.s.z }, (p.vx = p.vy = p.vz = 0);
          else this.land(p, hit.s, hit.head);
          break;
        }
        const car = p.team !== "you" ? this.vehicleAt(p) : null, barrel = car ? null : this.barrelAt(p);
        if (car || barrel) {
          if (car) this.hurtVehicle(car, w.splash > 0 ? 0 : w.damage, p.owner);
          else this.hurtBarrel(barrel!, w.damage, p.owner);
          if (w.splash > 0 || w.effect === "stash") this.land(p, null);
          else this.events.push({ kind: "impact", x: p.x, y: p.y, z: p.z, weapon: p.weapon }), (p.dead = true);
          break;
        }
        const g = this.terrain.height(p.x, p.z), b = this.blockAt(p.x, p.y, p.z);
        if (p.y <= g || b) {
          if (b && w.impact) this.wreck(b, w.damage * w.wreck, p.owner);
          if (w.impact) {
            // A stash lands on top of what it hit, not inside it.
            if (w.effect === "stash") p.x = ox, p.y = oy, p.z = oz;
            if (w.splash <= 0 && !w.effect && w.burn <= 0) this.events.push({ kind: "impact", x: p.x, y: p.y, z: p.z, weapon: p.weapon });
            this.land(p, null);
          } else if (w.sticky) {
            // Plasma stays where it touched.
            p.x = ox, p.y = oy, p.z = oz, p.vx = p.vy = p.vz = 0, p.stuck = { id: -1, dx: 0, dy: 0, dz: 0 };
            break;
          } else {
            // Bounce: back out, lose most of the speed, flip the way it came in.
            p.x = ox, p.y = oy, p.z = oz;
            if (b) p.vx *= -0.4, p.vz *= -0.4, p.vy *= 0.5;
            else p.vy = Math.abs(p.vy) * 0.35, p.vx *= 0.55, p.vz *= 0.55;
            break;
          }
        }
      }
      if (!p.dead && (p.age >= w.life || Math.hypot(p.x, p.z) > this.terrain.R + 20)) {
        if (w.splash > 0 || w.effect === "stash") this.land(p, null);
        else p.dead = true;
      }
    }
    this.shots = this.shots.filter((p) => !p.dead);
  }

  /**
   * A body the shot is inside, other than its own side's (and never the shooter's, by a direct hit).
   * A battle player's round is checked against where everyone was when the shooter saw them.
   */
  private soldierAt(p: Shot): { s: Soldier; head: boolean } | null {
    for (const s of this.soldiers) {
      if (!s.alive || s.vehicle >= 0 || !this.hostile(s, { id: p.owner, team: p.team })) continue;
      // Early in a roll, direct hits pass through.
      if (s.roll > ROLL_TIME * (1 - ROLL_SAFE)) continue;
      const b = p.rewind ? this.where(s, this.time - p.rewind) : { x: s.x, y: s.y, z: s.z, h: bodyHeight(s) };
      if (p.y < b.y || p.y > b.y + b.h) continue;
      // A lean carries the upper body out sideways: the hitbox goes with it.
      const off = leanOffset(s, p.y - b.y);
      if (Math.hypot(p.x - b.x - off.x, p.z - b.z - off.z) < RADIUS + 0.1) return { s, head: p.y > b.y + b.h * HEAD_FROM };
    }
    return null;
  }

  private land(p: Shot, direct: Soldier | null, head = false) {
    p.dead = true;
    const w = WEAPONS[p.weapon];
    if (w.effect === "stash") return this.stash(p.x, p.z, p.y);
    if (w.splash > 0) {
      this.blast(p.x, p.y, p.z, w, p.owner, p.team);
      if (w.effect === "reset") {
        // git reset --hard: the yard it lands in is wiped, every guard of it down wherever they stand.
        const ci = this.map.compounds.findIndex((c) => Math.hypot(c.x - p.x, c.z - p.z) < c.r + 2);
        if (ci >= 0) for (const g of this.soldiers) if (g.alive && g.brain && g.compound === ci) this.hurt(g, g.hp + g.shield, p.owner);
      }
    } else if (direct) {
      const v = Math.hypot(p.vx, p.vz) || 1;
      direct.vx += (p.vx / v) * w.knock, direct.vz += (p.vz / v) * w.knock;
      if (w.effect === "blame") direct.tagged = BLAME_SECONDS, this.events.push({ kind: "blamed", id: direct.id });
      if (w.effect === "revert") this.revert(direct);
      if (w.burn > 0) direct.burn = Math.max(direct.burn, w.burn), direct.burnBy = p.owner;
      // A shotgun's pellets lose their punch with distance; a precision round to the head does more.
      let dmg = rangeDamage(w, p.age * w.speed);
      if (head) dmg *= w.headshot;
      if (dmg > 0) this.hurt(direct, dmg, p.owner, head);
    }
  }

  /**
   * An explosion: files, stashes, barrels, soldiers and vehicles in reach take damage by how near
   * they are, and soldiers are thrown. No friendly fire for a team's own blast, except your own
   * hurts you (half), the toy-soldier rule; a reset only wipes the yard. A barrel's (team null) hurts everyone.
   */
  private blast(x: number, y: number, z: number, w: Weapon, owner: number, team: Team | null) {
    this.events.push({ kind: "boom", x, y, z, r: w.splash });
    // Every file and stash in the blast loses lines by how near its nearest face is.
    for (const b of [...this.blocks()]) {
      const cx = Math.max(b.x - b.w / 2, Math.min(x, b.x + b.w / 2)), cy = Math.max(b.y, Math.min(y, b.y + b.h)), cz = Math.max(b.z - b.d / 2, Math.min(z, b.z + b.d / 2));
      this.wreck(b, splashDamage(w, Math.hypot(cx - x, cy - y, cz - z)) * w.wreck, owner);
    }
    for (const b of this.barrels) this.hurtBarrel(b, splashDamage(w, Math.hypot(b.x - x, b.y + 0.5 - y, b.z - z)), owner);
    if (team !== "you") for (const v of this.vehicles) if (v.alive) this.hurtVehicle(v, splashDamage(w, Math.hypot(v.x - x, v.y + VEHICLES[v.kind].mid - y, v.z - z)), owner);
    for (const s of this.soldiers) {
      if (!s.alive || s.vehicle >= 0) continue;
      const own = team !== null && s.id === owner;
      if (team !== null && (own ? w.effect === "reset" : !this.hostile(s, { id: owner, team }))) continue;
      const dx = s.x - x, dy = s.y + 0.9 - y, dz = s.z - z, d = Math.hypot(dx, dy, dz);
      const dmg = splashDamage(w, d) * (own ? 0.5 : 1) * (s.roll > 0 ? 0.5 : 1);
      if (dmg <= 0) continue;
      const k = w.knock * (1 - d / w.splash), hd = Math.hypot(dx, dz) || 1;
      s.vx += (dx / hd) * k, s.vz += (dz / hd) * k, s.vy += k * 0.45, s.grounded = false;
      this.hurt(s, dmg, owner);
    }
  }

  /* ---------------- barrels ---------------- */

  /** A few build artifacts round each yard's edge, clear of its files. */
  private placeBarrels() {
    for (const c of this.map.compounds) {
      let placed = 0;
      for (let i = 0; i < 12 && placed < BARRELS; i++) {
        const a = (i / 12) * Math.PI * 2 + c.x * 0.1, r = Math.max(2, c.r - 1.5), x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
        const y = this.terrain.height(x, z);
        if (this.blockAt(x, y + 0.5, z) || this.blocks().some((b) => Math.abs(x - b.x) < b.w / 2 + 0.8 && Math.abs(z - b.z) < b.d / 2 + 0.8)) continue;
        if (wet(this.terrain, x, z)) continue;
        this.barrels.push({ id: this.nextId++, x, y, z, hp: BARREL_HP, fuse: -1, by: -1 });
        placed++, i += 3;
      }
    }
  }

  private barrelAt(p: Shot): Barrel | null {
    for (const b of this.barrels) if (p.y >= b.y && p.y <= b.y + BARREL_HEIGHT && Math.hypot(p.x - b.x, p.z - b.z) < BARREL_RADIUS) return b;
    return null;
  }

  private hurtBarrel(b: Barrel, damage: number, by: number) {
    if (damage <= 0 || b.fuse >= 0) return;
    b.hp -= damage;
    // Lit: it goes off a beat later, so a row of them goes up one after another.
    if (b.hp <= 0) b.fuse = 0.12, b.by = by;
  }

  private fuses(dt: number) {
    for (const b of [...this.barrels]) {
      if (b.fuse < 0 || (b.fuse -= dt) > 0) continue;
      this.barrels = this.barrels.filter((o) => o !== b);
      this.blast(b.x, b.y + 0.5, b.z, BARREL_BLAST, b.by, null);
    }
  }

  /* ---------------- vehicles ---------------- */

  private dropVehicle(kind: VehicleKind) {
    const you = this.you(), f = fwd(you.yaw), R = this.terrain.R - 4;
    let x = you.x + f.x * 6, z = you.z + f.z * 6;
    // Not on top of one already down, nor in a file's side: further off to the right.
    const g = (x: number, z: number) => this.ground(x, z, Infinity);
    for (let i = 0; i < 8 && (this.vehicles.some((v) => Math.hypot(v.x - x, v.z - z) < 6) || this.filesAt(x, z, g(x, z)).length); i++) x -= f.z * 3, z += f.x * 3;
    const d = Math.hypot(x, z);
    if (d > R) x *= R / d, z *= R / d;
    const spec = VEHICLES[kind];
    // It comes down out of the sky beside you.
    this.vehicles.push({ id: this.nextId++, kind, x, y: this.ground(x, z, Infinity) + (kind === "heli" ? 30 : 14), z, vx: 0, vy: 0, vz: 0, yaw: you.yaw, hp: spec.hp, maxHp: spec.hp, driver: -1, alive: true, cd: 0, rocketCd: 0, odo: 0, fuel: 1, burn: false });
    this.events.push({ kind: "streak", vehicle: kind, kills: this.kills });
  }

  /** The nearest empty vehicle you could get in, if any. */
  boardable(s: Soldier): Vehicle | null {
    let best: Vehicle | null = null, bestD = BOARD_REACH;
    for (const v of this.vehicles) {
      const d = Math.hypot(v.x - s.x, v.z - s.z);
      if (v.alive && v.driver < 0 && d < bestD && Math.abs(v.y - s.y) < 4) best = v, bestD = d;
    }
    return best;
  }

  private toggleVehicle(s: Soldier) {
    const now = this.vehicles.find((v) => v.id === s.vehicle);
    if (now) {
      const f = fwd(now.yaw);
      now.driver = -1, s.vehicle = -1;
      // Out the right side, onto its own feet.
      Object.assign(s, { x: now.x - f.z * 2.2, z: now.z + f.x * 2.2, y: now.y + 0.6, vx: now.vx * 0.3, vy: 0, vz: now.vz * 0.3, grounded: false });
      this.events.push({ kind: "board", vehicle: now.kind, on: false });
      return;
    }
    const v = this.boardable(s);
    if (!v || s.roll > 0) return;
    v.driver = s.id, s.vehicle = v.id;
    Object.assign(s, { prone: false, crouch: false, burn: 0, reload: 0, scoped: false });
    this.events.push({ kind: "board", vehicle: v.kind, on: true });
  }

  private drive(s: Soldier, v: Vehicle, input: Input, dt: number) {
    const spec = VEHICLES[v.kind];
    s.yaw = input.yaw, s.pitch = input.pitch;
    v.cd = Math.max(0, v.cd - dt), v.rocketCd = Math.max(0, v.rocketCd - dt);
    if (v.kind === "roadster") this.driveRoadster(v, input, dt, s.id);
    else this.flyHeli(v, input, dt);
    // The driver rides along.
    Object.assign(s, { x: v.x, y: v.y + (v.kind === "roadster" ? 0.35 : 0.9), z: v.z, vx: v.vx, vy: 0, vz: v.vz, grounded: true, roll: 0 });
    const top = { x: v.x, y: v.y + (v.kind === "roadster" ? 1.5 : 0.6), z: v.z };
    if (input.fire && v.cd <= 0) {
      this.shoot(s, spec.gun, top, input.aim, 0.01);
      v.cd = spec.gunCd;
      this.events.push({ kind: "fire", id: s.id, weapon: spec.gun });
    }
    if (spec.rockets && input.scope && v.rocketCd <= 0) {
      const f = fwd(v.yaw);
      for (const side of [-1, 1]) this.shoot(s, spec.rockets, { x: top.x - f.z * side * 1.3, y: top.y, z: top.z + f.x * side * 1.3 }, input.aim);
      v.rocketCd = spec.rocketCd!;
      this.events.push({ kind: "fire", id: s.id, weapon: spec.rockets });
    }
  }

  private driveRoadster(v: Vehicle, input: Input, dt: number, driver: number) {
    const spec = VEHICLES.roadster, f = fwd(v.yaw);
    const onGround = v.y <= this.terrain.height(v.x, v.z) + 0.1;
    v.burn = !!input.up && v.fuel > 0;
    v.fuel = v.burn ? Math.max(0, v.fuel - dt / THRUST_SECONDS) : onGround ? Math.min(1, v.fuel + dt / THRUST_REFILL) : v.fuel;
    if (v.burn) {
      // The thrusters hold it up and push it any way you steer against where you look, and turn it to face there.
      const l = fwd(input.yaw), r = { x: -l.z, z: l.x };
      let mx = l.x * input.forward + r.x * input.right, mz = l.z * input.forward + r.z * input.right;
      const m = Math.hypot(mx, mz), k = Math.min(1, 3 * dt);
      if (m > 1) mx /= m, mz /= m;
      v.vx += (mx * spec.thrust! - v.vx) * k, v.vz += (mz * spec.thrust! - v.vz) * k;
      v.vy += ((input.down || input.crouch ? -2 : THRUST_LIFT) - v.vy) * k;
      v.yaw += (((input.yaw - v.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, 4 * dt);
    } else if (onGround) {
      let speed = v.vx * f.x + v.vz * f.z;
      const grade = (this.terrain.height(v.x + f.x * 1.5, v.z + f.z * 1.5) - this.terrain.height(v.x, v.z)) / 1.5 * Math.sign(speed || input.forward || 1);
      const target = input.forward > 0 ? spec.top * input.forward * climb(grade * 0.5) : input.forward < 0 ? -8 : 0;
      const a = (input.forward ? spec.accel : 9) * dt;
      speed += Math.max(-a, Math.min(a, target - speed));
      // Steering bites harder the faster it goes, and reverses backing up.
      v.yaw -= input.right * 2.1 * Math.max(-1, Math.min(1, speed / 6)) * dt;
      const g = fwd(v.yaw);
      v.vx = g.x * speed, v.vz = g.z * speed;
    }
    // Off the ground with the thrusters quiet, it coasts.
    const nx = v.x + v.vx * dt, nz = v.z + v.vz * dt, speed = Math.hypot(v.vx, v.vz);
    const here = this.terrain.height(v.x, v.z), there = this.terrain.height(nx, nz), run = Math.hypot(nx - v.x, nz - v.z);
    // Files and cliffs stop it (it can fly over both); a file hit at speed loses lines for it. One it's
    // already in, say dropped half into one, doesn't hold it: it can always drive back out.
    const inside = this.filesAt(v.x, v.z, v.y), wall = this.filesAt(nx, nz, v.y).find((b) => !inside.includes(b));
    if (wall || Math.hypot(nx, nz) > this.terrain.R - 2 || (run > 0 && there > v.y + 0.3 && (there - here) / run > CLIFF * 1.3)) {
      if (wall && speed > 4) this.wreck(wall, speed * 8, driver);
      v.vx *= -0.3, v.vz *= -0.3;
    } else {
      v.x = nx, v.z = nz;
      if (onGround) v.odo += (v.vx * f.x + v.vz * f.z) * dt;
    }
    this.fall(v, dt, v.burn ? 0 : GRAVITY);
    // Run them over.
    if (speed > RUN_OVER) for (const t of this.soldiers) {
      if (!t.alive || t.team === "you" || Math.hypot(t.x - v.x, t.z - v.z) > 1.8 || Math.abs(t.y - v.y) > 2) continue;
      t.vx += v.vx * 0.8, t.vz += v.vz * 0.8, t.vy += 6, t.grounded = false;
      this.hurt(t, t.hp + t.shield, driver);
    }
  }

  /** The files whose sides a car's body at (x, y, z) would be in. */
  private filesAt(x: number, z: number, y: number): Block[] {
    return this.map.blocks.filter((b) => b.h > 0 && b.y + b.h > y + 0.7 && Math.abs(x - b.x) < b.w / 2 + 1.1 && Math.abs(z - b.z) < b.d / 2 + 1.1);
  }

  private flyHeli(v: Vehicle, input: Input, dt: number) {
    const spec = VEHICLES.heli, f = fwd(input.yaw), r = { x: -f.z, z: f.x };
    let mx = f.x * input.forward + r.x * input.right, mz = f.z * input.forward + r.z * input.right;
    const m = Math.hypot(mx, mz);
    if (m > 1) mx /= m, mz /= m;
    const k = Math.min(1, 2.2 * dt);
    v.vx += (mx * spec.top - v.vx) * k, v.vz += (mz * spec.top - v.vz) * k;
    v.vy += (((input.up ? 9 : 0) - (input.down || input.crouch ? 9 : 0)) - v.vy) * k;
    v.yaw += (((input.yaw - v.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, 6 * dt);
    let nx = v.x + v.vx * dt, nz = v.z + v.vz * dt;
    const d = Math.hypot(nx, nz), R = this.terrain.R - 2;
    if (d > R) nx *= R / d, nz *= R / d;
    v.x = nx, v.z = nz;
    const floor = this.ground(v.x, v.z, Infinity) + HELI_FLOOR;
    v.y = Math.max(floor, Math.min(this.terrain.height(v.x, v.z) + HELI_CEILING, v.y + v.vy * dt));
  }

  /** Under gravity onto the ground or a file's top; a helicopter with nobody in it settles gently. */
  private fall(v: Vehicle, dt: number, gravity = v.kind === "heli" ? 6 : GRAVITY) {
    v.vy -= gravity * dt;
    v.y += v.vy * dt;
    const g = this.ground(v.x, v.z, v.y + 0.5);
    if (v.y <= g) v.y = g, v.vy = 0;
  }

  private settle(v: Vehicle, dt: number) {
    if (!v.alive) return;
    v.vx *= Math.exp(-dt * 3), v.vz *= Math.exp(-dt * 3);
    v.x += v.vx * dt, v.z += v.vz * dt;
    this.fall(v, dt);
    if (v.kind === "heli") v.vy = Math.max(v.vy, -5);
    // Parked, a roadster's thrusters go quiet and fill again.
    v.burn = false, v.fuel = Math.min(1, v.fuel + dt / THRUST_REFILL);
  }

  private vehicleAt(p: Shot): Vehicle | null {
    for (const v of this.vehicles) {
      const spec = VEHICLES[v.kind];
      if (v.alive && Math.hypot(p.x - v.x, p.y - (v.y + spec.mid), p.z - v.z) < spec.radius) return v;
    }
    return null;
  }

  private hurtVehicle(v: Vehicle, damage: number, by: number) {
    if (!v.alive || damage <= 0 || this.status !== "playing") return;
    v.hp -= damage;
    this.events.push({ kind: "vehicleHit", id: v.id, damage });
    if (v.hp > 0) return;
    v.alive = false, v.hp = 0;
    this.vehicles = this.vehicles.filter((o) => o !== v);
    this.events.push({ kind: "wrecked", id: v.id, vehicle: v.kind });
    const s = v.driver >= 0 ? this.soldiers[v.driver] : undefined;
    // Thrown clear, and it hurts.
    if (s) s.vehicle = -1, s.vy = 9, s.grounded = false, v.driver = -1;
    this.blast(v.x, v.y + 1, v.z, VEHICLE_BLAST, this.me, "you");
    if (s) this.hurt(s, 25, by);
  }

  /** Deletes a file's lines: it sinks with what it loses, and with nothing left it's gone. A stash just takes the damage. */
  private wreck(b: Block, damage: number, by: number) {
    if (b.wall) return;
    if (damage <= 0) return;
    if ("ttl" in b) return void ((b as Stash).hp -= damage);
    let w = this.wrecks.get(b);
    if (!w) this.wrecks.set(b, (w = { hp: fileHp(b.lines), maxHp: fileHp(b.lines), tall: b.h, lines: b.lines }));
    if (w.hp <= 0) return;
    w.hp -= damage;
    const k = Math.max(0, w.hp / w.maxHp);
    b.h = w.tall * k, b.lines = Math.round(w.lines * k);
    if (w.hp > 0 && b.h >= RUBBLE) return;
    w.hp = 0, b.h = 0, b.lines = 0;
    const i = this.map.blocks.indexOf(b);
    if (i >= 0) this.map.blocks.splice(i, 1);
    this.events.push({ kind: "razed", path: b.path, lines: w.lines, by, x: b.x, y: b.y, z: b.z, w: b.w, h: w.tall, d: b.d });
  }

  /** Whether a file has taken a hit (it's lost lines, or all of them). */
  hit(b: Block): boolean { return this.wrecks.has(b); }

  /** The paths of the files with no lines left. */
  razedPaths(): string[] { return [...this.wrecks].filter(([, w]) => w.hp <= 0).map(([b]) => b.path); }

  /** A file as the battle says it stands, on a page's copy of the battle: its height and lines, or gone. */
  setFile(path: string, h: number, lines: number) {
    const i = this.map.blocks.findIndex((b) => b.path === path), b = this.map.blocks[i];
    if (!b) return;
    b.h = Math.max(0, h), b.lines = lines;
    if (b.h <= 0) this.map.blocks.splice(i, 1);
  }

  /** Throws a stash down where a round landed: a box to crouch behind. Only the newest few stay. */
  private stash(x: number, z: number, y: number) {
    const base = this.ground(x, z, y + 1);
    this.stashes.push({ id: this.nextId++, path: `stash@{${this.stashes.length}}`, lines: 0, compound: -1, x, z, y: base, w: 1.6, d: 1.6, h: 1.3, hp: STASH_HP, ttl: STASH_TTL });
    while (this.stashes.length > STASHES) this.stashes.shift();
    this.events.push({ kind: "stashed", x, y: base, z });
  }

  /** git revert: back where it was TRAIL_SECONDS ago, and it has forgotten you. */
  private revert(s: Soldier) {
    const back = s.trail[0];
    if (back) Object.assign(s, { x: back.x, y: back.y, z: back.z, vx: 0, vy: 0, vz: 0 });
    s.trail = back ? [back] : [];
    this.past.delete(s.id);
    if (s.brain) Object.assign(s.brain, { alert: false, seen: null, wait: 1.5, cover: null, coverT: 0, burst: 0, heard: null, hunt: 0 });
    this.events.push({ kind: "reverted", id: s.id });
  }

  hurt(s: Soldier, damage: number, by: number, head = false) {
    if (!s.alive || this.status !== "playing") return;
    // In a vehicle, the vehicle takes it.
    const ride = s.vehicle >= 0 ? this.vehicles.find((v) => v.id === s.vehicle) : undefined;
    if (ride) return this.hurtVehicle(ride, damage, by);
    // The shield takes it first; what's left over comes off the HP.
    if (s.id === this.spared) damage = Math.min(damage, Math.max(0, s.hp + s.shield - STRIKE_LEAVES));
    const soak = Math.min(s.shield, damage);
    s.shieldT = 0, s.shield -= soak;
    if (soak > 0 && s.shield <= 0) this.events.push({ kind: "shield", id: s.id, state: "broke" });
    s.hp -= damage - soak;
    this.events.push({ kind: "hit", target: s.id, by, damage, shield: soak > 0, head });
    // A revert's victim has forgotten you; anything else alarms its yard (and a hit ambush is up whatever its yard does).
    if (s.brain && s.brain.wait < 1) this.alarm(s.compound, s);
    if (s.hp > 0) return;
    s.alive = false, s.hp = 0;
    this.events.push({ kind: "down", id: s.id, by });
    if (s.team === "conflict") {
      // Killstreaks are yours on your own: a battle has no vehicles.
      if (!this.mode && by === this.me) {
        this.kills++;
        for (const st of STREAKS) if (this.kills === st.kills) this.dropVehicle(st.kind);
      }
      return this.checkCleared(s.compound);
    }
    if (!this.mode) return this.respawn(s);
    // A battle: a down by another player scores, and you're back in RESPAWN seconds.
    s.deaths++, s.respawn = RESPAWN;
    this.dropCommit(s);
    const killer = this.soldiers[by];
    if (killer && !killer.brain && this.hostile(killer, s)) {
      killer.score++;
      if (this.mode !== "coop") this.decide();
    }
  }

  /** A carried commit drops where its carrier fell (or left). */
  private dropCommit(s: Soldier) {
    const o = this.objective;
    if (o.kind === "carry" && o.carried && o.by === s.id) {
      o.carried = false, o.by = -1, o.x = s.x, o.y = this.ground(s.x, s.z, s.y + 1), o.z = s.z;
      this.events.push({ kind: "objective", text: "dropped the commit" });
    }
  }

  private respawn(s: Soldier) {
    this.lives--;
    this.dropCommit(s);
    if (this.lives < 0) {
      this.lives = 0;
      return this.lose();
    }
    const { x, z, yaw } = this.map.spawn;
    Object.assign(s, { x, z, y: this.ground(x, z, Infinity), vx: 0, vy: 0, vz: 0, yaw, hp: s.maxHp, shield: s.maxShield, shieldT: SHIELD_DELAY, alive: true, roll: 0, cd: 0.5, burn: 0, lean: 0, chute: false });
    // A fresh life: the role you picked for it, with full magazines.
    if (this.nextRole) this.role = this.nextRole, this.nextRole = null;
    if (this.role) this.arm(s, this.role);
    // Guards lose track of you (raiders keep coming).
    for (const g of this.soldiers) if (g.brain && !g.brain.raid) g.brain.alert = false, g.brain.seen = null, g.brain.heard = null, g.brain.hunt = 0;
    this.events.push({ kind: "respawn", id: s.id, lives: this.lives });
  }

  private checkCleared(ci: number) {
    if (ci < 0 || this.cleared[ci] || this.soldiers.some((g) => g.compound === ci && g.alive)) return;
    this.cleared[ci] = true;
    // A taken yard leaves its crates behind: health and ammo.
    const c = this.map.compounds[ci]!;
    for (const [kind, dx] of [["health", -1.5], ["ammo", 1.5]] as const) this.crate(kind, c.x + dx, c.z);
    this.events.push({ kind: "cleared", compound: ci });
    // Every compound taken: the repo is merged, whatever the mission, unless a commit still has to get home.
    // A battle on downs goes on.
    if (this.cleared.every(Boolean) && this.objective.kind !== "carry" && (!this.mode || this.mode === "coop")) this.win();
  }

  /** A crate dropped on the ground at (x, z). */
  crate(kind: PickupKind, x: number, z: number) {
    this.pickups.push({ id: this.nextId++, kind, x, y: this.ground(x, z, Infinity), z });
  }

  /** A strike landing at (x, y, z): a launcher's blast from nobody, which leaves `spare` standing however near it lands. */
  strike(x: number, y: number, z: number, spare: number) {
    this.spared = spare;
    this.blast(x, y, z, STRIKE_BLAST, -1, null);
    this.spared = -1;
  }

  /**
   * Guards sent in for compound ci, n of them round (x, z), already hunting toward the player there:
   * they count as its guards, so it isn't merged until they're down too.
   */
  reinforce(ci: number, n: number, x: number, z: number): Soldier[] {
    const c = this.map.compounds[ci]!, you = this.you(), out: Soldier[] = [];
    for (let g = 0; g < n; g++) {
      const a = (g / n) * Math.PI * 2 + this.rand(), gx = x + Math.cos(a) * 2, gz = z + Math.sin(a) * 2;
      const s = this.soldier("conflict", `${c.folder} reinforcement`, gx, gz, Math.atan2(gx - you.x, gz - you.z), ci);
      // They come in already looking: a beat before they react, and the hunt points them at you.
      Object.assign(s.brain!, { role: g % 2 ? "flank" : "pin", side: g % 4 === 1 ? 1 : -1, alert: true, wait: 0.8 + this.rand() * 0.5, heard: { x: you.x, z: you.z }, hunt: HUNT_SECONDS });
      this.soldiers.push(s), out.push(s);
    }
    return out;
  }

  /** Compound ci's guards all come up, except an ambush, which keeps still unless it's the one that raised it (or it was hit). */
  private alarm(ci: number, from?: Soldier) {
    for (const g of this.soldiers) if (g.brain && g.alive && g.compound === ci && !g.brain.alert && (!g.brain.ambush || g === from)) {
      g.brain.alert = true, g.brain.wait = 0.3 + this.rand() * 0.4, g.brain.lost = 0;
    }
  }

  /**
   * A gun going off is heard: every guard within earshot (farther for a loud gun) that isn't already on
   * you comes hunting towards where it was fired, past its yard's leash. So you can't sit out of sight
   * and pick a compound apart: the shots bring them to you.
   */
  private heard(s: Soldier, w: Weapon) {
    const reach = HEAR * w.loud;
    for (const g of this.soldiers) {
      if (!g.brain || !g.alive || g.brain.raid) continue;
      const d = Math.hypot(g.x - s.x, g.z - s.z);
      // An ambush stays down for a gun going off anywhere but close.
      if (d > reach || (g.brain.ambush && d > AMBUSH_HEAR)) continue;
      g.brain.heard = { x: s.x, z: s.z }, g.brain.hunt = HUNT_SECONDS;
      if (!g.brain.alert) g.brain.alert = true, g.brain.wait = 0.4 + this.rand() * 0.5, g.brain.lost = 0;
    }
  }

  /** Where to go next: the nearest compound still held (the trail ends at its gate), or the mission's own point. Null in a battle on downs, or when it's done. */
  waypoint(): Waypoint | null {
    if (this.status !== "playing" || (this.mode && this.mode !== "coop")) return null;
    const you = this.you(), o = this.objective, { spawn } = this.map;
    if (o.kind === "carry") {
      if (o.carried && o.by === you.id) return { x: spawn.x, y: this.terrain.height(spawn.x, spawn.z), z: spawn.z, label: "HEAD", kind: "head" };
      if (!o.carried) return { x: o.x, y: o.y, z: o.z, label: "the commit", kind: "commit" };
    }
    if (o.kind === "defend") return { x: o.x, y: this.terrain.height(o.x, o.z), z: o.z, label: "main", kind: "branch" };
    let best: Waypoint | null = null, bestD = Infinity;
    this.map.compounds.forEach((c, i) => {
      if (this.cleared[i]) return;
      const g = gateDir(c.gate ?? 0), x = c.x + g.x * ((c.half ?? c.r * 0.66) + 1), z = c.z + g.z * ((c.half ?? c.r * 0.66) + 1), d = Math.hypot(x - you.x, z - you.z);
      if (d < bestD) best = { x, y: this.terrain.height(x, z), z, label: c.folder, kind: "compound" }, bestD = d;
    });
    return best;
  }

  /* ---------------- guards ---------------- */

  /** Where to crouch behind a block, out of sight of a threat: the far side of the nearest one within 12 m and the leash. */
  coverFrom(s: Soldier, threat: { x: number; z: number }): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null, bestD = 12;
    const home = s.brain?.home;
    for (const b of this.blocks()) {
      if (b.h < CROUCH_HEIGHT) continue;
      const dx = b.x - threat.x, dz = b.z - threat.z, d = Math.hypot(dx, dz) || 1, off = Math.max(b.w, b.d) / 2 + RADIUS + 0.4;
      const x = b.x + (dx / d) * off, z = b.z + (dz / d) * off, from = Math.hypot(x - s.x, z - s.z);
      if (from >= bestD || (home && Math.hypot(x - home.x, z - home.z) > LEASH)) continue;
      // Behind it means it's between you and the threat.
      if (Math.hypot(x - threat.x, z - threat.z) < d) continue;
      best = { x, z }, bestD = from;
    }
    return best;
  }

  /** What a guard can see to shoot at: the nearest player it sees, or a stash it takes for one (the nearer, if it sees both). */
  private spot(s: Soldier): { x: number; y: number; z: number } | null {
    const eye = s.y + (s.prone ? 0.4 : 1.5), reach = s.brain!.ambush ? AMBUSH_SEE : SIGHT;
    // Nearest first, so the sight lines (the costly part) stop at the first player in view. Smoke hides you past a few metres of it.
    let you: Soldier | null = null, dYou = Infinity;
    const near = this.soldiers
      .filter((p) => p.alive && !p.brain)
      .map((p) => ({ p, d: Math.hypot(p.x - s.x, p.z - s.z) }))
      .filter(({ p, d }) => d < reach * (p.prone ? 0.4 : p.crouch ? 0.6 : 1))
      .sort((a, b) => a.d - b.d);
    for (const { p, d } of near) if (this.clear(s.x, eye, s.z, p.x, p.y + bodyHeight(p) * 0.67, p.z) && !this.smoked(s.x, s.z, p.x, p.z)) { you = p, dYou = d; break; }
    const sees = !!you;
    let decoy: Stash | null = null, dDecoy = Infinity;
    for (const st of this.stashes) {
      const d = Math.hypot(st.x - s.x, st.z - s.z);
      if (d < SIGHT && d < dDecoy && this.clear(s.x, eye, s.z, st.x, st.y + st.h + 0.4, st.z)) decoy = st, dDecoy = d;
    }
    if (decoy && (!sees || dDecoy < dYou + 10)) return { x: decoy.x, y: decoy.y + decoy.h * 0.6, z: decoy.z };
    return you ? { x: you.x, y: you.y + bodyHeight(you) * 0.6, z: you.z } : null;
  }

  private think(s: Soldier, dt: number) {
    const b = s.brain!;
    b.think -= dt;
    b.coverT = Math.max(0, b.coverT - dt);
    if (b.think <= 0) {
      b.think = 0.2;
      const seen = this.spot(s);
      if (seen) {
        if (!b.alert) this.alarm(s.compound, s);
        b.seen = seen, b.lost = 0;
      } else b.lost += 0.2;
      if (b.alert && b.lost > 6 && !b.raid && b.hunt <= 0) b.alert = false, b.seen = null;
      // In a fight: read the squad on you and take the job it gives.
      if (b.alert && (b.seen || b.heard) && !b.raid) this.regroup(s);
      // Hit: duck behind something (a rush doesn't stop).
      if (s.hp < b.lastHp && b.alert && b.seen && !b.cover && b.role !== "rush") this.takeCover(s, 1.2);
      b.lastHp = s.hp;
    }
    b.hunt = Math.max(0, b.hunt - dt);
    if (b.hunt <= 0) b.heard = null;
    if (s.burn > 0) {
      // On fire: it runs about flailing, and doesn't shoot.
      const a = this.time * 2.3 + s.id * 1.7;
      s.crouch = false, s.prone = false;
      this.walk(s, Math.sin(a), Math.cos(a * 0.7), dt);
      return;
    }
    let mx = 0, mz = 0;
    const toHome = Math.hypot(b.home.x - s.x, b.home.z - s.z);
    if (b.ambush && !b.alert) {
      // Lying in wait: flat behind the hedge, not a move, till something rouses it.
      s.prone = true, s.crouch = false;
      this.walk(s, 0, 0, dt);
      return;
    }
    b.ambush = false, s.prone = false;
    if (!b.alert || (!b.seen && !b.raid && !b.heard)) {
      // On watch: drift about the yard.
      if (toHome > 3) mx = (b.home.x - s.x) / toHome * 0.4, mz = (b.home.z - s.z) / toHome * 0.4;
      s.crouch = false;
      this.walk(s, mx, mz, dt);
      return;
    }
    if (!b.seen && b.heard && !b.raid) {
      // Heard a gun, seen nobody: go and look where it came from, as far as the hunt leash allows.
      b.wait -= dt;
      const hx = b.heard.x - s.x, hz = b.heard.z - s.z, hd = Math.hypot(hx, hz);
      s.crouch = false;
      if (hd > 4 && toHome < HUNT_LEASH) s.yaw = yawTo(hx, hz), this.walk(s, (hx / hd) * 0.9, (hz / hd) * 0.9, dt);
      else {
        // There: look about where the shots came from, then the hunt runs down and it wanders home.
        s.yaw += dt * 1.2;
        this.walk(s, 0, 0, dt);
        b.hunt = Math.min(b.hunt, 4);
      }
      return;
    }
    b.wait -= dt;
    const tgt = b.seen ?? { x: b.home.x, y: 0, z: b.home.z };
    const dx = tgt.x - s.x, dz = tgt.z - s.z, d = Math.hypot(dx, dz) || 1;
    s.yaw = yawTo(dx, dz);
    s.crouch = false;
    b.strafeT -= dt;
    if (b.strafeT <= 0) b.strafe = this.rand() < 0.5 ? -1 : 1, b.strafeT = 0.8 + this.rand() * 1.4;
    const to = (x: number, z: number, k = 1) => {
      const ex = x - s.x, ez = z - s.z, e = Math.hypot(ex, ez);
      if (e > 0.6) mx = (ex / e) * k, mz = (ez / e) * k;
      return e;
    };
    if (b.cover && b.coverT > 0) {
      // In cover: get there and crouch till the reload's done.
      if (to(b.cover.x, b.cover.z) < 0.8) s.crouch = true;
    } else if (b.raid) {
      // Raiders head for the branch, shooting you if they see you on the way: out of their gate and
      // down the footpath, not straight at it over the walls and the drops.
      // It keeps to the shelf: along the leg it's on, eyes a little ahead, the way a player walks it.
      const route = this.raidRoute(s.compound);
      const along = (i: number) => {
        const a = route[i]!, c = route[Math.min(route.length - 1, i + 1)]!, ex = c.x - a.x, ez = c.z - a.z, l2 = ex * ex + ez * ez || 1;
        return { a, ex, ez, u: ((s.x - a.x) * ex + (s.z - a.z) * ez) / l2, len: Math.sqrt(l2) };
      };
      while (b.leg < route.length - 1 && (along(b.leg).u >= 1 || Math.hypot(route[b.leg + 1]!.x - s.x, route[b.leg + 1]!.z - s.z) < 1.2)) b.leg++;
      const { a, ex, ez, u, len } = along(b.leg), ahead = Math.min(1, Math.max(0, u) + 1.2 / len);
      to(a.x + ex * ahead, a.z + ez * ahead);
    } else {
      b.cover = null;
      // The squad decides the range: a lone guard keeps well off, a pair closer, a squad closer still and right in
      // once a flanker has the angle; a rush just comes. Everyone else strafes as it holds its range.
      const [near, far] = b.advance && b.role !== "rush" ? ADVANCE : BANDS[b.tactic];
      const close = b.lost === 0 ? (d > far ? 1 : d < near ? -1 : 0) : 1;
      const sway = b.role === "rush" ? 0.25 : b.tactic === "lone" ? 0.5 : 0.7;
      mx = (dx / d) * close + (-dz / d) * b.strafe * sway;
      mz = (dz / d) * close + (dx / d) * b.strafe * sway;
      // A flanker swings wide round your side first, and only then comes on.
      if (b.role === "flank" && b.lost === 0 && !b.advance && !this.hasAngle(s)) {
        const p = this.flankPoint(s);
        if (Math.hypot(p.x - s.x, p.z - s.z) > 3) to(p.x, p.z);
      }
      // Alone and hurt, it backs off behind something and holds there.
      if (b.tactic === "lone" && s.hp < s.maxHp * LONE_RETREAT && b.lost === 0) this.takeCover(s, 4);
      // The leash: the yard's, or the hunt's once it has heard you shooting.
      const leash = b.hunt > 0 ? HUNT_LEASH : LEASH;
      if (toHome > leash && (mx * (b.home.x - s.x) + mz * (b.home.z - s.z)) < 0) mx = (b.home.x - s.x) / toHome, mz = (b.home.z - s.z) / toHome;
    }
    const pace = b.role === "rush" ? 1 : 0.8;
    this.walk(s, mx * pace, mz * pace, dt);
    // Fire when it sees you; a pinner keeps the spot you ducked out of sight at under fire a few seconds more,
    // to keep your head down while the others move.
    const pinning = b.role === "pin" && b.tactic !== "lone" && b.lost > 0 && b.lost < SUPPRESS;
    if (b.wait > 0 || !b.seen || b.coverT > 0 || (b.lost > 0 && !pinning)) return;
    // A flanker holds its fire till it's round your side or close, so its swing isn't announced.
    if (b.role === "flank" && !b.advance && d > 14 && !this.hasAngle(s)) return;
    // Bursts of commits; a launcher round when the target's far enough off not to catch the blast.
    const aim = b.seen;
    if (s.ammo.push > 0 && d > 12 && s.cd <= 0 && this.rand() < (s.heavy ? 0.03 : 0.01)) s.weapon = "push";
    else if (s.ammo.push === 0 || d <= 12) s.weapon = "commit";
    if (s.cd <= 0) {
      const burst = s.heavy ? 9 : b.tactic === "lone" ? 4 : BURSTS[b.role];
      if (b.burst >= burst) {
        b.burst = 0, s.cd = 0.9 + this.rand() * 0.6;
        // Reloading from behind something: nearly always alone, half the time in a squad, never in a rush.
        const duck = b.role === "rush" || b.tactic === "horde" ? 0 : b.tactic === "lone" ? 0.75 : b.tactic === "platoon" ? 0.3 : 0.5;
        if (this.rand() < duck) this.takeCover(s, s.cd + 0.6);
        return;
      }
      this.fire(s, aim, 0.05 + Math.min(0.05, d / 1000) + (pinning ? 0.06 : 0) + (b.role === "rush" ? 0.03 : 0));
      b.burst++;
    }
  }

  /**
   * Reads the squad on s's target (the alert guards on about the same spot, within PACK of it) and takes the
   * job its place in it gives, heavies first then by id, so the same squad always splits the same way and a
   * job only changes when the squad does: one of you is careful; two split into a pinner and a flanker; three
   * to five put a flanker round each side and push in together once one has the angle; six to nine add a
   * rush; ten or more all come at once.
   */
  private regroup(s: Soldier) {
    const b = s.brain!, t = b.seen ?? b.heard!;
    const pack = this.soldiers.filter((g) => {
      if (!g.alive || !g.brain || !g.brain.alert || g.brain.raid || g.brain.ambush) return false;
      const u = g.brain.seen ?? g.brain.heard;
      return !!u && Math.hypot(u.x - t.x, u.z - t.z) < PACK && Math.hypot(g.x - s.x, g.z - s.z) < PACK * 1.5;
    }).sort((p, q) => Number(q.heavy) - Number(p.heavy) || p.id - q.id);
    const n = Math.max(1, pack.length), tactic = tacticFor(n), i = Math.max(0, pack.indexOf(s));
    b.pack = n, b.tactic = tactic;
    b.role = tactic === "lone" ? "pin"
      : tactic === "pair" ? (i === 0 ? "pin" : "flank")
      : tactic === "squad" ? (i === 1 || i === 2 ? "flank" : "pin")
      : tactic === "platoon" ? (i < 2 ? "pin" : i < 4 ? "flank" : "rush")
      : s.heavy ? "pin" : "rush";
    b.side = i % 2 ? 1 : -1;
    // Squad-sized, they push in together once a flanker is round your side.
    b.advance = (tactic === "squad" || tactic === "platoon") && pack.some((g) => g.brain!.role === "flank" && g.brain!.lost === 0 && this.hasAngle(g));
  }

  /** Whether a guard is well round your side: FLANK_ANGLE or more off the line from its yard to you. */
  hasAngle(g: Soldier): boolean {
    const b = g.brain!, t = b.seen;
    if (!t) return false;
    const ax = t.x - b.home.x, az = t.z - b.home.z, bx = t.x - g.x, bz = t.z - g.z, a = Math.hypot(ax, az) || 1, c = Math.hypot(bx, bz) || 1;
    return Math.acos(Math.max(-1, Math.min(1, (ax * bx + az * bz) / (a * c)))) >= FLANK_ANGLE;
  }

  private routes = new Map<number, { x: number; z: number }[]>();
  /** A yard's way to the branch (HEAD): to its gate from inside, then its footpath walked backwards. */
  private raidRoute(ci: number): { x: number; z: number }[] {
    let r = this.routes.get(ci);
    if (r) return r;
    const c = this.map.compounds[ci], { spawn } = this.map;
    r = [];
    if (c && c.gate !== undefined) {
      const g = gateDir(c.gate), h = c.half ?? c.r * 0.66;
      r.push({ x: c.x + g.x * (h - 1.5), z: c.z + g.z * (h - 1.5) });
      r.push(...[...(this.map.trails?.[ci] ?? [])].reverse());
    }
    r.push({ x: spawn.x, z: spawn.z });
    this.routes.set(ci, r);
    return r;
  }

  private takeCover(s: Soldier, seconds: number) {
    const b = s.brain!;
    if (!b.seen || b.raid) return;
    const c = this.coverFrom(s, b.seen);
    if (c) b.cover = c, b.coverT = seconds;
  }

  /**
   * Where a flanker heads: FLANK_OUT metres off to your side, square to the line from its yard to you, on its
   * own side unless that's water, over the edge or too steep to stand on, in which case it swaps sides.
   */
  flankPoint(s: Soldier): { x: number; z: number } {
    const b = s.brain!, t = b.seen ?? b.home;
    const ux = b.home.x - t.x, uz = b.home.z - t.z, u = Math.hypot(ux, uz) || 1;
    const at = (side: number) => ({ x: t.x + (-uz / u) * side * FLANK_OUT, z: t.z + (ux / u) * side * FLANK_OUT });
    const ok = (p: { x: number; z: number }) => Math.hypot(p.x, p.z) < this.terrain.R - 3 && !wet(this.terrain, p.x, p.z) && slope(this.terrain, p.x, p.z) < SLIDE;
    const p = at(b.side);
    if (ok(p)) return p;
    const q = at(-b.side);
    if (!ok(q)) return p;
    b.side = -b.side;
    return q;
  }

  /* ---------------- sight and the camera ---------------- */

  /** Whether a line across the ground runs through more than SMOKE_SEE metres of smoke: nobody sees through that. */
  smoked(ax: number, az: number, bx: number, bz: number): boolean {
    const smoke = this.map.smoke;
    if (!smoke?.length) return false;
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
    let inside = 0;
    for (const s of smoke) {
      // How much of the segment lies inside the disc.
      const fx = ax - s.x, fz = az - s.z, bq = (2 * (fx * dx + fz * dz)) / L, c = fx * fx + fz * fz - s.r * s.r, disc = bq * bq - 4 * c;
      if (disc <= 0) continue;
      const r = Math.sqrt(disc), t0 = Math.max(0, (-bq - r) / 2), t1 = Math.min(L, (-bq + r) / 2);
      if (t1 > t0) inside += t1 - t0;
      if (inside > SMOKE_SEE) return true;
    }
    return false;
  }

  /**
   * How far back from `from` towards `to` a camera can go before it's in a wall, a file or the ground, as a
   * fraction of the way (1: all of it), stopped `margin` metres short of what it met. The page keeps the camera
   * on your side of a wall with this, so no wall ever shows you what's behind it.
   */
  cameraReach(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, margin = 0.35): number {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, L = Math.hypot(dx, dy, dz);
    if (L < 1e-6) return 1;
    const n = Math.ceil(L / 0.15);
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = from.x + dx * t, y = from.y + dy * t, z = from.z + dz * t;
      if (y < this.terrain.height(x, z) + 0.3 || this.solidNear(x, y, z, margin)) return Math.max(0, (i - 1) / n - margin / L);
    }
    return 1;
  }

  /** Whether a point is within m metres of a file, a wall or a stash. */
  private solidNear(x: number, y: number, z: number, m: number): boolean {
    for (const b of this.blocks()) if (b.h > 0 && y >= b.y - m && y <= b.y + b.h + m && Math.abs(x - b.x) <= b.w / 2 + m && Math.abs(z - b.z) <= b.d / 2 + m) return true;
    return false;
  }
}
