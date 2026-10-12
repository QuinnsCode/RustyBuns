// The hero ground battle as a pure, fixed-step simulation: command posts laid out by the sector
// being fought over, AI troopers and tanks on both sides, the defender's turrets, orbital strikes
// and drop-pod reinforcements from the spec. The view draws it and feeds the hero's input; the
// tests run it headless with the autopilot.
import { other, type BattleResult, type BattleSpec, type PerSide, type SectorKind, type Side } from "./contract.ts";

export type UnitKind = "trooper" | "tank" | "turret" | "hero";
export interface Unit { id: number; side: Side; kind: UnitKind; x: number; z: number; yaw: number; hp: number; maxHp: number; cool: number; jx: number; jz: number; guard?: boolean }
export interface Post { name: string; x: number; z: number; owner: Side | null; progress: number } // progress: +1 attacker, -1 defender
export interface Strike { side: Side; x: number; z: number; t: number }
export interface Fx { kind: "shot" | "blast"; x: number; z: number; tx: number; tz: number; t: number }

// What the player does this step. Movement is relative to where the hero faces.
export interface Input { forward: number; right: number; yaw: number; fire: boolean; strike?: { x: number; z: number }; use?: boolean }

export interface Battle {
  spec: BattleSpec;
  time: number;
  tickets: PerSide<number>;
  posts: Post[];
  units: Unit[];
  strikes: Strike[];
  strikesLeft: PerSide<number>;
  vehiclesLeft: PerSide<number>;
  reinforced: PerSide<boolean>;
  hero: { id: number | null; lives: number; respawn: number; inTank: number | null };
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
// and their turrets ring it. The view adds the scenery to match.
export const LAYOUTS: Record<SectorKind, { name: string; posts: { name: string; x: number; z: number }[] }> = {
  shield: { name: "Shield generator plain", posts: [{ name: "Relay ridge", x: -40, z: 20 }, { name: "Generator", x: 30, z: -50 }] },
  capital: { name: "Capital city", posts: [{ name: "Transit hub", x: 45, z: 25 }, { name: "Market square", x: -35, z: -5 }, { name: "Palace", x: 5, z: -60 }] },
  spaceport: { name: "Spaceport", posts: [{ name: "Landing pads", x: -30, z: 5 }, { name: "Control tower", x: 35, z: -55 }] },
  cannon: { name: "Cannon battery", posts: [{ name: "Ammo depot", x: 40, z: 10 }, { name: "Cannon", x: -25, z: -55 }] },
};
export const STRIKE_RADIUS = 10;
const STRIKE_DELAY = 2.5;
const WAVE_EVERY = 8;              // seconds between reinforcement waves
const BLEED_EVERY = 4;             // seconds per ticket the side with fewer posts loses
const HERO_LIVES = 3;

export const STATS: Record<UnitKind, { hp: number; speed: number; range: number; cool: number; dmg: number; aim: number; cost: number }> = {
  trooper: { hp: 100, speed: 5, range: 45, cool: 0.9, dmg: 6, aim: 0.7, cost: 1 },
  tank: { hp: 600, speed: 7, range: 60, cool: 2.2, dmg: 45, aim: 0.8, cost: 5 },
  turret: { hp: 350, speed: 0, range: 55, cool: 1.2, dmg: 10, aim: 0.75, cost: 0 },
  hero: { hp: 300, speed: 8, range: 55, cool: 0.3, dmg: 9, aim: 0.9, cost: 3 },
};

const rand = (b: Battle) => {
  let t = (b.seed = (b.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// yaw 0 faces -z, towards the defender's end of the plain, like a three.js camera.
export const facing = (yaw: number) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
export const yawTo = (from: { x: number; z: number }, to: { x: number; z: number }) => Math.atan2(-(to.x - from.x), -(to.z - from.z));

export function startBattle(spec: BattleSpec): Battle {
  const b: Battle = {
    spec, time: 0,
    tickets: { ...spec.tickets },
    posts: LAYOUTS[spec.sector].posts.map((p, i, all) => (i === all.length - 1 ? { ...p, owner: "defender", progress: -1 } : { ...p, owner: null, progress: 0 })),
    units: [], strikes: [], fx: [], events: [],
    strikesLeft: { ...spec.strikes },
    vehiclesLeft: { ...spec.vehicles },
    reinforced: { attacker: false, defender: false },
    hero: { id: null, lives: HERO_LIVES, respawn: 0, inTank: null },
    over: null, seed: spec.seed >>> 0, nextId: 1,
    aiStrikeAt: { attacker: 20, defender: 25 },
    spawnAt: { attacker: 0, defender: 0 },
  };
  const gen = b.posts.at(-1)!;
  for (let i = 0; i < spec.turrets; i++) {
    const a = (i / Math.max(1, spec.turrets)) * Math.PI * 2 + 0.6;
    add(b, "defender", "turret", gen.x + Math.cos(a) * 18, gen.z + Math.sin(a) * 18);
  }
  spawnHero(b);
  return b;
}

function add(b: Battle, side: Side, kind: UnitKind, x: number, z: number): Unit {
  const hp = kind === "hero" ? Math.round(STATS.hero.hp * (1 + 0.15 * (b.spec.heroLevel - 1))) : STATS[kind].hp;
  const u: Unit = { id: b.nextId++, side, kind, x, z, yaw: side === "attacker" ? 0 : Math.PI, hp, maxHp: hp, cool: rand(b) * STATS[kind].cool, jx: (rand(b) - 0.5) * 16, jz: (rand(b) - 0.5) * 16, guard: kind === "trooper" && rand(b) < 1 / 3 };
  b.units.push(u);
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

const troopCap = (b: Battle, side: Side) => Math.min(14, 4 + b.spec.armies[side] * 3);
export const heroUnit = (b: Battle) => b.units.find((u) => u.id === b.hero.id) ?? null;
const heroTank = (b: Battle) => (b.hero.inTank === null ? null : b.units.find((u) => u.id === b.hero.inTank) ?? null);

function nearestEnemy(b: Battle, u: { x: number; z: number; side: Side }, range: number) {
  let best: Unit | null = null, bd = range;
  for (const v of b.units) {
    if (v.side === u.side || v.hp <= 0 || (v.kind === "hero" && b.hero.inTank !== null)) continue;
    const d = dist(u, v);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

function shoot(b: Battle, u: Unit, t: Unit | null, yaw = u.yaw) {
  const s = STATS[u.kind];
  u.cool = s.cool;
  if (!t) {
    const f = facing(yaw);
    b.fx.push({ kind: "shot", x: u.x, z: u.z, tx: u.x + f.x * s.range, tz: u.z + f.z * s.range, t: 0.08 });
    return;
  }
  u.yaw = yawTo(u, t);
  const hit = rand(b) < clamp(s.aim - (dist(u, t) / s.range) * 0.35, 0.1, 0.95);
  b.fx.push({ kind: "shot", x: u.x, z: u.z, tx: t.x + (hit ? 0 : (rand(b) - 0.5) * 6), tz: t.z + (hit ? 0 : (rand(b) - 0.5) * 6), t: 0.08 });
  if (!hit) return;
  if (u.kind === "tank") blast(b, u.side, t.x, t.z, 4, s.dmg);
  else damage(b, t, s.dmg);
}

function blast(b: Battle, side: Side, x: number, z: number, r: number, dmg: number) {
  b.fx.push({ kind: "blast", x, z, tx: x, tz: z, t: r > 6 ? 0.6 : 0.25 });
  for (const v of b.units) if (v.side !== side && v.hp > 0 && dist(v, { x, z }) <= r) damage(b, v, dmg);
}

function damage(b: Battle, v: Unit, dmg: number) {
  if (v.kind === "hero" && b.hero.inTank !== null) return;
  v.hp -= dmg;
}

// The side the player isn't on, and the player's own squadmates, think for themselves.
function think(b: Battle, u: Unit) {
  const s = STATS[u.kind];
  u.cool -= DT;
  const foe = nearestEnemy(b, u, s.range);
  if (foe && u.cool <= 0) shoot(b, u, foe);
  if (!s.speed) return;
  if (foe && dist(u, foe) < s.range * 0.6) return; // hold and shoot
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

function move(b: Battle, u: Unit, dx: number, dz: number, speed: number) {
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return;
  const step = Math.min(len, speed * DT);
  u.x = clamp(u.x + (dx / len) * step, -HALF, HALF);
  u.z = clamp(u.z + (dz / len) * step, -HALF, HALF);
  if (u.kind !== "hero") u.yaw = Math.atan2(-dx, -dz);
}

// Aim assist: the nearest enemy within a few degrees of where the hero is looking.
export function aimTarget(b: Battle, from: Unit, yaw: number, range: number) {
  let best: Unit | null = null, bd = range;
  for (const v of b.units) {
    if (v.side === from.side || v.hp <= 0) continue;
    const d = dist(from, v);
    if (d > bd) continue;
    let off = Math.abs(yawTo(from, v) - yaw) % (Math.PI * 2);
    if (off > Math.PI) off = Math.PI * 2 - off;
    if (off < Math.max(0.06, 2.5 / d)) { bd = d; best = v; }
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
  const hero = heroUnit(b), tank = heroTank(b);

  // The player's hero, or the tank they're driving.
  if (hero && input) {
    const body = tank ?? hero, s = STATS[body.kind];
    const f = facing(input.yaw), r = { x: -f.z, z: f.x };
    const fwd = clamp(input.forward, -1, 1), rt = clamp(input.right, -1, 1);
    move(b, body, f.x * fwd + r.x * rt, f.z * fwd + r.z * rt, s.speed * Math.min(1, Math.hypot(fwd, rt)));
    body.yaw = input.yaw;
    body.cool -= DT;
    if (input.fire && body.cool <= 0) shoot(b, body, aimTarget(b, body, input.yaw, s.range), input.yaw);
    if (input.strike) callStrike(b, hero.side, input.strike.x, input.strike.z);
    if (input.use) {
      if (tank) { b.hero.inTank = null; hero.x = tank.x + 3; hero.z = tank.z; b.events.push("Out of the tank"); }
      else {
        const t = b.units.find((v) => v.kind === "tank" && v.side === hero.side && v.hp > 0 && dist(v, hero) < 7);
        if (t) { b.hero.inTank = t.id; b.events.push("In the tank"); }
      }
    }
    if (tank) { hero.x = tank.x; hero.z = tank.z; }
  }
  for (const u of b.units) {
    if (u.hp <= 0) continue;
    if (input && (u.id === b.hero.id || u.id === b.hero.inTank)) continue;
    think(b, u);
  }
  for (const s of sides) if (!(input && s === b.spec.hero)) aiStrike(b, s);

  // Strikes land.
  for (const st of b.strikes) if ((st.t -= DT) <= 0) blast(b, st.side, st.x, st.z, STRIKE_RADIUS, 260);
  b.strikes = b.strikes.filter((st) => st.t > 0);

  // A tank going up throws its driver out hurt; the dead cost their side tickets.
  if (tank && tank.hp <= 0) {
    b.hero.inTank = null;
    if (hero) hero.hp -= 150;
    b.events.push("Your tank is destroyed");
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

  // Command posts: whoever stands alone on one turns it.
  for (const p of b.posts) {
    let att = 0, def = 0;
    for (const u of b.units) if (u.kind !== "turret" && dist(u, p) < POST_RADIUS && !(u.kind === "hero" && b.hero.inTank !== null)) u.side === "attacker" ? att++ : def++;
    if (!att === !def) continue;
    const before = p.owner;
    p.progress = clamp(p.progress + (att ? 1 : -1) * 0.12 * Math.min(4, att || def) * DT, -1, 1);
    if (p.progress >= 1) p.owner = "attacker";
    else if (p.progress <= -1) p.owner = "defender";
    else if ((p.owner === "attacker" && p.progress <= 0) || (p.owner === "defender" && p.progress >= 0)) p.owner = null;
    if (p.owner !== before) b.events.push(p.owner ? `${p.name} taken by the ${p.owner === b.spec.hero ? "your side" : "enemy"}` : `${p.name} lost`);
  }

  // Bleed, drop pods, fresh troops and tanks.
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
    const alive = (k: UnitKind) => b.units.filter((u) => u.side === s && u.kind === k).length;
    if (alive("tank") < 2 && b.vehiclesLeft[s] > 0) { const at = spawnPoint(b, s); b.vehiclesLeft[s]--; add(b, s, "tank", at.x, at.z); }
    for (let n = troopCap(b, s) - alive("trooper"); n > 0; n--) { const at = spawnPoint(b, s); add(b, s, "trooper", at.x, at.z); }
  }

  for (const f of b.fx) f.t -= DT;
  b.fx = b.fx.filter((f) => f.t > 0);
  if (b.events.length > 40) b.events.splice(0, b.events.length - 40);

  const out = sides.find((s) => b.tickets[s] <= 0);
  if (out || b.time >= TIME_LIMIT) {
    const winner = out ? other(out) : b.tickets.attacker > b.tickets.defender ? "attacker" : "defender";
    b.over = { id: b.spec.id, winner, tickets: { attacker: Math.max(0, b.tickets.attacker), defender: Math.max(0, b.tickets.defender) }, heroDown: b.hero.lives <= 0 };
  }
}

// With no input the hero fights like any other trooper: for tests, and for a battle left to the AI.
export function run(spec: BattleSpec, maxSeconds = TIME_LIMIT): Battle {
  const b = startBattle(spec);
  while (!b.over && b.time < maxSeconds) step(b, null);
  return b;
}
