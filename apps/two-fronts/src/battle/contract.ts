// The JSON types the fronts talk through. The strategy layer writes a BattleSpec (or a
// SpaceBattleSpec) for the battle the hero plays, the battle layer plays it and hands back a
// BattleResult (or a SpaceBattleResult). Neither side imports the other,
// so each is tested on its own with fixtures.

export type Faction = "marines" | "wooka";
export type SectorKind = "capital" | "spaceport" | "shield" | "cannon" | "canyon" | "jungle";
// What a side can field on the ground besides its troops. Tanks and speeders come with any army;
// walkers and gunships come from what the side holds on the map (see buildSpec in rules.ts).
export type VehicleKind = "tank" | "walker" | "speeder" | "gunship";
export const VEHICLE_KINDS: VehicleKind[] = ["tank", "walker", "speeder", "gunship"];
export type VehiclePool = Partial<Record<VehicleKind, number>>;
export type Side = "attacker" | "defender";
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
  seed: number;
}

export interface BattleResult {
  id: string;
  winner: Side;
  tickets: PerSide<number>; // left at the end
  heroDown: boolean;        // the hero used up every life
  auto?: true;              // left to the AI: whoever checks it can run the battle again
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
  seed: number;
}

export interface SpaceBattleResult {
  id: string;
  winner: Side;               // holds the orbit
  fleets: PerSide<number>;    // cruisers still flying at the end
  heroDown: boolean;
  auto?: true;                // left to the AI, as on the ground
}

export const other = (s: Side): Side => (s === "attacker" ? "defender" : "attacker");
export const poolSize = (p: VehiclePool) => VEHICLE_KINDS.reduce((n, k) => n + (p[k] ?? 0), 0);
export const FACTION_COLORS: Record<Faction, number> = { marines: 0xdfe6ee, wooka: 0xc8833a };
