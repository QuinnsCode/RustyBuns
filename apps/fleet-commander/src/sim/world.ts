// The battle: plain data and one `step`, no DOM, no three.js. Capital ships turn slowly and trade broadsides, wings of
// fighters fly in formation and break to dogfight, torpedoes are real things point defence can shoot down, and a
// planet's base burns when a ship rakes it. Everything random reads `w.rng`, so a seed and a list of orders replay
// the same battle (tests, a replay, a lockstep co-op game later).
//
// Units: one unit is about a metre at the scale the camera shows (a destroyer is 180 long), seconds for time.
// The plane is (x, z); a heading `a` points along (cos a, sin a).
import { clamp, len, nextRandom } from "@rustybuns/util";
import type { Pending } from "./plays.ts";
import { WING_CALLS, type Role, type ShipKind, type Side } from "../names.ts";

export type Stance = "attack" | "neutral" | "defend";
export type Formation = "tight" | "screen" | "loose";
export type Approach = "direct" | "left" | "right" | "rear";
/** How a captain (the AI, or a subordinate of yours) runs a ship and its wings. */
export type Doctrine = "press" | "steady" | "shield";

export type ShipOrder =
  | { k: "hold" }
  | { k: "move"; x: number; z: number }
  /** Close to gun range and turn broadside to it (broadside: hold the turn even if it means taking fire). */
  | { k: "engage"; target: number; broadside: boolean }
  /** Bombard the base on the planet's surface from low orbit. Guns on the land are guns not on ships. */
  | { k: "rake" }
  /** Sit on the hyperspace lane's mouth: the interdictor's well pulls reinforcements out short. */
  | { k: "lane" }
  /** Put the hull between a thing (a ship, or -1 the planet) and whoever threatens it. */
  | { k: "guard"; target: number }
  /** Pass a waypoint first (a flank), then engage. */
  | { k: "flank"; target: number; wx: number; wz: number; reached: boolean };

export type WingOrder =
  | { k: "attack"; target: number; targetIs: "ship" | "wing" }
  | { k: "escort"; target: number; targetIs: "ship" | "wing" }
  | { k: "patrol"; x: number; z: number }
  | { k: "return" };

export interface Ship {
  id: number; side: Side; kind: ShipKind; name: string;
  x: number; z: number; a: number; v: number;
  hull: number; hullMax: number; shield: number; shieldMax: number;
  /** When it last took a hit, and the bearings of recent hits (for split shields). */
  lastHit: number; hits: { b: number; t: number }[]; splitUntil: number;
  order: ShipOrder; gunCd: number; dead: boolean;
  /** Run by a captain AI rather than by the player's hand, with this doctrine. */
  auto: boolean; doctrine: Doctrine;
  /** A captain's focus: the ship its wings and guns go for. */
  focus: number;
  /** The ship giving it orders (the fractal: a dreadnought's destroyers point here). */
  boss: number;
  /** Dazed (pulled out of hyperspace short): no guns until then. */
  stunUntil: number;
  /** Spare craft in the hangar: a wing wiped out is rebuilt from them and relaunched. */
  reserve: number;
}

export interface Craft { id: number; x: number; z: number; vx: number; vz: number; hp: number; dead: boolean; torps: number; cd: number; foe: number }

export interface Wing {
  id: number; side: Side; role: Role; name: string; home: number;
  craft: Craft[]; stance: Stance; formation: Formation; order: WingOrder; approach: Approach;
  /** The wing's anchor: the point its craft keep formation round. */
  x: number; z: number;
  state: "docked" | "launching" | "out" | "returning";
  launchAt: number;
  /** A play holds a wing at its waypoint until its group is all there (a pincer arrives at once). */
  group: number; groupAt: number; staged: boolean; waypoint: { x: number; z: number } | null;
  /** A route drawn on the table: points to pass, in order, before the waypoint and the order. */
  route: { x: number; z: number }[];
  /** An order the play put off until a time (a feint's real strike). */
  later: { at: number; order: WingOrder; approach: Approach; stance: Stance } | null;
  size: number;
  /** When its leader last spoke, so the comms don't stutter. */
  saidAt: number;
  /** When its last craft died. */
  wipedAt: number;
}

export interface Torp { id: number; side: Side; x: number; z: number; vx: number; vz: number; target: number; ttl: number; dead: boolean }

export interface Planet { name: string; x: number; z: number; r: number; base: number; baseMax: number }

/** What dealt a hit on a ship, for the after-action report. */
export type DmgSrc = "guns" | "torps" | "craft" | "rake";
export type FxKind = "gun" | "pdc" | "bolt" | "boom" | "bigboom" | "rake" | "jump" | "torphit";
export interface Fx { n: number; k: FxKind; side: Side; x1: number; z1: number; x2: number; z2: number }

export interface Wave { at: number; done: boolean; ships: { kind: ShipKind; wings: Role[] }[] }

export interface World {
  t: number; rng: number; nextId: number;
  mode: "flagship" | "armada";
  ships: Ship[]; wings: Wing[]; torps: Torp[];
  planet: Planet; lane: { x: number; z: number };
  waves: Wave[];
  fx: Fx[]; fxN: number;
  /** Lines for the comms log: who said it and what. */
  comms: { t: number; side: Side; who: string; say: string }[];
  outcome: null | "win" | "loss" | "draw";
  why: string;
  focus: number; foresightUntil: number; tranceUntil: number; voiceUntil: number;
  /** Orders on the radio, not yet heard by the wings (they land `COMMS_LAG` s after you give them). */
  pending: Pending[];
  /** The Compact admiral: its temper (what it does when you rake) and the doctrine it runs now. */
  rimTemper: "zealot" | "pragmatist" | "cagey"; rimDoctrine: Doctrine; rimIntent: string; rimNext: number;
  flagship: number;
  limit: number;
  stats: { navyCraftLost: number; rimCraftLost: number; torpsShot: number; torpsHit: number; splits: number; shipsLost: Record<Side, number>; dealt: Record<Side, Record<DmgSrc, number>> };
  groupN: number;
}

