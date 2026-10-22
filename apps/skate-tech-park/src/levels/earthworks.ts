// Earthworks: the skate park cut into the ground itself. A national park is mostly open land, so instead of
// only standing kit on it, we dig bowls into the meadow, pile dirt jumps, roll a pump track and cut spillway
// channels, then lay them across the whole map. Each work is a shape held at the height of the ground at its
// centre (a shelf, like a pad), blended back into the hillside over a skirt. The result is one heightfield, so
// the sim, the camera, the mesh and the map all see it without knowing it is there. On a hillside (slope 0.12 to
// 0.6) the works are cut relative to the sloped ground plane instead: yawed so local +z is uphill, their lips at
// the hill's own height and their floors cut level, so the hill itself is the transition.
import { mulberry32 } from "@rustybuns/util";
import { type Terrain } from "@rustybuns/terrain";
import type { Rail } from "../level.ts";
import { arc, clamp01, part, smooth, type At, type Part } from "./pieces.ts";
import { lane, type ScatterWorld } from "./scatter.ts";

/** What a work is laid in: poured concrete, or packed dirt. */
export type Surface = "concrete" | "hardpack";
export type WorkKind = "bowl" | "pool" | "pump" | "spillway" | "jumps" | "earthQuarter" | "mound" | "kidney" | "keyhole" | "terraced"
  | "hillQuarter" | "hillHalf" | "hillBank" | "hillSnake" | "hillShelf";

export type Earthwork = {
  kind: WorkKind; surface: Surface;
  x: number; z: number; yaw: number;
  /** Footprint (a rounded rectangle) and how far its corners are rounded. */
  w: number; d: number; cr: number;
  /** Metres it takes to blend back into the hillside beyond the footprint. */
  skirt: number;
  /** The height it is held at: the ground under its centre. */
  y0: number;
  /** Rise per metre along local +z: 0 for a work held level, the hill's slope (+z is uphill) for a slope work. */
  tilt: number;
  /** Height relative to the plane `y0 + tilt * lz` at a point in the work's own frame (+x across, +z along). */
  shape: (lx: number, lz: number) => number;
  /** 0..1 along the lip where the coping stone runs. */
  coping: (lx: number, lz: number) => number;
  /** Reach of the whole thing, skirt included. */
  reach: number;
  rails: Rail[];
  /** A slope work's line to ride, world points: in the run-in below, and the far end to ride to. */
  run?: { from: { x: number; z: number }; to: { x: number; z: number } };
};

const SKIN = 0.06;
const inFrame = (e: { x: number; z: number; yaw: number }, x: number, z: number): [number, number] => {
  const dx = x - e.x, dz = z - e.z, c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  return [dx * c - dz * s, dx * s + dz * c];
};
/** Signed distance to a rounded rectangle: negative inside. */
const sdf = (lx: number, lz: number, w: number, d: number, cr: number) => {
  const qx = Math.abs(lx) - (w / 2 - cr), qz = Math.abs(lz) - (d / 2 - cr);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - cr;
};
/** A wall's curve from the floor (0) to the lip (1): a quarter pipe, stopped short of vertical so a board can ride it. */
const wall = (t: number) => arc(0.92 * clamp01(t)) / arc(0.92);
/** Closeness to a lip: 1 on it, fading to 0 a coping-width away. */
const edge = (e: number, width = 1.6) => 1 - smooth(Math.abs(e) / width);

type Make = (at: At, r: () => number, y0: number) => Earthwork;

const work = (kind: WorkKind, surface: Surface, at: At, y0: number, o: { w: number; d: number; cr?: number; skirt?: number; tilt?: number; shape: Earthwork["shape"]; coping?: Earthwork["coping"]; rails?: (e: Earthwork) => Rail[] }): Earthwork => {
  const e: Earthwork = { kind, surface, x: at.x, z: at.z, yaw: at.yaw ?? 0, w: o.w, d: o.d, cr: o.cr ?? 0, skirt: o.skirt ?? 9, y0, tilt: o.tilt ?? 0, shape: o.shape, coping: o.coping ?? (() => 0), reach: Math.hypot(o.w, o.d) / 2 + (o.skirt ?? 9), rails: [] };
  e.rails = o.rails?.(e) ?? [];
  return e;
};
/** A local point as a world point. */
const pt = (e: { x: number; z: number; yaw: number }, lx: number, lz: number) => {
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  return { x: e.x + lx * c + lz * s, z: e.z - lx * s + lz * c };
};
/** A coping rail along the world line between two local points. */
const lip = (e: Earthwork, ax: number, az: number, bx: number, bz: number): Rail => ({ kind: "coping", a: pt(e, ax, az), b: pt(e, bx, bz), y: SKIN });

