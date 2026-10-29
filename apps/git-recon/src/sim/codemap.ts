// A repo laid onto a piece of ground, the way codeSplitter's code city lays a
// person's repos onto streets (apps/codesplitter/src/city.ts), but as a battlefield:
//   - the biggest folders are enemy compounds, cut level into the ground, each held by guards
//   - a compound's files are its buildings: height is line count, so a 2000-line file is a tower to fight round
//   - files from everywhere else are crates scattered across the field, cover between you and them
//   - folders that import each other are joined by roads; a folder that changed a lot lately holds more guards
//   - a file agents mostly wrote is black glass, not paper (codeSplitter's city does this); a failing check sets its compound on fire
//   - a gate opens on the compound's easiest side, a ramp graded out of it, and a footpath is cut from HEAD
//     to every gate, so each one can be walked to, however high it sits and whatever drops away round it
// The same repo on the same ground with the same seed is always the same level.

import { baked, slope, smooth, wet, withPads, withStamps, withTrails, type Pad, type Stamp, type Terrain, type TrailPoint } from "@rustybuns/terrain";
import { len, mulberry32 } from "@rustybuns/util";
export { mulberry32 };

export interface RepoFile {
  path: string;
  lines: number;
  /** Commits that touched it lately (of the repo's last hundred or so). */
  churn?: number;
  /** The share of those commits agents made, 0-1. */
  agent?: number;
}
export interface RepoSnapshot {
  name: string;
  ref: string;
  files: RepoFile[];
  /** Folders whose files import each other: [a, b, importing files]. */
  links?: [string, string, number][];
  /** Names of the checks failing at `ref`. */
  failing?: string[];
  /** The opening lines of its biggest files: what the ground is printed with. */
  text?: { path: string; lines: string[] }[];
}

export interface Block {
  path: string;
  lines: number;
  /** Which compound it belongs to, or -1 for a crate out in the field. */
  compound: number;
  x: number;
  z: number;
  /** Where its base sits. */
  y: number;
  /** Footprint (x by z) and height; blocks are axis-aligned boxes. */
  w: number;
  d: number;
  h: number;
  /** Agents mostly wrote it (its recent commits were at least half agents'). */
  agent?: boolean;
  /** Part of a compound's wall, a tower, a hedgerow or sandbags, not a file: solid, but nothing to raze. */
  wall?: boolean;
  /** What a wall block is made of, for drawing: mud brick unless said otherwise. */
  stuff?: Stuff;
  /** A file already shelled down to rubble: a low broken slab with a few lines left in it. */
  ruin?: boolean;
  /** Drawn as this shape instead of what its path says (a farm's barn, a village's church tower). */
  shape?: Structure;
}

/** How a compound is built: the mud-walled fort, a bocage farm, a village round a square, or a concrete strongpoint. */
export type Style = "qalat" | "farm" | "village" | "bunker";
export const STYLES: Style[] = ["qalat", "farm", "village", "bunker"];
/** What a wall block is made of: mud brick, field stone, a hedgerow, sandbags, poured concrete. */
export type Stuff = "mud" | "stone" | "hedge" | "sandbag" | "concrete";

/** A patch of smoke hanging over the ground: guards can't see through more than SMOKE_SEE metres of it. */
export interface Smoke { x: number; z: number; r: number }
export const SMOKE_SEE = 6;

export interface Compound {
  folder: string;
  x: number;
  z: number;
  r: number;
  files: number;
  lines: number;
  guards: number;
  /** The folder's share of the repo's recent changes, 0-1. */
  churn?: number;
  /** A failing check is about this folder. */
  burning?: boolean;
  /** Half the side of the walled square inside the yard, and which side its gate is in (0 +x, 1 -x, 2 +z, 3 -z). */
  half?: number;
  gate?: number;
  /** How it's built (STYLES), and whether it has been shelled: rubble rooms, holes in the yard, smoke over it, breaches in its walls. */
  style?: Style;
  bombed?: boolean;
  /** Where a farm's guards lie in wait behind its hedgerows, out along the way in. */
  hides?: { x: number; z: number }[];
}

/** Which side of a compound a gate index means, as a unit step out of the yard. */
export const gateDir = (gate: number) => (gate === 0 ? { x: 1, z: 0 } : gate === 1 ? { x: -1, z: 0 } : gate === 2 ? { x: 0, z: 1 } : { x: 0, z: -1 });

/** Two compounds whose folders import each other, and how many files do. */
export interface Road { a: number; b: number; weight: number }

export interface CodeMap {
  terrain: Terrain;
  spawn: { x: number; z: number; yaw: number };
  compounds: Compound[];
  blocks: Block[];
  roads?: Road[];
  /** The footpath from HEAD to each compound's gate, by compound; cut into the terrain, drawn on the ground. */
  trails?: TrailPoint[][];
  /** The ramp graded out of each compound's gate, by compound. */
  ramps?: Ramp[];
  /** Smoke hanging over shelled ground: the bombed yards and the worst of the field. */
  smoke?: Smoke[];
  /** The shell holes blown into the ground (already in `terrain`; here for anything that wants to know where). */
  craters?: Stamp[];
}

/** How many of a shelled compound's rooms are rubble, holes in its yard, shell holes out in the field, and a hole's size. */
export const RUBBLE_SHARE = 0.4, YARD_CRATERS = 3, FIELD_CRATERS = 8, CRATER_R = 1.8, CRATER_DEPTH = 0.6, CRATER_SKIRT = 1.6;
/** A rubble file keeps this much of its height and lines. */
export const RUIN_LEFT = 0.3;
/** A farm's stone ring, hedgerows and a village's garden walls and sandbags, and a strongpoint's concrete, in metres. */
export const STONE_HEIGHT = 1.3, HEDGE_HEIGHT = 2.0, HEDGE_THICK = 1.0, HEDGE_GAP = 2.2, GARDEN_HEIGHT = 1.0, SANDBAG_HEIGHT = 0.9, CONCRETE_HEIGHT = 1.8, CONCRETE_THICK = 1.2, CASEMATE_HEIGHT = 3.2;

/** Which style a folder's compound is built in: the styles in turn round the level, started where the repo's name says, so every level has a mix. */
export const styleOf = (repo: string, i: number): Style => STYLES[(i + hashString(repo)) % STYLES.length]!;
/** Whether a compound has been shelled: a folder fought over lately (a fifth of the repo's churn), or two in five by its name. */
export const bombedOf = (folder: string, churn: number): boolean => churn >= 0.2 || hashString(`${folder}:shelled`) % 5 < 2;

/** Compounds a level holds at most, files shown in each, and crates out in the field. */
export const COMPOUNDS = 6, PER_COMPOUND = 14, CRATES = 36;
/** A compound's masonry, in metres: the curtain wall, its corner towers (the watchtower taller), the gate's pillars and opening, the inner wall and its doorway, the stair, and the orchard walls outside. */
export const WALL_THICK = 1.0, WALL_HEIGHT = 3.2, TOWER_HEIGHT = 5.0, WATCH_HEIGHT = 7.2, PILLAR_HEIGHT = 4.2, GATE_GAP = 1.9;
export const INNER_THICK = 0.6, INNER_HEIGHT = 2.4, DOOR_GAP = 2.2, STAIR_STEPS = 6, STAIR_PITCH = 0.8, ORCHARD_THICK = 0.5, ORCHARD_HEIGHT = 1.1;