/** A hull's numbers: size, speed, guns, point defence and what its hangar launches. */
export const HULL: Record<ShipKind, { r: number; hull: number; shield: number; speed: number; turn: number; guns: number; range: number; pd: number; pdRange: number }> = {
  dreadnought: { r: 230, hull: 16000, shield: 8000, speed: 9, turn: 0.05, guns: 220, range: 1100, pd: 14, pdRange: 220 },
  destroyer: { r: 90, hull: 6000, shield: 2600, speed: 16, turn: 0.12, guns: 90, range: 900, pd: 7, pdRange: 170 },
  frigate: { r: 40, hull: 1700, shield: 1000, speed: 30, turn: 0.4, guns: 16, range: 600, pd: 5, pdRange: 150 },
  corvette: { r: 28, hull: 500, shield: 260, speed: 40, turn: 0.6, guns: 9, range: 500, pd: 4, pdRange: 130 },
  cruiser: { r: 75, hull: 2200, shield: 1300, speed: 14, turn: 0.15, guns: 30, range: 850, pd: 6, pdRange: 160 },
  carrier: { r: 80, hull: 1900, shield: 900, speed: 12, turn: 0.12, guns: 10, range: 600, pd: 7, pdRange: 170 },
  station: { r: 85, hull: 3000, shield: 2200, speed: 0, turn: 0, guns: 30, range: 900, pd: 9, pdRange: 190 },
};

/** A craft's numbers by role: speed, hit points, gun damage a second, and what it is good against. */
export const CRAFT: Record<Role, { speed: number; hp: number; dps: number; vs: Record<Role, number>; vsShip: number; torps: number }> = {
  interceptor: { speed: 150, hp: 22, dps: 9, vs: { interceptor: 1, bomber: 1.6, escort: 0.6 }, vsShip: 1.5, torps: 0 },
  bomber: { speed: 85, hp: 34, dps: 4, vs: { interceptor: 0.5, bomber: 0.6, escort: 0.4 }, vsShip: 1, torps: 2 },
  escort: { speed: 115, hp: 44, dps: 8, vs: { interceptor: 1.4, bomber: 1, escort: 1 }, vsShip: 2, torps: 0 },
};

export const TORP = { speed: 190, dmg: 240, ttl: 9, bypass: 0.3, launch: 340 };
export const DT = 0.1;
export const FOCUS = { foresight: 40, trance: 60, voice: 25, foresightS: 25, tranceS: 15, voiceS: 40 };
/** Seconds an order to the wings spends on the radio before they act on it; Command Voice makes it none. */
export const COMMS_LAG = 2;
export type Power = "foresight" | "trance" | "voice";

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
export const rand = (w: World) => nextRandom(w, "rng");
const dist = (ax: number, az: number, bx: number, bz: number) => len(bx - ax, bz - az);

export function emptyWorld(seed: number, mode: World["mode"] = "flagship"): World {
  return {
    t: 0, rng: seed >>> 0, nextId: 1, mode, ships: [], wings: [], torps: [],
    planet: { name: "Vael", x: 0, z: 0, r: 420, base: 2600, baseMax: 2600 }, lane: { x: 0, z: 0 },
    waves: [], fx: [], fxN: 0, comms: [], outcome: null, why: "",
    focus: 30, foresightUntil: 0, tranceUntil: 0, voiceUntil: 0, pending: [],
    rimTemper: "zealot", rimDoctrine: "steady", rimIntent: "", rimNext: 0,
    flagship: 0, limit: 480,
    stats: { navyCraftLost: 0, rimCraftLost: 0, torpsShot: 0, torpsHit: 0, splits: 0, shipsLost: { navy: 0, rim: 0 }, dealt: { navy: { guns: 0, torps: 0, craft: 0, rake: 0 }, rim: { guns: 0, torps: 0, craft: 0, rake: 0 } } },
    groupN: 0,
  };
}

export function addShip(w: World, side: Side, kind: ShipKind, name: string, x: number, z: number, a: number, auto: boolean): Ship {
  const h = HULL[kind];
  const s: Ship = {
    id: w.nextId++, side, kind, name, x, z, a, v: 0, hull: h.hull, hullMax: h.hull, shield: h.shield, shieldMax: h.shield,
    lastHit: -99, hits: [], splitUntil: 0, order: { k: "hold" }, gunCd: rand(w) * 2, dead: false, auto, doctrine: "steady", focus: 0, boss: 0, stunUntil: 0, reserve: 0,
  };
  w.ships.push(s);
  return s;
}

/** A wing in `home`'s hangar, launched at `at` seconds (docked until then). */
export function addWing(w: World, home: Ship, role: Role, name: string, size: number, at = 0): Wing {
  const g: Wing = {
    id: w.nextId++, side: home.side, role, name, home: home.id, craft: [], stance: "neutral", formation: role === "bomber" ? "tight" : "screen",
    order: { k: "escort", target: home.id, targetIs: "ship" }, approach: "direct", x: home.x, z: home.z,
    state: "launching", launchAt: at, group: 0, groupAt: 0, staged: true, waypoint: null, later: null, route: [], size, saidAt: -99, wipedAt: 0,
  };
  w.wings.push(g);
  return g;
}

