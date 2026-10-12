// The strategy layer: a deterministic rules engine over plain JSON. A turn is income and
// building, simultaneous moves, space battles, landings, ground battles, then upkeep (cannon
// fire, bombardment, supply, income). One ground
// battle a turn can be handed to the player as a hero battle; the turn pauses on it until the
// BattleResult comes back.
import type { BattleResult, BattleSpec, Faction, SectorKind } from "../battle/contract.ts";
import { other as otherSide } from "../battle/contract.ts";
import { FACTION_NAMES, GALAXIES, SECTOR_INCOME, SECTOR_NAMES, galaxyOf, type GalaxyId } from "./galaxy.ts";

export type Count = Record<Faction, number>;
export const FACTIONS: Faction[] = ["marines", "wooka"];
export const enemy = (f: Faction): Faction => (f === "marines" ? "wooka" : "marines");
const zero = (): Count => ({ marines: 0, wooka: 0 });

export interface Sector { kind: SectorKind; owner: Faction; armies: Count }
export interface SystemState { id: string; orbit: Faction | null; fleets: Count; sectors: Sector[] }
export interface Hero { level: number; xp: number; woundedUntil: number }
export interface Where { system: string; sector: number }

export interface Campaign {
  turn: number;
  seed: number;
  galaxy: GalaxyId;
  player: Faction; // the human side against the AI; in a two-player game, the Marines
  credits: Count;
  systems: Record<string, SystemState>;
  heroes: Record<Faction, Hero>; // each side's hero, though only the human sides send one in
  pending: { spec: BattleSpec; at: Where } | null;
  winner: Faction | null;
  log: string[]; // this turn's events, newest last
}

export type Order =
  | { kind: "build"; unit: "fleet" | "army"; at: Where }
  | { kind: "fleet"; from: string; to: string; count: number }
  | { kind: "army"; from: Where; to: Where; count: number };

export interface Orders { faction: Faction; orders: Order[]; hero?: Where }

export const COST = { fleet: 3, army: 2 } as const;
export const START_CREDITS = 6;
const KEY: SectorKind[] = ["capital", "spaceport"];
export const WIN_SHARE = 0.75;   // hold this share of the key sectors and the war is won
export const MORALE_SHARE = 0.3; // below this, income halves: losing compounds
const BOMBARD_FLEETS = 2;        // an orbit this strong kills an enemy army a sector each turn
export const TICKETS_PER_ARMY = 50;
const CANNON_HITS = 1;           // ships an anti-ship cannon knocks out of a blockading fleet each turn

export function newCampaign(seed = 1, player: Faction = "marines", galaxy: GalaxyId = "short"): Campaign {
  const systems: Record<string, SystemState> = {}, g = GALAXIES[galaxy];
  for (const def of g.systems) {
    const s = g.start[def.id]!;
    const fleets = zero();
    fleets[s.owner] = s.fleets;
    systems[def.id] = {
      id: def.id,
      orbit: s.fleets ? s.owner : null,
      fleets,
      sectors: def.sectors.map((kind) => ({ kind, owner: s.owner, armies: { ...zero(), [s.owner]: s.armies } })),
    };
  }
  return {
    turn: 1, seed, galaxy, player,
    credits: { marines: START_CREDITS, wooka: START_CREDITS },
    systems, heroes: { marines: { level: 1, xp: 0, woundedUntil: 0 }, wooka: { level: 1, xp: 0, woundedUntil: 0 } },
    pending: null, winner: null, log: [],
  };
}

// mulberry32: small, fast and the same everywhere.
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const die = (r: () => number) => 1 + Math.floor(r() * 6);

// --- Reading the map ---

export const sectorAt = (c: Campaign, w: Where) => c.systems[w.system]?.sectors[w.sector];
export const holds = (s: SystemState, f: Faction) => s.sectors.find((x) => x.kind === "capital")?.owner === f;
export const holdsShield = (s: SystemState, f: Faction) => s.sectors.some((x) => x.kind === "shield" && x.owner === f);

export function keyShare(c: Campaign, f: Faction) {
  let held = 0, total = 0;
  for (const s of Object.values(c.systems)) for (const x of s.sectors) if (KEY.includes(x.kind)) { total++; if (x.owner === f) held++; }
  return total ? held / total : 0;
}

// Supply runs out from a faction's capitals along the hyperlanes, through any system whose orbit
// the enemy doesn't hold. Armies anywhere else are cut off and wither.
export function supplied(c: Campaign, f: Faction): Set<string> {
  const seen = new Set(Object.values(c.systems).filter((s) => holds(s, f)).map((s) => s.id)), todo = [...seen];
  while (todo.length) for (const n of galaxyOf(c).neighbours(todo.pop()!)) {
    if (seen.has(n) || c.systems[n]!.orbit === enemy(f)) continue;
    seen.add(n);
    todo.push(n);
  }
  return seen;
}

