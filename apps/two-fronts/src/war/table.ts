// The table a campaign is played at: who sits in each seat, the orders handed in this turn, and
// the turn that resolves once every human seat has handed theirs in. The AI's seat gives its
// orders then. A turn can take up to three hand-ins, one per phase that needs a say: the orders
// (garrison, cards and moves), then once the attacks are declared, the retreats of each side with
// a say in them, and after the fighting, the deploys of each side that took somewhere. The rules
// stay pure; this only stores and sequences them, so the page runs it for a game against the AI or
// a hotseat game, and the campaign's Durable Object runs the same code for a game played a turn at
// a time over days.
import { MATCH_MODES, type BattleResult, type Faction, type MatchMode, type SpaceBattleResult } from "../battle/contract.ts";
import { replayGround, replaySpace } from "../battle/replay.ts";
import { run } from "../battle/sim.ts";
import { runSpace } from "../battle/space.ts";
import { fightPicks, replayPicks } from "../battle/space-picks.ts";
import { aiDeploys, aiOrders, aiRetreats, aiSpacePick } from "./ai.ts";
import { aiDeployment, beginWar, planDeployment } from "./fleet.ts";
import type { GalaxyId } from "./galaxy.ts";
import {
  CARDS, FACTIONS, ORBIT, applyBattleResult, applySpaceResult, checkRetreats, declareAttacks, deployTurn, heroReady, involved, newCampaign, planDeploys, planOrders, resolveTurn, sectorAt,
  type Campaign, type Orders,
} from "./rules.ts";

export type Seat = "human" | "ai";
export type Seats = Record<Faction, Seat>;

export interface Table {
  seats: Seats;
  campaign: Campaign;
  handedIn: Partial<Record<Faction, Orders>>;
  // While the turn waits on a hero battle or the deploys: every side's orders, for the history row.
  resolving: Orders[] | null;
  // While the turn waits on the deploys: the hero battle fought this turn, for the history row.
  fought?: BattleResult | SpaceBattleResult | null;
  // While the turn waits on retreats: every side's moves, kept here and never shown to the other seat.
  moves?: Orders[] | null;
  // After a ground battle: each side's one vote for how the next is fought. It never holds the turn up.
  vote?: Vote | null;
}

// The end-of-match vote. The AI's seat votes the moment it opens; the page shows its pointer
// wandering over to that card. When every seat is in, `picked` is the campaign's next mode.
export interface Vote { match: string; votes: Partial<Record<Faction, MatchMode>>; picked: MatchMode | null }

// A resolved turn, as the history keeps it.
export interface TurnRecord { turn: number; orders: Orders[]; battle: BattleResult | SpaceBattleResult | null; log: string[] }

export type Step = { ok: true; table: Table; done: TurnRecord | null } | { ok: false; error: string };

const MAX_ORDERS = 200;
const MAX_RETREATS = 100;
const MAX_DEPLOYS = 200;
// Ten minutes of ground battle with the mouse never still logs about 48 KB; this is well past that.
export const MAX_INPUTS = 192 * 1024;

// With `setup`, the war opens with each side picking a fleet and placing it (src/war/fleet.ts).
export function newTable(seats: Seats, galaxy: GalaxyId = "short", seed = Math.floor(Math.random() * 1e9), setup = false): Table {
  // The rules' `player` is the side whose hero sits at the table against the AI. With two
  // humans it's the Thunder Marines, and each side's hero comes from its own orders.
  const player = seats.marines === "human" || seats.wooka !== "human" ? "marines" : "wooka";
  return { seats, campaign: newCampaign(seed, player, galaxy, setup), handedIn: {}, resolving: null };
}

export const humans = (t: Table) => FACTIONS.filter((f) => t.seats[f] === "human");
export const heroFaction = (c: Campaign): Faction | null => (c.pending ? c.pending.spec.factions[c.pending.spec.hero] : null);

