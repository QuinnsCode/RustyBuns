// The hero ground battle as a pure, fixed-step simulation: command posts and scenery laid out by
// the sector being fought over, AI troopers of four classes and the vehicles each side brought,
// the defender's turrets, orbital strikes and drop-pod reinforcements from the spec. Trunks,
// buildings and rock block movement and sight, and give cover to whoever stands behind them.
// The view draws it and feeds the hero's input; the tests run it headless with the autopilot.
import { atan2, cos, hypot, sin } from "./fmath.ts";
import { VEHICLE_KINDS, other, poolSize, type BattleResult, type BattleSpec, type PerSide, type SectorKind, type Side, type VehicleKind } from "./contract.ts";

export type Trooper = "assault" | "heavy" | "sniper" | "engineer";
export const TROOPERS: Trooper[] = ["assault", "heavy", "sniper", "engineer"];
export type UnitKind = Trooper | VehicleKind | "wooka" | "turret" | "hero";
export interface Unit {
  id: number; side: Side; kind: UnitKind; x: number; z: number; yaw: number; hp: number; maxHp: number; cool: number; jx: number; jz: number; guard?: boolean;
  target?: number; look?: number; // who it's shooting at, and when it next looks round for someone better
  detour?: number; detourT?: number; // the way round a wall it's taking, and for how much longer
}
export interface Post { name: string; x: number; z: number; owner: Side | null; progress: number } // progress: +1 attacker, -1 defender
export interface Strike { side: Side; x: number; z: number; t: number }
export interface Fx { kind: "shot" | "blast"; x: number; z: number; tx: number; tz: number; t: number; y?: number; ty?: number }

// What the player does this step. Movement is relative to where the hero faces.
export interface Input { forward: number; right: number; yaw: number; fire: boolean; strike?: { x: number; z: number }; use?: boolean }

export interface Tree { x: number; z: number; r: number }
// A building, wall or rock: centred on x, z, w wide (along x), d deep (along z) and h high.
// Anything at eye height or more blocks sight; anything lower is a wall to crouch behind.
export interface Block { x: number; z: number; w: number; d: number; h: number }

export interface Battle {
  spec: BattleSpec;
  trees: Tree[];           // trunks: nobody walks or shoots through them
  blocks: Block[];         // buildings, walls and rock, the same
  time: number;
  tickets: PerSide<number>;
  posts: Post[];
  units: Unit[];
  strikes: Strike[];
  strikesLeft: PerSide<number>;
  vehiclesLeft: PerSide<Record<VehicleKind, number>>;
  reinforced: PerSide<boolean>;
  hero: { id: number | null; lives: number; respawn: number; inVehicle: number | null };
  fx: Fx[];
  events: string[]; // for the HUD feed, newest last
  over: BattleResult | null;
  seed: number;
  nextId: number;
  aiStrikeAt: PerSide<number>;
  spawnAt: PerSide<number>;
}

export const DT = 1 / 30;
export const HALF = 120;           // the plain runs -HALF..HALF on x and z
export const TIME_LIMIT = 600;
export const SPAWN: PerSide<{ x: number; z: number }> = { attacker: { x: 0, z: 100 }, defender: { x: 10, z: -100 } };
export const POST_RADIUS = 12;

// Each kind of sector is its own map. The last post is the defender's keep: it starts theirs,
// and their turrets ring it. `scenery` below lays out what stands on it; the view draws that.
export const LAYOUTS: Record<SectorKind, { name: string; posts: { name: string; x: number; z: number }[] }> = {
  shield: { name: "Shield generator clearing", posts: [{ name: "Old stump", x: -40, z: 20 }, { name: "Generator", x: 30, z: -50 }] },
  capital: { name: "Capital city", posts: [{ name: "Transit hub", x: 45, z: 25 }, { name: "Market square", x: -35, z: -5 }, { name: "Palace", x: 5, z: -60 }] },
  spaceport: { name: "Spaceport", posts: [{ name: "Landing pads", x: -30, z: 5 }, { name: "Control tower", x: 35, z: -55 }] },
  cannon: { name: "Cannon battery", posts: [{ name: "Ammo depot", x: 40, z: 10 }, { name: "Cannon", x: -25, z: -55 }] },
  canyon: { name: "Mining canyon", posts: [{ name: "Ore crusher", x: -20, z: 30 }, { name: "Mine head", x: 15, z: -55 }] },
  jungle: { name: "Jungle temple", posts: [{ name: "Fallen idol", x: 35, z: 20 }, { name: "Rope bridge", x: -35, z: -10 }, { name: "Sunken temple", x: 0, z: -60 }] },
};
// The trees on each map: the redwood forest, a dense jungle of thinner trunks, none in the canyon.
const REDWOODS = { n: 110, r: [1.2, 3.4], gap: 5, clear: 26 } as const;
const WOODS: Record<SectorKind, { n: number; r: readonly [number, number]; gap: number; clear: number }> = {
  shield: REDWOODS, capital: REDWOODS, spaceport: REDWOODS, cannon: REDWOODS,
  jungle: { n: 230, r: [0.6, 1.6], gap: 2.5, clear: 18 },
  canyon: { n: 0, r: [0, 0], gap: 0, clear: 0 },
};
export const EYE = 1.6;            // blocks this high or more block sight
const COVER = 2.5;                 // this close to an obstacle between you and the shooter, you're in cover
const LOOK_EVERY = 0.5;            // seconds between an AI unit picking its target
const REPAIR = 30;                 // hp a second an engineer puts back into a vehicle or turret
const DETOUR = 1.5;                // seconds an AI unit keeps going round a wall before trying straight on again
const GUNSHIP_ALT = 12;            // gunships fly over everything: nothing blocks them or their shots
export const STRIKE_RADIUS = 10;
const STRIKE_DELAY = 2.5;
const WAVE_EVERY = 8;              // seconds between reinforcement waves
const BLEED_EVERY = 4;             // seconds per ticket the side with fewer posts loses
const HERO_LIVES = 3;
const AGGRO = 35;                  // how far a Wooka will charge at someone it can smell
const FLAVOR_EVERY = 35;

