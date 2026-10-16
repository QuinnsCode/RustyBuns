// The piece kit for arcade-skate-park lines: every item is a pure height function plus rail segments,
// sized and rotated by `at` (centre x, z and yaw; local +z points along (sin yaw, cos yaw)). Parts are
// built on a floor at 0; park.ts lifts them onto the pad they stand on.
import { type Piece, type PieceKind, type Rail, type RailKind, piece } from "../level.ts";

export type At = { x: number; z: number; yaw?: number };

/** Score for taking off within `r` of `a` (the launch's centre) and landing within `rb` of `b` (the landing's); */
export type Gap = { name: string; a: { x: number; z: number }; b: { x: number; z: number }; r: number; rb: number; bonus: number;
  /** It only counts if the flight covers at least this far, so a short hop onto the thing in the middle doesn't. */
  min: number };

export type Part = { pieces: Piece[]; rails: Rail[]; gaps: Gap[] };

const part = (p: Partial<Part> = {}): Part => ({ pieces: [], rails: [], gaps: [], ...p });
export const join = (...ps: Part[]): Part => part({ pieces: ps.flatMap((p) => p.pieces), rails: ps.flatMap((p) => p.rails), gaps: ps.flatMap((p) => p.gaps) });

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
/** Flat at 0, vertical at 1: the curve of a quarter pipe's transition. */
const arc = (t: number) => 1 - Math.sqrt(1 - clamp01(t) ** 2);
const smooth = (t: number) => clamp01(t) ** 2 * (3 - 2 * clamp01(t));

/** A point given in a piece's own frame, as a world point. */
export function toWorld(at: At, lx: number, lz: number) {
  const yaw = at.yaw ?? 0, c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: at.x + lx * c + lz * s, z: at.z - lx * s + lz * c };
}

const shape = (kind: PieceKind, name: string, at: At, w: number, d: number, f: (lx: number, lz: number) => number): Piece => ({
  kind, name, x: at.x, z: at.z, yaw: at.yaw ?? 0, w, d, h0: f(0, -d / 2), h1: f(0, d / 2),
  height: (lx, lz) => (Math.abs(lx) > w / 2 || Math.abs(lz) > d / 2 ? 0 : f(lx, lz)),
});

const bar = (kind: RailKind, at: At, lx1: number, lz1: number, lx2: number, lz2: number, y: number, y2?: number): Rail =>
  ({ kind, a: toWorld(at, lx1, lz1), b: toWorld(at, lx2, lz2), y, ...(y2 === undefined ? {} : { y2 }) });

/** Raises a part onto a floor at `base`. */
export function lift(p: Part, base: number): Part {
  return part({
    pieces: p.pieces.map((q) => ({ ...q, h0: q.h0 + base, h1: q.h1 + base, height: (lx, lz) => q.height(lx, lz) + base })),
    rails: p.rails.map((r) => ({ ...r, y: r.y + base, ...(r.y2 === undefined ? {} : { y2: r.y2 + base }) })),
    gaps: p.gaps,
  });
}

/**
 * Lays a part on sloping ground instead of a pad: each piece's surface is its own shape plus the ground
 * under that point, and a rail's ends ride the ground at each end, so a kicker, a bowl or a bar follows the hill.
 */
export function drape(p: Part, ground: (x: number, z: number) => number): Part {
  return part({
    pieces: p.pieces.map((q) => ({
      ...q,
      h0: q.h0 + ground(toWorld(q, 0, -q.d / 2).x, toWorld(q, 0, -q.d / 2).z),
      h1: q.h1 + ground(toWorld(q, 0, q.d / 2).x, toWorld(q, 0, q.d / 2).z),
      height: (lx, lz) => { const w = toWorld(q, lx, lz); return q.height(lx, lz) + ground(w.x, w.z); },
    })),
    rails: p.rails.map((r) => ({ ...r, y: r.y + ground(r.a.x, r.a.z), y2: (r.y2 ?? r.y) + ground(r.b.x, r.b.z) })),
    gaps: p.gaps,
  });
}

