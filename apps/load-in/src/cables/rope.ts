// A cable as a rope: points a fixed step apart (verlet), pulled down onto the floor, laid over the gear it crosses, and
// held at its ends by a jack, a hand or the case. Plain numbers, no three.js: the page draws `pts`, tests read them.

/** Metres between two rope points. */
export const SEG = 0.2;
const GRAVITY = 9.8, ITER = 24, FLOOR_GRIP = 0.35;
/** The cable's own thickness: it lies this far above whatever it is on. */
export const THICK = 0.006;

export type Vec = { x: number; y: number; z: number };
/** A box the rope lies on: centre on the floor, turn, and size. */
export type Solid = { x: number; z: number; y: number; rot: number; w: number; h: number; d: number };

/**
 * `feel` is the cable's weight on the floor (cables/roll.ts sets it from kg per metre): `grip` is how much of its
 * speed a point lying down keeps each tick (a feeder stops dead, a mic cable slithers), `stick` the speed in m/s a
 * lying point has to be pulled at before it moves at all, and `thick` the cable's radius. Without it: the thin rope.
 */
export interface Rope { pts: Vec[]; prev: Vec[]; lengthM: number; feel?: { grip: number; stick: number; thick: number } }

/** A rope of `lengthM`, every point at `at` (a coil in a case). */
export function newRope(lengthM: number, at: Vec): Rope {
  const n = Math.max(2, Math.ceil(lengthM / SEG) + 1);
  return { lengthM, pts: Array.from({ length: n }, () => ({ ...at })), prev: Array.from({ length: n }, () => ({ ...at })) };
}

const seg = (r: Rope) => r.lengthM / (r.pts.length - 1);

/** Lift a point out of a box onto its top, or out of its nearest side if it's below the top by more than a step. */
function lieOn(p: Vec, s: Solid, THICK: number) {
  const top = s.y + s.h + THICK;
  if (p.y >= top || p.y < s.y - 0.01) return;
  const c = Math.cos(s.rot), sn = Math.sin(s.rot), dx = p.x - s.x, dz = p.z - s.z;
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c, hw = s.w / 2 + THICK, hd = s.d / 2 + THICK;
  if (Math.abs(lx) >= hw || Math.abs(lz) >= hd) return;
  if (top - p.y < 0.12) { p.y = top; return; }
  // Snagged on a side: out the nearest face, so it wraps round the corner rather than through the box.
  const ox = hw - Math.abs(lx), oz = hd - Math.abs(lz);
  const nx = ox < oz ? Math.sign(lx) * hw : lx, nz = ox < oz ? lz : Math.sign(lz) * hd;
  p.x = s.x + nx * c + nz * sn;
  p.z = s.z - nx * sn + nz * c;
}

/**
 * One tick: gravity, the floor and the boxes, and the step between points. `pins.mid` holds one point part way along
 * (a coil's mouth, where cable leaves it: the cable hangs from there). `pins` holds the ends that are held
 * (index 0 and the last), each at a fixed place; an unpinned end lies loose.
 */
export function stepRope(r: Rope, dt: number, pins: { a?: Vec; b?: Vec; mid?: { i: number; at: Vec } }, solids: readonly Solid[]) {
  const { pts, prev } = r, n = pts.length, L = seg(r), f = r.feel, th = f?.thick ?? THICK;
  for (let i = 0; i < n; i++) {
    const p = pts[i]!, q = prev[i]!;
    // A weighted cable also grips whatever it lies on (a riser's deck), not only the floor.
    const onFloor = p.y <= th + 1e-3 || (f !== undefined && Math.abs(p.y - q.y) < 1e-5);
    const k = onFloor ? f?.grip ?? FLOOR_GRIP : 0.98;
    const vx = (p.x - q.x) * k, vy = (p.y - q.y) * 0.98, vz = (p.z - q.z) * k;
    q.x = p.x; q.y = p.y; q.z = p.z;
    p.x += vx; p.y += vy - GRAVITY * dt * dt; p.z += vz;
  }
  for (let it = 0; it < ITER; it++) {
    if (pins.a) Object.assign(pts[0]!, pins.a);
    if (pins.b) Object.assign(pts[n - 1]!, pins.b);
    if (pins.mid) Object.assign(pts[pins.mid.i]!, pins.mid.at);
    for (let i = 0; i < n - 1; i++) {
      const p = pts[i]!, q = pts[i + 1]!;
      const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, d = Math.hypot(dx, dy, dz);
      // A rope, not a rod: points closer than a step stay put (slack), farther ones pull together.
      if (d <= L || d === 0) continue;
      const pa = (i === 0 && pins.a) || pins.mid?.i === i ? 0 : 1, pb = (i + 1 === n - 1 && pins.b) || pins.mid?.i === i + 1 ? 0 : 1;
      if (pa + pb === 0) continue;
      const k = (d - L) / d / (pa + pb);
      p.x += dx * k * pa; p.y += dy * k * pa; p.z += dz * k * pa;
      q.x -= dx * k * pb; q.y -= dy * k * pb; q.z -= dz * k * pb;
    }
    for (const p of pts) {
      if (p.y < th) p.y = th;
      for (const s of solids) lieOn(p, s, th);
    }
  }
  // Static friction: a lying point the pull didn't move fast enough stays where it lay.
  if (f?.stick) for (let i = 0; i < n; i++) {
    const p = pts[i]!, q = prev[i]!;
    if (Math.abs(p.y - q.y) < 1e-4 && Math.hypot(p.x - q.x, p.z - q.z) < f.stick * dt) { p.x = q.x; p.z = q.z; }
  }
  if (pins.a) Object.assign(pts[0]!, pins.a);
  if (pins.b) Object.assign(pts[n - 1]!, pins.b);
}

/** How long the rope's path is now, end to end along its points. */
export function pathLength(r: Rope): number {
  let s = 0;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const p = r.pts[i]!, q = r.pts[i + 1]!;
    s += Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  }
  return s;
}
