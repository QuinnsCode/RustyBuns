// The stack builder's numbers (stack.html): a stack is boxes seen from the front, each resting on whatever is under it,
// and a plan is those stacks set out round a stage and a dance floor, seen from above. Everything here is plain data
// and math on @rustybuns/gear, so the page, `window.stacker` and the test all ask the same functions.
//
//   settle      gravity: each box drops onto the boxes under its width (drop one low and the ones above move up)
//   stats       height, weight, layers, amp channels, how loud at 1 m and at the back of the floor, and what is wrong
//   sizeFor     how many tops and bins a side a rig needs to fill a floor this deep ("how many layers?")
//   wallFor     that stack, built: bins in rows, mid-bass on them, the horns on top (the "just do it" default)
//   coverage    the floor's level from every stack on the plan, highs and bass, and how even it is (gear's stackSources and floorStats)
import {
  GEAR, SYSTEMS, SYSTEM_IDS, boxChannels, coverage as gridOf, floorStats, gear, isTop, source, stackSources, sumPower,
  type FloorStats, type Source, type SpeakerSpec,
} from "@rustybuns/gear";
import { arr, check, int, num, obj, str } from "@rustybuns/util/guard";

/** One box in a stack: a catalog id, its centre across the stack (m, 0 is the middle, + is your right as you face it)
 *  and its bottom (m off the ground, set by `settle`). */
export type Box = { gear: string; x: number; y: number };
export type Stack = { name: string; boxes: Box[] };
/** A stack set down on the plan: x across the site, z from the stage lip toward the back of the floor (m), yaw in
 *  degrees (0 faces the floor straight on, + turns toward +x). */
export type Placed = { stack: number; x: number; z: number; yaw: number };
export type Plan = { stage: { w: number; d: number }; floor: { w: number; d: number }; placed: Placed[] };
export type Design = { stacks: Stack[]; plan: Plan };

export type Role = "sub" | "mid" | "top";
/** What a box does in a stack: a sub stops by 200 Hz, a mid-bass by 1 kHz, a top goes on up. */
export const role = (id: string): Role => {
  const s = gear(id).speaker!;
  return s.highCut <= 200 ? "sub" : s.highCut <= 1000 ? "mid" : "top";
};

/** The boxes you can stack: every speaker in the catalog but the wedges, the guitar cab and the little fill. */
export const PALETTE: readonly string[] = Object.values(GEAR)
  .filter((g) => g.speaker && !/wedge|cab-4x12|fill-8/.test(g.id))
  .map((g) => g.id)
  .sort((a, b) => ["sub", "mid", "top"].indexOf(role(a)) - ["sub", "mid", "top"].indexOf(role(b)));

const EPS = 0.02;
const span = (b: Box) => { const w = gear(b.gear).size.w; return [b.x - w / 2, b.x + w / 2] as const; };
const overlap = (a: Box, b: Box) => { const [a0, a1] = span(a), [b0, b1] = span(b); return Math.min(a1, b1) - Math.max(a0, b0); };
const top = (b: Box) => b.y + gear(b.gear).size.h;

/** Gravity: boxes go down in order of their drop height, each onto the highest box under its width (or the ground).
 *  Returns the boxes bottom first. */
export function settle(boxes: readonly Box[]): Box[] {
  const order = boxes.map((b, i) => ({ b, i })).sort((p, q) => p.b.y - q.b.y || p.i - q.i);
  const out: Box[] = [];
  for (const { b } of order) {
    const under = out.filter((o) => overlap(o, b) > EPS);
    out.push({ gear: b.gear, x: b.x, y: under.length ? Math.max(...under.map(top)) : 0 });
  }
  return out;
}

/** The boxes a box sits on (their tops at its bottom). */
const under = (boxes: readonly Box[], b: Box) => boxes.filter((o) => o !== b && overlap(o, b) > EPS && Math.abs(top(o) - b.y) < EPS);

export type Warning = { box: number | null; kind: "overhang" | "heavy-high" | "buried" | "tall" | "no-top" | "no-sub"; text: string };

/** Dance-floor targets at the back of the floor: highs by power, bass by pressure. */
export const TARGET = { high: 106, low: 115 } as const;
/** The most a floor's level may spread from its quiet tenth to its loud (gear's `floorStats` `even`), dB: tops, then bass. */
export const EVEN = { tops: 14, lows: 18 } as const;
/** Continuous level sits this far under a sheet's peak. */
const HEADROOM = 6;
const db = (x: number) => Math.round(x * 10) / 10;

