// Band night (#5029 step 6): a three-piece in a bar, the rung after the first gig. The house PA is in already; the job
// is the band's inputs. A stage plot and an input list on a clipboard: kick, snare, bass DI, the guitar amp's mic and
// two vocals. Put each mic and the DI at its mark, run each into its input on a 12-way stage box, run the snake (a
// 12-pair multicore, 0.9 kg a metre, so a 30 m roll is 27 kg) from the stage box to the fan at the desk, whose tails
// sit in the desk's channels in order. Then the line check: each player plays alone and you listen for them on their
// channel. One to three faults are seeded a night (@rustybuns/gear `lineCheck`): a dead cable, a crackling one, two
// stage box inputs crossed, a ground-loop hum through the bass DI. Swap, repatch, lift. The vocal 2 mic is a
// condenser, so the desk's 48 V goes on as at the first gig.
// Plain data, no DOM.
import { clamp, mulberry32 } from "@rustybuns/util";
import { type Fault, type Heard, type KeyedCable, type Line, type Placed, compile, gear as catalog, jackNames, lineCheck, lineProblems } from "@rustybuns/gear";
import { doors, showScore } from "../clock.ts";
import type { Level, World } from "../sim.ts";
import type { Switches } from "../audio/hear.ts";
import type { Cables } from "../cables/cables.ts";

export const BAND_NIGHT: Level = {
  name: "band-night",
  bounds: { x0: -3.75, x1: 3.75, z0: 0.25, z1: 16.75 },
  room: { x0: -4, x1: 4, z0: 0, z1: 11, height: 3.2, door: 2.2 },
  outlets: [
    { key: "stage-wall", x: -3.2, y: 0.3, z: 0.01, circuit: "stage", amps: 20 },
    { key: "desk-wall", x: 3.99, y: 0.3, z: 9, circuit: "house", amps: 20 },
  ],
  walkways: [{ name: "the way in", x0: -0.6, x1: 0.6, z0: 3.5, z1: 12 }],
  start: { x: 0, z: 12.4, yaw: 0 },
  truck: { x0: -1.2, x1: 1.2, z0: 13, z1: 16.8, h: 2 },
  items: [
    // The band's backline, set up by the band.
    { key: "drums", gear: "drum-kit", x: 0, y: 0, z: 0.9, rot: 0 },
    { key: "bass-amp", gear: "bass-amp", x: -2.6, y: 0, z: 0.5, rot: 0 },
    { key: "combo", gear: "guitar-combo", x: 2.6, y: 0, z: 0.5, rot: 0 },
    // Yours, off the truck: the desk first, then the stage box, the fan, the mics and the DI (the band's stands and clips are up already: each mic goes to its mark).
    { key: "desk", gear: "mixer-small", x: -0.7, y: 0, z: 13.4, rot: 0 },
    { key: "stage-box", gear: "stage-box-12", x: 0.6, y: 0, z: 13.4, rot: 0 },
    { key: "fan", gear: "snake-fan-12", x: -0.7, y: 0, z: 14, rot: 0 },
    { key: "kick-mic", gear: "mic-kick", x: 0.2, y: 0, z: 14.2, rot: 0 },
    { key: "snare-mic", gear: "mic-dynamic", x: 0.5, y: 0, z: 14.2, rot: 0 },
    { key: "bass-di", gear: "di-box", x: 0.8, y: 0, z: 14.2, rot: 0 },
    { key: "gtr-mic", gear: "mic-dynamic", x: 0.2, y: 0, z: 14.6, rot: 0 },
    { key: "vox-1", gear: "mic-dynamic", x: 0.5, y: 0, z: 14.6, rot: 0 },
    { key: "vox-2", gear: "mic-condenser", x: 0.8, y: 0, z: 14.6, rot: 0 },
    { key: "case", gear: "road-case-m", x: 0, y: 0, z: 15.5, rot: 0 },
  ],
  // With a crew, the band's stands and hardware come too, set down on the dock by the truck: 65 kg, a lift for two.
  crewItems: [{ key: "trunk", gear: "trunk-case", x: -2.4, y: 0, z: 13.8, rot: Math.PI / 2 }],
  // Six 10 m mic cables and two spares, the 30 m snake, a power lead for the desk.
  caseLoad: [
    ...["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => ({ key: `xlr-${k}`, kind: "xlr" as const, lengthM: 10 })),
    { key: "snake", kind: "multi", lengthM: 30 },
    { key: "power-5", kind: "power", lengthM: 5 },
  ],
};

/** The stage and the mix position at the back of the room, for the floor marks. */
export const ZONES = {
  stage: { x0: -4, x1: 4, z0: 0, z1: 3 },
  desk: { x0: 1.8, x1: 4, z0: 8.2, z1: 10.6 },
};

/** The input list, in channel order: what it is, the mic or DI that picks it up, and its mark on the stage plot. */
export const INPUTS: readonly (Line & { mark: { x: number; z: number } })[] = [
  { channel: 1, what: "Kick", source: "kick-mic", mark: { x: -0.3, z: 1.9 } },
  { channel: 2, what: "Snare", source: "snare-mic", mark: { x: 0.5, z: 1.9 } },
  { channel: 3, what: "Bass DI", source: "bass-di", mark: { x: -2.6, z: 1.1 } },
  { channel: 4, what: "Guitar", source: "gtr-mic", mark: { x: 2.6, z: 0.95 } },
  { channel: 5, what: "Vocal 1", source: "vox-1", mark: { x: 0.3, z: 2.75 } },
  { channel: 6, what: "Vocal 2", source: "vox-2", mark: { x: -1.6, z: 2.5 } },
];
/** How near its mark a mic or the DI counts as placed, metres. */
export const MARK_M = 0.9;
export const PASS = 85;

/** One to three of tonight's faults, seeded: a test or a night on tour gets the same stage twice. */
export function faultsFor(seed: number): Fault[] {
  const rnd = mulberry32(seed), pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const cables = ["a", "b", "c", "d", "e", "f"].map((k) => `xlr-${k}`);
  const dead = pick(cables), crackle = pick(cables.filter((c) => c !== dead));
  const a = 1 + Math.floor(rnd() * 6), b = 1 + ((a + Math.floor(rnd() * 5)) % 6);
  const pool: Fault[] = [{ kind: "dead", cable: dead }, { kind: "crackle", cable: crackle }, { kind: "crossed", a, b }, { kind: "hum", di: "bass-di" }];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, 1 + Math.floor(rnd() * 3));
}

