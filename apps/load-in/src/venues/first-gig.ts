// The first gig: a small room with a low stage, one singer, and you wire up a sound board. One condenser mic on a
// stand, one small desk at the back of the room, one amp rack, one passive wedge on stage, and the wall's power. The
// jobs go in the real order: the rack near the stage, power to the rack and the desk, the mic into the desk with 48 V
// on (a condenser takes its power down the same XLR; no phantom, no sound), the desk's aux out to the amp, the amp to
// the wedge; then the desk on and the amp last (and off first), or the wedge thumps.
//
// Why the rack goes by the stage: an XLR carries a line-level signal into a 10 kohm input, so 15 m of it loses nothing.
// Speaker cable carries amps of current into 8 ohms, so its own resistance eats level and, worse, the amp's grip on
// the cone (the damping factor: the load's ohms over the cable's). A long thin speaker run makes the wedge soft and
// woolly. Short speaker run, long signal run. `judge` scores that with packages/gear's `ohmsPerMetre` and `cableLoss`.
// Plain data, no DOM.
import { clamp } from "@rustybuns/util";
import { type Cable, type Flick, type Placed, type Problem, cableLoss, compile, gear as catalog, jackNames, ohmsPerMetre, source, splAt, thumps } from "@rustybuns/gear";
import { doors, showScore } from "../clock.ts";
import type { Level, World } from "../sim.ts";
import type { Switches } from "../audio/hear.ts";
import { type Cables, plugged } from "../cables/cables.ts";

export const FIRST_GIG: Level = {
  name: "first-gig",
  bounds: { x0: -3.25, x1: 3.25, z0: 0.25, z1: 15.75 },
  room: { x0: -3.5, x1: 3.5, z0: 0, z1: 10, height: 3, door: 2 },
  // One wall circuit: a double outlet behind the stage and one on the side wall by the desk.
  outlets: [
    { key: "stage-wall", x: -2.4, y: 0.3, z: 0.01, circuit: "1", amps: 20 },
    { key: "side-wall", x: 3.49, y: 0.3, z: 8, circuit: "1", amps: 20 },
  ],
  walkways: [{ name: "the way in", x0: -0.5, x1: 0.5, z0: 3, z1: 11.5 }],
  start: { x: 0, z: 11.4, yaw: 0 },
  truck: { x0: -1.1, x1: 1.1, z0: 12, z1: 15.8, h: 2 },
  // Desk before rack, so the next-step line says to switch the desk on first.
  items: [
    { key: "desk", gear: "mixer-small", x: -0.6, y: 0, z: 12.5, rot: 0 },
    { key: "rack", gear: "amp-rack-4u", x: 0.5, y: 0, z: 12.6, rot: 0 },
    { key: "wedge", gear: "wedge-12-passive", x: -0.5, y: 0, z: 13.4, rot: 0 },
    { key: "stand", gear: "mic-stand", x: 0.6, y: 0, z: 13.6, rot: 0 },
    { key: "mic", gear: "mic-condenser", x: 0.2, y: 0, z: 13.4, rot: 0 },
    { key: "case", gear: "road-case-m", x: 0, y: 0, z: 14.6, rot: 0 },
  ],
  // Two short power leads, a long XLR for the mic and one for the aux send (the "snake" of a gig this size), a short
  // XLR, and a short and a long speaker cable, so the rack can sit by the stage or, the beginner's way, by the desk.
  caseLoad: [
    { key: "power-5a", kind: "power", lengthM: 5 },
    { key: "power-5b", kind: "power", lengthM: 5 },
    { key: "xlr-15a", kind: "xlr", lengthM: 15 },
    { key: "xlr-15b", kind: "xlr", lengthM: 15 },
    { key: "xlr-3", kind: "xlr", lengthM: 3 },
    { key: "speaker-3", kind: "speaker", lengthM: 3 },
    { key: "speaker-15", kind: "speaker", lengthM: 15 },
  ],
};