// Whose move it is: the hero battle's side while one is waiting, or the humans yet to hand in orders.
export function waitingOn(t: Table): Faction[] {
  if (t.campaign.winner) return [];
  const h = heroFaction(t.campaign);
  if (h) return [h];
  const c = t.campaign;
  if (c.setup) return humans(t).filter((f) => !t.handedIn[f] && c.setup!.includes(f));
  if (c.deploying) return humans(t).filter((f) => !t.handedIn[f] && c.deploying!.includes(f));
  return humans(t).filter((f) => !t.handedIn[f] && (!c.attacks || involved(c, f)));
}
export const retreating = (c: Campaign) => !!c.attacks;
export const deploying = (c: Campaign) => !!c.deploying;

// A seat hands in its orders for the turn. The last one in resolves it.
export function handIn(t: Table, f: Faction, o: Orders): Step {
  const c = t.campaign;
  if (c.winner) return { ok: false, error: "The war is over" };
  if (c.pending) return { ok: false, error: "A hero battle has to be fought first" };
  if (t.seats[f] !== "human") return { ok: false, error: "That side isn't yours" };
  if (t.handedIn[f]) return { ok: false, error: c.setup ? "Fleet already placed" : c.deploying ? "Deploys already in for this turn" : c.attacks ? "Retreats already in for this turn" : "Orders already in for this turn" };
  if (c.setup) return handInSetup(t, f, o);
  if (c.deploying) return handInDeploys(t, f, o);
  if (c.attacks) return handInRetreats(t, f, o);
  const error = checkOrders(c, f, o);
  if (error) return { ok: false, error };

  const next: Table = { ...t, handedIn: { ...t.handedIn, [f]: { faction: f, orders: o.orders, ...(o.hero && { hero: o.hero }) } } };
  if (waitingOn(next).length) return { ok: true, table: next, done: null };
  const all = FACTIONS.map((g) => next.handedIn[g] ?? aiOrders(c, g));
  // Attacks are declared, and a side with a say in them gets to answer before anything resolves.
  const declared: Campaign = { ...c, attacks: declareAttacks(c, all) };
  const ask: Table = { ...next, campaign: declared, handedIn: {}, moves: all };
  if (declared.attacks!.length && waitingOn(ask).length) return { ok: true, table: ask, done: null };
  return resolve(ask);
}

// A seat places its fleet. When every seat has, the AI's fleets go down with them and the war begins.
function handInSetup(t: Table, f: Faction, o: Orders): Step {
  const c = t.campaign;
  if (!c.setup!.includes(f)) return { ok: false, error: "Your fleet is already placed" };
  if (!o || o.faction !== f || !o.deployment) return { ok: false, error: "Place your fleet first" };
  const error = planDeployment(c, f, o.deployment);
  if (error) return { ok: false, error };
  const next: Table = { ...t, handedIn: { ...t.handedIn, [f]: { faction: f, orders: [], deployment: o.deployment } } };
  if (waitingOn(next).length) return { ok: true, table: next, done: null };
  const all = Object.fromEntries(FACTIONS.map((g) => [g, next.handedIn[g]?.deployment ?? aiDeployment(c, g)])) as Record<Faction, NonNullable<Orders["deployment"]>>;
  return { ok: true, table: { ...next, campaign: beginWar(c, all), handedIn: {} }, done: null };
}

// A seat answers the declared attacks: its retreats, and the hero's battle if it picks one now.
function handInRetreats(t: Table, f: Faction, o: Orders): Step {
  const c = t.campaign, own = t.moves?.find((m) => m.faction === f);
  if (!own || !involved(c, f)) return { ok: false, error: "Nothing to answer this turn" };
  if (!o || o.faction !== f || !Array.isArray(o.retreats ?? [])) return { ok: false, error: "Those aren't retreats" };
  const retreats = o.retreats ?? [];
  if (retreats.length > MAX_RETREATS) return { ok: false, error: "Too many retreats" };
  const error = checkRetreats(c, own, retreats).find((e) => e) ?? (o.hero ? checkHero(c, f, o.hero) : null);
  if (error) return { ok: false, error };
  const next: Table = { ...t, handedIn: { ...t.handedIn, [f]: { faction: f, orders: [], retreats, ...(o.hero && { hero: o.hero }) } } };
  return waitingOn(next).length ? { ok: true, table: next, done: null } : resolve(next);
}

