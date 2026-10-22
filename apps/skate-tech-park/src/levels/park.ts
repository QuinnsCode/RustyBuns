// A skate park laid on real ground, at the scale of the giant board: the terrain is the park. The spec lists
// kit parts, where to spawn, named gaps (natural ones are just data: where you leave the ground and where
// you must land), goals and pickups. The builder shrinks a park-hide-seek zone by TERRAIN_SCALE, drapes each
// site's kit parts onto the slope (or cuts a flat pad under a site that asks for one), and answers `height`
// as the higher of ground and piece.
import { heightmapTerrain, withPads, zoneData, type Terrain } from "@rustybuns/terrain";
import { type Bounds, type Level, makeLevel, postObstacles, type Spawn } from "../level.ts";
import { drape, type Gap, join, lift, type Part, type Route } from "./pieces.ts";
import { type Circle, footprint, scatter, type Scatter } from "./scatter.ts";
import { circles, copings, hillSpawn, layOut, paintAt, sculpt, type Earthwork, type Paint, type Works } from "./earthworks.ts";
import { type Fill, fillContours, keepOut, type Pt } from "./ribbons.ts";

/** Real terrain is shrunk this many times across (a 1 km zone becomes a ~333 m disc). One constant for the whole game. */
export const TERRAIN_SCALE = 3;
/** And its height is squashed this much further, so cliff faces are friendly to ride up instead of sheer. */
export const RELIEF = 0.35;
/** The unsquashed height ("real" mode): the terrain's true proportions at `TERRAIN_SCALE`. */
export const REAL_RELIEF = 1;
/** How far in from the edge of the terrain the barrier stands, so the ground it stands on is real. */
export const EDGE = 14;
/** A park spans all of its terrain, edge to edge. */
export const edgeOf = (R: number): Bounds => ({ minX: -R + EDGE, maxX: R - EDGE, minZ: -R + EDGE, maxZ: R - EDGE });
/** The relief the `climb` goals were authored at; they scale with the park's relief. */
const GOAL_RELIEF = 0.5;

export type Goal =
  | { kind: "score"; target: number }
  | { kind: "combo"; target: number }
  | { kind: "gap"; name: string }
  | { kind: "collect"; count?: number }
  /** Ride the named line (see lines.ts) beat by beat without a bail. */
  | { kind: "line"; name: string }
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
  | { kind: "falls"; from: { x: number; z: number }; to: { x: number; z: number }; width: number }
  /** A whole mountain modelled in Blender (blender/landmark.py) standing past the park's edge: its crest `tall` metres above `y`, its sheer face to the west before `yaw` turns it. Drawn by render/peak.ts. */
  | Peak;
export type Peak = { kind: "peak"; model: "half-dome"; x: number; y: number; z: number; tall: number; yaw?: number };

export type Pickup = { x: number; z: number; y: number };

export type ParkSpec = {
  id: string; name: string; blurb: string;
  zone: string;
  relief?: number;
  skirt?: number;
  sites: Site[];
  /** Parts spread over everything the sites leave empty, like a skate game's map. On by default; `false` leaves the park to its sites. */
  scatter?: Scatter | false;
  /** Gaps the ground makes by itself (a canyon, a drop): no kit piece needed. */
  gaps?: Gap[];
  spawns: Spawn[];
  goals: Goal[];
  /** `lift` is metres above the floor (or above a rail's y when it sits on one). */
  pickups?: { x: number; z: number; lift?: number }[];
  trees?: Tree[];
  landmarks?: Landmark[];
  /** Ground above this height is bare granite (a dome's cap), so a high summit reads against the green below. */
  granite?: number;
  /** The air over the park (a name from render/weather.ts): rain on the valley, snow on the dome. Golden hour when absent. */
  weather?: string;
  /** Contour ribbons across the slopes the sites leave empty (see ribbons.ts): how many, how long. Absent for none. */
  fill?: Fill;
  /** Bowls, pumps, jumps and channels cut into the ground itself, one per cell across the whole map. On by default; `false` leaves the ground as it was. */
  earthworks?: Works | false;
};

export type ParkLevel = Level & {
  id: string; blurb: string;
  ground: Terrain;
  gaps: Gap[];
  /** The lines placed in the park, for the `line` goals. */
  routes: Route[];
  goals: Goal[];
  pickups: Pickup[];
  trees: Tree[];
  landmarks: Landmark[];
  granite: number;
  weather?: string;
  /** The contour each ribbon follows, for the map. */
  ribbons: { profile: string; path: Pt[] }[];
  /** What is cut into the ground (the height already includes it), for the map and for keeping scenery out. */
  earthworks: Earthwork[];
  /** What a point of ground is made of, for painting it: concrete, packed dirt or the meadow. */
  paint(x: number, z: number): Paint;
};

