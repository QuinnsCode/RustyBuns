// The local festival: a field with two stages 120 m apart. The dance tent runs the dance stacks (horn-loaded, narrow,
// efficient), the open stage the sculpted arrays on arc subs. Traders sit between them, the generator compound south of
// them, and past the south fence are houses. The job in the real order:
//   1. each stage's amp rack goes close to its speakers (speaker cable loses level by the metre; signal cable doesn't),
//   2. power from the compound: every load on a phase, the phases balanced, each stage's feeder thick enough for its
//      current and its length (under 5% drop, the neutral's return included),
//   3. signal: each stage's desk out at its mix position, the snake run back to the rack,
//   4. aim: turn each stage so it faces away from the other and from the houses, and build its subs cardioid.
// What makes it a festival is site physics (@rustybuns/gear's site.ts): one stage bleeding into the other's audience,
// the subs carrying to the fence, and a licence with a 15-minute LAeq at each mix position and a curfew.
// Plain data, no DOM; the page (festival-view.ts) draws it.
import { clamp } from "@rustybuns/util";
import {
  AMPACITY, type Area, type CrowdField, type Grid, HIGH_HZ, MAX_DROP, type Phases, type Source, type Stretch, type SubMode,
  airLoss, cableLoss, crowdLoss, gear, imbalance, levelAt, feederDrop, runningLeq, source, splAt, subBlock, sumPower, worstLeq,
} from "@rustybuns/gear";
import { REACH, type Answer, type Item, type Level, type World } from "../sim.ts";
import { assist } from "../assists.ts";
import { doors, showScore } from "../clock.ts";
import { type CrowdSpot, comingTonight, crowdOf, moodOf } from "../crowd/crowd.ts";

// ---- the site ----

export type StageKey = "tent" | "open";
export const STAGE_KEYS: readonly StageKey[] = ["tent", "open"];
type Stage = { name: string; x: number; z: number; system: "dance" | "sculpted" };
/** The two stages, 120 m apart across the field. A stage's deck is 12 m wide; its system stands at the front corners. */
export const STAGES: Record<StageKey, Stage> = {
  tent: { name: "the dance tent", x: -60, z: 0, system: "dance" },
  open: { name: "the open stage", x: 60, z: 0, system: "sculpted" },
};
/** The generator compound, and where the traders' vans plug in. */
export const COMPOUND = { x: 0, z: -34 };
/** The south fence (the noise check for the lows) and the nearest houses past it. */
export const FENCE_Z = -50;
export const HOUSES = [{ x: -40, z: -110 }, { x: 0, z: -115 }, { x: 45, z: -108 }];
/** The traders' row between the stages. */
export const TRADERS = { x0: -22, x1: 22, z0: 12, z1: 30 };

// ---- the numbers ----

/** Mids and highs the audience should hear, dB (an A-weighted festival field), and how far off still counts. */
export const TARGET = 95;
export const WINDOW = 5;
/** A stage's audience should hear the other stage at least this far under its own. */
export const BLEED_MARGIN = 10;
/** The licence: LAeq over 15 minutes at each mix position and at the nearest house, the 63 Hz level at the fence,
 * and the curfew (hours after the 6 pm start). */
export const MIX_LIMIT = 98;
export const HOUSE_LIMIT = 65;
export const FENCE_LIMIT = 90;
export const CURFEW_H = 5;
/** Speaker cable on the drum (four-core 2.5 mm², 13 AWG), metres: a rack further from its stage than this does not reach. */
export const SPEAKER_RUN = 50;
export const SPEAKER_AWG = 13;
/** Each amp channel drives two boxes in parallel: 4 ohms. */
const CHANNEL_OHMS = 4;
/** A rack within this much loss of its speakers counts as near them, dB. */
export const NEAR_DB = 0.5;
/** The snake (analogue multicore) on its drum: desk to rack, metres. */
export const SNAKE = 80;
/** Volts per phase: a 120/208 V three-phase set. */
export const VOLTS = 120;
/** The tent's back wall and the stage set behind the system: mids and highs lose this much behind it, dB. */
export const TENT_WALL = 8;
export const PASS = 80;

