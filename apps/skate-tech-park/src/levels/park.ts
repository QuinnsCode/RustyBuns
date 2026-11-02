// A skate park laid on real ground, at the scale of the giant board: the terrain is the park. The spec lists
// kit parts, where to spawn, named gaps (natural ones are just data: where you leave the ground and where
// you must land), goals and pickups. The builder shrinks a park-hide-seek zone by TERRAIN_SCALE, drapes each
// site's kit parts onto the slope (or cuts a flat pad under a site that asks for one), and answers `height`
// as the higher of ground and piece.
import { heightmapTerrain, withPads, type Terrain, type ZoneData } from "@rustybuns/terrain";
import { type Bounds, gridOf, type Level, makeLevel, postObstacles, type Spawn } from "../level.ts";
import { drape, type Gap, join, lift, type Part, type Route } from "./pieces.ts";
import { type Circle, footprint, type Lane, scatter, SCATTER, type Scatter } from "./scatter.ts";
import { circles, copings, hillSpawn, layOut, paintAt, sculpt, WORKS, type Earthwork, type Paint, type Works } from "./earthworks.ts";
import { embedded } from "./embedded.ts";
import { type Fill, fillContours, keepOut, type Pt } from "./ribbons.ts";

/** Real terrain is shrunk this many times across in the specs (a 1 km zone is written as a ~333 m disc). The coordinates every
 * park file is written in; `MAP` lays them out wider. */
export const TERRAIN_SCALE = 3;
/** Parks are laid out this many times wider than their specs are written: the ground stretches out under them and each site of
 * kit moves out with the spot it was put on, its own pieces the size they were (a ~333 m disc becomes a ~1 km one). */
export const MAP = 3;
/** And the ground stands this many times taller than the spec's own: as much as it is wider, so every slope rides as it did and a
 * mountain is three times the mountain. */
export const RISE = MAP;
/** The scattered kit and the earthworks are laid this many times further apart than their cells say: the wider map gets
 * about four times the parts, not nine, so it stays as quick to draw and to ride between. */
export const SPREAD = 1.5;
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
  /** A whole mountain modelled in Blender (blender/landmark.py, landmarks.py) standing past the park's edge: its crest `tall` metres above `y`, its sheer face to the west before `yaw` turns it. Drawn by render/peak.ts. */
  | Peak;
/** The landmark models in `public/models/landmark-<model>-<budget>.glb`: Half Dome, and for the parks beyond the Sierra a sandstone arch, an amphitheatre of hoodoos, a flat-topped mesa and a snow-capped volcano. */
export const PEAK_MODELS = ["half-dome", "arch", "hoodoos", "mesa", "volcano"] as const;
export type PeakModel = (typeof PEAK_MODELS)[number];
export type Peak = { kind: "peak"; model: PeakModel; x: number; y: number; z: number; tall: number; yaw?: number };

export type Pickup = { x: number; z: number; y: number };

/** What grows over a park (render/scenery.ts): the pine forest of the Sierra, the desert, the hardwood east, the swamps and islands, the high and dry. */
export type Biome = "pine" | "desert" | "hardwood" | "swamp" | "alpine";
export const BIOMES: Biome[] = ["pine", "desert", "hardwood", "swamp", "alpine"];

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
  /** What is strewn over the ground: pines unless said otherwise. */
  biome?: Biome;
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
  biome: Biome;
  /** The contour each ribbon follows, for the map. */
  ribbons: { profile: string; path: Pt[] }[];
  /** What is cut into the ground (the height already includes it), for the map and for keeping scenery out. */
  earthworks: Earthwork[];
  /** What a point of ground is made of, for painting it: concrete, packed dirt or the meadow. */
  paint(x: number, z: number): Paint;
};

/** The ground a landmark's drawing covers, so scattered parts don't stand in the steam or the spring. */
const landmarkCircle = (l: Landmark): Circle[] => (l.kind === "plume" ? [{ x: l.x, z: l.z, r: l.r + 4 }] : l.kind === "rings" ? [{ x: l.x, z: l.z, r: Math.max(...l.rings.map((g) => g.r)) }] : []);

