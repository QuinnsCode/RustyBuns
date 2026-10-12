// The hero space battle as a pure, fixed-step simulation: the fleets over a system, a cruiser for
// each ship, each cruiser launching its wing of fighters, and the hero in a fighter of their own.
// Cruisers trade broadsides across the gap and shoot at fighters close by. A third of the
// fighters fly bombing runs on the enemy cruisers, and the rest dogfight. Lose your cruisers and
// you lose the orbit. The view draws it and feeds the hero's input; the tests run it headless.
import { other, type PerSide, type Side, type SpaceBattleResult, type SpaceBattleSpec } from "./contract.ts";

export type CraftKind = "fighter" | "cruiser" | "hero";
export interface Craft {
  id: number; side: Side; kind: CraftKind;
  x: number; y: number; z: number; yaw: number; pitch: number;
  hp: number; maxHp: number;
  cool: number;   // guns, or a cruiser's point defence
  gun: number;    // a cruiser's broadside
  bomber: boolean;
  pass: number;   // seconds left flying straight through after a bombing run
}
export interface Bolt { x: number; y: number; z: number; tx: number; ty: number; tz: number; t: number; side: Side; heavy: boolean }
export interface Blast { x: number; y: number; z: number; t: number; big: boolean }

// Where the hero wants to point (they turn towards it as fast as a fighter can), how hard they
// fly (-1 brake to 1 boost), and the trigger.
export interface SpaceInput { yaw: number; pitch: number; throttle: number; fire: boolean }

export interface SpaceBattle {
  spec: SpaceBattleSpec;
  time: number;
  craft: Craft[];
  reserve: PerSide<number>; // fighters still to launch
  hero: { id: number | null; lives: number; respawn: number };
  bolts: Bolt[];
  blasts: Blast[];
  events: string[];
  over: SpaceBattleResult | null;
  seed: number;
  nextId: number;
  launchAt: PerSide<number>;
}

export const DT = 1 / 30;
export const SPACE_LIMIT = 300;
export const ARENA = 320;          // fighters turn back past this far from the middle
export const LINE = 160;           // each fleet's cruisers sit this far either side of the middle
const FIGHTERS_PER_SHIP = 8;
const WING_PER_CRUISER = 4;        // fighters in flight per cruiser still up
const MAX_WING = 16;
const LAUNCH_EVERY = 5;
const BROADSIDE = { every: 3, range: 450, dmg: 70, aim: 0.6 };
const HERO_LIVES = 3;
export const HULL = { r: 10, half: 26 }; // a cruiser's hull, as a capsule along z
const PITCH_MAX = 1.3;

export const SPACE_STATS: Record<CraftKind, { hp: number; speed: number; turn: number; range: number; cool: number; dmg: number; aim: number }> = {
  fighter: { hp: 60, speed: 40, turn: 1.6, range: 110, cool: 0.5, dmg: 10, aim: 0.6 },
  cruiser: { hp: 1500, speed: 0, turn: 0, range: 150, cool: 0.6, dmg: 10, aim: 0.45 },
  hero: { hp: 160, speed: 46, turn: 2.4, range: 130, cool: 0.16, dmg: 12, aim: 0.9 },
};

const rand = (b: SpaceBattle) => {
  let t = (b.seed = (b.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
type P = { x: number; y: number; z: number };
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
// yaw 0, pitch 0 faces -z, like the ground battle and a three.js camera.
export const heading = (yaw: number, pitch: number) => ({ x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) });
export const lookAt = (from: P, to: P) => ({ yaw: Math.atan2(-(to.x - from.x), -(to.z - from.z)), pitch: Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z)) });
// The angle between where a craft points and the way to something.
function offBore(u: Craft, t: P) {
  const h = heading(u.yaw, u.pitch), d = dist(u, t) || 1;
  return Math.acos(clamp((h.x * (t.x - u.x) + h.y * (t.y - u.y) + h.z * (t.z - u.z)) / d, -1, 1));
}