/** A straight or curved launch: `curve` 1 is a wedge, 2 pitches steeper at the lip. */
export const kicker = (at: At, o: { w?: number; d?: number; h?: number; curve?: number; name?: string } = {}): Part => {
  const { w = 3, d = 3, h = 1, curve = 1, name = "kicker" } = o;
  return part({ pieces: [shape("ramp", name, at, w, d, (_, lz) => h * ((lz + d / 2) / d) ** curve)] });
};

/** Drops from a deck of height `h` down to the floor along local +z, easing out at both ends. */
export const rollIn = (at: At, o: { w?: number; d?: number; h?: number; name?: string } = {}): Part => {
  const { w = 6, d = 20, h = 6, name = "roll-in" } = o;
  return part({ pieces: [shape("ramp", name, at, w, d, (_, lz) => h * (1 - smooth((lz + d / 2) / d)))] });
};

/** A flat-topped block. */
export const box = (at: At, o: { w?: number; d?: number; h?: number; name?: string } = {}): Part => {
  const { w = 4, d = 4, h = 0.5, name = "box" } = o;
  return part({ pieces: [piece("box", name, at.x, at.z, at.yaw ?? 0, w, d, h, h)] });
};

/** Rises along local +z on a quarter-circle curve to a deck, with coping across the lip. */
export const quarterPipe = (at: At, o: { w?: number; d?: number; h?: number; deck?: number; name?: string } = {}): Part => {
  const { w = 6, d = 4, h = 2, deck = 1.5, name = "quarter pipe" } = o, D = d + deck;
  return part({
    pieces: [shape("ramp", name, at, w, D, (_, lz) => (lz + D / 2 < d ? h * arc((lz + D / 2) / d) : h))],
    rails: [bar("coping", at, -w / 2, d - D / 2, w / 2, d - D / 2, h)],
  });
};

/** A rectangular bowl: a deck all round, then walls curving down to a flat floor at 0. w x d is the whole footprint. */
export const bowl = (at: At, o: { w?: number; d?: number; h?: number; deck?: number; name?: string } = {}): Part => {
  const { w = 30, d = 22, h = 2.4, deck = 2.5, name = "bowl" } = o, trans = h * 1.3;
  const f = (lx: number, lz: number) => {
    const e = Math.min(w / 2 - Math.abs(lx), d / 2 - Math.abs(lz));
    return e < deck ? h : e < deck + trans ? h * arc(1 - (e - deck) / trans) : 0;
  };
  const x = w / 2 - deck, z = d / 2 - deck;
  return part({
    pieces: [shape("ramp", name, at, w, d, f)],
    rails: [bar("coping", at, -x, -z, x, -z, h), bar("coping", at, x, -z, x, z, h), bar("coping", at, x, z, -x, z, h), bar("coping", at, -x, z, -x, -z, h)],
  });
};

/** Up, a flat top with ledges along both edges, and down. */
export const funbox = (at: At, o: { w?: number; d?: number; h?: number; ramp?: number; name?: string } = {}): Part => {
  const { w = 6, d = 14, h = 0.7, ramp = 4, name = "funbox" } = o;
  const z = d / 2 - ramp;
  return part({
    pieces: [shape("ramp", name, at, w, d, (_, lz) => h * clamp01(Math.min(lz + d / 2, d / 2 - lz) / ramp))],
    rails: [bar("ledge", at, -w / 2, -z, -w / 2, z, h), bar("ledge", at, w / 2, -z, w / 2, z, h)],
  });
};

/** A long low block with a ledge along its top. */
export const ledge = (at: At, o: { len?: number; w?: number; h?: number; name?: string } = {}): Part => {
  const { len = 8, w = 0.7, h = 0.5, name = "ledge" } = o;
  return part({ pieces: [piece("box", name, at.x, at.z, at.yaw ?? 0, w, len, h, h)], rails: [bar("ledge", at, 0, -len / 2, 0, len / 2, h)] });
};

