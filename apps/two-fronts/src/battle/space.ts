// The hero space battle as a pure, fixed-step simulation: the fleets over a system, a cruiser for
// each ship, each cruiser launching its wing of fighters, and the hero in a fighter of their own.
// Cruisers trade broadsides across the gap and shoot at fighters close by. A third of the
// fighters fly bombing runs on the enemy cruisers, and the rest dogfight. Lose your cruisers and
// you lose the orbit. The view draws it and feeds the hero's input; the tests run it headless.
import { acos, atan2, cos, hypot, sin } from "./fmath.ts";
import { other, type PerSide, type Side, type SpaceBattleResult, type SpaceBattleSpec } from "./contract.ts";
import { clamp, nextRandom } from "@rustybuns/util";

export type CraftKind = "fighter" | "cruiser" | "hero";
export interface Craft {
  id: number; side: Side; kind: CraftKind;
  x: number; y: number; z: number; yaw: number; pitch: number;
  hp: number; maxHp: number;
  cool: number;   // guns, or a cruiser's point defence
  gun: number;    // a cruiser's broadside
  bomber: boolean;
  pass: number;   // seconds left flying straight through after a bombing run
  torp: number;   // a bomber's seconds until its next torpedo is loaded
  hurt: number;   // seconds left of the flash from the last hit, for the view
  calm: number;   // seconds since it was last hit
  by: number;     // who hit it last, for the hero's kills
}
// A shot: from where it was fired to where it lands, `life` seconds in flight and `t` of them left.
// A torpedo is a bomber's: slow, and it hits a cruiser hard when it gets there (`dmg` to craft `at`).
export interface Bolt { x: number; y: number; z: number; tx: number; ty: number; tz: number; t: number; life: number; side: Side; heavy: boolean; hit: boolean; torp?: { at: number; dmg: number; by: number } }
export interface Blast { x: number; y: number; z: number; t: number; big: boolean }

// Where the hero wants to point (they turn towards it as fast as a fighter can), how hard they
// fly (-1 brake to 1 boost), and the trigger.
export interface SpaceInput { yaw: number; pitch: number; throttle: number; fire: boolean }

