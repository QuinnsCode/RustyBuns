// The big arena: the last rung. A 40 x 56 m floor under a 16 m roof, the stage at the back, the loading dock at the
// door. The PA flies: line-array boxes (75 kg, too heavy for one person) go onto the fly bar under a rigging point, and
// the motor takes the hang up to trim. Main hangs either side of the stage, side hangs out wide, and two delay towers
// halfway down the floor, timed so their sound lands just after the mains'. The subs sit on the floor at the stage edge;
// a cardioid pair (a second sub right behind the first, polarity flipped, delayed by the gap) keeps the stage quiet. Power
// comes from the building's company switch, three legs of 50 A: each hang and the sub amps are a feed you put on a leg,
// and a leg over its breaker trips. It is too much for one person: the hired hands carry what you send them to, two to
// a box. Plain data, no DOM; the page (arena-view.ts) draws it.
import { clamp } from "@rustybuns/util";
import { type Area, type CrowdField, type Grid, type Source, SPEED_OF_SOUND, coverage, coverageThrough, gear as catalog, source } from "@rustybuns/gear";
import { MAX_LIFT, REACH, WALK, type Answer, type Item, type Level, type World, aimed, carrySpeed, dims, over } from "../sim.ts";
import { stow } from "../strike.ts";
import { assist, feltKg } from "../assists.ts";
import { doors, showScore } from "../clock.ts";
import { type Zone, cellsIn, mean } from "./dive-bar.ts";
import { type CrowdSpot, comingTonight, crowdOf, expected, regions, roomWith } from "../crowd/crowd.ts";

const BOX = "line-array-box";
const DOCK_Z = 53;

/** The boxes come off the truck stacked four high on the dock; the subs and the crew wait beside them. */
const boxes: Item[] = Array.from({ length: 16 }, (_, k) => ({
  key: `box-${k + 1}`, gear: BOX, x: -10 + Math.floor(k / 4) * 1.4, y: (k % 4) * catalog(BOX).size.h, z: DOCK_Z, rot: 0,
}));

export const ARENA: Level = {
  name: "arena",
  bounds: { x0: -19.75, x1: 19.75, z0: 0.25, z1: 69.75 },
  room: { x0: -20, x1: 20, z0: 0, z1: 56, height: 16, door: 8 },
  outlets: [],
  start: { x: 0, z: 55, yaw: 0 },
  // The trailer backed up to the dock, long enough for every box and sub.
  truck: { x0: -1.2, x1: 1.2, z0: 57, z1: 70, h: 2.6 },
  items: [
    ...boxes,
    ...[0, 1, 2, 3].map((k) => ({ key: `sub-${k + 1}`, gear: "sub-18", x: 4 + k * 0.8, y: 0, z: DOCK_Z, rot: 0 })),
  ],
};

/** Where things are, for the floor marks and the score. */
export const ZONES = {
  stage: { x0: -10, x1: 10, z0: 0, z1: 8 },
  /** Where the band stands: what the subs should leave alone. */
  band: { x0: -6, x1: 6, z0: 1, z1: 6 },
  crowd: { x0: -16, x1: 16, z0: 11, z1: 50 },
  /** The front of the floor: what the subs are for. */
  front: { x0: -8, x1: 8, z0: 11, z1: 20 },
  /** Past the towers: where the delays take over from the mains. */
  rear: { x0: -16, x1: 16, z0: 38, z1: 50 },
  dock: { x0: -12, x1: 8, z0: 50.5, z1: 56 },
} satisfies Record<string, Zone>;

export type PointKind = "main" | "side" | "tower";
/** A rigging point: where its fly bar sits on the floor, its trim height, which way the hang faces (yaw, radians). */
export type Point = { key: string; kind: PointKind; x: number; z: number; trim: number; yaw: number };
export const POINTS: readonly Point[] = [
  { key: "main-l", kind: "main", x: -8, z: 8.5, trim: 10, yaw: 0 },
  { key: "main-r", kind: "main", x: 8, z: 8.5, trim: 10, yaw: 0 },
  { key: "side-l", kind: "side", x: -15, z: 10, trim: 9, yaw: -0.35 },
  { key: "side-r", kind: "side", x: 15, z: 10, trim: 9, yaw: 0.35 },
  { key: "tower-l", kind: "tower", x: -9, z: 32, trim: 7, yaw: 0 },
  { key: "tower-r", kind: "tower", x: 9, z: 32, trim: 7, yaw: 0 },
];
export const point = (key: string) => POINTS.find((p) => p.key === key) ?? null;

