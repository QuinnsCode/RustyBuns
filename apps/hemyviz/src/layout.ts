// A fleet -> a scene: blocks on a ground plane (x, z), each with a height, in zones. Pure and deterministic: the same
// state always draws the same picture, so a change on screen is a change on disk. Every dimension (2D, 2.5D, 3D)
// draws the same scene through a different camera (project.ts); the mode decides what the scene says.
//
//   map     each stack is an island; resources stand in columns by dependency depth, links show what feeds what
//   health  zones per status; a deploy in flight (creating, updating, deleting, replacing) pulses
//   age     one lane per stack; left is the oldest change, right the newest, and newer stands taller
//   kinds   zones per resource type, the most common first, each block in its app's colour
//   blast   what a destroy takes with it: height is how many resources depend on it (all the way down); kept ones apart
import { BUSY, kindOf, shortName, type Fleet, type Resource, type Stack } from "./api.ts";

export const MODES = ["map", "health", "age", "kinds", "blast"] as const;
export type Mode = (typeof MODES)[number];
export const DIMS = ["2d", "2.5d", "3d"] as const;
export type Dim = (typeof DIMS)[number];

export interface Block {
  /** `<stack id>::<fqn>`: unique in the scene. */
  id: string;
  stack: string;
  stage: string;
  r: Resource;
  x: number; z: number; w: number; d: number; h: number;
  /** The body colour: what the mode says about it. */
  color: string;
  /** Its app's colour: the plinth it stands on, and the plate in map and age. */
  app: string;
  label: string;
  pulse: boolean;
  /** Transitive dependents in its stage. */
  reach: number;
}
export interface Zone { id: string; label: string; x: number; z: number; w: number; d: number; /** An app's plate colour, when the zone is one stack. */ color?: string }
export interface Link { from: string; to: string }
export interface Scene { mode: Mode; blocks: Block[]; zones: Zone[]; links: Link[]; w: number; d: number; legend: { label: string; color: string }[] }

const CELL = 2, SIZE = 1.3, PAD = 1.1, GAP = 1.6;

/** The house colours: purples, lilac and lavender, grey, and a sunrise for heat. Each app gets one, in name order. */
export const APP_COLORS = ["#7c5cff", "#ff8a5c", "#b9a3e8", "#ffc15e", "#9c8fb8", "#e86f9a", "#5b45b0", "#d8b4fe", "#f4a259", "#6f6a85"];
/** The resource blocks in map mode: lilac-white, so the app plates and the icons carry the colour. */
export const BLOCK = "#e4def5";

export const STATUS_COLOR: Record<Resource["status"], string> = {
  created: "#c9bff0", updated: "#c9bff0", replaced: "#a48ee6",
  creating: "#7c5cff", updating: "#7c5cff", replacing: "#ffc15e", deleting: "#ff6b5c",
};
const KEPT = "#9c8fb8";

