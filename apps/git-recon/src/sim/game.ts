// The whole game, with no rendering: a toy-soldier third-person shooter on a codebase.
// You run, strafe, jump, crouch, go prone and dive-roll (no damage from direct hits
// mid-roll) round a repo's compounds and take each one by downing its guards. The
// level's mission (missions.ts) says what wins it. Go down and you come back from the
// reflog, three times. Crates in the field and in cleared yards hold ammo and health.
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

import { mapRepo, mulberry32, reachable, type Block, type CodeMap, type RepoSnapshot } from "./codemap.ts";
import { BRANCH_RADIUS, HEAD_RADIUS, OVERRUN, type Mission } from "./missions.ts";
import { CLIFF, slope, wet, type Terrain } from "./terrain.ts";
import { ORDER, splashDamage, WEAPONS, type WeaponId } from "./weapons.ts";

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
  /** A squad's guards either hold the yard or swing round your side. */
  role: "hold" | "flank";
  side: number;
  /** Where it's taking cover, and for how long it stays down there. */
  cover: { x: number; z: number } | null;
  coverT: number;
  /** HP last time it thought: a drop sends it into cover. */
  lastHp: number;
  /** Sent at the branch in a defend mission: it goes there, whatever it sees. */
  raid: boolean;
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
  ammo: Record<WeaponId, number>;
  cd: number;
  /** Seconds left in a dive-roll, and seconds until the next one. */
  roll: number;
  rollCd: number;
  rollDir: { x: number; z: number };
  grounded: boolean;
  crouch: boolean;
  prone: boolean;
  /** Looking down the rebase scope: the sight sways. */
  scoped: boolean;
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
  /** The soldier a cherry-pick picked. */
  target?: number;
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
  fire: boolean;
  /** What the crosshair is on; shots go from the muzzle to here. Without it, straight along yaw and pitch. */
  aim?: { x: number; y: number; z: number };
  weapon?: WeaponId;
}

export type GameEvent =
  | { kind: "fire"; id: number; weapon: WeaponId }
  | { kind: "hit"; target: number; by: number; damage: number; shield: boolean }
  /** A shield popping, starting to refill, or full again. */
  | { kind: "shield"; id: number; state: "broke" | "charging" | "full" }
  | { kind: "boom"; x: number; y: number; z: number; r: number }
  | { kind: "down"; id: number; by: number }
  | { kind: "respawn"; id: number; lives: number }
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
  | { kind: "won" }
  | { kind: "lost" }
  /** A player joining or leaving a battle. */
  | { kind: "joined"; id: number }
  | { kind: "left"; id: number };

export const RUN = 7.5, CROUCH_SPEED = 3.2, PRONE_SPEED = 1.5, GRAVITY = 26, JUMP = 8.5;
export const ROLL_TIME = 0.42, ROLL_SPEED = 12.5, ROLL_COOLDOWN = 0.6;
export const RADIUS = 0.45, HEIGHT = 1.8, CROUCH_HEIGHT = 1.2, PRONE_HEIGHT = 0.5, STEP = 0.6;
export const MAX_HP = 100, HEAVY_HP = 260, LIVES = 3;
/** Your shield and a heavy's; guards have none. It waits this long after a hit, then refills this much a second. */
export const MAX_SHIELD = 70, HEAVY_SHIELD = 80, SHIELD_DELAY = 4, SHIELD_RATE = 35;
/** How far a guard sees, and how far it strays from home chasing you. */
export const SIGHT = 55, LEASH = 45;
/** git revert sends a guard back this many seconds (as far as its trail goes). */
export const TRAIL_EVERY = 0.25, TRAIL_SECONDS = 3;
export const STASH_HP = 150, STASH_TTL = 30, STASHES = 2, BLAME_SECONDS = 20;
/** What a crate gives. */
export const HEALTH_CRATE = 40;
export const AMMO_CRATE: Partial<Record<WeaponId, number>> = { add: 8, fetch: 40, clean: 60, push: 2, merge: 2, rebase: 3, cherry: 2, revert: 1, stash: 1, blame: 2 };
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

