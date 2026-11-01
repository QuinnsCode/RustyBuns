// A playable region's trail: the journey's twelve sections laid as rings round its arena. Every sample of the piece
// belongs to the ring it lies in, and the rings hold equal areas (the outermost is section 1, the arena's pad the
// last), so each section is a broad band of open country about as big as the others wherever the arena sits in
// its piece. You may roam a band freely, but the next one in stays shut until you beat (or bind) the keeper on its
// stone. The trail is the path from the piece's far edge through the stones to the arena. Railroaded, but open.
// No three.js: view.ts draws it, the tests walk it.
import { hasTrail, SECTIONS } from "../journey.ts";
import { REGIONS, type Region } from "../regions.ts";
import ground from "./ground.json";
import { ARENA_R, arenaOf, buildWorld, COLS, heightAt, neighbours, ownerAt, OWNER, regionAt, ROWS, STEP, walk, type WalkEvent, type Walker, type Wild } from "./world.ts";

/** The world's ground, built once here for the trails and handed to view.ts. */
export const WORLD = buildWorld(ground);

export interface Pt { x: number; z: number }
export interface Trail {
  n: number;
  /** The path, from the far edge through every stone to the arena. */
  pts: Pt[];
  /** Metres along the path at each point. */
  at: number[];
  length: number;
  /** Where each section's keeper stands; the last is the arena. */
  stones: Pt[];
  /** Metres along the path at each stone. */
  stoneAt: number[];
}

/** The point `s` metres along the trail. */
export function pointAt(t: Pick<Trail, "pts" | "at">, s: number): Pt {
  for (let i = 0; i + 1 < t.pts.length; i++) if (s <= t.at[i + 1]! || i + 2 === t.pts.length) {
    const a = t.pts[i]!, b = t.pts[i + 1]!, u = Math.max(0, Math.min(1, (s - t.at[i]!) / ((t.at[i + 1]! - t.at[i]!) || 1)));
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
  }
  return t.pts[0]!;
}

const far = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.z - q.z);
const RING = new Uint8Array(COLS * ROWS); // the section band (1 to SECTIONS) of each owned sample on a trail; 0 elsewhere

function build(g: Region): Trail {
  const end = arenaOf(g), own: { i: number; p: Pt; d: number }[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    if (OWNER[i] === g.n && WORLD.y[i]! > 0.3) { const p = { x: c * STEP, z: r * STEP }; own.push({ i, p, d: far(p, end) }); }
  }
  // Equal areas: rank every walkable sample by its distance from the arena; the outermost twelfth is section 1.
  const byDist = [...own].sort((a, b) => b.d - a.d), rings: typeof own[] = Array.from({ length: SECTIONS }, () => []);
  byDist.forEach((o, r) => { const k = Math.min(SECTIONS - 1, Math.floor((r / byDist.length) * SECTIONS)); rings[k]!.push(o); RING[o.i] = k + 1; });
  const start = byDist[0]?.p ?? end;
  const L = far(start, end) || 1, ux = (end.x - start.x) / L, uz = (end.z - start.z) / L;
  // A stone per ring: the sample of that ring nearest the straight line from the far edge to the arena, so the
  // path walks inward through them (and stays on the piece even when the piece is not a straight shot).
  const stones: Pt[] = rings.map((ring, k) => {
    if (k === SECTIONS - 1) return end;
    const mid = ring.reduce((a, o) => a + o.d, 0) / (ring.length || 1);
    const want = { x: end.x - ux * mid, z: end.z - uz * mid };
    return (ring.reduce((b, o) => (far(o.p, want) < far(b.p, want) ? o : b), ring[0] ?? { p: want } as (typeof own)[number])).p;
  });
  const pts = [start, ...stones], at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1]! + far(pts[i - 1]!, pts[i]!));
  return { n: g.n, pts, at, length: at.at(-1)!, stones, stoneAt: at.slice(1) };
}

/** By region number, for every playable region. */
export const TRAILS = new Map<number, Trail>(REGIONS.filter(hasTrail).map((g) => [g.n, build(g)]));

/** The section band (1 to SECTIONS) each sample of a trail's region lies in; 0 off every trail. */
export const BAND: Uint8Array = (() => {
  const band = new Uint8Array(RING);
  // Water and shore inside a piece take the band of the nearest ring by distance from the arena.
  for (const t of TRAILS.values()) {
    const a = t.stones.at(-1)!, R = (ARENA_R * 3) / STEP, edge = new Array<number>(SECTIONS).fill(0);
    const ds: number[][] = Array.from({ length: SECTIONS }, () => []);
    for (let i = 0; i < band.length; i++) if (OWNER[i] === t.n && band[i]) ds[band[i]! - 1]!.push(Math.hypot((i % COLS) * STEP - a.x, Math.floor(i / COLS) * STEP - a.z));
    ds.forEach((d, k) => { edge[k] = d.length ? Math.max(...d) : 0; });
    for (let i = 0; i < band.length; i++) if (OWNER[i] === t.n && !band[i]) {
      const d = Math.hypot((i % COLS) * STEP - a.x, Math.floor(i / COLS) * STEP - a.z);
      band[i] = Math.max(1, edge.reduce((k, e, j) => (e >= d ? j + 1 : k), 0));
    }
    // The arena's pad is the mythic's.
    for (let r = Math.floor(a.z / STEP - R); r <= Math.ceil(a.z / STEP + R); r++)
      for (let c = Math.floor(a.x / STEP - R); c <= Math.ceil(a.x / STEP + R); c++) {
        const i = r * COLS + c;
        if (r >= 0 && c >= 0 && r < ROWS && c < COLS && OWNER[i] === t.n && Math.hypot(c * STEP - a.x, r * STEP - a.z) <= R * STEP) band[i] = SECTIONS;
      }
  }
  return band;
})();

