// A skate park laid on real ground. The spec lists sites (a flat pad with kit parts on it), where to
// spawn, named gaps, goals and pickups; the builder shrinks a park-hide-seek zone to a 120 m disc,
// cuts each site's pad into the slope with withPads, and answers `height` as the higher of ground and piece.
import { heightmapTerrain, withPads, zoneData, type Terrain } from "@rustybuns/terrain";
import { type Bounds, type Level, makeLevel, type Spawn } from "../level.ts";
import { type Gap, join, lift, type Part } from "./pieces.ts";

export const PLAY_RADIUS = 120;

export type Goal =
  | { kind: "score"; target: number }
  | { kind: "combo"; target: number }
  | { kind: "gap"; name: string }
  | { kind: "collect"; count?: number };

export type Site = { x: number; z: number; r: number; parts: Part[] };
/** A tree to ride between. Scenery only: the sim has no obstacles, so the view draws it and the rails run between. */
export type Tree = { x: number; z: number; r: number; tall: number; name?: string };
export type Pickup = { x: number; z: number; y: number };

export type ParkSpec = {
  id: string; name: string; blurb: string;
  zone: string;
  /** Vertical scale of the real ground: 1 is as shrunk, less is rolling hills instead of cliffs. */
  relief?: number;
  skirt?: number;
  sites: Site[];
  spawns: Spawn[];
  bounds: Bounds;
  goals: Goal[];
  /** `lift` is metres above the floor (or above a rail's y when it sits on one). */
  pickups?: { x: number; z: number; lift?: number }[];
  trees?: Tree[];
};

export type ParkLevel = Level & {
  id: string; blurb: string;
  ground: Terrain;
  gaps: Gap[];
  goals: Goal[];
  pickups: Pickup[];
  trees: Tree[];
};

export function parkLevel(spec: ParkSpec): ParkLevel {
  const zone = zoneData(spec.zone), raw = heightmapTerrain(zone, zone.realRadius / PLAY_RADIUS), relief = spec.relief ?? 0.35;
  const scaled: Terrain = { R: raw.R, height: (x, z) => raw.height(x, z) * relief };
  const ground = withPads(scaled, spec.sites.map(({ x, z, r }) => ({ x, z, r })), spec.skirt ?? 10);
  const parts = join(...spec.sites.flatMap((s) => s.parts.map((p) => lift(p, scaled.height(s.x, s.z)))));
  const inner = makeLevel({ name: spec.name, pieces: parts.pieces, rails: parts.rails, spawns: spec.spawns, bounds: spec.bounds });
  const height = (x: number, z: number) => Math.max(ground.height(x, z), inner.height(x, z));
  const trees = spec.trees ?? [];
  return {
    ...inner, height, id: spec.id, blurb: spec.blurb, ground, gaps: parts.gaps, goals: spec.goals, trees,
    pickups: (spec.pickups ?? []).map((p) => ({ x: p.x, z: p.z, y: height(p.x, p.z) + (p.lift ?? 1) })),
  };
}