export type Leg = "L1" | "L2" | "L3";
export const LEGS: readonly Leg[] = ["L1", "L2", "L3"];
/** Feeder sizes on the truck, AWG (-1 is 2/0). */
export const FEEDERS: readonly number[] = [10, 6, 2, -1];
/** Every load at show level, watts, and which stage's feeder it hangs off (traders: the compound's own short run). */
export const FEEDS: Record<string, { watts: number; stage: StageKey | null; what: string }> = {
  "tent-rack": { watts: gear("amp-rack-12u").draw!.loud, stage: "tent", what: "tent amp rack" },
  "tent-lights": { watts: 3600, stage: "tent", what: "tent lights" },
  "tent-backline": { watts: 1800, stage: "tent", what: "tent DJ booth and backline" },
  "open-rack": { watts: gear("amp-rack-12u").draw!.loud, stage: "open", what: "open stage amp rack" },
  "open-lights": { watts: 3600, stage: "open", what: "open stage lights" },
  "open-backline": { watts: 2400, stage: "open", what: "open stage backline" },
  "traders-1": { watts: 7000, stage: null, what: "food van" },
  "traders-2": { watts: 7000, stage: null, what: "food van" },
  "traders-3": { watts: 6000, stage: null, what: "bar" },
};

// ---- the rig you set ----

export type Rig = {
  /** Which way each stage faces, radians (0 faces +z, north; positive turns toward +x). */
  yaw: Record<StageKey, number>;
  subs: Record<StageKey, SubMode>;
  /** The master fader, dB under full power. */
  master: Record<StageKey, number>;
  /** Each feed's phase at the compound's distro, or null (unplugged). */
  phase: Record<string, Leg | null>;
  /** Each stage's feeder, AWG. */
  feeder: Record<StageKey, number>;
  /** Whether each stage's snake is run from its desk to its rack. */
  snake: Record<StageKey, boolean>;
  /** The show: seconds since the 6 pm start, and what each mix position heard, stretch by stretch. */
  clock: number;
  log: Record<StageKey, Stretch[]>;
  /** The loudest a stage played after curfew, or null if it kept it. */
  late: number | null;
};
const rigs = new WeakMap<World, Rig>();
export function rig(w: World): Rig {
  let r = rigs.get(w);
  if (!r) {
    r = {
      yaw: { tent: Math.PI / 2, open: -Math.PI / 2 }, subs: { tent: "omni", open: "omni" }, master: { tent: -10, open: -9 },
      phase: Object.fromEntries(Object.keys(FEEDS).map((k) => [k, null])), feeder: { tent: 10, open: 10 },
      snake: { tent: false, open: false }, clock: 0, log: { tent: [], open: [] }, late: null,
    };
    rigs.set(w, r);
  }
  return r;
}

// ---- where things stand ----

const ahead = (yaw: number) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
const across = (yaw: number) => ({ x: Math.cos(yaw), z: -Math.sin(yaw) });
/** A point on a stage's own frame (`a` across, `f` forward of its centre) in the field. */
export function onStage(k: StageKey, yaw: number, a: number, f: number) {
  const s = STAGES[k], u = across(yaw), v = ahead(yaw);
  return { x: s.x + u.x * a + v.x * f, z: s.z + u.z * a + v.z * f };
}
/** A field point in a stage's frame: across and forward of its centre. */
export function local(k: StageKey, yaw: number, x: number, z: number) {
  const s = STAGES[k], dx = x - s.x, dz = z - s.z, u = across(yaw), v = ahead(yaw);
  return { a: dx * u.x + dz * u.z, f: dx * v.x + dz * v.z };
}
/** A stage's audience: 8 to 38 m in front of it, 15 m either side of its axis. */
export const inAudience = (k: StageKey, yaw: number, x: number, z: number) => { const l = local(k, yaw, x, z); return l.f >= 8 && l.f <= 38 && Math.abs(l.a) <= 15; };
/** Where a stage's desk should go: 28 m out on its axis. */
export const mixSpot = (k: StageKey, yaw: number) => onStage(k, yaw, 0, 28);
const SIDE = 6, FRONT = 4;

/** A stage's boxes as items: each side's sub block on the ground (the third sub behind and turned round when it's
 * cardioid), and the stack (dance) or the pole pair (sculpted) on top. Hung: no one picks these up by hand. */