/** What band night keeps beside the world: the desk's 48 V, the DI's lift, tonight's faults and the inputs checked. */
export type Night = { phantom: boolean; lift: boolean; faults: Fault[]; checked: Set<number>; last: Heard | null };
const nights = new WeakMap<World, Night>();
export function night(w: World, seed = 1): Night {
  let n = nights.get(w);
  if (!n) nights.set(w, (n = { phantom: false, lift: false, faults: faultsFor(seed), checked: new Set(), last: null }));
  return n;
}

/** The cables with both ends in, with their own keys (a dead cable stays dead wherever it goes). */
export function keyedRuns(c: Cables): KeyedCable[] {
  const out: KeyedCable[] = [];
  for (const r of c.runs) if ("plug" in r.a && "plug" in r.b) out.push({ key: r.key, kind: r.kind, lengthM: r.lengthM, from: r.a.plug, to: r.b.plug });
  return out;
}

function placedOf(w: World): Placed[] {
  const n = night(w);
  return w.items.filter((i) => jackNames(catalog(i.gear)).length).map((i) => ({
    id: i.key, gear: i.gear,
    ...(i.gear === "mixer-small" ? { phantom: n.phantom } : {}),
    ...(i.gear === "di-box" ? { lift: n.lift } : {}),
  }));
}

export type Judged = { heard: Heard[]; deskOn: boolean; problems: string[]; placed: number; checked: number };

