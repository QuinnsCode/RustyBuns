// The strategy layer: a deterministic rules engine over plain JSON. A turn runs in phases, like a
// board game of territories and armies, both sides at once and blind to each other's numbers:
//   1. Draw: each side draws a card (a weapon upgrade, a muster or a trap).
//   2. Place: raise troops and ships, then play cards on places you hold.
//   3. Declare: move, and any move into the enemy's orbit or sectors is an attack. The attacks are
//      declared (where, and from where, but not with how many), and each side declares its
//      retreats: a defender can pull out to a world it holds next door, an attacker can call an
//      attack off.
//   4. Combat: space battles, bombardments, landings, ground battles, each a cannon barrage of dice.
//   5. Deploy: a side that took somewhere moves into it, and moves what's left.
//   6. Collect: cannon fire, bombardment, supply, income and region bonuses, and a card for taking
//      three or more places.
// One battle a turn, on the ground or in orbit, can be handed to the player as a hero battle; the
// turn pauses on it until the result comes back. Every die comes from the campaign's seed, so a
// turn played online replays the same.
import type { BattleResult, BattleSpec, Faction, MatchMode, SectorKind, SpaceBattleResult, SpaceBattleSpec, VehicleKind, VehiclePool } from "../battle/contract.ts";
import { BIG_BATTLE, BIG_MAP_FOR, other as otherSide } from "../battle/contract.ts";
import { mulberry32 } from "@rustybuns/util";
import { admitLandings } from "./landing.ts";
import { FACTION_NAMES, GALAXIES, SECTOR_INCOME, SECTOR_NAMES, galaxyOf, type GalaxyId } from "./galaxy.ts";

export type Count = Record<Faction, number>;
export const FACTIONS: Faction[] = ["marines", "wooka"];
export const enemy = (f: Faction): Faction => (f === "marines" ? "wooka" : "marines");
const zero = (): Count => ({ marines: 0, wooka: 0 });

// guns: its holder has played a weapon upgrade here. They're wrecked when the sector changes hands.
export interface Sector { kind: SectorKind; owner: Faction; armies: Count; guns?: true }
export interface SystemState {
  id: string; orbit: Faction | null; fleets: Count; sectors: Sector[];
  held?: number; // turns in a row the orbit's holder has held it: a long blockade squeezes the other side's landings
  fog?: true; // in a seat's view: the enemy's numbers here are hidden (and zeroed), as nobody of theirs is here to see
}
export interface Hero { level: number; xp: number; woundedUntil: number }
export interface Where { system: string; sector: number }
// A hero pick with this sector flies in the space battle over the system instead.
export const ORBIT = -1;
// A hero who loses the orbit goes down with the flagship and is out this many turns, not three.
export const LOST_TURNS = 6;
// A hero breaking out from the surface against a blockade gets one ship out of the garrison, no more.
export const BREAKOUT_SHIPS = 1;
interface Transit { faction: Faction; from: Where; to: Where; count: number }
// A paused space battle holds the turn's landings: where they can land waits on who wins the orbit.
// The cards. A weapon upgrade arms a sector you hold for good, a muster raises armies for free,
// more where your muster force on the world is bigger (between MUSTER_MIN and MUSTER_MAX, so it
// can't snowball), and a trap, set on a sector or orbit you hold for the turn, blows up half of whatever
// attacks it, and everyone of yours there with it. It's for a place you hold with one army or ship.
// Dig in, played on a sector you hold, gives your side cover in every ground fight across that sector's region for the turn.
export type Card = "guns" | "troops" | "trap" | "dugin";
export const CARDS: Card[] = ["guns", "troops", "trap", "dugin"];
// "troops" is the muster card: the id stays as old saves have it.
export const CARD_NAMES: Record<Card, string> = { guns: "Weapon upgrade", troops: "Muster", trap: "Trap", dugin: "Dig in" };
export const HAND_MAX = 5;
export const MUSTER_MIN = 2, MUSTER_MAX = 4;
// The armies a muster raises on a world where the side has `force` armies already: one for every
// two there, from MUSTER_MIN up to MUSTER_MAX.
export const musterRaise = (force: number) => Math.max(MUSTER_MIN, Math.min(MUSTER_MAX, Math.floor(force / 2)));
export const BONUS_PLACES = 3; // take this many places in a turn and earn a card
export interface DugIn { faction: Faction; region: string }
export interface Trap { faction: Faction; at: Where }
// Ships trained on a sector from an orbit their side holds alone, once the enemy's last ship there
// is gone: each kills an army below at the turn's landings, half as many through a shield.
export interface Bombard { faction: Faction; at: Where; count: number }
// Where a side puts its fleet at the start of the war: ships by system id, armies by "system:sector".
export interface Deployment { ships: Record<string, number>; armies: Record<string, number> }

export type Pending =
  | { kind: "ground"; spec: BattleSpec; at: Where }
  | { kind: "space"; spec: SpaceBattleSpec; system: string; landings: Transit[] };