/** A pit dug to depth `h`: `inner` says how many metres in from the lip a point is (negative on the deck round it), and the wall curves down over `1.4 h`. */
const dug = (kind: WorkKind, at: At, y0: number, o: { w: number; d: number; cr: number; h: number; inner: (lx: number, lz: number) => number; rails?: (e: Earthwork) => Rail[] }) => {
  const trans = o.h * 1.4;
  return work(kind, "concrete", at, y0, {
    w: o.w, d: o.d, cr: o.cr, skirt: 10,
    shape: (lx, lz) => { const e = o.inner(lx, lz); return e <= 0 ? 0 : -o.h + o.h * wall(1 - e / trans); },
    coping: (lx, lz) => edge(o.inner(lx, lz)),
    rails: o.rails,
  });
};

/** A bowl dug into the meadow: a deck all round, then walls curving down to a flat floor. */
export const bowl = (at: At, y0: number, o: { w?: number; d?: number; h?: number; deck?: number; cr?: number } = {}): Earthwork => {
  const { w = 30, d = 22, h = 2.6, deck = 3, cr = 7 } = o, ir = Math.max(1, cr - deck);
  return dug("bowl", at, y0, {
    w, d, cr, h, inner: (lx, lz) => -sdf(lx, lz, w - 2 * deck, d - 2 * deck, ir),
    rails: (e) => { const x = w / 2 - deck - ir, z = d / 2 - deck - ir, X = w / 2 - deck, Z = d / 2 - deck; return [lip(e, -x, -Z, x, -Z), lip(e, X, -z, X, z), lip(e, x, Z, -x, Z), lip(e, -X, z, -X, -z)]; },
  });
};

/** Two round pools run together, a big lobe and a small one: the kidney of a classic backyard pool. Lobes meet in a pinch to carve through. */
export const kidney = (at: At, y0: number, o: { r1?: number; r2?: number; h?: number; deck?: number } = {}): Earthwork => {
  const { r1 = 12, r2 = 8, h = 2.6, deck = 3 } = o, c = (r1 + r2) * 0.55, R = Math.max(r1, r2);
  const lobes: [number, number][] = [[-c * (r2 / (r1 + r2)) * 2, r1], [c * (r1 / (r1 + r2)) * 2, r2]];
  return dug("kidney", at, y0, { w: 2 * (c + R), d: 2 * R, cr: R, h, inner: (lx, lz) => Math.max(...lobes.map(([cx, r]) => r - deck - Math.hypot(lx - cx, lz))) });
};

/** A round pool with a square-ended bay off one side, the keyhole in its plan: a cradle at one end, a bowl at the other. */
export const keyhole = (at: At, y0: number, o: { r?: number; bay?: number; w?: number; h?: number; deck?: number } = {}): Earthwork => {
  const { r = 10, bay = 14, w = 14, h = 2.8, deck = 3 } = o, d = 2 * r + bay, cz = -d / 2 + r, len = d / 2 - cz;
  return dug("keyhole", at, y0, {
    w: Math.max(2 * r, w), d, cr: 4, h,
    inner: (lx, lz) => Math.max(r - deck - Math.hypot(lx, lz - cz), -sdf(lx, lz - (cz + d / 2) / 2, w - 2 * deck, len - 2 * deck, 2)),
  });
};

