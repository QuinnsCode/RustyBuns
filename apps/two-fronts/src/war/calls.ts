// The play caller's arithmetic: in each phase, what can go, from where, to where, how many, and
// what one order would cost and risk. Everything is read off planOrders, so the panel never offers
// a move the rules would refuse, and the numbers it shows are the ones the turn will use.
import { galaxyOf } from "./galaxy.ts";
import { landingCap } from "./landing.ts";
import { forecast, type Battle } from "./phases.ts";
import { ORBIT, enemy, idleShips, planDeploys, planOrders, type Campaign, type Order, type Orders, type Where } from "./rules.ts";
import type { Faction } from "../battle/contract.ts";

/** Armies inside your own ground (Deploy), or onto someone else's (Invasion). */
export type ArmyCall = "move" | "invade";
export type Build = "army" | "fleet";

const same = (a: Where, b: Where) => a.system === b.system && a.sector === b.sector;
const with1 = (mine: Orders, o: Order): Orders => ({ ...mine, orders: [...mine.orders, o] });
/** Whether the rules take this order after the ones already given. */
export const fits = (c: Campaign, mine: Orders, o: Order) => !planOrders(c, [with1(mine, o)]).errors.at(-1);

export const armyOrder = (from: Where, to: Where, count: number): Order => ({ kind: "army", from, to, count });
export const fleetOrder = (from: string, to: string, count: number): Order => ({ kind: "fleet", from, to, count });

/** The sectors a side has armies on and holds, in the galaxy's order: where troops can leave from. */
export function armySources(draft: Campaign, f: Faction): Where[] {
  return galaxyOf(draft).systems.flatMap((d) => draft.systems[d.id]!.sectors.flatMap((x, i) => (x.owner === f && x.armies[f] > 0 ? [{ system: d.id, sector: i }] : [])));
}

/** Where troops from one sector may go: round the ring, or onto a world next door. A move stays on
 * ground the side holds; an invasion goes onto ground it doesn't. */
export function armyTargets(c: Campaign, mine: Orders, from: Where, call: ArmyCall): Where[] {
  const f = mine.faction, g = galaxyOf(c);
  return [from.system, ...g.neighbours(from.system)].flatMap((id) => c.systems[id]!.sectors.map((_, i) => ({ system: id, sector: i })))
    .filter((t) => !same(t, from) && (c.systems[t.system]!.sectors[t.sector]!.owner === f) === (call === "move") && fits(c, mine, armyOrder(from, t, 1)));
}

/** The worlds with ships free to sail (not trained on the ground below). */
export function shipSources(draft: Campaign, f: Faction): string[] {
  return galaxyOf(draft).systems.map((d) => d.id).filter((id) => idleShips(draft, draft.systems[id]!)[f] > 0);
}

/** The orbits next door a fleet may sail to this turn. */
export function shipTargets(c: Campaign, mine: Orders, from: string): string[] {
  return galaxyOf(c).neighbours(from).filter((n) => fits(c, mine, fleetOrder(from, n, 1)));
}