export interface SpaceBattle {
  spec: SpaceBattleSpec;
  time: number;
  craft: Craft[];
  reserve: PerSide<number>; // fighters still to launch
  hero: { id: number | null; lives: number; respawn: number; out: boolean; kills: number }; // out: past the leash, turning back
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
export const LEASH = 400;          // and the hero is turned back past this far
export const LINE = 160;           // each fleet's cruisers sit this far either side of the middle
const FIGHTERS_PER_SHIP = 8;
const WING_PER_CRUISER = 4;        // fighters in flight per cruiser still up
const MAX_WING = 16;
const LAUNCH_EVERY = 5;
const BROADSIDE = { every: 3, range: 450, dmg: 70, aim: 0.6 };
const CLOSE = { speed: 1.2, to: 125 }; // the lines steam towards each other this fast, until this far from the middle
const HERO_LIVES = 3;
const SHIELD = { after: 3, rate: 12 }; // the hero's shields come back this many hp a second, this long after a hit
export const HULL = { r: 10, half: 26 }; // a cruiser's hull, as a capsule along z
const PITCH_MAX = 1.3;
const BOLT_SPEED = { light: 600, heavy: 260 }; // how fast a shot crosses the gap, for the view
const TORPEDO = { range: 70, cone: 0.25, dmg: 32, aim: 0.85, reload: 6, speed: 70 }; // a bomber's, at a cruiser
const CHASED = { range: 90, cone: 0.35 };      // an enemy this close, pointed this near at a fighter, is on its tail

export const SPACE_STATS: Record<CraftKind, { hp: number; speed: number; turn: number; range: number; cool: number; dmg: number; aim: number }> = {
  fighter: { hp: 60, speed: 40, turn: 1.6, range: 110, cool: 0.5, dmg: 10, aim: 0.6 },
  cruiser: { hp: 1500, speed: 0, turn: 0, range: 150, cool: 0.6, dmg: 10, aim: 0.45 },
  hero: { hp: 160, speed: 46, turn: 2.4, range: 130, cool: 0.16, dmg: 12, aim: 0.9 },
};

const rand = (b: SpaceBattle) => nextRandom(b, "seed");
type P = { x: number; y: number; z: number };
const dist = (a: P, b: P) => hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const wrap = (a: number) => atan2(sin(a), cos(a));
// yaw 0, pitch 0 faces -z, like the ground battle and a three.js camera.
export const heading = (yaw: number, pitch: number) => ({ x: -sin(yaw) * cos(pitch), y: sin(pitch), z: -cos(yaw) * cos(pitch) });
export const lookAt = (from: P, to: P) => ({ yaw: atan2(-(to.x - from.x), -(to.z - from.z)), pitch: atan2(to.y - from.y, hypot(to.x - from.x, to.z - from.z)) });
// The angle between where a craft points and the way to something.
function offBore(u: Craft, t: P) {
  const h = heading(u.yaw, u.pitch), d = dist(u, t) || 1;
  return acos(clamp((h.x * (t.x - u.x) + h.y * (t.y - u.y) + h.z * (t.z - u.z)) / d, -1, 1));
}

export function startSpaceBattle(spec: SpaceBattleSpec): SpaceBattle {
  const b: SpaceBattle = {
    spec, time: 0, craft: [], bolts: [], blasts: [], events: [],
    reserve: { attacker: spec.fleets.attacker * FIGHTERS_PER_SHIP, defender: spec.fleets.defender * FIGHTERS_PER_SHIP },
    hero: { id: null, lives: HERO_LIVES, respawn: 0, out: false, kills: 0 },
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
    cool: rand(b) * SPACE_STATS[kind].cool, gun: rand(b) * BROADSIDE.every, bomber: kind === "fighter" && rand(b) < 1 / 3, pass: 0, torp: 0, hurt: 0, calm: 0, by: 0,
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

// A shot lands (or not) the moment it's fired; the bolt only shows it crossing the gap. A miss
// flies on past the target, as a miss does.
function fire(b: SpaceBattle, u: Craft, t: Craft | null, s: { range: number; dmg: number; aim: number }, heavy = false, torp = false) {
  const shot = (tx: number, ty: number, tz: number, hit: boolean) => {
    const life = Math.max(DT, hypot(tx - u.x, ty - u.y, tz - u.z) / (torp ? TORPEDO.speed : heavy ? BOLT_SPEED.heavy : BOLT_SPEED.light));
    b.bolts.push({ x: u.x, y: u.y, z: u.z, tx, ty, tz, t: life, life, side: u.side, heavy, hit, ...(torp && t && { torp: { at: t.id, dmg: hit ? s.dmg : 0, by: u.id } }) });
  };
  if (!t) {
    const h = heading(u.yaw, u.pitch);
    return shot(u.x + h.x * s.range, u.y + h.y * s.range, u.z + h.z * s.range, false);
  }
  const hit = rand(b) < clamp(s.aim - (dist(u, t) / s.range) * 0.4, 0.05, 0.95);
  const miss = () => (hit ? 0 : (rand(b) - 0.5) * 14), over = hit ? 1 : 1.4;
  shot(u.x + (t.x + miss() - u.x) * over, u.y + (t.y + miss() - u.y) * over, u.z + (t.z + miss() - u.z) * over, hit);
  if (hit && !torp) { t.hp -= s.dmg; t.hurt = 0.25; t.calm = 0; t.by = u.id; }
}

// The nearest enemy fighter sitting on a craft's tail: close behind and pointed at it.
function onTail(b: SpaceBattle, u: Craft) {
  for (const v of b.craft) {
    if (v.side === u.side || v.kind === "cruiser" || v.hp <= 0) continue;
    if (dist(u, v) < CHASED.range && offBore(v, u) < CHASED.cone && offBore(u, v) > Math.PI / 2) return v;
  }
  return null;
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
  // A bomber lets its torpedo go close in on a cruiser, lined up, then reloads on the way round.
  if (u.bomber && (u.torp -= DT) <= 0 && t?.kind === "cruiser" && dist(u, t) < TORPEDO.range && offBore(u, t) < TORPEDO.cone) {
    u.torp = TORPEDO.reload;
    fire(b, u, t, TORPEDO, false, true);
  }
  if (u.pass > 0) { u.pass -= DT; return fly(u, u.yaw, u.pitch); }
  if (hypot(u.x, u.y, u.z) > ARENA) { const back = lookAt(u, { x: 0, y: 0, z: 0 }); return fly(u, back.yaw, back.pitch); }
  if (!t) return fly(u, u.yaw, u.pitch);
  // A bombing run goes right past the cruiser, then turns round for another.
  if (t.kind === "cruiser" && dist(u, t) < 30) u.pass = 2;
  const to = lookAt(u, t);
  // Someone on its tail: it jinks, weaving hard either side of its course and boosting, which
  // spoils their aim more than it spoils its own.
  if (onTail(b, u)) {
    const w = b.time * 2.6 + u.id * 1.7;
    return fly(u, to.yaw + 1.1 * sin(w), to.pitch + 0.5 * cos(w * 0.7), 0.5);
  }
  fly(u, to.yaw, to.pitch);
}

// A cruiser keeps its place in the line as the line closes: point defence at fighters close by, a broadside at the
// nearest enemy cruiser. The point defence is a ring of turrets, not one gun: each burst goes at
// any fighter in range, bombers twice as likely (they're the ones that hurt), not just the nearest.
function cruise(b: SpaceBattle, u: Craft) {
  const s = SPACE_STATS.cruiser;
  // The line closes slowly to fighting distance, then holds there.
  if (Math.abs(u.z) > CLOSE.to) u.z -= Math.sign(u.z) * CLOSE.speed * DT;
  u.cool -= DT;
  u.gun -= DT;
  if (u.cool <= 0) {
    let f: Craft | null = null, sum = 0;
    for (const v of b.craft) {
      if (v.side === u.side || v.kind === "cruiser" || v.hp <= 0 || dist(u, v) >= s.range) continue;
      const w = v.bomber ? 2 : 1;
      if (rand(b) * (sum += w) < w) f = v;
    }
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
    // Out of the fire for a few seconds, the shields build back up: break off, then come round again.
    if ((hero.calm += DT) > SHIELD.after) hero.hp = Math.min(hero.maxHp, hero.hp + SHIELD.rate * DT);
    // Too far out and the fighter turns itself back towards the fight, whatever the stick says.
    const far = hypot(hero.x, hero.y, hero.z);
    if (far > LEASH && !b.hero.out) { b.hero.out = true; b.events.push("Leaving the battle: turning back"); }
    else if (far < ARENA) b.hero.out = false;
    const back = lookAt(hero, { x: 0, y: 0, z: 0 });
    if (b.hero.out) fly(hero, back.yaw, back.pitch, input.throttle);
    else fly(hero, input.yaw, input.pitch, input.throttle);
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
    const z = clamp(u.z, c.z - HULL.half, c.z + HULL.half), ox = u.x - c.x, oy = u.y - c.y, oz = u.z - z, d = hypot(ox, oy, oz);
    if (d >= HULL.r) continue;
    if (d < 1e-6) { u.y = c.y + HULL.r; continue; } // dead on the keel: over the top
    u.x = c.x + (ox / d) * HULL.r; u.y = c.y + (oy / d) * HULL.r; u.z = z + (oz / d) * HULL.r;
  }

  for (const u of b.craft) if (u.hp <= 0) {
    b.blasts.push({ x: u.x, y: u.y, z: u.z, t: u.kind === "cruiser" ? 1.2 : 0.4, big: u.kind === "cruiser" });
    const yours = b.hero.id !== null && u.by === b.hero.id;
    if (yours) b.hero.kills++;
    if (u.kind === "cruiser") b.events.push(u.side === b.spec.hero ? "One of our cruisers is going down" : yours ? "You finished off an enemy cruiser" : "Enemy cruiser destroyed");
    else if (yours) b.events.push("You shot one down");
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

  for (const u of b.craft) if (u.hurt > 0) u.hurt -= DT;
  for (const f of b.bolts) {
    f.t -= DT;
    // A torpedo lands on its cruiser, if the cruiser's still there.
    const t = f.t <= 0 && f.torp?.dmg ? b.craft.find((u) => u.id === f.torp!.at) : null;
    if (t) { t.hp -= f.torp!.dmg; t.hurt = 0.25; t.by = f.torp!.by; }
  }
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
