// The whole game, with no rendering: a toy-soldier third-person shooter on a codebase.
// You run, strafe, jump and dive-roll (no damage from direct hits mid-roll) round
// a repo's compounds and take each one by downing its guards. Clear them all and
// the level is merged. Go down and you come back from the reflog, three times.
//
// Coordinates as in terrain.ts: x east, z south, y up. Facing: yaw 0 looks
// along -z; forward is (-sin yaw, -cos yaw).

import { mapRepo, mulberry32, type Block, type CodeMap, type RepoSnapshot } from "./codemap.ts";
import { CLIFF, type Terrain } from "./terrain.ts";
import { ORDER, splashDamage, WEAPONS, type WeaponId } from "./weapons.ts";

export type Team = "you" | "conflict";

export interface Brain {
  home: { x: number; z: number };
  alert: boolean;
  /** Seconds until it reacts to what it saw. */
  wait: number;
  /** Seconds since it last saw you. */
  lost: number;
  seen: { x: number; z: number } | null;
  strafe: number;
  strafeT: number;
  burst: number;
  think: number;
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
  alive: boolean;
  weapon: WeaponId;
  ammo: Record<WeaponId, number>;
  cd: number;
  /** Seconds left in a dive-roll, and seconds until the next one. */
  roll: number;
  rollCd: number;
  rollDir: { x: number; z: number };
  grounded: boolean;
  crouch: boolean;
  /** For guards: the compound they hold. */
  compound: number;
  brain: Brain | null;
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
}

export interface Input {
  /** -1..1: strafe right (+) and forward (+). */
  right: number;
  forward: number;
  yaw: number;
  pitch: number;
  jump: boolean;
  roll: boolean;
  crouch: boolean;
  fire: boolean;
  /** What the crosshair is on; shots go from the muzzle to here. Without it, straight along yaw and pitch. */
  aim?: { x: number; y: number; z: number };
  weapon?: WeaponId;
}

export type GameEvent =
  | { kind: "fire"; id: number; weapon: WeaponId }
  | { kind: "hit"; target: number; by: number; damage: number }
  | { kind: "boom"; x: number; y: number; z: number; r: number }
  | { kind: "down"; id: number; by: number }
  | { kind: "respawn"; lives: number }
  | { kind: "cleared"; compound: number }
  | { kind: "won" }
  | { kind: "lost" };

export const RUN = 7.5, CROUCH_SPEED = 3.2, GRAVITY = 26, JUMP = 8.5;
export const ROLL_TIME = 0.42, ROLL_SPEED = 12.5, ROLL_COOLDOWN = 0.6;
export const RADIUS = 0.45, HEIGHT = 1.8, CROUCH_HEIGHT = 1.2, STEP = 0.6;
export const MAX_HP = 100, LIVES = 3;
/** How far a guard sees, and how far it strays from home chasing you. */
export const SIGHT = 55, LEASH = 45;
const TICK = 1 / 120;

const fwd = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

export class Game {
  readonly map: CodeMap;
  readonly terrain: Terrain;
  readonly soldiers: Soldier[] = [];
  shots: Shot[] = [];
  events: GameEvent[] = [];
  time = 0;
  lives = LIVES;
  status: "playing" | "won" | "lost" = "playing";
  readonly cleared: boolean[];
  private rand: () => number;
  private nextShot = 1;
  private acc = 0;

  constructor(map: CodeMap, seed = 1) {
    this.map = map;
    this.terrain = map.terrain;
    this.rand = mulberry32(seed);
    this.cleared = map.compounds.map(() => false);
    this.soldiers.push(this.soldier("you", "you", map.spawn.x, map.spawn.z, map.spawn.yaw, -1));
    map.compounds.forEach((c, ci) => {
      for (let g = 0; g < c.guards; g++) {
        const a = (g / c.guards) * Math.PI * 2 + this.rand(), d = 2 + this.rand() * 2;
        const s = this.soldier("conflict", `${c.folder} #${g + 1}`, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, this.rand() * 6.28, ci);
        // The first guard of a big compound carries a launcher.
        if (g === 0 && c.guards >= 3) s.ammo.push = 3;
        this.soldiers.push(s);
      }
    });
  }

  static fromRepo(ground: Terrain, repo: RepoSnapshot, seed = 1): Game {
    return new Game(mapRepo(ground, repo, seed), seed);
  }

  you(): Soldier { return this.soldiers[0]!; }