// The ground rule: without orbit, a side holding a third of a planet or less can't push out
// from the surface. The only way back is a new landing from space.
export function canPushFromSurface(s: SystemState, f: Faction) {
  if (s.orbit === f) return true;
  return s.sectors.filter((x) => x.owner === f).length / s.sectors.length > 1 / 3;
}

export function income(c: Campaign, f: Faction) {
  let n = 0;
  for (const s of Object.values(c.systems)) for (const x of s.sectors) if (x.owner === f) n += SECTOR_INCOME[x.kind];
  const g = galaxyOf(c);
  for (const r of g.regions) if (g.systems.filter((d) => d.region === r.id).every((d) => holds(c.systems[d.id]!, f))) n += r.bonus;
  return keyShare(c, f) < MORALE_SHARE ? Math.floor(n / 2) : n;
}

// --- Orders ---

interface Draft { c: Campaign; transit: { faction: Faction; from: Where; to: Where; count: number }[]; errors: (string | null)[] }

// Applies orders in sequence to a copy, so each is checked against what the earlier ones left.
// The UI uses it to refuse an order before it's queued; the engine uses it to run them.
export function planOrders(c: Campaign, all: Orders[]): Draft {
  const d: Draft = { c: structuredClone(c), transit: [], errors: [] };
  for (const { faction, orders } of all) for (const o of orders) {
    const err = check(d, faction, o);
    d.errors.push(err);
    if (!err) apply(d, faction, o);
  }
  return d;
}

function check(d: Draft, f: Faction, o: Order): string | null {
  const c = d.c;
  if (o.kind === "build") {
    const s = c.systems[o.at.system], x = s && sectorAt(c, o.at);
    if (!s || !x) return "No such sector";
    if (x.owner !== f) return "You don't hold that sector";
    if (s.orbit === enemy(f)) return "Blockaded: the enemy holds the orbit";
    if (c.credits[f] < COST[o.unit]) return "Not enough credits";
    if (o.unit === "fleet" && x.kind !== "spaceport" && !(x.kind === "capital" && !s.sectors.some((y) => y.kind === "spaceport"))) return "Ships are built at a spaceport";
    if (o.unit === "army" && x.kind !== "capital") return "Armies are raised at a capital";
    return null;
  }
  if (!Number.isInteger(o.count) || o.count < 1) return "Send at least one";
  if (o.kind === "fleet") {
    const s = c.systems[o.from];
    if (!s || !c.systems[o.to]) return "No such system";
    if (!galaxyOf(c).adjacent(o.from, o.to)) return "No hyperlane between them";
    if (s.fleets[f] < o.count) return "Not that many ships there";
    return null;
  }
  const from = sectorAt(c, o.from), to = sectorAt(c, o.to);
  if (!from || !to) return "No such sector";
  if (from.armies[f] < o.count) return "Not that many armies there";
  if (o.from.system === o.to.system) {
    if (o.from.sector === o.to.sector) return "Already there";
    if (!canPushFromSurface(c.systems[o.from.system]!, f)) return "Cut off: take the orbit or more of the planet first";
    return null;
  }
  if (!galaxyOf(c).adjacent(o.from.system, o.to.system)) return "No hyperlane between them";
  return null; // a landing: whether it lands depends on who holds the orbit after the space battles
}

function apply(d: Draft, f: Faction, o: Order) {
  const c = d.c;
  if (o.kind === "build") {
    c.credits[f] -= COST[o.unit];
    if (o.unit === "fleet") c.systems[o.at.system]!.fleets[f]++;
    else sectorAt(c, o.at)!.armies[f]++;
  } else if (o.kind === "fleet") {
    c.systems[o.from]!.fleets[f] -= o.count;
    d.transit.push({ faction: f, from: { system: o.from, sector: -1 }, to: { system: o.to, sector: -1 }, count: o.count });
  } else {
    sectorAt(c, o.from)!.armies[f] -= o.count;
    d.transit.push({ faction: f, from: o.from, to: o.to, count: o.count });
  }
}

// --- Battles ---

// Dice plus stats, the classic way: up to three attacking dice against two, highest pairs
// compared, ties to the defender. Air cover adds one to a side's best die.
export function diceBattle(att: number, def: number, r: () => number, cover: { att?: boolean; def?: boolean } = {}) {
  while (att > 0 && def > 0) {
    const a = Array.from({ length: Math.min(3, att) }, () => die(r)).sort((x, y) => y - x);
    const b = Array.from({ length: Math.min(2, def) }, () => die(r)).sort((x, y) => y - x);
    if (cover.att) a[0]!++;
    if (cover.def) b[0]!++;
    for (let i = 0; i < Math.min(a.length, b.length); i++) a[i]! > b[i]! ? def-- : att--;
  }
  return [att, def] as const;
}

