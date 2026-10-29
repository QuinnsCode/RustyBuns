// The AI faction's orders: spend everything, play its cards on the front, walk its garrisons out
// from under the Gale, push fleets into weaker orbits next door, and land troops behind them. After the fighting, it moves what it has spare up
// to the front. Every order goes through the rules' own checks, so it never queues one they refuse.
import { other, type Faction, type Side, type SpaceOrder } from "../battle/contract.ts";
import { HULL_PER_SHIP, ROUNDS, exchange, legalPicks, type PickBattle } from "../battle/space-picks.ts";
import { mulberry32 } from "@rustybuns/util";
import { galaxyOf, isHold, touching } from "./galaxy.ts";
import { CARRY, COST, ORBIT, SCORED, checkRetreats, enemy, handOf, idleShips, landingError, planDeploys, planOrders, scoredHolds, sectorAt, type Campaign, type Deck, type Order, type Orders, type Retreat, type SystemState } from "./rules.ts";
import { galeAt, sheltered } from "./gale.ts";
import { yearOf } from "./objectives.ts";

export function aiOrders(c: Campaign, f: Faction): Orders {
  const orders: Order[] = [];
  const tryAdd = (o: Order) => {
    const d = planOrders(c, [{ faction: f, orders: [...orders, o] }]);
    if (d.errors.at(-1) === null) { orders.push(o); return true; }
    return false;
  };
  // The galaxy lists its systems in twin order, the last the first one's twin, so each side reads
  // it from its own end. Then every first-come choice below goes the same way for both sides, and
  // neither plays a better game because its worlds come first in the list (#1086).
  const g = galaxyOf(c), foe = enemy(f);
  const ids = g.systems.map((s) => s.id);
  if (f === "wooka") ids.reverse();
  const rank = new Map(ids.map((id, i) => [id, i]));
  const neighbours = (id: string) => [...g.neighbours(id)].sort((a, b) => rank.get(a)! - rank.get(b)!);
  const systems = (from: Campaign) => ids.map((id) => from.systems[id]!);
  const mine = systems(c).filter((s) => s.sectors.some((x) => x.owner === f));
  const front = mine.filter((s) => neighbours(s.id).some((n) => c.systems[n]!.sectors.some((x) => x.owner === foe)) || s.sectors.some((x) => x.owner === foe));

  // Build: alternate ships and troops on the front, ships first where the enemy's fleets are near.
  // The cap only stops a loop with nowhere to build; the full galaxy earns ~25 builds a turn.
  let credits = c.credits[f], i = 0;
  while (credits >= COST.army && i++ < 60) {
    const wantShips = credits >= COST.fleet && (i % 2 === 1 || !front.length);
    let placed = false;
    for (const s of front.length ? front : mine) {
      const at = s.sectors.findIndex((x) => x.owner === f && (wantShips ? x.kind === "spaceport" || x.kind === "capital" : x.kind === "capital"));
      if (at >= 0 && tryAdd({ kind: "build", unit: wantShips ? "fleet" : "army", at: { system: s.id, sector: at } })) {
        credits -= COST[wantShips ? "fleet" : "army"];
        placed = true;
        break;
      }
    }
    if (!placed && !wantShips) break;
  }

  // Buying: the Ground deck first, then the Fleet deck once it holds two orbits or more over enemy
  // ground. A scored card only from year 3, and only when it holds the condition already.
  const overFoe = systems(c).filter((s) => s.orbit === f && s.sectors.some((x) => x.owner === foe)).length;
  const decks: Deck[] = overFoe >= 2 ? ["ground", "fleet"] : ["ground"];
  for (const deck of decks) {
    (c.market?.[deck] ?? []).forEach((card, slot) => {
      if (!SCORED[card] || (yearOf(c.turn) >= 3 && scoredHolds(c, f, card))) tryAdd({ kind: "buy", deck, slot });
    });
  }

  // Cards, after the garrison: troops and upgraded guns where the front is thinnest, and a trap
  // under a lone army the enemy is next to. A card with nowhere to go stays in the hand.
  const garrisoned = planOrders(c, [{ faction: f, orders }]).c;
  const held = front.flatMap((s) => garrisoned.systems[s.id]!.sectors.map((x, j) => ({ at: { system: s.id, sector: j }, x })).filter((p) => p.x.owner === f));
  const thinnest = [...held].sort((p, q) => p.x.armies[f] - q.x.armies[f]);
  for (const card of handOf(garrisoned, f)) {
    const spots = card === "trap" ? held.filter((p) => p.x.armies[f] === 1) : card === "guns" ? thinnest.filter((p) => p.x.kind === "capital" || p.x.kind === "spaceport") : thinnest;
    spots.some((p) => tryAdd({ kind: "card", card, at: p.at }));
  }
  // The Gale: a garrison caught in the open under it walks out to the best-held sector next door on
  // the ring (a shelter first), leaving two, which the Gale can't thin.
  const exposed = planOrders(c, [{ faction: f, orders }]).c;
  for (const s of systems(exposed)) {
    const at = galeAt(exposed, s.id), x = at === null ? undefined : s.sectors[at];
    if (!x || x.owner !== f || sheltered(x.kind) || x.armies[f] < 3) continue;
    const to = s.sectors.map((y, j) => ({ y, j })).filter((p) => touching(s.sectors.length, at!, p.j) && p.y.owner === f)
      .sort((p, q) => Number(sheltered(q.y.kind)) - Number(sheltered(p.y.kind)) || q.y.armies[f] - p.y.armies[f])[0];
    if (to) tryAdd({ kind: "army", from: { system: s.id, sector: at! }, to: { system: s.id, sector: to.j }, count: x.armies[f] - 2 });
  }
  const after = planOrders(c, [{ faction: f, orders }]).c;

  // Attack: send a fleet into the weakest enemy orbit it outnumbers, troops right behind it, as many
  // as the fleet carries, onto the weakest place they may come down on (a hold, or next to one of its).
  // Too few to take it, they reinforce a hold it has there instead, to push round the ring from.
  const sent = new Set<string>();
  for (const s of mine) {
    const ships = after.systems[s.id]!.fleets[f];
    const targets = neighbours(s.id)
      .map((n) => after.systems[n]!)
      .filter((t) => t.sectors.some((x) => x.owner === foe) && t.fleets[foe] < ships - 1)
      .sort((a, b) => a.fleets[foe] - b.fleets[foe]);
    const t = targets[0];
    if (!t || sent.has(t.id)) continue;
    if (!tryAdd({ kind: "fleet", from: s.id, to: t.id, count: ships - 1 })) continue;
    sent.add(t.id);
    let room = (ships - 1) * CARRY;
    const spare = s.sectors.reduce((n, x, j) => n + (x.owner === f ? Math.max(0, after.systems[s.id]!.sectors[j]!.armies[f] - 1) : 0), 0);
    const open = t.sectors.map((x, j) => ({ x, j })).filter((p) => !landingError(after, f, { system: t.id, sector: p.j }));
    const weakest = open.filter((p) => p.x.owner === foe).sort((p, q) => p.x.armies[foe] - q.x.armies[foe])[0];
    const hold = open.find((p) => p.x.owner === f && isHold(p.x.kind));
    const target = weakest && (!hold || Math.min(room, spare) > weakest.x.armies[foe]) ? weakest.j : hold?.j;
    if (target === undefined) continue;
    s.sectors.forEach((x, j) => {
      const n = Math.min(room, after.systems[s.id]!.sectors[j]!.armies[f] - 1);
      if (x.owner === f && n >= 1 && tryAdd({ kind: "army", from: { system: s.id, sector: j }, to: { system: t.id, sector: target }, count: n })) room -= n;
    });
  }

  // Push across a shared planet when the rules allow it: into the weaker enemy sector next door on
  // the ring, all but one going, or the last one too into ground nobody of theirs is standing on.
  for (const s of systems(after)) s.sectors.forEach((x, j) => {
    const n = s.sectors.length, to = s.sectors.map((y, k) => ({ y, k })).filter((p) => p.y.owner === foe && touching(n, j, p.k) && x.armies[f] > p.y.armies[foe])
      .sort((p, q) => p.y.armies[foe] - q.y.armies[foe])[0];
    const count = !to ? 0 : to.y.armies[foe] ? x.armies[f] - 1 : Math.max(1, x.armies[f] - 1);
    if (x.owner === f && count > 0) tryAdd({ kind: "army", from: { system: s.id, sector: j }, to: { system: s.id, sector: to!.k }, count });
  });

  // Bombard: where it holds the sky alone, its ships left over train on the thickest garrison below.
  const sky = planOrders(c, [{ faction: f, orders }]).c;
  for (const s of systems(sky)) {
    if (s.orbit !== f || s.fleets[foe]) continue;
    const target = s.sectors.reduce<number>((best, x, j) => (x.owner === foe && x.armies[foe] > (s.sectors[best]?.armies[foe] ?? 0) ? j : best), -1);
    const free = idleShips(sky, s)[f];
    if (target >= 0 && free > 0) tryAdd({ kind: "bombard", at: { system: s.id, sector: target }, count: free });
  }

  // Orbit cards where they bite: a flank on an orbit it attacks, pinpoint where it bombards, a
  // blockade runner where its troops land under their fleet.
  for (const o of [...orders]) {
    if (o.kind === "fleet" && c.systems[o.to]!.orbit === foe) tryAdd({ kind: "card", card: "flank", at: { system: o.to, sector: ORBIT } });
    else if (o.kind === "bombard") tryAdd({ kind: "card", card: "pinpoint", at: { system: o.at.system, sector: ORBIT } });
    else if (o.kind === "army" && o.from.system !== o.to.system) tryAdd({ kind: "card", card: "runner", at: { system: o.to.system, sector: ORBIT } });
  }
  return { faction: f, orders };
}