// A seat that took somewhere moves into it, and moves what's left.
function handInDeploys(t: Table, f: Faction, o: Orders): Step {
  const c = t.campaign;
  if (!c.deploying!.includes(f)) return { ok: false, error: "Nothing to deploy this turn" };
  if (!o || o.faction !== f || !Array.isArray(o.deploys ?? [])) return { ok: false, error: "Those aren't deploys" };
  const deploys = o.deploys ?? [];
  if (deploys.length > MAX_DEPLOYS) return { ok: false, error: "Too many deploys" };
  const error = planDeploys(c, f, deploys).errors.find((e) => e);
  if (error) return { ok: false, error };
  const next: Table = { ...t, handedIn: { ...t.handedIn, [f]: { faction: f, orders: [], deploys } } };
  return waitingOn(next).length ? { ok: true, table: next, done: null } : deploy(next);
}

// Every side's moves with its retreats (the AI's own, for a side nobody is answering for), then the turn.
function resolve(t: Table): Step {
  const c = t.campaign, moves = t.moves ?? [];
  const all = moves.map((m): Orders => {
    const said = t.handedIn[m.faction];
    const retreats = said ? said.retreats ?? [] : t.seats[m.faction] === "ai" ? aiRetreats(c, m) : [];
    return { ...m, ...(said?.hero && { hero: said.hero }), ...(retreats.length && { retreats }) };
  });
  return fought({ ...t, campaign: resolveTurn(c, all), handedIn: {}, moves: null, resolving: all }, null);
}

// After a turn's combat, or its pause for a hero battle: wait on the battle, or on the humans with
// a deploy to make, or finish the turn with the AI's.
function fought(t: Table, battle: BattleResult | SpaceBattleResult | null): Step {
  if (t.campaign.pending) return { ok: true, table: t, done: null };
  const next: Table = { ...t, fought: battle };
  return t.campaign.deploying && waitingOn(next).length ? { ok: true, table: next, done: null } : deploy(next);
}

// The deploy phase's moves (the AI's own, for its side), then the turn's end. The history row has
// the whole turn.
function deploy(t: Table): Step {
  const c = t.campaign;
  const all = (t.resolving ?? []).map((o): Orders => {
    if (!c.deploying?.includes(o.faction)) return o;
    const said = t.handedIn[o.faction], deploys = said ? said.deploys ?? [] : t.seats[o.faction] === "ai" ? aiDeploys(c, o.faction) : [];
    return deploys.length ? { ...o, deploys } : o;
  });
  // The turn's end counts the turn on, here or already in its combat if nobody took anything.
  const after = deployTurn(c, all);
  return { ok: true, table: { ...t, campaign: after, handedIn: {}, resolving: null, fought: null }, done: { turn: after.turn - 1, orders: all, battle: t.fought ?? null, log: after.log } };
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
    // Fought by picking, or flown. A pick battle is fought again from the hero's picks, with the
    // AI picking for the other side (and for the hero's, past the last pick or left to the AI).
    const spec = c.pending.spec, picked = (res as SpaceBattleResult).picks;
    if (picked !== undefined && picked !== true) return { ok: false, error: "That result doesn't add up" };
    const r = picked
      ? res.auto ? fightPicks(spec, [], aiSpacePick)?.over ?? null : replayPicks(spec, res.inputs!, aiSpacePick)
      : res.auto ? runSpace(spec).over : replaySpace(spec, res.inputs!);
    if (!r) return { ok: false, error: "Those inputs don't make a battle" };
    const clean: SpaceBattleResult = {
      id: r.id, winner: r.winner, fleets: { attacker: r.fleets.attacker, defender: r.fleets.defender }, heroDown: r.heroDown,
      ...(r.ground && { picks: true as const, ground: { attacker: r.ground.attacker, defender: r.ground.defender } }), ...(res.auto && { auto: true as const }),
    };
    after = applySpaceResult(c, clean);
    battle = clean;
  } else {
    const r = res.auto ? run(c.pending.spec).over : replayGround(c.pending.spec, res.inputs!);
    if (!r) return { ok: false, error: "Those inputs don't make a battle" };
    const clean = { id: r.id, winner: r.winner, tickets: { attacker: r.tickets.attacker, defender: r.tickets.defender }, heroDown: r.heroDown, ...(res.auto && { auto: true as const }) };
    after = applyBattleResult(c, clean);
    battle = clean;
    // A ground battle ends in the vote for how the next one is fought.
    return fought({ ...t, campaign: after, vote: openVote(t, r.id) }, battle);
  }
  return fought({ ...t, campaign: after }, battle);
}