const name = (c: Campaign, id: string) => galaxyOf(c).system(id).name;
const where = (c: Campaign, w: Where) => {
  const s = c.systems[w.system]!;
  return s.sectors.length > 1 ? `${name(c, w.system)} ${SECTOR_NAMES[s.sectors[w.sector]!.kind].toLowerCase()}` : name(c, w.system);
};

export function resolveTurn(c0: Campaign, all: Orders[]): Campaign {
  if (c0.pending || c0.winner) return c0;
  const d = planOrders(c0, all);
  const c = d.c, r = rng(c.seed * 1000 + c.turn);
  c.log = [];
  const startOrbit = Object.fromEntries(Object.values(c.systems).map((s) => [s.id, s.orbit]));

  // Fleets arrive together, then fight for each orbit.
  for (const t of d.transit) if (t.from.sector < 0) c.systems[t.to.system]!.fleets[t.faction] += t.count;
  for (const s of Object.values(c.systems)) {
    if (s.fleets.marines && s.fleets.wooka) {
      const def = startOrbit[s.id] ?? (r() < 0.5 ? "marines" : "wooka"), att = enemy(def);
      const [a, b] = diceBattle(s.fleets[att], s.fleets[def], r);
      c.log.push(`Space battle over ${name(c, s.id)}: ${FACTION_NAMES[a ? att : def]} holds the orbit (${s.fleets[att] - a} ${FACTION_NAMES[att]} and ${s.fleets[def] - b} ${FACTION_NAMES[def]} ships lost).`);
      s.fleets[att] = a; s.fleets[def] = b;
    }
    s.orbit = s.fleets.marines ? "marines" : s.fleets.wooka ? "wooka" : null;
  }

  // Troops land only under their own orbit; the rest turn back.
  for (const t of d.transit) if (t.from.sector >= 0) {
    const same = t.from.system === t.to.system;
    if (same || c.systems[t.to.system]!.orbit === t.faction) sectorAt(c, t.to)!.armies[t.faction] += t.count;
    else {
      sectorAt(c, t.from)!.armies[t.faction] += t.count;
      c.log.push(`${FACTION_NAMES[t.faction]} troops for ${where(c, t.to)} turned back: no orbit there.`);
    }
  }

  // Ground battles: one may be a hero's, the rest roll dice. With two players picking, the turn
  // still has one hero battle: the first pick the sweep reaches, and the other side's AI fights it.
  const picks = all.filter((o) => o.hero && heroReady(c, o.faction));
  for (const s of Object.values(c.systems)) s.sectors.forEach((x, i) => {
    const att = enemy(x.owner);
    if (!x.armies[att]) return;
    const at = { system: s.id, sector: i };
    if (!x.armies[x.owner]) {
      x.owner = att;
      c.log.push(`${FACTION_NAMES[att]} takes ${where(c, at)} unopposed.`);
      return;
    }
    const pick = c.pending ? undefined : picks.find((o) => o.hero!.system === s.id && o.hero!.sector === i);
    if (pick) {
      c.pending = { spec: buildSpec(c, at, Math.floor(r() * 2 ** 31), pick.faction), at };
      return;
    }
    const [a, b] = diceBattle(x.armies[att], x.armies[x.owner], r, { att: s.orbit === att, def: s.orbit === x.owner });
    c.log.push(`Ground battle at ${where(c, at)}: ${FACTION_NAMES[a ? att : x.owner]} wins.`);
    x.armies[att] = a; x.armies[x.owner] = b;
    if (a) x.owner = att;
  });
  return c.pending ? c : upkeep(c);
}

export const heroReady = (c: Campaign, f: Faction = c.player) => c.heroes[f].woundedUntil <= c.turn;

// --- The hero battle, through the contract ---

export function buildSpec(c: Campaign, at: Where, seed: number, heroOf: Faction = c.player): BattleSpec {
  const s = c.systems[at.system]!, x = s.sectors[at.sector]!;
  const def = x.owner, att = enemy(def);
  const strikes = (f: Faction) => (s.orbit !== f ? 0 : holdsShield(s, enemy(f)) ? 1 : 3);
  const reinf = (f: Faction) => (s.orbit === f ? Math.min(40, s.fleets[f] * 8) : 0);
  return {
    id: `${c.turn}-${at.system}-${at.sector}`,
    turn: c.turn,
    system: name(c, at.system),
    sector: x.kind,
    factions: { attacker: att, defender: def },
    hero: att === heroOf ? "attacker" : "defender",
    heroLevel: c.heroes[heroOf].level,
    armies: { attacker: x.armies[att], defender: x.armies[def] },
    tickets: { attacker: x.armies[att] * TICKETS_PER_ARMY, defender: x.armies[def] * TICKETS_PER_ARMY },
    vehicles: { attacker: Math.min(3, Math.floor(x.armies[att] / 2)), defender: Math.min(3, Math.floor(x.armies[def] / 2)) },
    strikes: { attacker: strikes(att), defender: strikes(def) },
    reinforcements: { attacker: reinf(att), defender: reinf(def) },
    turrets: x.kind === "shield" || x.kind === "cannon" ? 2 : 1,
    seed,
  };
}