/** A pit stepped down in three terraces, each with a lip you can grind and a ramp to the next: drop in a level at a time. */
export const terraced = (at: At, y0: number, o: { w?: number; d?: number; h?: number; run?: number; deck?: number } = {}): Earthwork => {
  const { w = 40, d = 32, h = 3.6, run = 7, deck = 3 } = o, levels = 3, ramp = 3.2, step = h / levels;
  const inner = (lx: number, lz: number) => -sdf(lx, lz, w - 2 * deck, d - 2 * deck, 3);
  return work("terraced", "concrete", at, y0, {
    w, d, cr: 4, skirt: 10,
    shape: (lx, lz) => { const e = inner(lx, lz); let down = 0; for (let k = 0; k < levels; k++) down += step * smooth((e - k * run) / ramp); return -down; },
    coping: (lx, lz) => { const e = inner(lx, lz); return Math.max(...Array.from({ length: levels }, (_, k) => edge(e - k * run))); },
    rails: (e) => Array.from({ length: levels }, (_, k) => {
      const x = w / 2 - deck - k * run - 3, z = d / 2 - deck - k * run;
      return x > 2 && z > 2 ? [lip(e, -x, -z, x, -z), lip(e, -x, z, x, z)] : [];
    }).flat(),
  });
};

/** A round pool: the same cut, with no corners. */
export const pool = (at: At, y0: number, o: { r?: number; h?: number; deck?: number } = {}): Earthwork => {
  const { r = 13, h = 2.4, deck = 3 } = o;
  return { ...bowl(at, y0, { w: 2 * r, d: 2 * r, h, deck, cr: r }), kind: "pool", rails: [] };
};

/** A row of rollers to pump along, on packed dirt: a strip whose bumps swell and fade at the ends. */
export const pump = (at: At, y0: number, o: { n?: number; period?: number; h?: number; w?: number } = {}): Earthwork => {
  const { n = 6, period = 8, h = 0.9, w = 10 } = o, d = n * period + 8;
  return work("pump", "hardpack", at, y0, {
    w, d, cr: w / 2, skirt: 6,
    shape: (lx, lz) => {
      const s = lz + d / 2 - 4;
      if (s < 0 || s > d - 8) return 0;
      return (h / 2) * (1 - Math.cos((2 * Math.PI * s) / period)) * clamp01((1 - Math.abs(lx) / (w / 2)) * 3) * smooth(Math.min(s, d - 8 - s) / period);
    },
  });
};

/** A channel cut along the hillside with a wall each side, open at both ends: a creek bed with the water left out. */
export const spillway = (at: At, y0: number, o: { w?: number; d?: number; h?: number; deck?: number } = {}): Earthwork => {
  const { w = 18, d = 56, h = 2.4, deck = 2.5 } = o, trans = h * 1.4, inner = (lx: number) => w / 2 - deck - Math.abs(lx);
  const depth = (lz: number) => h * smooth(Math.min(lz + d / 2, d / 2 - lz) / 14);
  return work("spillway", "concrete", at, y0, {
    w, d, cr: 0, skirt: 9,
    shape: (lx, lz) => { const e = inner(lx), dp = depth(lz); return e <= 0 ? 0 : -dp + dp * wall(1 - e / trans); },
    coping: (lx) => edge(inner(lx)),
    rails: (e) => [lip(e, -(w / 2 - deck), -d / 2 + 14, -(w / 2 - deck), d / 2 - 14), lip(e, w / 2 - deck, -d / 2 + 14, w / 2 - deck, d / 2 - 14)],
  });
};

/** Dirt jumps in a row: each a rising face, a flat top, a steep landing and the trough between. */
export const jumps = (at: At, y0: number, o: { n?: number; period?: number; h?: number; w?: number } = {}): Earthwork => {
  const { n = 4, period = 18, h = 1.8, w = 9 } = o, d = n * period + 10;
  return work("jumps", "hardpack", at, y0, {
    w, d, cr: w / 2, skirt: 7,
    shape: (lx, lz) => {
      const s = lz + d / 2 - 5, u = (((s % period) + period) % period) / period;
      if (s < 0 || s > n * period) return 0;
      const lump = u < 0.5 ? (u / 0.5) ** 1.7 : u < 0.62 ? 1 : u < 0.72 ? 1 - smooth((u - 0.62) / 0.1) : 0;
      return h * lump * clamp01((1 - Math.abs(lx) / (w / 2)) * 3.5);
    },
  });
};