// What the Marines' radio says about the Wooka. They are not cuddly.
export const FLAVOR = [
  "Something in the ferns is humming.",
  "Command reminds you: they are not cuddly. Do not attempt to cuddle.",
  "Look at those eyes. There's nothing behind them. Nothing.",
  "That club has a nail in it. On purpose.",
  "Intel called them basically harmless. Intel has stopped answering.",
  "Private Okafor swears one of them waved. Then it ate his radio.",
  "The forest has gone quiet. It is never quiet.",
  "Do not feed them. Do not make eye contact. Keep them off the backpacks.",
  "They've started singing. Nobody likes it when they sing.",
  "We came to hunt them. Somewhere along the way it went the other way round.",
  "Found Sergeant Vance's helmet. On a pole. Facing us.",
  "Two eyes in the ferns. Then six. Then none, which is worse.",
  "Whatever you do, don't run. They like it when you run.",
];

export const STATS: Record<UnitKind, { hp: number; speed: number; range: number; cool: number; dmg: number; aim: number; cost: number }> = {
  assault: { hp: 100, speed: 5.5, range: 42, cool: 0.8, dmg: 7, aim: 0.7, cost: 1 },
  heavy: { hp: 140, speed: 4, range: 50, cool: 2.4, dmg: 20, aim: 0.65, cost: 1.5 }, // rockets: ARMOUR_BANE times as hard on armour
  sniper: { hp: 80, speed: 4.5, range: 90, cool: 2.5, dmg: 40, aim: 0.9, cost: 1.5 },
  engineer: { hp: 100, speed: 5, range: 30, cool: 1, dmg: 5, aim: 0.65, cost: 1 },  // mends vehicles and turrets
  // Small, fast, and only dangerous up close. Their clubs are built to maim, not to kill.
  wooka: { hp: 70, speed: 6.5, range: 2.6, cool: 0.8, dmg: 16, aim: 0.85, cost: 0.5 },
  tank: { hp: 600, speed: 7, range: 60, cool: 2.2, dmg: 45, aim: 0.8, cost: 5 },
  walker: { hp: 900, speed: 3.5, range: 70, cool: 3, dmg: 60, aim: 0.75, cost: 7 },
  speeder: { hp: 180, speed: 15, range: 35, cool: 0.35, dmg: 6, aim: 0.6, cost: 2 },
  gunship: { hp: 450, speed: 10, range: 65, cool: 1.6, dmg: 28, aim: 0.8, cost: 6 },
  turret: { hp: 350, speed: 0, range: 55, cool: 1.2, dmg: 10, aim: 0.75, cost: 0 },
  hero: { hp: 300, speed: 8, range: 55, cool: 0.3, dmg: 9, aim: 0.9, cost: 3 },
};
// The big guns throw a blast this wide instead of hitting one target.
const SPLASH: Partial<Record<UnitKind, number>> = { tank: 4, walker: 5, gunship: 3 };
const ARMOUR_BANE = 4;
// Each wave's Marines come in this mix of classes.
export const CLASS_MIX: Record<Trooper, number> = { assault: 0.5, heavy: 0.2, sniper: 0.15, engineer: 0.15 };
export const isVehicle = (k: UnitKind): k is VehicleKind => (VEHICLE_KINDS as UnitKind[]).includes(k);
const isTrooper = (k: UnitKind): k is Trooper => (TROOPERS as UnitKind[]).includes(k);
const armoured = (k: UnitKind) => isVehicle(k) || k === "turret";
export const flies = (u: { kind: UnitKind }) => u.kind === "gunship";
export const altitude = (u: { kind: UnitKind }) => (flies(u) ? GUNSHIP_ALT : 0);
const bodyOf = (k: UnitKind) => (k === "tank" ? 2.5 : k === "walker" ? 2.2 : k === "speeder" ? 1.4 : 0.6);

