// The AI faction's orders: spend everything, push fleets into weaker orbits next door, and land
// troops behind them. Every order goes through planOrders, so it never queues one the rules refuse.
import type { Faction } from "../battle/contract.ts";
import { galaxyOf } from "./galaxy.ts";
import { COST, enemy, planOrders, type Campaign, type Order, type Orders } from "./rules.ts";

export function aiOrders(c: Campaign, f: Faction): Orders {
  const orders: Order[] = [];
  const tryAdd = (o: Order) => {
    const d = planOrders(c, [{ faction: f, orders: [...orders, o] }]);
    if (d.errors.at(-1) === null) { orders.push(o); return true; }
    return false;
  };
  const foe = enemy(f), { neighbours } = galaxyOf(c);
  const mine = Object.values(c.systems).filter((s) => s.sectors.some((x) => x.owner === f));
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
  const after = planOrders(c, [{ faction: f, orders }]).c;

  // Attack: send a fleet into the weakest enemy orbit it outnumbers, troops right behind it.
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
    const target = t.sectors.reduce((best, x, j) => (x.owner === foe && x.armies[foe] < t.sectors[best]!.armies[foe] ? j : best), t.sectors.findIndex((x) => x.owner === foe));
    s.sectors.forEach((x, j) => {
      const n = after.systems[s.id]!.sectors[j]!.armies[f];
      if (x.owner === f && n >= 2) tryAdd({ kind: "army", from: { system: s.id, sector: j }, to: { system: t.id, sector: target }, count: n - 1 });
    });
  }

  // Push across a shared planet when the rules allow it.
  for (const s of Object.values(after.systems)) {
    const foeAt = s.sectors.findIndex((x) => x.owner === foe);
    if (foeAt < 0) continue;
    s.sectors.forEach((x, j) => {
      if (x.owner === f && x.armies[f] >= 2 && x.armies[f] > s.sectors[foeAt]!.armies[foe]) tryAdd({ kind: "army", from: { system: s.id, sector: j }, to: { system: s.id, sector: foeAt }, count: x.armies[f] - 1 });
    });
  }
  return { faction: f, orders };
}
