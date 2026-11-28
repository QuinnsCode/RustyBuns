// The Stage Builder's model (#6053), pure: the arenas and ready-made stages it offers, a new arena as a studio
// definition (room.ts, so builder.ts's edits, the coverage map and the jam room all read it as any room), the crowd's
// zone in front of the stage, and what this browser keeps: each build as its saves (every change is one, so Undo and
// History work between visits) and the orders you locked in. stage-page.ts draws it.
import { arr, check, num, obj, opt, raw, str, type Of } from "@rustybuns/util/guard";
import { gear } from "@rustybuns/gear";
import { BOXES, Studio } from "./builder.ts";
import { inStage, onStage, type StudioDef } from "./room.ts";
import { MATERIALS } from "./sound.ts";

/** How small and how big an arena goes, metres. */
export const ARENA = { w: [10, 200], d: [8, 150] } as const;
export type Arena = { outdoor: boolean; w: number; d: number };
export const ARENAS: (Arena & { name: string })[] = [
  { name: "Room", outdoor: false, w: 20, d: 15 },
  { name: "Field", outdoor: true, w: 60, d: 40 },
  { name: "Big field", outdoor: true, w: 150, d: 100 },
];
export const STAGES = [
  { name: "Pub corner", w: 4, d: 3 },
  { name: "Club", w: 8, d: 6 },
  { name: "Festival", w: 10, d: 7 },
  { name: "Arena", w: 24, d: 16 },
] as const;
/** Whether a stage leaves its arena room to stand in and somebody in front of it. */
export const stageFits = (a: Arena, st: { w: number; d: number }) => st.w <= a.w - 1 && st.d <= a.d - 2;

/** The boxes a ground stack is built of, and how many high it goes (flown higher only in a stadium, later). */
export const STACK_BOXES = BOXES.filter((id) => gear(id).speaker);
export const MAX_HIGH = 3;

export const arenaWords = (def: StudioDef) => `${def.outdoor ? "field" : "room"} ${def.size.w} × ${def.size.d} m`;
export const stacksOf = (def: StudioDef) => (def.outdoor ?? def.pa)?.stacks ?? [];

/** An empty arena: open ground under the sky, or a bare room. */
export function newArena(a: Arena): StudioDef {
  const floor = a.outdoor ? "sand" : "concrete", walls = a.outdoor ? "sky" : "drywall", ceiling = a.outdoor ? "sky" : "drywall";
  const h = a.outdoor ? 20 : Math.max(4, Math.min(12, Math.round(Math.min(a.w, a.d) / 4)));
  return {
    id: "stage-build", name: `${a.outdoor ? "Field" : "Room"} ${a.w} × ${a.d} m`,
    size: { w: a.w, d: a.d, h },
    colors: { floor: a.outdoor ? "#7d7a52" : MATERIALS.concrete.color, walls: a.outdoor ? "#10142a" : MATERIALS.drywall.color, ceiling: a.outdoor ? "#10142a" : MATERIALS.drywall.color, trim: "#c8a46a" },
    materials: { floor, ceiling, walls: { front: walls, back: walls, left: walls, right: walls } },
    walls: [], spots: [],
    door: { at: [0, a.d / 2 - 0.5], yaw: 0 },
    // the sesh's gear wall in a front corner, behind the crowd (placing the stage moves it clear if need be)
    gear: { at: [a.w / 2 - 2.35, a.d / 2 - 0.15], yaw: 0 },
    ...(a.outdoor ? { outdoor: { stacks: [], seed: 6053 } } : {}),
  };
}

/** The 0.5 m grid things snap to, and the turn they step by. */
export const SNAP = 0.5, TURN = Math.PI / 12;
export const snap = (v: number) => Math.round(v / SNAP) * SNAP;

/** Where a stage starts out: against the back of the arena, facing the floor. */
export const stageStart = (def: StudioDef, d: number): [number, number] => [0, snap(-def.size.d / 2 + d / 2 + SNAP)];
/** Where the next stack starts out: beside the stage's front corners, left then right, then further out. */
export function stackStart(def: StudioDef): [number, number] {
  const st = def.stage, n = stacksOf(def).length, k = n % 2 ? 1 : -1, out = 1.5 + Math.floor(n / 2) * 2;
  const at = st ? onStage(st, k * (st.w / 2 + out), st.d / 2) : [k * out * 2, -def.size.d / 4] as const;
  const half = (v: number, size: number) => snap(Math.max(-size / 2 + 1, Math.min(size / 2 - 1, v)));
  const beside: [number, number] = [half(at[0], def.size.w), half(at[1], def.size.d)];
  if (!st || !inStage(st, ...beside, 0.3)) return beside;
  // a stage as wide as its arena: in front of its corners instead
  const [x, z] = onStage(st, k * (st.w / 2 - 1), st.d / 2 + 0.75);
  return [half(x, def.size.w), snap(Math.min(def.size.d / 2 - 0.5, z))];
}

/** People a square metre of floor holds, standing. */
export const CROWD_PER_M2 = 2;
export type Crowd = { points: [number, number][]; m2: number; cap: number };