/** The company switch on the right wall by the stage: three legs, each on its own breaker. */
export const SWITCH = { x: 19.6, z: 14 };
export const LEGS = ["L1", "L2", "L3"] as const;
export type Leg = (typeof LEGS)[number];
export const LEG_AMPS = 50, VOLTS = 120;
/** What the sub amps draw per sub at show level, watts. */
export const SUB_AMP_W = 750;
/** The feeds you put on a leg: one per rigging point, and the sub amps. */
export const FEEDS = [...POINTS.map((p) => p.key), "subs"] as const;

/** The crowd should hear this, mids and highs, dB SPL. A big room, so a wider window. */
export const TARGET = 102;
export const WINDOW = 6;
/** The band's stage should sit this far under the front of the floor in the sub band. */
export const STAGE_GAP = 10;
/** A delay tower's sound should land this long after the mains', ms (soon enough to blend, late enough that the ear
 * still hears the stage first). */
export const LAG = { min: 0, max: 20 };
export const PASS = 85;

/** One hand on the crew: their name, where they are, and when they are free. */
export type Hand = { name: string; x: number; z: number; freeAt: number };
/** A carry: the item, where it goes, who carries it, and the timeline (walk to it, lift, carry, set down). */
export type Job = {
  key: string; to: { x: number; z: number }; hands: string[]; queued: number;
  /** Once hands are on it: when they set off, reach the piece, lift it, and set it down; where it was, where they were. */
  sched?: { start: number; reach: number; pick: number; end: number; from: { x: number; z: number }; was: { x: number; z: number }[] };
};
export type Hang = { boxes: string[]; flown: boolean; angle: number; delay: number };

export type Arena = {
  hangs: Record<string, Hang>;
  /** Each sub's delay (ms) and polarity. */
  subs: Record<string, { delay: number; invert: boolean }>;
  legs: Record<string, Leg | null>;
  crew: Hand[];
  jobs: Job[];
};
const arenas = new WeakMap<World, Arena>();
const HANDS = ["Sam", "Ade", "Kit", "Rue"];
export function arena(w: World): Arena {
  let a = arenas.get(w);
  if (!a) {
    a = {
      hangs: Object.fromEntries(POINTS.map((p) => [p.key, { boxes: [], flown: false, angle: p.kind === "tower" ? -4 : -6, delay: 0 }])),
      subs: {},
      legs: Object.fromEntries(FEEDS.map((f) => [f, null])),
      crew: HANDS.map((name, k) => ({ name, x: -4 + k * 1.2, z: DOCK_Z + 1.5, freeAt: 0 })),
      jobs: [],
    };
    arenas.set(w, a);
  }
  return a;
}

const find = (w: World, key: string) => w.items.find((i) => i.key === key) ?? null;
const near = (w: World, x: number, z: number, r: number) => Math.hypot(w.you.x - x, w.you.z - z) <= r;
/** How many hands a piece takes: two for anything over what one person lifts (as the dial feels it). */
export const handsFor = (gearId: string) => (feltKg(catalog(gearId).kg) > MAX_LIFT ? 2 : 1);
/** Whether the crew has it: queued or being carried, so you leave it alone. */
export const reserved = (w: World, key: string) => arena(w).jobs.some((j) => j.key === key);
/** The hang a box is part of, flown or waiting on the bar. */
const hangOf = (w: World, key: string) => Object.entries(arena(w).hangs).find(([, h]) => h.boxes.includes(key))?.[0] ?? null;

// ---- the crew ---------------------------------------------------------------------------------------------------

