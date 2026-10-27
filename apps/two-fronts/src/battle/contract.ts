// The JSON types the fronts talk through. The strategy layer writes a BattleSpec (or a
// SpaceBattleSpec) for the battle the hero plays, the battle layer plays it and hands back a
// BattleResult (or a SpaceBattleResult). Neither side imports the other,
// so each is tested on its own with fixtures.

export type Faction = "marines" | "wooka";
export type SectorKind = "capital" | "spaceport" | "shield" | "cannon" | "canyon" | "jungle";
// The big map each kind of sector has, if it has one (the battle lays them out: BIG_MAPS in sim.ts),
// and how many armies between the two sides make a battle big enough to be fought on it.
export const BIG_MAP_FOR: Partial<Record<SectorKind, string>> = { shield: "ridge", capital: "outskirts", spaceport: "yards", canyon: "gorge", jungle: "valley" };
export const BIG_BATTLE = 6;
// What a side can field on the ground besides its troops. Tanks and speeders come with any army;
// walkers and gunships come from what the side holds on the map (see buildSpec in rules.ts).
export type VehicleKind = "tank" | "walker" | "speeder" | "gunship";
export const VEHICLE_KINDS: VehicleKind[] = ["tank", "walker", "speeder", "gunship"];
export type VehiclePool = Partial<Record<VehicleKind, number>>;
export type Side = "attacker" | "defender";
// How a ground battle is won. Conquest is the war over every post at once; the others are the
// playlist the end-of-match vote picks from. A spec without a mode is conquest.
//   assault: one post is live at a time, in order. Take it, then hold it while they counter-attack,
//            and the next one comes live. Take the keep and the sector falls; run the clock out and it holds.
//   hill:    one live post that moves on every so often. Whoever stands on it drains the other side.
//   holdout: the defender holds every post against waves that keep growing, till the clock runs out.
//   escort:  the attacker's champion walks for the keep, but only with company. Get them there, or kill them.
export type MatchMode = "conquest" | "assault" | "hill" | "holdout" | "escort";
export const MATCH_MODES: MatchMode[] = ["conquest", "assault", "hill", "holdout", "escort"];
export type PerSide<T> = Record<Side, T>;

export interface BattleSpec {
  id: string;
  turn: number;
  system: string;          // the star system's name, for the HUD
  sector: SectorKind;      // sets the map: each kind of sector has its own layout and scenery
  factions: PerSide<Faction>;
  hero: Side;              // the side the player fights on
  heroLevel: number;       // carries over between battles: more health
  armies: PerSide<number>; // what each side committed, so the result can scale survivors
  tickets: PerSide<number>;
  vehicles: PerSide<VehiclePool>; // the Wooka have none: their share comes as more Wooka
  // Orbit control on the map, as call-ins on the ground:
  strikes: PerSide<number>;        // orbital strikes; the enemy's shield generator cuts them down
  reinforcements: PerSide<number>; // tickets dropped in once, at half tickets; only with orbit
  turrets: number;                 // the defender's fortifications
  mode?: MatchMode;                // conquest when absent
  map?: string;                    // a big map for the sector (BIG_MAPS in sim.ts); its usual layout when absent
  seed: number;
}

export interface BattleResult {
  id: string;
  winner: Side;
  tickets: PerSide<number>; // left at the end
  heroDown: boolean;        // the hero used up every life
  auto?: true;              // left to the AI: whoever checks it can run the battle again
  inputs?: string;          // played: the hero's input log (replay.ts), so whoever checks it can play it again
}

// The playable space battle: the fleets over one system, the hero flying a fighter in it. Each
// ship on the map is a cruiser in the fight, launching its wing of fighters.
export interface SpaceBattleSpec {
  id: string;
  turn: number;
  system: string;
  factions: PerSide<Faction>; // the defender held the orbit at the start of the turn
  hero: Side;
  heroLevel: number;
  fleets: PerSide<number>;    // ships on each side
  breakout?: true;            // the hero's side has no fleet here: one ship flies up from the surface against the blockade
  // Each side's muster force: its armies on the world below, which send boarding parties up, and
  // its gun sectors there (cannons, shields, upgraded guns), which add to a screen or a bombard.
  // Absent in a save from before the pick battle: none on either side.
  muster?: PerSide<number>;
  batteries?: PerSide<number>;
  seed: number;
}

// The space battle fought by picking (space-picks.ts): a few rounds, each side picking one order a
// round, shown to the other only once both are in.
export type SpaceOrder = "broadside" | "screen" | "board" | "bombard" | "withdraw";
export const SPACE_ORDERS: SpaceOrder[] = ["broadside", "screen", "board", "bombard", "withdraw"];

export interface SpaceBattleResult {
  id: string;
  winner: Side;               // holds the orbit
  fleets: PerSide<number>;    // cruisers still flying at the end
  heroDown: boolean;
  auto?: true;                // left to the AI, as on the ground
  inputs?: string;            // played: the hero's input log, as on the ground; a pick battle's is the hero's picks
  picks?: true;               // fought by picking orders rather than flown
  ground?: PerSide<number>;   // a pick battle's toll on the world below: armies each side lost to bombardment or boarding
}

export const other = (s: Side): Side => (s === "attacker" ? "defender" : "attacker");
export const poolSize = (p: VehiclePool) => VEHICLE_KINDS.reduce((n, k) => n + (p[k] ?? 0), 0);
export const FACTION_COLORS: Record<Faction, number> = { marines: 0xdfe6ee, wooka: 0xc8833a };
