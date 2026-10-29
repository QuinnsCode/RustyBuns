// Open, Held or Contested: what every place on the map (an orbit or a sector) is from one seat,
// so moving in reads as a move, an attack, or joining a fight already coming (docs/REDESIGN.md §2).
// Read off the fogged campaign: fog hides the enemy's numbers, never who holds a place, so the state
// is never fogged.
import type { Faction } from "../battle/contract.ts";
import { ORBIT, enemy, type Attack, type Campaign, type Order, type Where } from "./rules.ts";

export type PlaceState = "open" | "held" | "contested";
export const STATE_NAMES: Record<PlaceState, string> = { open: "Open", held: "Held", contested: "Contested" };
export const STATE_ICONS: Record<PlaceState, string> = { open: "map-pin", held: "shield", contested: "swords" };

const key = (w: Where) => `${w.system}:${w.sector < 0 ? ORBIT : w.sector}`;

export interface Places {
  at(w: Where): PlaceState;
  // A world reads as its worst place: Contested if a fight is on anywhere in it, Held if the enemy holds any of it.
  system(id: string): PlaceState;
  // Where an order goes, and so whether it's a move or an attack. Null for an order that goes nowhere.
  order(o: Order): PlaceState | null;
}

// `attacks` are the turn's declared attacks: each turns its target Contested for both sides.
export function places(c: Campaign, me: Faction, attacks: Attack[] = []): Places {
  const foe = enemy(me), fights = new Set(attacks.map((a) => key(a.to)));
  const at = (w: Where): PlaceState => {
    if (fights.has(key(w))) return "contested";
    const s = c.systems[w.system];
    if (!s) return "open";
    if (w.sector < 0) {
      const theirs = s.orbit === foe || s.fleets[foe] > 0;
      return theirs ? (s.fleets[me] > 0 ? "contested" : "held") : "open";
    }
    const x = s.sectors[w.sector];
    if (!x) return "open";
    const theirs = x.owner === foe || x.armies[foe] > 0;
    return theirs ? (x.armies[me] > 0 ? "contested" : "held") : "open";
  };
  const system = (id: string): PlaceState => {
    const s = c.systems[id];
    if (!s) return "open";
    const all = [ORBIT, ...s.sectors.keys()].map((sector) => at({ system: id, sector }));
    return all.includes("contested") ? "contested" : all.includes("held") ? "held" : "open";
  };
  const order = (o: Order): PlaceState | null => {
    if (o.kind === "build" || o.kind === "card") return null;
    if (o.kind === "bombard") return at(o.at);
    // A fleet into a world goes for its orbit, but a world the enemy holds ground on is still an attack.
    if (o.kind === "fleet") {
      const sky = at({ system: o.to, sector: ORBIT });
      return sky === "open" ? system(o.to) : sky;
    }
    return at(o.to);
  };
  return { at, system, order };
}
