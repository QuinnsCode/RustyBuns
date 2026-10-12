// The table a campaign is played at: who sits in each seat, the orders handed in this turn, and
// the turn that resolves once every human seat has handed theirs in. The AI's seat gives its
// orders then. The rules stay pure; this only stores and sequences them, so the page runs it for
// a game against the AI or a hotseat game, and the campaign's Durable Object runs the same code
// for a game played a turn at a time over days.
import type { BattleResult, Faction } from "../battle/contract.ts";
import { aiOrders } from "./ai.ts";
import {
  FACTIONS, applyBattleResult, heroReady, newCampaign, planOrders, resolveTurn, sectorAt,
  type Campaign, type Orders,
} from "./rules.ts";

export type Seat = "human" | "ai";
export type Seats = Record<Faction, Seat>;

export interface Table {
  seats: Seats;
  campaign: Campaign;
  handedIn: Partial<Record<Faction, Orders>>;
  // While the turn waits on a hero battle: every side's orders, for the history row.
  resolving: Orders[] | null;
}

// A resolved turn, as the history keeps it.
export interface TurnRecord { turn: number; orders: Orders[]; battle: BattleResult | null; log: string[] }

export type Step = { ok: true; table: Table; done: TurnRecord | null } | { ok: false; error: string };

const MAX_ORDERS = 200;

export function newTable(seats: Seats, seed = Math.floor(Math.random() * 1e9)): Table {
  // The rules' `player` is the side whose hero sits at the table against the AI. With two
  // humans it's the Marines, and each side's hero comes from its own orders.
  const player = seats.marines === "human" || seats.wooka !== "human" ? "marines" : "wooka";
  return { seats, campaign: newCampaign(seed, player), handedIn: {}, resolving: null };
}

export const humans = (t: Table) => FACTIONS.filter((f) => t.seats[f] === "human");
export const heroFaction = (c: Campaign): Faction | null => (c.pending ? c.pending.spec.factions[c.pending.spec.hero] : null);

// Whose move it is: the hero battle's side while one is waiting, or the humans yet to hand in orders.
export function waitingOn(t: Table): Faction[] {
  if (t.campaign.winner) return [];
  const h = heroFaction(t.campaign);
  return h ? [h] : humans(t).filter((f) => !t.handedIn[f]);
}

// A seat hands in its orders for the turn. The last one in resolves it.
export function handIn(t: Table, f: Faction, o: Orders): Step {
  const c = t.campaign;
  if (c.winner) return { ok: false, error: "The war is over" };
  if (c.pending) return { ok: false, error: "A hero battle has to be fought first" };
  if (t.seats[f] !== "human") return { ok: false, error: "That side isn't yours" };
  if (t.handedIn[f]) return { ok: false, error: "Orders already in for this turn" };
  const error = checkOrders(c, f, o);
  if (error) return { ok: false, error };

  const next: Table = { ...t, handedIn: { ...t.handedIn, [f]: { faction: f, orders: o.orders, ...(o.hero && { hero: o.hero }) } } };
  if (waitingOn(next).length) return { ok: true, table: next, done: null };
  const all = FACTIONS.map((g) => next.handedIn[g] ?? aiOrders(c, g));
  const after = resolveTurn(c, all);
  if (after.pending) return { ok: true, table: { ...next, campaign: after, handedIn: {}, resolving: all }, done: null };
  return { ok: true, table: { ...next, campaign: after, handedIn: {} }, done: { turn: c.turn, orders: all, battle: null, log: after.log } };
}

// The hero's side reports how their battle went, and the turn finishes.
export function report(t: Table, f: Faction, res: BattleResult): Step {
  const c = t.campaign;
  if (!c.pending) return { ok: false, error: "No battle is being fought" };
  if (heroFaction(c) !== f) return { ok: false, error: "That battle isn't yours" };
  if (!res || res.id !== c.pending.spec.id || (res.winner !== "attacker" && res.winner !== "defender")) return { ok: false, error: "That isn't the battle being fought" };
  const tickets = { attacker: num(res.tickets?.attacker), defender: num(res.tickets?.defender) };
  const after = applyBattleResult(c, { id: res.id, winner: res.winner, tickets, heroDown: res.heroDown === true });
  return { ok: true, table: { ...t, campaign: after, resolving: null }, done: { turn: c.turn, orders: t.resolving ?? [], battle: res, log: after.log } };
}

const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

// Orders from a stranger's browser: the right shape, every one legal, and a hero who can fight.
function checkOrders(c: Campaign, f: Faction, o: Orders): string | null {
  if (!o || o.faction !== f || !Array.isArray(o.orders)) return "Those aren't orders";
  if (o.orders.length > MAX_ORDERS) return "Too many orders";
  if (o.orders.some((x) => !x || typeof x !== "object" || !["build", "fleet", "army"].includes(x.kind) || (x.kind === "build" && x.unit !== "fleet" && x.unit !== "army"))) return "Those aren't orders";
  if (o.hero) {
    if (typeof o.hero.system !== "string" || !Number.isInteger(o.hero.sector) || !sectorAt(c, o.hero)) return "No such sector for the hero";
    if (!heroReady(c, f)) return "Your hero is wounded";
  }
  try {
    return planOrders(c, [o]).errors.find((e) => e) ?? null;
  } catch {
    return "Those aren't orders";
  }
}