export const ship = (w: World, id: number) => w.ships.find((s) => s.id === id && !s.dead);
export const wing = (w: World, id: number) => w.wings.find((g) => g.id === id);
export const alive = (g: Wing) => g.craft.filter((c) => !c.dead);
export const flagship = (w: World) => ship(w, w.flagship);

export function say(w: World, side: Side, who: string, line: string) {
  w.comms.push({ t: w.t, side, who, say: line });
  if (w.comms.length > 60) w.comms.splice(0, w.comms.length - 60);
}

function fx(w: World, k: FxKind, side: Side, x1: number, z1: number, x2 = x1, z2 = z1) {
  w.fx.push({ n: ++w.fxN, k, side, x1, z1, x2, z2 });
  if (w.fx.length > 900) w.fx.splice(0, w.fx.length - 900);
}

const powered = (w: World, side: Side, k: "trance") => side === "navy" && k === "trance" && w.t < w.tranceUntil;

/** Where a thing is: a ship, a wing's anchor, or the planet (-1). */
function pos(w: World, id: number, is: "ship" | "wing"): { x: number; z: number } | null {
  if (id === -1) return w.planet;
  if (is === "ship") return ship(w, id) ?? null;
  const g = wing(w, id);
  return g && g.state === "out" && alive(g).length ? g : null;
}

// ---------------------------------------------------------------- damage

/** A hit on a ship from bearing `fromX, fromZ`: shields take it first, best from the front; the flank and the rear
 *  get more through, and two hits from far-apart arcs inside four seconds split the shields (both halve). */
export function hitShip(w: World, s: Ship, dmg: number, fromX: number, fromZ: number, bypass = 0, side: Side = s.side === "navy" ? "rim" : "navy", src: DmgSrc = "guns") {
  if (s.dead) return;
  w.stats.dealt[side][src] += dmg;
  const bearing = wrap(Math.atan2(fromZ - s.z, fromX - s.x) - s.a);
  const off = Math.abs(bearing);
  // How well the shield holds from this arc: 1 dead ahead, 0.4 from behind.
  let hold = off < Math.PI / 4 ? 1 : off < (3 * Math.PI) / 4 ? 0.72 : 0.4;
  if (side === "navy" && w.t < w.foresightUntil && hold < 1) hold *= 0.8;
  s.hits = s.hits.filter((h) => w.t - h.t < 4);
  if (s.hits.some((h) => Math.abs(wrap(h.b - bearing)) > (100 * Math.PI) / 180) && w.t >= s.splitUntil) {
    s.splitUntil = w.t + 6;
    w.stats.splits++;
    if (side === "navy") say(w, "navy", "Tactical", `${s.name}'s shields are split. Pour it on.`);
    else if (s.id === w.flagship) say(w, "navy", "Shields", "They're hitting us from both sides, shields split!");
  }
  s.hits.push({ b: bearing, t: w.t });
  if (w.t < s.splitUntil) hold *= 0.5;
  const through = dmg * Math.max(bypass, 1 - hold);
  let onShield = dmg - through;
  const soaked = Math.min(s.shield, onShield);
  s.shield -= soaked;
  onShield -= soaked;
  s.hull -= through + onShield;
  s.lastHit = w.t;
  if (s.hull <= 0) sink(w, s);
}

function sink(w: World, s: Ship) {
  s.dead = true; s.hull = 0;
  w.stats.shipsLost[s.side]++;
  fx(w, "bigboom", s.side, s.x, s.z, HULL[s.kind].r, 0);
  if (s.side === "rim") { w.focus = Math.min(100, w.focus + 15); say(w, "navy", "Tactical", `${s.name} is breaking up.`); }
  else say(w, "navy", "Comms", `We've lost the ${s.name}.`);
  // Its wings have no deck to land on: they fight on.
  for (const g of w.wings) if (g.home === s.id && g.state !== "out") g.state = "out";
}

function hitCraft(w: World, g: Wing, c: Craft, dmg: number) {
  if (c.dead) return;
  c.hp -= dmg;
  if (c.hp > 0) return;
  c.dead = true;
  fx(w, "boom", g.side, c.x, c.z);
  if (g.side === "rim") { w.stats.rimCraftLost++; w.focus = Math.min(100, w.focus + 2.5); }
  else w.stats.navyCraftLost++;
  if (!alive(g).length) g.wipedAt = w.t;
  if (!alive(g).length && g.state === "out") say(w, g.side, g.name, g.side === "navy" ? `${g.name} wing is gone.` : "We're finished, scatter!");
}

// ---------------------------------------------------------------- capital ships

function steerShip(w: World, s: Ship, gx: number, gz: number, faceA: number | null, dt: number) {
  const h = HULL[s.kind];
  if (!h.speed) return;
  const d = dist(s.x, s.z, gx, gz);
  const want = d > 30 ? Math.atan2(gz - s.z, gx - s.x) : (faceA ?? s.a);
  const turnTo = d > 30 && faceA !== null && d < 160 ? faceA : want;
  const da = wrap(turnTo - s.a);
  s.a = wrap(s.a + clamp(da, -h.turn * dt, h.turn * dt));
  const speedWant = d > 30 ? h.speed * clamp(d / 200, 0.25, 1) * (Math.abs(wrap(want - s.a)) > 1.2 ? 0.35 : 1) : 0;
  s.v += clamp(speedWant - s.v, -h.speed * 0.3 * dt, h.speed * 0.3 * dt);
  s.x += Math.cos(s.a) * s.v * dt;
  s.z += Math.sin(s.a) * s.v * dt;
}