export interface Campaign {
  turn: number;
  seed: number;
  galaxy: GalaxyId;
  player: Faction; // the human side against the AI; in a two-player game, the Thunder Marines
  credits: Count;
  systems: Record<string, SystemState>;
  heroes: Record<Faction, Hero>; // each side's hero, though only the human sides send one in
  pending: Pending | null;
  // Set while the turn waits on retreats: every attack this turn, declared without its numbers.
  attacks?: Attack[] | null;
  hands?: Record<Faction, Card[]>; // each side's cards, unplayed
  traps?: Trap[] | null;           // set this turn, sprung or cleared by its end
  dugIn?: DugIn[] | null;          // regions a side has dug in across this turn
  taken?: Count | null;            // places each side has taken this turn
  // Set while the turn waits on the deploy phase: the sides that took somewhere and get to move.
  deploying?: Faction[] | null;
  // Set before the first turn, while the sides pick a fleet and place it: the sides still to do
  // so. The map is empty until they have, and `pool` is what each side has to spend on its fleet.
  setup?: Faction[] | null;
  pool?: Count;
  bombards?: Bombard[] | null;     // ordered this turn, struck at the landings
  winner: Faction | null;
  log: string[]; // this turn's events, newest last
  mode?: MatchMode; // how the next hero ground battle is fought, as the last vote picked; conquest when absent
}

export type Order =
  | { kind: "build"; unit: "fleet" | "army"; at: Where }
  | { kind: "fleet"; from: string; to: string; count: number }
  | { kind: "army"; from: Where; to: Where; count: number }
  | { kind: "card"; card: Card; at: Where }
  | { kind: "bombard"; at: Where; count: number };

// An attack, as the other side learns of it: who, from which system, on which sector (or ORBIT).
export interface Attack { faction: Faction; from: string; to: Where }
// The answer to the declared attacks: call one of your own off (its troops stay home), or pull
// everything out of a place under attack to one you hold in the same system or next door.
export type Retreat = { kind: "calloff"; to: Where } | { kind: "withdraw"; from: Where; to: Where };

// A side's turn: what it raises, plays and moves, then once the attacks are declared, its
// retreats, and after the fighting, its deploys (army and fleet moves between places it holds).
export interface Orders { faction: Faction; orders: Order[]; hero?: Where; retreats?: Retreat[]; deploys?: Order[]; deployment?: Deployment }

export const COST = { fleet: 3, army: 2 } as const;
export const START_CREDITS = 6;
const KEY: SectorKind[] = ["capital", "spaceport"];
export const WIN_SHARE = 0.75;   // hold this share of the key sectors and the war is won
export const MORALE_SHARE = 0.3; // below this, income halves: losing compounds
const BOMBARD_FLEETS = 2;        // an orbit this strong kills an enemy army a sector each turn
export const TICKETS_PER_ARMY = 50;
const CANNON_HITS = 1;           // ships an anti-ship cannon knocks out of a blockading fleet each turn

export const BOMBARD_KILLS = 1;  // armies a ship kills with an ordered bombardment

// With `setup`, the map starts empty: each side's stock fleet is its pool to spend on a fleet of
// its own choosing and place where it likes, before turn 1.
export function newCampaign(seed = 1, player: Faction = "marines", galaxy: GalaxyId = "short", setup = false): Campaign {
  const systems: Record<string, SystemState> = {}, g = GALAXIES[galaxy], pool = zero();
  for (const def of g.systems) {
    const s = g.start[def.id]!;
    const fleets = zero();
    pool[s.owner] += s.fleets * COST.fleet + s.armies * def.sectors.length * COST.army;
    if (!setup) fleets[s.owner] = s.fleets;
    systems[def.id] = {
      id: def.id,
      orbit: s.fleets && !setup ? s.owner : null,
      fleets,
      sectors: def.sectors.map((kind) => ({ kind, owner: s.owner, armies: { ...zero(), [s.owner]: setup ? 0 : s.armies } })),
    };
  }
  return draw({
    turn: 1, seed, galaxy, player,
    ...(setup && { setup: [...FACTIONS], pool }),
    credits: { marines: START_CREDITS, wooka: START_CREDITS },
    systems, heroes: { marines: { level: 1, xp: 0, woundedUntil: 0 }, wooka: { level: 1, xp: 0, woundedUntil: 0 } },
    hands: { marines: [], wooka: [] },
    pending: null, winner: null, log: [],
  });
}

export const handOf = (c: Campaign, f: Faction): Card[] => c.hands?.[f] ?? [];
const deal = (c: Campaign, f: Faction, card: Card) => {
  c.hands ??= { marines: [], wooka: [] };
  if (c.hands[f].length < HAND_MAX) c.hands[f].push(card);
};
// Phase 1: both sides draw the same card off the turn's seed, so neither starts the turn better off.
function draw(c: Campaign): Campaign {
  const r = rng((c.seed * 1000 + c.turn) ^ 0x5eedca7d), card = CARDS[Math.floor(r() * CARDS.length)]!;
  for (const f of FACTIONS) deal(c, f, card);
  return c;
}

export const rng = mulberry32;
const die = (r: () => number, sides: number) => 1 + Math.floor(r() * sides);

// --- Reading the map ---

