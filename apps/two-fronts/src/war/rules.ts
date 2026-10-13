// The strategy layer: a deterministic rules engine over plain JSON. A turn is income and
// building, simultaneous moves, space battles, landings, ground battles, then upkeep (cannon
// fire, bombardment, supply, income). One battle a turn, on the ground or in orbit, can be
// handed to the player as a hero battle; the turn pauses on it until the result comes back.
import type { BattleResult, BattleSpec, Faction, SectorKind, SpaceBattleResult, SpaceBattleSpec, VehicleKind, VehiclePool } from "../battle/contract.ts";
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
// A hero pick with this sector flies in the space battle over the system instead.
export const ORBIT = -1;
interface Transit { faction: Faction; from: Where; to: Where; count: number }
// A paused space battle holds the turn's landings: where they can land waits on who wins the orbit.
export type Pending =
  | { kind: "ground"; spec: BattleSpec; at: Where }
  | { kind: "space"; spec: SpaceBattleSpec; system: string; landings: Transit[] };

export interface Campaign {
  turn: number;
  seed: number;
  galaxy: GalaxyId;
  player: Faction; // the human side against the AI; in a two-player game, the Marines
  credits: Count;
  systems: Record<string, SystemState>;
  heroes: Record<Faction, Hero>; // each side's hero, though only the human sides send one in
  pending: Pending | null;
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

// Who holds every capital in a region, and so takes its bonus: one side, or nobody.
export function regionHolder(c: Campaign, region: string): Faction | null {
  const g = galaxyOf(c), ids = g.systems.filter((d) => d.region === region).map((d) => d.id);
  return FACTIONS.find((f) => ids.every((id) => holds(c.systems[id]!, f))) ?? null;
}

// Next turn's income, itemised like a reinforcement count: what the sectors pay, each region's
// bonus held, and how much a broken morale (under MORALE_SHARE of the key sectors) takes off.
export function incomeBreakdown(c: Campaign, f: Faction) {
  let sectors = 0;
  for (const s of Object.values(c.systems)) for (const x of s.sectors) if (x.owner === f) sectors += SECTOR_INCOME[x.kind];
  const regions = galaxyOf(c).regions.filter((r) => regionHolder(c, r.id) === f).map((r) => ({ name: r.name, bonus: r.bonus }));
  const gross = sectors + regions.reduce((n, r) => n + r.bonus, 0);
  const total = keyShare(c, f) < MORALE_SHARE ? Math.floor(gross / 2) : gross;
  return { sectors, regions, morale: total - gross, total };
}

export const income = (c: Campaign, f: Faction) => incomeBreakdown(c, f).total;

// --- Orders ---

interface Draft { c: Campaign; transit: Transit[]; errors: (string | null)[] }

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
  // One hero battle a turn, on the ground or in orbit. With two players picking, it's the first
  // pick the sweep reaches, and the other side's AI fights it.
  const picks = all.filter((o) => o.hero && heroReady(c, o.faction));

  // Fleets arrive together, then fight for each orbit. The hero may fly one of these fights.
  for (const t of d.transit) if (t.from.sector < 0) c.systems[t.to.system]!.fleets[t.faction] += t.count;
  for (const s of Object.values(c.systems)) {
    if (s.fleets.marines && s.fleets.wooka) {
      const def = startOrbit[s.id] ?? (r() < 0.5 ? "marines" : "wooka"), att = enemy(def);
      const pick = c.pending ? undefined : picks.find((o) => o.hero!.system === s.id && o.hero!.sector === ORBIT);
      if (pick) {
        c.pending = { kind: "space", spec: buildSpaceSpec(c, s.id, def, Math.floor(r() * 2 ** 31), pick.faction), system: s.id, landings: [] };
        continue; // the orbit is settled when the result comes back
      }
      const [a, b] = diceBattle(s.fleets[att], s.fleets[def], r);
      c.log.push(`Space battle over ${name(c, s.id)}: ${FACTION_NAMES[a ? att : def]} holds the orbit (${s.fleets[att] - a} ${FACTION_NAMES[att]} and ${s.fleets[def] - b} ${FACTION_NAMES[def]} ships lost).`);
      s.fleets[att] = a; s.fleets[def] = b;
    }
    s.orbit = s.fleets.marines ? "marines" : s.fleets.wooka ? "wooka" : null;
  }

  const landings = d.transit.filter((t) => t.from.sector >= 0);
  if (c.pending?.kind === "space") {
    c.pending.landings = landings;
    return c;
  }
  return landAndFight(c, landings, picks, r);
}

// The rest of a turn after the space battles: landings, ground battles, upkeep.
function landAndFight(c: Campaign, landings: Transit[], picks: Orders[], r: () => number): Campaign {
  // Troops land only under their own orbit; the rest turn back.
  for (const t of landings) {
    const same = t.from.system === t.to.system;
    if (same || c.systems[t.to.system]!.orbit === t.faction) sectorAt(c, t.to)!.armies[t.faction] += t.count;
    else {
      sectorAt(c, t.from)!.armies[t.faction] += t.count;
      c.log.push(`${FACTION_NAMES[t.faction]} troops for ${where(c, t.to)} turned back: no orbit there.`);
    }
  }

  // Ground battles: one may be a hero's, the rest roll dice.
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
      c.pending = { kind: "ground", spec: buildSpec(c, at, Math.floor(r() * 2 ** 31), pick.faction), at };
      return;
    }
    // Orbit gives either side cover from above; a jungle gives the side that holds it cover in the trees.
    const [a, b] = diceBattle(x.armies[att], x.armies[x.owner], r, { att: s.orbit === att, def: s.orbit === x.owner || x.kind === "jungle" });
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
    vehicles: { attacker: vehiclePool(s, att, x.armies[att]), defender: vehiclePool(s, def, x.armies[def]) },
    strikes: { attacker: strikes(att), defender: strikes(def) },
    reinforcements: { attacker: reinf(att), defender: reinf(def) },
    turrets: x.kind === "shield" || x.kind === "cannon" ? 2 : 1,
    seed,
  };
}