/** A colour from cool lavender (0) through purple to a sunrise (1). */
function ramp(t: number): string {
  const stops = [[216, 206, 245], [124, 92, 255], [255, 138, 92], [255, 193, 94]] as const;
  const f = Math.max(0, Math.min(1, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), k = f - i;
  const [a, b] = [stops[i]!, stops[i + 1]!];
  return `rgb(${a.map((v, j) => Math.round(v + (b[j]! - v) * k)).join(",")})`;
}

interface Item { s: Stack; r: Resource }
interface Placed extends Item { col: number; row: number; h: number; color: string }
interface ZoneSpec { id: string; label: string; items: Placed[]; cols?: number; color?: string }

/** How deep each resource sits: 0 for one nothing feeds, else one more than the deepest that lists it downstream. */
function depths(rs: Resource[]): Map<string, number> {
  const up = new Map<string, string[]>();
  for (const r of rs) for (const d of r.downstream) up.set(d, [...(up.get(d) ?? []), r.fqn]);
  const memo = new Map<string, number>(), visiting = new Set<string>();
  const depth = (f: string): number => {
    const m = memo.get(f);
    if (m !== undefined) return m;
    if (visiting.has(f)) return 0;
    visiting.add(f);
    const v = Math.max(-1, ...(up.get(f) ?? []).map(depth)) + 1;
    visiting.delete(f);
    memo.set(f, v);
    return v;
  };
  return new Map(rs.map((r) => [r.fqn, depth(r.fqn)]));
}

/** How many resources in the stage depend on each, directly or through others. */
export function reaches(rs: Resource[]): Map<string, number> {
  const by = new Map(rs.map((r) => [r.fqn, r]));
  return new Map(rs.map((r) => {
    const seen = new Set<string>(), todo = [...r.downstream];
    while (todo.length) {
      const f = todo.pop()!;
      if (seen.has(f) || f === r.fqn) continue;
      seen.add(f);
      todo.push(...(by.get(f)?.downstream ?? []));
    }
    return [r.fqn, seen.size];
  }));
}

/** Items in a square-ish grid, in order. */
const grid = (items: Omit<Placed, "col" | "row">[], cols = Math.max(1, Math.ceil(Math.sqrt(items.length)))): Placed[] =>
  items.map((it, i) => ({ ...it, col: i % cols, row: Math.floor(i / cols) }));

/** Lay zones out left to right, wrapping into rows; `lanes` puts each on its own row. */
function arrange(mode: Mode, specs: ZoneSpec[], reach: Map<string, number>, legend: Scene["legend"], appOf: (stack: string) => string, lanes = false): Scene {
  const sized = specs.filter((z) => z.items.length).map((z) => {
    const cols = Math.max(z.cols ?? 0, ...z.items.map((p) => p.col + 1)), rows = Math.max(...z.items.map((p) => p.row + 1));
    return { ...z, w: cols * CELL - (CELL - SIZE) + PAD * 2, d: rows * CELL - (CELL - SIZE) + PAD * 2 };
  });
  const area = sized.reduce((a, z) => a + (z.w + GAP) * (z.d + GAP), 0);
  const maxW = lanes ? 0 : Math.max(...sized.map((z) => z.w), Math.sqrt(area) * 1.4);
  const zones: Zone[] = [], blocks: Block[] = [];
  let x = 0, z = 0, rowD = 0, w = 0;
  for (const s of sized) {
    if (x > 0 && x + s.w > maxW) { x = 0; z += rowD + GAP; rowD = 0; }
    zones.push({ id: s.id, label: s.label, x, z, w: s.w, d: s.d, ...(s.color && { color: s.color }) });
    for (const p of s.items) {
      const id = `${p.s.id}::${p.r.fqn}`;
      blocks.push({
        id, stack: p.s.stack, stage: p.s.stage, r: p.r,
        x: x + PAD + p.col * CELL, z: z + PAD + p.row * CELL, w: SIZE, d: SIZE, h: p.h,
        color: p.color, app: appOf(p.s.stack), label: shortName(p.r.fqn), pulse: BUSY.has(p.r.status), reach: reach.get(id) ?? 0,
      });
    }
    w = Math.max(w, x + s.w);
    rowD = Math.max(rowD, s.d);
    x += s.w + GAP;
  }
  const ids = new Set(blocks.map((b) => b.id));
  const links: Link[] = [];
  for (const b of blocks) for (const d of b.r.downstream) {
    const to = `${b.id.split("::")[0]}::${d}`;
    if (ids.has(to)) links.push({ from: b.id, to });
  }
  return { mode, blocks, zones, links, w, d: z + rowD, legend };
}

const byName = (a: Item, b: Item) => a.s.id.localeCompare(b.s.id) || a.r.fqn.localeCompare(b.r.fqn);

/** The scene for `mode`. `stacks` limits it to those stack ids (all when empty). */
export function layout(fleet: Fleet, mode: Mode, stacks: readonly string[] = []): Scene {
  const shown = fleet.stacks.filter((s) => !stacks.length || stacks.includes(s.id));
  const items: Item[] = shown.flatMap((s) => s.resources.map((r) => ({ s, r }))).sort(byName);
  const reach = new Map<string, number>();
  for (const s of shown) for (const [f, n] of reaches(s.resources)) reach.set(`${s.id}::${f}`, n);
  const reachOf = (it: Item) => reach.get(`${it.s.id}::${it.r.fqn}`) ?? 0;
  const kinds = [...new Set(items.map((i) => i.r.type))].sort();
  // Every stage of an app shares its colour, and the colour stays put when the filter hides other apps.
  const apps = [...new Set(fleet.stacks.map((x) => x.stack))].sort();
  const appOf = (name: string) => APP_COLORS[Math.max(0, apps.indexOf(name)) % APP_COLORS.length]!;
  const appLegend = [...new Set(shown.map((x) => x.stack))].sort().map((a) => ({ label: a, color: appOf(a) }));

  if (mode === "map") {
    const specs = shown.map((s) => {
      const dep = depths(s.resources), rows = new Map<number, number>();
      const items = [...s.resources].sort((a, b) => (dep.get(a.fqn)! - dep.get(b.fqn)!) || a.fqn.localeCompare(b.fqn)).map((r) => {
        const col = dep.get(r.fqn)!, row = rows.get(col) ?? 0;
        rows.set(col, row + 1);
        return { s, r, col, row, h: 0.45 + Math.min(4, r.downstream.length * 0.4), color: BLOCK };
      });
      return { id: s.id, label: `${s.stack} · ${s.stage}`, items, color: appOf(s.stack) };
    });
    return arrange(mode, specs, reach, appLegend, appOf);
  }
  if (mode === "health") {
    const order: Resource["status"][] = ["deleting", "replacing", "creating", "updating", "replaced", "updated", "created"];
    const specs = order.map((st) => ({
      id: st, label: st,
      items: grid(items.filter((i) => i.r.status === st).map((i) => ({ ...i, h: BUSY.has(st) ? 1.6 : 1, color: STATUS_COLOR[st] }))),
    }));
    const legend = [{ label: "live", color: STATUS_COLOR.created }, { label: "in flight", color: STATUS_COLOR.updating }, { label: "replacing", color: STATUS_COLOR.replacing }, { label: "deleting", color: STATUS_COLOR.deleting }];
    return arrange(mode, specs, reach, legend, appOf);
  }
  if (mode === "age") {
    const ts = items.map((i) => i.r.updatedAt), lo = Math.min(...ts), hi = Math.max(...ts), span = Math.max(1, hi - lo);
    const cols = Math.max(8, Math.ceil(Math.sqrt(items.length) * 2));
    const specs = shown.map((s) => {
      const used = new Map<number, number>();
      const its = [...s.resources].sort((a, b) => a.updatedAt - b.updatedAt || a.fqn.localeCompare(b.fqn)).map((r) => {
        const t = (r.updatedAt - lo) / span, col = Math.round(t * (cols - 1)), row = used.get(col) ?? 0;
        used.set(col, row + 1);
        return { s, r, col, row, h: 0.4 + 3 * t, color: ramp(t) };
      });
      return { id: s.id, label: `${s.stack} · ${s.stage}`, items: its, cols, color: appOf(s.stack) };
    });
    return arrange(mode, specs, reach, [{ label: "oldest", color: ramp(0) }, { label: "newest", color: ramp(1) }], appOf, true);
  }
  if (mode === "kinds") {
    const groups = kinds.map((t) => items.filter((i) => i.r.type === t)).sort((a, b) => b.length - a.length || a[0]!.r.type.localeCompare(b[0]!.r.type));
    const specs = groups.map((g) => {
      const t = g[0]!.r.type;
      return { id: t, label: `${kindOf(t)} ×${g.length}`, items: grid(g.map((i) => ({ ...i, h: 1, color: appOf(i.s.stack) }))) };
    });
    return arrange(mode, specs, reach, appLegend, appOf);
  }
  const top = Math.max(1, ...items.map(reachOf));
  const blast = (kept: boolean) => grid(items.filter((i) => i.r.kept === kept).sort((a, b) => reachOf(b) - reachOf(a) || byName(a, b))
    .map((i) => ({ ...i, h: 0.5 + Math.min(8, reachOf(i) * 0.6), color: kept ? KEPT : ramp(reachOf(i) / top) })));
  return arrange(mode, [{ id: "goes", label: "a destroy removes", items: blast(false) }, { id: "kept", label: "kept on destroy", items: blast(true) }], reach,
    [{ label: "nothing depends on it", color: ramp(0) }, { label: "most depend on it", color: ramp(1) }, { label: "kept", color: KEPT }], appOf);
}