export function startSpaceBattle(spec: SpaceBattleSpec): SpaceBattle {
  const b: SpaceBattle = {
    spec, time: 0, craft: [], bolts: [], blasts: [], events: [],
    reserve: { attacker: spec.fleets.attacker * FIGHTERS_PER_SHIP, defender: spec.fleets.defender * FIGHTERS_PER_SHIP },
    hero: { id: null, lives: HERO_LIVES, respawn: 0 },
    over: null, seed: spec.seed >>> 0, nextId: 1,
    launchAt: { attacker: 0, defender: 0 },
  };
  for (const side of ["attacker", "defender"] as Side[]) {
    const n = spec.fleets[side], gap = Math.min(60, 480 / Math.max(1, n));
    for (let i = 0; i < n; i++) add(b, side, "cruiser", (i - (n - 1) / 2) * gap, i % 2 ? 15 : -10, side === "attacker" ? LINE : -LINE);
  }
  spawnHero(b);
  return b;
}

function add(b: SpaceBattle, side: Side, kind: CraftKind, x: number, y: number, z: number): Craft {
  const hp = kind === "hero" ? Math.round(SPACE_STATS.hero.hp * (1 + 0.15 * (b.spec.heroLevel - 1))) : SPACE_STATS[kind].hp;
  const u: Craft = {
    id: b.nextId++, side, kind, x, y, z, yaw: side === "attacker" ? 0 : Math.PI, pitch: 0, hp, maxHp: hp,
    cool: rand(b) * SPACE_STATS[kind].cool, gun: rand(b) * BROADSIDE.every, bomber: kind === "fighter" && rand(b) < 1 / 3, pass: 0,
  };
  b.craft.push(u);
  return u;
}

const cruisers = (b: SpaceBattle, side: Side) => b.craft.filter((u) => u.side === side && u.kind === "cruiser");
export const heroCraft = (b: SpaceBattle) => b.craft.find((u) => u.id === b.hero.id) ?? null;

// Fighters launch from just in front of a cruiser, pointed at the enemy.
function launch(b: SpaceBattle, side: Side, kind: CraftKind) {
  const from = cruisers(b, side);
  if (!from.length) return null;
  const c = from[Math.floor(rand(b) * from.length)]!, ahead = side === "attacker" ? -1 : 1;
  return add(b, side, kind, c.x + (rand(b) - 0.5) * 20, c.y + (rand(b) - 0.5) * 10, c.z + ahead * 20);
}

function spawnHero(b: SpaceBattle) {
  const u = launch(b, b.spec.hero, "hero");
  b.hero.id = u ? u.id : null;
}