export function stageItems(k: StageKey, yaw: number, mode: SubMode): Item[] {
  const sys = STAGES[k].system, out: Item[] = [], subId = sys === "dance" ? "horn-sub-21" : "arc-sub-18";
  const { w: sw, h: sh, d: sd } = gear(subId).size;
  for (const side of [-1, 1] as const) {
    const n = side < 0 ? "l" : "r", at = (a: number, f: number) => onStage(k, yaw, side * SIDE + a, FRONT + f);
    const spots: [number, number, number][] = mode === "omni" ? [[-(sw + 0.05), 0, yaw], [0, 0, yaw], [sw + 0.05, 0, yaw]]
      : [[-(sw + 0.05) / 2, 0, yaw], [(sw + 0.05) / 2, 0, yaw], [0, -sd, yaw + Math.PI]];
    spots.forEach(([a, f, rot], j) => { const p = at(a, f); out.push({ key: `${k}-sub-${n}${j + 1}`, gear: subId, x: p.x, y: 0, z: p.z, rot, hung: true }); });
    const p = at(0, 0);
    if (sys === "dance") {
      out.push({ key: `${k}-midbass-${n}`, gear: "stack-mid-bass", x: p.x, y: sh, z: p.z, rot: yaw, hung: true });
      out.push({ key: `${k}-midhigh-${n}`, gear: "stack-mid-high", x: p.x, y: sh + gear("stack-mid-bass").size.h, z: p.z, rot: yaw, hung: true });
    } else {
      // a pair on the pole, splayed 15 degrees either way of the side's axis
      for (const [j, splay] of [[1, -0.26], [2, 0.26]] as const) {
        const q = at((j === 1 ? -0.24 : 0.24), 0);
        out.push({ key: `${k}-sculpt-${n}${j}`, gear: "sculpted-3way", x: q.x, y: sh + 1.1, z: q.z, rot: yaw + splay, hung: true });
      }
    }
  }
  return out;
}

const fixed = (): Item[] => [
  ...stageItems("tent", Math.PI / 2, "omni"), ...stageItems("open", -Math.PI / 2, "omni"),
  { key: "generator", gear: "generator-100kva", x: COMPOUND.x, y: 0, z: COMPOUND.z - 4, rot: Math.PI / 2, litres: 300 },
  { key: "distro", gear: "distro-box", x: COMPOUND.x + 2.4, y: 0, z: COMPOUND.z, rot: 0 },
  // off the truck at the compound: the racks roll, the desks carry
  { key: "tent-rack", gear: "amp-rack-12u", x: -3, y: 0, z: COMPOUND.z + 4, rot: 0 },
  { key: "open-rack", gear: "amp-rack-12u", x: 3, y: 0, z: COMPOUND.z + 4, rot: 0 },
  { key: "tent-desk", gear: "mixer-small", x: -1.2, y: 0, z: COMPOUND.z + 5.5, rot: 0 },
  { key: "open-desk", gear: "mixer-small", x: 1.2, y: 0, z: COMPOUND.z + 5.5, rot: 0 },
];

export const FESTIVAL: Level = {
  name: "festival",
  outdoor: true,
  bounds: { x0: -84, x1: 84, z0: -48, z1: 68 },
  room: { x0: -84, x1: 84, z0: -48, z1: 68, height: 0, door: 0 },
  outlets: [],
  start: { x: 0, z: COMPOUND.z + 8, yaw: Math.PI },
  items: fixed(),
};

/** The field at ear height, in 2 m cells, out past the fence to the houses. */
export const FIELD: Area = { x0: -84, x1: 84, z0: -120, z1: 68, y: 1.6, nx: 84, nz: 94 };

// ---- your actions ----

const near = (w: World, x: number, z: number, reach = REACH * 3) => Math.hypot(w.you.x - x, w.you.z - z) <= reach;
const stageNear = (w: World): StageKey | null => STAGE_KEYS.find((k) => near(w, STAGES[k].x, STAGES[k].z, 14)) ?? null;
const relay = (w: World, k: StageKey) => {
  const r = rig(w), keep = w.items.filter((i) => !i.key.startsWith(`${k}-`) || i.key === `${k}-rack` || i.key === `${k}-desk`);
  w.items = [...keep, ...stageItems(k, r.yaw[k], r.subs[k])];
};