/** A pile of earth with a quarter pipe on one face and a flat deck on top: a transition to launch off and drop in from. */
export const earthQuarter = (at: At, y0: number, o: { w?: number; d?: number; h?: number; face?: number } = {}): Earthwork => {
  const { w = 16, d = 20, h = 3.4, face = 7 } = o;
  return work("earthQuarter", "concrete", at, y0, {
    w, d, cr: 3, skirt: 10,
    shape: (lx, lz) => { const s = lz + d / 2; return h * (s < face ? wall(s / face) : 1) * smooth((w / 2 - Math.abs(lx)) / 3); },
    coping: (_, lz) => edge(lz + d / 2 - face),
    rails: (e) => [lip(e, -w / 2 + 3, -d / 2 + face, w / 2 - 3, -d / 2 + face)],
  });
};

/** A raised platform with a ramp each end: a funbox of earth. */
export const mound = (at: At, y0: number, o: { w?: number; d?: number; h?: number; ramp?: number } = {}): Earthwork => {
  const { w = 14, d = 30, h = 1.5, ramp = 8 } = o;
  return work("mound", "concrete", at, y0, {
    w, d, cr: 3, skirt: 8,
    shape: (lx, lz) => h * smooth(Math.min(lz + d / 2, d / 2 - lz) / ramp) * smooth((w / 2 - Math.abs(lx)) / 3),
    coping: (_, lz) => Math.max(edge(lz + d / 2 - ramp), edge(d / 2 - ramp - lz)),
  });
};

/** A slope work. `cut(p, lx)` is how far the ground is moved off the hill's plane at `p` metres along the fall line (uphill is +p, and `p = lz + zc`, so a work can be built round its own datum) and `lx` across it; the footprint's sides taper it away. */
const hillWork = (kind: WorkKind, at: At, y0: number, tilt: number, o: { w: number; d: number; zc?: number; cut: (p: number, lx: number) => number; coping: (p: number, lx: number) => number; rails: (e: Earthwork) => Rail[]; run?: (e: Earthwork) => Earthwork["run"] }): Earthwork => {
  const zc = o.zc ?? 0, taper = (lx: number) => smooth((o.w / 2 - Math.abs(lx)) / 3);
  const e = work(kind, "concrete", at, y0, { w: o.w, d: o.d, skirt: 9, tilt, shape: (lx, lz) => o.cut(lz + zc, lx) * taper(lx), coping: (lx, lz) => o.coping(lz + zc, lx), rails: o.rails });
  e.run = o.run?.(e);
  return e;
};
/** How long a level run-in has to be for the floor to meet the hill again: the fill at its foot stays under 0.7 m. */
const runIn = (h: number, reach: number, tilt: number) => Math.min(12, Math.max(3, (h + 0.7) / tilt - reach));
/** A bank's rounded foot: 0 before `q = 0`, then curving up to a slope of 1 at `q = k`. */
const foot = (q: number, k: number) => (q <= 0 ? 0 : q < k ? (q * q) / (2 * k) : q - k / 2);

/** A quarter pipe dug into the uphill side: a level run-in cut below, the wall curving up to a lip at the hill's own ground level, the hill behind. Ridden from downhill it is a wall to air out of and land back on the hill. */
export const hillQuarter = (at: At, y0: number, tilt: number, o: { w?: number; h?: number; back?: number } = {}): Earthwork => {
  const { w = 16, h = 2.8, back = 4 } = o, T = h * 1.4, run = runIn(h, T, tilt), d = run + T + back, lipZ = d / 2 - back, F = tilt * lipZ - h;
  return hillWork("hillQuarter", at, y0, tilt, {
    w, d,
    cut: (p) => (p >= lipZ ? 0 : (p <= lipZ - T ? F : F + h * wall((p - (lipZ - T)) / T)) - tilt * p),
    coping: (p) => edge(p - lipZ),
    rails: (e) => [lip(e, -w / 2 + 3, lipZ, w / 2 - 3, lipZ)],
    run: (e) => ({ from: pt(e, 0, -d / 2 + 2), to: pt(e, 0, lipZ + 6) }),
  });
};