// The AI's answer to the declared attacks. It never calls one of its own off. A lone army or ship
// that's attacked outside a capital pulls back to the best-held place next to it nobody is
// attacking, if there is one: no point dying for a spaceport it can take back.
export function aiRetreats(c: Campaign, own: Orders): Retreat[] {
  const f = own.faction, g = galaxyOf(c), attacks = c.attacks ?? [];
  const d = planOrders(c, [{ ...own, retreats: undefined }]).c, out: Retreat[] = [];
  const hit = (system: string, sector: number) => attacks.some((a) => a.faction === enemy(f) && a.to.system === system && a.to.sector === sector);
  for (const a of attacks) {
    if (a.faction === f || out.some((r) => r.kind === "withdraw" && r.from.system === a.to.system && r.from.sector === a.to.sector)) continue;
    if (a.to.sector === ORBIT) {
      if (d.systems[a.to.system]!.fleets[f] !== 1) continue;
      const to = g.neighbours(a.to.system).find((n) => d.systems[n]!.orbit === f && !hit(n, ORBIT));
      if (to) out.push({ kind: "withdraw", from: a.to, to: { system: to, sector: ORBIT } });
      continue;
    }
    const x = sectorAt(d, a.to)!;
    if (x.armies[f] !== 1 || x.kind === "capital") continue;
    const places = [a.to.system, ...g.neighbours(a.to.system)].flatMap((id) => d.systems[id]!.sectors.map((y, i) => ({ system: id, sector: i, y })))
      .filter((p) => p.y.owner === f && (p.system !== a.to.system || touching(d.systems[p.system]!.sectors.length, p.sector, a.to.sector)) && !hit(p.system, p.sector))
      .sort((p, q) => q.y.armies[f] - p.y.armies[f]);
    if (places[0]) out.push({ kind: "withdraw", from: a.to, to: { system: places[0].system, sector: places[0].sector } });
  }
  // Only what the rules take, in case two pull out of the same place.
  const errs = checkRetreats(c, own, out);
  return out.filter((_, i) => !errs[i]);
}