/** Turn a stage to face `deg` (0 is north, 90 east), standing on or by it: the deck and the system turn together. */
export function face(w: World, k: StageKey, deg: number, anywhere = false): Answer {
  if (!anywhere && stageNear(w) !== k) return { ok: false, why: `stand on ${STAGES[k].name} to turn it` };
  rig(w).yaw[k] = (((deg % 360) + 360) % 360) * (Math.PI / 180);
  relay(w, k);
  return { ok: true };
}
/** Build a stage's subs omni (all forward) or cardioid (one of three turned, delayed and flipped), standing by it. */
export function subs(w: World, k: StageKey, mode: SubMode, anywhere = false): Answer {
  if (!anywhere && stageNear(w) !== k) return { ok: false, why: `stand by ${STAGES[k].name}'s subs to rebuild them` };
  rig(w).subs[k] = mode;
  relay(w, k);
  return { ok: true };
}
/** A stage's master fader, at its desk. */
export function master(w: World, k: StageKey, db: number, anywhere = false): Answer {
  const d = w.items.find((i) => i.key === `${k}-desk`)!;
  if (!anywhere && !near(w, d.x, d.z)) return { ok: false, why: `you're not at ${STAGES[k].name}'s desk` };
  rig(w).master[k] = clamp(db, -30, 0);
  return { ok: true };
}
/** Put a load on a phase at the compound's distro (or unplug it with null). */
export function phase(w: World, feed: string, leg: Leg | null, anywhere = false): Answer {
  if (!(feed in FEEDS)) return { ok: false, why: `no feed ${feed}` };
  if (!anywhere && !near(w, COMPOUND.x, COMPOUND.z, 8)) return { ok: false, why: "the distro is in the generator compound" };
  rig(w).phase[feed] = leg;
  return { ok: true };
}
/** Run a stage's feeder in a size off the truck, at the compound. */
export function feeder(w: World, k: StageKey, awg: number, anywhere = false): Answer {
  if (!FEEDERS.includes(awg)) return { ok: false, why: `no ${awg} AWG feeder on the truck (${FEEDERS.map(awgName).join(", ")})` };
  if (!anywhere && !near(w, COMPOUND.x, COMPOUND.z, 8)) return { ok: false, why: "feeders start at the generator compound" };
  rig(w).feeder[k] = awg;
  return { ok: true };
}
/** Run the snake from a stage's desk back to its rack, standing at the desk. */
export function snake(w: World, k: StageKey, anywhere = false): Answer {
  const d = w.items.find((i) => i.key === `${k}-desk`)!, rk = w.items.find((i) => i.key === `${k}-rack`)!;
  if (!anywhere && !near(w, d.x, d.z)) return { ok: false, why: `stand at ${STAGES[k].name}'s desk` };
  const m = Math.hypot(d.x - rk.x, d.z - rk.z);
  if (m > SNAKE) return { ok: false, why: `the rack is ${Math.round(m)} m from the desk: the snake is ${SNAKE} m` };
  rig(w).snake[k] = true;
  return { ok: true };
}
export const awgName = (awg: number) => (awg === -1 ? "2/0" : `#${awg}`);

// ---- power ----

/** Current on each phase, amps: every plugged feed, all of them (`stage` null), or one stage's feeder. */
export function phaseAmps(w: World, stage?: StageKey | null): Phases {
  const r = rig(w), p: [number, number, number] = [0, 0, 0];
  for (const [k, f] of Object.entries(FEEDS)) {
    const leg = r.phase[k];
    if (!leg || (stage !== undefined && f.stage !== stage)) continue;
    p[LEGS.indexOf(leg)] += f.watts / VOLTS;
  }
  return p;
}
/** Each stage feeder's length: compound to stage, plus the run up onto the deck. */
export const feederLength = (k: StageKey) => Math.round(Math.hypot(STAGES[k].x - COMPOUND.x, STAGES[k].z - COMPOUND.z) + 8);

const round3 = (p: Phases): Phases => [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])];

export function power(w: World) {
  const r = rig(w), g = gear("generator-100kva").generator!, perLeg = (g.kva * 1000 * g.powerFactor) / 3 / VOLTS;
  const all = phaseAmps(w), trips = assist("breakersTrip") && all.some((a) => a > perLeg);
  const stages = Object.fromEntries(STAGE_KEYS.map((k) => {
    const p = phaseAmps(w, k), awg = r.feeder[k], m = feederLength(k), drop = feederDrop(awg, m, p, VOLTS), hot = Math.max(...p) > AMPACITY[awg]!;
    return [k, { amps: round3(p), feeder: awgName(awg), metres: m, drop: Math.round(drop * 1000) / 1000, hot, ok: drop <= MAX_DROP && !hot }];
  })) as Record<StageKey, { amps: Phases; feeder: string; metres: number; drop: number; hot: boolean; ok: boolean }>;
  return { amps: round3(all), perLeg: Math.round(perLeg), imbalance: Math.round(imbalance(all) * 100) / 100, trips, stages };
}

// ---- sound ----

/** dB a stage loses in its speaker cable: rack to the stage front, 12 AWG, two boxes a channel. Null: out of reach. */
export function cableDb(w: World, k: StageKey): number | null {
  const rk = w.items.find((i) => i.key === `${k}-rack`)!, front = onStage(k, rig(w).yaw[k], 0, FRONT);
  const m = Math.hypot(rk.x - front.x, rk.z - front.z) + SIDE;
  return m > SPEAKER_RUN ? null : cableLoss(SPEAKER_AWG, m, CHANNEL_OHMS);
}