function nearest(b: SpaceBattle, u: Craft, want: (v: Craft) => boolean, range = Infinity) {
  let best: Craft | null = null, bd = range;
  for (const v of b.craft) {
    if (v.side === u.side || v.hp <= 0 || !want(v)) continue;
    const d = dist(u, v);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

function fire(b: SpaceBattle, u: Craft, t: Craft | null, s: { range: number; dmg: number; aim: number }, heavy = false) {
  if (!t) {
    const h = heading(u.yaw, u.pitch);
    b.bolts.push({ x: u.x, y: u.y, z: u.z, tx: u.x + h.x * s.range, ty: u.y + h.y * s.range, tz: u.z + h.z * s.range, t: 0.1, side: u.side, heavy });
    return;
  }
  const hit = rand(b) < clamp(s.aim - (dist(u, t) / s.range) * 0.4, 0.05, 0.95);
  const miss = () => (hit ? 0 : (rand(b) - 0.5) * 14);
  b.bolts.push({ x: u.x, y: u.y, z: u.z, tx: t.x + miss(), ty: t.y + miss(), tz: t.z + miss(), t: heavy ? 0.3 : 0.1, side: u.side, heavy });
  if (hit) t.hp -= s.dmg;
}

// Turn towards a heading as fast as the craft can, then fly on.
function fly(u: Craft, yaw: number, pitch: number, throttle = 0) {
  const s = SPACE_STATS[u.kind], max = s.turn * DT;
  u.yaw = wrap(u.yaw + clamp(wrap(yaw - u.yaw), -max, max));
  u.pitch = clamp(u.pitch + clamp(clamp(pitch, -PITCH_MAX, PITCH_MAX) - u.pitch, -max, max), -PITCH_MAX, PITCH_MAX);
  const v = s.speed * (1 + 0.5 * clamp(throttle, -1, 1)) * DT, h = heading(u.yaw, u.pitch);
  u.x += h.x * v; u.y += h.y * v; u.z += h.z * v;
}

// Fighters (and the hero on autopilot) pick a target, chase it, and shoot when it's in front.
function pilot(b: SpaceBattle, u: Craft) {
  const s = SPACE_STATS[u.kind];
  u.cool -= DT;
  const isCruiser = (v: Craft) => v.kind === "cruiser";
  // Bombers spread out down the enemy line rather than all piling onto one cruiser.
  const line = u.bomber ? cruisers(b, other(u.side)) : [];
  const t = (line.length ? line[u.id % line.length]! : nearest(b, u, (v) => !isCruiser(v))) ?? nearest(b, u, () => true);
  if (t && u.cool <= 0 && dist(u, t) < s.range && offBore(u, t) < 0.2) { u.cool = s.cool; fire(b, u, t, s); }
  if (u.pass > 0) { u.pass -= DT; return fly(u, u.yaw, u.pitch); }
  if (Math.hypot(u.x, u.y, u.z) > ARENA) { const back = lookAt(u, { x: 0, y: 0, z: 0 }); return fly(u, back.yaw, back.pitch); }
  if (!t) return fly(u, u.yaw, u.pitch);
  // A bombing run goes right past the cruiser, then turns round for another.
  if (t.kind === "cruiser" && dist(u, t) < 30) u.pass = 2;
  const to = lookAt(u, t);
  fly(u, to.yaw, to.pitch);
}

// A cruiser holds its place in the line: point defence at fighters close by, a broadside at the
// nearest enemy cruiser.
function cruise(b: SpaceBattle, u: Craft) {
  const s = SPACE_STATS.cruiser;
  u.cool -= DT;
  u.gun -= DT;
  if (u.cool <= 0) {
    const f = nearest(b, u, (v) => v.kind !== "cruiser", s.range);
    if (f) { u.cool = s.cool; fire(b, u, f, s); }
  }
  if (u.gun <= 0) {
    const c = nearest(b, u, (v) => v.kind === "cruiser", BROADSIDE.range);
    if (c) { u.gun = BROADSIDE.every; fire(b, u, c, BROADSIDE, true); }
  }
}

// Aim assist: the nearest enemy within a few degrees of where the hero points.
export function spaceAimTarget(b: SpaceBattle, from: Craft, range: number) {
  let best: Craft | null = null, bd = range;
  for (const v of b.craft) {
    if (v.side === from.side || v.hp <= 0) continue;
    const d = dist(from, v);
    if (d < bd && offBore(from, v) < Math.max(0.05, (v.kind === "cruiser" ? 20 : 5) / d)) { bd = d; best = v; }
  }
  return best;
}

export function stepSpace(b: SpaceBattle, input: SpaceInput | null) {
  if (b.over) return;
  b.time += DT;
  const sides: Side[] = ["attacker", "defender"];
  const hero = heroCraft(b);

  if (hero && input) {
    const s = SPACE_STATS.hero;
    hero.cool -= DT;
    fly(hero, input.yaw, input.pitch, input.throttle);
    if (input.fire && hero.cool <= 0) { hero.cool = s.cool; fire(b, hero, spaceAimTarget(b, hero, s.range), s); }
  }
  for (const u of b.craft) {
    if (u.hp <= 0 || (input && u.id === b.hero.id)) continue;
    if (u.kind === "cruiser") cruise(b, u);
    else pilot(b, u);
  }

  // Cruiser hulls are solid: a capsule along z that fighters slide off.
  for (const c of b.craft) if (c.kind === "cruiser") for (const u of b.craft) {
    if (u.kind === "cruiser") continue;
    const z = clamp(u.z, c.z - HULL.half, c.z + HULL.half), ox = u.x - c.x, oy = u.y - c.y, oz = u.z - z, d = Math.hypot(ox, oy, oz);
    if (d >= HULL.r) continue;
    if (d < 1e-6) { u.y = c.y + HULL.r; continue; } // dead on the keel: over the top
    u.x = c.x + (ox / d) * HULL.r; u.y = c.y + (oy / d) * HULL.r; u.z = z + (oz / d) * HULL.r;
  }

  for (const u of b.craft) if (u.hp <= 0) {
    b.blasts.push({ x: u.x, y: u.y, z: u.z, t: u.kind === "cruiser" ? 1.2 : 0.4, big: u.kind === "cruiser" });
    if (u.kind === "cruiser") b.events.push(u.side === b.spec.hero ? "One of our cruisers is going down" : "Enemy cruiser destroyed");
    if (u.id === b.hero.id) {
      b.hero.lives--;
      b.hero.id = null;
      b.hero.respawn = 4;
      b.events.push(b.hero.lives > 0 ? `Shot down: ${b.hero.lives} ${b.hero.lives === 1 ? "life" : "lives"} left` : "Shot down for good");
    }
  }
  b.craft = b.craft.filter((u) => u.hp > 0);
  if (b.hero.id === null && b.hero.lives > 0 && (b.hero.respawn -= DT) <= 0) {
    spawnHero(b);
    if (b.hero.id !== null) b.events.push("Back in the fight in a fresh fighter");
  }

  // Each cruiser keeps a few of its fighters in the air, launched in waves.
  for (const s of sides) {
    if (b.time < b.launchAt[s]) continue;
    b.launchAt[s] = b.time + LAUNCH_EVERY;
    const up = b.craft.filter((u) => u.side === s && u.kind === "fighter").length;
    for (let n = Math.min(MAX_WING, cruisers(b, s).length * WING_PER_CRUISER) - up; n > 0 && b.reserve[s] > 0; n--) {
      if (!launch(b, s, "fighter")) break;
      b.reserve[s]--;
    }
  }

  for (const f of b.bolts) f.t -= DT;
  b.bolts = b.bolts.filter((f) => f.t > 0);
  for (const f of b.blasts) f.t -= DT;
  b.blasts = b.blasts.filter((f) => f.t > 0);
  if (b.events.length > 40) b.events.splice(0, b.events.length - 40);

  // Out of cruisers, a side loses the orbit. At the time limit, the side with more of its
  // cruisers' hull left holds it, the defender on a tie.
  const out = sides.find((s) => !cruisers(b, s).length);
  if (out || b.time >= SPACE_LIMIT) {
    const hull = (s: Side) => cruisers(b, s).reduce((n, u) => n + u.hp, 0) / Math.max(1, b.spec.fleets[s] * SPACE_STATS.cruiser.hp);
    const winner: Side = out ? other(out) : hull("attacker") > hull("defender") ? "attacker" : "defender";
    // A cruiser under half its hull limps home for the scrapyard: it doesn't count.
    const fit = (s: Side) => cruisers(b, s).filter((u) => u.hp >= u.maxHp / 2).length;
    b.over = { id: b.spec.id, winner, fleets: { attacker: fit("attacker"), defender: fit("defender") }, heroDown: b.hero.lives <= 0 };
  }
}

// With no input the hero flies like any other fighter: for tests, and for a battle left to the AI.
export function runSpace(spec: SpaceBattleSpec, maxSeconds = SPACE_LIMIT): SpaceBattle {
  const b = startSpaceBattle(spec);
  while (!b.over && b.time < maxSeconds) stepSpace(b, null);
  return b;
}
