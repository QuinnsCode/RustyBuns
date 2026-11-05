// A turn in named phases, laid over the orders the rules already have: which order belongs to
// which phase, the odds of the fights an order set will start, and what a turn changed.
import { ORBIT, diceBattle, enemy, holds, isMove, rng, type Campaign, type Order, type Where } from "./rules.ts";
import { FACTION_NAMES } from "./galaxy.ts";
import { yearOf } from "./objectives.ts";
import type { Faction } from "../battle/contract.ts";

export const PHASES = [
  { icon: "coins", name: "Muster", call: "Spend credits", step: "Spend credits on troops and ships", tip: "Muster: spend credits on troops and ships, buy and play cards", say: "Your credits, and what they buy. Pick where each one starts." },
  { icon: "map-pin", name: "Deploy", call: "Shift troops", step: "Shift troops on your own ground", tip: "Deploy: move troops between sectors you hold. No fights", say: "Move troops between sectors you hold. Nothing fights." },
  { icon: "rocket", name: "Armada", call: "Send warships", step: "Send warships to take orbits", tip: "Armada: send warships into orbits, and bombard from a sky you hold", say: "Warships take orbits. Win a sky and your troops land under it." },
  { icon: "swords", name: "Invasion", call: "Land troops", step: "Land troops on enemy ground", tip: "Invasion: send troops on transports onto enemy sectors", say: "Troops ride transports onto enemy ground. They see where, not how many." },
  { icon: "dices", name: "Battles", call: "Fight", step: "Pick your hero's fight", tip: "Battles: each fight is auto-resolved with a little luck, or fought by you", say: "Auto-resolve each fight, or fight one as your hero." },
] as const;
export type PhaseNo = 1 | 2 | 3 | 4 | 5;
export const LAST: PhaseNo = 5;

// The banner over the map answers, on every screen: what year, what turn, whose seat this is,
// which phase (and which job inside it), and who the turn is waiting on. `waiting` is the sides
// still to move (table.ts's waitingOn, or the server's), `hero` the side whose hero battle holds
// the turn, if one does.
export interface Banner { year: number; turn: number; who: string; phase: string; step: string; waiting: string; mine: boolean }
export function banner(c: Campaign, me: Faction, phase: PhaseNo, waiting: Faction[], hero: Faction | null): Banner {
  const who = `${FACTION_NAMES[me]} (you)`, year = yearOf(c.turn), turn = c.turn;
  const on = (sides: Faction[]) => (sides.includes(me) ? "you" : sides.length ? `the ${sides.map((f) => FACTION_NAMES[f]).join(" and the ")}` : "nobody");
  const at = (n: PhaseNo, step: string) => ({ year, turn, who, phase: `Phase ${n} of ${LAST} · ${PHASES[n - 1]!.name}`, step, waiting: on(waiting), mine: waiting.includes(me) });
  if (c.winner) return { year, turn: turn - 1, who, phase: "War over", step: `${FACTION_NAMES[c.winner]} won`, waiting: "nobody", mine: false };
  if (hero) return { year, turn, who, phase: `Phase ${LAST} of ${LAST} · ${PHASES[LAST - 1]!.name}`, step: hero === me ? "Your hero battle" : `${FACTION_NAMES[hero]} hero battle`, waiting: on([hero]), mine: hero === me };
  if (c.setup) return { year, turn, who, phase: "Before the war", step: "Choose a fleet and place it", waiting: on(waiting), mine: waiting.includes(me) };
  if (c.attacks) return at(4, "Attacks declared: answer them");
  if (c.deploying) return at(2, "Move into what you took");
  return at(phase, PHASES[phase - 1]!.step);
}

// A move into the enemy's ground or orbit.
export function attacking(c: Campaign, f: Faction, o: Order) {
  if (!isMove(o)) return false;
  const foe = enemy(f), s = c.systems[o.kind === "fleet" ? o.to : o.to.system]!;
  return o.kind === "fleet" ? s.orbit === foe || s.sectors.some((x) => x.owner === foe) : s.sectors[o.to.sector]!.owner === foe;
}

// Which phase an order is given in: builds and cards in Muster, armies to ground you hold in
// Deploy, ships in Armada, armies against the enemy in Invasion.
export function phaseOf(c: Campaign, f: Faction, o: Order): PhaseNo {
  if (o.kind === "build" || o.kind === "card" || o.kind === "buy") return 1;
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
    if (!isMove(o) || !attacking(c, f, o)) continue;
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
