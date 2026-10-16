// A skate park laid on real ground, at the scale of the giant board: the terrain is the park. The spec lists
// kit parts, where to spawn, named gaps (natural ones are just data: where you leave the ground and where
// you must land), goals and pickups. The builder shrinks a park-hide-seek zone by TERRAIN_SCALE, drapes each
// site's kit parts onto the slope (or cuts a flat pad under a site that asks for one), and answers `height`
// as the higher of ground and piece.
import { heightmapTerrain, withPads, zoneData, type Terrain } from "@rustybuns/terrain";
import { type Bounds, type Level, makeLevel, postObstacles, type Spawn } from "../level.ts";
import { drape, type Gap, join, lift, type Part } from "./pieces.ts";

/** Real terrain is shrunk this many times across (a 1 km zone becomes a ~333 m disc). One constant for the whole game. */
export const TERRAIN_SCALE = 3;
/** And its height is squashed this much further, so cliff faces are friendly to ride up instead of sheer. */
export const RELIEF = 0.35;
/** The unsquashed height ("real" mode): the terrain's true proportions at `TERRAIN_SCALE`. */
export const REAL_RELIEF = 1;
/** The relief the `climb` goals were authored at; they scale with the park's relief. */
const GOAL_RELIEF = 0.5;

export type Goal =
  | { kind: "score"; target: number }
  | { kind: "combo"; target: number }
  | { kind: "gap"; name: string }
  | { kind: "collect"; count?: number }
  /** Get this high above where the ride began: up a cliff face, off a ridge. */
  | { kind: "climb"; metres: number; name: string };

/** Kit parts on a spot of the park. They follow the ground, unless `pad` cuts a flat shelf under them. */
export type Site = { parts: Part[]; pad?: { x: number; z: number; r: number } };
/** A tree to ride between: the view draws it and the sim treats it as solid up to `tall`. */
export type Tree = { x: number; z: number; r: number; tall: number; name?: string };
/** What a park is known for, drawn so its silhouette reads from the start: a geyser's steam, a spring's coloured rings, a waterfall. */
export type Landmark =
  | { kind: "plume"; x: number; z: number; tall: number; r: number }
  /** Concentric terraces, outermost first (and lowest), one colour each. */
  | { kind: "rings"; x: number; z: number; rings: { r: number; color: number }[] }
  | { kind: "falls"; from: { x: number; z: number }; to: { x: number; z: number }; width: number };

export type Pickup = { x: number; z: number; y: number };

export type ParkSpec = {
  id: string; name: string; blurb: string;
  zone: string;
  relief?: number;
  skirt?: number;
  sites: Site[];
  /** Gaps the ground makes by itself (a canyon, a drop): no kit piece needed. */
  gaps?: Gap[];
  spawns: Spawn[];
  bounds: Bounds;
  goals: Goal[];
  /** `lift` is metres above the floor (or above a rail's y when it sits on one). */
  pickups?: { x: number; z: number; lift?: number }[];
  trees?: Tree[];
  landmarks?: Landmark[];
  /** Ground above this height is bare granite (a dome's cap), so a high summit reads against the green below. */
  granite?: number;
  /** The air over the park (a name from render/weather.ts): rain on the valley, snow on the dome. Golden hour when absent. */
  weather?: string;
};

export type ParkLevel = Level & {
  id: string; blurb: string;
  ground: Terrain;
  gaps: Gap[];
  goals: Goal[];
  pickups: Pickup[];
  trees: Tree[];
  landmarks: Landmark[];
  granite: number;
  weather?: string;
};

export function parkLevel(spec: ParkSpec, real = false): ParkLevel {
  const zone = zoneData(spec.zone), raw = heightmapTerrain(zone, TERRAIN_SCALE), relief = real ? REAL_RELIEF : spec.relief ?? RELIEF;
  const scaled: Terrain = { R: raw.R, height: (x, z) => raw.height(x, z) * relief };
  const pads = spec.sites.flatMap((s) => (s.pad ? [s.pad] : []));
  const ground = pads.length ? withPads(scaled, pads, spec.skirt ?? 10) : scaled;
  const parts = join(...spec.sites.flatMap((s) => s.parts.map((p) => (s.pad ? lift(p, scaled.height(s.pad.x, s.pad.z)) : drape(p, ground.height)))));
  const trees = spec.trees ?? [];
  const inner = makeLevel({ name: spec.name, pieces: parts.pieces, rails: parts.rails, obstacles: trees, spawns: spec.spawns, bounds: spec.bounds });
  const height = (x: number, z: number) => Math.max(ground.height(x, z), inner.height(x, z));
  const obstacles = [...trees, ...postObstacles(parts.rails, height)];
  return {
    ...inner, obstacles, height, id: spec.id, blurb: spec.blurb, ground, gaps: [...parts.gaps, ...(spec.gaps ?? [])], goals: spec.goals.map((g) => (g.kind === "climb" ? { ...g, metres: Math.max(1, Math.round((g.metres * relief) / GOAL_RELIEF)) } : g)), trees, landmarks: spec.landmarks ?? [], granite: spec.granite ?? Infinity, weather: spec.weather,
    pickups: (spec.pickups ?? []).map((p) => ({ x: p.x, z: p.z, y: height(p.x, p.z) + (p.lift ?? 1) })),
  };
}
