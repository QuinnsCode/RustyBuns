// The table a campaign is played at: who sits in each seat, the orders handed in this turn, and
// the turn that resolves once every human seat has handed theirs in. The AI's seat gives its
// orders then. The rules stay pure; this only stores and sequences them, so the page runs it for
// a game against the AI or a hotseat game, and the campaign's Durable Object runs the same code
// for a game played a turn at a time over days.
import type { BattleResult, Faction, SpaceBattleResult } from "../battle/contract.ts";
import { replayGround, replaySpace } from "../battle/replay.ts";
import { run } from "../battle/sim.ts";
import { runSpace } from "../battle/space.ts";
import { aiOrders } from "./ai.ts";
import type { GalaxyId } from "./galaxy.ts";
import {
  FACTIONS, ORBIT, applyBattleResult, applySpaceResult, heroReady, newCampaign, planOrders, resolveTurn, sectorAt,
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
export interface TurnRecord { turn: number; orders: Orders[]; battle: BattleResult | SpaceBattleResult | null; log: string[] }

export type Step = { ok: true; table: Table; done: TurnRecord | null } | { ok: false; error: string };

const MAX_ORDERS = 200;
// Ten minutes of ground battle with the mouse never still logs about 48 KB; this is well past that.
export const MAX_INPUTS = 192 * 1024;

export function newTable(seats: Seats, galaxy: GalaxyId = "short", seed = Math.floor(Math.random() * 1e9)): Table {
  // The rules' `player` is the side whose hero sits at the table against the AI. With two
  // humans it's the Marines, and each side's hero comes from its own orders.
  const player = seats.marines === "human" || seats.wooka !== "human" ? "marines" : "wooka";
  return { seats, campaign: newCampaign(seed, player, galaxy), handedIn: {}, resolving: null };
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

// The hero's side reports how their battle went, on the ground or in orbit, and the turn finishes.
// A result can come from a stranger's browser, so the numbers in it don't count: a battle left to
// the AI is run again here, and a played one is played again from the hero's inputs. That run's
// result is the one kept.
export function report(t: Table, f: Faction, res: BattleResult | SpaceBattleResult): Step {
  const c = t.campaign;
  if (!c.pending) return { ok: false, error: "No battle is being fought" };
  if (heroFaction(c) !== f) return { ok: false, error: "That battle isn't yours" };
  if (!res || res.id !== c.pending.spec.id) return { ok: false, error: "That isn't the battle being fought" };
  if (res.auto !== undefined && res.auto !== true) return { ok: false, error: "That result doesn't add up" };
  if (!res.auto && (typeof res.inputs !== "string" || res.inputs.length > MAX_INPUTS)) return { ok: false, error: "A played battle needs the hero's inputs" };
  let after: Campaign, battle: BattleResult | SpaceBattleResult;
  if (c.pending.kind === "space") {
    const r = res.auto ? runSpace(c.pending.spec).over : replaySpace(c.pending.spec, res.inputs!);
    if (!r) return { ok: false, error: "Those inputs don't make a battle" };
    const clean = { id: r.id, winner: r.winner, fleets: { attacker: r.fleets.attacker, defender: r.fleets.defender }, heroDown: r.heroDown, ...(res.auto && { auto: true as const }) };
    after = applySpaceResult(c, clean);
    battle = clean;
  } else {
    const r = res.auto ? run(c.pending.spec).over : replayGround(c.pending.spec, res.inputs!);
    if (!r) return { ok: false, error: "Those inputs don't make a battle" };
    const clean = { id: r.id, winner: r.winner, tickets: { attacker: r.tickets.attacker, defender: r.tickets.defender }, heroDown: r.heroDown, ...(res.auto && { auto: true as const }) };
    after = applyBattleResult(c, clean);
    battle = clean;
  }
  return { ok: true, table: { ...t, campaign: after, resolving: null }, done: { turn: c.turn, orders: t.resolving ?? [], battle, log: after.log } };
}

// Orders from a stranger's browser: the right shape, every one legal, and a hero who can fight.
function checkOrders(c: Campaign, f: Faction, o: Orders): string | null {
  if (!o || o.faction !== f || !Array.isArray(o.orders)) return "Those aren't orders";
  if (o.orders.length > MAX_ORDERS) return "Too many orders";
  if (o.orders.some((x) => !x || typeof x !== "object" || !["build", "fleet", "army"].includes(x.kind) || (x.kind === "build" && x.unit !== "fleet" && x.unit !== "army"))) return "Those aren't orders";
  if (o.hero) {
    if (typeof o.hero.system !== "string" || !Number.isInteger(o.hero.sector)) return "No such sector for the hero";
    if (o.hero.sector === ORBIT ? !Object.hasOwn(c.systems, o.hero.system) : !sectorAt(c, o.hero)) return "No such sector for the hero";
    if (!heroReady(c, f)) return "Your hero is wounded";
  }
  try {
    return planOrders(c, [o]).errors.find((e) => e) ?? null;
  } catch {
    return "Those aren't orders";
  }
}