/** Lines scatter keeps open: each gap's flight and 30 m of run-out past its landing, the way in to it from every spawn in reach, and straight ahead of every spawn. */
const runOut = (g: Gap) => 30 / Math.max(1, Math.hypot(g.b.x - g.a.x, g.b.z - g.a.z));
const lanes = (gaps: Gap[], spawns: Spawn[]): Lane[] => [
  ...gaps.flatMap((g) => [[g.a, { x: g.b.x + (g.b.x - g.a.x) * runOut(g), z: g.b.z + (g.b.z - g.a.z) * runOut(g) }] as [Pt, Pt], ...spawns.filter((s) => Math.hypot(s.x - g.a.x, s.z - g.a.z) < 200 * MAP).map((s) => [s, g.a] as [Pt, Pt])]),
  ...spawns.map((s) => [s, { x: s.x + Math.sin(s.yaw) * 160 * MAP, z: s.z + Math.cos(s.yaw) * 160 * MAP }, 10] as Lane), // wide: a long straight from a spawn drifts across a slope
];

/** A spawn on level ground: where the widened ground under it tilts more than a gentle slope, the nearest level spot behind it
 * or beside it (within 30 m), still facing the same way. */
function settle(p: Spawn, ground: (x: number, z: number) => number): Spawn {
  const level = (x: number, z: number) => { const h = ground(x, z); return [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]].every(([dx, dz]) => Math.abs(ground(x + dx!, z + dz!) - h) < 0.7); };
  if (level(p.x, p.z)) return p;
  const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
  for (let d = 2; d <= 30; d += 2) for (const [b, s] of [[-d, 0], [0, d], [0, -d], [-d, d], [-d, -d], [d, 0]] as const) {
    const x = p.x + fx * b + fz * s, z = p.z + fz * b - fx * s;
    if (level(x, z)) return { ...p, x, z };
  }
  return p;
}

/** A part moved bodily by (dx, dz): its pieces, bars, gaps and lines. */
const shift = (p: Part, dx: number, dz: number): Part => {
  const at = <T extends { x: number; z: number }>(q: T): T => ({ ...q, x: q.x + dx, z: q.z + dz });
  return { pieces: p.pieces.map(at), rails: p.rails.map((r) => ({ ...r, a: at(r.a), b: at(r.b) })), gaps: p.gaps.map((g) => ({ ...g, a: at(g.a), b: at(g.b) })), routes: p.routes.map((r) => ({ ...r, points: r.points.map(at) })) };
};

/**
 * A spec written in `TERRAIN_SCALE` coordinates, laid out `MAP` times wider. Each site moves as one block to `MAP` times where
 * it stood (its pad's centre, or the middle of what it covers), so a kicker on the lip of a drop is still on that lip and a
 * street line keeps its run-ups. A spawn, a pickup or a gap near a site moves with it; anything else (a tree, a landmark, a
 * spawn out in the open) goes to `MAP` times where it was. Heights the spec names grow by `RISE`.
 */
