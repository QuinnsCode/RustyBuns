// Dressing a cable: laying it the way a tidy crew does once it works. You trace the path with your finger and the
// cable lies on it: as you drew it ("free"), or squared up to the room ("square", right angles only) or to 45s
// ("diag"), each bend no tighter than the cable takes, a straight run pushed flat against a wall or riser edge it
// runs beside, laid next to (never on) a cable already dressed there, and the length left over coiled in one neat
// loop by the gear end, where the next person can pull slack to move it. `neatness` scores a floor of cables, loose
// or dressed: how much of their length runs square to the room, and how often two cross. Plain numbers on the
// floor plane (x, z), so both games (Sound Guy Simulator, Qollab Studio) and the tests read the same thing.

export type FloorPt = { x: number; z: number };
/** A point of a dressed cable, `lift` metres off the floor (the turns of its slack loop lie on each other). */
export type LaidPt = FloorPt & { lift: number };
/** How a traced path is laid: as drawn, square to the room, or square and 45s. */
export type Snap = "free" | "square" | "diag";
/** An edge a cable can be pushed flat against: the foot of a wall, the lip of a riser, a desk leg's line. */
export type Edge = { a: FloorPt; b: FloorPt };

export interface DressOpts {
  snap: Snap;
  /** The tightest bend the cable takes, metres (a mic cable about 5 cm, a power feeder 15). */
  bend: number;
  /** The cable's thickness, metres: how far apart two dressed side by side lie, and how high a loop's turns stack. */
  thick: number;
  /** Edges a straight run within `hugM` of is pushed flat against. */
  edges?: readonly Edge[];
  hugM?: number;
  /** Routes already dressed on this floor: a run lying on one moves over to lie beside it. */
  beside?: readonly (readonly FloorPt[])[];
}

/** A dressed cable: the route it lies on (jack to jack, bends rounded), its points for the rope, the slack coiled. */
export interface Dressed { route: FloorPt[]; pts: LaidPt[]; slackM: number }
/** The cable doesn't reach along that path: it is `shortM` too short. */
export interface Short { shortM: number }

const len = (a: FloorPt, b: FloorPt) => Math.hypot(b.x - a.x, b.z - a.z);
export function pathLen(pts: readonly FloorPt[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += len(pts[i - 1]!, pts[i]!);
  return s;
}

/** Ramer-Douglas-Peucker: the corners of a traced line, every point within `tol` of the line through them. Indices into `pts`. */
export function corners(pts: readonly FloorPt[], tol: number): number[] {
  if (pts.length < 3) return pts.map((_, i) => i);
  const keep = new Set([0, pts.length - 1]);
  const go = (i: number, j: number) => {
    const a = pts[i]!, b = pts[j]!, l = len(a, b);
    let far = -1, at = -1;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k]!, d = l < 1e-9 ? len(a, p) : Math.abs((b.x - a.x) * (a.z - p.z) - (a.x - p.x) * (b.z - a.z)) / l;
      if (d > far) { far = d; at = k; }
    }
    if (far > tol) { keep.add(at); go(i, at); go(at, j); }
  };
  go(0, pts.length - 1);
  return [...keep].sort((x, y) => x - y);
}

/**
 * The bends between `a` and `b` that keep every run square (or 45, for "diag"): one elbow, the one of the two ways
 * round nearest where the trace went (`near`). None when a and b already line up.
 */
function elbow(a: FloorPt, b: FloorPt, snap: "square" | "diag", near: FloorPt): FloorPt[] {
  const dx = b.x - a.x, dz = b.z - a.z, ax = Math.abs(dx), az = Math.abs(dz), e = 1e-6;
  if (ax < e || az < e || (snap === "diag" && Math.abs(ax - az) < e)) return [];
  let ways: FloorPt[];
  if (snap === "square") ways = [{ x: b.x, z: a.z }, { x: a.x, z: b.z }];
  else {
    // A straight run along the long side and a 45 for the rest, the straight first or last.
    const m = Math.min(ax, az), sx = Math.sign(dx), sz = Math.sign(dz);
    const straight = ax > az ? { x: (ax - m) * sx, z: 0 } : { x: 0, z: (az - m) * sz };
    ways = [{ x: a.x + straight.x, z: a.z + straight.z }, { x: b.x - straight.x, z: b.z - straight.z }];
  }
  return [ways.reduce((p, q) => (len(q, near) < len(p, near) ? q : p))];
}

/** Move `c` onto the axis through `fixed` when the run between them is within ~8 degrees of it (a hand's shake). */
function line(fixed: FloorPt, c: FloorPt, out: FloorPt): void {
  const dx = Math.abs(c.x - fixed.x), dz = Math.abs(c.z - fixed.z);
  if (dz < 0.15 * dx) out.z = fixed.z;
  else if (dx < 0.15 * dz) out.x = fixed.x;
}

