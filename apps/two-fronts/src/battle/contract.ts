// The two JSON types the fronts talk through. The strategy layer writes a BattleSpec for the
// battle the hero plays, the ground layer plays it and hands back a BattleResult. Neither side
// imports the other, so each is tested on its own with fixtures.

export type Faction = "marines" | "wooka";
export type SectorKind = "capital" | "spaceport" | "shield" | "cannon";
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
  vehicles: PerSide<number>;
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
}

export const other = (s: Side): Side => (s === "attacker" ? "defender" : "attacker");
export const FACTION_COLORS: Record<Faction, number> = { marines: 0xdfe6ee, wooka: 0xc8833a };