/** Where a ship of `side` shields `target` from: on the line from it to the nearest enemy capital, `k` of the way. */
function guardPoint(w: World, s: Ship, tx: number, tz: number, r: number) {
  const foe = nearestShip(w, s.side === "navy" ? "rim" : "navy", tx, tz, (o) => o.kind !== "station");
  if (!foe) return { x: tx, z: tz };
  const d = Math.max(1, dist(tx, tz, foe.x, foe.z));
  const k = Math.min(d * 0.5, r + 160);
  return { x: tx + ((foe.x - tx) / d) * k, z: tz + ((foe.z - tz) / d) * k };
}

export function nearestShip(w: World, side: Side, x: number, z: number, ok: (s: Ship) => boolean = () => true) {
  let best: Ship | undefined, bd = Infinity;
  for (const s of w.ships) if (!s.dead && s.side === side && ok(s)) { const d = dist(x, z, s.x, s.z); if (d < bd) { bd = d; best = s; } }
  return best;
}

/** The spot in low orbit a raking ship fires from: the planet's rim on the side it comes from. */
export function orbitPoint(w: World, s: { x: number; z: number }) {
  const p = w.planet, d = Math.max(1, dist(p.x, p.z, s.x, s.z)), r = p.r + 230;
  return { x: p.x + ((s.x - p.x) / d) * r, z: p.z + ((s.z - p.z) / d) * r };
}

function moveShip(w: World, s: Ship, dt: number) {
  const o = s.order;
  if (o.k === "hold") return steerShip(w, s, s.x, s.z, null, dt);
  if (o.k === "move") return steerShip(w, s, o.x, o.z, null, dt);
  if (o.k === "lane") return steerShip(w, s, w.lane.x, w.lane.z, null, dt);
  if (o.k === "rake") {
    const at = orbitPoint(w, s);
    const toPlanet = Math.atan2(w.planet.z - s.z, w.planet.x - s.x);
    return steerShip(w, s, at.x, at.z, wrap(toPlanet + Math.PI / 2), dt);
  }
  if (o.k === "guard") {
    const t = o.target === -1 ? w.planet : ship(w, o.target);
    if (!t) { s.order = { k: "hold" }; return; }
    const g = guardPoint(w, s, t.x, t.z, o.target === -1 ? w.planet.r : HULL[(t as Ship).kind].r);
    return steerShip(w, s, g.x, g.z, null, dt);
  }
  const t = ship(w, o.target);
  if (!t) { s.order = { k: "hold" }; return; }
  if (o.k === "flank" && !o.reached) {
    if (dist(s.x, s.z, o.wx, o.wz) < 120) o.reached = true;
    return steerShip(w, s, o.wx, o.wz, null, dt);
  }
  // Engage: sit at 70% of gun range, side on.
  const range = HULL[s.kind].range * 0.7, d = Math.max(1, dist(s.x, s.z, t.x, t.z));
  const toT = Math.atan2(t.z - s.z, t.x - s.x);
  const side = wrap(s.a - toT) > 0 ? 1 : -1;
  const face = wrap(toT + (side * Math.PI) / 2);
  const gx = t.x - ((t.x - s.x) / d) * range, gz = t.z - ((t.z - s.z) / d) * range;
  steerShip(w, s, gx, gz, d < range * 1.25 ? face : null, dt);
}

/** How much of a ship's guns bear on a bearing: broadside full, ahead some, astern little. */
export function bearFactor(s: Ship, tx: number, tz: number) {
  const b = Math.abs(wrap(Math.atan2(tz - s.z, tx - s.x) - s.a));
  const side = Math.sin(b);
  if (s.kind === "station") return 1;
  return b > (3 * Math.PI) / 4 ? 0.3 : side > 0.7 ? 1 : 0.55;
}

function shipGuns(w: World, s: Ship, dt: number) {
  const h = HULL[s.kind];
  if (w.t < s.stunUntil) return;
  // Shields come back after three quiet seconds.
  if (w.t - s.lastHit > 3) s.shield = Math.min(s.shieldMax, s.shield + s.shieldMax * 0.03 * dt);
  pointDefence(w, s, dt);
  s.gunCd -= dt;
  if (s.gunCd > 0) return;
  s.gunCd = 2;
  const vol = h.guns * 2;
  if (s.order.k === "rake") {
    const at = orbitPoint(w, s);
    if (dist(s.x, s.z, at.x, at.z) < 260) return rake(w, s, vol);
  }
  const foeSide: Side = s.side === "navy" ? "rim" : "navy";
  const o = s.order;
  const want = o.k === "engage" || o.k === "flank" ? ship(w, o.target) : s.focus ? ship(w, s.focus) : undefined;
  const target = want && dist(s.x, s.z, want.x, want.z) <= h.range ? want : nearestShip(w, foeSide, s.x, s.z, (t) => dist(s.x, s.z, t.x, t.z) <= h.range);
  if (target) {
    let f = bearFactor(s, target.x, target.z);
    if (o.k === "engage" && o.broadside && f === 1) f = 1.4;
    hitShip(w, target, vol * f, s.x, s.z, 0, s.side);
    const n = Math.round(3 + f * 4);
    for (let i = 0; i < n; i++) {
      const sp = HULL[target.kind].r * 0.8;
      fx(w, "bolt", s.side, s.x + (rand(w) - 0.5) * h.r, s.z + (rand(w) - 0.5) * h.r * 0.5, target.x + (rand(w) - 0.5) * sp, target.z + (rand(w) - 0.5) * sp);
    }
    return;
  }
  // No ship in range: the batteries walk onto a wing (they are poor at it).
  const g = w.wings.find((g) => g.side === foeSide && g.state === "out" && alive(g).length && dist(s.x, s.z, g.x, g.z) < h.range * 0.6);
  if (g) {
    const c = alive(g)[Math.floor(rand(w) * alive(g).length)];
    if (rand(w) < 0.12) hitCraft(w, g, c, 30);
    fx(w, "bolt", s.side, s.x, s.z, c.x + (rand(w) - 0.5) * 40, c.z + (rand(w) - 0.5) * 40);
  }
}