/** Send the crew to carry `key` to (x, z) (a rigging point's fly bar if `to` names one). They go when enough are free. */
export function send(w: World, key: string, to: string | { x: number; z: number }): Answer {
  const i = find(w, key);
  if (!i) return { ok: false, why: `no ${key} here` };
  if (w.held?.key === key) return { ok: false, why: "it's in your hands" };
  if (reserved(w, key)) return { ok: false, why: "the crew already has it" };
  const h = hangOf(w, key);
  if (h && arena(w).hangs[h].flown) return { ok: false, why: `it's flown on ${h}` };
  const p = typeof to === "string" ? point(to) : null;
  if (typeof to === "string" && !p) return { ok: false, why: `no rigging point ${to}` };
  const at = p ? { x: p.x, z: p.z } : (to as { x: number; z: number });
  const b = w.level.bounds;
  if (at.x < b.x0 || at.x > b.x1 || at.z < b.z0 || at.z > b.z1) return { ok: false, why: "that's outside the building" };
  if (h) arena(w).hangs[h].boxes = arena(w).hangs[h].boxes.filter((k) => k !== key);
  arena(w).jobs.push({ key, to: at, hands: [], queued: w.t });
  crewTick(w);
  return { ok: true };
}

/** A hand's spot at time `t` on a carry: walking from where they were to the piece, lifting, carrying it, set down. */
function handAt(j: Job, k: number, t: number): { x: number; z: number } {
  const s = j.sched!, side = (k - 0.5) * 0.9, lerp = (a: number, b: number, u: number) => a + (b - a) * clamp(u, 0, 1);
  const was = s.was[k];
  if (t < s.reach) return { x: lerp(was.x, s.from.x + side, (t - s.start) / (s.reach - s.start)), z: lerp(was.z, s.from.z + 0.6, (t - s.start) / (s.reach - s.start)) };
  if (t < s.pick) return { x: s.from.x + side, z: s.from.z + 0.6 };
  const u = (t - s.pick) / Math.max(1e-6, s.end - 2 - s.pick);
  return { x: lerp(s.from.x, j.to.x, u) + side, z: lerp(s.from.z, j.to.z, u) + 0.6 };
}

/**
 * Bring the crew up to `w.t`: start every queued carry whose hands were free by then (first come, first carried, from
 * the moment they came free), move what is being carried, and set down what has arrived. A hand's next free moment and
 * spot are known once a carry starts, so this is exact however seldom it is called.
 */
export function crewTick(w: World) {
  const a = arena(w);
  for (let j = a.jobs.find((x) => !x.sched); j; j = a.jobs.find((x) => !x.sched)) {
    const i = find(w, j.key)!, n = handsFor(i.gear);
    const team = [...a.crew].sort((p, q) => p.freeAt - q.freeAt).slice(0, n);
    if (team.length < n) break;
    const start = Math.max(j.queued, ...team.map((h) => h.freeAt));
    if (start > w.t) break;
    const reach = start + Math.max(...team.map((h) => Math.hypot(h.x - i.x, h.z - i.z))) / WALK, pick = reach + 2;
    const end = pick + Math.hypot(j.to.x - i.x, j.to.z - i.z) / carrySpeed(catalog(i.gear).kg / n) + 2;
    j.hands = team.map((h) => h.name);
    j.sched = { start, reach, pick, end, from: { x: i.x, z: i.z }, was: team.map((h) => ({ x: h.x, z: h.z })) };
    team.forEach((h, k) => Object.assign(h, handAt(j!, k, end), { freeAt: end }));
  }
  for (const j of a.jobs.filter((x) => x.sched).sort((p, q) => p.sched!.end - q.sched!.end)) {
    const i = find(w, j.key)!, s = j.sched!;
    if (w.t >= s.end) { land(w, i, j.to); a.jobs.splice(a.jobs.indexOf(j), 1); }
    else if (w.t >= s.pick) {
      // Up between them, on its way.
      const u = clamp((w.t - s.pick) / (s.end - 2 - s.pick), 0, 1);
      Object.assign(i, { x: s.from.x + (j.to.x - s.from.x) * u, y: 0.4, z: s.from.z + (j.to.z - s.from.z) * u });
    }
  }
}


/** Where each hand stands now, for the page and the harness. */
export function handsNow(w: World) {
  const a = arena(w);
  return a.crew.map((h) => {
    const j = a.jobs.find((x) => x.sched && x.hands.includes(h.name));
    const at = j ? handAt(j, j.hands.indexOf(h.name), w.t) : h;
    const doing = !j ? "free" : w.t < j.sched!.pick ? `going for ${j.key}` : `carrying ${j.key}`;
    return { name: h.name, x: Math.round(at.x * 100) / 100, z: Math.round(at.z * 100) / 100, doing };
  });
}

