// The war's first move: before turn 1 each side picks a fleet and says where it goes. The stock
// fleet of the galaxy is a pool of value to spend, a ship worth what it costs to build and an army
// likewise, so a side chooses what to be: a few ships and a lot of troops, or a sky full of
// ships with a thin garrison below. Whatever isn't placed goes into the treasury. Both sides
// place at once, blind, and the map is empty until they have.
import type { Faction } from "../battle/contract.ts";
import { galaxyOf } from "./galaxy.ts";
import { COST, FACTIONS, enemy, sectorAt, type Campaign, type Deployment } from "./rules.ts";

export type Stance = "spread" | "front";
export interface Preset { name: string; icon: string; blurb: string; stance: Stance; shipShare: number | null } // null: the galaxy's stock mix

// Four ways to open. The Armada trades the ground for the sky: win the orbit, and when their last
// ship is gone, bombard their garrisons from above. The Horde does the reverse. The Vanguard puts
// everything on the front line and hits first, with the rear left empty.
export const PRESETS = {
  armada: { name: "Armada", icon: "rocket", stance: "spread", shipShare: 0.75, blurb: "Capital ships first. Win the orbit, then bombard their garrisons from above once their last ship is gone. Few troops to hold the ground." },
  line: { name: "Battle line", icon: "shield", stance: "spread", shipShare: null, blurb: "A balance of ships and troops, spread over every world you hold." },
  vanguard: { name: "Vanguard", icon: "swords", stance: "front", shipShare: null, blurb: "Everything on the front line. Hits first and hard, but the rear is empty, and a long war favours whoever kept something back." },
  horde: { name: "Horde", icon: "users", stance: "spread", shipShare: 0.2, blurb: "Troops on every sector, hard to dislodge from the ground. Slow to take the sky, and a fleet can bombard them." },
} as const satisfies Record<string, Preset>;
export type PresetId = keyof typeof PRESETS;
export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export interface Loadout { ships: number; armies: number }
const MAX_PLACES = 400;

export const valueOf = (l: Loadout) => l.ships * COST.fleet + l.armies * COST.army;
export const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
export const totals = (d: Deployment): Loadout => ({ ships: sum(d.ships), armies: sum(d.armies) });
export const emptyDeployment = (): Deployment => ({ ships: {}, armies: {} });
const poolOf = (c: Campaign, f: Faction) => c.pool?.[f] ?? 0;

// What a preset buys from the side's pool: ships first by its share, the rest in armies.
export function loadoutOf(c: Campaign, f: Faction, id: PresetId): Loadout {
  const pool = poolOf(c, f), p: Preset = PRESETS[id];
  const stock = stockShare(c, f), share = p.shipShare ?? stock;
  const ships = Math.floor((pool * share) / COST.fleet);
  return { ships, armies: Math.floor((pool - ships * COST.fleet) / COST.army) };
}

// The share of the pool the galaxy's own start puts into ships (what a Battle line is).
function stockShare(c: Campaign, f: Faction) {
  const g = galaxyOf(c);
  let ships = 0;
  for (const d of g.systems) { const s = g.start[d.id]!; if (s.owner === f) ships += s.fleets * COST.fleet; }
  return poolOf(c, f) ? ships / poolOf(c, f) : 0.5;
}

// The most a side can afford of one kind with what it hasn't spent on the other.
export const room = (c: Campaign, f: Faction, l: Loadout) => poolOf(c, f) - valueOf(l);

// The systems and sectors a side holds, front line first: next door to the enemy, or sharing a world.
function ground(c: Campaign, f: Faction, stance: Stance) {
  const g = galaxyOf(c), foe = enemy(f), ids = g.systems.map((d) => d.id);
  if (f === "wooka") ids.reverse(); // each side reads the list from its own end, like the AI's orders
  const mine = ids.filter((id) => c.systems[id]!.sectors.some((x) => x.owner === f));
  const onFront = (id: string) => c.systems[id]!.sectors.some((x) => x.owner === foe) || g.neighbours(id).some((n) => c.systems[n]!.sectors.some((x) => x.owner === foe));
  const front = mine.filter(onFront), rest = mine.filter((id) => !onFront(id));
  const systems = stance === "front" && front.length ? front : [...front, ...rest];
  return {
    systems,
    // Capitals before the rest, so a thin army stands on what scores.
    sectors: systems.flatMap((id) => c.systems[id]!.sectors.map((x, i) => ({ id, i, x })).filter((p) => p.x.owner === f))
      .sort((p, q) => Number(q.x.kind === "capital") - Number(p.x.kind === "capital")),
  };
}

