// A repo laid onto a piece of ground, the way codeSplitter's code city lays a
// person's repos onto streets (apps/codesplitter/src/city.ts), but as a battlefield:
//   - the biggest folders are enemy compounds, cut level into the ground, each held by guards
//   - a compound's files are its buildings: height is line count, so a 2000-line file is a tower to fight round
//   - files from everywhere else are crates scattered across the field, cover between you and them
//   - folders that import each other are joined by roads; a folder that changed a lot lately holds more guards
//   - a file agents mostly wrote is black glass, not paper (codeSplitter's city does this); a failing check sets its compound on fire
// The same repo on the same ground with the same seed is always the same level.

import { CLIFF, slope, wet, withPads, type Pad, type Terrain } from "./terrain.ts";

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
}

/** Two compounds whose folders import each other, and how many files do. */
export interface Road { a: number; b: number; weight: number }

export interface CodeMap {
  terrain: Terrain;
  spawn: { x: number; z: number; yaw: number };
  compounds: Compound[];
  blocks: Block[];
  roads?: Road[];
}

/** Compounds a level holds at most, files shown in each, and crates out in the field. */
export const COMPOUNDS = 6, PER_COMPOUND = 14, CRATES = 36;

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** Ground that can be walked to from (sx, sz): a flood fill over a 2 m grid, no step steeper than a cliff. */
export function reachable(t: Terrain, sx: number, sz: number, cell = 2): (x: number, z: number) => boolean {
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
      if (Math.abs(at(cc, rr) - h) / cell > CLIFF) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return (x, z) => {
    const c = Math.round((x + t.R) / cell), r = Math.round((z + t.R) / cell);
    return c >= 0 && r >= 0 && c < n && r < n && seen[r * n + c] === 1;
  };
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
  const canReach = reachable(ground, spawnAt.x, spawnAt.z);
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
    const r = Math.min(14, 7 + Math.sqrt(shown.length) * 1.6);
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
    compounds.push({ folder: f.folder, x: best.x, z: best.z, r, files: f.files.length, lines: f.lines, guards, churn, burning });
    pads.push({ x: best.x, z: best.z, r });
    taken.push({ x: best.x, z: best.z, r });
  }

  const terrain = withPads(ground, pads);
  const blocks: Block[] = [];
  const overlaps = (x: number, z: number, w: number, d: number, gap: number) =>
    blocks.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + gap && Math.abs(b.z - z) < (b.d + d) / 2 + gap);

  // Each compound's files spiral out from an open yard at its centre.
  compounds.forEach((c, ci) => {
    const files = byFolder.get(c.folder)!.slice(0, PER_COMPOUND);
    let i = 0;
    for (const f of files) {
      const w = footOf(f.lines), d = footOf(f.lines);
      for (let tries = 0; tries < 60; tries++, i++) {
        const a = i * 2.39996, dist = 4 + Math.sqrt(i) * 1.9;
        if (dist > c.r - 1) break;
        const x = c.x + Math.cos(a) * dist, z = c.z + Math.sin(a) * dist;
        if (overlaps(x, z, w, d, 1.4)) continue;
        blocks.push({ path: f.path, lines: f.lines, compound: ci, x, z, y: terrain.height(c.x, c.z), w, d, h: heightOf(f.lines), agent: (f.agent ?? 0) >= 0.5 });
        break;
      }
    }
  });

  // Everything else is crates in the field, kept off the spawn and out of the compounds.
  const loose = ranked.filter((f) => !compounds.some((c) => c.folder === f.folder)).flatMap((f) => f.files);
  for (const f of loose.slice(0, CRATES)) {
    const w = Math.min(2.4, footOf(f.lines)), d = w, h = Math.min(2.2, heightOf(f.lines));
    for (let tries = 0; tries < 40; tries++) {
      const p = spots[Math.floor(rand() * spots.length)]!;
      if (taken.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < o.r + 3) || overlaps(p.x, p.z, w, d, 2)) continue;
      // Sat on its lowest corner so it never floats on a slope.
      const y = Math.min(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => terrain.height(p.x + (sx! * w) / 2, p.z + (sz! * d) / 2)));
      blocks.push({ path: f.path, lines: f.lines, compound: -1, x: p.x, z: p.z, y, w, d, h, agent: (f.agent ?? 0) >= 0.5 });
      break;
    }
  }

  // Roads: one between each pair of compounds whose folders import each other.
  const at = new Map(compounds.map((c, i) => [c.folder, i]));
  const roads: Road[] = [];
  for (const [fa, fb, weight] of repo.links ?? []) {
    const a = at.get(fa), b = at.get(fb);
    if (a !== undefined && b !== undefined) roads.push(a < b ? { a, b, weight } : { a: b, b: a, weight });
  }
  roads.sort((p, q) => p.a - q.a || p.b - q.b);
  return { terrain, spawn, compounds, blocks, roads };
}