/** Whether a stage plays, and why not: its rack in reach of the speakers, powered (on a phase that holds, its feeder
 * not overloaded), and the snake run from its desk. */
export function live(w: World, k: StageKey): { on: boolean; why: string } {
  const r = rig(w), p = power(w);
  if (cableDb(w, k) === null) return { on: false, why: `the rack is too far from the stage for ${SPEAKER_RUN} m of speaker cable` };
  if (!r.phase[`${k}-rack`]) return { on: false, why: "the rack has no power" };
  if (p.trips) return { on: false, why: "the generator tripped" };
  if (p.stages[k].hot && assist("breakersTrip")) return { on: false, why: `the ${p.stages[k].feeder} feeder is overloaded: its breaker tripped` };
  if (!r.snake[k]) return { on: false, why: "no signal: run the snake from the desk" };
  return { on: true, why: "" };
}

/** A stage's sources as they stand: its sub blocks and its tops, at the master less the cable's loss. Silent if not live. */
export function stageSources(w: World, k: StageKey, force = false): Source[] {
  if (!force && !live(w, k).on) return [];
  const r = rig(w), yaw = r.yaw[k], loss = cableDb(w, k) ?? 0, gain = 10 ** ((r.master[k] - loss) / 10);
  const sys = STAGES[k].system, subId = sys === "dance" ? "horn-sub-21" : "arc-sub-18", sh = gear(subId).size.h;
  const out: Source[] = [];
  for (const side of [-1, 1]) {
    const p = onStage(k, yaw, side * SIDE, FRONT);
    out.push(...subBlock(subId, { x: p.x, y: sh / 2, z: p.z }, yaw, r.subs[k], gear(subId).speaker!.ratedWatts * gain));
    const box = (id: string, y: number, turn = 0, a = 0) => {
      const q = onStage(k, yaw, side * SIDE + a, FRONT);
      out.push(source(id, { x: q.x, y, z: q.z }, { yaw: yaw + turn, watts: gear(id).speaker!.ratedWatts * gain }));
    };
    if (sys === "dance") { box("stack-mid-bass", sh + 0.4); box("stack-mid-high", sh + 1.0); }
    else { box("sculpted-3way", sh + 1.55, -0.26, -0.24); box("sculpted-3way", sh + 1.55, 0.26, 0.24); }
  }
  return out;
}

/** Mids and highs from one stage at a point: the air's share taken off, the tent's back wall behind the dance tent, and
 * with `field` the bodies between each box and the listener (at 2 kHz). */
export function highAt(w: World, k: StageKey, x: number, z: number, src = stageSources(w, k), field?: CrowdField): number {
  if (!src.length) return -Infinity;
  const p = { x, y: FIELD.y, z };
  const behind = STAGES[k].system === "dance" && local(k, rig(w).yaw[k], x, z).f < -2 ? TENT_WALL : 0;
  return sumPower(src.filter((s) => s.speaker.highCut > 500).map((s) => splAt(s, p) - airLoss(HIGH_HZ, Math.hypot(x - s.pos.x, z - s.pos.z)) - (field ? crowdLoss(field, s.pos, p, 2000) : 0))) - behind;
}
/** The 63 Hz level from both stages' subs and mid-basses at a point, summed with phase. */
export const lowAt = (src: Source[], x: number, z: number) => (src.length ? levelAt(src, { x, y: FIELD.y, z }, "low", 63) : -Infinity);

export type Heat = { high: Grid; low: Grid; own: Record<StageKey, Grid> };
/**
 * The heat maps: mids and highs from both stages (and each on its own, for the bleed), and the 63 Hz. With `field` (the
 * crowd), the mids and highs are heard through the bodies, but only where people stand: tracing every box through the
 * crowd to all 7,900 cells of the site costs about ten times the empty map, and the score only reads the audiences.
 */