/** Set a carried piece down at (x, z): a box at a fly bar goes on the stack there, anything else on the floor, or in the
 * truck on top of what its middle is over and shoved forward like a piece you pack yourself. */
function land(w: World, i: Item, to: { x: number; z: number }) {
  const p = POINTS.find((q) => Math.hypot(q.x - to.x, q.z - to.z) < 0.5);
  if (p && i.gear === BOX) {
    const h = arena(w).hangs[p.key];
    h.boxes.push(i.key);
    Object.assign(i, { x: p.x, z: p.z, y: (h.boxes.length - 1) * catalog(BOX).size.h, rot: p.yaw });
    return;
  }
  const t = w.level.truck;
  if (t && to.x > t.x0 && to.x < t.x1 && to.z > t.z0 && to.z < t.z1) {
    const y = Math.max(0, ...w.items.filter((o) => o !== i && !o.hung && over(o, to.x, to.z)).map((o) => o.y + dims(o)[1]));
    Object.assign(i, { x: to.x, z: to.z, y, rot: 0 });
    stow(w, i.key);
    return;
  }
  Object.assign(i, { x: to.x, z: to.z, y: 0 });
}

/** Stand and watch for `seconds` (or do something else): the clock runs and the crew works. */
export function wait(w: World, seconds: number) {
  w.t += seconds;
  crewTick(w);
}

/** A box you set down yourself (on Cozy one person can lift one) by a fly bar on the floor goes on that bar's stack. */
export function rack(w: World, key: string) {
  const i = find(w, key);
  if (!i || i.gear !== BOX || hangOf(w, key)) return;
  const p = POINTS.find((q) => !arena(w).hangs[q.key].flown && Math.hypot(q.x - i.x, q.z - i.z) < 1);
  if (p) land(w, i, p);
}

/** A box lifted off a bar's stack leaves the hang; the ones above it drop down a place. */
export function unrack(w: World, key: string) {
  const h = hangOf(w, key), p = h && point(h);
  if (!h || !p || arena(w).hangs[h].flown) return;
  const hang = arena(w).hangs[h];
  hang.boxes = hang.boxes.filter((k) => k !== key);
  hang.boxes.forEach((k, n) => Object.assign(find(w, k)!, { y: n * catalog(BOX).size.h }));
}

// ---- the hangs --------------------------------------------------------------------------------------------------

/** How far down each box in a hang points past the top one, degrees: tighter at the top for the long throw. */
export const SPLAYS = [0, 4, 12, 26, 34, 44];
/** The most boxes one point takes. */
export const MAX_BOXES = SPLAYS.length;

/** Stand by the motor controller: within a few metres of the point's fly bar. */
const atMotor = (w: World, p: Point) => near(w, p.x, p.z, 4);

/** Fly the hang: the motor takes the boxes on the bar up to trim. Needs at least one box, and you at the controller. */
export function fly(w: World, key: string): Answer {
  const p = point(key);
  if (!p) return { ok: false, why: `no rigging point ${key}` };
  if (!atMotor(w, p)) return { ok: false, why: `${key}'s motor controller is out of reach` };
  const h = arena(w).hangs[key];
  if (h.flown) return { ok: false, why: `${key} is already at trim` };
  if (!h.boxes.length) return { ok: false, why: `nothing on ${key}'s fly bar` };
  if (h.boxes.length > MAX_BOXES) return { ok: false, why: `${key} takes ${MAX_BOXES} boxes at most` };
  h.flown = true;
  for (const k of h.boxes) find(w, k)!.hung = true;
  hangBoxes(w, p);
  return { ok: true };
}

/** Bring a hang back down to the floor (to add or take off a box). */
export function lower(w: World, key: string): Answer {
  const p = point(key);
  if (!p) return { ok: false, why: `no rigging point ${key}` };
  if (!atMotor(w, p)) return { ok: false, why: `${key}'s motor controller is out of reach` };
  const h = arena(w).hangs[key];
  if (!h.flown) return { ok: false, why: `${key} is on the floor` };
  h.flown = false;
  h.boxes.forEach((k, n) => { const i = find(w, k)!; delete i.hung; Object.assign(i, { x: p.x, z: p.z, y: n * catalog(BOX).size.h, rot: p.yaw }); });
  return { ok: true };
}

