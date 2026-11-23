// The campaign's map: a sector of worlds joined by hyperspace lanes. You move the fleet one lane a turn. Resource
// worlds pay supply each turn you hold them; supply rebuilds your wings and your hull. The Compact has bases, and bases
// spread: every few turns one starts building on a free world next door, and a base that grows unchecked raids your
// mines. Burn a base (an assault), stop one being built (a strike: easier, if you get there in time), or seize a
// mine (a picket fight). Clear every base and the sector is yours. Plain data, no DOM: the page draws it.
import { nextRandom } from "@rustybuns/util";
import type { BattleKind, BattleSpec, Fleet } from "./sim/scenarios.ts";
import { FULL_FLEET } from "./sim/scenarios.ts";

export type SystemKind = "core" | "resource" | "open";
export interface System { id: string; name: string; x: number; y: number; kind: SystemKind; blurb: string }

export const SYSTEMS: System[] = [
  { id: "aster", name: "Aster Gate", x: 8, y: 50, kind: "core", blurb: "The Directorate's yard. Refit here at half cost." },
  { id: "kell", name: "Kell Mines", x: 26, y: 22, kind: "resource", blurb: "Ore. 3 supply a turn." },
  { id: "duun", name: "Duun Refinery", x: 28, y: 76, kind: "resource", blurb: "Fuel. 3 supply a turn." },
  { id: "thessa", name: "Thessa", x: 46, y: 48, kind: "open", blurb: "A garden world at a lane junction." },
  { id: "ossa", name: "Ossa Belt", x: 58, y: 16, kind: "resource", blurb: "Ice and metal. 3 supply a turn." },
  { id: "vael", name: "Vael", x: 68, y: 58, kind: "open", blurb: "The Compact's stronghold, under an orbital bastion." },
  { id: "ilk", name: "Ilk", x: 80, y: 28, kind: "open", blurb: "A cold moon. Something is being built there." },
  { id: "morrow", name: "Morrow", x: 88, y: 76, kind: "open", blurb: "A rain world on the sector's edge." },
  { id: "corvanth", name: "Corvanth", x: 95, y: 46, kind: "open", blurb: "The deep end of the lanes." },
];

export const LANES: [string, string][] = [
  ["aster", "kell"], ["aster", "duun"], ["kell", "thessa"], ["duun", "thessa"], ["kell", "ossa"], ["thessa", "vael"],
  ["thessa", "ossa"], ["ossa", "ilk"], ["vael", "ilk"], ["vael", "morrow"], ["duun", "morrow"], ["ilk", "corvanth"], ["morrow", "corvanth"],
];

export interface Sector {
  seed: number; rng: number; turn: number; supply: number; at: string;
  held: string[];
  /** Compact bases by world, with their strength (1 to 3). */
  bases: Record<string, number>;
  /** Bases being built: turns until done. */
  forming: Record<string, number>;
  fleet: Fleet;
  log: string[];
  outcome: null | "won" | "lost";
  defeats: number;
}

export const sys = (id: string) => SYSTEMS.find((s) => s.id === id)!;
export const neighbours = (id: string) => LANES.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));

export function newSector(seed: number): Sector {
  return {
    seed, rng: seed >>> 0, turn: 1, supply: 10, at: "aster", held: ["aster"],
    bases: { vael: 2, morrow: 1 }, forming: { ilk: 3 },
    fleet: structuredClone(FULL_FLEET), log: ["The fleet is at Aster Gate. Two Compact bases are known: Vael and Morrow. Something stirs on Ilk."], outcome: null, defeats: 0,
  };
}

/** What waits at a world: a battle to fight there, or nothing. */
export function threatAt(s: Sector, id: string): { kind: BattleKind; strength: number } | null {
  if (s.bases[id]) return { kind: "assault", strength: s.bases[id] };
  if (s.forming[id] !== undefined) return { kind: "strike", strength: 1 };
  const w = sys(id);
  if (w.kind === "resource" && !s.held.includes(id)) return { kind: "seize", strength: 1 };
  return null;
}

/** Jump the fleet down a lane. Returns the battle there, if any (fight it, then `settle`); with none, the turn ends. */
export function jump(s: Sector, to: string): BattleSpec | null {
  if (s.outcome || !neighbours(s.at).includes(to)) return null;
  s.at = to;
  const t = threatAt(s, to);
  if (!t) { s.log.unshift(`Turn ${s.turn}: the fleet jumps to ${sys(to).name}. Quiet.`); rimTurn(s); return null; }
  return { seed: (s.seed + s.turn * 977) >>> 0, kind: t.kind, strength: t.strength, planet: sys(to).name, fleet: structuredClone(s.fleet) };
}