export function heat(w: World, field?: CrowdField): Heat {
  const src = { tent: stageSources(w, "tent"), open: stageSources(w, "open") }, all = [...src.tent, ...src.open];
  const grid = () => ({ ...FIELD, db: new Float32Array(FIELD.nx * FIELD.nz) });
  const high = grid(), low = grid(), own = { tent: grid(), open: grid() };
  const dx = (FIELD.x1 - FIELD.x0) / FIELD.nx, dz = (FIELD.z1 - FIELD.z0) / FIELD.nz;
  for (let iz = 0; iz < FIELD.nz; iz++) for (let ix = 0; ix < FIELD.nx; ix++) {
    const x = FIELD.x0 + (ix + 0.5) * dx, z = FIELD.z0 + (iz + 0.5) * dz, c = iz * FIELD.nx + ix;
    const through = field && STAGE_KEYS.some((k) => inAudience(k, rig(w).yaw[k], x, z)) ? field : undefined;
    own.tent.db[c] = highAt(w, "tent", x, z, src.tent, through);
    own.open.db[c] = highAt(w, "open", x, z, src.open, through);
    high.db[c] = sumPower([own.tent.db[c]!, own.open.db[c]!].filter(Number.isFinite));
    low.db[c] = lowAt(all, x, z);
  }
  return { high, low, own };
}

// ---- the licence and the show ----

/** A song's level against the fader, dB: the set rises and falls (four-minute songs). */
export const SONGS = [0, 2, -1, 3, -3, 1, -2, 2];
export const SONG_S = 240;

/** Mids and highs at a stage's mix position (its desk) from both stages. */
export function atDesk(w: World, k: StageKey): number {
  const d = w.items.find((i) => i.key === `${k}-desk`)!;
  return sumPower(STAGE_KEYS.map((s) => highAt(w, s, d.x, d.z)).filter(Number.isFinite));
}
/** Mids and highs at the loudest of the nearest houses. */
export const atHouses = (w: World) => Math.max(...HOUSES.map((h) => sumPower(STAGE_KEYS.map((s) => highAt(w, s, h.x, h.z)).filter(Number.isFinite))));

/** Run the show `seconds` on: each mix position's level is logged song by song (the fader plus the song), and anything
 * still playing past curfew is written down. */