export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** The folder a file counts toward: apps/x and packages/x are their own, anything else its top folder ("." for the root). */
export function folderOf(path: string): string {
  const parts = path.split("/");
  if (parts.length === 1) return ".";
  if ((parts[0] === "apps" || parts[0] === "packages") && parts.length > 2) return `${parts[0]}/${parts[1]}`;
  return parts[0]!;
}

/** Extra guards for a folder that has had this share of the repo's recent changes. */
export const churnGuards = (share: number) => (share >= 0.25 ? 2 : share >= 0.1 ? 1 : 0);

/** Whether a failing check is about this folder: its name has the folder's own name in it as a word. */
export function checkHits(folder: string, check: string): boolean {
  const name = folder.split("/").pop()!.toLowerCase();
  if (name === "." || name.length < 2) return false;
  return new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(check.toLowerCase());
}

/** The shape a file is built as, by what kind of file it is (rubble: one shelled down). Its hitbox is always its box. */
export type Structure = "tower" | "house" | "silo" | "bunker" | "stack" | "rubble";
/** What a file block is drawn as: its own shape if one was given, rubble if it's been shelled, else what its path says. */
export const shapeOf = (b: Block): Structure => b.shape ?? (b.ruin ? "rubble" : structureOf(b.path));

/** Tests dig in as bunkers, docs are houses, config and data are silos, styles and assets step up as stacks, code is a tower. */
export function structureOf(path: string): Structure {
  const p = path.toLowerCase(), name = p.split("/").pop()!;
  if (/(^|\/)(tests?|__tests__|spec)\//.test(p) || /\.(test|spec)\.[a-z]+$/.test(name)) return "bunker";
  if (/\.(md|mdx|txt|rst|adoc)$/.test(name) || /^(license|changelog|readme)/.test(name)) return "house";
  if (/\.(json|jsonc|ya?ml|toml|lock|ini|env|schema|xml|csv)$/.test(name) || /config\.[a-z]+$/.test(name)) return "silo";
  if (/\.(css|scss|sass|less|html|svg|png|jpe?g|gif|webp|ico|woff2?)$/.test(name)) return "stack";
  return "tower";
}

/** A block's height for its line count: a one-liner is a step, a 5000-line file a watchtower. */
export const heightOf = (lines: number) => Math.min(8, Math.round((0.6 + Math.sqrt(lines) * 0.13) * 10) / 10);
const footOf = (lines: number) => Math.round((1.3 + Math.min(1.7, lines / 500)) * 10) / 10;

/**
 * The steepest rise per metre a soldier walks up without sliding back (game.ts slides past 0.75,
 * and is a crawl well before that). Anything a level asks you to reach is reached on ground no steeper.
 */
export const WALK = 0.5;
/** The steepest ground a footpath is cut across (a cliff's edge): the path is then graded to WALK along its length. */
export const TRAIL_MAX = 1.1;
/** How wide the shelf cut along a footpath is, in metres. */
export const TRAIL_WIDTH = 3;

/** Ground that can be walked to from (sx, sz): a flood fill over a 2 m grid, no step steeper than `max` (WALK). */
export function reachable(t: Terrain, sx: number, sz: number, cell = 2, max = WALK): (x: number, z: number) => boolean {
  const n = Math.ceil((2 * t.R) / cell) + 1, seen = new Uint8Array(n * n);
  const at = (c: number, r: number) => t.height(-t.R + c * cell, -t.R + r * cell);
  const inside = (c: number, r: number) => len(-t.R + c * cell, -t.R + r * cell) < t.R - 2;
  const c0 = Math.round((sx + t.R) / cell), r0 = Math.round((sz + t.R) / cell), q = [r0 * n + c0];
  seen[r0 * n + c0] = 1;
  while (q.length) {
    const i = q.pop()!, c = i % n, r = (i - c) / n, h = at(c, r);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const cc = c + dc, rr = r + dr, j = rr * n + cc;
      if (cc < 0 || rr < 0 || cc >= n || rr >= n || seen[j] || !inside(cc, rr)) continue;
      if (Math.abs(at(cc, rr) - h) / cell > max) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return (x, z) => {
    const c = Math.round((x + t.R) / cell), r = Math.round((z + t.R) / cell);
    return c >= 0 && r >= 0 && c < n && r < n && seen[r * n + c] === 1;
  };
}

/**
 * The easiest footpath from one point to another: shortest over a 2 m grid, eight ways out of each
 * cell, with steep steps costing more and anything steeper than TRAIL_MAX (or under water, or `blocked`) off limits.
 * The path's profile is smoothed, then graded (cut into the hill or built up on a causeway) wherever
 * it still climbs faster than WALK, so the shelf along it is walkable end to end. Null if there's no way.
 */
export interface TrailRules {
  /** Cells a path may not cross (other yards). */
  blocked?: (x: number, z: number) => boolean;
  /** Cells on a path already cut: cheaper, so paths share a shelf. */
  cheap?: (x: number, z: number) => boolean;
  /** Cells just beside one: dear, so a path joins a shelf or keeps clear of it rather than re-cutting its edge. */
  beside?: (x: number, z: number) => boolean;
  /** Cells whose height is kept as it is when the path is graded (on a shelf already cut). */
  pinned?: (x: number, z: number) => boolean;
}

/** A point on a footpath, with the grid cell the search went through (the eased point sits a little off it). */
export interface TrailNode extends TrailPoint { gx: number; gz: number }

export function trail(t: Terrain, from: { x: number; z: number }, to: { x: number; z: number }, cell = 2, rules: TrailRules = {}): TrailNode[] | null {
  const { blocked, cheap, beside, pinned } = rules;
  const n = Math.ceil((2 * t.R) / cell) + 1, N = n * n;
  // Everything about a cell, worked out once: its height, and whether it's out of bounds, wet or blocked, cheap, beside.
  const hs = new Float32Array(N), off = new Uint8Array(N), cheapAt = new Uint8Array(N), besideAt = new Uint8Array(N);
  const pos = (i: number) => ({ x: -t.R + (i % n) * cell, z: -t.R + Math.floor(i / n) * cell });
  const index = (p: { x: number; z: number }) => Math.round((p.z + t.R) / cell) * n + Math.round((p.x + t.R) / cell);
  const start = index(from), goal = index(to);
  if (start < 0 || goal < 0 || start >= N || goal >= N) return null;
  for (let i = 0; i < N; i++) {
    const { x, z } = pos(i);
    hs[i] = t.height(x, z);
    off[i] = len(x, z) > t.R - 2 || (t.water !== undefined && hs[i]! < t.water) || (i !== goal && !!blocked?.(x, z)) ? 1 : 0;
    cheapAt[i] = cheap?.(x, z) ? 1 : 0;
    besideAt[i] = beside?.(x, z) ? 1 : 0;
  }
  // The search runs over (cell, way in): a bend costs extra, the sharper the more, so the path
  // sweeps round a hill in long legs rather than switching back on itself.
  const steps = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const, TURN = [0, 1.5, 5, 12, 24];
  const S = N * 8, dist = new Float64Array(S).fill(Infinity), prev = new Int32Array(S).fill(-1), done = new Uint8Array(S);
  // A binary heap of states by cost, in flat arrays: no allocation per step.
  let hc = new Float64Array(1 << 14), hv = new Int32Array(1 << 14), size = 0;
  const push = (cost: number, st: number) => {
    if (size === hc.length) {
      const c2 = new Float64Array(size * 2), v2 = new Int32Array(size * 2);
      c2.set(hc), v2.set(hv), hc = c2, hv = v2;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hc[p]! <= cost) break;
      hc[i] = hc[p]!, hv[i] = hv[p]!, i = p;
    }
    hc[i] = cost, hv[i] = st;
  };
  const pop = (): [number, number] => {
    const cost = hc[0]!, st = hv[0]!, lc = hc[--size]!, lv = hv[size]!;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = -1;
      if (l < size && hc[l]! < lc) m = l;
      if (r < size && hc[r]! < (m < 0 ? lc : hc[l]!)) m = r;
      if (m < 0) break;
      hc[i] = hc[m]!, hv[i] = hv[m]!, i = m;
    }
    if (size > 0) hc[i] = lc, hv[i] = lv;
    return [cost, st];
  };
  for (let d = 0; d < 8; d++) dist[start * 8 + d] = 0, push(0, start * 8 + d);
  let end = -1;
  while (size > 0) {
    const [d, st] = pop();
    if (done[st]) continue;
    done[st] = 1;
    const i = st >> 3, way = st & 7;
    if (i === goal) { end = st; break; }
    const c = i % n, r = (i - c) / n;
    for (let k = 0; k < 8; k++) {
      const [dc, dr] = steps[k]!, cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= n || rr >= n) continue;
      const j = rr * n + cc, sj = j * 8 + k;
      if (done[sj] || off[j]) continue;
      const len = cell * (dc && dr ? Math.SQRT2 : 1), grade = Math.abs(hs[j]! - hs[i]!) / len;
      if (grade > TRAIL_MAX) continue;
      const turn = Math.min(Math.abs(k - way), 8 - Math.abs(k - way));
      // A step along a path already cut costs less, so paths share a shelf rather than run beside each other.
      const nd = d + len * (1 + 8 * grade * grade + (grade > WALK ? 6 : 0)) * (cheapAt[j] ? 0.5 : 1) + TURN[turn]! + (!cheapAt[j] && besideAt[j] ? 30 : 0);
      if (nd < dist[sj]!) dist[sj] = nd, prev[sj] = st, push(nd, sj);
    }
  }
  if (end < 0) return null;
  const cells: number[] = [];
  for (let st = end; st >= 0; st = prev[st]!) cells.unshift(st >> 3);
  // Hairpins taken out (a path doubling back on itself within a cell would stack two heights on one
  // shelf), corners rounded off, then the heights along it smoothed so the shelf climbs evenly.
  const pts = cells.map(pos);
  for (let i = 1; i < pts.length - 1; i++) if (len(pts[i + 1]!.x - pts[i - 1]!.x, pts[i + 1]!.z - pts[i - 1]!.z) < cell * 1.5) pts.splice(i, 1), i--;
  const eased = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { x: (pts[i - 1]!.x + p.x * 2 + pts[i + 1]!.x) / 4, z: (pts[i - 1]!.z + p.z * 2 + pts[i + 1]!.z) / 4 }));
  let ys = eased.map((p) => t.height(p.x, p.z));
  for (let pass = 0; pass < 2; pass++) ys = ys.map((y, i) => (i === 0 || i === ys.length - 1 || pinned?.(pts[i]!.x, pts[i]!.z) ? y : (ys[i - 1]! + y * 2 + ys[i + 1]!) / 4));
  // Grade it: no step steeper than WALK, cutting or filling as needed. The ends stay on their ground,
  // and so does any stretch running by a path already cut, so it joins that shelf instead of re-cutting it.
  const fixed = pts.map((p, i) => i === 0 || i === pts.length - 1 || !!pinned?.(p.x, p.z));
  const run = (i: number) => len(eased[i]!.x - eased[i - 1]!.x, eased[i]!.z - eased[i - 1]!.z);
  const clampTo = (i: number, y: number, len: number) => (fixed[i] ? ys[i]! : (ys[i] = Math.max(y - WALK * len, Math.min(y + WALK * len, ys[i]!))));
  for (let pass = 0; pass < 40; pass++) {
    let moved = 0;
    for (let i = 1; i < ys.length - 1; i++) moved += Math.abs(ys[i]! - clampTo(i, ys[i - 1]!, run(i)));
    for (let i = ys.length - 2; i >= 1; i--) moved += Math.abs(ys[i]! - clampTo(i, ys[i + 1]!, run(i + 1)));
    if (moved < 0.01) break;
  }
  return eased.map((p, i) => ({ x: p.x, z: p.z, y: ys[i]!, gx: pts[i]!.x, gz: pts[i]!.z }));
}