/** Drop points that don't turn the route (and folds back over itself), and points on top of each other. */
function straighten(pts: FloorPt[]): FloorPt[] {
  const out: FloorPt[] = [];
  for (const p of pts) {
    if (out.length && len(out.at(-1)!, p) < 1e-6) continue;
    while (out.length >= 2) {
      const a = out.at(-2)!, b = out.at(-1)!;
      const cross = (b.x - a.x) * (p.z - b.z) - (b.z - a.z) * (p.x - b.x);
      if (Math.abs(cross) > 1e-6 * Math.max(1, len(a, b) * len(b, p))) break;
      out.pop();
    }
    out.push(p);
  }
  return out;
}

const AXIS = 1e-6;
const axisOf = (a: FloorPt, b: FloorPt): "x" | "z" | null => (Math.abs(a.z - b.z) < AXIS ? "x" : Math.abs(a.x - b.x) < AXIS ? "z" : null);

/**
 * Move straight runs of a squared route sideways: flat against an edge within `hugM`, and off any dressed cable they
 * would lie on, to lie `thick` beside it. Only runs between two right-angle bends move (the bends either side just
 * get longer or shorter), never the first or last, whose ends are in jacks.
 */
function nudge(route: FloorPt[], o: DressOpts) {
  const lines: { axis: "x" | "z"; at: number; lo: number; hi: number }[] = [];
  const lineOf = (a: FloorPt, b: FloorPt) => {
    const axis = axisOf(a, b);
    if (!axis) return null;
    const along = axis === "x" ? [a.x, b.x] : [a.z, b.z];
    return { axis, at: axis === "x" ? a.z : a.x, lo: Math.min(...along), hi: Math.max(...along) };
  };
  for (const r of o.beside ?? []) for (let i = 1; i < r.length; i++) { const l = lineOf(r[i - 1]!, r[i]!); if (l) lines.push(l); }
  const edges = (o.edges ?? []).map((e) => lineOf(e.a, e.b)).filter((l) => l !== null);
  for (let i = 1; i < route.length - 2; i++) {
    const a = route[i]!, b = route[i + 1]!, me = lineOf(a, b);
    if (!me || axisOf(route[i - 1]!, a) === me.axis || axisOf(b, route[i + 2]!) === me.axis) continue;
    const overlaps = (l: typeof me) => l.axis === me.axis && Math.min(l.hi, me.hi) - Math.max(l.lo, me.lo) > o.thick;
    let at = me.at;
    const edge = edges.filter(overlaps).sort((p, q) => Math.abs(p.at - at) - Math.abs(q.at - at))[0];
    if (edge && Math.abs(edge.at - at) < (o.hugM ?? 0.3)) at = edge.at + Math.sign(at - edge.at || 1) * o.thick;
    // Off every dressed cable it would lie on, to the side it is already on.
    for (let tries = 0; tries < 16; tries++) {
      const on = lines.find((l) => overlaps(l) && Math.abs(l.at - at) < o.thick * 0.99);
      if (!on) break;
      at = on.at + Math.sign(at - on.at || 1) * o.thick;
    }
    if (me.axis === "x") { a.z = at; b.z = at; } else { a.x = at; b.x = at; }
  }
}

/** Each bend rounded to no tighter than `r` (or as tight as the runs either side leave room for). */
export function roundBends(route: readonly FloorPt[], r: number): FloorPt[] {
  if (route.length < 3 || r <= 0) return route.map((p) => ({ ...p }));
  const out: FloorPt[] = [{ ...route[0]! }];
  for (let i = 1; i < route.length - 1; i++) {
    const p = route[i - 1]!, v = route[i]!, q = route[i + 1]!;
    const l1 = len(p, v), l2 = len(v, q);
    const ux = (v.x - p.x) / l1, uz = (v.z - p.z) / l1, wx = (q.x - v.x) / l2, wz = (q.z - v.z) / l2;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * wx + uz * wz)));
    // How far back from the corner the bend starts: r tan(turn / 2), and no more than half of either run.
    const t = Math.min(r * Math.tan(turn / 2), l1 / 2, l2 / 2);
    const s = { x: v.x - ux * t, z: v.z - uz * t }, e = { x: v.x + wx * t, z: v.z + wz * t };
    const steps = Math.max(2, Math.ceil(turn / 0.2));
    for (let k = 0; k <= steps; k++) {
      const f = k / steps, g = 1 - f;
      out.push({ x: g * g * s.x + 2 * g * f * v.x + f * f * e.x, z: g * g * s.z + 2 * g * f * v.z + f * f * e.z });
    }
  }
  out.push({ ...route.at(-1)! });
  return out;
}