/** Judge the night as the patch stands: what each input comes up as, the desk's power, the marks and the checks. */
export function judge(w: World, runs: readonly KeyedCable[], on: Switches): Judged {
  const n = night(w), placed = placedOf(w);
  const outlets = w.level.outlets.map((o) => ({ id: o.key, circuit: o.circuit ?? w.level.name, breaker: { volts: 120, amps: o.amps ?? 15 } }));
  const patched = compile(placed, runs, { outlets }).problems.filter((p) => p.kind !== "hum" && p.kind !== "no-phantom" && !(p.kind === "no-power" && p.items[0] !== "desk"));
  const deskOn = on.has("desk") && !patched.some((p) => p.kind === "no-power");
  const heard = lineCheck(placed, runs, INPUTS, n.faults, { id: "desk", powered: deskOn });
  const at = (key: string) => w.items.find((i) => i.key === key && i.key !== w.held?.key);
  const marked = INPUTS.filter((l) => {
    const i = at(l.source);
    return !!i && Math.hypot(i.x - l.mark.x, i.z - l.mark.z) <= MARK_M;
  }).length;
  const problems = [...patched.map((p) => p.message), ...lineProblems(heard).map((p) => p.message)];
  return { heard, deskOn, problems, placed: marked, checked: n.checked.size };
}

/** The line check of one channel's player: they play alone, and you hear what that channel really carries. */
export function check(w: World, runs: readonly KeyedCable[], on: Switches, channel: number): Heard | null {
  const h = judge(w, runs, on).heard.find((x) => x.channel === channel) ?? null;
  if (h) night(w).checked.add(channel), (night(w).last = h);
  return h;
}

/** The jobs in the order a crew does them, each done or not. */
export function jobs(w: World, runs: readonly KeyedCable[], j: Judged): { job: string; done: boolean }[] {
  const box = w.items.find((i) => i.gear === "stage-box-12");
  const into = (id: string, jack: string) => runs.some((x) => [x.from, x.to].some(([a, b]) => a === id && b.startsWith(jack)));
  return [
    { job: "Stage box on the stage", done: !!box && box.key !== w.held?.key && box.z <= ZONES.stage.z1 },
    { job: "Each mic and the DI on its mark", done: j.placed === INPUTS.length },
    { job: "Every input into the stage box", done: INPUTS.every((l) => into(l.source, "xlr-out")) },
    { job: "The snake from the stage box to the fan", done: runs.some((r) => r.kind === "multi") },
    { job: "Desk powered and on, 48 V for vocal 2", done: j.deskOn && night(w).phantom },
    { job: "Line check every input (L at the desk)", done: j.checked === INPUTS.length },
    { job: "Every input clean on its channel", done: j.heard.every((h) => h.ok) },
  ];
}

/** Out of 100: 70 for the inputs clean on their channels, 15 for the marks, 15 for the line check done. */
export function score(j: Judged): { score: number; faults: string[] } {
  const ok = j.heard.filter((h) => h.ok).length / INPUTS.length;
  const s = 70 * ok + 15 * (j.placed / INPUTS.length) + 15 * clamp(j.checked / INPUTS.length, 0, 1);
  return { score: Math.round(s), faults: j.problems };
}

/** Doors: the band plays what you patched; the sound scaled by the crowd's mood, and the pay. */
export function show(w: World, runs: readonly KeyedCable[], on: Switches) {
  const j = judge(w, runs, on), s = score(j), d = doors(w.level.name, w.t), total = showScore(s.score, d.mood);
  return { sound: s.score, faults: s.faults, mood: d.mood, late: Math.round(d.late), pay: d.pay, fee: d.fee, score: total, pass: total >= PASS };
}
export type Show = ReturnType<typeof show>;

/** What `loadIn.state().bandNight` says. */
export function bandNightState(w: World, runs: readonly KeyedCable[], on: Switches) {
  const n = night(w), j = judge(w, runs, on);
  return {
    phantom: n.phantom, lift: n.lift, seeded: n.faults, deskOn: j.deskOn,
    inputs: j.heard.map((h) => ({ channel: h.channel, what: h.what, on: h.on, sound: h.sound, ok: h.ok, checked: n.checked.has(h.channel), why: h.why })),
    last: n.last, problems: j.problems, jobs: jobs(w, runs, j), ...score(j),
  };
}