/** Each flown box's place in the air: the top one at trim, the rest under it, each turned down by its splay. */
function hangBoxes(w: World, p: Point) {
  const h = arena(w).hangs[p.key], bh = catalog(BOX).size.h;
  h.boxes.forEach((k, n) => Object.assign(find(w, k)!, { x: p.x, z: p.z, y: p.trim - (n + 1) * bh, rot: p.yaw }));
}

/** Set a hang's angle (the top box's tilt, degrees, down is negative) and a delay tower's delay (ms). At the controller. */
export function setHang(w: World, key: string, { angle, delay }: { angle?: number; delay?: number }): Answer {
  const p = point(key);
  if (!p) return { ok: false, why: `no rigging point ${key}` };
  const h = arena(w).hangs[key];
  if (angle !== undefined) {
    if (!atMotor(w, p)) return { ok: false, why: `${key}'s motor controller is out of reach` };
    h.angle = clamp(angle, -20, 10);
  }
  // Delays are set from the console's system processor, anywhere in the room.
  if (delay !== undefined) h.delay = clamp(delay, 0, 300);
  return { ok: true };
}

// ---- the subs ---------------------------------------------------------------------------------------------------

/** A sub's delay (ms) and polarity, set on its amp channel: you stand by it. */
export function setSub(w: World, key: string, { delay, invert }: { delay?: number; invert?: boolean }): Answer {
  const i = find(w, key);
  if (!i || i.gear !== "sub-18") return { ok: false, why: `${key} isn't a sub` };
  if (!near(w, i.x, i.z, REACH + 1)) return { ok: false, why: `${key} is out of reach` };
  const s = (arena(w).subs[key] ??= { delay: 0, invert: false });
  if (delay !== undefined) s.delay = clamp(Math.round(delay * 10) / 10, 0, 50);
  if (invert !== undefined) s.invert = invert;
  return { ok: true };
}

// ---- power ------------------------------------------------------------------------------------------------------

/** Put a feed on a leg of the company switch (or take it off with null): at the switch. */
export function setLeg(w: World, feed: string, leg: Leg | null): Answer {
  if (!(FEEDS as readonly string[]).includes(feed)) return { ok: false, why: `no feed ${feed}` };
  if (!atSwitch(w)) return { ok: false, why: "the company switch is out of reach" };
  arena(w).legs[feed] = leg;
  return { ok: true };
}
/** Within reach of the company switch, where L moves a feed to its next leg (anywhere else L strikes, as on every level). */
export const atSwitch = (w: World) => near(w, SWITCH.x, SWITCH.z, REACH + 0.5);
/** The leg after `now` on the switch: off, L1, L2, L3, then off again. */
export const nextLeg = (now: Leg | null): Leg | null => (now === null ? "L1" : now === "L3" ? null : LEGS[LEGS.indexOf(now) + 1]);

// ---- the touch pad ----------------------------------------------------------------------------------------------

/** One button's words on a phone: a short name on the key, the whole of it for the title and screen readers, and lit
 * when it is the selected feed. */
export type PadLabel = { glyph: string; what: string; on?: boolean };
const FEED_GLYPH: Record<string, string> = { "main-l": "Main\nL", "main-r": "Main\nR", "side-l": "Side\nL", "side-r": "Side\nR", "tower-l": "Tower\nL", "tower-r": "Tower\nR", subs: "Subs" };

/** What each arena key does right now, for the touch pad: the digits name the feeds, U says fly or lower for the
 * selected hang, K says what the crew will do with what you look at, L is the leg at the switch. A key that does
 * nothing different here is left out, so it keeps its own label. */