/** A traced line as drawn, without the shake: every point within 2 cm of it, then two passes of corner cutting. */
function smooth(pts: FloorPt[]): FloorPt[] {
  let p = corners(pts, 0.02).map((i) => pts[i]!);
  for (let pass = 0; pass < 2; pass++) {
    const q: FloorPt[] = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!, b = p[i + 1]!;
      if (i > 0) q.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      if (i < p.length - 2) q.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    q.push(p.at(-1)!);
    p = q;
  }
  return p;
}

/**
 * The route a cable from jack `a` to jack `b` lies on when you trace `trace` over the floor (in either direction;
 * its ends need not touch the jacks). Before the bends are rounded: its corners, for the next cable to lie beside.
 */
export function routeOf(a: FloorPt, b: FloorPt, trace: readonly FloorPt[], o: DressOpts): FloorPt[] {
  let t = [...trace];
  if (t.length && len(t[0]!, b) + len(t.at(-1)!, a) < len(t[0]!, a) + len(t.at(-1)!, b)) t.reverse();
  const all = [a, ...t, b];
  if (o.snap === "free") return smooth(all);
  // The trace's corners, then a squared elbow between each two, turned the way the trace went round.
  const at = corners(all, 0.25);
  const route: FloorPt[] = [{ ...a }];
  for (let k = 1; k < at.length; k++) {
    const i = at[k - 1]!, j = at[k]!, mid = all[Math.round((i + j) / 2)]!, prev = route.at(-1)!;
    // A corner of the shaky trace lines up with the run into it, and with the jack when the next run is the last.
    const c = { ...all[j]! };
    if (k < at.length - 1) {
      line(prev, c, c);
      if (k === at.length - 2) line(b, c, c);
    }
    route.push(...elbow(prev, c, o.snap, mid), c);
  }
  const r = straighten(route);
  nudge(r, o);
  return straighten(r);
}

/**
 * Dress a cable `lengthM` long from `a` to `b` along `trace`: the rounded route, and its `n` rope points (one every
 * lengthM / (n - 1) metres, as the rope has them) laid along it. The cable left over goes in a loop half a metre
 * before `b`, turns stacked on each other; too little for a loop and it lies gathered at the jack.
 */
export function dress(a: FloorPt, b: FloorPt, trace: readonly FloorPt[], lengthM: number, n: number, o: DressOpts): Dressed | Short {
  const corner = routeOf(a, b, trace, o), route = o.snap === "free" ? corner : roundBends(corner, o.bend);
  const run = pathLen(route);
  if (run > lengthM + 1e-6) return { shortM: run - lengthM };
  const slack = lengthM - run;
  // The path the rope's points walk: the route, with the loop spliced in where it starts.
  const path: LaidPt[] = [];
  const loopAt = Math.max(0, run - Math.min(0.5, run * 0.3));
  let walked = 0, looped = slack < 0.15;
  for (let i = 0; i < route.length; i++) {
    const p = route[i]!;
    if (i > 0 && !looped) {
      const q = route[i - 1]!, l = len(q, p);
      if (walked + l >= loopAt) {
        const f = l > 0 ? (loopAt - walked) / l : 0, m = { x: q.x + (p.x - q.x) * f, z: q.z + (p.z - q.z) * f };
        path.push({ ...m, lift: 0 }, ...loop(m, { x: (p.x - q.x) / (l || 1), z: (p.z - q.z) / (l || 1) }, slack, o.thick));
        looped = true;
      }
      walked += l;
    }
    path.push({ ...p, lift: 0 });
  }
  return { route: corner, pts: resample(path, lengthM / Math.max(1, n - 1), n), slackM: slack };
}

/** The slack as whole turns of a loop lying beside the route at `m` (heading `u`), ~22 cm across, each on the last. */
function loop(m: FloorPt, u: FloorPt, slack: number, thick: number): LaidPt[] {
  const turns = Math.max(1, Math.round(slack / (2 * Math.PI * 0.22))), r = slack / (2 * Math.PI * turns);
  // Off to the left of the run, the loop's first point at m, heading along the run.
  const c = { x: m.x - u.z * r, z: m.z + u.x * r }, start = Math.atan2(m.z - c.z, m.x - c.x), steps = Math.max(12, Math.ceil(r * 60));
  const out: LaidPt[] = [];
  for (let k = 1; k <= turns * steps; k++) {
    // Angle up from the start heads along u (the centre is on u's left), so the loop leaves the run without a kink.
    const ang = start + (k / steps) * 2 * Math.PI;
    out.push({ x: c.x + Math.cos(ang) * r, z: c.z + Math.sin(ang) * r, lift: thick * Math.floor((k - 1) / steps) });
  }
  return out;
}