/** A half pipe cut across the fall line: a level flat bottom between two walls, the uphill one taller by the hill's rise across it. Null where the hill is too steep for the uphill wall to stay under 5.4 m. */
export const hillHalf = (at: At, y0: number, tilt: number, o: { w?: number; flat?: number; low?: number } = {}): Earthwork | null => {
  const { w = 20, flat = 4, low = 1.2 } = o;
  if (tilt >= 0.55) return null;
  const hu = (tilt * flat + 1.4 * tilt * low + low) / (1 - 1.4 * tilt);
  if (hu > 5.4) return null;
  const b0 = flat / 2 + 1.4 * low, b1 = flat / 2 + 1.4 * hu, F = -tilt * b0 - low, zc = (b1 - b0) / 2;
  const rel = (p: number) => (p <= -b0 || p >= b1 ? tilt * p : p < -flat / 2 ? F + low * wall((-flat / 2 - p) / (1.4 * low)) : p <= flat / 2 ? F : F + hu * wall((p - flat / 2) / (1.4 * hu)));
  return hillWork("hillHalf", at, y0, tilt, {
    w, d: b0 + b1 + 6, zc,
    cut: (p) => rel(p) - tilt * p,
    coping: (p) => Math.max(edge(p + b0), edge(p - b1)),
    rails: (e) => [lip(e, -w / 2 + 3, -b0 - zc, w / 2 - 3, -b0 - zc), lip(e, -w / 2 + 3, b1 - zc, w / 2 - 3, b1 - zc)],
    run: (e) => ({ from: pt(e, -w / 2 + 4, -zc), to: pt(e, -w / 2 + 4 + 2, b1 - zc + 6) }),
  });
};

/** A planar bank cut into the hillside at a steeper angle than the hill, with a rounded foot and coping along its top edge. */
export const hillBank = (at: At, y0: number, tilt: number, o: { w?: number; h?: number; g?: number; back?: number } = {}): Earthwork => {
  const { w = 16, h = 2.4, g = Math.max(1, tilt + 0.6), back = 4 } = o, k = 2.5, ext = h / g + k / 2, run = runIn(h, ext, tilt), d = run + ext + back, lipZ = d / 2 - back, F = tilt * lipZ - h, p0 = lipZ - ext;
  return hillWork("hillBank", at, y0, tilt, {
    w, d,
    cut: (p) => (p >= lipZ ? 0 : F + g * foot(p - p0, k) - tilt * p),
    coping: (p) => edge(p - lipZ),
    rails: (e) => [lip(e, -w / 2 + 3, lipZ, w / 2 - 3, lipZ)],
    run: (e) => ({ from: pt(e, 0, -d / 2 + 2), to: pt(e, 0, lipZ + 6) }),
  });
};

/** A bermed channel that winds down the fall line, deeper and banked on the outside of each bend: a spillway bent along the slope. */
export const hillSnake = (at: At, y0: number, tilt: number, o: { len?: number; h?: number; amp?: number; period?: number; floor?: number } = {}): Earthwork => {
  const { len = 60, h = 2.4, amp = 4, period = 30, floor = 1.6 } = o, T = h * 1.4, half = floor + T, xc = (p: number) => amp * Math.sin((2 * Math.PI * p) / period);
  const env = (p: number) => smooth(Math.min(p + len / 2, len / 2 - p) / 12);
  return hillWork("hillSnake", at, y0, tilt, {
    w: 2 * (amp + half + 3), d: len,
    cut: (p, lx) => {
      const e = half - Math.abs(lx - xc(p)), dp = h * env(p) * (1 + 0.4 * (xc(p) / amp) * Math.max(-1, Math.min(1, (lx - xc(p)) / half)));
      return e <= 0 ? 0 : -dp + dp * wall(1 - e / T);
    },
    coping: (p, lx) => edge(half - Math.abs(lx - xc(p))),
    rails: (e) => {
      const ps = Array.from({ length: Math.floor((len - 24) / 2) + 1 }, (_, i) => -len / 2 + 12 + i * 2);
      return [-1, 1].flatMap((side) => ps.slice(1).map((p, i) => ({ ...lip(e, xc(ps[i]!) + side * half, ps[i]!, xc(p) + side * half, p), chain: true as const })));
    },
    run: (e) => ({ from: pt(e, xc(-len / 2 + 6), -len / 2 + 6), to: pt(e, xc(len / 2 - 6), len / 2 - 6) }),
  });
};