function rake(w: World, s: Ship, vol: number) {
  const p = w.planet;
  // Compact hulls parked on the line to the planet take the fire meant for the land, 70% of it.
  const shield = w.ships.find((o) => !o.dead && o.side !== s.side && o.kind !== "station" && segDist(s.x, s.z, p.x, p.z, o.x, o.z) < HULL[o.kind].r + 60 && dist(s.x, s.z, o.x, o.z) < dist(s.x, s.z, p.x, p.z));
  let toLand = vol * 0.9;
  if (shield) {
    hitShip(w, shield, toLand * 0.7, s.x, s.z, 0, s.side, "rake");
    toLand *= 0.3;
    fx(w, "bolt", s.side, s.x, s.z, shield.x, shield.z);
  }
  // The orbital bastion's shield over the base: while it stands, a quarter gets through.
  const bastion = w.ships.find((o) => !o.dead && o.kind === "station" && o.side !== s.side);
  if (bastion) toLand *= 0.25;
  w.stats.dealt[s.side].rake += Math.min(p.base, toLand);
  p.base = Math.max(0, p.base - toLand);
  for (let i = 0; i < 6; i++) {
    const a = Math.atan2(s.z - p.z, s.x - p.x) + (rand(w) - 0.5) * 0.9;
    fx(w, "rake", s.side, s.x + (rand(w) - 0.5) * 80, s.z + (rand(w) - 0.5) * 40, p.x + Math.cos(a) * p.r * 0.8, p.z + Math.sin(a) * p.r * 0.8);
  }
}

function segDist(ax: number, az: number, bx: number, bz: number, px: number, pz: number) {
  const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
  const k = clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1);
  return dist(px, pz, ax + vx * k, az + vz * k);
}

/** The point defence cannons: a few bursts a second at torpedoes first, then craft. A loose wing is hard to track. */
function pointDefence(w: World, s: Ship, dt: number) {
  const h = HULL[s.kind];
  let shots = h.pd * dt;
  const foe: Side = s.side === "navy" ? "rim" : "navy";
  while (shots > 0) {
    if (shots < 1 && rand(w) > shots) break;
    shots -= 1;
    const t = w.torps.find((t) => !t.dead && t.side === foe && dist(s.x, s.z, t.x, t.z) < h.pdRange);
    if (t) {
      fx(w, "pdc", s.side, s.x, s.z, t.x, t.z);
      if (rand(w) < 0.32) { t.dead = true; w.stats.torpsShot++; fx(w, "boom", foe, t.x, t.z); }
      continue;
    }
    const g = w.wings.find((g) => g.side === foe && g.state === "out" && alive(g).some((c) => dist(s.x, s.z, c.x, c.z) < h.pdRange));
    if (!g) break;
    const c = alive(g).find((c) => dist(s.x, s.z, c.x, c.z) < h.pdRange)!;
    fx(w, "pdc", s.side, s.x, s.z, c.x, c.z);
    const evade = g.formation === "loose" ? 0.5 : g.formation === "tight" ? 1.3 : 1;
    if (rand(w) < 0.16 * evade) hitCraft(w, g, c, 14);
  }
}

// ---------------------------------------------------------------- wings

const slot = (g: Wing, i: number, n: number, heading: number) => {
  const px = -Math.sin(heading), pz = Math.cos(heading), fx_ = Math.cos(heading), fz = Math.sin(heading);
  if (g.formation === "tight") {
    // A chevron: the leader ahead, pairs swept back.
    const rank = Math.ceil(i / 2), sideS = i % 2 ? 1 : -1;
    return { x: -fx_ * rank * 14 + px * sideS * rank * 12, z: -fz * rank * 14 + pz * sideS * rank * 12 };
  }
  if (g.formation === "screen") {
    const k = (i - (n - 1) / 2) * 32;
    return { x: px * k, z: pz * k };
  }
  // Loose: a wide scatter, fixed per craft so it doesn't jitter.
  const a = i * 2.39996, r = 30 + (i % 3) * 24;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
};

/** Where the wing is headed now: its order's target, by way of its approach waypoint. */
function wingGoal(w: World, g: Wing): { x: number; z: number } | null {
  const home = ship(w, g.home);
  if (g.state === "returning") return home ?? null;
  const o = g.order;
  if (o.k === "return") return home ?? null;
  if (g.route.length) return g.route[0];
  if (o.k === "patrol") return o;
  const t = pos(w, o.target, o.targetIs);
  if (!t) return null;
  if (o.k === "escort") {
    // Ride on the threat side of the charge.
    const foe = nearestShip(w, g.side === "navy" ? "rim" : "navy", t.x, t.z);
    if (!foe) return t;
    const d = Math.max(1, dist(t.x, t.z, foe.x, foe.z)), k = o.targetIs === "ship" ? 160 : 50;
    return { x: t.x + ((foe.x - t.x) / d) * k, z: t.z + ((foe.z - t.z) / d) * k };
  }
  // Waiting at the waypoint until the play releases the group.
  if (g.waypoint) return g.waypoint;
  if (g.role === "bomber" && o.targetIs === "ship") {
    // Bombers stand off at launch range on their approach side.
    const d = Math.max(1, dist(g.x, g.z, t.x, t.z));
    return d > TORP.launch * 0.8 ? t : { x: g.x, z: g.z };
  }
  return t;
}