export function run(w: World, seconds: number) {
  const r = rig(w), end = r.clock + seconds;
  const base = { tent: atDesk(w, "tent"), open: atDesk(w, "open") };
  while (r.clock < end) {
    const song = Math.floor(r.clock / SONG_S), next = Math.min(end, (song + 1) * SONG_S), len = next - r.clock, lift = SONGS[song % SONGS.length]!;
    for (const k of STAGE_KEYS) {
      const db = Number.isFinite(base[k]) ? base[k] + lift : -Infinity;
      r.log[k].push({ seconds: len, db });
      if (r.clock >= CURFEW_H * 3600 && live(w, k).on) r.late = Math.max(r.late ?? -Infinity, db);
    }
    r.clock = next;
  }
  w.t += seconds;
}
/** The clock on the field, "21:40". */
export const clockAt = (s: number) => { const m = Math.floor(s / 60) + 18 * 60; return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

// ---- the score ----

export type StageScore = {
  live: boolean; why: string;
  /** Share of its audience within WINDOW of TARGET, and the mean there. */
  covered: number; level: number | null;
  /** Share of its audience where the other stage is BLEED_MARGIN under this one, and the worst margin. */
  bleedOk: number; bleed: number | null;
  /** dB lost in the speaker cable (null: out of reach), and the running LAeq at its desk. */
  cableDb: number | null; leq: number | null;
};
export type Score = { stages: Record<StageKey, StageScore>; fence: number | null; houses: number | null; power: ReturnType<typeof power>; powerOk: boolean; licenceOk: boolean; curfewOk: boolean; score: number; pass: boolean };

const r1 = (v: number) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/** 30 points a stage (20 its audience at the target, 10 the other stage well under it there), 10 for the fence's
 * lows, 5 for the houses, 10 for the licence at both desks, 10 for power that holds, balanced, with feeders sized
 * right, and 5 for racks by their speakers. Past curfew, nothing for the licence. */
export function score(w: World, h: Heat = heat(w)): Score {
  const r = rig(w), stages = {} as Record<StageKey, StageScore>;
  let pts = 0;
  for (const k of STAGE_KEYS) {
    const o = k === "tent" ? "open" : "tent", yaw = r.yaw[k], own: number[] = [], margin: number[] = [];
    const dx = (FIELD.x1 - FIELD.x0) / FIELD.nx, dz = (FIELD.z1 - FIELD.z0) / FIELD.nz;
    for (let iz = 0; iz < FIELD.nz; iz++) for (let ix = 0; ix < FIELD.nx; ix++) {
      if (!inAudience(k, yaw, FIELD.x0 + (ix + 0.5) * dx, FIELD.z0 + (iz + 0.5) * dz)) continue;
      const c = iz * FIELD.nx + ix, mine = h.own[k].db[c]!, theirs = h.own[o].db[c]!;
      own.push(mine);
      margin.push(Number.isFinite(mine) ? (Number.isFinite(theirs) ? mine - theirs : 99) : -99);
    }
    const lv = live(w, k), covered = own.filter((d) => Math.abs(d - TARGET) <= WINDOW).length / Math.max(1, own.length);
    const bleedOk = margin.filter((m) => m >= BLEED_MARGIN).length / Math.max(1, margin.length);
    const mean = own.some(Number.isFinite) ? 10 * Math.log10(own.reduce((s, d) => s + (Number.isFinite(d) ? 10 ** (d / 10) : 0), 0) / own.length) : -Infinity;
    const lq = r.log[k].length ? worstLeq(r.log[k]) : atDesk(w, k);
    stages[k] = { live: lv.on, why: lv.why, covered: Math.round(covered * 100) / 100, level: r1(mean), bleedOk: Math.round(bleedOk * 100) / 100, bleed: r1(Math.min(...margin)), cableDb: (() => { const c = cableDb(w, k); return c === null ? null : Math.round(c * 100) / 100; })(), leq: r1(lq) };
    pts += 20 * covered + (lv.on ? 10 * bleedOk : 0) + (lv.on && (cableDb(w, k) ?? 9) <= NEAR_DB ? 2.5 : 0);
  }
  const all = [...stageSources(w, "tent"), ...stageSources(w, "open")];
  let fence = -Infinity;
  for (let x = FIELD.x0; x <= FIELD.x1; x += 4) fence = Math.max(fence, lowAt(all, x, FENCE_Z));
  const houses = atHouses(w), p = power(w);
  const powerOk = !p.trips && STAGE_KEYS.every((k) => p.stages[k].ok) && p.imbalance <= 0.2 && Object.values(r.phase).every(Boolean);
  const curfewOk = r.late === null;
  const licenceOk = curfewOk && STAGE_KEYS.every((k) => (stages[k].leq ?? -Infinity) <= MIX_LIMIT);
  const anyLive = STAGE_KEYS.some((k) => stages[k].live);
  pts += anyLive ? 10 * clamp(1 - (fence - FENCE_LIMIT) / 6, 0, 1) + 5 * clamp(1 - (houses - HOUSE_LIMIT) / 5, 0, 1) : 0;
  pts += anyLive && licenceOk ? 10 : 0;
  pts += powerOk ? 10 : 0;
  const s = Math.round(pts);
  return { stages, fence: r1(fence), houses: r1(houses), power: p, powerOk, licenceOk, curfewOk, score: s, pass: s >= PASS };
}

// ---- the crowd ----

/** The ground people can stand on: the field inside the fence, in the map's 2 m cells. */
const GROUND = { x0: FIELD.x0, x1: FIELD.x1, z0: -52, z1: FIELD.z1, nx: FIELD.nx, nz: 60 };
/** A festival crowd stands looser than a club's: about two a square metre at the barrier, thinning to the mix tent. */
const BARRIER = 2.2, THIN = 0.05;

/** `people`, half at each stage: in its audience wherever the stage faces, densest at the barrier 8 m out and thinning back. */
export function audiences(yaw: Record<StageKey, number>, people: number): CrowdField {
  const { x0, x1, z0, z1, nx, nz } = GROUND, dx = (x1 - x0) / nx, dz = (z1 - z0) / nz, density = new Float32Array(nx * nz);
  for (const k of STAGE_KEYS) {
    const share = new Float32Array(nx * nz);
    let sum = 0;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const x = x0 + (ix + 0.5) * dx, z = z0 + (iz + 0.5) * dz;
      if (inAudience(k, yaw[k], x, z)) sum += share[iz * nx + ix] = Math.exp(-THIN * (local(k, yaw[k], x, z).f - 8));
    }
    const each = sum > 0 ? Math.min(BARRIER, people / STAGE_KEYS.length / (sum * dx * dz)) : 0;
    for (let c = 0; c < share.length; c++) density[c] = Math.max(density[c]!, share[c]! * each);
  }
  return { ...GROUND, density };
}

/** The box round a stage's audience on the field, whichever way it faces. */
function audienceBox(k: StageKey, yaw: number) {
  const corners = [[-15, 8], [15, 8], [-15, 38], [15, 38]].map(([a, f]) => onStage(k, yaw, a!, f!));
  return { x0: Math.min(...corners.map((p) => p.x)), x1: Math.max(...corners.map((p) => p.x)), z0: Math.min(...corners.map((p) => p.z)), z1: Math.max(...corners.map((p) => p.z)) };
}