export type Stats = {
  boxes: number; layers: number; width: number; height: number; depth: number; kg: number;
  count: Record<Role, number>; channels: number;
  /** Loudest at 1 m (continuous), per band: highs as power, bins coupled. */
  high1m: number | null; low1m: number | null;
  /** Each band at `depth` metres out (the back of the floor), and whether it makes the target. */
  back: { m: number; high: number | null; low: number | null; highOk: boolean; lowOk: boolean };
  lowCut: number | null; pattern: SpeakerSpec["coverage"] | null;
  warnings: Warning[];
};

/** Everything the stack card shows. `backM` is how far the back of the floor is from the stack. */
export function stats(stack: Stack, backM = 25): Stats {
  const boxes = settle(stack.boxes);
  const count: Record<Role, number> = { sub: 0, mid: 0, top: 0 };
  for (const b of boxes) count[role(b.gear)]++;
  const level = (r: Role, coupled: boolean) => {
    const bs = boxes.filter((b) => role(b.gear) === r);
    if (!bs.length) return null;
    // Bins side by side couple (+6 dB a doubling); tops and mids add as power (+3).
    return coupled ? 20 * Math.log10(bs.reduce((s, b) => s + 10 ** ((gear(b.gear).speaker!.maxSpl - HEADROOM) / 20), 0))
      : sumPower(bs.map((b) => gear(b.gear).speaker!.maxSpl - HEADROOM));
  };
  const high1m = level("top", false), low1m = level("sub", true);
  const fall = 20 * Math.log10(Math.max(1, backM));
  const tops = boxes.filter((b) => role(b.gear) === "top"), subs = boxes.filter((b) => role(b.gear) !== "top");
  const widest = tops.map((b) => gear(b.gear).speaker!.coverage).sort((a, b) => b.h - a.h)[0] ?? null;
  const x0 = Math.min(...boxes.map((b) => span(b)[0])), x1 = Math.max(...boxes.map((b) => span(b)[1]));
  const height = boxes.length ? Math.max(...boxes.map(top)) : 0;
  const depth = boxes.length ? Math.max(...boxes.map((b) => gear(b.gear).size.d)) : 0;

  const warnings: Warning[] = [];
  boxes.forEach((b, i) => {
    if (b.y < EPS) return;
    const below = under(boxes, b), g = gear(b.gear);
    const held = below.reduce((s, o) => s + Math.max(0, overlap(o, b)), 0);
    if (held < g.size.w * 0.5) warnings.push({ box: i, kind: "overhang", text: `The ${g.what} hangs half off the box under it: slide it over.` });
    const kgUnder = below.reduce((s, o) => s + gear(o.gear).kg, 0);
    if (g.kg > kgUnder * 1.25) warnings.push({ box: i, kind: "heavy-high", text: `${g.kg} kg ${g.what} on ${kgUnder} kg: heavy boxes go low.` });
    if (below.some((o) => role(o.gear) === "top") && role(b.gear) !== "top")
      warnings.push({ box: i, kind: "buried", text: `A horn is under the ${g.what}: tops go on top, where the crowd can see them.` });
  });
  if (boxes.length && height > 3 * depth) warnings.push({ box: null, kind: "tall", text: `${height.toFixed(1)} m on a ${depth.toFixed(2)} m base is over 3 to 1: strap it down.` });
  if (boxes.length && !count.top) warnings.push({ box: null, kind: "no-top", text: "No tops: it's all bass. Add a horn on top." });
  if (boxes.length && !count.sub) warnings.push({ box: null, kind: "no-sub", text: "No bins: the floor won't feel the kick. Add a sub under it." });

  const highBack = high1m === null ? null : db(high1m - fall), lowBack = low1m === null ? null : db(low1m - fall);
  return {
    boxes: boxes.length, layers: new Set(boxes.map((b) => Math.round(b.y * 50))).size,
    width: boxes.length ? db(x1 - x0) : 0, height: db(height), depth: db(depth),
    kg: Math.round(boxes.reduce((s, b) => s + gear(b.gear).kg, 0)), count,
    channels: boxes.reduce((s, b) => s + boxChannels(b.gear), 0),
    high1m: high1m === null ? null : db(high1m), low1m: low1m === null ? null : db(low1m),
    back: { m: backM, high: highBack, low: lowBack, highOk: (highBack ?? 0) >= TARGET.high, lowOk: (lowBack ?? 0) >= TARGET.low },
    lowCut: subs.length ? Math.min(...subs.map((b) => gear(b.gear).speaker!.lowCut)) : null, pattern: widest,
    warnings,
  };
}