// A placement for a loadout: round and round the systems, the front line first, so any remainder
// lands there. Ships go to spaceports and capitals' worlds; armies to sectors, capitals first.
export function placeLoadout(c: Campaign, f: Faction, l: Loadout, stance: Stance = "spread"): Deployment {
  const d = emptyDeployment(), { systems, sectors } = ground(c, f, stance);
  if (!systems.length) return d;
  const yards = systems.filter((id) => c.systems[id]!.sectors.some((x) => x.owner === f && x.kind === "spaceport"));
  const docks = yards.length && stance === "spread" ? yards : systems;
  for (let i = 0; i < l.ships; i++) { const id = docks[i % docks.length]!; d.ships[id] = (d.ships[id] ?? 0) + 1; }
  for (let i = 0; i < l.armies; i++) { const p = sectors[i % sectors.length]!, k = `${p.id}:${p.i}`; d.armies[k] = (d.armies[k] ?? 0) + 1; }
  return d;
}

export const presetDeployment = (c: Campaign, f: Faction, id: PresetId) => placeLoadout(c, f, loadoutOf(c, f, id), PRESETS[id].stance);

// The AI opens with a preset picked off the campaign's seed, so it's the same on every screen.
export function aiDeployment(c: Campaign, f: Faction): Deployment {
  const id = PRESET_IDS[Math.abs(Math.imul(c.seed ^ (f === "marines" ? 0x1f3d : 0x9e37), 2654435761)) % PRESET_IDS.length]!;
  return presetDeployment(c, f, id);
}

// Whether a placement is allowed: counts that are whole numbers, on ground the side holds, for no
// more than its pool.
export function planDeployment(c: Campaign, f: Faction, d: Deployment): string | null {
  if (!d || typeof d !== "object" || !d.ships || !d.armies || typeof d.ships !== "object" || typeof d.armies !== "object") return "That isn't a fleet";
  if (Object.keys(d.ships).length + Object.keys(d.armies).length > MAX_PLACES) return "Too many places";
  for (const [id, n] of Object.entries(d.ships)) {
    if (!Number.isInteger(n) || n < 0) return "Ships come in whole numbers";
    if (n && !c.systems[id]?.sectors.some((x) => x.owner === f)) return "Ships go to worlds you hold";
  }
  for (const [k, n] of Object.entries(d.armies)) {
    const [id, sector] = k.split(":"), x = id && /^\d+$/.test(sector ?? "") ? sectorAt(c, { system: id, sector: +sector! }) : undefined;
    if (!Number.isInteger(n) || n < 0) return "Armies come in whole numbers";
    if (n && x?.owner !== f) return "Armies go to sectors you hold";
  }
  return valueOf(totals(d)) > poolOf(c, f) ? "That's more than your fleet is worth" : null;
}

// Puts a side's fleet on the map and credits what it left unspent. Returns a copy.
export function deploy(c0: Campaign, f: Faction, d: Deployment): Campaign {
  const c = structuredClone(c0);
  for (const [id, n] of Object.entries(d.ships)) if (n) { c.systems[id]!.fleets[f] += n; c.systems[id]!.orbit = f; }
  for (const [k, n] of Object.entries(d.armies)) if (n) { const [id, sector] = k.split(":"); sectorAt(c, { system: id!, sector: +sector! })!.armies[f] += n; }
  return c;
}

// Everyone's fleets down at once, and the war begins. Unspent value becomes credits.
export function beginWar(c0: Campaign, all: Record<Faction, Deployment>): Campaign {
  let c = c0;
  for (const f of FACTIONS) {
    c = deploy(c, f, all[f]);
    c.credits[f] += Math.max(0, poolOf(c0, f) - valueOf(totals(all[f])));
  }
  c.setup = null;
  c.log = ["The fleets are in place. The war begins."];
  return c;
}