const rand = (b: Battle) => {
  let t = (b.seed = (b.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => hypot(a.x - b.x, a.z - b.z);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// yaw 0 faces -z, towards the defender's end of the plain, like a three.js camera.
export const facing = (yaw: number) => ({ x: -sin(yaw), z: -cos(yaw) });
export const yawTo = (from: { x: number; z: number }, to: { x: number; z: number }) => atan2(-(to.x - from.x), -(to.z - from.z));

export function startBattle(spec: BattleSpec): Battle {
  const pool = (s: Side) => Object.fromEntries(VEHICLE_KINDS.map((k) => [k, spec.vehicles[s][k] ?? 0])) as Record<VehicleKind, number>;
  const b: Battle = {
    spec, time: 0, trees: [], blocks: [],
    tickets: { ...spec.tickets },
    posts: LAYOUTS[spec.sector].posts.map((p, i, all) => (i === all.length - 1 ? { ...p, owner: "defender", progress: -1 } : { ...p, owner: null, progress: 0 })),
    units: [], strikes: [], fx: [], events: [],
    strikesLeft: { ...spec.strikes },
    vehiclesLeft: { attacker: pool("attacker"), defender: pool("defender") },
    reinforced: { attacker: false, defender: false },
    hero: { id: null, lives: HERO_LIVES, respawn: 0, inVehicle: null },
    over: null, seed: spec.seed >>> 0, nextId: 1,
    aiStrikeAt: { attacker: 20, defender: 25 },
    spawnAt: { attacker: 0, defender: 0 },
  };
  const gen = b.posts.at(-1)!;
  for (let i = 0; i < spec.turrets; i++) {
    const a = (i / Math.max(1, spec.turrets)) * Math.PI * 2 + 0.6;
    add(b, "defender", "turret", gen.x + cos(a) * 18, gen.z + sin(a) * 18);
  }
  scenery(b);
  // The woods: trees everywhere except on the posts, the spawns, the keep's ring and the scenery.
  const w = WOODS[spec.sector], clear = [...b.posts, SPAWN.attacker, SPAWN.defender];
  for (let tries = 0; b.trees.length < w.n && tries < w.n * 20; tries++) {
    const t = { x: (rand(b) - 0.5) * HALF * 2, z: (rand(b) - 0.5) * HALF * 2, r: w.r[0] + rand(b) * (w.r[1] - w.r[0]) };
    if (clear.some((c) => dist(c, t) < w.clear) || b.trees.some((o) => dist(o, t) < o.r + t.r + w.gap) || b.blocks.some((k) => gap(k, t) < t.r + 3)) continue;
    b.trees.push(t);
  }
  spawnHero(b);
  return b;
}

// The nearest point on a block's footprint to p, and how far p is from it (0 inside).
const nearestOn = (k: Block, p: { x: number; z: number }) => ({ x: clamp(p.x, k.x - k.w / 2, k.x + k.w / 2), z: clamp(p.z, k.z - k.d / 2, k.z + k.d / 2) });
const gap = (k: Block, p: { x: number; z: number }) => dist(nearestOn(k, p), p);

// What stands on each map: its landmark by the keep, buildings or rock that block sight, and
// low walls to fight from. Random pieces keep off the posts, the spawns, the turrets and the
// lane down the middle, so the scenery never walls a side in.
function scenery(b: Battle) {
  const keep = b.posts.at(-1)!, put = (x: number, z: number, w: number, d: number, h: number) => b.blocks.push({ x, z, w, d, h });
  const scatter = (n: number, size: [number, number], h: [number, number], room: number, lane = 18) => {
    for (let placed = 0, tries = 0; placed < n && tries < n * 30; tries++) {
      const k = { x: (rand(b) - 0.5) * HALF * 1.9, z: (rand(b) - 0.5) * HALF * 1.9, w: size[0] + rand(b) * (size[1] - size[0]), d: size[0] + rand(b) * (size[1] - size[0]), h: h[0] + rand(b) * (h[1] - h[0]) };
      if (Math.abs(k.x) < lane + k.w / 2) continue;
      if (b.posts.some((p) => gap(k, p) < room) || [SPAWN.attacker, SPAWN.defender].some((p) => gap(k, p) < 14)) continue;
      if (b.units.some((u) => gap(k, u) < 4) || b.blocks.some((o) => dist(o, k) < Math.max(o.w, o.d) / 2 + Math.max(k.w, k.d) / 2 + 3)) continue;
      b.blocks.push(k);
      placed++;
    }
  };
  const walls = (n: number) => scatter(n, [1.2, 7], [1.1, 1.3], 4, 4); // low: cover, but you see over them
  switch (b.spec.sector) {
    case "shield":
      put(keep.x - 6, keep.z - 6, 7, 7, 9); // the generator's core
      walls(10);
      break;
    case "capital":
      put(keep.x, keep.z - 18, 22, 10, 12); // the palace
      scatter(40, [6, 14], [6, 28], POST_RADIUS + 10);
      walls(10);
      break;
    case "spaceport":
      put(keep.x + 10, keep.z - 10, 5, 5, 22); // the control tower
      scatter(14, [3, 4], [2.5, 3.5], POST_RADIUS + 4); // cargo crates
      walls(6);
      break;
    case "cannon":
      put(keep.x - 12, keep.z - 28, 16, 16, 6); // the cannon's base
      walls(14);
      break;
    case "canyon":
      // Rock walls down both sides, winding, then boulders and ore carts on the canyon floor.
      for (let z = -HALF; z < HALF; z += 16) {
        const l = -62 + 14 * sin(z / 23), r = 60 + 14 * sin(z / 31 + 1);
        put((l - HALF) / 2, z + 8, l + HALF, 16, 30);
        put((r + HALF) / 2, z + 8, HALF - r, 16, 30);
      }
      put(keep.x + 12, keep.z - 16, 10, 6, 8); // the mine head's rig
      scatter(14, [4, 9], [4, 10], POST_RADIUS + 6, 10);
      walls(10);
      break;
    case "jungle":
      put(keep.x, keep.z - 22, 20, 14, 12); // the temple
      scatter(6, [3, 6], [3, 6], POST_RADIUS + 6); // broken statues
      walls(16);
      break;
  }
}

// How far along the line from a to c it first hits a trunk, or a block at eye height or more,
// as a fraction of the way (1 if nothing is in the way).
export function blocked(b: Battle, a: { x: number; z: number }, c: { x: number; z: number }) {
  const dx = c.x - a.x, dz = c.z - a.z;
  const lo = { x: Math.min(a.x, c.x), z: Math.min(a.z, c.z) }, hi = { x: Math.max(a.x, c.x), z: Math.max(a.z, c.z) };
  let first = 1;
  for (const t of b.trees) {
    if (t.x + t.r < lo.x || t.x - t.r > hi.x || t.z + t.r < lo.z || t.z - t.r > hi.z) continue;
    const fx = a.x - t.x, fz = a.z - t.z, A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), C = fx * fx + fz * fz - t.r * t.r;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || A === 0) continue;
    const s = (-B - Math.sqrt(disc)) / (2 * A);
    if (s >= 0 && s < first) first = s;
  }
  for (const k of b.blocks) {
    if (k.h < EYE || k.x + k.w / 2 < lo.x || k.x - k.w / 2 > hi.x || k.z + k.d / 2 < lo.z || k.z - k.d / 2 > hi.z) continue;
    let t0 = 0, t1 = first;
    for (const [p, d, min, max] of [[a.x, dx, k.x - k.w / 2, k.x + k.w / 2], [a.z, dz, k.z - k.d / 2, k.z + k.d / 2]] as const) {
      if (Math.abs(d) < 1e-9) { if (p < min || p > max) t0 = Infinity; continue; }
      const u = (min - p) / d, v = (max - p) / d;
      t0 = Math.max(t0, Math.min(u, v)); t1 = Math.min(t1, Math.max(u, v));
    }
    if (t0 <= t1 && t0 < first) first = t0;
  }
  return first;
}

// Gunships see and are seen over everything.
export const sees = (b: Battle, a: Unit, c: Unit) => flies(a) || flies(c) || blocked(b, a, c) >= 1;

// In cover: an obstacle within arm's reach of the target, on the shooter's side of it.
export function inCover(b: Battle, from: Unit, t: Unit) {
  if (flies(from) || flies(t)) return false;
  const toward = (p: { x: number; z: number }) => (p.x - t.x) * (from.x - t.x) + (p.z - t.z) * (from.z - t.z) > 0;
  return b.trees.some((o) => dist(o, t) - o.r < COVER && toward(o)) || b.blocks.some((k) => gap(k, t) < COVER && toward(nearestOn(k, t)));
}

// Cover halves the odds of a hit.
export const hitChance = (b: Battle, u: Unit, t: Unit) => {
  const s = STATS[u.kind];
  return clamp(s.aim - (dist(u, t) / s.range) * 0.35, 0.1, 0.95) * (inCover(b, u, t) ? 0.5 : 1);
};

function add(b: Battle, side: Side, kind: UnitKind, x: number, z: number): Unit {
  const hp = kind === "hero" ? Math.round(STATS.hero.hp * (1 + 0.15 * (b.spec.heroLevel - 1))) : STATS[kind].hp;
  const u: Unit = { id: b.nextId++, side, kind, x, z, yaw: side === "attacker" ? 0 : Math.PI, hp, maxHp: hp, cool: rand(b) * STATS[kind].cool, jx: (rand(b) - 0.5) * 16, jz: (rand(b) - 0.5) * 16, guard: (isTrooper(kind) || kind === "wooka") && rand(b) < 1 / 3 };
  b.units.push(u);
  if (kind !== "turret") unstick(b, u);
  return u;
}

// Fresh troops come in at the spawn, or at a held post nearer the fight that isn't under attack.
function spawnPoint(b: Battle, side: Side) {
  const held = b.posts.filter((p) => p.owner === side && !b.units.some((u) => u.side !== side && u.kind !== "turret" && dist(u, p) < 30));
  const home = SPAWN[side], foe = SPAWN[other(side)];
  const p = held.sort((a, c) => dist(a, foe) - dist(c, foe))[0];
  const base = p && dist(p, foe) < dist(home, foe) ? { x: p.x, z: p.z + (side === "attacker" ? 8 : -8) } : home;
  return { x: base.x + (rand(b) - 0.5) * 12, z: base.z + (rand(b) - 0.5) * 6 };
}

function spawnHero(b: Battle) {
  const p = spawnPoint(b, b.spec.hero);
  b.hero.id = add(b, b.spec.hero, "hero", p.x, p.z).id;
}

// Marines field troopers of four classes and the vehicles they brought. The Wooka field a
// horde: more of them, and no vehicles, so their share of the pool comes as yet more Wooka.
export const isHorde = (b: Battle, side: Side) => b.spec.factions[side] === "wooka";
const troopCap = (b: Battle, side: Side) =>
  isHorde(b, side) ? Math.min(24, 6 + b.spec.armies[side] * 5 + poolSize(b.spec.vehicles[side]) * 3) : Math.min(14, 4 + b.spec.armies[side] * 3);
// The class the side is furthest short of, against the mix.
function nextClass(b: Battle, side: Side): Trooper {
  const n = { assault: 0, heavy: 0, sniper: 0, engineer: 0 };
  for (const u of b.units) if (u.side === side && isTrooper(u.kind)) n[u.kind]++;
  const total = TROOPERS.reduce((t, k) => t + n[k], 0) + 1, short = (k: Trooper) => CLASS_MIX[k] * total - n[k];
  return TROOPERS.reduce((best, k) => (short(k) > short(best) ? k : best));
}
export const heroUnit = (b: Battle) => b.units.find((u) => u.id === b.hero.id) ?? null;
const heroVehicle = (b: Battle) => (b.hero.inVehicle === null ? null : b.units.find((u) => u.id === b.hero.inVehicle) ?? null);
const hidden = (b: Battle, v: Unit) => v.kind === "hero" && b.hero.inVehicle !== null; // the hero, inside a vehicle

function nearestEnemy(b: Battle, u: { x: number; z: number; side: Side }, range: number) {
  let best: Unit | null = null, bd = range;
  for (const v of b.units) {
    if (v.side === u.side || v.hp <= 0 || hidden(b, v)) continue;
    const d = dist(u, v);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

// The nearest enemy in range that the unit can see.
function nearestSeen(b: Battle, u: Unit, range: number) {
  const near = b.units.filter((v) => v.side !== u.side && v.hp > 0 && !hidden(b, v) && dist(u, v) < range).sort((a, c) => dist(u, a) - dist(u, c));
  return near.find((v) => sees(b, u, v)) ?? null;
}

function shoot(b: Battle, u: Unit, t: Unit | null, yaw = u.yaw) {
  const s = STATS[u.kind];
  u.cool = s.cool;
  if (!t) {
    // A shot at nothing stops at the first wall or trunk.
    const f = facing(yaw), end = { x: u.x + f.x * s.range, z: u.z + f.z * s.range };
    const k = flies(u) ? 1 : blocked(b, u, end);
    b.fx.push({ kind: "shot", x: u.x, z: u.z, tx: u.x + (end.x - u.x) * k, tz: u.z + (end.z - u.z) * k, t: 0.08, y: altitude(u) });
    return;
  }
  u.yaw = yawTo(u, t);
  const hit = rand(b) < hitChance(b, u, t);
  b.fx.push({ kind: "shot", x: u.x, z: u.z, tx: t.x + (hit ? 0 : (rand(b) - 0.5) * 6), tz: t.z + (hit ? 0 : (rand(b) - 0.5) * 6), t: 0.08, y: altitude(u), ty: altitude(t) });
  if (!hit) return;
  const splash = SPLASH[u.kind];
  if (splash) blast(b, u.side, t.x, t.z, splash, s.dmg);
  else damage(b, t, u.kind === "heavy" && armoured(t.kind) ? s.dmg * ARMOUR_BANE : s.dmg);
}

function blast(b: Battle, side: Side, x: number, z: number, r: number, dmg: number) {
  b.fx.push({ kind: "blast", x, z, tx: x, tz: z, t: r > 6 ? 0.6 : 0.25 });
  for (const v of b.units) if (v.side !== side && v.hp > 0 && dist(v, { x, z }) <= r) damage(b, v, dmg);
}

function damage(b: Battle, v: Unit, dmg: number) {
  if (hidden(b, v)) return;
  v.hp -= dmg;
}

// The side the player isn't on, and the player's own squadmates, think for themselves. Every so
// often each looks round for the nearest enemy it can see, and shoots at that till it's gone.
function think(b: Battle, u: Unit) {
  const s = STATS[u.kind];
  u.cool -= DT;
  if ((u.look = (u.look ?? 0) - DT) <= 0) {
    u.look = LOOK_EVERY;
    u.target = nearestSeen(b, u, s.range)?.id;
  }
  let foe = u.target === undefined ? null : b.units.find((v) => v.id === u.target && v.hp > 0 && !hidden(b, v)) ?? null;
  if (foe && dist(u, foe) > s.range) foe = null;
  if (foe && u.cool <= 0) shoot(b, u, foe);
  if (!s.speed) return;
  if (foe && dist(u, foe) < s.range * 0.6) return; // hold and shoot
  if (u.kind === "wooka") {
    const prey = nearestEnemy(b, u, AGGRO); // they smell you through the trees
    if (prey) return move(b, u, prey.x - u.x, prey.z - u.z, s.speed);
  }
  if (u.kind === "engineer") {
    const fix = b.units.filter((v) => v.side === u.side && armoured(v.kind) && v.hp < v.maxHp && dist(u, v) < 40).sort((a, c) => dist(u, a) - dist(u, c))[0];
    if (fix && dist(u, fix) < 6) { fix.hp = Math.min(fix.maxHp, fix.hp + REPAIR * DT); return; }
    if (fix) return move(b, u, fix.x - u.x, fix.z - u.z, s.speed);
  }
  const goal = u.guard ? guardPost(b, u.side) ?? objective(b, u.side) : objective(b, u.side);
  move(b, u, goal.x + u.jx - u.x, goal.z + u.jz - u.z, s.speed);
}

// The nearest post the side doesn't hold; with both held, the one nearer the enemy.
export function objective(b: Battle, side: Side) {
  const home = SPAWN[side], foe = SPAWN[other(side)];
  const open = b.posts.filter((p) => p.owner !== side || Math.abs(p.progress) < 1);
  if (open.length) return open.sort((a, c) => dist(a, home) - dist(c, home))[0]!;
  return [...b.posts].sort((a, c) => dist(a, foe) - dist(c, foe))[0]!;
}

// A third of each side holds the post nearest the enemy instead of pushing on.
function guardPost(b: Battle, side: Side) {
  const foe = SPAWN[other(side)];
  return b.posts.filter((p) => p.owner === side).sort((a, c) => dist(a, foe) - dist(c, foe))[0];
}

// The AI goes straight on if it can. If a wall stops it, it heads round one side (then the
// other) and keeps going that way a while, so it doesn't wobble back and forth along the wall.
// The player just slides.
function move(b: Battle, u: Unit, dx: number, dz: number, speed: number, steer = true) {
  const len = hypot(dx, dz);
  if (len < 0.5) return;
  const step = Math.min(len, speed * DT), x = u.x, z = u.z;
  if (u.detourT !== undefined && (u.detourT -= DT) <= 0) u.detour = u.detourT = undefined;
  const turn = u.detour ?? (u.id % 2 ? 1.1 : -1.1);
  for (const a of !steer ? [0] : u.detour ? [turn, 0, -turn] : [0, turn, -turn]) {
    const c = cos(a), s = sin(a);
    u.x = clamp(x + ((dx * c - dz * s) / len) * step, -HALF, HALF);
    u.z = clamp(z + ((dx * s + dz * c) / len) * step, -HALF, HALF);
    unstick(b, u);
    if (hypot(u.x - x, u.z - z) > step * 0.3) {
      if (a && a !== u.detour) { u.detour = a; u.detourT = DETOUR; }
      break;
    }
  }
  if (u.kind !== "hero") u.yaw = atan2(-dx, -dz);
}

// Push a unit out of any trunk or block it's in. Gunships fly over them.
function unstick(b: Battle, u: Unit) {
  if (flies(u)) return;
  const body = bodyOf(u.kind);
  for (const t of b.trees) {
    const ox = u.x - t.x, oz = u.z - t.z, d = hypot(ox, oz), min = t.r + body;
    if (d < min && d > 1e-6) { u.x = t.x + (ox / d) * min; u.z = t.z + (oz / d) * min; }
  }
  for (const k of b.blocks) {
    const l = k.x - k.w / 2 - body, r = k.x + k.w / 2 + body, n = k.z - k.d / 2 - body, f = k.z + k.d / 2 + body;
    if (u.x <= l || u.x >= r || u.z <= n || u.z >= f) continue;
    // Out the nearest side, unless that's off the map.
    const outs = [[u.x - l, l, u.z], [r - u.x, r, u.z], [u.z - n, u.x, n], [f - u.z, u.x, f]].filter((o) => Math.abs(o[1]!) <= HALF && Math.abs(o[2]!) <= HALF);
    const out = outs.sort((a, c) => a[0]! - c[0]!)[0];
    if (out) { u.x = out[1]!; u.z = out[2]!; }
  }
  u.x = clamp(u.x, -HALF, HALF);
  u.z = clamp(u.z, -HALF, HALF);
}

// Aim assist: the nearest enemy in sight within a few degrees of where the hero is looking.
export function aimTarget(b: Battle, from: Unit, yaw: number, range: number) {
  let best: Unit | null = null, bd = range;
  for (const v of b.units) {
    if (v.side === from.side || v.hp <= 0) continue;
    const d = dist(from, v);
    if (d > bd) continue;
    let off = Math.abs(yawTo(from, v) - yaw) % (Math.PI * 2);
    if (off > Math.PI) off = Math.PI * 2 - off;
    if (off < Math.max(0.06, 2.5 / d) && sees(b, from, v)) { bd = d; best = v; }
  }
  return best;
}

function callStrike(b: Battle, side: Side, x: number, z: number) {
  if (b.strikesLeft[side] <= 0) return false;
  b.strikesLeft[side]--;
  b.strikes.push({ side, x: clamp(x, -HALF, HALF), z: clamp(z, -HALF, HALF), t: STRIKE_DELAY });
  b.events.push(`${side === b.spec.hero ? "Your" : "Enemy"} orbital strike inbound`);
  return true;
}

// The AI calls its strikes on whichever enemy crowd is thickest.
function aiStrike(b: Battle, side: Side) {
  if (b.time < b.aiStrikeAt[side] || b.strikesLeft[side] <= 0) return;
  b.aiStrikeAt[side] = b.time + 30;
  let best: Unit | null = null, most = 2;
  for (const u of b.units) if (u.side !== side && u.kind !== "turret") {
    const n = b.units.filter((v) => v.side === u.side && dist(u, v) < STRIKE_RADIUS).length;
    if (n > most) { most = n; best = u; }
  }
  if (best) callStrike(b, side, best.x, best.z);
}

export function step(b: Battle, input: Input | null) {
  if (b.over) return;
  b.time += DT;
  const sides: Side[] = ["attacker", "defender"];
  const hero = heroUnit(b), ride = heroVehicle(b);

  // The player's hero, or the vehicle they're driving.
  if (hero && input) {
    const body = ride ?? hero, s = STATS[body.kind];
    const f = facing(input.yaw), r = { x: -f.z, z: f.x };
    const fwd = clamp(input.forward, -1, 1), rt = clamp(input.right, -1, 1);
    move(b, body, f.x * fwd + r.x * rt, f.z * fwd + r.z * rt, s.speed * Math.min(1, hypot(fwd, rt)), false);
    body.yaw = input.yaw;
    body.cool -= DT;
    if (input.fire && body.cool <= 0) shoot(b, body, aimTarget(b, body, input.yaw, s.range), input.yaw);
    if (input.strike) callStrike(b, hero.side, input.strike.x, input.strike.z);
    if (input.use) {
      if (ride) { b.hero.inVehicle = null; hero.x = ride.x + 3; hero.z = ride.z; unstick(b, hero); b.events.push(`Out of the ${ride.kind}`); }
      else {
        const v = b.units.find((v) => isVehicle(v.kind) && v.side === hero.side && v.hp > 0 && dist(v, hero) < 7);
        if (v) { b.hero.inVehicle = v.id; b.events.push(`In the ${v.kind}`); }
      }
    }
    if (ride && b.hero.inVehicle === ride.id) { hero.x = ride.x; hero.z = ride.z; }
  }
  for (const u of b.units) {
    if (u.hp <= 0) continue;
    if (input && (u.id === b.hero.id || u.id === b.hero.inVehicle)) continue;
    think(b, u);
  }
  for (const s of sides) if (!(input && s === b.spec.hero)) aiStrike(b, s);

  // Strikes land.
  for (const st of b.strikes) if ((st.t -= DT) <= 0) blast(b, st.side, st.x, st.z, STRIKE_RADIUS, 260);
  b.strikes = b.strikes.filter((st) => st.t > 0);

  // A vehicle going up throws its driver out hurt; the dead cost their side tickets.
  const wreck = heroVehicle(b);
  if (wreck && wreck.hp <= 0) {
    b.hero.inVehicle = null;
    if (hero) { hero.hp -= 150; unstick(b, hero); }
    b.events.push(`Your ${wreck.kind} is destroyed`);
  }
  for (const u of b.units) if (u.hp <= 0) {
    b.tickets[u.side] -= STATS[u.kind].cost;
    if (u.id === b.hero.id) {
      b.hero.lives--;
      b.hero.id = null;
      b.hero.respawn = 5;
      b.events.push(b.hero.lives > 0 ? `Hero down: ${b.hero.lives} ${b.hero.lives === 1 ? "life" : "lives"} left` : "Hero down for good");
    }
  }
  b.units = b.units.filter((u) => u.hp > 0);
  if (b.hero.id === null && b.hero.lives > 0 && (b.hero.respawn -= DT) <= 0) spawnHero(b);

  // Command posts: whoever stands alone on one turns it. Gunships fly over and don't count.
  for (const p of b.posts) {
    let att = 0, def = 0;
    for (const u of b.units) if (u.kind !== "turret" && !flies(u) && !hidden(b, u) && dist(u, p) < POST_RADIUS) u.side === "attacker" ? att++ : def++;
    if (!att === !def) continue;
    const before = p.owner;
    p.progress = clamp(p.progress + (att ? 1 : -1) * 0.12 * Math.min(4, att || def) * DT, -1, 1);
    if (p.progress >= 1) p.owner = "attacker";
    else if (p.progress <= -1) p.owner = "defender";
    else if ((p.owner === "attacker" && p.progress <= 0) || (p.owner === "defender" && p.progress >= 0)) p.owner = null;
    if (p.owner !== before) b.events.push(p.owner ? `${p.name} taken by ${p.owner === b.spec.hero ? "your side" : "the enemy"}` : `${p.name} lost`);
  }

  // Bleed, drop pods, fresh troops and vehicles.
  const held = (s: Side) => b.posts.filter((p) => p.owner === s).length;
  const tick = (every: number) => Math.floor(b.time / every) !== Math.floor((b.time - DT) / every);
  if (tick(BLEED_EVERY)) for (const s of sides) b.tickets[s] -= Math.max(0, held(other(s)) - held(s));
  // On a tie the attacker bleeds slowly: it's the one that has to push.
  if (tick(BLEED_EVERY * 2) && held("attacker") === held("defender")) b.tickets.attacker--;
  for (const s of sides) {
    if (!b.reinforced[s] && b.spec.reinforcements[s] > 0 && b.tickets[s] <= b.spec.tickets[s] / 2) {
      b.reinforced[s] = true;
      b.tickets[s] += b.spec.reinforcements[s];
      b.events.push(`${s === b.spec.hero ? "Our" : "Enemy"} drop pods: +${b.spec.reinforcements[s]} tickets`);
    }
    // Troops come in waves, so a side doesn't feed itself in one at a time.
    if (b.tickets[s] <= 0 || b.time < b.spawnAt[s]) continue;
    b.spawnAt[s] = b.time + WAVE_EVERY;
    const horde = isHorde(b, s), alive = (f: (k: UnitKind) => boolean) => b.units.filter((u) => u.side === s && f(u.kind)).length;
    // Two vehicles out at a time, of whichever kind the side has most of left.
    const left = b.vehiclesLeft[s], next = VEHICLE_KINDS.reduce((a, k) => (left[k] > left[a] ? k : a));
    if (!horde && alive(isVehicle) < 2 && left[next] > 0) { const at = spawnPoint(b, s); left[next]--; add(b, s, next, at.x, at.z); }
    for (let n = troopCap(b, s) - alive(horde ? (k) => k === "wooka" : isTrooper); n > 0; n--) {
      const at = spawnPoint(b, s);
      add(b, s, horde ? "wooka" : nextClass(b, s), at.x, at.z);
    }
  }
  if (Math.floor(b.time / FLAVOR_EVERY) !== Math.floor((b.time - DT) / FLAVOR_EVERY) && sides.some((s) => isHorde(b, s))) {
    b.events.push(FLAVOR[Math.floor(rand(b) * FLAVOR.length)]!);
  }

  for (const f of b.fx) f.t -= DT;
  b.fx = b.fx.filter((f) => f.t > 0);
  if (b.events.length > 40) b.events.splice(0, b.events.length - 40);

  const out = sides.find((s) => b.tickets[s] <= 0);
  if (out || b.time >= TIME_LIMIT) {
    const winner = out ? other(out) : b.tickets.attacker > b.tickets.defender ? "attacker" : "defender";
    b.over = { id: b.spec.id, winner, tickets: { attacker: Math.max(0, Math.ceil(b.tickets.attacker)), defender: Math.max(0, Math.ceil(b.tickets.defender)) }, heroDown: b.hero.lives <= 0 };
  }
}

// With no input the hero fights like any other trooper: for tests, and for a battle left to the AI.
export function run(spec: BattleSpec, maxSeconds = TIME_LIMIT): Battle {
  const b = startBattle(spec);
  while (!b.over && b.time < maxSeconds) step(b, null);
  return b;
}