/** Ground steeper than this slides a soldier back (game.ts's SLIDE). */
const SLIDE_AT = 0.75;

/** The steepest the ground climbs along a path, a half-metre step at a time. */
export function steepest(t: Terrain, path: { x: number; z: number }[]): number {
  let worst = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!, b = path[i]!, n = Math.max(1, Math.ceil(len(b.x - a.x, b.z - a.z) / 0.5));
    for (let k = 0; k < n; k++) {
      const x0 = a.x + ((b.x - a.x) * k) / n, z0 = a.z + ((b.z - a.z) * k) / n, x1 = a.x + ((b.x - a.x) * (k + 1)) / n, z1 = a.z + ((b.z - a.z) * (k + 1)) / n;
      worst = Math.max(worst, Math.abs(t.height(x1, z1) - t.height(x0, z0)) / (len(x1 - x0, z1 - z0) || 1));
    }
  }
  return worst;
}

/** Flat enough to build on: gentle at the centre and all round a ring of radius r. */
function flatDisc(t: Terrain, x: number, z: number, r: number, max: number): boolean {
  if (slope(t, x, z) > max) return false;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (Math.abs(t.height(px, pz) - t.height(x, z)) > r * 0.7) return false;
  }
  return true;
}

/** A graded way out of a gate: from (x, z) along (dx, dz) for `length` metres, its surface `ys` a metre apart, never steeper than RAMP. */
export interface Ramp { x: number; z: number; dx: number; dz: number; length: number; ys: number[] }
/** How steep a gate's ramp climbs or falls, rise per metre (under WALK, so it's an easy walk), how wide its top is, and how far it may run. */
export const RAMP = 0.35, RAMP_WIDTH = 6, RAMP_MAX = 40;