// The AI's deploy phase: armies spare behind the lines (all but one) move up to the thinnest place
// it holds on the front next to them, on the same world or next door.
export function aiDeploys(c: Campaign, f: Faction): Order[] {
  const g = galaxyOf(c), foe = enemy(f), ids = g.systems.map((s) => s.id);
  if (f === "wooka") ids.reverse();
  const onFront = (s: SystemState) => s.sectors.some((x) => x.owner === foe) || g.neighbours(s.id).some((n) => c.systems[n]!.sectors.some((x) => x.owner === foe));
  const moves: Order[] = [];
  for (const id of ids) {
    const s = c.systems[id]!;
    if (onFront(s)) continue;
    s.sectors.forEach((x, j) => {
      const now = planDeploys(c, f, moves).c, n = now.systems[id]!.sectors[j]!.armies[f];
      if (x.owner !== f || n < 2) return;
      const to = ids.filter((t) => g.adjacent(id, t) && onFront(c.systems[t]!))
        .flatMap((t) => now.systems[t]!.sectors.map((y, k) => ({ at: { system: t, sector: k }, y })))
        .filter((p) => p.y.owner === f)
        .sort((p, q) => p.y.armies[f] - q.y.armies[f])[0];
      const o: Order | null = to ? { kind: "army", from: { system: id, sector: j }, to: to.at, count: n - 1 } : null;
      if (o && planDeploys(c, f, [...moves, o]).errors.at(-1) === null) moves.push(o);
    });
  }
  return moves;
}