/** The waypoint of an approach on a ship: off its left or right flank, or behind it. */
export function approachPoint(w: World, from: { x: number; z: number }, target: Ship, how: Approach) {
  if (how === "direct") return null;
  const r = 760;
  if (how === "rear") return { x: target.x - Math.cos(target.a) * r, z: target.z - Math.sin(target.a) * r };
  // Left and right as the attacker sees it, coming from `from`.
  const a = Math.atan2(target.z - from.z, target.x - from.x) + (how === "left" ? -1 : 1) * 1.25;
  return { x: target.x - Math.cos(a) * r, z: target.z - Math.sin(a) * r };
}

function launch(w: World, g: Wing) {
  const home = ship(w, g.home);
  if (!home) { g.state = "out"; return; }
  if (w.t < g.launchAt) return;
  g.state = "out";
  g.x = home.x; g.z = home.z;
  const stats = CRAFT[g.role];
  if (!g.craft.length) for (let i = 0; i < g.size; i++) g.craft.push({ id: w.nextId++, x: 0, z: 0, vx: Math.cos(home.a) * 40, vz: Math.sin(home.a) * 40, hp: stats.hp, dead: false, torps: stats.torps, cd: rand(w) * 2, foe: 0 });
  for (const c of alive(g)) { c.x = home.x + (rand(w) - 0.5) * 50; c.z = home.z + (rand(w) - 0.5) * 50; c.torps = stats.torps; c.hp = stats.hp; }
  say(w, g.side, g.name, g.side === "navy" ? `${g.name} wing, launching.` : `${g.name} flight is up.`);
}

function nearestFoeCraft(w: World, g: Wing, x: number, z: number, r: number, prefer?: Role) {
  let best: { g: Wing; c: Craft } | null = null, bd = r;
  for (const o of w.wings) {
    if (o.side === g.side || o.state !== "out") continue;
    for (const c of o.craft) {
      if (c.dead) continue;
      const d = dist(x, z, c.x, c.z) * (prefer && o.role === prefer ? 0.6 : 1);
      if (d < bd) { bd = d; best = { g: o, c }; }
    }
  }
  return best;
}

const ENGAGE: Record<Stance, number> = { attack: 360, neutral: 250, defend: 170 };