/**
 * The ramp out of one side of a compound, and what it costs: how far it runs before it settles on
 * the ground, plus what's left of a drop at its foot if it never does, with a little extra for facing
 * away from HEAD. Its surface follows the ground as close as RAMP lets it, from the yard's floor out,
 * riding over a bump or down a drop at that grade. A side whose ramp would cross another yard, run
 * off the disc or into water costs most.
 */
function rampOut(t: Terrain, c: Compound, gate: number, all: Compound[], spawn: { x: number; z: number }) {
  const g = gateDir(gate), h = c.half ?? c.r * 0.66;
  const x0 = c.x + g.x * h, z0 = c.z + g.z * h, ys = [t.height(c.x, c.z)];
  // At least a landing's worth past the yard's edge, so no other path runs by right across the gate.
  let length = Math.ceil(c.r - h) + 8, miss = 0, bad = false;
  for (let s = 1; s <= RAMP_MAX; s++) {
    const x = x0 + g.x * s, z = z0 + g.z * s, ground = t.height(x, z), prev = ys[s - 1]!;
    const y = Math.max(prev - RAMP, Math.min(prev + RAMP, ground)), off = Math.abs(ground - y);
    ys.push(y);
    if ((off > 0.05 || s < length) && (len(x, z) > t.R - 3 || wet(t, x, z) || all.some((o) => o !== c && len(x - o.x, z - o.z) < o.r + 2))) { bad = true; break; }
    if (off > 0.05) length = Math.max(length, s + 2), miss = off;
    else miss = 0;
  }
  length = Math.min(length, ys.length - 1);
  const facing = (g.x * (spawn.x - c.x) + g.z * (spawn.z - c.z)) / (len(spawn.x - c.x, spawn.z - c.z) || 1);
  return { cost: (bad ? 1000 : 0) + length + miss * 20 + (1 - facing) * 4, ramp: { x: x0, z: z0, dx: g.x, dz: g.z, length, ys: ys.slice(0, length + 1) } };
}

/** Whether (x, z) is on a ramp, or within `margin` of its top. */
function onRamp(r: Ramp, x: number, z: number, margin = 0): boolean {
  const px = x - r.x, pz = z - r.z, s = px * r.dx + pz * r.dz;
  return s >= 0 && s <= r.length && Math.abs(-px * r.dz + pz * r.dx) <= RAMP_WIDTH / 2 + margin;
}

/** Grades each ramp into the ground: along it the surface is the ramp's own, cut or built up, easing back to the ground either side. */
export function withRamps(t: Terrain, ramps: Ramp[], skirt = 3): Terrain {
  if (!ramps.length) return t;
  return {
    R: t.R,
    water: t.water,
    height(x, z) {
      let h = t.height(x, z);
      for (const r of ramps) {
        const px = x - r.x, pz = z - r.z, s = px * r.dx + pz * r.dz, a = Math.abs(-px * r.dz + pz * r.dx);
        if (s < 0 || s > r.length || a > RAMP_WIDTH / 2 + skirt) continue;
        const i = Math.min(r.length - 1, Math.floor(s)), u = s - i, graded = r.ys[i]! + (r.ys[i + 1]! - r.ys[i]!) * u;
        const k = a <= RAMP_WIDTH / 2 ? 0 : smooth((a - RAMP_WIDTH / 2) / skirt);
        h = graded + (h - graded) * k;
      }
      return h;
    },
  };
}