/** The ground a landmark's drawing covers, so scattered parts don't stand in the steam or the spring. */
const landmarkCircle = (l: Landmark): Circle[] => (l.kind === "plume" ? [{ x: l.x, z: l.z, r: l.r + 4 }] : l.kind === "rings" ? [{ x: l.x, z: l.z, r: Math.max(...l.rings.map((g) => g.r)) }] : []);

/** Lines scatter keeps open: each gap's flight, the way in to it from every spawn in reach, and straight ahead of every spawn. */
const lanes = (gaps: Gap[], spawns: Spawn[]): [Pt, Pt][] => [
  ...gaps.flatMap((g) => [[g.a, g.b] as [Pt, Pt], ...spawns.filter((s) => Math.hypot(s.x - g.a.x, s.z - g.a.z) < 200).map((s) => [s, g.a] as [Pt, Pt])]),
  ...spawns.map((s) => [s, { x: s.x + Math.sin(s.yaw) * 160, z: s.z + Math.cos(s.yaw) * 160 }] as [Pt, Pt]),
];

export function parkLevel(spec: ParkSpec, real = false): ParkLevel {
  const zone = zoneData(spec.zone), raw = heightmapTerrain(zone, TERRAIN_SCALE), relief = real ? REAL_RELIEF : spec.relief ?? RELIEF;
  const scaled: Terrain = { R: raw.R, height: (x, z) => raw.height(x, z) * relief };
  const bounds = edgeOf(raw.R), pads = spec.sites.flatMap((s) => (s.pad ? [s.pad] : []));
  const ground = pads.length ? withPads(scaled, pads, spec.skirt ?? 10) : scaled;
  const sited = join(...spec.sites.flatMap((s) => s.parts.map((p) => (s.pad ? lift(p, scaled.height(s.pad.x, s.pad.z)) : drape(p, ground.height)))));
  const trees = spec.trees ?? [];
  const gaps = [...sited.gaps, ...(spec.gaps ?? [])];
  const landmarks = (spec.landmarks ?? []).flatMap(landmarkCircle);
  const filled = spec.fill ? fillContours(ground.height, bounds, keepOut({ pieces: sited.pieces, spawns: spec.spawns, gaps, trees, pickups: spec.pickups ?? [], landmarks: (spec.landmarks ?? []).flatMap((l) => (l.kind === "falls" ? [l.from, l.to] : [l])) }), spec.fill) : undefined;
  const placed = filled ? join(sited, drape(filled.part, ground.height)) : sited;
  // The earthworks are laid first, so a park's pools and bowls are not squeezed out by the kit scattered over it; the kit then
  // fills what they leave open, as tightly as a skate game packs its map.
  const works = spec.earthworks === false ? [] : layOut({ bounds, R: ground.R, ground: ground.height, spawns: spec.spawns, lanes: lanes(gaps, spec.spawns), taken: [...footprint(placed), ...trees, ...landmarks, ...(spec.pickups ?? []).map((p) => ({ x: p.x, z: p.z, r: 6 }))] }, spec.earthworks);
  const spread = spec.scatter === false ? [] : scatter({ bounds, R: ground.R, ground: ground.height, spawns: spec.spawns, lanes: lanes(gaps, spec.spawns), taken: [...footprint(placed), ...trees, ...landmarks, ...works.flatMap(circles)] }, spec.scatter).map((p) => drape(p, ground.height));
  const kit = join(placed, ...spread);
  const land = sculpt(ground, works);
  const parts = join(kit, drape(copings(works), land.height));
  const extra = hillSpawn(works, spec.spawns); // a park with no hillside cut near its spawns starts a rider below one
  const inner = makeLevel({ name: spec.name, pieces: parts.pieces, rails: parts.rails, obstacles: trees, spawns: extra ? [...spec.spawns, extra] : spec.spawns, bounds });
  const height = (x: number, z: number) => Math.max(land.height(x, z), inner.height(x, z));
  const obstacles = [...trees, ...postObstacles(parts.rails, height)];
  return {
    ...inner, obstacles, height, id: spec.id, blurb: spec.blurb, ground: land, earthworks: works, paint: (x, z) => paintAt(works, x, z), gaps: [...parts.gaps, ...(spec.gaps ?? [])], routes: parts.routes, goals: spec.goals.map((g) => (g.kind === "climb" ? { ...g, metres: Math.max(1, Math.round((g.metres * relief) / GOAL_RELIEF)) } : g)), ribbons: filled?.paths ?? [], trees, landmarks: spec.landmarks ?? [], granite: spec.granite ?? Infinity, weather: spec.weather,
    pickups: (spec.pickups ?? []).map((p) => ({ x: p.x, z: p.z, y: height(p.x, p.z) + (p.lift ?? 1) })),
  };
}