function stepWing(w: World, g: Wing, dt: number) {
  if (g.state === "docked") return;
  if (g.state === "launching") return launch(w, g);
  const live = alive(g);
  if (!live.length) {
    // A wing wiped out is rebuilt from its ship's spare craft 20 s later, while the ship lives.
    const home = ship(w, g.home);
    if (home && home.reserve >= 2 && g.craft.length && w.t - g.wipedAt > 20) {
      g.size = Math.min(g.size, home.reserve); home.reserve -= g.size;
      g.craft = []; g.state = "launching"; g.launchAt = w.t + 2; g.waypoint = null; g.later = null; g.route = [];
      g.order = { k: "escort", target: home.id, targetIs: "ship" };
    }
    return;
  }
  const st = CRAFT[g.role];
  // Out of torpedoes: bombers go home to rearm.
  if (g.role === "bomber" && g.state === "out" && live.every((c) => c.torps === 0) && ship(w, g.home)) {
    g.state = "returning";
    say(w, g.side, g.name, g.side === "navy" ? "Racks empty, heading home." : "Out of fish, coming back.");
  }
  const goal = wingGoal(w, g);
  // A target that died: fall back to escorting home.
  if (!goal && g.state === "out") {
    const home = ship(w, g.home) ?? flagshipOf(w, g.side);
    g.order = home ? { k: "escort", target: home.id, targetIs: "ship" } : { k: "patrol", x: g.x, z: g.z };
    g.waypoint = null; g.route = [];
    return;
  }
  if (goal) {
    const d = dist(g.x, g.z, goal.x, goal.z);
    const sp = st.speed * (g.formation === "tight" ? 1.05 : 1);
    if (d > 1) { const k = Math.min(1, (sp * dt) / d); g.x += (goal.x - g.x) * k; g.z += (goal.z - g.z) * k; }
    // On a drawn route: past this point, on to the next. The group's clock starts once the route is flown.
    if (g.route.length && goal === g.route[0] && dist(g.x, g.z, goal.x, goal.z) < 40) { g.route.shift(); if (!g.route.length) g.groupAt = w.t; }
    if (g.state === "returning" && d < 60) {
      g.state = "launching"; g.launchAt = w.t + 6;
      g.order = { k: "escort", target: g.home, targetIs: "ship" }; g.waypoint = null; g.route = [];
      for (const c of live) { c.torps = st.torps; c.hp = st.hp; }
      return;
    }
  }
  const heading = goal ? Math.atan2(goal.z - g.z, goal.x - g.x) : 0;
  const tranceMul = powered(w, g.side, "trance") ? 1.35 : g.side === "rim" && w.t < w.tranceUntil ? 0.8 : 1;
  const atk = g.stance === "attack" ? 1.25 : g.stance === "defend" ? 0.85 : 1;
  const o = g.order;
  const chargePos = o.k === "escort" ? pos(w, o.target, o.targetIs) : null;
  live.forEach((c, i) => {
    c.cd -= dt;
    // Who to fight: dogfights inside the stance's radius (round the charge when escorting).
    const centre = chargePos && g.stance === "defend" ? chargePos : c;
    let foe = g.state === "out" && g.role !== "bomber" ? nearestFoeCraft(w, g, centre.x, centre.z, ENGAGE[g.stance], g.role === "interceptor" ? "bomber" : undefined) : null;
    if (o.k === "attack" && o.targetIs === "wing" && g.role !== "bomber") {
      const tg = wing(w, o.target);
      const tc = tg && alive(tg).sort((p, q) => dist(c.x, c.z, p.x, p.z) - dist(c.x, c.z, q.x, q.z))[0];
      if (tg && tc && dist(c.x, c.z, tc.x, tc.z) < 420) foe = { g: tg, c: tc };
    }
    let dx: number, dz: number;
    if (foe) { dx = foe.c.x; dz = foe.c.z; }
    else { const s = slot(g, i, live.length, heading); dx = g.x + s.x; dz = g.z + s.z; }
    // Steer: craft turn hard but not instantly; a loose wing jinks.
    const want = Math.atan2(dz - c.z, dx - c.x), dd = dist(c.x, c.z, dx, dz);
    const speed = st.speed * (foe ? 1.15 : clamp(dd / 30, 0.6, 1.4));
    const jink = g.formation === "loose" ? Math.sin(w.t * 3 + i) * 0.5 : 0;
    const tvx = Math.cos(want + jink) * speed, tvz = Math.sin(want + jink) * speed;
    c.vx += (tvx - c.vx) * Math.min(1, dt * 3.2);
    c.vz += (tvz - c.vz) * Math.min(1, dt * 3.2);
    c.x += c.vx * dt; c.z += c.vz * dt;
    c.foe = foe?.c.id ?? 0;
    if (g.state !== "out") return;
    // Guns on a craft.
    if (foe && dist(c.x, c.z, foe.c.x, foe.c.z) < 70) {
      const foeTrance = foe.g.side === "navy" && powered(w, "navy", "trance") ? 0.8 : 1;
      const evade = foe.g.formation === "loose" ? 0.8 : foe.g.formation === "tight" ? 1.1 : 1;
      const foeDef = foe.g.stance === "defend" ? 0.75 : foe.g.stance === "attack" ? 1.15 : 1;
      hitCraft(w, foe.g, foe.c, st.dps * st.vs[foe.g.role] * atk * tranceMul * foeTrance * evade * foeDef * dt * (0.55 + rand(w) * 0.5));
      if (c.cd <= 0) { c.cd = 0.35 + rand(w) * 0.3; fx(w, "gun", g.side, c.x, c.z, foe.c.x, foe.c.z); }
      return;
    }
    // Shooting down torpedoes: escorts and interceptors near one.
    if (g.role !== "bomber") {
      const t = w.torps.find((t) => !t.dead && t.side !== g.side && dist(c.x, c.z, t.x, t.z) < 60);
      if (t && rand(w) < (g.role === "escort" ? 0.9 : 0.5) * dt * 4) { t.dead = true; w.stats.torpsShot++; fx(w, "gun", g.side, c.x, c.z, t.x, t.z); fx(w, "boom", t.side, t.x, t.z); return; }
    }
    if (o.k !== "attack" || o.targetIs !== "ship") return;
    const ts = ship(w, o.target);
    if (!ts) return;
    const d = dist(c.x, c.z, ts.x, ts.z);
    if (g.role === "bomber") {
      // Only once past the waypoint (staged): a flanking run looses from the flank.
      if (g.staged && c.torps > 0 && c.cd <= 0 && d < TORP.launch) {
        c.torps--; c.cd = 1.8 + rand(w);
        const a = Math.atan2(ts.z - c.z, ts.x - c.x);
        w.torps.push({ id: w.nextId++, side: g.side, x: c.x, z: c.z, vx: Math.cos(a) * TORP.speed, vz: Math.sin(a) * TORP.speed, target: ts.id, ttl: TORP.ttl, dead: false });
        if (w.t - g.saidAt > 6) { g.saidAt = w.t; say(w, g.side, g.name, g.side === "navy" ? "Torpedoes away!" : "Fish in the water!"); }
      }
      return;
    }
    // Fighters strafing a hull: small, but it adds up and draws the point defence.
    if (d < HULL[ts.kind].r + 60) {
      hitShip(w, ts, st.dps * st.vsShip * atk * tranceMul * dt, c.x, c.z, 0.2, g.side, "craft");
      if (c.cd <= 0) { c.cd = 0.5; fx(w, "gun", g.side, c.x, c.z, ts.x + (rand(w) - 0.5) * 30, ts.z + (rand(w) - 0.5) * 30); }
    }
  });
}

const flagshipOf = (w: World, side: Side) => side === "navy" ? flagship(w) : w.ships.find((s) => !s.dead && s.side === side && s.kind !== "station");

function stepTorps(w: World, dt: number) {
  for (const t of w.torps) {
    if (t.dead) continue;
    t.ttl -= dt;
    const s = ship(w, t.target);
    if (!s || t.ttl <= 0) { t.dead = true; continue; }
    const a = Math.atan2(s.z - t.z, s.x - t.x);
    t.vx += (Math.cos(a) * TORP.speed - t.vx) * Math.min(1, dt * 2.5);
    t.vz += (Math.sin(a) * TORP.speed - t.vz) * Math.min(1, dt * 2.5);
    t.x += t.vx * dt; t.z += t.vz * dt;
    if (dist(t.x, t.z, s.x, s.z) < HULL[s.kind].r * 0.8) {
      t.dead = true; w.stats.torpsHit++;
      hitShip(w, s, TORP.dmg, t.x - t.vx, t.z - t.vz, TORP.bypass, t.side, "torps");
      fx(w, "torphit", t.side, t.x, t.z);
    }
  }
  w.torps = w.torps.filter((t) => !t.dead);
}

/** A play's waiting arms: once every wing of a group is at its waypoint they all go at once (a pincer lands both
 *  arms together). A group whose other arm is lost or stuck goes anyway after 25 s. */