  private soldier(team: Team, name: string, x: number, z: number, yaw: number, compound: number): Soldier {
    const ammo = Object.fromEntries(ORDER.map((w) => [w, team === "you" ? WEAPONS[w].ammo : w === "commit" ? -1 : 0])) as Record<WeaponId, number>;
    return {
      id: this.soldiers.length, team, name, x, y: this.ground(x, z, Infinity), z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0,
      hp: MAX_HP, alive: true, weapon: "commit", ammo, cd: 0, roll: 0, rollCd: 0, rollDir: { x: 0, z: 0 }, grounded: true, crouch: false, compound,
      brain: team === "you" ? null : { home: { x, z }, alert: false, wait: 0, lost: 0, seen: null, strafe: 1, strafeT: 0, burst: 0, think: 0 },
    };
  }

  /* ---------------- the world's solids ---------------- */

  /** The highest thing to stand on under (x, z) that a body whose feet are at y can step up onto. */
  ground(x: number, z: number, y: number): number {
    let g = this.terrain.height(x, z);
    for (const b of this.map.blocks) {
      const top = b.y + b.h;
      if (top <= g || top > y + STEP) continue;
      if (Math.abs(x - b.x) < b.w / 2 + RADIUS * 0.5 && Math.abs(z - b.z) < b.d / 2 + RADIUS * 0.5) g = top;
    }
    return g;
  }

  /** The block a point is inside, if any. */
  blockAt(x: number, y: number, z: number): Block | null {
    for (const b of this.map.blocks) {
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

  /** Advances by dt seconds, in fixed ticks. Events since the last call are in this.events. */
  step(dt: number, input: Input): GameEvent[] {
    this.events = [];
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= TICK) {
      this.acc -= TICK;
      this.tick(TICK, input);
      // Edge-triggered inputs act once.
      input = { ...input, jump: false, roll: false, weapon: undefined };
    }
    return this.events;
  }

  private tick(dt: number, input: Input) {
    this.time += dt;
    if (this.status !== "playing") return;
    const you = this.you();
    if (you.alive) this.control(you, input, dt);
    for (const s of this.soldiers) if (s.alive && s.brain) this.think(s, dt);
    for (const s of this.soldiers) if (s.alive) this.move(s, dt);
    this.separate();
    this.fly(dt);
  }

  private control(s: Soldier, input: Input, dt: number) {
    s.yaw = input.yaw;
    s.pitch = input.pitch;
    s.crouch = input.crouch && s.grounded;
    if (input.weapon && s.ammo[input.weapon] !== 0) s.weapon = input.weapon;
    const f = fwd(s.yaw), r = { x: -f.z, z: f.x };
    let mx = f.x * input.forward + r.x * input.right, mz = f.z * input.forward + r.z * input.right;
    const m = Math.hypot(mx, mz);
    if (m > 1) mx /= m, mz /= m;
    if (input.roll && s.grounded && s.roll <= 0 && s.rollCd <= 0) {
      // Dive the way you're moving, or forward when standing still.
      const dir = m > 0.1 ? { x: mx / Math.max(m, 1e-6), z: mz / Math.max(m, 1e-6) } : f;
      s.roll = ROLL_TIME, s.rollCd = ROLL_TIME + ROLL_COOLDOWN, s.rollDir = dir;
    }
    this.walk(s, mx, mz, dt, input.forward < 0 ? 0.75 : 1);
    if (input.jump && s.grounded && s.roll <= 0) s.vy = JUMP, s.grounded = false;
    if (input.fire) this.fire(s, input.aim);
  }

  /** Steers velocity towards the wished direction; a roll overrides it. */
  private walk(s: Soldier, mx: number, mz: number, dt: number, k = 1) {
    if (s.roll > 0) {
      s.vx = s.rollDir.x * ROLL_SPEED, s.vz = s.rollDir.z * ROLL_SPEED;
      return;
    }
    const top = (s.crouch ? CROUCH_SPEED : RUN) * k, accel = s.grounded ? 60 : 20;
    const tx = mx * top, tz = mz * top;
    const dx = tx - s.vx, dz = tz - s.vz, d = Math.hypot(dx, dz), a = Math.min(d, accel * dt);
    if (d > 0) s.vx += (dx / d) * a, s.vz += (dz / d) * a;
  }

  private move(s: Soldier, dt: number) {
    s.cd = Math.max(0, s.cd - dt);
    s.roll = Math.max(0, s.roll - dt);
    s.rollCd = Math.max(0, s.rollCd - dt);
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
    const h = s.crouch ? CROUCH_HEIGHT : HEIGHT;
    for (const b of this.map.blocks) {
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

  /* ---------------- shooting ---------------- */

  muzzle(s: Soldier) {
    const f = fwd(s.yaw), eye = s.crouch ? 1.0 : 1.4;
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
      const f = fwd(s.yaw);
      dx = f.x * Math.cos(s.pitch), dy = Math.sin(s.pitch), dz = f.z * Math.cos(s.pitch);
    }
    const d = Math.hypot(dx, dy, dz) || 1;
    const spread = w.spread + extraSpread;
    dx = dx / d + (this.rand() - 0.5) * 2 * spread, dy = dy / d + (this.rand() - 0.5) * 2 * spread, dz = dz / d + (this.rand() - 0.5) * 2 * spread;
    // A lob goes up a little more than you aim, so a grenade clears the crate in front of you.
    if (w.gravity > 5) dy += 0.25;
    const n = Math.hypot(dx, dy, dz);
    this.shots.push({ id: this.nextShot++, owner: s.id, team: s.team, weapon: s.weapon, x: m.x, y: m.y, z: m.z, vx: (dx / n) * w.speed, vy: (dy / n) * w.speed, vz: (dz / n) * w.speed, age: 0, dead: false });
    s.cd = w.cooldown;
    if (s.ammo[s.weapon]! > 0) s.ammo[s.weapon]!--;
    this.events.push({ kind: "fire", id: s.id, weapon: s.weapon });
  }

  private fly(dt: number) {
    for (const p of this.shots) {
      const w = WEAPONS[p.weapon];
      p.age += dt;
      p.vy -= w.gravity * dt;
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
          if (w.impact) this.land(p, null);
          else {
            // Bounce: back out, lose most of the speed, flip the way it came in.
            p.x = ox, p.y = oy, p.z = oz;
            if (b) p.vx *= -0.4, p.vz *= -0.4, p.vy *= 0.5;
            else p.vy = Math.abs(p.vy) * 0.35, p.vx *= 0.55, p.vz *= 0.55;
            break;
          }
        }
      }
      if (!p.dead && (p.age >= w.life || Math.hypot(p.x, p.z) > this.terrain.R + 20)) {
        if (w.splash > 0) this.land(p, null);
        else p.dead = true;
      }
    }
    this.shots = this.shots.filter((p) => !p.dead);
  }