/** A festival's crowd as the stages face: 1,000 at each. Out of doors, so nothing rings. */
const spotFacing = (yaw: Record<StageKey, number>): CrowdSpot => ({
  floor: GROUND, stageZ: 0, peak: BARRIER, capacity: 2000, room: null,
  fill: (people) => audiences(yaw, people),
  regions: STAGE_KEYS.map((k) => ({ name: STAGES[k].name, zone: audienceBox(k, yaw[k]) })),
});
/** The festival's crowd with the stages as they come (facing each other); `crowdSpot` is the one for the stages as you turned them. */
export const CROWD: CrowdSpot = spotFacing({ tent: Math.PI / 2, open: -Math.PI / 2 });
export const crowdSpot = (w: World): CrowdSpot => spotFacing({ ...rig(w).yaw });

/** The crowd the field is set for: the one that came in, else the one expected, standing where the stages face now. */
const crowdField = (w: World): CrowdField => crowdOf(w)?.field ?? audiences(rig(w).yaw, comingTonight(w, CROWD));

/** The field at soundcheck (empty) and with the crowd on it: the lows, the licence and the power are the same in both. */
export function scores(w: World, empty: Heat = heat(w), full: Heat = heat(w, crowdField(w))) {
  return { soundcheck: score(w, empty), full: score(w, full), empty, fullHeat: full };
}

/** The crowd for the harness: how many, and each stage's people, what they hear at soundcheck and with everyone in, and their mood. */
export function crowdState(w: World, s = scores(w)) {
  const c = crowdOf(w), f = crowdField(w), cell = ((f.x1 - f.x0) / f.nx) * ((f.z1 - f.z0) / f.nz), yaw = rig(w).yaw;
  return {
    in: !!c, count: c?.people ?? 0, expected: comingTonight(w, CROWD),
    stages: !c ? [] : STAGE_KEYS.map((k) => {
      let people = 0;
      for (let iz = 0; iz < f.nz; iz++) for (let ix = 0; ix < f.nx; ix++) {
        if (inAudience(k, yaw[k], f.x0 + ((ix + 0.5) * (f.x1 - f.x0)) / f.nx, f.z0 + ((iz + 0.5) * (f.z1 - f.z0)) / f.nz)) people += f.density[iz * f.nx + ix]! * cell;
      }
      const soundcheck = s.soundcheck.stages[k].level, full = s.full.stages[k].level;
      return { name: STAGES[k].name, people: Math.round(people), density: Math.round((people / 900) * 10) / 10, soundcheck, full, ...moodOf(full, TARGET, WINDOW) };
    }),
  };
}

/**
 * Show time: the field as set at soundcheck, scaled by the crowd's mood (a late start costs it), and the pay. The score
 * with the crowd in is on the card and in the state but doesn't count yet: both systems stand on the ground at head
 * height, so the back of each audience hears them through every row, and the level has no way to lift the tops over
 * the heads (#5352).
 */
export function show(w: World) {
  const s = score(w), d = doors(w.level.name, w.t), total = showScore(s.score, d.mood);
  return { sound: s.score, mood: d.mood, late: Math.round(d.late), pay: d.pay, fee: d.fee, score: total, pass: total >= PASS };
}
export type Show = ReturnType<typeof show>;

/** What the harness adds for the festival. */
export function festivalState(w: World, h?: Heat, full?: Heat) {
  const r = rig(w), both = scores(w, h, full), s = both.soundcheck;
  return {
    clock: clockAt(r.clock), curfew: clockAt(CURFEW_H * 3600),
    stages: Object.fromEntries(STAGE_KEYS.map((k) => [k, { ...s.stages[k], facing: Math.round((r.yaw[k] * 180) / Math.PI), subs: r.subs[k], master: r.master[k], snake: r.snake[k], running: r1(runningLeq(r.log[k])) }])),
    fence: s.fence, fenceLimit: FENCE_LIMIT, houses: s.houses, houseLimit: HOUSE_LIMIT, mixLimit: MIX_LIMIT,
    phases: r.phase, power: s.power, powerOk: s.powerOk, licenceOk: s.licenceOk, curfewOk: s.curfewOk, score: s.score, pass: s.pass,
    full: { score: both.full.score, pass: both.full.pass, stages: Object.fromEntries(STAGE_KEYS.map((k) => [k, { covered: both.full.stages[k].covered, level: both.full.stages[k].level, bleedOk: both.full.stages[k].bleedOk }])) },
    people: crowdState(w, both),
  };
}