// The AI's order in a space battle fought by picking, for whichever side it's on. An exchange is
// worth the hull dealt less the hull taken, prizes counted, and armies killed or lost below (an
// army's worth a bit over half a ship), at its average. The AI guesses what the other side will
// pick (the orders that would do best for them against anything) and weighs each of its own
// against that guess, then picks at random, weighted to the better ones, so it can't be read like
// a book. It only sees the rounds already fought, never the other side's pick, and plays both
// sides alike.
const ARMY_HULL = 6;
// In the last round, coming out ahead is what holds the orbit, and worth this much hull on top.
const LAST_WORD = 3 * HULL_PER_SHIP;
const net = (b: PickBattle, side: Side, mine: SpaceOrder, theirs: SpaceOrder) => {
  const foe = other(side), r = exchange(b, { [side]: mine, [foe]: theirs } as Record<Side, SpaceOrder>);
  const v = r.hit[foe] - r.hit[side] + r.prizes[side] - r.prizes[foe] + (r.killed[foe] + r.boarders[foe] - r.killed[side] - r.boarders[side]) * ARMY_HULL;
  if (b.round < ROUNDS - 1) return v;
  const left = (s: Side) => b.hull[s] - r.hit[s] + r.prizes[s];
  return v + (left(side) > left(foe) || (left(side) === left(foe) && side === "defender") ? LAST_WORD : -LAST_WORD);
};
// Weights for picking among orders by their values: the better, the likelier, none ruled out.
const lean = (values: number[]) => {
  const low = Math.min(...values);
  return values.map((v) => (v - low + HULL_PER_SHIP / 5) ** 2);
};
export function aiSpacePick(b: PickBattle, side: Side): SpaceOrder {
  const foe = other(side), mine = legalPicks(b, side), theirs = legalPicks(b, foe);
  const guess = lean(theirs.map((t) => mine.reduce((n, o) => n + net(b, foe, t, o), 0)));
  const weights = lean(mine.map((o) => theirs.reduce((n, t, i) => n + guess[i]! * net(b, side, o, t), 0) / guess.reduce((a, w) => a + w, 0)));
  let roll = mulberry32((b.spec.seed ^ Math.imul(b.round + 1, 0x9e3779b1) ^ (side === "attacker" ? 0x51ed : 0xa11e)) >>> 0)() * weights.reduce((a, w) => a + w, 0);
  for (let i = 0; i < mine.length; i++) if ((roll -= weights[i]!) < 0) return mine[i]!;
  return mine.at(-1)!;
}