/** Where things go, for the floor marks: the stage at the back wall and the mix position at the back of the room. */
export const ZONES = {
  stage: { x0: -3.5, x1: 3.5, z0: 0, z1: 2.5 },
  desk: { x0: 1.5, x1: 3.5, z0: 7, z1: 9.5 },
};

/** Speaker cable is 16 AWG. */
export const SPEAKER_AWG = 16;
/** Watts the desk's aux sends the wedge: a wedge mix sits about 100 dB at the singer's ears. */
export const AUX_W = 8;
/** The level a singer wants from the wedge at their head, dB SPL, and how far off still counts in full. */
export const TARGET = 100, WINDOW = 3;
/** A wedge's face is angled up at about 40 degrees; it sits on the floor in front of the singer, facing them. */
export const WEDGE_PITCH = 0.7;
/** The singer stands this far behind the mic stand, ears at this height. */
const BEHIND = 0.25, EARS = 1.65;
/** Damping factor this high and the amp holds the cone; at `DF_POOR` and under the low end goes loose. */
export const DF_GOOD = 50, DF_POOR = 10;
export const PASS = 85;

/** What the first gig keeps beside the world: the desk's 48 V switch and every power switch thrown, in order. */
export type Gig = { phantom: boolean; flicks: Flick[]; seen: Set<string> };
const gigs = new WeakMap<World, Gig>();
export function gig(w: World): Gig {
  let g = gigs.get(w);
  if (!g) gigs.set(w, (g = { phantom: false, flicks: [], seen: new Set() }));
  return g;
}

/** The desk's 48 V phantom switch. */
export function phantom(w: World, on: boolean) {
  gig(w).phantom = on;
}

/** Note what was switched since the last look, in order: the page's switches are a set, the thump rule needs the order. */
export function syncSwitches(w: World, on: Switches) {
  const g = gig(w);
  for (const k of g.seen) if (!on.has(k)) g.flicks.push({ id: k, on: false });
  for (const k of on) if (!g.seen.has(k)) g.flicks.push({ id: k, on: true });
  g.seen = new Set(on);
}

export type Judged = {
  /** The wedge plays the mic: patched, powered, 48 V on, desk and amp switched on. */
  fed: boolean;
  problems: Problem[];
  /** The speaker run's length, its loss in dB and the damping factor it leaves (null with no speaker cable in). */
  speakerM: number | null;
  lossDb: number;
  damping: number | null;
  /** dB SPL at the singer's head from the wedge, or null while it doesn't play. */
  atHead: number | null;
};

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The gear as compile reads it, with the desk's 48 V. */
function placedOf(w: World): Placed[] {
  return w.items.filter((i) => jackNames(catalog(i.gear)).length).map((i) => ({ id: i.key, gear: i.gear, ...(i.gear === "mixer-small" ? { phantom: gig(w).phantom } : {}) }));
}

/** The cables you have laid with both ends in, as compile reads them. */
export const runsOf = (w: World, c: Cables): Cable[] => plugged(w, c).runs;

/** Judge the first gig: compile the patch, add the thumps, then what the singer hears and what the speaker run costs. */
export function judge(w: World, runs: readonly Cable[], on: Switches): Judged {
  syncSwitches(w, on);
  const placed = placedOf(w);
  const outlets = w.level.outlets.map((o) => ({ id: o.key, circuit: o.circuit ?? w.level.name, breaker: { volts: 120, amps: o.amps ?? 15 } }));
  const r = compile(placed, runs, { outlets });
  const problems = [...r.problems, ...thumps(placed, runs, gig(w).flicks)];
  const switched = (gearId: string) => w.items.filter((i) => i.gear === gearId).every((i) => on.has(i.key));
  const wedge = w.items.find((i) => i.gear === "wedge-12-passive");
  const fed = !!wedge && r.fed.get(wedge.key) === true && switched("mixer-small") && switched("amp-rack-4u");

  const run = wedge && runs.find((x) => x.kind === "speaker" && [x.from, x.to].some(([id, j]) => id === wedge.key && j === "speaker-in"));
  const ohms = catalog("wedge-12-passive").speaker!.ohms!;
  const speakerM = run ? run.lengthM : null;
  const lossDb = speakerM === null ? 0 : cableLoss(SPEAKER_AWG, speakerM, ohms);
  const damping = speakerM === null ? null : ohms / (2 * speakerM * ohmsPerMetre(SPEAKER_AWG));

  const stand = w.items.find((i) => i.gear === "mic-stand");
  let atHead: number | null = null;
  if (fed && wedge && stand && wedge.key !== w.held?.key) {
    const src = source(wedge.gear, { x: wedge.x, y: 0.25, z: wedge.z }, { yaw: wedge.rot, pitch: WEDGE_PITCH, watts: AUX_W });
    atHead = splAt(src, { x: stand.x, y: EARS, z: stand.z - BEHIND }) - lossDb;
  }
  return { fed, problems, speakerM, lossDb: Math.round(lossDb * 100) / 100, damping: damping === null ? null : Math.round(damping), atHead: atHead === null ? null : r1(atHead) };
}