/** A round-bar rail along local z; `y2` is its height at the +z end when it slopes (down a stair set). */
export const handrail = (at: At, o: { len?: number; y?: number; y2?: number } = {}): Part => {
  const { len = 8, y = 0.9, y2 } = o;
  return part({ rails: [bar("rail", at, 0, -len / 2, 0, len / 2, y, y2)] });
};

/** A low rail on the flat. */
export const flatBar = (at: At, o: { len?: number } = {}): Part => handrail(at, { len: o.len ?? 6, y: 0.45 });

/** Steps climbing along local +z to a landing. Turn it round to ride down. */
export const stairSet = (at: At, o: { w?: number; steps?: number; rise?: number; run?: number; land?: number; name?: string } = {}): Part => {
  const { w = 4, steps = 5, rise = 0.18, run = 0.6, land = 2, name = "stairs" } = o, D = steps * run + land;
  return part({ pieces: [shape("ramp", name, at, w, D, (_, lz) => Math.min(steps, Math.floor((lz + D / 2) / run) + 1) * rise)] });
};

/** A ledge as tall as the top of a stair set, running down beside it. */
export const hubba = (at: At, o: { steps?: number; rise?: number; run?: number } = {}): Part => {
  const { steps = 6, rise = 0.18, run = 0.6 } = o, len = steps * run + 2;
  return join(stairSet(at, { w: 3, steps, rise, run, name: "hubba stairs" }), ledge({ ...toWorld(at, 2.4, 0), yaw: at.yaw }, { len, w: 0.8, h: steps * rise, name: "hubba" }));
};

/** Four faces meeting in a point: a hip to jump over, or a boulder. */
export const hip = (at: At, o: { w?: number; d?: number; h?: number; name?: string } = {}): Part => {
  const { w = 6, d = 6, h = 1.2, name = "hip" } = o;
  return part({ pieces: [shape("ramp", name, at, w, d, (lx, lz) => h * clamp01(Math.min(1 - Math.abs(lx) / (w / 2), 1 - Math.abs(lz) / (d / 2))))] });
};

/** Two banks back to back, with coping along the ridge. */
export const spine = (at: At, o: { w?: number; d?: number; h?: number; name?: string } = {}): Part => {
  const { w = 8, d = 5, h = 1.6, name = "spine" } = o;
  return part({ pieces: [shape("ramp", name, at, w, d, (_, lz) => h * arc(1 - Math.abs(lz) / (d / 2)))], rails: [bar("coping", at, -w / 2, 0, w / 2, 0, h)] });
};

/**
 * A named gap in two parts, because the landing often stands on lower ground than the launch and each
 * goes on its own site: the launch at `at` (it carries the gap's name and bonus), and the landing `span`
 * metres past its lip, running back down. Whatever stands in the void (a boulder, a log) is its own part.
 */
export function gap(at: At, o: { name: string; span: number; h?: number; landH?: number; landLen?: number; w?: number; bonus?: number; curve?: number; kick?: number; reach?: number }) {
  const { name, span, h = 1.5, landH = 1, landLen = 6, w = 4, bonus = 500, curve = 1, kick = 4, reach = landLen / 2 + 3 } = o;
  const land = toWorld(at, 0, kick / 2 + span + landLen / 2);
  return {
    launch: join(kicker(at, { w, d: kick, h, curve, name: `${name} launch` }), part({ gaps: [{ name, a: { x: at.x, z: at.z }, b: land, r: kick / 2 + 3, rb: reach, bonus, min: Math.round(span * 0.8) }] })),
    landing: part({ pieces: [piece("ramp", `${name} landing`, land.x, land.z, at.yaw ?? 0, w + 2, landLen, landH, 0)] }),
    /** The landing's centre, for placing its site. */
    land,
  };
}

