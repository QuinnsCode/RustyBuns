// Every place on the map (an orbit or a sector) as one seat sees it: Open (nobody of the enemy's
// there), Held (the enemy's, nobody of ours there) or Contested (both sides there, or a fight
// coming this turn). Fog hides the enemy's numbers, never who holds what, so the state reads the
// same through it. See docs/REDESIGN.md §2.
import type { Faction } from "../battle/contract.ts";
import { attacking } from "./phases.ts";
import { ORBIT, enemy, type Attack, type Campaign, type Order, type Where } from "./rules.ts";

export type PlaceState = "open" | "held" | "contested";
export interface SystemStates { orbit: PlaceState; sectors: PlaceState[] }
export const STATE_NAMES: Record<PlaceState, string> = { open: "Open", held: "Held", contested: "Contested" };
export const STATE_ICONS: Record<PlaceState, string> = { open: "map-pin", held: "shield", contested: "swords" };

const of = (foe: boolean, mine: boolean): PlaceState => (foe && mine ? "contested" : foe ? "held" : "open");

// A place as it stands, before anyone moves.
export function placeAt(v: Campaign, me: Faction, w: Where): PlaceState {
  const s = v.systems[w.system]!, foe = enemy(me);
  if (w.sector === ORBIT) return of(s.orbit === foe || s.fleets[foe] > 0, s.fleets[me] > 0);
  const x = s.sectors[w.sector]!;
  return of(x.owner === foe || x.armies[foe] > 0, x.owner === me || x.armies[me] > 0);
}

// Where an order lands, or null for one that doesn't move (a build, a card, a bombardment).
export function orderTarget(o: Order): Where | null {
  if (o.kind === "fleet") return { system: o.to, sector: ORBIT };
  if (o.kind === "army") return o.to;
  return null;
}

// Every system's places for this seat: as they stand, then each of its attacks and
// every declared attack (either side's) turn their target Contested, so the map shows the turn's fights.
// An order is an attack by the same rule declareAttacks uses (phases.ts attacking).
export function placeStates(v: Campaign, me: Faction, orders: Order[], attacks: Attack[]): Record<string, SystemStates> {
  const out: Record<string, SystemStates> = {};
  for (const [id, s] of Object.entries(v.systems)) {
    out[id] = { orbit: placeAt(v, me, { system: id, sector: ORBIT }), sectors: s.sectors.map((_, i) => placeAt(v, me, { system: id, sector: i })) };
  }
  const fight = (w: Where) => {
    const st = out[w.system];
    if (!st) return;
    if (w.sector === ORBIT) st.orbit = "contested";
    else if (st.sectors[w.sector]) st.sectors[w.sector] = "contested";
  };
  for (const o of orders) {
    const t = orderTarget(o);
    if (t && attacking(v, me, o)) fight(t);
  }
  for (const a of attacks) fight(a.to);
  return out;
}

// A system's one badge: Contested if any place in it is, else Held if the enemy holds any of it.
export const systemState = (st: SystemStates): PlaceState => {
  const all = [st.orbit, ...st.sectors];
  return all.includes("contested") ? "contested" : all.includes("held") ? "held" : "open";
};
