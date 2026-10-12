// The first slice's galaxy: eight systems in three regions. Most worlds are one capital sector;
// Kessa, on the front line, is a whole planet of three sectors.
import type { Faction, SectorKind } from "../battle/contract.ts";

export interface SystemDef {
  id: string;
  name: string;
  region: string;
  x: number; // map position, 0-100
  y: number;
  sectors: SectorKind[];
}

export interface RegionDef { id: string; name: string; bonus: number }

export const REGIONS: RegionDef[] = [
  { id: "west", name: "Concord Reach", bonus: 2 },
  { id: "core", name: "The Narrows", bonus: 3 },
  { id: "east", name: "Hegemon Marches", bonus: 2 },
];

export const SYSTEMS: SystemDef[] = [
  { id: "aster", name: "Aster", region: "west", x: 10, y: 30, sectors: ["capital"] },
  { id: "brill", name: "Brill", region: "west", x: 14, y: 72, sectors: ["capital"] },
  { id: "corva", name: "Corva", region: "west", x: 32, y: 50, sectors: ["capital"] },
  { id: "kessa", name: "Kessa", region: "core", x: 50, y: 30, sectors: ["shield", "spaceport", "capital"] },
  { id: "lumen", name: "Lumen", region: "core", x: 50, y: 74, sectors: ["capital"] },
  { id: "morrow", name: "Morrow", region: "east", x: 68, y: 50, sectors: ["capital"] },
  { id: "nyx", name: "Nyx", region: "east", x: 88, y: 28, sectors: ["capital"] },
  { id: "orin", name: "Orin", region: "east", x: 86, y: 72, sectors: ["capital"] },
];

export const LANES: [string, string][] = [
  ["aster", "brill"], ["aster", "corva"], ["brill", "corva"],
  ["corva", "kessa"], ["corva", "lumen"], ["kessa", "lumen"],
  ["kessa", "morrow"], ["lumen", "morrow"],
  ["morrow", "nyx"], ["morrow", "orin"], ["nyx", "orin"],
];

export const SECTOR_NAMES: Record<SectorKind, string> = { capital: "Capital", spaceport: "Spaceport", shield: "Shield generator" };
// Credits a sector earns its holder each turn.
export const SECTOR_INCOME: Record<SectorKind, number> = { capital: 3, spaceport: 2, shield: 1 };

export const START: Record<string, { owner: Faction; fleets: number; armies: number }> = {
  aster: { owner: "concord", fleets: 3, armies: 2 },
  brill: { owner: "concord", fleets: 1, armies: 2 },
  corva: { owner: "concord", fleets: 3, armies: 3 },
  lumen: { owner: "concord", fleets: 1, armies: 1 },
  kessa: { owner: "hegemony", fleets: 2, armies: 1 },
  morrow: { owner: "hegemony", fleets: 3, armies: 3 },
  nyx: { owner: "hegemony", fleets: 2, armies: 2 },
  orin: { owner: "hegemony", fleets: 1, armies: 2 },
};

export const FACTION_NAMES: Record<Faction, string> = { concord: "Concord", hegemony: "Hegemony" };

export const neighbours = (id: string) =>
  LANES.flatMap(([a, b]) => (a === id ? [b] : b === id ? [a] : []));

export const adjacent = (a: string, b: string) => LANES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

export const systemDef = (id: string) => {
  const s = SYSTEMS.find((s) => s.id === id);
  if (!s) throw new Error(`no system ${id}`);
  return s;
};