export const bandAt = (x: number, z: number) => {
  const c = Math.round(x / STEP), r = Math.round(z / STEP);
  return c < 0 || r < 0 || c >= COLS || r >= ROWS ? 0 : BAND[r * COLS + c]!;
};

/** Where you stand on a trail: the section band you're in, and whether a keeper's stone may start a fight. */
export interface Trek { band: number; armed: boolean }
export const newTrek = (me: Walker): Trek => ({ band: bandAt(me.x, me.z), armed: true });

export type TrekEvent = WalkEvent
  | { kind: "section"; region: Region; k: number }
  | { kind: "keeper"; region: Region; k: number };

/** Where to stand to carry on region n's trail with `done` sections cleared: beside the next keeper's stone. */
export function trailhead(n: number, done: number): Pt | undefined {
  const t = TRAILS.get(n);
  if (!t) return undefined;
  const k = Math.min(done, SECTIONS - 1), s = t.stones[k]!, back = t.stones[Math.max(0, k - 1)] ?? t.pts[0]!;
  // a few metres short of the stone, on the way you came
  const d = Math.hypot(back.x - s.x, back.z - s.z) || 1, off = k === 0 ? 0 : Math.min(ARENA_R * 3, d / 2);
  return k === 0 ? t.pts[0]! : { x: s.x + ((back.x - s.x) / d) * off, z: s.z + ((back.z - s.z) / d) * off };
}

/**
 * One step along the journey: world.ts's walk, with the trail's gates shut past the next uncleared section
 * (`cleared(n)` says how many of region n's are done). Adds "section" when you cross into another band and
 * "keeper" when you reach the stone of the next section to clear. A trail's arena (its mythic) only answers once the
 * eleven before it are cleared; you can't reach it sooner anyway.
 */
export function trek(me: Walker, t: Trek, dx: number, dz: number, beaten: ReadonlySet<number>, cleared: (n: number) => number): TrekEvent[] {
  const fence = (x: number, z: number) => {
    const g = regionAt(x, z);
    if (!g || !TRAILS.has(g.n) || cleared(g.n) >= SECTIONS) return false;
    const to = bandAt(x, z), here = regionAt(me.x, me.z)?.n === g.n ? bandAt(me.x, me.z) : 0;
    // Coming in from another region you land in whatever band borders it; from there only back and to the next.
    return here !== 0 && to > Math.max(here, cleared(g.n) + 1);
  };
  const out: TrekEvent[] = walk(me, dx, dz, beaten, fence).filter((e) => e.kind !== "arena" || cleared(e.region.n) >= SECTIONS - 1);
  const g = regionAt(me.x, me.z), tr = g && TRAILS.get(g.n);
  if (!g || !tr) { t.band = 0; return out; }
  const b = bandAt(me.x, me.z);
  if (b && b !== t.band) { t.band = b; out.push({ kind: "section", region: g, k: b - 1 }); }
  const k = cleared(g.n);
  if (k < SECTIONS - 1) {
    const s = tr.stones[k]!, d = Math.hypot(me.x - s.x, me.z - s.z);
    if (d < ARENA_R && t.armed) { t.armed = false; out.push({ kind: "keeper", region: g, k }); }
    else if (d > ARENA_R * 2) t.armed = true;
  }
  return out;
}

/**
 * Dens laid along each trail, PER_SECTION to a section, a little off the path either side, so every section has wild
 * ones to bind (the world's random dens are 150 m apart and leave some sections empty). They circle like the others;
 * who lives in one is the section's to say (view.ts). Those within `radius` of (x, z) at time `t`.
 */
const PER_SECTION = 3;
export function trailWilds(x: number, z: number, t: number, radius: number): Wild[] {
  const out: Wild[] = [];
  for (const tr of TRAILS.values()) for (let k = 0; k < SECTIONS - 1; k++) for (let j = 0; j < PER_SECTION; j++) {
    const s = tr.stoneAt[k]! + (j - 1) * 14, p = pointAt(tr, s), q = pointAt(tr, s + 1);
    const d = Math.hypot(q.x - p.x, q.z - p.z) || 1, side = (j % 2 ? 1 : -1) * (22 + 6 * j), ph = k * 1.7 + j * 2.3, ang = ph + t * 0.05;
    // a little off the path on one side; the other when that side is water, off the piece, or in another band
    for (const sd of [side, -side, side / 2, -side / 2]) {
      const hx = p.x - ((q.z - p.z) / d) * sd, hz = p.z + ((q.x - p.x) / d) * sd, wx = hx + Math.cos(ang) * 10, wz = hz + Math.sin(ang) * 10;
      if (Math.hypot(hx - x, hz - z) > radius + 30) break;
      if (ownerAt(wx, wz) !== tr.n || heightAt(WORLD, wx, wz) <= 0.3 || bandAt(wx, wz) !== k + 1) continue;
      out.push({ den: `trail:${tr.n}:${k}:${j}`, id: "", region: tr.n, level: 1, x: wx, z: wz, heading: ang + Math.PI / 2 });
      break;
    }
  }
  return out;
}