// The battle's survivors stay on the map, scaled by the tickets left; the loser's army there is gone.
export function applyBattleResult(c0: Campaign, res: BattleResult): Campaign {
  const p = c0.pending;
  if (!p || p.spec.id !== res.id) throw new Error("that isn't the battle being fought");
  const c = structuredClone(c0), spec = p.spec, x = sectorAt(c, p.at)!;
  const win = res.winner, lose = otherSide(win);
  const start = spec.tickets[win] + spec.reinforcements[win];
  const survivors = Math.max(1, Math.min(spec.armies[win], Math.round((spec.armies[win] * res.tickets[win]) / Math.max(1, start))));
  x.armies[spec.factions[win]] = survivors;
  x.armies[spec.factions[lose]] = 0;
  x.owner = spec.factions[win];
  const heroWon = win === spec.hero, f = spec.factions[spec.hero], hero = c.heroes[f], who = `${FACTION_NAMES[f]}'s hero`;
  c.log.push(`Hero battle at ${where(c, p.at)}: ${FACTION_NAMES[spec.factions[win]]} wins with ${survivors} ${survivors === 1 ? "army" : "armies"} left.`);
  if (res.heroDown) {
    hero.woundedUntil = c.turn + 3;
    c.log.push(`${who} is wounded and out until turn ${hero.woundedUntil}.`);
  } else {
    hero.xp += heroWon ? 2 : 1;
    const level = 1 + Math.floor(hero.xp / 3);
    if (level > hero.level) c.log.push(`${who} reaches level ${level}.`);
    hero.level = level;
  }
  c.pending = null;
  return upkeep(c);
}

// End of turn: cannon fire, bombardment, supply, income, and whether the war is over.
function upkeep(c: Campaign): Campaign {
  // A cannon on the surface fires on the enemy fleet over it, and can break a blockade.
  for (const s of Object.values(c.systems)) {
    const o = s.orbit;
    if (!o) continue;
    const guns = s.sectors.filter((x) => x.kind === "cannon" && x.owner === enemy(o)).length;
    if (!guns) continue;
    const hit = Math.min(s.fleets[o], guns * CANNON_HITS);
    s.fleets[o] -= hit;
    c.log.push(`The cannon on ${name(c, s.id)} knocks out ${hit} ${FACTION_NAMES[o]} ${hit === 1 ? "ship" : "ships"}.`);
    if (!s.fleets[o]) {
      s.orbit = null;
      c.log.push(`${FACTION_NAMES[o]}'s blockade of ${name(c, s.id)} is broken.`);
    }
  }
  for (const s of Object.values(c.systems)) {
    const o = s.orbit;
    if (!o || s.fleets[o] < BOMBARD_FLEETS) continue;
    if (holdsShield(s, enemy(o))) {
      if (s.sectors.some((x) => x.armies[enemy(o)])) c.log.push(`The shield on ${name(c, s.id)} holds off ${FACTION_NAMES[o]}'s bombardment.`);
      continue;
    }
    for (const x of s.sectors) if (x.armies[enemy(o)]) {
      x.armies[enemy(o)]--;
      c.log.push(`${FACTION_NAMES[o]} bombards ${name(c, s.id)} from orbit.`);
      if (!x.armies[enemy(o)] && x.armies[o]) x.owner = o;
    }
  }
  // Cut off from supply, a force loses an army a turn, down to a last one holding on.
  for (const f of FACTIONS) {
    const ok = supplied(c, f);
    for (const s of Object.values(c.systems)) if (!ok.has(s.id)) s.sectors.forEach((x, i) => {
      if (x.armies[f] < 2) return;
      x.armies[f]--;
      c.log.push(`${FACTION_NAMES[f]} at ${where(c, { system: s.id, sector: i })} is cut off from supply and loses an army.`);
    });
  }
  for (const f of FACTIONS) c.credits[f] += income(c, f);
  for (const f of FACTIONS) {
    const capitals = Object.values(c.systems).some((s) => s.sectors.some((x) => x.kind === "capital" && x.owner === f));
    if (keyShare(c, f) >= WIN_SHARE || !capitals) c.winner = capitals ? f : enemy(f);
  }
  if (c.winner) c.log.push(`${FACTION_NAMES[c.winner]} wins the war.`);
  c.turn++;
  return c;
}