export function mapRepo(ground: Terrain, repo: RepoSnapshot, seed: number): CodeMap {
  const rand = mulberry32(seed ^ hashString(repo.name));
  const R = ground.R;

  // Candidate spots: walkable, dry, inside the disc. The spawn is the flattest one out near the rim.
  const spots: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < 1400; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * (R - 14);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, s = slope(ground, x, z);
    if (s < 0.5 && !wet(ground, x, z)) spots.push({ x, z, s });
  }
  if (!spots.length) throw new Error("no flat ground on this level");
  const rim = spots.filter((p) => len(p.x, p.z) > R * 0.55);
  const spawnAt = (rim.length ? rim : spots).reduce((a, b) => (b.s < a.s ? b : a));
  // Anywhere a footpath can be cut to counts as reachable: the trail does the rest.
  const canReach = reachable(ground, spawnAt.x, spawnAt.z, 2, TRAIL_MAX);
  const spawn = { x: spawnAt.x, z: spawnAt.z, yaw: Math.atan2(spawnAt.x, spawnAt.z) };

  // The biggest folders, by lines, become compounds.
  const byFolder = new Map<string, RepoFile[]>();
  for (const f of repo.files) {
    const k = folderOf(f.path);
    byFolder.set(k, [...(byFolder.get(k) ?? []), f]);
  }
  const ranked = [...byFolder.entries()]
    .map(([folder, files]) => ({ folder, files: files.sort((a, b) => b.lines - a.lines), lines: files.reduce((s, f) => s + f.lines, 0) }))
    .sort((a, b) => b.lines - a.lines || a.folder.localeCompare(b.folder));

  const allChurn = repo.files.reduce((s, f) => s + (f.churn ?? 0), 0);
  const compounds: Compound[] = [];
  const pads: Pad[] = [];
  const taken: { x: number; z: number; r: number }[] = [{ x: spawn.x, z: spawn.z, r: 30 }];
  for (const f of ranked) {
    if (compounds.length >= COMPOUNDS) break;
    const shown = f.files.slice(0, PER_COMPOUND);
    const r = Math.min(16, 8 + Math.sqrt(shown.length) * 1.9);
    // Farthest-point: of the spots that fit, the one farthest from everything already placed.
    let best: { x: number; z: number } | null = null, bestGap = 0;
    for (const p of spots) {
      if (len(p.x, p.z) > R - r - 6 || !canReach(p.x, p.z)) continue;
      let gap = Infinity;
      for (const o of taken) gap = Math.min(gap, len(p.x - o.x, p.z - o.z) - o.r - r);
      if (gap > 8 && gap > bestGap && flatDisc(ground, p.x, p.z, r, 0.45)) best = p, bestGap = gap;
    }
    if (!best) continue;
    const churn = allChurn ? Math.round((f.files.reduce((s, x) => s + (x.churn ?? 0), 0) / allChurn) * 100) / 100 : 0;
    const guards = 2 + Math.min(3, Math.floor(f.lines / 6000)) + churnGuards(churn);
    const burning = (repo.failing ?? []).some((check) => checkHits(f.folder, check));
    const style = styleOf(repo.name, compounds.length), bombed = bombedOf(f.folder, churn);
    compounds.push({ folder: f.folder, x: best.x, z: best.z, r, files: f.files.length, lines: f.lines, guards, churn, burning, half: Math.round(r * (style === "farm" ? 0.58 : 0.66) * 10) / 10, style, bombed });
    pads.push({ x: best.x, z: best.z, r });
    taken.push({ x: best.x, z: best.z, r });
  }

  // Each gate opens on the side with the easiest way out (never onto a drop), the side facing HEAD
  // when two are as easy, and a ramp is graded out of it down (or up) to the ground round about.
  // HEAD sits on a level pad of its own, so the paths all leave it from flat ground.
  const padded0 = withPads(ground, [...pads, { x: spawn.x, z: spawn.z, r: 5 }]), ramps: Ramp[] = [];
  for (const c of compounds) {
    const ways = [0, 1, 2, 3].map((gate) => ({ gate, ...rampOut(padded0, c, gate, compounds, spawn) }));
    const way = ways.reduce((a, b) => (b.cost < a.cost ? b : a));
    c.gate = way.gate;
    ramps.push(way.ramp);
  }
  const padded = withRamps(padded0, ramps);
  // A footpath from HEAD to each gate, cut into the hill, keeping out of every other yard and coming
  // into its own only down the lane in front of the gate: every compound can be walked to. Each path is
  // found on the ground with the paths before it already cut, and prefers their shelves, so where they
  // run together they share one surface.
  const trails: TrailNode[][] = [];
  const cell = 2, n = Math.ceil((2 * R) / cell) + 1, cut = new Uint8Array(n * n), by = new Uint8Array(n * n);
  const cellOf = (x: number, z: number) => Math.round((z + R) / cell) * n + Math.round((x + R) / cell);
  // How near the nearest shelf already cut each metre of ground is: a later path leaves those shelves as they are.
  const m1 = Math.ceil(2 * R) + 1, nearCut = new Float32Array(m1 * m1).fill(Infinity);
  const keeper = (near: Float32Array) => (x: number, z: number) => {
    const c = Math.round(x + R), r = Math.round(z + R);
    if (c < 0 || r < 0 || c >= m1 || r >= m1) return 0;
    const d = near[r * m1 + c]!, inner = TRAIL_WIDTH / 2 + 0.3, outer = TRAIL_WIDTH / 2 + 3;
    return d <= inner ? 1 : d >= outer ? 0 : 1 - (d - inner) / (outer - inner);
  };
  const rules: TrailRules = {
    cheap: (x, z) => cut[cellOf(x, z)] === 1,
    beside: (x, z) => by[cellOf(x, z)] === 1,
    // On a shelf already cut, a later path keeps that ground's heights, so it joins or leaves it without a step.
    pinned: (x, z) => cut[cellOf(x, z)] === 1,
  };
  let terrain = padded;
  compounds.forEach((c, ci) => {
    const g = gateDir(c.gate!), h = c.half!;
    const blocked = (x: number, z: number) => compounds.some((o, oi) => {
      const d = len(x - o.x, z - o.z);
      // Another yard, or the ramp out of its gate: a path across that would cut a shelf through the way in.
      if (oi !== ci) return d < o.r + 2 || onRamp(ramps[oi]!, x, z, 2);
      const along = (x - c.x) * g.x + (z - c.z) * g.z, across = Math.abs(-(x - c.x) * g.z + (z - c.z) * g.x);
      return d < c.r + 1 && !(along > h + 1.5 && across < 2.4);
    });
    // The path is cut to the ramp's foot, kept off the ramp itself, and the ramp is its last leg up to the gate.
    const ramp = ramps[ci]!, foot = ramp.length - 1;
    const offRamp = (x: number, z: number) => {
      const s = (x - ramp.x) * ramp.dx + (z - ramp.z) * ramp.dz;
      return blocked(x, z) || (s < foot - 2 && onRamp(ramp, x, z, 2));
    };
    const up: TrailNode[] = [];
    for (let s = foot; ; s = Math.max(2.5, s - 2)) {
      const x = ramp.x + ramp.dx * s, z = ramp.z + ramp.dz * s;
      up.push({ x, z, y: terrain.height(x, z), gx: x, gz: z });
      if (s === 2.5) break;
    }
    const toFoot = trail(terrain, spawn, up[0]!, cell, { ...rules, blocked: offRamp });
    const path = toFoot ? [...toFoot.slice(0, -1), ...up] : trail(terrain, spawn, { x: c.x + g.x * (h + 2.5), z: c.z + g.z * (h + 2.5) }, cell, { ...rules, blocked }) ?? [];
    trails.push(path);
    if (path.length < 2) return;
    // The shelves cut so far (a copy: this layer must not see its own, nor the ones after it).
    terrain = withTrails(terrain, [path], TRAIL_WIDTH, 3, keeper(nearCut.slice()));
    const near = TRAIL_WIDTH + 2, reach = TRAIL_WIDTH + 3;
    for (let i = 0; i + 1 < path.length; i++) {
      // Every metre of ground within reach of this segment remembers how near it is.
      const a = path[i]!, b = path[i + 1]!, ex = b.x - a.x, ez = b.z - a.z, L = ex * ex + ez * ez || 1;
      for (let r = Math.max(0, Math.floor(Math.min(a.z, b.z) + R - reach)); r <= Math.min(m1 - 1, Math.ceil(Math.max(a.z, b.z) + R + reach)); r++) {
        for (let c = Math.max(0, Math.floor(Math.min(a.x, b.x) + R - reach)); c <= Math.min(m1 - 1, Math.ceil(Math.max(a.x, b.x) + R + reach)); c++) {
          const x = c - R, z = r - R, u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L)), d = len(x - a.x - ex * u, z - a.z - ez * u);
          if (d < nearCut[r * m1 + c]!) nearCut[r * m1 + c] = d;
        }
      }
    }
    for (const p of path) {
      // The cells the search went through: a later path through the same ones eases to the same line.
      cut[cellOf(p.gx, p.gz)] = 1;
      for (let dz = -reach; dz <= reach; dz += cell) for (let dx = -reach; dx <= reach; dx += cell) if (len(dx, dz) <= near) by[cellOf(p.gx + dx, p.gz + dz)] = 1;
    }
  });
  // Where paths fork, each shelf was cut at its own height and the ground between can be a scramble.
  // A last pass over the steep spots: each path's heights read off the finished ground, graded again to
  // WALK, and cut once more, all together, wherever the ground along it still climbs faster than SLIDE.
  const regraded = trails.map((path) => {
    const ys = path.map((p) => terrain.height(p.x, p.z));
    for (let pass = 0; pass < 20; pass++) for (let i = 1; i < ys.length; i++) {
      const run = len(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z);
      ys[i] = Math.max(ys[i - 1]! - WALK * run, Math.min(ys[i - 1]! + WALK * run, ys[i]!));
    }
    return path.map((p, i) => ({ x: p.x, z: p.z, y: ys[i]! }));
  });
  if (regraded.some((path) => steepest(terrain, path) > SLIDE_AT)) terrain = withTrails(terrain, regraded, TRAIL_WIDTH, 3);
  const onTrail = (x: number, z: number, within: number) => trails.some((t) => t.some((p) => len(p.x - x, p.z - z) < within));
  const blocks: Block[] = [];
  const walls: Block[] = [];
  const overlaps = (x: number, z: number, w: number, d: number, gap: number, among: Block[] = [...blocks, ...walls]) =>
    among.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + gap && Math.abs(b.z - z) < (b.d + d) / 2 + gap);

  // Each compound is built in its style (styleOf), all of it from wall blocks (solid, nothing to raze), told
  // apart for drawing by what they're made of:
  //   qalat    the mud fort the Afghan highlands are dotted with: thick curtain walls round a square, a tower at
  //            every corner (the one farthest from the gate tallest, a watchtower), a gate flanked by pillars, an
  //            inner wall cutting off a back courtyard with its own doorway, a stair up onto the wall walk, and
  //            low orchard walls outside the gate for the way in
  //   farm     a bocage farm: a waist-high field-stone ring you jump at to mantle over, a back way out, a hedgerow
  //            across the yard, hedgerows out along the lane in with the ambush lying behind them, and the biggest
  //            file as the barn
  //   village  no wall to speak of: short runs of garden wall all round with gaps between, sandbags either side of
  //            the way in and on the back corners, the biggest file a church tower over the square
  //   bunker   a strongpoint: poured concrete, low and thick (you mantle it), an open gate, and a casemate across
  //            the back the files dig in in front of
  // A shelled compound (bombedOf) has a breach knocked through its wall with the rubble piled low in the gap,
  // some of its rooms down to rubble, shell holes in its yard and smoke hanging over the worst of it.
  compounds.forEach((c, ci) => {
    const y = terrain.height(c.x, c.z), h = c.half!, t = WALL_THICK, gap = GATE_GAP, g = gateDir(c.gate!), across = { x: -g.z, z: g.x };
    const wall = (x: number, z: number, w: number, d: number, bh: number, stuff: Stuff = "mud") => walls.push({ path: `${c.folder}/wall`, lines: 0, compound: ci, x, z, y, w, d, h: bh, wall: true, stuff });
    const along = (k: number, a = 0) => ({ x: c.x + g.x * k + across.x * a, z: c.z + g.z * k + across.z * a });
    /** A run of wall along one side (0 +x, 1 -x, 2 +z, 3 -z) `half` out from the centre, with openings `wide` either way of each offset in `gaps`. */
    const run = (side: number, half: number, bh: number, thick: number, stuff: Stuff, gaps: number[] = [], wide = GATE_GAP) => {
      const alongX = side >= 2, sign = side % 2 === 0 ? 1 : -1;
      const cx = alongX ? c.x : c.x + sign * half, cz = alongX ? c.z + sign * half : c.z, from = -half + 1.35, to = half - 1.35;
      let at = from;
      for (const o of [...gaps].sort((a, b) => a - b).concat(Infinity)) {
        const end = Math.min(to, o - wide), l = end - at;
        if (l > 0.4) alongX ? wall(cx + (at + end) / 2, cz, l, thick, bh, stuff) : wall(cx, cz + (at + end) / 2, thick, l, bh, stuff);
        at = Math.max(at, o + wide);
        if (at >= to) break;
      }
    };
    const back = c.gate! ^ 1, breach = c.bombed ? (rand() - 0.5) * (h - 3) : NaN;
    /** The rubble of a breached wall, piled low across the gap. */
    const pile = (side: number, o: number, thick: number, stuff: Stuff) => {
      const alongX = side >= 2, sign = side % 2 === 0 ? 1 : -1;
      alongX ? wall(c.x + o, c.z + sign * h, 2.6, thick + 0.6, 0.7, stuff) : wall(c.x + sign * h, c.z + o, thick + 0.6, 2.6, 0.7, stuff);
    };
    const style = c.style ?? "qalat";
    if (style === "qalat") {
      for (let side = 0; side < 4; side++) {
        const alongX = side >= 2, sign = side % 2 === 0 ? 1 : -1;
        const cx = alongX ? c.x : c.x + sign * h, cz = alongX ? c.z + sign * h : c.z;
        if (side === c.gate) {
          // Gate pillars either side of the opening, the curtain wall running on from them.
          const len = h * 2 - 2.7, pillar = 1.1, seg = (len - (gap + pillar + 0.05) * 2) / 2;
          const put = (off: number, l: number) => (alongX ? wall(cx + off, cz, l, t, WALL_HEIGHT) : wall(cx, cz + off, t, l, WALL_HEIGHT));
          put(-(gap + pillar + 0.05 + seg / 2), seg), put(gap + pillar + 0.05 + seg / 2, seg);
          for (const sgn of [-1, 1]) alongX ? wall(cx + sgn * (gap + pillar / 2), cz, pillar, t + 0.5, PILLAR_HEIGHT) : wall(cx, cz + sgn * (gap + pillar / 2), t + 0.5, pillar, PILLAR_HEIGHT);
        } else if (c.bombed && side === back) run(side, h, WALL_HEIGHT, t, "mud", [breach], 1.4), pile(side, breach, t, "mud");
        else run(side, h, WALL_HEIGHT, t, "mud");
      }
      // Corner towers; the back corner on the stair's side is the watchtower. Shelled, the tower by the breach is a stump.
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const watch = sx * g.x + sz * g.z < 0 && sx * across.x + sz * across.z > 0, stump = c.bombed && sx * g.x + sz * g.z < 0 && !watch;
        wall(c.x + sx * h, c.z + sz * h, 2.6, 2.6, stump ? 1.6 : watch ? WATCH_HEIGHT : TOWER_HEIGHT);
      }
      // The inner wall: across the yard a third of the way from the back, a doorway off to one side.
      const innerK = -h * 0.35, inner = along(innerK), span = h * 2 - t * 2 - 0.2, door = DOOR_GAP, doorAt = -h * 0.4;
      const innerSeg = (from: number, to: number) => {
        const mid = (from + to) / 2, l = to - from;
        if (l <= 0.4) return;
        g.x !== 0 ? wall(inner.x, inner.z + across.z * mid, INNER_THICK, l, INNER_HEIGHT) : wall(inner.x + across.x * mid, inner.z, l, INNER_THICK, INNER_HEIGHT);
      };
      innerSeg(-span / 2, doorAt - door / 2), innerSeg(doorAt + door / 2, span / 2);
      // A stair up onto the wall walk: steps against the inside of the watchtower's side wall, climbing from the gate end towards the inner wall.
      const inset = h - t / 2 - 0.55;
      for (let i = 0; i < STAIR_STEPS; i++) {
        const k = innerK + INNER_THICK / 2 + 0.7 + (STAIR_STEPS - 1 - i) * STAIR_PITCH, p = along(k), rise = (WALL_HEIGHT * (i + 1)) / (STAIR_STEPS + 1);
        const x = p.x + across.x * inset, z = p.z + across.z * inset;
        g.x !== 0 ? wall(x, z, STAIR_PITCH - 0.04, 1.0, rise) : wall(x, z, 1.0, STAIR_PITCH - 0.04, rise);
      }
      // Orchard walls outside the gate: low mud walls either side of the way in, cover for the approach,
      // clear of the gate's own width and kept on the compound's level ground.
      if (c.r >= 11) {
        const out = along(Math.min(c.r - 2.5, h + 4)), span = h * 0.6;
        for (const sgn of [-1, 1]) {
          const side = GATE_GAP + 0.6 + span / 2, x = out.x + across.x * sgn * side, z = out.z + across.z * sgn * side;
          if (len(x - c.x + across.x * sgn * (span / 2), z - c.z + across.z * sgn * (span / 2)) > c.r - 1) continue;
          g.x !== 0 ? wall(x, z, ORCHARD_THICK, span, ORCHARD_HEIGHT) : wall(x, z, span, ORCHARD_THICK, ORCHARD_HEIGHT);
        }
      }
    } else if (style === "farm") {
      // The stone ring, a post at each corner, the gate in front and a back way out behind.
      for (let side = 0; side < 4; side++) {
        if (c.bombed && side !== c.gate && side !== back && side === (c.gate! < 2 ? 2 : 0)) run(side, h, STONE_HEIGHT, 0.6, "stone", [breach], 1.4), pile(side, breach, 0.6, "stone");
        else run(side, h, STONE_HEIGHT, 0.6, "stone", side === c.gate || side === back ? [0] : [], side === c.gate ? gap : 1.3);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) wall(c.x + sx * h, c.z + sz * h, 0.9, 0.9, STONE_HEIGHT + 0.4, "stone");
      /** A hedgerow from a point out along a direction, a gap in it every few metres to slip through, kept on the level ground. */
      const hedge = (from: { x: number; z: number }, dir: { x: number; z: number }, span: number) => {
        for (let s = 0; s < span; s += 7) {
          const l = Math.min(7 - HEDGE_GAP, span - s);
          if (l < 1.5) break;
          const mx = from.x + dir.x * (s + l / 2), mz = from.z + dir.z * (s + l / 2);
          if (len(from.x + dir.x * (s + l) - c.x, from.z + dir.z * (s + l) - c.z) > c.r - 0.3) break;
          dir.x !== 0 ? wall(mx, mz, l, HEDGE_THICK, HEDGE_HEIGHT, "hedge") : wall(mx, mz, HEDGE_THICK, l, HEDGE_HEIGHT, "hedge");
        }
      };
      // One across the yard behind the barn's line with a gap off to one side, and two out along the lane in.
      const row = -h * 0.3, span = h - 0.6 - 0.35;
      hedge(along(row, -span), { x: across.x, z: across.z }, span - HEDGE_GAP / 2 - 1.2);
      hedge(along(row, 1.2 + HEDGE_GAP / 2), { x: across.x, z: across.z }, span - HEDGE_GAP / 2 - 1.2);
      const lane = 4.2;
      for (const sgn of [-1, 1]) hedge(along(h + 0.8, sgn * lane), g, c.r - h - 2.2);
      // The ambush lies behind the lane's hedges, the ring at its back, so you walk between them on the way in.
      c.hides = [-1, 1].map((sgn) => along(h + 2.2, sgn * (lane + HEDGE_THICK / 2 + 1.0)));
    } else if (style === "village") {
      // Garden walls in short runs all round, a gap every few metres, the way in open; sandbags by it and on the back corners.
      for (let side = 0; side < 4; side++) {
        const gaps: number[] = [];
        for (let o = -h + 4.5; o < h - 2.5; o += 6) gaps.push(o);
        if (side === c.gate) gaps.push(0);
        run(side, h, GARDEN_HEIGHT, 0.4, "stone", gaps, side === c.gate ? gap : 1.1);
      }
      const bags = (p: { x: number; z: number }, longAcross: boolean) => (longAcross === (g.x !== 0) ? wall(p.x, p.z, 0.8, 2.6, SANDBAG_HEIGHT, "sandbag") : wall(p.x, p.z, 2.6, 0.8, SANDBAG_HEIGHT, "sandbag"));
      for (const sgn of [-1, 1]) bags(along(h - 1.8, sgn * 3.4), false);
      for (const sgn of [-1, 1]) bags(along(-h + 1.8, sgn * (h - 1.8)), true);
    } else {
      // Poured concrete, low and thick, the gate open and (shelled) a hole in the back; a casemate across the back.
      for (let side = 0; side < 4; side++) {
        if (side === c.gate) run(side, h, CONCRETE_HEIGHT, CONCRETE_THICK, "concrete", [0], gap);
        else if (c.bombed && side === back) run(side, h, CONCRETE_HEIGHT, CONCRETE_THICK, "concrete", [breach], 1.6), pile(side, breach, CONCRETE_THICK, "concrete");
        else run(side, h, CONCRETE_HEIGHT, CONCRETE_THICK, "concrete");
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) wall(c.x + sx * h, c.z + sz * h, 2.2, 2.2, CONCRETE_HEIGHT + 0.6, "concrete");
      const cm = along(-h + CONCRETE_THICK / 2 + 2.1), long = Math.min(10, h * 1.1);
      g.x !== 0 ? wall(cm.x, cm.z, 3.2, long, CASEMATE_HEIGHT, "concrete") : wall(cm.x, cm.z, long, 3.2, CASEMATE_HEIGHT, "concrete");
    }
  });

  // Inside, the biggest files are rooms built against the walls, the rest spiral out from the courtyard, leaving the way from the gate clear.
  // A farm's biggest file is its barn, a village's its church tower, a strongpoint's files dig in low.
  compounds.forEach((c, ci) => {
    const files = byFolder.get(c.folder)!.slice(0, PER_COMPOUND), style = c.style ?? "qalat";
    const g = gateDir(c.gate!), across = { x: -g.z, z: g.x }, h = c.half!;
    const inGateLane = (dx: number, dz: number, w: number) => dx * g.x + dz * g.z > 0 && Math.abs(dx * across.x + dz * across.z) < 2.6 + w / 2;
    const place = (f: RepoFile, x: number, z: number, w: number, d: number, tall = heightOf(f.lines), shape?: Structure): boolean => {
      const dx = x - c.x, dz = z - c.z, roomX = h - w / 2 - WALL_THICK / 2 - 0.3, roomZ = h - d / 2 - WALL_THICK / 2 - 0.3;
      if (Math.abs(dx) > roomX || Math.abs(dz) > roomZ || inGateLane(dx, dz, w) || overlaps(x, z, w, d, 1.2, blocks) || overlaps(x, z, w, d, 0.2, walls)) return false;
      const b: Block = { path: f.path, lines: f.lines, compound: ci, x, z, y: terrain.height(c.x, c.z), w, d, h: style === "bunker" ? Math.min(2.0, tall) : tall, agent: (f.agent ?? 0) >= 0.5 };
      if (shape) b.shape = shape;
      else if (style === "bunker") b.shape = "bunker";
      // Shelled: some rooms are down to rubble, a low broken slab with a few lines left in it.
      if (c.bombed && !shape && rand() < RUBBLE_SHARE) b.ruin = true, b.h = Math.max(0.45, Math.round(b.h * RUIN_LEFT * 10) / 10), b.lines = Math.round(f.lines * RUIN_LEFT), b.shape = undefined;
      blocks.push(b);
      return true;
    };
    let slot = 0, rest = files;
    const first = files[0];
    if (first && style === "farm") {
      // The barn: long across the back of the yard, in front of the hedgerow.
      const foot = footOf(first.lines), long = Math.min(h * 0.9, foot * 2.2), p = { x: c.x - g.x * h * 0.62, z: c.z - g.z * h * 0.62 };
      if (place(first, p.x, p.z, g.x !== 0 ? foot * 1.1 : long, g.x !== 0 ? long : foot * 1.1, Math.min(4.5, heightOf(first.lines) + 1), "house")) rest = files.slice(1);
    } else if (first && style === "village") {
      // The church: the tallest thing in the village, over the back of the square.
      const foot = footOf(first.lines), p = { x: c.x - g.x * h * 0.5, z: c.z - g.z * h * 0.5 };
      if (place(first, p.x, p.z, foot, foot, Math.min(10, Math.round(heightOf(first.lines) * 1.6 * 10) / 10), "tower")) rest = files.slice(1);
    }
    for (const f of rest) {
      const w = footOf(f.lines), d = footOf(f.lines);
      // Rooms along the back wall and the two side walls, a slot at a time, until there's no room left.
      let placed = false;
      for (let tries = 0; tries < 12 && !placed; tries++, slot++) {
        const side = slot % 3, k = Math.floor(slot / 3), off = (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 3.2;
        const inset = h - WALL_THICK / 2 - 0.45 - w / 2;
        const x = side === 0 ? c.x - g.x * inset + across.x * off : c.x + across.x * (side === 1 ? 1 : -1) * inset + g.x * off;
        const z = side === 0 ? c.z - g.z * inset + across.z * off : c.z + across.z * (side === 1 ? 1 : -1) * inset + g.z * off;
        placed = place(f, x, z, w, d);
      }
      for (let i = 0; i < 90 && !placed; i++) {
        const a = i * 2.39996, dist = 3.5 + Math.sqrt(i) * 1.7;
        if (dist > h * 1.4) break;
        placed = place(f, c.x + Math.cos(a) * dist, c.z + Math.sin(a) * dist, w, d);
      }
    }
  });

  // Shell holes: a few in every shelled yard, clear of its rooms and the lane in, and more out across the field, clear
  // of everything and the paths (the ground is re-cut round them below, so nothing was built where one dips).
  const craters: Stamp[] = [];
  const hole = (x: number, z: number, r: number, depth: number) => craters.push({ kind: "crater", x, z, r, h: depth, falloff: CRATER_SKIRT });
  const roomFor = (x: number, z: number, reach: number) =>
    ![...blocks, ...walls].some((b) => Math.abs(b.x - x) < b.w / 2 + reach && Math.abs(b.z - z) < b.d / 2 + reach) && !onTrail(x, z, reach + 1) && !craters.some((k) => "x" in k && len(k.x - x, k.z - z) < reach * 2);
  compounds.forEach((c) => {
    if (!c.bombed) return;
    const g = gateDir(c.gate!), across = { x: -g.z, z: g.x }, h = c.half!;
    for (let tries = 0, n = 0; tries < 40 && n < YARD_CRATERS; tries++) {
      const k = (rand() - 0.5) * 2 * (h - 2.5), a = (rand() - 0.5) * 2 * (h - 2.5);
      if (k > 0 && Math.abs(a) < 3) continue;
      const x = c.x + g.x * k + across.x * a, z = c.z + g.z * k + across.z * a;
      if (!roomFor(x, z, CRATER_R + CRATER_SKIRT)) continue;
      hole(x, z, CRATER_R, CRATER_DEPTH), n++;
    }
  });
  const yardHoles = craters.length;

  // Everything else is crates in the field, kept off the spawn and out of the compounds.
  const loose = ranked.filter((f) => !compounds.some((c) => c.folder === f.folder)).flatMap((f) => f.files);
  for (const f of loose.slice(0, CRATES)) {
    const w = Math.min(2.4, footOf(f.lines)), d = w, h = Math.min(2.2, heightOf(f.lines));
    for (let tries = 0; tries < 40; tries++) {
      const p = spots[Math.floor(rand() * spots.length)]!;
      if (taken.some((o) => len(p.x - o.x, p.z - o.z) < o.r + 3) || overlaps(p.x, p.z, w, d, 2) || onTrail(p.x, p.z, w / 2 + 2.5)) continue;
      // Sat on its lowest corner so it never floats on a slope.
      const y = Math.min(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => terrain.height(p.x + (sx! * w) / 2, p.z + (sz! * d) / 2)));
      blocks.push({ path: f.path, lines: f.lines, compound: -1, x: p.x, z: p.z, y, w, d, h, agent: (f.agent ?? 0) >= 0.5 });
      break;
    }
  }
  for (let n = 0, tries = 0; n < FIELD_CRATERS && tries < 240; tries++) {
    const p = spots[Math.floor(rand() * spots.length)]!, r = CRATER_R * (1 + rand() * 0.6);
    if (taken.some((o) => len(p.x - o.x, p.z - o.z) < o.r + 4) || len(p.x, p.z) > R - r - 6 || slope(terrain, p.x, p.z) > 0.3 || !roomFor(p.x, p.z, r + CRATER_SKIRT)) continue;
    hole(p.x, p.z, r, CRATER_DEPTH * (1 + rand() * 0.5)), n++;
  }
  // The finished ground baked onto a half-metre grid: the battle reads it a hundred thousand times a second.
  terrain = baked(withStamps(terrain, craters));

  // Smoke hangs over the rubble of each shelled yard, and over every third shell hole out in the field.
  const smoke: Smoke[] = [];
  compounds.forEach((c, ci) => {
    if (!c.bombed) return;
    const ruins = blocks.filter((b) => b.compound === ci && b.ruin);
    const x = ruins.length ? ruins.reduce((s, b) => s + b.x, 0) / ruins.length : c.x, z = ruins.length ? ruins.reduce((s, b) => s + b.z, 0) / ruins.length : c.z;
    smoke.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, r: Math.max(4, Math.round(c.half! * 0.5 * 10) / 10) });
  });
  craters.slice(yardHoles).forEach((k, i) => { if (i % 3 === 0 && "x" in k) smoke.push({ x: k.x, z: k.z, r: 7 }); });

  blocks.push(...walls);

  // Roads: one between each pair of compounds whose folders import each other.
  const at = new Map(compounds.map((c, i) => [c.folder, i]));
  const roads: Road[] = [];
  for (const [fa, fb, weight] of repo.links ?? []) {
    const a = at.get(fa), b = at.get(fb);
    if (a !== undefined && b !== undefined) roads.push(a < b ? { a, b, weight } : { a: b, b: a, weight });
  }
  roads.sort((p, q) => p.a - q.a || p.b - q.b);
  return { terrain, spawn, compounds, blocks, roads, trails, ramps, smoke, craters };
}