// The AI's vote: any mode but the one just fought, picked from the match id so it's the same every time.
export const aiVote = (match: string, seat: Faction, now: MatchMode = "conquest"): MatchMode => {
  const others = MATCH_MODES.filter((m) => m !== now);
  return others[hash(`${match}:${seat}`) % others.length]!;
};
const hash = (s: string) => [...s].reduce((h, ch) => (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0), 2166136261);

// Most votes wins. A split vote goes one way or the other by the match id, the same on every screen.
export function tally(match: string, votes: Partial<Record<Faction, MatchMode>>): MatchMode {
  const n = new Map<MatchMode, number>();
  for (const m of Object.values(votes)) if (m) n.set(m, (n.get(m) ?? 0) + 1);
  const most = Math.max(0, ...n.values()), tied = MATCH_MODES.filter((m) => n.get(m) === most);
  return tied.length ? tied[hash(match) % tied.length]! : "conquest";
}

function openVote(t: Table, match: string): Vote {
  const votes: Vote["votes"] = {};
  for (const f of FACTIONS) if (t.seats[f] === "ai") votes[f] = aiVote(match, f, t.campaign.mode);
  return { match, votes, picked: null };
}

// A seat votes once for the next match's mode. The last vote in picks it.
export function castVote(t: Table, f: Faction, match: string, mode: MatchMode): Step {
  const v = t.vote;
  if (!v || v.match !== match || v.picked) return { ok: false, error: "No vote is open" };
  if (t.seats[f] !== "human") return { ok: false, error: "That side isn't yours" };
  if (v.votes[f]) return { ok: false, error: "You've voted" };
  if (!MATCH_MODES.includes(mode)) return { ok: false, error: "No such mode" };
  const votes = { ...v.votes, [f]: mode };
  const done = FACTIONS.every((g) => votes[g]);
  const picked = done ? tally(match, votes) : null;
  return { ok: true, table: { ...t, vote: { match, votes, picked }, ...(picked && { campaign: { ...t.campaign, mode: picked } }) }, done: null };
}

// Orders from a stranger's browser: the right shape, every one legal, and a hero who can fight.
function checkOrders(c: Campaign, f: Faction, o: Orders): string | null {
  if (!o || o.faction !== f || !Array.isArray(o.orders)) return "Those aren't orders";
  if (o.orders.length > MAX_ORDERS) return "Too many orders";
  if (o.orders.some((x) => !x || typeof x !== "object" || !["build", "fleet", "army", "card", "bombard"].includes(x.kind) || (x.kind === "build" && x.unit !== "fleet" && x.unit !== "army") || (x.kind === "card" && !CARDS.includes(x.card)))) return "Those aren't orders";
  if (o.retreats?.length) return "Retreats come after the attacks are declared";
  if (o.deploys?.length) return "Deploys come after the fighting";
  if (o.deployment) return "Fleets are placed before the war begins";
  if (o.hero) {
    const err = checkHero(c, f, o.hero);
    if (err) return err;
  }
  try {
    return planOrders(c, [o]).errors.find((e) => e) ?? null;
  } catch {
    return "Those aren't orders";
  }
}

function checkHero(c: Campaign, f: Faction, hero: Orders["hero"]): string | null {
  if (!hero || typeof hero.system !== "string" || !Number.isInteger(hero.sector)) return "No such sector for the hero";
  if (hero.sector === ORBIT ? !Object.hasOwn(c.systems, hero.system) : !sectorAt(c, hero)) return "No such sector for the hero";
  return heroReady(c, f) ? null : "Your hero is wounded";
}