/** The jobs in the order a sound crew does them, each done or not. */
export function jobs(w: World, runs: readonly Cable[], on: Switches, j: Judged = judge(w, runs, on)): { job: string; done: boolean }[] {
  const into = (id: string, jack: string) => runs.some((x) => [x.from, x.to].some(([a, b]) => a === id && b.startsWith(jack)));
  const of = (gearId: string) => w.items.find((i) => i.gear === gearId)?.key ?? "";
  const desk = of("mixer-small"), rack = of("amp-rack-4u"), wedge = of("wedge-12-passive"), mic = of("mic-condenser");
  const rackItem = w.items.find((i) => i.key === rack);
  return [
    { job: "Amp rack by the stage", done: !!rackItem && rackItem.z <= ZONES.stage.z1 + 1.5 && rackItem.z >= 0 },
    { job: "Power to the rack and the desk", done: into(rack, "power-in") && into(desk, "power-in") },
    { job: "Mic to a desk input, 48 V on", done: into(mic, "xlr-out") && gig(w).phantom },
    { job: "Desk aux out to the amp", done: into(desk, "xlr-out") && into(rack, "xlr-in") },
    { job: "Amp out to the wedge", done: into(rack, "speaker-out") && into(wedge, "speaker-in") },
    { job: "Desk on, then the amp", done: j.fed && !j.problems.some((p) => p.kind === "thump") },
  ];
}

/**
 * How the first gig sounds, out of 100: 40 for a wedge that plays the mic, 25 for its level at the singer's head (full
 * within WINDOW dB of TARGET, none 12 dB off), 15 for the speaker run's damping factor, 20 less 10 for every fault (a
 * thump, no phantom, a hum).
 */
export function score(j: Judged): { score: number; faults: string[] } {
  const faults = j.problems.map((p) => p.message);
  const level = j.atHead === null ? 0 : clamp(1 - (Math.abs(j.atHead - TARGET) - WINDOW) / (12 - WINDOW), 0, 1);
  const grip = j.damping === null ? 0 : clamp((j.damping - DF_POOR) / (DF_GOOD - DF_POOR), 0, 1);
  const s = (j.fed ? 40 : 0) + 25 * level + 15 * grip + Math.max(0, 20 - 10 * faults.length);
  return { score: Math.round(s), faults };
}

/** Doors: the sound scaled by the crowd's mood (late doors sour it), and the pay. */
export function show(w: World, runs: readonly Cable[], on: Switches) {
  const j = judge(w, runs, on), s = score(j), d = doors(w.level.name, w.t), total = showScore(s.score, d.mood);
  return { sound: s.score, faults: s.faults, mood: d.mood, late: Math.round(d.late), pay: d.pay, fee: d.fee, score: total, pass: total >= PASS };
}
export type Show = ReturnType<typeof show>;

/** What the harness adds for the first gig. */
export function gigState(w: World, runs: readonly Cable[], on: Switches) {
  const j = judge(w, runs, on);
  return { phantom: gig(w).phantom, ...j, problems: j.problems.map((p) => p.message), jobs: jobs(w, runs, on, j), ...score(j) };
}