// The vehicles a side brings to a hero battle: one per two armies, up to three. Tanks and speeders
// come with any army. Gunships come down from a fleet holding the orbit, and walkers out of the
// factories of a capital the side holds on the world. The Wooka have no vehicles, so the battle
// turns their share into more Wooka.
export function vehiclePool(s: SystemState, f: Faction, armies: number): VehiclePool {
  const kinds: VehicleKind[] = ["tank"];
  if (s.orbit === f) kinds.push("gunship");
  if (s.sectors.some((x) => x.kind === "capital" && x.owner === f)) kinds.push("walker");
  kinds.push("speeder");
  const pool: VehiclePool = {};
  for (let i = 0; i < Math.min(3, Math.floor(armies / 2)); i++) { const k = kinds[i % kinds.length]!; pool[k] = (pool[k] ?? 0) + 1; }
  return pool;
}

// The battle's survivors stay on the map, scaled by the tickets left; the loser's army there is gone.
export function applyBattleResult(c0: Campaign, res: BattleResult): Campaign {
  const p = c0.pending;
  if (p?.kind !== "ground" || p.spec.id !== res.id) throw new Error("that isn't the battle being fought");
  const c = structuredClone(c0), spec = p.spec, x = sectorAt(c, p.at)!;
  const win = res.winner, lose = otherSide(win);
  const start = spec.tickets[win] + spec.reinforcements[win];
  const survivors = Math.max(1, Math.min(spec.armies[win], Math.round((spec.armies[win] * res.tickets[win]) / Math.max(1, start))));
  x.armies[spec.factions[win]] = survivors;
  x.armies[spec.factions[lose]] = 0;
  x.owner = spec.factions[win];
  c.log.push(`Hero battle at ${where(c, p.at)}: ${FACTION_NAMES[spec.factions[win]]} wins with ${survivors} ${survivors === 1 ? "army" : "armies"} left.`);
  heroBack(c, spec.factions[spec.hero], win === spec.hero, res.heroDown);
  c.pending = null;
  return upkeep(c);
}

// Each side's fleet over the system becomes a line of cruisers; the defender held the orbit.
export function buildSpaceSpec(c: Campaign, system: string, def: Faction, seed: number, heroOf: Faction = c.player): SpaceBattleSpec {
  const s = c.systems[system]!, att = enemy(def);
  return {
    id: `${c.turn}-${system}-orbit`,
    turn: c.turn,
    system: name(c, system),
    factions: { attacker: att, defender: def },
    hero: att === heroOf ? "attacker" : "defender",
    heroLevel: c.heroes[heroOf].level,
    fleets: { attacker: s.fleets[att], defender: s.fleets[def] },
    seed,
  };
}

// The winner's cruisers still fit to fly keep the orbit (one at least); the loser's fleet there
// is gone. Then the turn goes on: landings under the orbit as it now stands, and ground battles.
export function applySpaceResult(c0: Campaign, res: SpaceBattleResult): Campaign {
  const p = c0.pending;
  if (p?.kind !== "space" || p.spec.id !== res.id) throw new Error("that isn't the battle being fought");
  const c = structuredClone(c0), spec = p.spec, s = c.systems[p.system]!;
  const win = res.winner, lose = otherSide(win), kept = Math.max(1, Math.min(spec.fleets[win], res.fleets[win]));
  s.fleets[spec.factions[win]] = kept;
  s.fleets[spec.factions[lose]] = 0;
  s.orbit = spec.factions[win];
  c.log.push(`Hero space battle over ${name(c, p.system)}: ${FACTION_NAMES[spec.factions[win]]} holds the orbit with ${kept} ${kept === 1 ? "ship" : "ships"} left.`);
  heroBack(c, spec.factions[spec.hero], win === spec.hero, res.heroDown);
  c.pending = null;
  return landAndFight(c, p.landings, [], rng((c.seed * 1000 + c.turn) ^ 0x2545f491));
}

// Shot down or carried off, the hero sits out three turns; otherwise they learn from it.
function heroBack(c: Campaign, f: Faction, won: boolean, down: boolean) {
  const hero = c.heroes[f], who = `${FACTION_NAMES[f]}'s hero`;
  if (down) {
    hero.woundedUntil = c.turn + 3;
    c.log.push(`${who} is wounded and out until turn ${hero.woundedUntil}.`);
    return;
  }
  hero.xp += won ? 2 : 1;
  const level = 1 + Math.floor(hero.xp / 3);
  if (level > hero.level) c.log.push(`${who} reaches level ${level}.`);
  hero.level = level;
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
