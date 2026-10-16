// A repo laid onto a piece of ground, the way codeSplitter's code city lays a
// person's repos onto streets (apps/codesplitter/src/city.ts), but as a battlefield:
//   - the biggest folders are enemy compounds, cut level into the ground, each held by guards
//   - a compound's files are its buildings: height is line count, so a 2000-line file is a tower to fight round
//   - files from everywhere else are crates scattered across the field, cover between you and them
//   - folders that import each other are joined by roads; a folder that changed a lot lately holds more guards
//   - a file agents mostly wrote is black glass, not paper (codeSplitter's city does this); a failing check sets its compound on fire
//   - a footpath is cut from HEAD to every compound's gate, so each one can be walked to, however high it sits
// The same repo on the same ground with the same seed is always the same level.

import { slope, wet, withPads, withTrails, type Pad, type Terrain, type TrailPoint } from "@rustybuns/terrain";
import { mulberry32 } from "@rustybuns/util";
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
  /** Part of a compound's mud-brick wall or a corner tower, not a file: solid, but nothing to raze. */
  wall?: boolean;
}

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
}

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

/** The shape a file is built as, by what kind of file it is. Its hitbox is always its box. */
export type Structure = "tower" | "house" | "silo" | "bunker" | "stack";

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
  const inside = (c: number, r: number) => Math.hypot(-t.R + c * cell, -t.R + r * cell) < t.R - 2;
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
  const hs = new Float32Array(N);
  const pos = (i: number) => ({ x: -t.R + (i % n) * cell, z: -t.R + Math.floor(i / n) * cell });
  for (let i = 0; i < N; i++) {
    const p = pos(i);
    hs[i] = t.height(p.x, p.z);
  }
  const index = (p: { x: number; z: number }) => Math.round((p.z + t.R) / cell) * n + Math.round((p.x + t.R) / cell);
  const start = index(from), goal = index(to);
  if (start < 0 || goal < 0 || start >= N || goal >= N) return null;
  // The search runs over (cell, way in): a bend costs extra, the sharper the more, so the path
  // sweeps round a hill in long legs rather than switching back on itself.
  const steps = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]] as const, TURN = [0, 1.5, 5, 12, 24];
  const S = N * 8, dist = new Float64Array(S).fill(Infinity), prev = new Int32Array(S).fill(-1), done = new Uint8Array(S);
  // A binary heap of [cost, state].
  const heap: [number, number][] = [];
  const push = (e: [number, number]) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!], i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!], i = m;
      }
    }
    return top;
  };
  for (let d = 0; d < 8; d++) dist[start * 8 + d] = 0, push([0, start * 8 + d]);
  let end = -1;
  while (heap.length) {
    const [d, st] = pop();
    if (done[st]) continue;
    done[st] = 1;
    const i = st >> 3, way = st & 7;
    if (i === goal) { end = st; break; }
    const c = i % n, r = (i - c) / n;
    for (let k = 0; k < 8; k++) {
      const [dc, dr] = steps[k]!, cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= n || rr >= n) continue;
      const j = rr * n + cc, sj = j * 8 + k, p = pos(j);
      if (done[sj] || Math.hypot(p.x, p.z) > t.R - 2 || wet(t, p.x, p.z) || (j !== goal && blocked?.(p.x, p.z))) continue;
      const len = cell * Math.hypot(dc, dr), grade = Math.abs(hs[j]! - hs[i]!) / len;
      if (grade > TRAIL_MAX) continue;
      const turn = Math.min(Math.abs(k - way), 8 - Math.abs(k - way));
      // A step along a path already cut costs less, so paths share a shelf rather than run beside each other.
      const nd = d + len * (1 + 8 * grade * grade + (grade > WALK ? 6 : 0)) * (cheap?.(p.x, p.z) ? 0.5 : 1) + TURN[turn]! + (!cheap?.(p.x, p.z) && beside?.(p.x, p.z) ? 30 : 0);
      if (nd < dist[sj]!) dist[sj] = nd, prev[sj] = st, push([nd, sj]);
    }
  }
  if (end < 0) return null;
  const cells: number[] = [];
  for (let st = end; st >= 0; st = prev[st]!) cells.unshift(st >> 3);
  // Hairpins taken out (a path doubling back on itself within a cell would stack two heights on one
  // shelf), corners rounded off, then the heights along it smoothed so the shelf climbs evenly.
  const pts = cells.map(pos);
  for (let i = 1; i < pts.length - 1; i++) if (Math.hypot(pts[i + 1]!.x - pts[i - 1]!.x, pts[i + 1]!.z - pts[i - 1]!.z) < cell * 1.5) pts.splice(i, 1), i--;
  const eased = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { x: (pts[i - 1]!.x + p.x * 2 + pts[i + 1]!.x) / 4, z: (pts[i - 1]!.z + p.z * 2 + pts[i + 1]!.z) / 4 }));
  let ys = eased.map((p) => t.height(p.x, p.z));
  for (let pass = 0; pass < 2; pass++) ys = ys.map((y, i) => (i === 0 || i === ys.length - 1 || pinned?.(pts[i]!.x, pts[i]!.z) ? y : (ys[i - 1]! + y * 2 + ys[i + 1]!) / 4));
  // Grade it: no step steeper than WALK, cutting or filling as needed. The ends stay on their ground,
  // and so does any stretch running by a path already cut, so it joins that shelf instead of re-cutting it.
  const fixed = pts.map((p, i) => i === 0 || i === pts.length - 1 || !!pinned?.(p.x, p.z));
  const run = (i: number) => Math.hypot(eased[i]!.x - eased[i - 1]!.x, eased[i]!.z - eased[i - 1]!.z);
  const clampTo = (i: number, y: number, len: number) => (fixed[i] ? ys[i]! : (ys[i] = Math.max(y - WALK * len, Math.min(y + WALK * len, ys[i]!))));
  for (let pass = 0; pass < 40; pass++) {
    let moved = 0;
    for (let i = 1; i < ys.length - 1; i++) moved += Math.abs(ys[i]! - clampTo(i, ys[i - 1]!, run(i)));
    for (let i = ys.length - 2; i >= 1; i--) moved += Math.abs(ys[i]! - clampTo(i, ys[i + 1]!, run(i + 1)));
    if (moved < 0.01) break;
  }
  return eased.map((p, i) => ({ x: p.x, z: p.z, y: ys[i]!, gx: pts[i]!.x, gz: pts[i]!.z }));
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
  const rim = spots.filter((p) => Math.hypot(p.x, p.z) > R * 0.55);
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
      if (Math.hypot(p.x, p.z) > R - r - 6 || !canReach(p.x, p.z)) continue;
      let gap = Infinity;
      for (const o of taken) gap = Math.min(gap, Math.hypot(p.x - o.x, p.z - o.z) - o.r - r);
      if (gap > 8 && gap > bestGap && flatDisc(ground, p.x, p.z, r, 0.45)) best = p, bestGap = gap;
    }
    if (!best) continue;
    const churn = allChurn ? Math.round((f.files.reduce((s, x) => s + (x.churn ?? 0), 0) / allChurn) * 100) / 100 : 0;
    const guards = 2 + Math.min(3, Math.floor(f.lines / 6000)) + churnGuards(churn);
    const burning = (repo.failing ?? []).some((check) => checkHits(f.folder, check));
    // The gate faces HEAD, the way you come in.
    const gx = spawn.x - best.x, gz = spawn.z - best.z;
    const gate = Math.abs(gx) > Math.abs(gz) ? (gx > 0 ? 0 : 1) : gz > 0 ? 2 : 3;
    compounds.push({ folder: f.folder, x: best.x, z: best.z, r, files: f.files.length, lines: f.lines, guards, churn, burning, half: Math.round(r * 0.66 * 10) / 10, gate });
    pads.push({ x: best.x, z: best.z, r });
    taken.push({ x: best.x, z: best.z, r });
  }

  const padded = withPads(ground, pads);
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
      const d = Math.hypot(x - o.x, z - o.z);
      if (oi !== ci) return d < o.r + 2;
      const along = (x - c.x) * g.x + (z - c.z) * g.z, across = Math.abs(-(x - c.x) * g.z + (z - c.z) * g.x);
      return d < c.r + 1 && !(along > h + 1.5 && across < 2.4);
    });
    const path = trail(terrain, spawn, { x: c.x + g.x * (h + 2.5), z: c.z + g.z * (h + 2.5) }, cell, { ...rules, blocked }) ?? [];
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
          const x = c - R, z = r - R, u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / L)), d = Math.hypot(x - a.x - ex * u, z - a.z - ez * u);
          if (d < nearCut[r * m1 + c]!) nearCut[r * m1 + c] = d;
        }
      }
    }
    for (const p of path) {
      // The cells the search went through: a later path through the same ones eases to the same line.
      cut[cellOf(p.gx, p.gz)] = 1;
      for (let dz = -reach; dz <= reach; dz += cell) for (let dx = -reach; dx <= reach; dx += cell) if (Math.hypot(dx, dz) <= near) by[cellOf(p.gx + dx, p.gz + dz)] = 1;
    }
  });
  const onTrail = (x: number, z: number, within: number) => trails.some((t) => t.some((p) => Math.hypot(p.x - x, p.z - z) < within));
  const blocks: Block[] = [];
  const walls: Block[] = [];
  const overlaps = (x: number, z: number, w: number, d: number, gap: number) =>
    [...blocks, ...walls].some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + gap && Math.abs(b.z - z) < (b.d + d) / 2 + gap);

  // Each compound is a walled qalat of the kind the Afghan highlands are dotted with: thick mud curtain
  // walls round a square, a tower at every corner (the one farthest from the gate tallest, a watchtower),
  // a gate flanked by pillars, an inner wall cutting off a back courtyard with its own doorway, a stair
  // up onto the wall walk, and low orchard walls outside the gate for the way in.
  compounds.forEach((c, ci) => {
    const y = terrain.height(c.x, c.z), h = c.half!, t = WALL_THICK, gap = GATE_GAP;
    const wall = (x: number, z: number, w: number, d: number, bh: number) => walls.push({ path: `${c.folder}/wall`, lines: 0, compound: ci, x, z, y, w, d, h: bh, wall: true });
    // Sides as [axis, sign]: 0 +x, 1 -x, 2 +z, 3 -z.
    for (let side = 0; side < 4; side++) {
      const alongX = side >= 2, sign = side % 2 === 0 ? 1 : -1;
      const cx = alongX ? c.x : c.x + sign * h, cz = alongX ? c.z + sign * h : c.z;
      const len = h * 2 - 2.7;
      const put = (off: number, l: number) => (alongX ? wall(cx + off, cz, l, t, WALL_HEIGHT) : wall(cx, cz + off, t, l, WALL_HEIGHT));
      if (side === c.gate) {
        // Gate pillars either side of the opening, the curtain wall running on from them.
        const pillar = 1.1, seg = (len - (gap + pillar + 0.05) * 2) / 2;
        put(-(gap + pillar + 0.05 + seg / 2), seg), put(gap + pillar + 0.05 + seg / 2, seg);
        for (const sgn of [-1, 1]) alongX ? wall(cx + sgn * (gap + pillar / 2), cz, pillar, t + 0.5, PILLAR_HEIGHT) : wall(cx, cz + sgn * (gap + pillar / 2), t + 0.5, pillar, PILLAR_HEIGHT);
      } else put(0, len);
    }
    // Corner towers; the back corner on the stair's side is the watchtower.
    const g = gateDir(c.gate!), across = { x: -g.z, z: g.x };
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const watch = sx * g.x + sz * g.z < 0 && sx * across.x + sz * across.z > 0;
      wall(c.x + sx * h, c.z + sz * h, 2.6, 2.6, watch ? WATCH_HEIGHT : TOWER_HEIGHT);
    }
    // The inner wall: across the yard a third of the way from the back, a doorway off to one side.
    const along = (k: number) => ({ x: c.x + g.x * k, z: c.z + g.z * k });
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
      const out = along(Math.min(c.r - 2.5, h + 4)), len = h * 0.6;
      for (const sgn of [-1, 1]) {
        const side = GATE_GAP + 0.6 + len / 2, x = out.x + across.x * sgn * side, z = out.z + across.z * sgn * side;
        if (Math.hypot(x - c.x + across.x * sgn * (len / 2), z - c.z + across.z * sgn * (len / 2)) > c.r - 1) continue;
        g.x !== 0 ? wall(x, z, ORCHARD_THICK, len, ORCHARD_HEIGHT) : wall(x, z, len, ORCHARD_THICK, ORCHARD_HEIGHT);
      }
    }
  });

  // Inside, the biggest files are rooms built against the walls, the rest spiral out from the courtyard, leaving the way from the gate clear.
  compounds.forEach((c, ci) => {
    const files = byFolder.get(c.folder)!.slice(0, PER_COMPOUND);
    const g = gateDir(c.gate!), across = { x: -g.z, z: g.x }, h = c.half!;
    const inGateLane = (dx: number, dz: number, w: number) => dx * g.x + dz * g.z > 0 && Math.abs(dx * across.x + dz * across.z) < 2.6 + w / 2;
    const place = (f: RepoFile, x: number, z: number, w: number, d: number): boolean => {
      const dx = x - c.x, dz = z - c.z, room = h - w / 2 - WALL_THICK / 2 - 0.3;
      if (Math.abs(dx) > room || Math.abs(dz) > room || inGateLane(dx, dz, w) || overlaps(x, z, w, d, 1.2)) return false;
      blocks.push({ path: f.path, lines: f.lines, compound: ci, x, z, y: terrain.height(c.x, c.z), w, d, h: heightOf(f.lines), agent: (f.agent ?? 0) >= 0.5 });
      return true;
    };
    let i = 0, slot = 0;
    for (const f of files) {
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
      for (let tries = 0; tries < 60 && !placed; tries++, i++) {
        const a = i * 2.39996, dist = 3.5 + Math.sqrt(i) * 1.7;
        if (dist > h * 1.5) break;
        placed = place(f, c.x + Math.cos(a) * dist, c.z + Math.sin(a) * dist, w, d);
      }
    }
  });

  // Everything else is crates in the field, kept off the spawn and out of the compounds.
  const loose = ranked.filter((f) => !compounds.some((c) => c.folder === f.folder)).flatMap((f) => f.files);
  for (const f of loose.slice(0, CRATES)) {
    const w = Math.min(2.4, footOf(f.lines)), d = w, h = Math.min(2.2, heightOf(f.lines));
    for (let tries = 0; tries < 40; tries++) {
      const p = spots[Math.floor(rand() * spots.length)]!;
      if (taken.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < o.r + 3) || overlaps(p.x, p.z, w, d, 2) || onTrail(p.x, p.z, w / 2 + 2.5)) continue;
      // Sat on its lowest corner so it never floats on a slope.
      const y = Math.min(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => terrain.height(p.x + (sx! * w) / 2, p.z + (sz! * d) / 2)));
      blocks.push({ path: f.path, lines: f.lines, compound: -1, x: p.x, z: p.z, y, w, d, h, agent: (f.agent ?? 0) >= 0.5 });
      break;
    }
  }

  blocks.push(...walls);

  // Roads: one between each pair of compounds whose folders import each other.
  const at = new Map(compounds.map((c, i) => [c.folder, i]));
  const roads: Road[] = [];
  for (const [fa, fb, weight] of repo.links ?? []) {
    const a = at.get(fa), b = at.get(fb);
    if (a !== undefined && b !== undefined) roads.push(a < b ? { a, b, weight } : { a: b, b: a, weight });
  }
  roads.sort((p, q) => p.a - q.a || p.b - q.b);
  return { terrain, spawn, compounds, blocks, roads, trails };
}