  /** A body the shot is inside, other than its own side's (and never the shooter's, by a direct hit). */
  private soldierAt(p: Shot): Soldier | null {
    for (const s of this.soldiers) {
      if (!s.alive || s.team === p.team) continue;
      // Rolling: direct hits pass through.
      if (s.roll > 0) continue;
      const h = s.crouch ? CROUCH_HEIGHT : HEIGHT;
      if (p.y < s.y || p.y > s.y + h) continue;
      if (Math.hypot(p.x - s.x, p.z - s.z) < RADIUS + 0.1) return s;
    }
    return null;
  }

  private land(p: Shot, direct: Soldier | null) {
    p.dead = true;
    const w = WEAPONS[p.weapon];
    if (w.splash > 0) {
      this.events.push({ kind: "boom", x: p.x, y: p.y, z: p.z, r: w.splash });
      for (const s of this.soldiers) {
        if (!s.alive) continue;
        const own = s.id === p.owner;
        // No friendly fire, but your own blast still hurts you (half), the toy-soldier rule.
        if (s.team === p.team && !own) continue;
        const dx = s.x - p.x, dy = s.y + 0.9 - p.y, dz = s.z - p.z, d = Math.hypot(dx, dy, dz);
        const dmg = splashDamage(w, d) * (own ? 0.5 : 1) * (s.roll > 0 ? 0.5 : 1);
        if (dmg <= 0) continue;
        const k = w.knock * (1 - d / w.splash), hd = Math.hypot(dx, dz) || 1;
        s.vx += (dx / hd) * k, s.vz += (dz / hd) * k, s.vy += k * 0.45, s.grounded = false;
        this.hurt(s, dmg, p.owner);
      }
    } else if (direct) {
      const v = Math.hypot(p.vx, p.vz) || 1;
      direct.vx += (p.vx / v) * w.knock, direct.vz += (p.vz / v) * w.knock;
      this.hurt(direct, w.damage, p.owner);
    }
  }

  hurt(s: Soldier, damage: number, by: number) {
    if (!s.alive || this.status !== "playing") return;
    s.hp -= damage;
    this.events.push({ kind: "hit", target: s.id, by, damage });
    if (s.brain) this.alarm(s.compound);
    if (s.hp > 0) return;
    s.alive = false, s.hp = 0;
    this.events.push({ kind: "down", id: s.id, by });
    if (s.team === "you") return this.respawn(s);
    this.checkCleared(s.compound);
  }