export const sectorAt = (c: Campaign, w: Where) => c.systems[w.system]?.sectors[w.sector];
export const holds = (s: SystemState, f: Faction) => s.sectors.find((x) => x.kind === "capital")?.owner === f;
export const holdsShield = (s: SystemState, f: Faction) => s.sectors.some((x) => x.kind === "shield" && x.owner === f);
// A side's muster force on a world: its armies there, which feed the space battle over it with
// boarding parties, and its batteries (cannons, shields and upgraded guns it holds), which add to a
// screen or a bombardment.
export function musterOf(s: SystemState, f: Faction) {
  return {
    troops: s.sectors.reduce((n, x) => n + x.armies[f], 0),
    batteries: s.sectors.filter((x) => x.owner === f && (x.kind === "cannon" || x.kind === "shield" || x.guns)).length,
  };
}

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
  sectors = Math.floor(sectors * (galaxyOf(c).pay ?? 1)); // spread thin over a big map
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
  if (o.kind === "card") {
    if (!CARDS.includes(o.card)) return "No such card";
    if (!handOf(c, f).includes(o.card)) return "That card isn't in your hand";
    const s = o.at && c.systems[o.at.system];
    if (!s || !Number.isInteger(o.at.sector)) return "No such sector";
    if (o.card === "trap" && o.at.sector === ORBIT) {
      if (s.orbit !== f || !s.fleets[f]) return "Set a trap in an orbit you hold";
      return (c.traps ?? []).some((t) => same(t.at, o.at)) ? "There's a trap there already" : null;
    }
    const x = sectorAt(c, o.at);
    if (!x) return "No such sector";
    if (x.owner !== f) return "You don't hold that sector";
    if (o.card === "guns") return x.guns ? "The guns there are upgraded already" : null;
    if (o.card === "dugin") return (c.dugIn ?? []).some((d) => d.faction === f && d.region === galaxyOf(c).system(o.at.system).region) ? "You've dug in across that region already" : null;
    if (o.card === "troops") return s.orbit === enemy(f) ? "Blockaded: the enemy holds the orbit" : null;
    return (c.traps ?? []).some((t) => same(t.at, o.at)) ? "There's a trap there already" : null;
  }
  if (!Number.isInteger(o.count) || o.count < 1) return "Send at least one";
  if (o.kind === "bombard") {
    const s = o.at && c.systems[o.at.system], x = s && Number.isInteger(o.at.sector) ? sectorAt(c, o.at) : undefined;
    if (!s || !x) return "No such sector";
    if (s.orbit !== f || !s.fleets[f]) return "Bombard from an orbit you hold";
    if (s.fleets[enemy(f)]) return "Their ships still hold the sky: beat the fleet first";
    if (x.owner === f) return "That sector is yours";
    if (!x.armies[enemy(f)]) return "No armies there to bombard";
    if (o.count > idleShips(c, s)[f]) return "Not that many ships are free to bombard";
    return null;
  }
  if (o.kind === "fleet") {
    const s = c.systems[o.from];
    if (!s || !c.systems[o.to]) return "No such system";
    if (!galaxyOf(c).adjacent(o.from, o.to)) return "No hyperlane between them";
    if (idleShips(c, s)[f] < o.count) return "Not that many ships there, or they're bombarding";
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
  } else if (o.kind === "card") {
    const hand = c.hands![f];
    hand.splice(hand.indexOf(o.card), 1);
    if (o.card === "guns") sectorAt(c, o.at)!.guns = true;
    else if (o.card === "troops") sectorAt(c, o.at)!.armies[f] += musterRaise(musterOf(c.systems[o.at.system]!, f).troops);
    else if (o.card === "dugin") (c.dugIn ??= []).push({ faction: f, region: galaxyOf(c).system(o.at.system).region });
    else (c.traps ??= []).push({ faction: f, at: { system: o.at.system, sector: o.at.sector } });
  } else if (o.kind === "bombard") {
    (c.bombards ??= []).push({ faction: f, at: { system: o.at.system, sector: o.at.sector }, count: o.count });
  } else if (o.kind === "fleet") {
    c.systems[o.from]!.fleets[f] -= o.count;
    d.transit.push({ faction: f, from: { system: o.from, sector: -1 }, to: { system: o.to, sector: -1 }, count: o.count });
  } else {
    sectorAt(c, o.from)!.armies[f] -= o.count;
    d.transit.push({ faction: f, from: o.from, to: o.to, count: o.count });
  }
}

// A system's ships not already trained on a sector below this turn: the ones free to sail.
export function idleShips(c: Campaign, s: SystemState): Count {
  const free = { ...s.fleets };
  for (const b of c.bombards ?? []) if (b.at.system === s.id) free[b.faction] -= b.count;
  return free;
}

// --- Battles ---