/** A rig to start from: a box for each part, bottom to top. The five open-air rigs, plus a bar pair. */
export type Rig = { id: string; name: string; about: string; sub: string; mids: readonly string[]; top: string; array: boolean };
export const RIGS: readonly Rig[] = [
  ...SYSTEM_IDS.map((id) => {
    const s = SYSTEMS[id];
    return { id, name: s.name, about: s.about, sub: s.sub, top: s.top, mids: s.stack.filter((b) => b !== "sand-dolly" && b !== s.sub && b !== s.top),
      array: gear(s.top).speaker!.coverage.v <= 15 };
  }),
  { id: "bar-pair", name: "Bar pair", about: "A 15-inch two-way on an 18-inch sub each side: the bar, the party, the backyard.", sub: "sub-18", mids: [], top: "top-15-passive", array: false },
];
export const rig = (id: string): Rig => RIGS.find((r) => r.id === id) ?? RIGS[0]!;

/** How many tops and bins a side rig `r` needs so the back of a floor `backM` deep gets the targets. */
export function sizeFor(r: Rig, backM: number): { tops: number; subs: number } {
  const fall = 20 * Math.log10(Math.max(1, backM));
  const topMax = gear(r.top).speaker!.maxSpl - HEADROOM, subMax = gear(r.sub).speaker!.maxSpl - HEADROOM;
  return {
    tops: Math.min(8, Math.max(1, Math.ceil(10 ** ((TARGET.high - topMax + fall) / 10) - 1e-9))),
    subs: Math.min(12, Math.max(1, Math.ceil(10 ** ((TARGET.low - subMax + fall) / 20) - 1e-9))),
  };
}

/** A row of `n` boxes, centred, at drop height `y`. */
const row = (id: string, n: number, y: number): Box[] => {
  const w = gear(id).size.w;
  return Array.from({ length: n }, (_, i) => ({ gear: id, x: Math.round((i - (n - 1) / 2) * w * 100) / 100, y }));
};

/** The stack rig `r` needs for a floor `backM` deep: bins up to three wide in rows, the mids one a column on them, the
 *  tops on top (a line array stands in one column). */
export function wallFor(r: Rig, backM = 25): Stack {
  const { tops, subs } = sizeFor(r, backM);
  const wide = r.array ? Math.min(subs, 4) : Math.max(Math.min(tops, 3), Math.min(subs, 3));
  const boxes: Box[] = [];
  let y = 0;
  // Whole rows only, so nothing hangs off a half-empty row under it.
  for (let i = 0; i < Math.ceil(subs / wide); i++) boxes.push(...row(r.sub, wide, y++));
  const cols = Math.min(wide, tops);
  for (const m of r.mids) boxes.push(...row(m, cols, y++));
  if (r.array) for (let i = 0; i < Math.max(3, tops); i++) boxes.push(...row(r.top, 1, y++));
  else for (let i = 0; i < Math.ceil(tops / cols); i++) boxes.push(...row(r.top, cols, y++));
  return { name: r.name, boxes: settle(boxes) };
}

/** A stage, a floor and two stacks at the lip, toed in so they cross in the middle of the floor. */
export function planFor(stacks: number[], stage = { w: 10, d: 6 }, floor = { w: 24, d: 25 }): Plan {
  const sides = stacks.length === 1 ? [stacks[0]!, stacks[0]!] : stacks;
  const placed = sides.map((s, i) => {
    const t = sides.length === 1 ? 0 : i / (sides.length - 1);
    const x = db(-(stage.w / 2 + 1.2) + t * (stage.w + 2.4)), z = -0.6;
    return { stack: s, x, z, yaw: aimAt(x, z, 0, floor.d / 2) };
  });
  return { stage, floor, placed };
}

/** The yaw (degrees) that aims a stack at (x, z) toward a point. */
export const aimAt = (x: number, z: number, tx: number, tz: number) => Math.round((Math.atan2(tx - x, tz - z) * 180) / Math.PI);

/** "Just do it": rig `id` sized for the floor, one stack each side. */
export function justDoIt(id = "dance-stack", floor = { w: 24, d: 25 }): Design {
  const stack = wallFor(rig(id), floor.d);
  return { stacks: [stack], plan: planFor([0, 0], { w: 10, d: 6 }, floor) };
}

const EAR = 1.6;
/**
 * The speakers of every placed stack, as @rustybuns/gear sources. A stack's boxes go up in columns (boxes at one x,
 * each on the one under it), and each column is gear's `stackSources` lifted onto whatever it stands on, so its tops
 * are aimed as Qollab Studio aims them (a line array box tipped down by its pin). Bass bins, which `stackSources`
 * leaves to a sub block, play where they stand.
 */