/** A level deck cut into the hill with a quarter pipe at its downhill foot, a lip to drop in off, and a steep back wall up to the hill. */
export const hillShelf = (at: At, y0: number, tilt: number, o: { w?: number; h?: number; deck?: number } = {}): Earthwork => {
  const { w = 16, h = 2.8, deck = 8 } = o, T = h * 1.4, run = runIn(h, T, tilt), gb = 1.2, k = 2, topAt = (tilt * deck + (gb * k) / 2) / (gb - tilt);
  const d = run + T + deck + topAt + 3, lipZ = -d / 2 + run + T, F = tilt * lipZ - h, Dk = tilt * lipZ, back = lipZ + deck, top = back + topAt;
  return hillWork("hillShelf", at, y0, tilt, {
    w, d,
    cut: (p) => (p >= top ? 0 : (p <= lipZ - T ? F : p < lipZ ? F + h * wall((p - (lipZ - T)) / T) : Math.min(Dk + gb * foot(p - back, k), tilt * p)) - tilt * p),
    coping: (p) => Math.max(edge(p - lipZ), edge(p - top)),
    rails: (e) => [lip(e, -w / 2 + 3, lipZ, w / 2 - 3, lipZ), lip(e, -w / 2 + 3, top, w / 2 - 3, top)],
    run: (e) => ({ from: pt(e, 0, -d / 2 + 2), to: pt(e, 0, lipZ + deck / 2) }),
  });
};

const between = (r: () => number, a: number, b: number) => a + (b - a) * r();
const pick = <T>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)]!;

/** What gets cut, and how big it comes out. Bowls and pumps repeat most, since a park is mostly those. */
const KIT: Make[] = [
  (at, r, y) => bowl(at, y, { w: between(r, 26, 38), d: between(r, 20, 28), h: between(r, 2.2, 3.2) }),
  (at, r, y) => bowl(at, y, { w: between(r, 24, 32), d: between(r, 24, 32), h: between(r, 2, 2.8), cr: 12 }),
  (at, r, y) => pool(at, y, { r: between(r, 11, 16), h: between(r, 2, 3) }),
  (at, r, y) => pump(at, y, { n: Math.round(between(r, 5, 8)), h: between(r, 0.7, 1.1) }),
  (at, r, y) => spillway(at, y, { w: between(r, 16, 22), d: between(r, 44, 70), h: between(r, 2, 3) }),
  (at, r, y) => jumps(at, y, { n: Math.round(between(r, 3, 5)), h: between(r, 1.4, 2.2) }),
  (at, r, y) => earthQuarter(at, y, { w: between(r, 14, 20), h: between(r, 3, 4.4) }),
  (at, r, y) => mound(at, y, { w: between(r, 12, 18), d: between(r, 26, 36), h: between(r, 1.2, 1.9) }),
  // into the earth: deep, steep and odd-shaped
  (at, r, y) => kidney(at, y, { r1: between(r, 10, 14), r2: between(r, 6, 9), h: between(r, 2.2, 3.2) }),
  (at, r, y) => keyhole(at, y, { r: between(r, 8, 11), bay: between(r, 10, 16), w: between(r, 12, 16), h: between(r, 2.4, 3.4) }),
  (at, r, y) => terraced(at, y, { w: between(r, 36, 44), d: between(r, 28, 36) }),
  (at, r, y) => bowl(at, y, { w: between(r, 22, 28), d: between(r, 22, 28), h: between(r, 4, 5), cr: 10 }), // a deep vert bowl
  (at, r, y) => pool(at, y, { r: between(r, 6, 8), h: between(r, 3.4, 4.4) }), // a cradle
  (at, r, y) => spillway(at, y, { w: between(r, 12, 15), d: between(r, 50, 70), h: between(r, 3.8, 5) }), // a storm drain
  // the small ones fit where the big ones don't
  (at, r, y) => pool(at, y, { r: between(r, 7, 9), h: between(r, 1.6, 2.2) }),
  (at, r, y) => bowl(at, y, { w: between(r, 16, 20), d: between(r, 14, 18), h: between(r, 1.6, 2.2), cr: 5 }),
  (at, r, y) => pump(at, y, { n: 3, h: 0.8, w: 8 }),
  (at, r, y) => earthQuarter(at, y, { w: between(r, 10, 12), d: 14, h: between(r, 2.2, 3), face: 5 }),
  (at, r, y) => mound(at, y, { w: 10, d: between(r, 18, 22), h: 1.1, ramp: 6 }),
];