// A cannon barrage, round after round until one side is gone. Each side fires up to three guns: its
// leader, the lead ship or the army's first, rolls a d8 and every other unit a d6 (upgraded guns
// make them all d8s). Highest is set against highest, a pair at a time, and the lower roll of each
// pair loses a unit; ties go to the attacker. Cover adds one to a side's best die.
type Sides = { att?: boolean; def?: boolean };
export function diceBattle(att: number, def: number, r: () => number, cover: Sides = {}, guns: Sides = {}) {
  const barrage = (n: number, armed?: boolean) => Array.from({ length: Math.min(3, n) }, (_, i) => die(r, i === 0 || armed ? 8 : 6)).sort((x, y) => y - x);
  while (att > 0 && def > 0) {
    const a = barrage(att, guns.att), b = barrage(def, guns.def);
    if (cover.att) a[0]!++;
    if (cover.def) b[0]!++;
    for (let i = 0; i < Math.min(a.length, b.length); i++) a[i]! >= b[i]! ? def-- : att--;
  }
  return [att, def] as const;
}

// What tips a ground fight's dice, for the side that attacks and the side that holds the sector.
// Cover (+1 on its best die): orbit gives either side cover from above, a jungle gives the holder
// cover in the trees, and a side with most of a region's worlds has it over the whole region (area-wide).
// Guns (every die a d8): upgraded guns, a card played on that one sector, fire for its holder.
export function regionControl(c: Campaign, system: string): Faction | null {
  const region = galaxyOf(c).system(system).region, ids = galaxyOf(c).systems.filter((d) => d.region === region).map((d) => d.id);
  return FACTIONS.find((f) => ids.filter((id) => holds(c.systems[id]!, f)).length * 2 > ids.length) ?? null;
}
// Who has cover across a region: the side that played Dig in there this turn, else the side holding most of it.
export function regionCover(c: Campaign, region: string): Faction | null {
  const dug = FACTIONS.filter((f) => (c.dugIn ?? []).some((d) => d.faction === f && d.region === region));
  return dug.length === 1 ? dug[0]! : regionControl(c, galaxyOf(c).systems.find((d) => d.region === region)!.id);
}
export function groundEdges(c: Campaign, at: Where): { cover: Sides; guns: Sides } {
  const s = c.systems[at.system]!, x = s.sectors[at.sector]!, att = enemy(x.owner), area = regionCover(c, galaxyOf(c).system(at.system).region);
  return {
    cover: { att: s.orbit === att || area === att, def: s.orbit === x.owner || x.kind === "jungle" || area === x.owner },
    guns: { def: !!x.guns },
  };
}

const name = (c: Campaign, id: string) => galaxyOf(c).system(id).name;
const where = (c: Campaign, w: Where) => {
  const s = c.systems[w.system]!;
  return s.sectors.length > 1 ? `${name(c, w.system)} ${SECTOR_NAMES[s.sectors[w.sector]!.kind].toLowerCase()}` : name(c, w.system);
};