/** After the battle at `s.at`: what it changed, then the Compact's turn. */
export function settle(s: Sector, outcome: "win" | "loss" | "draw", fleet: Fleet) {
  const here = sys(s.at), t = threatAt(s, s.at);
  s.fleet = fleet;
  if (outcome === "win" && t) {
    if (t.kind === "assault") { delete s.bases[s.at]; s.log.unshift(`Turn ${s.turn}: the Compact base on ${here.name} burns.`); }
    if (t.kind === "strike") { delete s.forming[s.at]; s.log.unshift(`Turn ${s.turn}: the base on ${here.name} is broken before it was finished.`); }
    if (t.kind === "seize") { s.held.push(s.at); s.log.unshift(`Turn ${s.turn}: ${here.name} is ours. Supply will follow.`); }
  } else if (outcome === "loss") {
    s.defeats++;
    s.at = "aster";
    s.fleet = { hull: 0.35, reserve: Math.floor(fleet.reserve / 2), wings: fleet.wings.map((g) => ({ ...g, craft: Math.max(1, Math.floor(g.craft / 2)) })) };
    s.log.unshift(`Turn ${s.turn}: beaten at ${here.name}. The flagship limps back to Aster Gate.`);
    if (s.defeats >= 3) { s.outcome = "lost"; s.log.unshift("Three defeats. Command is taken from you."); return; }
  } else s.log.unshift(`Turn ${s.turn}: no decision at ${here.name}. The Compact holds on.`);
  rimTurn(s);
}

/** What it costs to bring the fleet back to full here: a craft is 1 supply, 5% of hull is 1. Half at the yard. */
export function refitCost(s: Sector) {
  const craft = s.fleet.wings.reduce((a, g, i) => a + (FULL_FLEET.wings[i].craft - g.craft), 0) + (FULL_FLEET.reserve - s.fleet.reserve);
  const hull = Math.ceil(((1 - s.fleet.hull) * 100) / 5);
  const k = s.at === "aster" ? 0.5 : 1;
  return { craft, hull, cost: Math.ceil((craft + hull) * k) };
}

/** Spend supply to refit, as far as it goes: the wings' craft first, then the hangar's spares, then hull. Only on a world you hold. */
export function refit(s: Sector): boolean {
  if (!s.held.includes(s.at)) return false;
  const k = s.at === "aster" ? 0.5 : 1;
  let spent = false;
  for (let i = 0; i < s.fleet.wings.length; i++) {
    while (s.fleet.wings[i].craft < FULL_FLEET.wings[i].craft && s.supply >= k) { s.fleet.wings[i].craft++; s.supply -= k; spent = true; }
  }
  while (s.fleet.reserve < FULL_FLEET.reserve && s.supply >= k) { s.fleet.reserve++; s.supply -= k; spent = true; }
  while (s.fleet.hull < 1 && s.supply >= k) { s.fleet.hull = Math.min(1, s.fleet.hull + 0.05); s.supply -= k; spent = true; }
  s.supply = Math.round(s.supply * 10) / 10;
  if (spent) s.log.unshift(`Turn ${s.turn}: refit at ${sys(s.at).name}.`);
  return spent;
}

/** The Compact moves: bases finish, grow, spread and raid; your mines pay out. */
export function rimTurn(s: Sector) {
  const r = () => nextRandom(s, "rng");
  s.turn++;
  const mines = s.held.filter((id) => sys(id).kind === "resource").length;
  s.supply += 2 + mines * 3;
  for (const [id, left] of Object.entries(s.forming)) {
    if (left <= 1) { delete s.forming[id]; s.bases[id] = 1; s.log.unshift(`Turn ${s.turn}: the Compact finished a base on ${sys(id).name}.`); }
    else s.forming[id] = left - 1;
  }
  for (const [id, n] of Object.entries(s.bases)) {
    if (s.turn % 4 === 0) {
      if (n < 3 && r() < 0.5) { s.bases[id] = n + 1; s.log.unshift(`Turn ${s.turn}: ${sys(id).name}'s base grows stronger.`); continue; }
      const free = neighbours(id).filter((o) => !s.bases[o] && s.forming[o] === undefined && !s.held.includes(o) && o !== s.at && sys(o).kind !== "core");
      if (free.length) { const o = free[Math.floor(r() * free.length)]; s.forming[o] = 3; s.log.unshift(`Turn ${s.turn}: the Compact starts building on ${sys(o).name}. Three turns to stop it.`); }
    }
    for (const o of neighbours(id)) {
      if (s.held.includes(o) && sys(o).kind === "resource" && o !== s.at && r() < 0.12 * n) {
        s.held = s.held.filter((h) => h !== o);
        s.log.unshift(`Turn ${s.turn}: Compact raiders out of ${sys(id).name} take ${sys(o).name}.`);
      }
    }
  }
  if (Object.keys(s.bases).length >= 6) { s.outcome = "lost"; s.log.unshift("The Compact holds six bases. The sector is lost."); }
  if (!Object.keys(s.bases).length && !Object.keys(s.forming).length) { s.outcome = "won"; s.log.unshift("No Compact base is left in the sector. Command offers you the Sovereign."); }
  if (s.log.length > 30) s.log.length = 30;
}