  private respawn(s: Soldier) {
    this.lives--;
    if (this.lives < 0) {
      this.lives = 0, this.status = "lost";
      this.events.push({ kind: "lost" });
      return;
    }
    const { x, z, yaw } = this.map.spawn;
    Object.assign(s, { x, z, y: this.ground(x, z, Infinity), vx: 0, vy: 0, vz: 0, yaw, hp: MAX_HP, alive: true, roll: 0, cd: 0.5 });
    // Guards lose track of you.
    for (const g of this.soldiers) if (g.brain) g.brain.alert = false, g.brain.seen = null;
    this.events.push({ kind: "respawn", lives: this.lives });
  }

  private checkCleared(ci: number) {
    if (this.cleared[ci] || this.soldiers.some((g) => g.compound === ci && g.alive)) return;
    this.cleared[ci] = true;
    // Taking a compound resupplies you, like a crate in the yard.
    const you = this.you();
    you.hp = Math.min(MAX_HP, you.hp + 40);
    you.ammo.push += 2, you.ammo.merge += 2, you.ammo.rebase += 3;
    this.events.push({ kind: "cleared", compound: ci });
    if (this.cleared.every(Boolean)) {
      this.status = "won";
      this.events.push({ kind: "won" });
    }
  }

  private alarm(ci: number) {
    for (const g of this.soldiers) if (g.brain && g.alive && g.compound === ci && !g.brain.alert) {
      g.brain.alert = true, g.brain.wait = 0.3 + this.rand() * 0.4, g.brain.lost = 0;
    }
  }

  /* ---------------- guards ---------------- */

  private think(s: Soldier, dt: number) {
    const b = s.brain!, you = this.you();
    b.think -= dt;
    if (b.think <= 0) {
      b.think = 0.2;
      const d = Math.hypot(you.x - s.x, you.z - s.z);
      const sees = you.alive && d < SIGHT * (you.crouch ? 0.6 : 1) && this.clear(s.x, s.y + 1.5, s.z, you.x, you.y + 1.2, you.z);
      if (sees) {
        if (!b.alert) this.alarm(s.compound);
        b.seen = { x: you.x, z: you.z }, b.lost = 0;
      } else b.lost += 0.2;
      if (b.alert && b.lost > 6) b.alert = false, b.seen = null;
    }
    let mx = 0, mz = 0;
    const toHome = Math.hypot(b.home.x - s.x, b.home.z - s.z);
    if (!b.alert || !b.seen) {
      // On watch: drift about the yard.
      if (toHome > 3) mx = (b.home.x - s.x) / toHome * 0.4, mz = (b.home.z - s.z) / toHome * 0.4;
      s.crouch = false;
      this.walk(s, mx, mz, dt);
      return;
    }
    b.wait -= dt;
    const dx = b.seen.x - s.x, dz = b.seen.z - s.z, d = Math.hypot(dx, dz) || 1;
    s.yaw = yawTo(dx, dz);
    // Keep 12-25 m off, strafing side to side; never stray past the leash.
    const close = b.lost === 0 ? (d > 25 ? 1 : d < 12 ? -1 : 0) : 1;
    b.strafeT -= dt;
    if (b.strafeT <= 0) b.strafe = this.rand() < 0.5 ? -1 : 1, b.strafeT = 0.8 + this.rand() * 1.4;
    mx = (dx / d) * close + (-dz / d) * b.strafe * 0.7;
    mz = (dz / d) * close + (dx / d) * b.strafe * 0.7;
    if (toHome > LEASH && (mx * (b.home.x - s.x) + mz * (b.home.z - s.z)) < 0) mx = (b.home.x - s.x) / toHome, mz = (b.home.z - s.z) / toHome;
    this.walk(s, mx * 0.8, mz * 0.8, dt);
    if (b.wait > 0 || b.lost > 0 || !you.alive) return;
    // Bursts of commits; a launcher round when you're far enough off not to catch the blast.
    const aim = { x: you.x, y: you.y + 1.1, z: you.z };
    if (s.ammo.push > 0 && d > 12 && s.cd <= 0 && this.rand() < 0.01) s.weapon = "push";
    else if (s.ammo.push === 0 || d <= 12) s.weapon = "commit";
    if (s.cd <= 0) {
      if (b.burst >= 5) {
        b.burst = 0, s.cd = 0.9 + this.rand() * 0.6;
        return;
      }
      this.fire(s, aim, 0.05 + Math.min(0.05, d / 1000));
      b.burst++;
    }
  }
}