/** The most of `make(n)` the rules take, up to `hi`: 0 when not even one goes. */
export const most = (c: Campaign, mine: Orders, make: (n: number) => Order, hi: number) => largest((n) => fits(c, mine, make(n)), hi);
function largest(ok: (n: number) => boolean, hi: number): number {
  let lo = 0;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** The ships an army order pulls off the world it leaves to carry the troops: none inside a world,
 * none when transports already on that lane have room. */
export function transportsFor(c: Campaign, mine: Orders, o: Order): number {
  if (o.kind !== "army" || o.from.system === o.to.system) return 0;
  const idle = (orders: Orders) => { const d = planOrders(c, [orders]).c; return idleShips(d, d.systems[o.from.system]!)[mine.faction]; };
  return Math.max(0, idle(mine) - idle(with1(mine, o)));
}

/** The fight one more order would start, with the odds, or null when it starts none (a move, or an
 * orbit with no enemy ships in it). `seen` is the map as this side sees it, fog and all. */
export function matchup(seen: Campaign, mine: Orders, o: Order): Battle | null {
  if (o.kind !== "fleet" && o.kind !== "army") return null;
  const to: Where = o.kind === "fleet" ? { system: o.to, sector: ORBIT } : o.to;
  return forecast(seen, mine.faction, [...mine.orders, o]).find((b) => same(b.to, to)) ?? null;
}

/** How the sky over a world treats a landing this turn, as it stands: yours (all land), open (a few),
 * theirs (a trickle, or none), and whether an armada of yours is on its way to change that. */
export interface Sky { holder: "you" | "open" | "them"; land: number; armada: boolean }
export function skyOver(draft: Campaign, mine: Orders, system: string): Sky {
  const f = mine.faction, s = draft.systems[system]!, cap = landingCap(s, f);
  const armada = mine.orders.some((o) => o.kind === "fleet" && o.to === system);
  return { holder: s.orbit === f ? "you" : s.orbit === enemy(f) ? "them" : "open", land: cap.troops, armada };
}

/** The places a side can build on, and what: armies at a capital, ships at a spaceport (or a
 * capital on a world without one). Credits aside, so a site stays listed once the money's spent. */
export function buildSites(c: Campaign, mine: Orders): { at: Where; units: Build[] }[] {
  const f = mine.faction, rich = { ...c, credits: { ...c.credits, [f]: 1e9 } };
  return galaxyOf(c).systems.flatMap((d) => c.systems[d.id]!.sectors.flatMap((x, i) => {
    if (x.owner !== f) return [];
    const at = { system: d.id, sector: i }, units = (["army", "fleet"] as const).filter((unit) => fits(rich, mine, { kind: "build", unit, at }));
    return units.length ? [{ at, units: [...units] }] : [];
  }));
}

// --- After the fighting: deploys, checked with planDeploys (all but one may leave a place) ---

/** A deploy from a place: troops round the ring or next door, or ships from an orbit to one next door. */
export const deployOrder = (from: Where, to: Where, count: number): Order =>
  from.sector === ORBIT ? fleetOrder(from.system, to.system, count) : armyOrder(from, to, count);
/** Whether the rules take this deploy after the ones already given. */
export const deployFits = (c: Campaign, f: Faction, deploys: Order[], o: Order) => !planDeploys(c, f, [...deploys, o]).errors.at(-1);

/** Where one deploy may go: ground you hold on the same world or next door, or an orbit you hold next door. */
export function deployTargets(c: Campaign, f: Faction, deploys: Order[], from: Where): Where[] {
  const g = galaxyOf(c), near = from.sector === ORBIT ? g.neighbours(from.system).map((id) => ({ system: id, sector: ORBIT }))
    : [from.system, ...g.neighbours(from.system)].flatMap((id) => c.systems[id]!.sectors.map((_, i) => ({ system: id, sector: i })));
  return near.filter((t) => !same(t, from) && deployFits(c, f, deploys, deployOrder(from, t, 1)));
}

/** The places with something to spare (more than the one that holds it) and somewhere to take it,
 * the world on screen first. `draft` is the map after the deploys already given. */
export function deploySources(c: Campaign, draft: Campaign, f: Faction, deploys: Order[], first: string | null): Where[] {
  const spare = galaxyOf(draft).systems.flatMap((d) => {
    const s = draft.systems[d.id]!;
    return [...(s.orbit === f && s.fleets[f] > 1 ? [{ system: d.id, sector: ORBIT }] : []),
      ...s.sectors.flatMap((x, i) => (x.owner === f && x.armies[f] > 1 ? [{ system: d.id, sector: i }] : []))];
  }).sort((a, b) => Number(b.system === first) - Number(a.system === first));
  return spare.slice(0, 24).filter((w) => deployTargets(c, f, deploys, w).length);
}

/** The most one deploy can take: all but the one left holding the place. */
export function deployMost(c: Campaign, f: Faction, deploys: Order[], from: Where, to: Where): number {
  const d = planDeploys(c, f, deploys).c, s = d.systems[from.system]!;
  return largest((n) => deployFits(c, f, deploys, deployOrder(from, to, n)), from.sector === ORBIT ? s.fleets[f] : s.sectors[from.sector]!.armies[f]);
}