export function pad(w: World, selected: string | null, tagged: string | null): Record<string, PadLabel> {
  const a = arena(w), at = aimed(w), out: Record<string, PadLabel> = {};
  FEEDS.forEach((f, n) => { out[`Digit${n + 1}`] = { glyph: FEED_GLYPH[f]!, what: `Select ${f}`, on: f === selected }; });
  const hang = selected && selected !== "subs" ? selected : null, h = hang ? a.hangs[hang] : null;
  const box = at?.gear === BOX && !reserved(w, at.key), piece = at && !reserved(w, at.key);
  out.KeyK = box && hang ? { glyph: "Send", what: `Send the crew with ${at.key} to ${hang}'s fly bar` }
    : piece ? { glyph: "Tag", what: `Tag ${at.key} for the crew, then press again where it goes` }
    : tagged ? { glyph: "Here", what: `Send the crew with ${tagged} to where you stand` }
    : { glyph: "Crew", what: "Look at a box or a sub to send the crew with it" };
  out.KeyU = h?.flown ? { glyph: "Lower", what: `Lower ${hang} to the floor` } : { glyph: "Fly", what: hang ? `Fly ${hang} to trim` : "Pick a hang to fly" };
  out.KeyR = { glyph: "Aim\nup", what: hang ? `Tilt ${hang} up a degree` : "Pick a hang to aim" };
  out.KeyV = { glyph: "Aim\ndown", what: hang ? `Tilt ${hang} down a degree` : "Pick a hang to aim" };
  const sub = at?.gear === "sub-18";
  out.Comma = { glyph: "−ms", what: sub ? `${at.key} delay down half a millisecond` : hang ? `${hang} delay down 5 ms` : "Delay down" };
  out.Period = { glyph: "+ms", what: sub ? `${at.key} delay up half a millisecond` : hang ? `${hang} delay up 5 ms` : "Delay up" };
  out.KeyI = { glyph: "Flip", what: sub ? `Flip ${at.key}'s polarity` : "Look at a sub to flip its polarity" };
  out.KeyH = { glyph: "Heat", what: "Heat map of the floor" };
  out.Enter = { glyph: "Show", what: "Open the doors: show time" };
  if (atSwitch(w) && selected) out.KeyL = { glyph: "Leg", what: `Put ${selected} on ${nextLeg(a.legs[selected] ?? null) ?? "no leg"}` };
  return out;
}

/** What a feed draws at show level: a hang its flown boxes, the sub amps a share per sub on the floor. */
export function feedWatts(w: World, feed: string): number {
  if (feed === "subs") return w.items.filter((i) => i.gear === "sub-18" && i.y === 0 && !reserved(w, i.key) && w.held?.key !== i.key).length * SUB_AMP_W;
  const h = arena(w).hangs[feed];
  return h?.flown ? h.boxes.length * catalog(BOX).draw!.loud : 0;
}

/** Each leg's load against its breaker: trips past it (not on Cozy), warns past 80%. */
export function legs(w: World) {
  const limit = LEG_AMPS * VOLTS, a = arena(w);
  return LEGS.map((leg) => {
    const feeds = FEEDS.filter((f) => a.legs[f] === leg), watts = feeds.reduce((s, f) => s + feedWatts(w, f), 0);
    return { leg, feeds, watts, limit, warn: watts > 0.8 * limit, tripped: watts > limit && assist("breakersTrip") };
  });
}

/** Whether a feed has power: on a leg that hasn't tripped. */
export function powered(w: World, feed: string): boolean {
  const leg = arena(w).legs[feed];
  return !!leg && !legs(w).find((l) => l.leg === leg)!.tripped;
}

// ---- the sound --------------------------------------------------------------------------------------------------

/** The flown boxes that play: their hang at trim and powered. Each is a source at its place, aimed by its splay. */
export function hangSources(w: World, kinds: readonly PointKind[] = ["main", "side", "tower"]): Source[] {
  const a = arena(w), bh = catalog(BOX).size.h, deg = Math.PI / 180;
  return POINTS.filter((p) => kinds.includes(p.kind) && a.hangs[p.key].flown && powered(w, p.key)).flatMap((p) => {
    const h = a.hangs[p.key];
    return h.boxes.map((_, n) => source(BOX, { x: p.x, y: p.trim - (n + 0.5) * bh, z: p.z }, { yaw: p.yaw, pitch: (h.angle - SPLAYS[n]) * deg }));
  });
}