/** `n` points `step` apart along a path (by its own length); points past its end sit at its end. */
function resample(path: readonly LaidPt[], step: number, n: number): LaidPt[] {
  const out: LaidPt[] = [{ ...path[0]! }];
  let i = 1;
  for (let k = 1; k < n; k++) {
    let want = step, p = out.at(-1)!;
    while (i < path.length) {
      const q = path[i]!, l = Math.hypot(q.x - p.x, q.z - p.z);
      if (l >= want) {
        const f = want / l;
        p = { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f, lift: p.lift + (q.lift - p.lift) * f };
        want = 0;
        break;
      }
      want -= l; p = q; i++;
    }
    out.push(want > 0 ? { ...path.at(-1)! } : p);
  }
  return out;
}

/** Where the gaffer tape goes on a dressed route: 30 cm off each jack, then at least every `every` metres. Each with its heading. */
export function tapes(route: readonly FloorPt[], every = 1.2): { at: FloorPt; yaw: number }[] {
  const total = pathLen(route), out: { at: FloorPt; yaw: number }[] = [];
  if (total < 0.7) return out;
  const n = Math.max(1, Math.ceil((total - 0.6) / every)), marks = Array.from({ length: n + 1 }, (_, k) => 0.3 + ((total - 0.6) * k) / n);
  let walked = 0, i = 1;
  for (const s of marks) {
    while (i < route.length - 1 && walked + len(route[i - 1]!, route[i]!) < s) { walked += len(route[i - 1]!, route[i]!); i++; }
    const p = route[i - 1]!, q = route[i]!, l = len(p, q) || 1, f = Math.min(1, (s - walked) / l);
    out.push({ at: { x: p.x + (q.x - p.x) * f, z: p.z + (q.z - p.z) * f }, yaw: Math.atan2(q.x - p.x, q.z - p.z) });
  }
  return out;
}

/** Where segments pq and rs cross, or null. */
function crosses(p: FloorPt, q: FloorPt, r: FloorPt, s: FloorPt): FloorPt | null {
  const d = (q.x - p.x) * (s.z - r.z) - (q.z - p.z) * (s.x - r.x);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((r.x - p.x) * (s.z - r.z) - (r.z - p.z) * (s.x - r.x)) / d, u = ((r.x - p.x) * (q.z - p.z) - (r.z - p.z) * (q.x - p.x)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1 ? { x: p.x + t * (q.x - p.x), z: p.z + t * (q.z - p.z) } : null;
}

/**
 * How tidy a floor of cables is (each a line of rope points on the floor): `square` is the share of their length that
 * runs square to the room (within 4 degrees, 45s too when `diag`), `crossings` how many times two cross away from
 * their jacks, and `score` the two together out of 100, the number the OCD meter shows.
 */
export function neatness(cables: readonly (readonly FloorPt[])[], diag = false): { square: number; crossings: number; score: number } {
  let straight = 0, total = 0;
  const grid = diag ? Math.PI / 4 : Math.PI / 2, tol = (4 * Math.PI) / 180;
  const lines = cables.map((c) => thin(c, 0.05));
  for (const c of lines) for (let i = 1; i < c.length; i++) {
    const a = c[i - 1]!, b = c[i]!, l = len(a, b);
    const ang = Math.atan2(b.z - a.z, b.x - a.x), off = Math.abs(ang - Math.round(ang / grid) * grid);
    total += l;
    if (off < tol) straight += l;
  }
  // Two cables meeting at the same jack or gear isn't a crossing: only count past 30 cm from any cable's ends.
  const ends = cables.flatMap((c) => (c.length ? [c[0]!, c.at(-1)!] : []));
  const away = (p: FloorPt) => ends.every((e) => len(e, p) > 0.3);
  let crossings = 0;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const A = lines[i]!, B = lines[j]!;
    for (let k = 1; k < A.length; k++) for (let m = 1; m < B.length; m++) {
      const x = crosses(A[k - 1]!, A[k]!, B[m - 1]!, B[m]!);
      if (x && away(x)) crossings++;
    }
  }
  const square = total > 0 ? straight / total : 1;
  return { square, crossings, score: Math.max(0, Math.round(square * 100 - crossings * 8)) };
}

/** Every point at least `step` from the last kept one (rope points sit 20 cm apart; a loop's are closer). */
function thin(pts: readonly FloorPt[], step: number): FloorPt[] {
  const out: FloorPt[] = [];
  for (const p of pts) if (!out.length || len(out.at(-1)!, p) >= step) out.push(p);
  if (pts.length && out.at(-1) !== pts.at(-1)) out.push(pts.at(-1)!);
  return out;
}
