// A turn in named phases, laid over the orders the rules already have: which order belongs to
// which phase, the odds of the fights an order set will start, and what a turn changed.
import { ORBIT, diceBattle, enemy, holds, rng, type Campaign, type Order, type Where } from "./rules.ts";
import type { Faction } from "../battle/contract.ts";

export const PHASES = [
  { icon: "coins", name: "Muster", tip: "Muster: build troops and ships with credits, and play cards", say: "Spend your credits: build troops and ships, or play a card. Pick a world you hold." },
  { icon: "map-pin", name: "Deploy", tip: "Deploy: place new troops in your sectors, moving them between worlds you hold", say: "Place your troops where you will need them: move armies between sectors you hold." },
  { icon: "rocket", name: "Fleets", tip: "Fleets: declare fleet attacks on orbits, and bombard from the sky you hold", say: "Send ships to other orbits. Win the sky over a world and your ships can bombard the ground below." },
  { icon: "swords", name: "Commit", tip: "Commit: declare how much ground force goes to each enemy sector", say: "Choose how many armies land on each enemy sector. Send too few and you lose; send too many and you leave home open. They can't see your numbers." },
  { icon: "dices", name: "Battles", tip: "Battles: each fight is auto-resolved with a little luck, or fought by you", say: "For each fight, auto-resolve it (quick, a little luck) or fight it yourself. Then end your turn." },
] as const;
export type PhaseNo = 1 | 2 | 3 | 4 | 5;
export const LAST: PhaseNo = 5;

// A move into the enemy's ground or orbit.
export function attacking(c: Campaign, f: Faction, o: Order) {
  if (o.kind === "build" || o.kind === "card" || o.kind === "bombard") return false;
  const foe = enemy(f), s = c.systems[o.kind === "fleet" ? o.to : o.to.system]!;
  return o.kind === "fleet" ? s.orbit === foe || s.sectors.some((x) => x.owner === foe) : s.sectors[o.to.sector]!.owner === foe;
}

// Which phase an order is given in: builds and cards in Muster, armies to ground you hold in
// Deploy, ships in Fleets, armies against the enemy in Commit.
export function phaseOf(c: Campaign, f: Faction, o: Order): PhaseNo {
  if (o.kind === "build" || o.kind === "card") return 1;
  if (o.kind === "fleet" || o.kind === "bombard") return 3;
  return c.systems[o.to.system]!.sectors[o.to.sector]!.owner === f ? 2 : 4;
}

export interface Battle { to: Where; space: boolean; attackers: number; defenders: number | null; win: number | null }

// The fights this side's orders will start, with its chance to win each. `defenders` is null where
// the enemy's strength is hidden, and then there is no chance to quote. The enemy's own moves are
// not known, so this is an estimate: part of the bluff.
export function forecast(c: Campaign, f: Faction, orders: Order[]): Battle[] {
  const foe = enemy(f), by = new Map<string, Battle>();
  for (const o of orders) {
    if (!attacking(c, f, o) || o.kind === "build" || o.kind === "card" || o.kind === "bombard") continue;
    const to: Where = o.kind === "fleet" ? { system: o.to, sector: ORBIT } : o.to, key = `${to.system}:${to.sector}`;
    const s = c.systems[to.system]!;
    if (o.kind === "fleet" && s.orbit !== foe) continue; // no ships to fight; the ground is not the sky
    const b = by.get(key) ?? { to, space: to.sector === ORBIT, attackers: 0, defenders: o.kind === "fleet" ? s.fleets[foe] : s.sectors[to.sector]!.armies[foe], win: null };
    if (s.fog) b.defenders = null;
    b.attackers += o.count;
    by.set(key, b);
  }
  return [...by.values()].map((b) => {
    if (b.defenders === null) return b;
    const s = c.systems[b.to.system]!, x = b.space ? null : s.sectors[b.to.sector]!;
    const skyMine = s.orbit === f || orders.some((o) => o.kind === "fleet" && o.to === b.to.system);
    const cover = b.space ? {} : { att: skyMine, def: s.orbit === foe || x!.kind === "jungle" };
    const r = rng(1234 + b.attackers * 31 + b.defenders);
    let won = 0;
    const N = 400;
    for (let i = 0; i < N; i++) if (!diceBattle(b.attackers, b.defenders, r, cover, { def: x?.guns })[1]) won++;
    return { ...b, win: won / N };
  });
}

// Whether this side came out of a forecast fight holding the place.
export const won = (after: Campaign, f: Faction, b: Battle) => {
  const s = after.systems[b.to.system]!;
  return b.space ? s.orbit === f : s.sectors[b.to.sector]!.owner === f;
};

export const standing = (c: Campaign, f: Faction) => {
  const all = Object.values(c.systems);
  return {
    credits: c.credits[f],
    sectors: all.reduce((n, s) => n + s.sectors.filter((x) => x.owner === f).length, 0),
    armies: all.reduce((n, s) => n + s.sectors.reduce((a, x) => a + x.armies[f], 0), 0),
    ships: all.reduce((n, s) => n + s.fleets[f], 0),
    capitals: all.filter((s) => holds(s, f)).length,
  };
};
export type Standing = ReturnType<typeof standing>;

// A turn in a few lines: the fights you had odds on and how they went, then what grew or shrank.
export function summary(before: Standing, after: Standing, fights: { label: string; win: number | null; won: boolean }[]) {
  const lines = fights.map((b) => `${b.won ? "Won" : "Lost"} ${b.label}${b.win === null ? ", odds unknown" : `, ${Math.round(b.win * 100)}% to win`}.`);
  const change = (name: string, a: number, z: number) => (a === z ? null : `${name} ${a} → ${z}`);
  const moved = [change("Sectors", before.sectors, after.sectors), change("Armies", before.armies, after.armies), change("Ships", before.ships, after.ships), change("Credits", before.credits, after.credits)].filter(Boolean);
  lines.push(moved.length ? moved.join(" · ") : "Nothing changed hands.");
  return lines;
}