/** The subs that play: on the floor, the sub amps powered, each with its delay and polarity. */
export function subSources(w: World): Source[] {
  if (!powered(w, "subs")) return [];
  const a = arena(w);
  return w.items.filter((i) => i.gear === "sub-18" && i.y === 0 && !reserved(w, i.key) && w.held?.key !== i.key).map((i) => {
    const s = a.subs[i.key];
    return source("sub-18", { x: i.x, y: 0.35, z: i.z }, { yaw: i.rot, delayMs: s?.delay ?? 0, invert: s?.invert ?? false });
  });
}

/** The floor at ear height, in 1 m cells. */
export const FLOOR: Area = { x0: -20, x1: 20, z0: 0, z1: 56, y: 1.6, nx: 40, nz: 56 };
const lowArea = (z: Zone): Area => ({ x0: z.x0, x1: z.x1, z0: z.z0, z1: z.z1, y: 1.6, nx: Math.round((z.x1 - z.x0) * 2), nz: Math.round((z.z1 - z.z0) * 2) });

/** The heat map: mids and highs from every flown, powered box. */
export const heat = (w: World): Grid => coverage(hangSources(w), FLOOR, "high");

/** Arrival time of a source's sound at (x, z) at ear height, ms. */
const arrival = (s: Source, x: number, z: number, delay = 0) => (Math.hypot(x - s.pos.x, 1.6 - s.pos.y, z - s.pos.z) / SPEED_OF_SOUND) * 1000 + delay;

/** How the towers line up past them: the share of the rear cells where the nearer tower lands LAG after the nearer main. */
export function timing(w: World): { lined: number; lagMs: number | null } {
  const a = arena(w);
  const mains = POINTS.filter((p) => p.kind === "main" && a.hangs[p.key].flown && powered(w, p.key));
  const towers = POINTS.filter((p) => p.kind === "tower" && a.hangs[p.key].flown && powered(w, p.key));
  if (!mains.length || !towers.length) return { lined: 0, lagMs: null };
  const r = ZONES.rear, lags: number[] = [];
  for (let z = r.z0 + 0.5; z < r.z1; z += 1) for (let x = r.x0 + 0.5; x < r.x1; x += 1) {
    const nearest = (ps: Point[]) => ps.reduce((b, p) => (Math.hypot(p.x - x, p.z - z) < Math.hypot(b.x - x, b.z - z) ? b : p));
    const m = nearest(mains), t = nearest(towers);
    const top = (p: Point) => ({ pos: { x: p.x, y: p.trim - 0.5, z: p.z } }) as Source;
    lags.push(arrival(top(t), x, z, a.hangs[t.key].delay) - arrival(top(m), x, z));
  }
  const ok = lags.filter((l) => l >= LAG.min && l <= LAG.max).length;
  const mid = [...lags].sort((p, q) => p - q)[lags.length >> 1];
  return { lined: ok / lags.length, lagMs: Math.round(mid * 10) / 10 };
}

/** The sub band on the band's stage against the front of the floor: how far under it sits, dB. */
export function stageGap(w: World): number | null {
  const subs = subSources(w);
  if (!subs.length) return null;
  const at = (z: Zone) => mean([...coverage(subs, lowArea(z), "low").db]);
  return Math.round((at(ZONES.front) - at(ZONES.band)) * 10) / 10;
}

export type Score = {
  /** Share of the floor within WINDOW dB of TARGET, 0 to 1. */
  covered: number;
  crowd: number | null;
  /** Share of the rear floor where the towers land just after the mains. */
  lined: number;
  lagMs: number | null;
  /** The sub band on stage under the front of the floor, dB. */
  stageGap: number | null;
  /** Legs over 80%, and legs tripped. */
  warn: number;
  tripped: number;
  score: number;
  pass: boolean;
};

/** 50 points for the floor at the target, 20 for towers in time, 15 for a quiet stage, 15 for a power plan inside 80%. */
export function score(w: World, g: Grid = heat(w)): Score {
  const crowd = cellsIn(g, ZONES.crowd);
  const covered = crowd.filter((d) => Math.abs(d - TARGET) <= WINDOW).length / crowd.length;
  const t = timing(w), gap = stageGap(w), l = legs(w);
  const warn = l.filter((x) => x.warn).length, tripped = l.filter((x) => x.tripped).length;
  const power = tripped ? 0 : warn ? 5 : 15;
  const quiet = gap === null ? 0 : clamp(gap / STAGE_GAP, 0, 1);
  const s = Math.round(50 * covered + 20 * t.lined + 15 * quiet + (covered > 0 ? power : 0));
  const c = mean(crowd);
  return {
    covered: Math.round(covered * 100) / 100, crowd: Number.isFinite(c) ? Math.round(c * 10) / 10 : null,
    lined: Math.round(t.lined * 100) / 100, lagMs: t.lagMs, stageGap: gap, warn, tripped, score: s, pass: s >= PASS,
  };
}

