// Objective points (docs/REDESIGN.md §3): the war is won on points, counted every Frost (the
// fourth turn of a year), not on a share of the key sectors. Each map has a length and a score
// to race to, and a pool of match objectives the seed draws from: two public ones both sides
// see, and one secret one each that pays only at the war's end.
import type { Faction } from "../battle/contract.ts";
import type { GalaxyId, Ground } from "./galaxy.ts";

// Only the map's shape is read here, so this file doesn't pull in the rules.
interface Board { galaxy: GalaxyId; systems: Record<string, { orbit: Faction | null; sectors: { kind: Ground; owner: Faction }[] }> }

export interface WarLength { turns: number; target: number }
export const WARS: Record<GalaxyId, WarLength> = {
  intro: { turns: 8, target: 8 },
  short: { turns: 16, target: 18 },
  full: { turns: 32, target: 36 },
  horde: { turns: 40, target: 48 },
};
export const POINTS = { field: 3, objective: 2, secret: 4, region: 1 } as const;
export const PUBLIC_OBJECTIVES = 2;
// The war's calendar: four turns to a year, the fourth the Frost.
export const TURNS_PER_YEAR = 4;
export const isFrost = (turn: number) => turn % TURNS_PER_YEAR === 0;

// An objective as data, so a campaign can keep it as JSON: hold a world's capital, hold n sectors
// of a kind, or hold the orbit over every one of some worlds.
export type Goal =
  | { kind: "capital"; system: string }
  | { kind: "sectors"; sector: Ground; n: number }
  | { kind: "orbits"; systems: string[] };
export interface Objective { id: string; name: string; goal: Goal }

const capital = (system: string, name: string): Objective => ({ id: `capital-${system}`, name: `Hold ${name}'s capital`, goal: { kind: "capital", system } });
const sectors = (sector: Ground, n: number, name: string): Objective => ({ id: `${sector}-${n}`, name: `Hold ${name}`, goal: { kind: "sectors", sector, n } });
const orbits = (systems: string[], name: string): Objective => ({ id: `orbits-${systems.join("-")}`, name: `Hold the orbit over ${name}`, goal: { kind: "orbits", systems } });

// Each map's pool. A world's capital comes with its twin's, so the draw leans neither way for long.
export const OBJECTIVES: Record<GalaxyId, Objective[]> = {
  intro: [orbits(["gap"], "the Gap"), sectors("spaceport", 2, "both spaceports"), sectors("capital", 3, "three capitals"), orbits(["haven", "ridge"], "Haven and Ridge")],
  short: [capital("kessa", "Kessa"), capital("lumen", "Lumen"), sectors("cannon", 2, "both cannons"), sectors("spaceport", 2, "both spaceports"), orbits(["kessa", "lumen"], "Kessa and Lumen"), sectors("capital", 5, "five capitals")],
  full: [capital("kessa", "Kessa"), capital("vey", "Vey"), sectors("cannon", 2, "both cannons"), sectors("spaceport", 4, "four spaceports"), orbits(["kessa", "vey"], "Kessa and Vey"), sectors("canyon", 2, "both crystal fields")],
  horde: [sectors("spaceport", 5, "five spaceports"), sectors("cannon", 3, "three cannons"), sectors("canyon", 3, "three crystal fields"), sectors("shield", 4, "four shield generators"), sectors("jungle", 3, "three jungles")],
};
export const objective = (galaxy: GalaxyId, id: string) => OBJECTIVES[galaxy].find((o) => o.id === id);

export function holdsGoal(c: Board, f: Faction, g: Goal): boolean {
  if (g.kind === "capital") return c.systems[g.system]?.sectors.some((x) => x.kind === "capital" && x.owner === f) ?? false;
  if (g.kind === "orbits") return g.systems.every((id) => c.systems[id]?.orbit === f);
  return Object.values(c.systems).reduce((n, s) => n + s.sectors.filter((x) => x.kind === g.sector && x.owner === f).length, 0) >= g.n;
}

// The war's objectives, drawn off the seed: two public, then a secret for each side from what's
// left (each its own where the pool allows).
export function drawObjectives(galaxy: GalaxyId, r: () => number): { public: string[]; secret: Record<Faction, string> } {
  const pool = OBJECTIVES[galaxy].map((o) => o.id), take = () => pool.splice(Math.floor(r() * pool.length), 1)[0]!;
  const pub = Array.from({ length: PUBLIC_OBJECTIVES }, take), marines = take(), wooka = pool.length ? take() : marines;
  return { public: pub, secret: { marines, wooka } };
}