export function sources(d: Design): Source[] {
  return d.plan.placed.flatMap((p) => {
    const st = d.stacks[p.stack];
    if (!st) return [];
    const yaw = (p.yaw * Math.PI) / 180, rx = Math.cos(yaw), rz = -Math.sin(yaw);
    // + across the stack is your right as you face it, which is the stack's own left.
    const at = (x: number): [number, number] => [p.x - rx * x, p.z - rz * x];
    const boxes = settle(st.boxes), out: Source[] = [];
    for (const b of boxes) if (!isTop(b.gear)) out.push(source(b.gear, { x: at(b.x)[0], y: b.y + gear(b.gear).size.h / 2, z: at(b.x)[1] }, { yaw }));
    for (const col of columns(boxes.filter((b) => isTop(b.gear)))) {
      const lift = col[0]!.y;
      for (const s of stackSources({ stack: col.map((b) => b.gear) }, { at: at(col[0]!.x), yaw })) out.push({ ...s, pos: { ...s.pos, y: s.pos.y + lift } });
    }
    return out;
  });
}

/** Boxes (bottom first) as columns: the runs at one x where each box sits right on the one before it. */
function columns(boxes: readonly Box[]): Box[][] {
  const out: Box[][] = [];
  for (const b of boxes) {
    const col = out.find((c) => { const l = c[c.length - 1]!; return Math.abs(l.x - b.x) < EPS && Math.abs(top(l) - b.y) < EPS; });
    if (col) col.push(b);
    else out.push([b]);
  }
  return out;
}

/** The floor map: its grids of highs and bass, gear's `floorStats` over each (`tops`, `lows`), and the back row's
 *  level (`back` for the highs, `bass` at 63 Hz), dB. */
export type Cover = { nx: number; nz: number; high: Float32Array; low: Float32Array; tops: FloorStats; lows: FloorStats; back: number; bass: number };

/** The floor's level from every stack, on a grid of about half a metre: highs by power, bass at 63 Hz with phase (so two
 *  stacks a stage apart make a power alley and holes), with the same numbers Qollab Studio's coverage map gives. */
export function cover(d: Design, nx = Math.min(96, Math.round(d.plan.floor.w * 2)), nz = Math.min(96, Math.round(d.plan.floor.d * 2))): Cover {
  const { floor } = d.plan, src = sources(d);
  const area = { x0: -floor.w / 2, x1: floor.w / 2, z0: 0.5, z1: floor.d, y: EAR, nx, nz };
  const hot = (s: Source) => ({ ...s, watts: s.speaker.ohms === null ? undefined : s.speaker.ratedWatts / 4 });
  const high = gridOf(src.map(hot), area, "high"), low = gridOf(src.map(hot), area, "low", 63);
  const backRow = (_x: number, z: number) => z > floor.d - (floor.d - 0.5) / nz;
  const round = (f: FloorStats): FloorStats => ({ mean: db(f.mean), min: db(f.min), max: db(f.max), even: db(f.even), cells: f.cells });
  return { nx, nz, high: high.db, low: low.db, tops: round(floorStats(high)), lows: round(floorStats(low)), back: db(floorStats(high, backRow).mean), bass: db(floorStats(low, backRow).mean) };
}

/** A saved design, checked on the way back in from storage (a stale or hand-edited save loses what doesn't fit). */
const BoxG = obj({ gear: str(40), x: num(-50, 50), y: num(0, 60) });
export const DesignG = obj({
  stacks: arr(obj({ name: str(40, { dflt: "Stack" }), boxes: arr(BoxG, 300, { drop: true }) }), 40, { min: 1 }),
  plan: obj({
    stage: obj({ w: num(2, 80), d: num(1, 40) }),
    floor: obj({ w: num(4, 300), d: num(4, 300) }),
    placed: arr(obj({ stack: int(0, 39), x: num(-400, 400), z: num(-80, 400), yaw: num(-360, 360) }), 60, { drop: true }),
  }),
});
/** A design from storage, or null; boxes not in the catalog and stacks placed that don't exist are dropped. */
export function readDesign(v: unknown): Design | null {
  const d = check(DesignG, v);
  if (!d) return null;
  const stacks = d.stacks.map((s) => ({ name: s.name, boxes: settle(s.boxes.filter((b) => GEAR[b.gear]?.speaker)) }));
  return { stacks, plan: { ...d.plan, placed: d.plan.placed.filter((p) => p.stack < stacks.length) } };
}
