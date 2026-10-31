// A playable region's trail: a switchback across its piece from where you come in to its arena, cut into the
// journey's twelve sections (src/journey.ts). Every sample of the piece belongs to the section of the nearest point on
// the trail, so a section is a broad band of open country, not a corridor; you may roam it freely, but the next
// band stays shut until you beat (or bind) the keeper on its stone. The last band holds the arena and its mythic.
// Railroaded, but open. No three.js: view.ts draws it, the tests walk it.
import { hasTrail, SECTIONS } from "../journey.ts";
import { REGIONS, type Region } from "../regions.ts";
import ground from "./ground.json";
import { ARENA_R, arenaOf, buildWorld, COLS, heightAt, neighbours, ownerAt, OWNER, regionAt, ROWS, STEP, walk, type WalkEvent, type Walker, type Wild } from "./world.ts";

/** The world's ground, built once here for the trails and handed to view.ts. */
export const WORLD = buildWorld(ground);

export interface Pt { x: number; z: number }
export interface Trail {
  n: number;
  /** The switchback, start to arena. */
  pts: Pt[];
  /** Metres along the trail at each point. */
  at: number[];
  length: number;
  /** Where each section's keeper stands; the last is the arena. */
  stones: Pt[];
}
const LEGS = 4; // switchbacks across the piece

/** The nearest point on the polyline to (x, z): metres along it and metres away. */
function along(t: Pick<Trail, "pts" | "at">, x: number, z: number): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i + 1 < t.pts.length; i++) {
    const a = t.pts[i]!, b = t.pts[i + 1]!, ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1;
    const u = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2)), px = a.x + ex * u, pz = a.z + ez * u;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { s: t.at[i]! + Math.sqrt(l2) * u, d };
  }
  return best;
}
/** The point `s` metres along the trail. */
export function pointAt(t: Pick<Trail, "pts" | "at">, s: number): Pt {
  for (let i = 0; i + 1 < t.pts.length; i++) if (s <= t.at[i + 1]! || i + 2 === t.pts.length) {
    const a = t.pts[i]!, b = t.pts[i + 1]!, u = Math.max(0, Math.min(1, (s - t.at[i]!) / ((t.at[i + 1]! - t.at[i]!) || 1)));
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
  }
  return t.pts[0]!;
}

function build(g: Region): Trail {
  const own: Pt[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (OWNER[r * COLS + c] === g.n && WORLD.y[r * COLS + c]! > 0.3) own.push({ x: c * STEP, z: r * STEP });
  const end = arenaOf(g);
  // Start on the side you come in from: nearest the arena of the region before it on the route, else as far from
  // the arena as the piece goes. Pulled a little inside so the first stone isn't on the border.
  const from = neighbours(g).filter((o) => o.n < g.n && o.tier !== "coming-soon").sort((p, q) => p.n - q.n)[0];
  const far = (p: Pt, q: Pt) => Math.hypot(p.x - q.x, p.z - q.z);
  const edge = from ? own.reduce((b, p) => (far(p, arenaOf(from)) < far(b, arenaOf(from)) ? p : b)) : own.reduce((b, p) => (far(p, end) > far(b, end) ? p : b));
  const start = { x: edge.x + (end.x - edge.x) * 0.08, z: edge.z + (end.z - edge.z) * 0.08 };
  const L = far(start, end) || 1, ux = (end.x - start.x) / L, uz = (end.z - start.z) / L, vx = -uz, vz = ux;
  const pts: Pt[] = [start];
  for (let j = 0; j < LEGS; j++) {
    const s = ((j + 0.5) / LEGS) * L * 0.92;
    const ts = own.filter((p) => Math.abs((p.x - start.x) * ux + (p.z - start.z) * uz - s) < STEP * 1.5)
      .map((p) => (p.x - start.x) * vx + (p.z - start.z) * vz).sort((a, b) => a - b);
    if (!ts.length) continue;
    const q = (f: number) => ts[Math.floor(f * (ts.length - 1))]!, mid = (q(0.15) + q(0.85)) / 2;
    const lo = mid + (q(0.15) - mid) * 0.8, hi = mid + (q(0.85) - mid) * 0.8;
    for (const t of j % 2 ? [hi, lo] : [lo, hi]) pts.push({ x: start.x + ux * s + vx * t, z: start.z + uz * s + vz * t });
  }
  pts.push(end);
  const at = [0];
  for (let i = 1; i < pts.length; i++) at.push(at[i - 1]! + far(pts[i - 1]!, pts[i]!));
  const length = at.at(-1)!, line = { pts, at };
  const stones = Array.from({ length: SECTIONS }, (_, k) => (k === SECTIONS - 1 ? end : pointAt(line, ((k + 0.55) / SECTIONS) * length)));
  return { n: g.n, pts, at, length, stones };
}

/** By region number, for every playable region. */
export const TRAILS = new Map<number, Trail>(REGIONS.filter(hasTrail).map((g) => [g.n, build(g)]));

/** The section band (1 to SECTIONS) each sample of a trail's region lies in; 0 off every trail. */
export const BAND: Uint8Array = (() => {
  const band = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < band.length; i++) {
    const t = TRAILS.get(OWNER[i]!);
    if (!t) continue;
    const { s } = along(t, (i % COLS) * STEP, Math.floor(i / COLS) * STEP);
    band[i] = Math.min(SECTIONS, Math.floor((s / t.length) * SECTIONS) + 1);
  }
  // The arena's pad is the mythic's, whatever the switchback's last leg passes near.
  for (const t of TRAILS.values()) {
    const a = t.stones.at(-1)!, R = (ARENA_R * 3) / STEP;
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
    const s = ((k + (j + 0.5) / PER_SECTION) / SECTIONS) * tr.length, p = pointAt(tr, s), q = pointAt(tr, s + 1);
    const d = Math.hypot(q.x - p.x, q.z - p.z) || 1, side = (j % 2 ? 1 : -1) * (22 + 6 * j);
    const hx = p.x - ((q.z - p.z) / d) * side, hz = p.z + ((q.x - p.x) / d) * side;
    if (Math.hypot(hx - x, hz - z) > radius + 30) continue;
    const ph = k * 1.7 + j * 2.3, ang = ph + t * 0.05, wx = hx + Math.cos(ang) * 10, wz = hz + Math.sin(ang) * 10;
    if (ownerAt(wx, wz) !== tr.n || heightAt(WORLD, wx, wz) <= 0.3) continue;
    out.push({ den: `trail:${tr.n}:${k}:${j}`, id: "", region: tr.n, level: 1, x: wx, z: wz, heading: ang + Math.PI / 2 });
  }
  return out;
}