export function widen(spec: ParkSpec): ParkSpec {
  const sites = spec.sites.map((site) => {
    const fp = site.parts.flatMap(footprint), mid = site.pad ?? (fp.length ? { x: fp.reduce((n, c) => n + c.x, 0) / fp.length, z: fp.reduce((n, c) => n + c.z, 0) / fp.length } : { x: 0, z: 0 });
    const dx = mid.x * (MAP - 1), dz = mid.z * (MAP - 1);
    return { fp, dx, dz, site: { ...site, parts: site.parts.map((p) => shift(p, dx, dz)), ...(site.pad ? { pad: { ...site.pad, x: site.pad.x * MAP, z: site.pad.z * MAP } } : {}) } };
  });
  /** A point out with the ground, `MAP` times as far from the middle. */
  const out = <T extends { x: number; z: number }>(q: T): T => ({ ...q, x: q.x * MAP, z: q.z * MAP });
  /** What a point can move with: a site's kit, or a gap's launch (`ground`: a gap the ground makes, whose run-up stretches with it). */
  type Anchor = { fp: Circle[]; dx: number; dz: number; ground?: true };
  const anchors: Anchor[] = [...sites];
  const nearest = (q: { x: number; z: number }, reach: number) => {
    let best: { d: number; s: Anchor } | null = null;
    for (const s of anchors) for (const c of s.fp) {
      const d = Math.hypot(q.x - c.x, q.z - c.z) - c.r;
      if (d < reach && (!best || d < best.d)) best = { d, s };
    }
    return best?.s ?? null;
  };
  /** How a point moves: with the nearest thing within `reach` metres of it, else out with the ground. */
  const move = <T extends { x: number; z: number }>(q: T, reach: number): T => { const b = nearest(q, reach); return b && !b.ground ? { ...q, x: q.x + b.dx, z: q.z + b.dz } : out(q); };
  /** A spawn moved with what it is there for (or out with the ground, when that is the ground's own gap). */
  const shifted = (p: Spawn, by: Anchor): Spawn => (by.ground ? out(p) : { ...p, x: p.x + by.dx, z: p.z + by.dz });
  /** A spawn named for what it is there for ("Boulder Gap run", "sky rail") moves with that gap or that kit. */
  const named = (p: Spawn): Spawn | null => {
    const n = p.name.toLowerCase(), g = (spec.gaps ?? []).findIndex((x) => n.startsWith(x.name.toLowerCase()));
    const s = g >= 0 ? anchors[sites.length + g] : sites.find((t) => t.site.parts.some((q) => q.pieces.some((r) => r.name.toLowerCase().startsWith(`${n} `))));
    return s ? shifted(p, s) : null;
  };
  /** A spawn moves with what it faces: a gap's launch straight ahead of it (within a widening cone, 300 m out), else the nearest site ahead. */
  const facing = (p: Spawn): Spawn | null => {
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const ahead = (from: typeof anchors, far: number) => {
      let best: { score: number; s: Anchor } | null = null;
      for (const s of from) for (const c of s.fp) { // the one most squarely in its sight, nearer breaking a tie
        const vx = c.x - p.x, vz = c.z - p.z, along = vx * fx + vz * fz, off = Math.abs(vx * fz - vz * fx), score = Math.max(0, off - c.r) + along * 0.05;
        if (along > 0 && along < far && off < c.r + 10 + along * 0.25 && (!best || score < best.score)) best = { score, s };
      }
      return best?.s ?? null;
    };
    const best = ahead(anchors.slice(sites.length), 300) ?? ahead(sites, 250);
    return best && shifted(p, best);
  };
  // A gap launched off kit keeps its length: the kicker is the size it was, so it flies as far as it did (a little further:
  // the drop under it is taller now). One the ground makes by itself (a cliff, a canyon) stretches with the ground.
  const gaps = spec.gaps?.map((g) => {
    const kit = nearest(g.a, 0) !== null, a = move(g.a, 0), dx = a.x - g.a.x, dz = a.z - g.a.z; // launched off kit: its launch is on that kit's footprint
    anchors.push({ fp: [{ x: g.a.x, z: g.a.z, r: 0 }], dx, dz, ...(kit ? {} : { ground: true as const }) });
    return kit ? { ...g, a, b: { x: g.b.x + dx, z: g.b.z + dz }, rb: g.rb * 1.5 } : { ...g, a, b: out(g.b), r: g.r * MAP, rb: g.rb * MAP };
  });
  const landmark = (l: Landmark): Landmark =>
    l.kind === "plume" ? move(l, 30) // the steam stands on its vent's kit
      : l.kind === "rings" ? { ...move(l, 30), rings: l.rings.map((g) => ({ ...g, r: g.r * MAP })) }
      : l.kind === "falls" ? { ...l, from: out(l.from), to: out(l.to), width: l.width * MAP }
      : { ...out(l), tall: l.tall * MAP }; // its `y` is read off the widened ground where it meets the edge (parkLevel)
  const spread = <T extends { cell?: number }>(o: T | false | undefined, cell: number): T | false => (o === false ? false : { ...(o ?? ({} as T)), cell: (o?.cell ?? cell) * SPREAD });
  return {
    ...spec,
    sites: sites.map((s) => s.site),
    spawns: spec.spawns.map((p) => { // a spawn keeps its run-up to what it faces, and one that looked at the park's middle still does
      const mid = Math.atan2(-p.x, -p.z);
      if (Math.abs(Math.atan2(Math.sin(mid - p.yaw), Math.cos(mid - p.yaw))) < 0.05) return out(p); // straight out from the middle, so what stands past the edge behind it is still dead ahead
      return named(p) ?? facing(p) ?? move(p, 40);
    }),
    pickups: spec.pickups?.map((p) => move(p, 12)),
    gaps,
    trees: spec.trees?.map(out),
    landmarks: spec.landmarks?.map(landmark),
    granite: spec.granite === undefined ? undefined : spec.granite * RISE,
    fill: spec.fill && { ...spec.fill, lines: (spec.fill.lines ?? 6) * MAP, maxLen: (spec.fill.maxLen ?? 150) * RISE },
    scatter: spread(spec.scatter, SCATTER.cell),
    earthworks: spread(spec.earthworks, WORKS.cell),
  };
}