const fwd = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

export const bodyHeight = (s: Soldier) => (s.prone ? PRONE_HEIGHT : s.crouch ? CROUCH_HEIGHT : HEIGHT);

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
  /** Where the theirs side comes in: the reachable flat ground farthest from HEAD. */
  private far: { x: number; z: number; yaw: number } | null = null;
  readonly cleared: boolean[];
  /** A file's full size, kept the first time something hits it: its height and lines shrink from there. */
  private wrecks = new Map<Block, { hp: number; maxHp: number; tall: number; lines: number }>();
  private rand: () => number;
  private nextId = 1;
  private acc = 0;
  private trailT = 0;

  constructor(map: CodeMap, seed = 1, mission: Mission = { kind: "clear" }, mode?: Mode) {
    // Files get knocked down: the game's own copies, so the map it was given stays whole.
    this.map = { ...map, blocks: map.blocks.map((b) => ({ ...b })) };
    this.terrain = map.terrain;
    // A battle that isn't side by side is won on downs, not the level's mission.
    this.mode = mode;
    this.mission = mode && mode !== "coop" ? { kind: "clear" } : mission;
    this.rand = mulberry32(seed);
    this.cleared = map.compounds.map(() => false);
    // On your own you're soldier 0; a battle's players join after the guards.
    if (!mode) this.soldiers.push(this.soldier("you", "you", map.spawn.x, map.spawn.z, map.spawn.yaw, -1));
    this.map.compounds.forEach((c, ci) => {
      for (let g = 0; g < c.guards; g++) {
        const a = (g / c.guards) * Math.PI * 2 + this.rand(), d = 2 + this.rand() * 2;
        const s = this.soldier("conflict", `${c.folder} #${g + 1}`, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, this.rand() * 6.28, ci);
        // A squad of two or more: every other guard flanks. A big compound's first guard is its heavy.
        s.brain!.role = g % 2 === 1 ? "flank" : "hold";
        s.brain!.side = g % 4 === 1 ? 1 : -1;
        if (g === 0 && c.guards >= 3) {
          s.heavy = true, s.hp = s.maxHp = HEAVY_HP, s.shield = s.maxShield = HEAVY_SHIELD, s.ammo.push = 4;
          s.name = `${c.folder} heavy`;
        }
        this.soldiers.push(s);
      }
    });
    this.scatterPickups(seed);
    this.objective = this.brief(this.mission);
    if (mode === "teams") this.far = this.farGround(seed);
  }

  static fromRepo(ground: Terrain, repo: RepoSnapshot, seed = 1, mission?: Mission, mode?: Mode): Game {
    return new Game(mapRepo(ground, repo, seed), seed, mission, mode);
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
    const r = mulberry32(seed ^ 0x5eed), { spawn, compounds } = this.map, R = this.terrain.R, canReach = reachable(this.terrain, spawn.x, spawn.z);
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
    return {
      id, team, name, x, y: this.ground(x, z, Infinity), z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0,
      hp: MAX_HP, maxHp: MAX_HP, shield: player ? MAX_SHIELD : 0, maxShield: player ? MAX_SHIELD : 0, shieldT: SHIELD_DELAY, alive: true, heavy: false, weapon: "commit", ammo, cd: 0, roll: 0, rollCd: 0, rollDir: { x: 0, z: 0 },
      grounded: true, crouch: false, prone: false, scoped: false, tagged: 0, heat: 0, burn: 0, burnBy: -1, burnT: 0, trail: [], compound,
      brain: player ? null : {
        home: { x, z }, alert: false, wait: 0, lost: 0, seen: null, strafe: 1, strafeT: 0, burst: 0, think: 0,
        role: "hold", side: 1, cover: null, coverT: 0, lastHp: MAX_HP, raid: false,
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
      inputs = new Map([...inputs].map(([id, i]) => [id, { ...i, jump: false, roll: false, weapon: undefined }]));
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
    this.separate();
    this.fly(dt);
    this.record(dt);
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
      Object.assign(s, { x, z, y: this.ground(x, z, Infinity), vx: 0, vy: 0, vz: 0, yaw, hp: s.maxHp, shield: s.maxShield, shieldT: SHIELD_DELAY, alive: true, roll: 0, cd: 0.5, burn: 0, trail: [] });
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

  private control(s: Soldier, input: Input, dt: number) {
    s.yaw = input.yaw;
    s.pitch = input.pitch;
    s.prone = !!input.prone && s.grounded;
    s.crouch = !s.prone && input.crouch && s.grounded;
    s.scoped = !!input.scope && s.weapon === "rebase";
    if (input.weapon && s.ammo[input.weapon] !== 0) s.weapon = input.weapon;
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
    if (input.jump && s.grounded && s.roll <= 0 && !s.prone) s.vy = JUMP, s.grounded = false;
    if (input.fire) this.fire(s, input.aim);
  }

  /** Steers velocity towards the wished direction; a roll overrides it. */
  private walk(s: Soldier, mx: number, mz: number, dt: number, k = 1) {
    if (s.roll > 0) {
      const v = s.prone ? ROLL_SPEED * 0.45 : ROLL_SPEED;
      s.vx = s.rollDir.x * v, s.vz = s.rollDir.z * v;
      return;
    }
    const top = (s.prone ? PRONE_SPEED : s.crouch ? CROUCH_SPEED : RUN) * k * (s.heavy ? 0.7 : 1), accel = s.grounded ? 60 : 20;
    const tx = mx * top, tz = mz * top;
    const dx = tx - s.vx, dz = tz - s.vz, d = Math.hypot(dx, dz), a = Math.min(d, accel * dt);
    if (d > 0) s.vx += (dx / d) * a, s.vz += (dz / d) * a;
  }

  private move(s: Soldier, dt: number) {
    s.cd = Math.max(0, s.cd - dt);
    s.roll = Math.max(0, s.roll - dt);
    s.rollCd = Math.max(0, s.rollCd - dt);
    s.tagged = Math.max(0, s.tagged - dt);
    s.heat = Math.max(0, s.heat - HEAT_COOL * dt);
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
    if (!s.alive) return;
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

    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    const g = this.ground(s.x, s.z, s.y);
    // A shove (a push round) carries you through the air; on the ground, walk() steers it away.
    // Grounded and going downhill: stick to the slope rather than hop down it.
    if (s.y <= g || (s.grounded && s.vy <= 0 && s.y - g < 0.4)) s.y = g, s.vy = Math.max(0, s.vy), s.grounded = true;
    else if (s.y > g + 0.05) s.grounded = false;
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
        for (const [w, n] of Object.entries(AMMO_CRATE) as [WeaponId, number][]) you.ammo[w] += n;
      } else you.ammo.reset++;
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
    const order = this.map.compounds.map((c, i) => ({ i, d: Math.hypot(c.x - o.x, c.z - o.z) })).filter(({ i }) => !this.cleared[i]).sort((a, b) => a.d - b.d);
    const next = order[0];
    if (!next) return;
    for (const g of this.soldiers) if (g.alive && g.brain && g.compound === next.i && !g.brain.raid) {
      Object.assign(g.brain, { raid: true, alert: true, wait: 0.5, home: { x: o.x, z: o.z }, cover: null, coverT: 0 });
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
    const f = fwd(s.yaw), eye = s.prone ? 0.35 : s.crouch ? 1.0 : 1.4;
    // Held at the right hip, a little ahead: the over-the-shoulder camera sees it go.
    return { x: s.x + f.x * 0.5 - f.z * 0.3, y: s.y + eye, z: s.z + f.z * 0.5 + f.x * 0.3 };
  }

  fire(s: Soldier, aim?: { x: number; y: number; z: number }, extraSpread = 0) {
    if (s.cd > 0 || s.roll > 0) return;
    const w = WEAPONS[s.weapon];
    if (s.ammo[s.weapon] === 0) {
      s.weapon = "commit";
      return;
    }
    const m = this.muzzle(s);
    let dx: number, dy: number, dz: number;
    if (aim) dx = aim.x - m.x, dy = aim.y - m.y, dz = aim.z - m.z;
    else {
      // No crosshair point: along the facing, with the scope's sway on it.
      const sw = s.scoped ? scopeSway(this.time, stanceOf(s)) : { yaw: 0, pitch: 0 };
      const f = fwd(s.yaw + sw.yaw), p = s.pitch + sw.pitch;
      dx = f.x * Math.cos(p), dy = Math.sin(p), dz = f.z * Math.cos(p);
    }
    const d = Math.hypot(dx, dy, dz) || 1;
    // Lying down steadies a rifle; crouching, a little. A held machine gun climbs off target.
    const spread = (w.spread + extraSpread + s.heat) * (s.prone ? 0.3 : s.crouch ? 0.6 : 1);
    for (let i = 0; i < w.pellets; i++) {
      let ux = dx / d + (this.rand() - 0.5) * 2 * spread, uy = dy / d + (this.rand() - 0.5) * 2 * spread, uz = dz / d + (this.rand() - 0.5) * 2 * spread;
      // A lob goes up a little more than you aim, so a grenade clears the crate in front of you.
      if (w.gravity > 5) uy += 0.25;
      const n = Math.hypot(ux, uy, uz);
      ux /= n, uy /= n, uz /= n;
      const shot: Shot = { id: this.nextId++, owner: s.id, team: s.team, weapon: s.weapon, x: m.x, y: m.y, z: m.z, vx: ux * w.speed, vy: uy * w.speed, vz: uz * w.speed, age: 0, dead: false };
      if (w.homing > 0) shot.target = this.pickTarget(s, m, ux, uy, uz);
      this.shots.push(shot);
    }
    s.heat = Math.min(MAX_HEAT, s.heat + w.bloom);
    s.cd = w.cooldown;
    if (s.ammo[s.weapon]! > 0) s.ammo[s.weapon]!--;
    this.events.push({ kind: "fire", id: s.id, weapon: s.weapon });
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
          this.land(p, hit);
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

  /** A body the shot is inside, other than its own side's (and never the shooter's, by a direct hit). */
  private soldierAt(p: Shot): Soldier | null {
    for (const s of this.soldiers) {
      if (!s.alive || !this.hostile(s, { id: p.owner, team: p.team })) continue;
      // Rolling: direct hits pass through.
      if (s.roll > 0) continue;
      if (p.y < s.y || p.y > s.y + bodyHeight(s)) continue;
      if (Math.hypot(p.x - s.x, p.z - s.z) < RADIUS + 0.1) return s;
    }
    return null;
  }

  private land(p: Shot, direct: Soldier | null) {
    p.dead = true;
    const w = WEAPONS[p.weapon];
    if (w.effect === "stash") return this.stash(p.x, p.z, p.y);
    if (w.splash > 0) {
      this.events.push({ kind: "boom", x: p.x, y: p.y, z: p.z, r: w.splash });
      // Every file and stash in the blast loses lines by how near its nearest face is.
      for (const b of [...this.blocks()]) {
        const cx = Math.max(b.x - b.w / 2, Math.min(p.x, b.x + b.w / 2)), cy = Math.max(b.y, Math.min(p.y, b.y + b.h)), cz = Math.max(b.z - b.d / 2, Math.min(p.z, b.z + b.d / 2));
        this.wreck(b, splashDamage(w, Math.hypot(cx - p.x, cy - p.y, cz - p.z)) * w.wreck, p.owner);
      }
      for (const s of this.soldiers) {
        if (!s.alive) continue;
        const own = s.id === p.owner;
        // No friendly fire, but your own blast still hurts you (half), the toy-soldier rule. Except a reset: it only wipes the yard.
        if (own ? w.effect === "reset" : !this.hostile(s, { id: p.owner, team: p.team })) continue;
        const dx = s.x - p.x, dy = s.y + 0.9 - p.y, dz = s.z - p.z, d = Math.hypot(dx, dy, dz);
        const dmg = splashDamage(w, d) * (own ? 0.5 : 1) * (s.roll > 0 ? 0.5 : 1);
        if (dmg <= 0) continue;
        const k = w.knock * (1 - d / w.splash), hd = Math.hypot(dx, dz) || 1;
        s.vx += (dx / hd) * k, s.vz += (dz / hd) * k, s.vy += k * 0.45, s.grounded = false;
        this.hurt(s, dmg, p.owner);
      }
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
      this.hurt(direct, w.damage, p.owner);
    }
  }

  /** Deletes a file's lines: it sinks with what it loses, and with nothing left it's gone. A stash just takes the damage. */
  private wreck(b: Block, damage: number, by: number) {
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
    if (s.brain) Object.assign(s.brain, { alert: false, seen: null, wait: 1.5, cover: null, coverT: 0, burst: 0 });
    this.events.push({ kind: "reverted", id: s.id });
  }

  hurt(s: Soldier, damage: number, by: number) {
    if (!s.alive || this.status !== "playing") return;
    // The shield takes it first; what's left over comes off the HP.
    const soak = Math.min(s.shield, damage);
    s.shieldT = 0, s.shield -= soak;
    if (soak > 0 && s.shield <= 0) this.events.push({ kind: "shield", id: s.id, state: "broke" });
    s.hp -= damage - soak;
    this.events.push({ kind: "hit", target: s.id, by, damage, shield: soak > 0 });
    // A revert's victim has forgotten you; anything else alarms its yard.
    if (s.brain && s.brain.wait < 1) this.alarm(s.compound);
    if (s.hp > 0) return;
    s.alive = false, s.hp = 0;
    this.events.push({ kind: "down", id: s.id, by });
    if (s.brain) return this.checkCleared(s.compound);
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
    Object.assign(s, { x, z, y: this.ground(x, z, Infinity), vx: 0, vy: 0, vz: 0, yaw, hp: s.maxHp, shield: s.maxShield, shieldT: SHIELD_DELAY, alive: true, roll: 0, cd: 0.5 });
    // Guards lose track of you (raiders keep coming).
    for (const g of this.soldiers) if (g.brain && !g.brain.raid) g.brain.alert = false, g.brain.seen = null;
    this.events.push({ kind: "respawn", id: s.id, lives: this.lives });
  }

  private checkCleared(ci: number) {
    if (ci < 0 || this.cleared[ci] || this.soldiers.some((g) => g.compound === ci && g.alive)) return;
    this.cleared[ci] = true;
    // A taken yard leaves its crates behind: health and ammo.
    const c = this.map.compounds[ci]!;
    for (const [kind, dx] of [["health", -1.5], ["ammo", 1.5]] as const) {
      this.pickups.push({ id: this.nextId++, kind, x: c.x + dx, y: this.ground(c.x + dx, c.z, Infinity), z: c.z });
    }
    this.events.push({ kind: "cleared", compound: ci });
    // Every compound taken: the repo is merged, whatever the mission, unless a commit still has to get home.
    // A battle on downs goes on.
    if (this.cleared.every(Boolean) && this.objective.kind !== "carry" && (!this.mode || this.mode === "coop")) this.win();
  }

  private alarm(ci: number) {
    for (const g of this.soldiers) if (g.brain && g.alive && g.compound === ci && !g.brain.alert) {
      g.brain.alert = true, g.brain.wait = 0.3 + this.rand() * 0.4, g.brain.lost = 0;
    }
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
    const eye = s.y + 1.5;
    // Nearest first, so the sight lines (the costly part) stop at the first player in view.
    let you: Soldier | null = null, dYou = Infinity;
    const near = this.soldiers
      .filter((p) => p.alive && !p.brain)
      .map((p) => ({ p, d: Math.hypot(p.x - s.x, p.z - s.z) }))
      .filter(({ p, d }) => d < SIGHT * (p.prone ? 0.4 : p.crouch ? 0.6 : 1))
      .sort((a, b) => a.d - b.d);
    for (const { p, d } of near) if (this.clear(s.x, eye, s.z, p.x, p.y + bodyHeight(p) * 0.67, p.z)) { you = p, dYou = d; break; }
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
        if (!b.alert) this.alarm(s.compound);
        b.seen = seen, b.lost = 0;
      } else b.lost += 0.2;
      if (b.alert && b.lost > 6 && !b.raid) b.alert = false, b.seen = null;
      // Hit: duck behind something.
      if (s.hp < b.lastHp && b.alert && b.seen && !b.cover) this.takeCover(s, 1.2);
      b.lastHp = s.hp;
    }
    if (s.burn > 0) {
      // On fire: it runs about flailing, and doesn't shoot.
      const a = this.time * 2.3 + s.id * 1.7;
      s.crouch = false;
      this.walk(s, Math.sin(a), Math.cos(a * 0.7), dt);
      return;
    }
    let mx = 0, mz = 0;
    const toHome = Math.hypot(b.home.x - s.x, b.home.z - s.z);
    if (!b.alert || (!b.seen && !b.raid)) {
      // On watch: drift about the yard.
      if (toHome > 3) mx = (b.home.x - s.x) / toHome * 0.4, mz = (b.home.z - s.z) / toHome * 0.4;
      s.crouch = false;
      this.walk(s, mx, mz, dt);
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
      // Raiders head for the branch, shooting you if they see you on the way.
      to(b.home.x, b.home.z);
    } else {
      b.cover = null;
      // Keep 12-25 m off, strafing side to side. Flankers swing out round your side first.
      const close = b.lost === 0 ? (d > 25 ? 1 : d < 12 ? -1 : 0) : 1;
      mx = (dx / d) * close + (-dz / d) * b.strafe * 0.7;
      mz = (dz / d) * close + (dx / d) * b.strafe * 0.7;
      if (b.role === "flank" && b.lost === 0) {
        const p = this.flankPoint(s);
        if (Math.hypot(p.x - s.x, p.z - s.z) > 3) to(p.x, p.z);
      }
      if (toHome > LEASH && (mx * (b.home.x - s.x) + mz * (b.home.z - s.z)) < 0) mx = (b.home.x - s.x) / toHome, mz = (b.home.z - s.z) / toHome;
    }
    this.walk(s, mx * 0.8, mz * 0.8, dt);
    if (b.wait > 0 || b.lost > 0 || !b.seen || b.coverT > 0) return;
    // Bursts of commits; a launcher round when the target's far enough off not to catch the blast.
    const aim = b.seen;
    if (s.ammo.push > 0 && d > 12 && s.cd <= 0 && this.rand() < (s.heavy ? 0.03 : 0.01)) s.weapon = "push";
    else if (s.ammo.push === 0 || d <= 12) s.weapon = "commit";
    if (s.cd <= 0) {
      if (b.burst >= (s.heavy ? 9 : 5)) {
        b.burst = 0, s.cd = 0.9 + this.rand() * 0.6;
        // Reloading: half the time, from behind something.
        if (this.rand() < 0.5) this.takeCover(s, s.cd + 0.6);
        return;
      }
      this.fire(s, aim, 0.05 + Math.min(0.05, d / 1000));
      b.burst++;
    }
  }

  private takeCover(s: Soldier, seconds: number) {
    const b = s.brain!;
    if (!b.seen || b.raid) return;
    const c = this.coverFrom(s, b.seen);
    if (c) b.cover = c, b.coverT = seconds;
  }

  /** Where a flanker heads: off to one side of you, square to the line from you to its yard. */
  flankPoint(s: Soldier): { x: number; z: number } {
    const b = s.brain!, t = b.seen ?? b.home;
    const ux = b.home.x - t.x, uz = b.home.z - t.z, u = Math.hypot(ux, uz) || 1;
    return { x: t.x + (-uz / u) * b.side * 15, z: t.z + (ux / u) * b.side * 15 };
  }
}