/**
 * The arena's crowd: 3,000 standing on the floor from the barrier to the dock end, packed at the front and thinning past
 * the towers. A 40 by 56 m hall under a 16 m roof with seats and drapes round it (mean absorption about 0.25): empty it
 * rings for three seconds, full for under two.
 */
export const CROWD: CrowdSpot = {
  floor: { ...ZONES.crowd, nx: 64, nz: 78 },
  stageZ: 10.5,
  capacity: 3000,
  room: { w: 40, d: 56, h: 16, alpha: 0.25 },
  regions: [
    { name: "front", zone: ZONES.front },
    { name: "middle", zone: { ...ZONES.crowd, z0: 20, z1: 38 } },
    { name: "rear", zone: ZONES.rear },
  ],
};

/** The crowd the floor is set for: the one that came in, else the one expected at doors. */
const crowdField = (w: World): CrowdField => crowdOf(w)?.field ?? expected(CROWD, comingTonight(w, CROWD));

/**
 * Mids and highs over the floor with it full, at 2 kHz: each flown box heard through the bodies in its way. A hang at
 * trim fires over the heads, so only the last few rows before a listener count; the far floor, where the mains come in
 * low, loses most. The same 1 m cells as the empty map: about 2,200 cells by 16 boxes, some 20 ms.
 */
export const heatFull = (w: World, field: CrowdField = crowdField(w)): Grid => coverageThrough(hangSources(w), field, FLOOR, 2000);

/** The floor at soundcheck (empty) and with the crowd on it: the towers' timing, the stage's bass and the power are the same in both. */
export function scores(w: World) {
  const empty = heat(w), full = heatFull(w);
  return { soundcheck: score(w, empty), full: score(w, full), empty, fullGrid: full };
}

/** The crowd for the harness: how many, each region's people, dB at soundcheck and full, and mood; the hall's reverb empty and full. */
export function crowdState(w: World, s = scores(w)) {
  const c = crowdOf(w), level = (g: Grid) => (z: Zone) => { const v = mean(cellsIn(g, z)); return Number.isFinite(v) ? Math.round(v * 10) / 10 : null; };
  return {
    in: !!c, count: c?.people ?? 0, expected: comingTonight(w, CROWD),
    empty: roomWith(CROWD, 0), full: roomWith(CROWD, c?.people ?? comingTonight(w, CROWD)),
    regions: c ? regions(c, (z) => ({ soundcheck: level(s.empty)(z), full: level(s.fullGrid)(z) }), TARGET, WINDOW, TARGET + WINDOW) : [],
  };
}

/** Show time: the floor's sound with the crowd on it, scaled by their mood, and the pay. */
export function show(w: World) {
  const s = scores(w).full, d = doors(w.level.name, w.t), total = showScore(s.score, d.mood);
  return { sound: s.score, mood: d.mood, late: Math.round(d.late), pay: d.pay, fee: d.fee, score: total, pass: total >= PASS };
}
export type Show = ReturnType<typeof show>;

/** What the harness adds for the arena: the hangs, the subs, the legs, the crew, the score at soundcheck and with the floor full, and the crowd. */
export function arenaState(w: World) {
  crewTick(w);
  const a = arena(w), s = scores(w);
  return {
    hangs: Object.fromEntries(POINTS.map((p) => [p.key, { ...a.hangs[p.key], boxes: a.hangs[p.key].boxes.length, powered: powered(w, p.key) }])),
    subs: { ...a.subs },
    legs: legs(w).map(({ leg, feeds, watts, limit, warn, tripped }) => ({ leg, feeds, watts, limit, warn, tripped })),
    crew: handsNow(w),
    queued: a.jobs.filter((j) => !j.sched).map((j) => j.key),
    ...s.soundcheck, full: s.full, people: crowdState(w, s),
  };
}