/** Cut a polygon to the side of a line where `inside` is positive (Sutherland and Hodgman). */
function clip(poly: [number, number][], inside: (p: [number, number]) => number): [number, number][] {
  return poly.flatMap((p, i) => {
    const q = poly[(i + 1) % poly.length]!, a = inside(p), b = inside(q), out: [number, number][] = a >= 0 ? [p] : [];
    if ((a >= 0) !== (b >= 0)) { const t = a / (a - b); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    return out;
  });
}

/** The crowd's floor: from 2 m in front of the stage, widening to twice and a bit its width, as deep as twice its
 *  width, cut to the arena; its area, and the people it holds. */
export function crowdZone(def: StudioDef): Crowd | null {
  const st = def.stage;
  if (!st) return null;
  const half = Math.max(4, st.w * 1.2), x = def.size.w / 2 - 0.5, z = def.size.d / 2 - 0.5;
  // a small arena has no 2 m to spare: the crowd comes up to the stage
  for (const gap of [2, 0]) {
    const front = st.d / 2 + gap, back = front + Math.max(8, st.w * 2);
    let poly: [number, number][] = [onStage(st, -half, front), onStage(st, half, front), onStage(st, half, back), onStage(st, -half, back)];
    for (const side of [(p: [number, number]) => x - p[0], (p: [number, number]) => x + p[0], (p: [number, number]) => z - p[1], (p: [number, number]) => z + p[1]]) poly = clip(poly, side);
    const m2 = Math.round(Math.abs(poly.reduce((t, p, i) => { const q = poly[(i + 1) % poly.length]!; return t + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2);
    if (m2) return { points: poly, m2, cap: m2 * CROWD_PER_M2 };
  }
  return null;
}
/** Whether (x, z) is in a convex zone. */
export function inZone(points: readonly [number, number][], x: number, z: number): boolean {
  let side = 0;
  return points.every((p, i) => {
    const q = points[(i + 1) % points.length]!, s = Math.sign((q[0] - p[0]) * (z - p[1]) - (q[1] - p[1]) * (x - p[0]));
    if (!s) return true;
    side ||= s;
    return s === side;
  });
}
// ---- what this browser keeps ----

export const BUILDS = "qollab-studio:stage-builds";
export const MAX_SAVES = 60, MAX_BUILDS = 8, MAX_ORDERS = 24;
const ID = str(32, { re: /^[a-z0-9-]+$/ });
const WHEN = num(0, 8.64e15);
/** One save: the build as it stood, when, and the change that made it. */
export const Save = obj({ at: WHEN, note: str(80), def: Studio });
export const Build = obj({ id: ID, name: str(60, { min: 1 }), saves: arr(Save, MAX_SAVES, { drop: true, min: 1 }) });
/** A locked-in build: frozen. */
export const Order = obj({ id: ID, name: str(60, { min: 1 }), at: WHEN, def: Studio });
export type Build = Of<typeof Build>;
export type Order = Of<typeof Order>;
export type Store = { open?: string; builds: Build[]; orders: Order[] };
const Kept = obj({ open: opt(ID), builds: opt(arr(raw, 100)), orders: opt(arr(raw, 100)) });

/** This browser's builds and orders, checked one by one: one gone bad is left out, the rest stay. */
export function readStore(json: string | null): Store {
  let v: unknown = null;
  try { v = json ? JSON.parse(json) : null; } catch { /* not ours: start empty */ }
  const kept = check(Kept, v);
  const each = <T>(list: unknown[] | undefined, g: (v: unknown) => T, max: number) => (list ?? []).flatMap((x) => { const ok = check(g, x); return ok ? [ok] : []; }).slice(0, max);
  // (a save gone bad is dropped; a build with none left goes too)
  const builds = each(kept?.builds, Build, MAX_BUILDS).filter((b) => b.saves.length), orders = each(kept?.orders, Order, MAX_ORDERS);
  return { ...(kept?.open && builds.some((b) => b.id === kept.open) ? { open: kept.open } : {}), builds, orders };
}

export const openBuild = (s: Store) => s.builds.find((b) => b.id === s.open);
export const latest = (b: Build) => b.saves[b.saves.length - 1]!.def;
const freeId = (taken: { id: string }[], now: number) => { let n = now; while (taken.some((x) => x.id === `b-${n.toString(36)}`)) n++; return `b-${n.toString(36)}`; };
const withOpen = (s: Store, f: (b: Build) => Build): Store => ({ ...s, builds: s.builds.map((b) => (b.id === s.open ? f(b) : b)) });

/** Start a build from `def` and open it (the newest first; past MAX_BUILDS the oldest goes). */
export function startBuild(s: Store, def: StudioDef, now: number, note = "new arena"): Store {
  const id = freeId(s.builds, now);
  return { ...s, open: id, builds: [{ id, name: def.name, saves: [{ at: now, note, def }] }, ...s.builds].slice(0, MAX_BUILDS) };
}
/** Save the open build as it stands now; no change, no save. Past MAX_SAVES the oldest goes. */
export function keep(s: Store, def: StudioDef, note: string, now: number): Store {
  return withOpen(s, (b) => (JSON.stringify(latest(b)) === JSON.stringify(def) ? b : { ...b, saves: [...b.saves, { at: now, note, def }].slice(-MAX_SAVES) }));
}
/** Undo: the open build without its last save (its first stays). */
export const stepBack = (s: Store): Store => withOpen(s, (b) => (b.saves.length > 1 ? { ...b, saves: b.saves.slice(0, -1) } : b));
/** Roll back to save `i`: that save again, as the newest, so nothing in the history is lost. */
export function rollBack(s: Store, i: number, now: number): Store {
  const save = openBuild(s)?.saves[i];
  return save ? keep(s, save.def, `back to: ${save.note}`.slice(0, 80), now) : s;
}
/** Lock the open build in as an order. */
export function lockIn(s: Store, name: string, now: number): Store {
  const b = openBuild(s);
  if (!b) return s;
  const called = name.trim().slice(0, 60) || b.name;
  const def = { ...latest(b), name: called };
  return {
    ...withOpen(s, (x) => ({ ...x, name: called })),
    orders: [{ id: freeId(s.orders, now), name: called, at: now, def }, ...s.orders].slice(0, MAX_ORDERS),
  };
}