/** What gets cut on a hillside, given the hill's slope: null where a shape can't fit it. */
type Cut = (at: At, r: () => number, y: number, tilt: number) => Earthwork | null;
const HILLSIDE: Cut[] = [
  (at, r, y, t) => hillQuarter(at, y, t, { w: between(r, 14, 20), h: between(r, 2.2, 3.6) }),
  (at, r, y, t) => hillQuarter(at, y, t, { w: between(r, 12, 16), h: between(r, 1.8, 2.6) }),
  (at, r, y, t) => hillHalf(at, y, t, { w: between(r, 18, 24), flat: between(r, 3, 5), low: between(r, 1, 1.5) }),
  (at, r, y, t) => hillBank(at, y, t, { w: between(r, 14, 22), h: between(r, 1.8, 3) }),
  (at, r, y, t) => hillSnake(at, y, t, { len: between(r, 50, 72), h: between(r, 2, 3), amp: between(r, 3, 5) }),
  (at, r, y, t) => hillShelf(at, y, t, { w: between(r, 14, 20), h: between(r, 2.2, 3.4) }),
];

/** The hill's plane under a spot, fitted over a 24 m square: its height there, its gradient, and how far the real ground strays from it. */
export function hillPlane(ground: (x: number, z: number) => number, x: number, z: number, half = 12) {
  const n = 5, pts: { dx: number; dz: number; h: number }[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const dx = ((i / (n - 1)) * 2 - 1) * half, dz = ((j / (n - 1)) * 2 - 1) * half; pts.push({ dx, dz, h: ground(x + dx, z + dz) }); }
  const y0 = pts.reduce((a, p) => a + p.h, 0) / pts.length, sxx = pts.reduce((a, p) => a + p.dx * p.dx, 0), szz = pts.reduce((a, p) => a + p.dz * p.dz, 0);
  const gx = pts.reduce((a, p) => a + p.dx * p.h, 0) / sxx, gz = pts.reduce((a, p) => a + p.dz * p.h, 0) / szz;
  return { y0, slope: Math.hypot(gx, gz), yaw: Math.atan2(gx, gz), off: Math.max(...pts.map((p) => Math.abs(p.h - (y0 + gx * p.dx + gz * p.dz)))) };
}

export const HILL = { min: 0.12, max: 0.6, off: 0.6 };

export type Works = { cell?: number; fill?: number; slope?: number; seed?: number };
export const WORKS: Required<Works> = { cell: 30, fill: 0.95, slope: 0.2, seed: 5 };

/** An earthwork as circles on the ground, skirt included: a long one is a line of them, so a pump track doesn't hide a whole cell. */
export function circles(e: Earthwork) {
  const long = Math.max(e.w, e.d), short = Math.min(e.w, e.d), n = Math.max(1, Math.ceil(long / short)), c = Math.cos(e.yaw), s = Math.sin(e.yaw), along = e.d >= e.w ? [s, c] : [c, -s];
  return Array.from({ length: n }, (_, i) => { const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * (long - short); return { x: e.x + along[0]! * t, z: e.z + along[1]! * t, r: short / 2 + e.skirt }; });
}