/** Builds the level from its spec and the ground `loadZone(spec.zone)` fetched: laid out `MAP` times wider (`widen`). */
export function parkLevel(given: ParkSpec, zone: ZoneData, real = false): ParkLevel {
  const spec = widen(given);
  const written = real ? REAL_RELIEF : spec.relief ?? RELIEF; // the squash the spec was written at; real mode is true proportions, as tall as it is wide
  const raw = heightmapTerrain(zone, TERRAIN_SCALE / MAP), relief = (real ? MAP : written * RISE) / MAP;
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
  // long smooth bars set into the hillsides the kit left, laid on the finished ground so they sit flush
  const burrowed = embedded({ bounds, R: ground.R, ground: land.height, spawns: spec.spawns, lanes: lanes(gaps, spec.spawns), taken: [...footprint(kit), ...trees, ...landmarks, ...works.flatMap(circles)] });
  const parts = join(kit, drape(copings(works), land.height), ...burrowed);
  // a park with no hillside cut near its spawns starts a rider below one, on ground the ribbons and the scattered kit left open
  const extra = hillSpawn(works, spec.spawns, [...parts.pieces.map((p) => ({ x: p.x, z: p.z, r: 6 })), ...(filled?.paths ?? []).flatMap((r) => r.path.map((p) => ({ x: p.x, z: p.z, r: 15 })))], undefined, land.height);
  const inner = makeLevel({ name: spec.name, pieces: parts.pieces, rails: parts.rails, obstacles: trees, spawns: extra ? [...spec.spawns, extra] : spec.spawns, bounds });
  const height = (x: number, z: number) => Math.max(land.height(x, z), inner.height(x, z));
  /** A far peak stands on the ground where it meets the park's edge (the spec's `y` was read off the ground as written). */
  const toe = (m: Peak) => { const d = Math.hypot(m.x, m.z) || 1, at = land.R - EDGE; return land.height((m.x / d) * at, (m.z / d) * at); };
  const obstacles = [...trees, ...postObstacles(parts.rails, height)], painted = gridOf(works, (e) => e.reach);
  return {
    ...inner, spawns: inner.spawns.map((p) => settle(p, height)), obstacles, height, id: spec.id, blurb: spec.blurb, ground: land, earthworks: works, paint: (x, z) => paintAt(painted(x, z), x, z), gaps: [...parts.gaps, ...(spec.gaps ?? [])], routes: parts.routes, goals: spec.goals.map((g) => (g.kind === "climb" ? { ...g, metres: Math.max(1, Math.round((g.metres * written) / GOAL_RELIEF)) } : g)), ribbons: filled?.paths ?? [], trees, landmarks: (spec.landmarks ?? []).map((m) => (m.kind === "peak" ? { ...m, y: toe(m) } : m)), granite: spec.granite ?? Infinity, weather: spec.weather, biome: spec.biome ?? "pine",
    pickups: (spec.pickups ?? []).map((p) => ({ x: p.x, z: p.z, y: height(p.x, p.z) + (p.lift ?? 1) })),
  };
}