export function resolveTurn(c0: Campaign, all: Orders[]): Campaign {
  if (c0.pending || c0.deploying || c0.winner) return c0;
  const d = planOrders(c0, all);
  const c = d.c, r = rng(c.seed * 1000 + c.turn);
  c.log = [];
  c.attacks = null;
  c.taken = zero();
  retreat(d, c0, all);
  const startOrbit = Object.fromEntries(Object.values(c.systems).map((s) => [s.id, s.orbit]));
  // One hero battle a turn, on the ground or in orbit. With two players picking, it's the first
  // pick the sweep reaches, and the other side's AI fights it.
  const picks = all.filter((o) => o.hero && heroReady(c, o.faction));

  // Fleets arrive together, then fight for each orbit. The hero may fly one of these fights.
  for (const t of d.transit) if (t.from.sector < 0) c.systems[t.to.system]!.fleets[t.faction] += t.count;
  for (const s of Object.values(c.systems)) {
    const trap = (c.traps ?? []).find((t) => t.at.system === s.id && isOrbit(t.at));
    if (trap && s.fleets[enemy(trap.faction)] && springable(c, trap.at)) {
      const f = trap.faction, foe = enemy(f), blown = Math.ceil(s.fleets[foe] / 2);
      c.log.push(`A trap in ${name(c, s.id)}'s orbit blows up ${blown} ${FACTION_NAMES[foe]} ${blown === 1 ? "ship" : "ships"}, and ${FACTION_NAMES[f]}'s ${s.fleets[f]} with it.`);
      s.fleets[foe] -= blown;
      s.fleets[f] = 0;
    }
    const breaker = c.pending ? undefined : picks.find((o) => o.hero!.system === s.id && o.hero!.sector === ORBIT && canBreakOut(s, o.faction));
    if (breaker) {
      c.pending = { kind: "space", spec: buildSpaceSpec(c, s.id, enemy(breaker.faction), Math.floor(r() * 2 ** 31), breaker.faction, true), system: s.id, landings: [] };
      continue;
    }
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
    s.held = s.orbit && s.orbit === startOrbit[s.id] ? (s.held ?? 0) + 1 : 0;
    if (s.orbit && startOrbit[s.id] === enemy(s.orbit)) took(c, s.orbit);
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
  // Ordered bombardments come first, so troops come down on what they've emptied. They fizzle if
  // the orbit changed hands or the enemy's ships came back.
  for (const b of c.bombards ?? []) {
    const s = c.systems[b.at.system]!, x = sectorAt(c, b.at)!, f = b.faction, foe = enemy(f);
    if (s.orbit !== f || s.fleets[foe] || x.owner === f || b.count > s.fleets[f]) {
      c.log.push(`The bombardment of ${where(c, b.at)} fizzles: the orbit is contested.`);
      continue;
    }
    const kills = Math.min(x.armies[foe], holdsShield(s, foe) ? Math.ceil((b.count * BOMBARD_KILLS) / 2) : b.count * BOMBARD_KILLS);
    x.armies[foe] -= kills;
    c.log.push(`${FACTION_NAMES[f]} bombards ${where(c, b.at)} from orbit${holdsShield(s, foe) ? ", through the shield" : ""}: ${kills} ${kills === 1 ? "army" : "armies"} killed.`);
  }
  // Troops land through the sky: the orbit's holder lands freely, a rush through a fleet gets a
  // trickle into one place (see landing.ts). The rest turn back.
  const across = landings.filter((t) => t.from.system !== t.to.system), admitted = admitLandings(c.systems, across);
  for (const t of landings) {
    const land = t.from.system === t.to.system ? t.count : admitted[across.indexOf(t)]!;
    sectorAt(c, t.to)!.armies[t.faction] += land;
    if (land < t.count) {
      sectorAt(c, t.from)!.armies[t.faction] += t.count - land;
      c.log.push(`${FACTION_NAMES[t.faction]} troops for ${where(c, t.to)} turned back: ${land ? `only ${land} could land` : "no way through the sky"}.`);
    }
  }

  // Ground battles: one may be a hero's, the rest roll dice.
  for (const s of Object.values(c.systems)) s.sectors.forEach((x, i) => {
    const att = enemy(x.owner);
    if (!x.armies[att]) return;
    const at = { system: s.id, sector: i };
    if (springable(c, at)?.faction === x.owner) {
      const blown = Math.ceil(x.armies[att] / 2), lost = x.armies[x.owner];
      c.log.push(`A trap at ${where(c, at)} blows up ${blown} ${FACTION_NAMES[att]} ${blown === 1 ? "army" : "armies"}${lost ? `, and the ${lost} ${FACTION_NAMES[x.owner]} holding it` : ""}.`);
      x.armies[att] -= blown;
      x.armies[x.owner] = 0;
      if (!x.armies[att]) return;
    }
    if (!x.armies[x.owner]) {
      capture(c, x, att);
      c.log.push(`${FACTION_NAMES[att]} takes ${where(c, at)} unopposed.`);
      return;
    }
    const pick = c.pending ? undefined : picks.find((o) => o.hero!.system === s.id && o.hero!.sector === i);
    if (pick) {
      c.pending = { kind: "ground", spec: buildSpec(c, at, Math.floor(r() * 2 ** 31), pick.faction), at };
      return;
    }
    const { cover, guns } = groundEdges(c, at);
    const [a, b] = diceBattle(x.armies[att], x.armies[x.owner], r, cover, guns);
    c.log.push(`Ground battle at ${where(c, at)}: ${FACTION_NAMES[a ? att : x.owner]} wins.`);
    x.armies[att] = a; x.armies[x.owner] = b;
    if (a) capture(c, x, att);
  });
  return c.pending ? c : afterCombat(c);
}

// A trap waiting at a place, taken off the table: it springs once.
function springable(c: Campaign, at: Where): Trap | undefined {
  const t = (c.traps ?? []).find((x) => same(x.at, at));
  if (t) c.traps = c.traps!.filter((x) => x !== t);
  return t;
}
const took = (c: Campaign, f: Faction) => { c.taken ??= zero(); c.taken[f]++; };
function capture(c: Campaign, x: Sector, f: Faction) {
  x.owner = f;
  delete x.guns; // wrecked in the fighting
  took(c, f);
}

// Phase 5: once the fighting's over, a side that took somewhere gets to deploy. Without one, on
// to collecting.
function afterCombat(c: Campaign): Campaign {
  const movers = FACTIONS.filter((f) => (c.taken?.[f] ?? 0) > 0);
  if (!movers.length) return upkeep(c);
  c.deploying = movers;
  return c;
}

// A deploy: armies from a sector you hold to another on the same world or next door, ships from
// an orbit you hold to one next door, leaving one behind to hold the place. Checked in sequence
// against what the earlier ones left, like orders.
export function planDeploys(c: Campaign, f: Faction, moves: Order[]) {
  const d = structuredClone(c);
  const errors = moves.map((o) => {
    const err = deployError(d, f, o);
    if (!err) shift(d, f, o);
    return err;
  });
  return { c: d, errors };
}

const isWhere = (w: unknown): w is Where => !!w && typeof (w as Where).system === "string" && Number.isInteger((w as Where).sector);
function deployError(c: Campaign, f: Faction, o: Order): string | null {
  if (!o || typeof o !== "object" || (o.kind !== "army" && o.kind !== "fleet")) return "That isn't a move";
  if (!Number.isInteger(o.count) || o.count < 1) return "Send at least one";
  if (o.kind === "fleet") {
    const from = c.systems[o.from], to = c.systems[o.to];
    if (!from || !to) return "No such system";
    if (!galaxyOf(c).adjacent(o.from, o.to)) return "No hyperlane between them";
    if (from.orbit !== f || to.orbit !== f) return "Ships redeploy between orbits you hold";
    return from.fleets[f] - o.count >= 1 ? null : "Leave a ship to hold the orbit";
  }
  if (!isWhere(o.from) || !isWhere(o.to)) return "No such sector";
  const from = sectorAt(c, o.from), to = sectorAt(c, o.to);
  if (!from || !to) return "No such sector";
  if (same(o.from, o.to)) return "Already there";
  if (from.owner !== f || to.owner !== f) return "Armies redeploy between sectors you hold";
  if (o.from.system !== o.to.system) {
    if (!galaxyOf(c).adjacent(o.from.system, o.to.system)) return "Move to the same world or one next door";
    if (c.systems[o.to.system]!.orbit === enemy(f)) return "Blockaded: the enemy holds the orbit";
  }
  return from.armies[f] - o.count >= 1 ? null : "Leave an army to hold it";
}

function shift(c: Campaign, f: Faction, o: Order) {
  if (o.kind === "fleet") { c.systems[o.from]!.fleets[f] -= o.count; c.systems[o.to]!.fleets[f] += o.count; }
  else if (o.kind === "army") { sectorAt(c, o.from)!.armies[f] -= o.count; sectorAt(c, o.to)!.armies[f] += o.count; }
}

// The deploy phase's moves, from the sides that are deploying, and then the turn's collecting.
// A move the rules refuse is skipped. Nothing goes in the log: the other side doesn't see it.
export function deployTurn(c0: Campaign, all: Orders[]): Campaign {
  if (!c0.deploying) return c0;
  const c = structuredClone(c0);
  for (const o of all) if (c0.deploying.includes(o.faction)) for (const m of o.deploys ?? []) if (!deployError(c, o.faction, m)) shift(c, o.faction, m);
  c.deploying = null;
  return upkeep(c);
}

// --- Declared attacks, and the retreats that answer them ---

const same = (a: Where, b: Where) => a.system === b.system && a.sector === b.sector;
const isOrbit = (w: Where) => w.sector < 0;

// Every attack in this turn's moves: a fleet into a system where the enemy holds the orbit or any
// ground, troops into a sector the enemy holds. One per side, source and target, however many go.
export function declareAttacks(c: Campaign, all: Orders[]): Attack[] {
  const d = planOrders(c, all), out: Attack[] = [];
  for (const t of d.transit) {
    const foe = enemy(t.faction), s = c.systems[t.to.system]!;
    const to = isOrbit(t.to) ? { system: t.to.system, sector: ORBIT } : t.to;
    const hit = isOrbit(t.to) ? s.orbit === foe || s.fleets[foe] > 0 || s.sectors.some((x) => x.owner === foe) : sectorAt(c, t.to)!.owner === foe;
    if (hit && !out.some((a) => a.faction === t.faction && a.from === t.from.system && same(a.to, to))) out.push({ faction: t.faction, from: t.from.system, to });
  }
  return out;
}

// Whether a side has a say in the retreats: it made an attack, or something of its is attacked.
export function involved(c: Campaign, f: Faction) {
  return (c.attacks ?? []).some((a) => {
    if (a.faction === f) return true;
    const s = c.systems[a.to.system]!;
    return isOrbit(a.to) ? s.orbit === f || s.fleets[f] > 0 : sectorAt(c, a.to)!.owner === f || sectorAt(c, a.to)!.armies[f] > 0;
  });
}

// Checks a side's retreats against the declared attacks and where its own moves left it, applying
// each to the draft so the next is checked against what this one left. Null for each that's fine.
export function checkRetreats(c: Campaign, own: Orders, retreats: Retreat[]): (string | null)[] {
  const d = planOrders(c, [{ ...own, retreats: undefined }]).c, f = own.faction, attacks = c.attacks ?? [];
  return retreats.map((r) => {
    const err = retreatError(c, d, f, r, attacks);
    if (!err && r.kind === "withdraw") move(d, f, r);
    return err;
  });
}

function retreatError(c: Campaign, d: Campaign, f: Faction, r: Retreat, attacks: Attack[]): string | null {
  if (!r || typeof r !== "object" || !r.to || typeof r.to.system !== "string" || !Number.isInteger(r.to.sector)) return "That isn't a retreat";
  if (r.kind === "calloff") return attacks.some((a) => a.faction === f && same(a.to, r.to)) ? null : "No attack of yours there";
  if (r.kind !== "withdraw" || !r.from || typeof r.from.system !== "string" || !Number.isInteger(r.from.sector)) return "That isn't a retreat";
  if (!attacks.some((a) => a.faction === enemy(f) && same(a.to, r.from))) return "Nobody is attacking there";
  if (isOrbit(r.from)) {
    if (!isOrbit(r.to) || !galaxyOf(c).adjacent(r.from.system, r.to.system)) return "Ships pull back along a hyperlane";
    return d.systems[r.from.system]!.fleets[f] ? null : "No ships of yours there";
  }
  const to = sectorAt(d, r.to);
  if (!to || isOrbit(r.to)) return "No such sector";
  if (same(r.from, r.to)) return "Already there";
  if (to.owner !== f) return "Pull back to a sector you hold";
  if (r.from.system !== r.to.system && !galaxyOf(c).adjacent(r.from.system, r.to.system)) return "Pull back to the same world or one next door";
  return sectorAt(d, r.from)!.armies[f] ? null : "No troops of yours there";
}

function move(c: Campaign, f: Faction, r: Extract<Retreat, { kind: "withdraw" }>) {
  if (isOrbit(r.from)) {
    c.systems[r.to.system]!.fleets[f] += c.systems[r.from.system]!.fleets[f];
    c.systems[r.from.system]!.fleets[f] = 0;
  } else {
    sectorAt(c, r.to)!.armies[f] += sectorAt(c, r.from)!.armies[f];
    sectorAt(c, r.from)!.armies[f] = 0;
  }
}

// Before anyone arrives: the attacks called off come home, and the withdrawals pull out.
function retreat(d: Draft, c0: Campaign, all: Orders[]) {
  const attacks = c0.attacks ?? [];
  for (const o of all) for (const r of o.retreats ?? []) {
    const f = o.faction;
    if (retreatError(c0, d.c, f, r, attacks)) continue;
    if (r.kind === "calloff") {
      d.transit = d.transit.filter((t) => {
        if (t.faction !== f || !(isOrbit(r.to) ? isOrbit(t.to) && t.to.system === r.to.system : same(t.to, r.to))) return true;
        if (isOrbit(t.from)) d.c.systems[t.from.system]!.fleets[f] += t.count;
        else sectorAt(d.c, t.from)!.armies[f] += t.count;
        return false;
      });
      d.c.log.push(`${FACTION_NAMES[f]} call off the attack on ${isOrbit(r.to) ? `${name(d.c, r.to.system)}'s orbit` : where(d.c, r.to)}.`);
    } else {
      move(d.c, f, r);
      d.c.log.push(`${FACTION_NAMES[f]} pull out of ${isOrbit(r.from) ? `${name(d.c, r.from.system)}'s orbit` : where(d.c, r.from)} to ${isOrbit(r.to) ? name(d.c, r.to.system) : where(d.c, r.to)}.`);
    }
  }
}

// What a side sees of the map: who holds what everywhere, but the enemy's numbers only where it
// has someone to count them. Elsewhere they read as nothing, and the system is marked fogged.
export function fogged(c: Campaign, f: Faction): Campaign {
  const v = structuredClone(c), foe = enemy(f);
  for (const s of Object.values(v.systems)) {
    if (s.fleets[f] > 0 || s.sectors.some((x) => x.owner === f || x.armies[f] > 0)) continue;
    s.fleets[foe] = 0;
    for (const x of s.sectors) x.armies[foe] = 0;
    s.fog = true;
  }
  if (v.pending?.kind === "space") v.pending.landings = v.pending.landings.filter((t) => t.faction === f);
  // Their cards and traps are their own.
  if (v.hands) v.hands = { ...v.hands, [foe]: [] };
  if (v.traps) v.traps = v.traps.filter((t) => t.faction === f);
  if (v.dugIn) v.dugIn = v.dugIn.filter((d) => d.faction === f);
  if (v.bombards) v.bombards = v.bombards.filter((b) => b.faction === f);
  return v;
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
    turrets: (x.kind === "shield" || x.kind === "cannon" ? 2 : 1) + (x.guns ? 1 : 0),
    ...(c.mode && c.mode !== "conquest" && { mode: c.mode }),
    ...(x.armies[att] + x.armies[def] >= BIG_BATTLE && BIG_MAP_FOR[x.kind] && { map: BIG_MAP_FOR[x.kind] }),
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
  if (x.owner !== spec.factions[win]) capture(c, x, spec.factions[win]);
  c.log.push(`Hero battle at ${where(c, p.at)}: ${FACTION_NAMES[spec.factions[win]]} wins with ${survivors} ${survivors === 1 ? "army" : "armies"} left.`);
  heroBack(c, spec.factions[spec.hero], win === spec.hero, res.heroDown);
  c.pending = null;
  return afterCombat(c);
}

// Each side's fleet over the system becomes a line of cruisers; the defender held the orbit.
export function buildSpaceSpec(c: Campaign, system: string, def: Faction, seed: number, heroOf: Faction = c.player, breakout = false): SpaceBattleSpec {
  const s = c.systems[system]!, att = enemy(def);
  return {
    ...(breakout && { breakout: true as const }),
    id: `${c.turn}-${system}-orbit`,
    turn: c.turn,
    system: name(c, system),
    factions: { attacker: att, defender: def },
    hero: att === heroOf ? "attacker" : "defender",
    heroLevel: c.heroes[heroOf].level,
    fleets: { attacker: breakout ? BREAKOUT_SHIPS : s.fleets[att], defender: s.fleets[def] },
    muster: { attacker: musterOf(s, att).troops, defender: musterOf(s, def).troops },
    batteries: { attacker: musterOf(s, att).batteries, defender: musterOf(s, def).batteries },
    seed,
  };
}

// A side with armies on a world but no ships over it, under the enemy's blockade, can send its hero
// up to break out: one ship against the whole fleet.
export const canBreakOut = (s: SystemState, f: Faction) => !s.fleets[f] && s.fleets[enemy(f)] > 0 && s.sectors.some((x) => x.armies[f] > 0);

// The winner's cruisers still fit to fly keep the orbit (one at least, and boarding can bring
// prizes home); the loser's fleet there is gone. A pick battle's toll on the world below comes off
// its armies. Then the turn goes on: landings under the orbit as it now stands, and ground battles.
export function applySpaceResult(c0: Campaign, res: SpaceBattleResult): Campaign {
  const p = c0.pending;
  if (p?.kind !== "space" || p.spec.id !== res.id) throw new Error("that isn't the battle being fought");
  const c = structuredClone(c0), spec = p.spec, s = c.systems[p.system]!;
  const win = res.winner, lose = otherSide(win), kept = Math.max(1, Math.min(spec.breakout ? spec.fleets[win] : spec.fleets.attacker + spec.fleets.defender, res.fleets[win]));
  const winner = spec.factions[win], loser = spec.factions[lose];
  s.fleets[winner] = kept;
  s.fleets[loser] = 0;
  if (winner === spec.factions.attacker && s.orbit === spec.factions.defender) took(c, winner);
  s.orbit = winner;
  c.log.push(`Hero space battle over ${name(c, p.system)}: ${FACTION_NAMES[winner]} holds the orbit with ${kept} ${kept === 1 ? "ship" : "ships"} left.`);
  for (const side of ["attacker", "defender"] as const) {
    const n = thin(s, spec.factions[side], res.ground?.[side] ?? 0);
    if (n) c.log.push(`${FACTION_NAMES[spec.factions[side]]} lose ${n} ${n === 1 ? "army" : "armies"} on ${name(c, p.system)} to bombardment and boarding.`);
  }
  // What the orbit means now, felt at once: a blockade, the bombardment to come, who lands.
  if (s.sectors.some((x) => x.owner === loser)) {
    c.log.push(`${FACTION_NAMES[winner]} blockade ${name(c, p.system)}: ${FACTION_NAMES[loser]} can't build there, and supply through it is cut.`);
    if (kept >= BOMBARD_FLEETS && musterOf(s, loser).troops) c.log.push(holdsShield(s, loser)
      ? `The shield on ${name(c, p.system)} keeps ${FACTION_NAMES[winner]}'s guns off the armies below.`
      : `${FACTION_NAMES[winner]}'s ${kept} ships will bombard the ${FACTION_NAMES[loser]} on ${name(c, p.system)} every turn they hold the orbit.`);
  }
  for (const t of p.landings) if (t.to.system === p.system && t.from.system !== p.system && t.faction === winner) {
    c.log.push(`${t.count} ${FACTION_NAMES[t.faction]} ${t.count === 1 ? "army comes" : "armies come"} down on ${where(c, t.to)} under their orbit.`);
  }
  heroBack(c, spec.factions[spec.hero], win === spec.hero, res.heroDown);
  if (win !== spec.hero) {
    const hero = c.heroes[spec.factions[spec.hero]];
    hero.woundedUntil = Math.max(hero.woundedUntil, c.turn + LOST_TURNS);
    c.log.push(`${FACTION_NAMES[spec.factions[spec.hero]]}'s hero is lost with the flagship over ${name(c, p.system)}, out until turn ${hero.woundedUntil}.`);
  }
  c.pending = null;
  return landAndFight(c, p.landings, [], rng((c.seed * 1000 + c.turn) ^ 0x2545f491));
}

// Takes n armies of a side off a world, from wherever it has the most, and says how many went.
function thin(s: SystemState, f: Faction, n: number) {
  let gone = 0;
  for (; gone < n; gone++) {
    const x = s.sectors.reduce<Sector | null>((best, y) => (y.armies[f] > (best?.armies[f] ?? 0) ? y : best), null);
    if (!x) break;
    x.armies[f]--;
  }
  return gone;
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

// Phase 6, the end of the turn: cannon fire, bombardment, supply, income and region bonuses, a
// card for taking three or more places, whether the war is over, and the next turn's draw.
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
      if (!x.armies[enemy(o)] && x.armies[o]) { x.owner = o; delete x.guns; }
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
  const r = rng((c.seed * 1000 + c.turn) ^ 0x0b0a05e5);
  for (const f of FACTIONS) {
    const n = c.taken?.[f] ?? 0;
    if (n < BONUS_PLACES) continue;
    deal(c, f, CARDS[Math.floor(r() * CARDS.length)]!);
    c.log.push(`${FACTION_NAMES[f]} took ${n} places and earns a card.`);
  }
  c.traps = null;
  c.dugIn = null;
  c.bombards = null;
  c.taken = null;
  for (const f of FACTIONS) {
    const capitals = Object.values(c.systems).some((s) => s.sectors.some((x) => x.kind === "capital" && x.owner === f));
    if (keyShare(c, f) >= WIN_SHARE || !capitals) c.winner = capitals ? f : enemy(f);
  }
  if (c.winner) c.log.push(`${FACTION_NAMES[c.winner]} wins the war.`);
  c.turn++;
  return draw(c);
}