// Landscape features: what a snow park builds out of a mountain, built out of a national park. Each is
// a height function like the rest of the kit, named so the mesher paints rock and log as concrete.

/** A snow park's pipe: two walls curving up to coping either side of a flat channel, running along local z. */
export const halfpipe = (at: At, o: { w?: number; d?: number; h?: number; floor?: number; deck?: number; name?: string } = {}): Part => {
  const { w = 20, d = 40, h = 3, floor = 4, deck = 1.5, name = "creek halfpipe" } = o, wall = (w - floor) / 2 - deck, lip = floor / 2 + wall;
  const f = (lx: number, lz: number) => {
    const e = (Math.abs(lx) - floor / 2) / wall, ends = clamp01((d / 2 - Math.abs(lz)) / 3); // the mouth eases in so it can be entered
    return (e <= 0 ? 0 : h * arc(e)) * ends;
  };
  return part({ pieces: [shape("ramp", name, at, w, d, f)], rails: [-lip, lip].map((x) => bar("coping", at, x, -d / 2 + 3, x, d / 2 - 3, h)) });
};

/** Up a kicker, a long flat top, and down: the snow park's tabletop to clear. */
export const tabletop = (at: At, o: { w?: number; d?: number; h?: number; ramp?: number; name?: string } = {}): Part => {
  const { w = 8, d = 26, h = 1.6, ramp = 5, name = "tabletop" } = o;
  return part({ pieces: [shape("ramp", name, at, w, d, (_, lz) => h * smooth(Math.min(lz + d / 2, d / 2 - lz) / ramp))] });
};

/** A run of rolling bumps along local z to pump: the park's own whoops. */
export const rollers = (at: At, o: { w?: number; n?: number; period?: number; h?: number; name?: string } = {}): Part => {
  const { w = 8, n = 5, period = 7, h = 0.7, name = "rollers" } = o, d = n * period;
  return part({ pieces: [shape("ramp", name, at, w, d, (_, lz) => (h / 2) * (1 - Math.cos((2 * Math.PI * (lz + d / 2)) / period)) * clamp01(Math.min(lz + d / 2, d / 2 - lz) / period))] });
};

/** A fallen log: a round trunk along local z with a ledge to grind along its top. */
export const fallenLog = (at: At, o: { len?: number; r?: number; name?: string } = {}): Part => {
  const { len = 14, r = 0.7, name = "fallen log" } = o;
  return part({
    pieces: [shape("ramp", name, at, r * 2, len, (lx, lz) => r * Math.sqrt(Math.max(0, 1 - (lx / r) ** 2)) * clamp01((len / 2 - Math.abs(lz)) / 0.8))],
    rails: [bar("ledge", at, 0, -len / 2 + 0.8, 0, len / 2 - 0.8, r)],
  });
};

/** A round granite boulder to hop onto or round: a dome, steep at its foot. */
export const outcrop = (at: At, o: { r?: number; h?: number; name?: string } = {}): Part => {
  const { r = 3, h = 2, name = "boulder" } = o;
  return part({ pieces: [shape("ramp", name, at, r * 2, r * 2, (lx, lz) => h * Math.sqrt(Math.max(0, 1 - (Math.hypot(lx, lz) / r) ** 2)))] });
};

/** A geyser cone: a mound rising to a rim with a crater sunk in the middle, to ride round the lip of. */
export const geyserCone = (at: At, o: { r?: number; h?: number; name?: string } = {}): Part => {
  const { r = 7, h = 2.2, name = "geyser cone" } = o;
  return part({ pieces: [shape("ramp", name, at, r * 2, r * 2, (lx, lz) => {
    const t = Math.hypot(lx, lz) / r;
    return t >= 1 ? 0 : t < 0.35 ? h * (0.55 + 0.45 * smooth(t / 0.35)) : h * (1 - smooth((t - 0.35) / 0.65));
  })] });
};