/** Where the earthworks go: one per cell of a jittered grid over the whole bounds, on ground gentle enough to cut, clear of everything already there. */
export function layOut(world: ScatterWorld, o: Works = {}): Earthwork[] {
  const { cell, fill, slope, seed } = { ...WORKS, ...o }, r = mulberry32(seed), b = world.bounds;
  const taken = [...world.taken, ...(world.lanes ?? []).flatMap(lane), ...world.spawns.map((s) => ({ x: s.x, z: s.z, r: 16 }))], made: Earthwork[] = [];
  for (let x0 = b.minX; x0 + cell <= b.maxX; x0 += cell) for (let z0 = b.minZ; z0 + cell <= b.maxZ; z0 += cell) {
    if (r() > fill) continue;
    // a cell tries a few spots and kits before giving up, so a crowded meadow still gets the smaller things
    for (let tries = 0; tries < 10; tries++) {
      const at = { x: x0 + cell * between(r, 0.2, 0.8), z: z0 + cell * between(r, 0.2, 0.8), yaw: (Math.PI / 4) * Math.floor(r() * 8) };
      // a real hillside gets works cut into it, yawed so uphill is local +z; gentle ground keeps the level kit
      const hill = hillPlane(world.ground, at.x, at.z), onHill = hill.slope >= HILL.min && hill.slope <= HILL.max && hill.off <= HILL.off;
      if (hill.slope > HILL.min && !onHill) continue;
      const e = onHill ? pick(r, HILLSIDE)({ ...at, yaw: hill.yaw }, r, hill.y0, hill.slope) : pick(r, KIT)(at, r, world.ground(at.x, at.z));
      if (!e) continue;
      const reach = e.reach;
      const inside = reach - e.skirt + 2; // the skirt may run past the bounds; the work itself may not
      if (at.x - inside < b.minX || at.x + inside > b.maxX || at.z - inside < b.minZ || at.z + inside > b.maxZ) continue;
      if (Math.hypot(at.x, at.z) + reach > world.R * 0.95) continue;
      const half = Math.sqrt(e.w * e.d) / 2, hs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].map(([dx, dz]) => world.ground(at.x + dx! * half, at.z + dz! * half));
      if (!onHill && Math.max(...hs) - Math.min(...hs) > slope * 2 * half) continue;
      const line = circles(e);
      if (line.some((k) => taken.some((t) => Math.hypot(k.x - t.x, k.z - t.z) < k.r + t.r))) continue;
      made.push(e);
      taken.push(...line);
      break;
    }
  }
  return made;
}

/** The ground with the earthworks cut into it. */
export function sculpt(t: Terrain, works: Earthwork[]): Terrain {
  if (!works.length) return t;
  return {
    ...t,
    height(x, z) {
      let h = t.height(x, z);
      for (const e of works) {
        if (Math.abs(x - e.x) > e.reach || Math.abs(z - e.z) > e.reach) continue;
        const [lx, lz] = inFrame(e, x, z), dist = sdf(lx, lz, e.w, e.d, e.cr);
        if (dist >= e.skirt) continue;
        h += (dist <= 0 ? 1 : 1 - smooth(dist / e.skirt)) * (e.y0 + e.tilt * lz + e.shape(lx, lz) - h);
      }
      return h;
    },
  };
}

/** What a point on the ground is made of, for painting it: concrete or packed dirt (or neither), how strongly, and the coping stone along a lip. */
export type Paint = { surface: Surface | null; k: number; coping: number };
const BARE: Paint = { surface: null, k: 0, coping: 0 };

export function paintAt(works: Earthwork[], x: number, z: number): Paint {
  for (const e of works) {
    if (Math.abs(x - e.x) > e.reach || Math.abs(z - e.z) > e.reach) continue;
    const [lx, lz] = inFrame(e, x, z), dist = sdf(lx, lz, e.w, e.d, e.cr);
    if (dist >= 1.5) continue;
    const coping = e.coping(lx, lz), k = 1 - smooth(Math.max(0, dist) / 1.5);
    // a slope work is poured only where it moved the hill (and along its lips); the hill behind stays hill
    return { surface: e.surface, k: e.tilt ? k * Math.max(smooth(Math.abs(e.shape(lx, lz)) / 0.3), coping) : k, coping };
  }
  return BARE;
}

/** The coping rails of every work, at skin height above the floor (the caller drapes them). */
export const copings = (works: Earthwork[]): Part => part({ rails: works.flatMap((e) => e.rails) });