export function releaseGroups(w: World) {
  const groups = new Map<number, Wing[]>();
  for (const g of w.wings) if (g.group && g.waypoint && alive(g).length && g.state === "out") groups.set(g.group, [...(groups.get(g.group) ?? []), g]);
  for (const [, gs] of groups) {
    const ready = gs.every((g) => dist2(g, g.waypoint!) < 3600) || w.t - Math.min(...gs.map((g) => g.groupAt)) > 18;
    if (!ready) continue;
    for (const g of gs) { g.waypoint = null; g.staged = true; }
    const lead = gs[0];
    if (gs.length > 1 || lead.approach !== "direct") say(w, lead.side, lead.name, lead.side === "navy" ? "In position. Going in, all together!" : "Now, from every side!");
  }
  // A feint's held strike takes its approach waypoint when it breaks cover.
  for (const g of w.wings) {
    if (g.later && w.t >= g.later.at && g.later.order.k === "attack") {
      const t = ship(w, g.later.order.target);
      g.order = g.later.order; g.stance = g.later.stance; g.approach = g.later.approach; g.later = null;
      say(w, g.side, g.name, g.side === "navy" ? "Breaking cover, going in." : "Now! Hit them now!");
      if (t) { const wp = approachPoint(w, g, t, g.approach); g.waypoint = wp; g.staged = !wp; g.groupAt = w.t; }
    }
  }
}

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

// ---------------------------------------------------------------- the clock

export type Brain = (w: World) => void;

/** One fixed tick of the battle. `brains` are the captains and admirals that think this tick (AI, subordinates). */
export function step(w: World, brains: Brain[] = []) {
  if (w.outcome) return;
  const dt = DT;
  w.t = Math.round((w.t + dt) * 1000) / 1000;
  w.focus = Math.min(100, w.focus + 1.2 * dt);
  for (const b of brains) b(w);
  releaseGroups(w);
  for (const wave of w.waves) if (!wave.done && w.t >= wave.at) arrive(w, wave);
  for (const s of w.ships) if (!s.dead) { moveShip(w, s, dt); shipGuns(w, s, dt); }
  for (const g of w.wings) stepWing(w, g, dt);
  stepTorps(w, dt);
  judge(w);
}

/** Reinforcements out of the hyperspace lane. With a navy hull sitting on the lane's mouth, its gravity well drags
 *  them out early, right on top of it, shields down and dazed; otherwise they drop in behind your flagship. */
function arrive(w: World, wave: Wave) {
  wave.done = true;
  const warden = w.ships.find((s) => !s.dead && s.side === "navy" && dist(s.x, s.z, w.lane.x, w.lane.z) < 320);
  const fl = flagship(w);
  const at = warden ? { x: w.lane.x, z: w.lane.z } : fl ? { x: fl.x - Math.cos(fl.a) * 900, z: fl.z - Math.sin(fl.a) * 900 } : w.lane;
  const toward = fl ? Math.atan2(fl.z - at.z, fl.x - at.x) : 0;
  wave.ships.forEach((spec, i) => {
    const s = addShip(w, "rim", spec.kind, `${rimShipName(w)}`, at.x + (i - (wave.ships.length - 1) / 2) * 160 * Math.cos(toward + Math.PI / 2), at.z + (i - (wave.ships.length - 1) / 2) * 160 * Math.sin(toward + Math.PI / 2), toward, true);
    s.order = fl ? { k: "engage", target: fl.id, broadside: false } : { k: "hold" };
    if (warden) { s.shield = 0; s.stunUntil = w.t + 8; }
    fx(w, "jump", "rim", s.x, s.z, s.x - Math.cos(toward) * 600, s.z - Math.sin(toward) * 600);
    spec.wings.forEach((role, j) => addWing(w, s, role, nextCall(w, "rim"), role === "bomber" ? 4 : 5, w.t + 4 + j * 3));
  });
  say(w, "navy", "Sensors", warden ? `Compact ships ripped out of hyperspace on top of the ${warden.name}! Shields down, hit them now.` : "Compact ships out of hyperspace behind us!");
}

const RIM_SHIPS = ["Defiance", "Long Night", "Hearthfire", "Free Wind", "Last Harvest", "Unbowed", "Kindred", "Tallowmere", "Stonebreak", "Open Hand"];
export function rimShipName(w: World) { return RIM_SHIPS[w.ships.filter((s) => s.side === "rim").length % RIM_SHIPS.length]; }

export function nextCall(w: World, side: Side) {
  const calls = WING_CALLS[side];
  const n = w.wings.filter((g) => g.side === side).length;
  return calls[n % calls.length] + (n >= calls.length ? ` ${Math.floor(n / calls.length) + 1}` : "");
}

function judge(w: World) {
  const fl = flagship(w);
  if (!fl) { w.outcome = "loss"; w.why = "Your flagship is gone."; return; }
  if (w.planet.base <= 0) { w.outcome = "win"; w.why = `The Compact base on ${w.planet.name} burns.`; return; }
  const rimLeft = w.ships.some((s) => !s.dead && s.side === "rim") || w.waves.some((v) => !v.done);
  if (!rimLeft) { w.outcome = "win"; w.why = `Every Compact hull over ${w.planet.name} is broken. The base is yours to take.`; return; }
  if (w.t >= w.limit) { w.outcome = "draw"; w.why = "Time: the Compact holds on long enough to evacuate."; }
}

/** Spend focus on a power. Returns whether it took. */
export function usePower(w: World, p: Power): boolean {
  const cost = FOCUS[p];
  if (w.focus < cost || w.outcome) return false;
  w.focus -= cost;
  if (p === "foresight") { w.foresightUntil = w.t + FOCUS.foresightS; say(w, "navy", "You", "I see what they mean to do."); }
  else if (p === "trance") { w.tranceUntil = w.t + FOCUS.tranceS; say(w, "navy", "You", "Every pilot, with me. Feel the battle."); }
  else { w.voiceUntil = w.t + FOCUS.voiceS; say(w, "navy", "You", "All wings, hear me. Move when I say."); }
  return true;
}
