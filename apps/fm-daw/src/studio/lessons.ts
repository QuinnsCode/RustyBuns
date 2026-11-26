// The jam room's setup lessons (#5861, PATHWAYS.md path 1): learn to set gear up with your hands, at the studio's gear
// wall, on the sesh's own patch. Plug a guitar through a pedal into an amp and its cab; patch a sound wall voice, VCO to
// VCF to VCA to Q Out; set up a small PA, placed, aimed and powered on in order; learn the PA's XLRs, a speaker's
// combo input and its thru (#6029), from the connector list Sound Guy Simulator plugs by (@rustybuns/util/connectors). Each lesson is a list of steps on
// @rustybuns/gear's checker (Sound Guy Simulator's), read from the patch as it stands: a step is done when the gear says
// so, and the next one not done says what to do and, when something is in the way, what and why in plain words. The
// PA's switch-on order is the catalog's own `thumps`, its aim the catalog speaker's coverage. Nothing is reset or locked:
// leave whenever you like, and what you built stays, the room's own rig to keep playing. Pure: no DOM.
import { type Checked, type Flick, type Step, aimTo, checkSteps, gear as catalog, offAxisLoss, thumps } from "@rustybuns/gear";
import { CONNECTORS } from "@rustybuns/util/connectors";
import { type Answer, type GearDef, type Room, bringKit, gearOf, heldId, inCase, knobValue, listen } from "../room/room.ts";
import { GEAR_ROOM, type Bounds } from "../room/frame.ts";
import type { Patch } from "../studio.ts";
import type { GearHands } from "./gear-hands.ts";
import type { Jam } from "./jam.ts";

export const LESSONS = [
  { id: "guitar", title: "Plug a guitar into an amp", blurb: "Guitar, through a pedal, into an amp and its cab, with the gain set so it doesn't fizz" },
  { id: "voice", title: "Patch a synth voice", blurb: "On the sound wall: an oscillator through a filter and a level into Q Out" },
  { id: "pa", title: "Set up a PA for a small room", blurb: "Place two speakers, aim them, cable a mic through a mixer, and power on in order" },
  { id: "plugs", title: "Know your plugs: XLR", blurb: "What an XLR carries and its pins: a mic into the mixer, a speaker's combo input, its thru on to the next box" },
] as const;
export type LessonId = (typeof LESSONS)[number]["id"];
const isLesson = (id: string): id is LessonId => LESSONS.some((l) => l.id === id);

/** What a step reads: the sesh's patch, the box in your hands, the room's walls, and the PA's switch flicks in order. */
export type At = { patch: Patch; held: string | null; bounds: Bounds; flicks: readonly Flick[] };
type End = readonly [string, string];

const other = (p: Patch, e: End): End | null => {
  const c = p.cables.find((x) => (x.from[0] === e[0] && x.from[1] === e[1]) || (x.to[0] === e[0] && x.to[1] === e[1]));
  return c ? (c.from[0] === e[0] && c.from[1] === e[1] ? c.to : c.from) : null;
};
const defOf = (p: Patch, id: string): GearDef | undefined => { const x = p.placed.find((q) => q.id === id); return x && gearOf(x); };
const name = (p: Patch, id: string) => defOf(p, id)?.name ?? id;
const jackLabel = (p: Patch, [id, jack]: End) => defOf(p, id)?.jacks.find((j) => j.name === jack)?.label ?? jack.replace(/-/g, " ");
const at = (p: Patch, e: End) => `${name(p, e[0])}'s ${jackLabel(p, e)}`;
const isKind = (p: Patch, e: End | null, kind: GearDef["kind"], jack?: string) => !!e && defOf(p, e[0])?.kind === kind && (!jack || e[1] === jack);

// ---- 1. a guitar into an amp ----

/** From the guitar's jack along the cables: the pedals in a row, then where the last one's Out goes. */
function guitarRun(p: Patch) {
  const g = p.placed.find((x) => x.gear === "guitar"), pedals: string[] = [];
  let end = g ? other(p, [g.id, "out"]) : null;
  while (end && isKind(p, end, "pedal", "in") && !pedals.includes(end[0])) { pedals.push(end[0]); end = other(p, [end[0], "out"]); }
  const amp = pedals.length && isKind(p, end, "amp", "in") ? end![0] : null;
  return { guitar: g?.id ?? null, pedals, end, amp };
}
const ampGain = (p: Patch, amp: string) => { const k = defOf(p, amp)?.knobs.find((x) => x.name === "gain"); return k ? knobValue(p, amp, k) : 0; };
export const HOT_GAIN = 0.7;

const GUITAR: Step<At>[] = [
  {
    job: "Cable your guitar into a pedal: F on the guitar's jack, then F on a pedal's In",
    done: ({ patch }) => guitarRun(patch).pedals.length > 0,
    why: ({ patch }) => {
      const { end } = guitarRun(patch);
      if (!end) return null;
      if (isKind(patch, end, "amp")) return `Your guitar goes straight into ${at(patch, end)}: nothing between to shape its sound. Put a pedal between: the guitar into the pedal's In, the pedal's Out into the amp`;
      return `The guitar's cable is in ${at(patch, end)}. For this lesson it goes into a pedal's In, on the pedal wall`;
    },
  },
  {
    job: "Cable the pedal's Out into the amp's In, on the front of an amp on the rack",
    done: ({ patch }) => !!guitarRun(patch).amp,
    why: ({ patch }) => {
      const { pedals, end } = guitarRun(patch);
      if (!pedals.length || !end) return null;
      if (isKind(patch, end, "amp", "return")) return `That's ${at(patch, end)}, the effects loop on its back: it skips the preamp, so the guitar comes through thin and quiet. Use the In on the amp's front`;
      if (isKind(patch, end, "cab")) return "A pedal can't drive a speaker: its Out is a small signal. It goes into the amp, and the amp drives the cab";
      return `${name(patch, pedals[pedals.length - 1])}'s Out goes to ${at(patch, end)}. Into the amp's In, on its front`;
    },
  },
  {
    job: "Cable the amp's Speaker out, on its back, into the cab (an amp on the rack faces out: lift it onto the cab to reach its back)",
    done: ({ patch }) => { const a = guitarRun(patch).amp; return !!a && isKind(patch, other(patch, [a, "speaker"]), "cab", "in") && listen(patch, 2).playing; },
    why: ({ patch }) => {
      const a = guitarRun(patch).amp;
      if (!a) return null;
      const cab = patch.placed.find((x) => defOf(patch, x.id)?.kind === "cab"), from = cab ? other(patch, [cab.id, "in"]) : null;
      if (from?.[0] === a && from[1] === "line") return "That's the amp's Line out, a small signal for a desk or a recorder: it can't move a speaker. The cab goes on the Speaker out, beside it";
      if (from?.[0] === a && from[1] === "send") return "That's the amp's effects Send: it carries the preamp out to effects and back into Return. The cab goes on the Speaker out";
      const sp = other(patch, [a, "speaker"]);
      if (sp && !isKind(patch, sp, "cab")) return `The amp's Speaker out goes to ${at(patch, sp)}: a speaker out drives a cab, nothing else`;
      if (from && from[0] !== a) return `The cab is fed by ${at(patch, from)}, not the amp your guitar goes into`;
      return null;
    },
  },
  {
    job: `Set the amp's Gain to ${HOT_GAIN * 10} or under: look at its Gain knob, hold F and drag down`,
    done: ({ patch }) => { const a = guitarRun(patch).amp; return !!a && ampGain(patch, a) <= HOT_GAIN + 1e-6; },
    why: ({ patch }) => {
      const a = guitarRun(patch).amp;
      if (!a) return null;
      return `Gain too hot (${Math.round(ampGain(patch, a) * 10)} of 10): with a pedal in front, the amp's first valve clips so hard every note smears into fizz and the pedal's own sound is lost. Turn its Gain down to ${HOT_GAIN * 10} or under`;
    },
  },
];

// ---- 2. a sound wall voice ----

/** The first module of a kind standing in the case (with power), by its panel id. */
const mod = (p: Patch, circuit: string) => p.placed.find((x) => inCase(x) && gearOf(x)?.circuit === circuit)?.id ?? null;
const outsOf = (p: Patch, id: string | null, jacks: string[]) => (id ? jacks.flatMap((j) => { const e = other(p, [id, j]); return e ? [e] : []; }) : []);
const missing = (p: Patch, need: [string, string][]) => { const gone = need.find(([c]) => !mod(p, c)); return gone ? `There's no ${gone[1]} in the sound wall's case: K brings one, then set it into a row of the case` : null; };

const VOICE: Step<At>[] = [
  {
    job: "Patch Q Saw's Saw (or Pulse) into Q Filter's In",
    done: ({ patch }) => { const f = mod(patch, "vcf"); return outsOf(patch, mod(patch, "vco"), ["saw", "pulse"]).some((e) => e[0] === f && e[1] === "in"); },
    why: ({ patch }) => {
      const gone = missing(patch, [["vco", "Q Saw"], ["vcf", "Q Filter"]]);
      if (gone) return gone;
      const [e] = outsOf(patch, mod(patch, "vco"), ["saw", "pulse"]);
      if (!e) return null;
      if (e[0] === mod(patch, "vcf")) return `That's ${at(patch, e)}: it moves the filter's cutoff, it doesn't carry the sound. The sound goes into its In`;
      if (e[0] === mod(patch, "vca")) return "Q Saw goes straight into Q Level, past the filter: a raw saw, all buzz and no shape. Put Q Filter between to round it off";
      if (e[0] === mod(patch, "out")) return "Q Saw goes straight to Q Out: no filter to shape it and no level to start and stop it. Saw to Filter, Filter to Level, Level to Out";
      return `Q Saw goes to ${at(patch, e)}. Into Q Filter's In`;
    },
  },
  {
    job: "Patch Q Filter's LP into Q Level's In",
    done: ({ patch }) => { const v = mod(patch, "vca"); return outsOf(patch, mod(patch, "vcf"), ["lp", "bp", "hp"]).some((e) => e[0] === v && e[1] === "in"); },
    why: ({ patch }) => {
      const gone = missing(patch, [["vcf", "Q Filter"], ["vca", "Q Level"]]);
      if (gone) return gone;
      const [e] = outsOf(patch, mod(patch, "vcf"), ["lp", "bp", "hp"]);
      if (!e) return null;
      if (e[0] === mod(patch, "vca")) return `That's ${at(patch, e)}: it opens and shuts Q Level, it doesn't carry the sound. The sound goes into its In`;
      if (e[0] === mod(patch, "out")) return "Q Filter goes straight to Q Out, past Q Level: nothing sets how loud it is or lets a note start and stop. Filter to Level, Level to Out";
      return `Q Filter goes to ${at(patch, e)}. Into Q Level's In`;
    },
  },
  {
    job: "Patch Q Level's Out into Q Out's In L",
    done: ({ patch }) => {
      const [e] = outsOf(patch, mod(patch, "vca"), ["out"]);
      return !!e && ((e[0] === mod(patch, "out") && e[1].startsWith("in")) || (e[0] === mod(patch, "mix") && listen(patch, 2).wall.playing));
    },
    why: ({ patch }) => missing(patch, [["vca", "Q Level"], ["out", "Q Out"]]),
  },
  {
    job: "Open Q Level: turn its Level knob up, or patch Q Swell's Out into its CV",
    done: ({ patch }) => {
      const v = mod(patch, "vca"), k = v && defOf(patch, v)?.knobs.find((x) => x.name === "level");
      return !!v && ((!!k && knobValue(patch, v, k) >= 0.1) || !!other(patch, [v, "cv"]));
    },
    why: ({ patch }) => (mod(patch, "vca") ? "Q Level is shut: its Level is at 0 and nothing is in its CV, so no sound gets through. Turn Level up for a drone, or patch an envelope into CV so each note opens it" : null),
  },
];

// ---- 3. a PA for a small room ----

const MIC = "pa-mic", MIXER = "pa-mixer", TOPS = ["pa-top-1", "pa-top-2"] as const;
const WHICH = ["first", "second"];
export const PA_KIT = [{ id: MIC, gear: "pa-mic" }, { id: MIXER, gear: "pa-mixer" }, ...TOPS.map((id) => ({ id, gear: "pa-top" }))];
/** How far apart the two speakers stand, at least, metres; and the most a speaker may lose at the floor's middle, dB. */
export const SPREAD_M = 2, AIM_DB = 3;
const powerOf = (p: Patch, id: string) => (p.knobs[id]?.power ?? 0) >= 0.5;
const placedOf = (p: Patch, id: string) => p.placed.find((x) => x.id === id);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** How far off the middle of the room each speaker points (degrees) and what that costs its highs there (dB). */
function aims({ patch, bounds }: At) {
  const spec = catalog("top-12-powered").speaker!, mid = { x: (bounds.x0 + bounds.x1) / 2, y: 1.2, z: (bounds.z0 + bounds.z1) / 2 };
  return TOPS.map((id) => {
    const t = placedOf(patch, id);
    if (!t) return null;
    const a = aimTo({ pos: { x: t.at[0], y: 1.2, z: t.at[2] }, yaw: t.turn, pitch: 0 }, mid);
    return { deg: Math.round((Math.abs(a.h) * 180) / Math.PI), loss: r1(offAxisLoss(spec, a.h, 0)) };
  });
}

/** The switch flicks since the speakers were last all off: an old thump is put right by starting again in order. */
function sinceAllOff(flicks: readonly Flick[]): Flick[] {
  const on = new Set<string>();
  let from = 0;
  flicks.forEach((f, i) => { if (f.on) on.add(f.id); else on.delete(f.id); if (TOPS.every((t) => !on.has(t))) from = i + 1; });
  return flicks.slice(from);
}
const paCables = (p: Patch) => p.cables.filter((c) => [c.from[0], c.to[0]].every((id) => defOf(p, id)?.kind === "pa")).map((c) => ({ kind: "xlr" as const, lengthM: 1, from: c.from, to: c.to }));
const paPlaced = (p: Patch) => p.placed.flatMap((x) => { const g = gearOf(x); return g?.pa ? [{ id: x.id, gear: g.pa }] : []; });

const PA: Step<At>[] = [
  {
    job: `Stand the two speakers ${SPREAD_M} m or more apart, one each side of the room: walk up to one, F picks it up, F sets it down`,
    done: ({ patch, held }) => {
      const [a, b] = TOPS.map((id) => placedOf(patch, id));
      return !!a && !!b && !TOPS.some((id) => id === held) && Math.hypot(a.at[0] - b.at[0], a.at[2] - b.at[2]) >= SPREAD_M;
    },
    why: ({ patch, held }) => {
      if (TOPS.some((id) => id === held)) return null;
      const [a, b] = TOPS.map((id) => placedOf(patch, id));
      if (!a || !b) return "The PA's speakers aren't in the room: start the lesson again to bring them";
      const d = r1(Math.hypot(a.at[0] - b.at[0], a.at[2] - b.at[2]));
      return `The speakers stand ${d} m apart: the room hears one box off to one side, and the far side goes quiet. Spread them ${SPREAD_M} m or more apart`;
    },
  },
  {
    job: "Aim each speaker at the middle of the room: pick it up, Q and E turn it, F sets it down",
    done: (s) => aims(s).every((a) => !!a && a.loss <= AIM_DB) && !TOPS.some((id) => id === s.held),
    why: (s) => {
      if (TOPS.some((id) => id === s.held)) return null;
      const all = aims(s), worst = all.reduce<number>((w, a, i) => ((a?.loss ?? 0) > (all[w]?.loss ?? 0) ? i : w), 0), a = all[worst];
      if (!a || a.loss <= AIM_DB) return null;
      if (a.deg > 100) return `The ${WHICH[worst]} speaker faces the wall: its horn throws at the wall, and the room hears the bounce, late and dull. Turn it round to face the middle of the room`;
      return `The ${WHICH[worst]} speaker points ${a.deg}° off the middle of the room: a horn's highs fall away off its axis, so the middle hears it ${a.loss} dB duller. Turn it in`;
    },
  },
  {
    job: "Cable the mic into the mixer's input 1, on its back",
    done: ({ patch }) => { const e = other(patch, [MIC, "xlr-out"]); return e?.[0] === MIXER && e[1] === "xlr-in-1"; },
    why: ({ patch }) => {
      const e = other(patch, [MIC, "xlr-out"]);
      if (e && TOPS.some((t) => t === e[0])) return "The mic goes straight into a speaker: no mixer to set its level, and the other speaker gets nothing. The mic goes into the mixer first";
      return null;
    },
  },
  {
    job: "Cable the mixer's outs 1 and 2 into the two speakers' inputs",
    done: ({ patch }) => TOPS.every((t) => other(patch, [t, "xlr-in"])?.[0] === MIXER),
    why: ({ patch }) => {
      const t = TOPS.findIndex((id) => { const e = other(patch, [id, "xlr-in"]); return !!e && e[0] !== MIXER; });
      return t >= 0 ? `The ${WHICH[t]} speaker is fed by ${at(patch, other(patch, [TOPS[t], "xlr-in"])!)}: the mixer feeds both, so one fader sets the room` : null;
    },
  },
  {
    job: "Power on in order: turn the mixer's Power knob up first, then each speaker's",
    done: ({ patch, flicks }) => [MIXER, ...TOPS].every((id) => powerOf(patch, id)) && !thumps(paPlaced(patch), paCables(patch), sinceAllOff(flicks)).length,
    why: ({ patch, flicks }) => {
      if (thumps(paPlaced(patch), paCables(patch), sinceAllOff(flicks)).length) return "A speaker was on when the mixer switched: the switch's pop went through it as a loud thump, hard on its drivers and on ears. Speakers off, then the mixer on, then the speakers: amps on last and off first";
      if (TOPS.some((t) => powerOf(patch, t)) && !powerOf(patch, MIXER)) return "A speaker is on before the mixer: when the mixer goes on, it will thump through it. Turn the speakers off, the mixer on, then the speakers";
      return null;
    },
  },
];

// ---- 4. know your plugs: the PA's XLRs ----

const XLR = CONNECTORS.xlr3, COMBO = CONNECTORS.combo;
/** "pin 1 ground, pin 2 hot, pin 3 cold": the XLR's pins as the connector list has them. */
const XLR_PINS = XLR.pins.map((p) => `pin ${p.name} ${p.what.split(":")[0]}`).join(", ");
const PLUGS: Step<At>[] = [
  {
    job: `Cable the mic into the mixer's input 1. ${XLR.what} Its pins: ${XLR_PINS}`,
    done: ({ patch }) => { const e = other(patch, [MIC, "xlr-out"]); return e?.[0] === MIXER && e[1] === "xlr-in-1"; },
    why: ({ patch }) => {
      const e = other(patch, [MIC, "xlr-out"]);
      return e && e[0] !== MIXER ? `The mic goes into ${at(patch, e)}: its signal is a few thousandths of a volt and wants the mixer's mic input to bring it up. The mic goes into the mixer's input 1` : null;
    },
  },
  {
    job: `Cable the mixer's out 1 into the first speaker's input A, its ${COMBO.name} socket. ${COMBO.what}`,
    done: ({ patch }) => other(patch, [TOPS[0], "xlr-in"])?.[0] === MIXER,
    why: ({ patch }) => {
      if (other(patch, [MIXER, "xlr-out-1"])?.[0] === TOPS[1]) return "The mixer's out 1 is in the second speaker: this step feeds the first one, and the second gets its signal from the first's thru next";
      const e = other(patch, [TOPS[0], "xlr-in"]);
      return e && e[0] !== MIXER ? `The first speaker's input A is fed by ${at(patch, e)}: the mixer feeds it, so its fader sets the level` : null;
    },
  },
  {
    job: "Cable the first speaker's thru (the male XLR under its input) into the second speaker's input A: the thru passes the signal on, so one mixer out feeds a line of boxes",
    done: ({ patch }) => { const e = other(patch, [TOPS[0], "xlr-out"]); return e?.[0] === TOPS[1] && e[1] === "xlr-in"; },
    why: ({ patch }) => (other(patch, [TOPS[1], "xlr-in"])?.[0] === MIXER ? "The second speaker is fed straight from the mixer. That works, but this step chains it off the first speaker's thru, as a crew does down a row of powered boxes" : null),
  },
];

const STEPS: Record<LessonId, Step<At>[]> = { guitar: GUITAR, voice: VOICE, pa: PA, plugs: PLUGS };

/** Every step of a lesson checked against what is in the room now. */
export const checkLesson = (id: LessonId, s: At): Checked[] => checkSteps(STEPS[id], s);

/** The lesson you are in at the gear wall: which, its steps as they stand, and the PA's switch flicks while you're in it. */
export class Lessons {
  on: LessonId | null = null;
  /** The lessons finished in this room: what you built stays as the room's rig. */
  readonly finished = new Set<LessonId>();
  private flicks: Flick[] = [];
  private seen = new Set<string>();

  constructor(private hands: GearHands) {}

  /** Start a lesson (the PA one brings its kit to the floor in front of you); a lesson already on is left for it. */
  start(id: string, j: Jam): Answer {
    if (!isLesson(id)) return { ok: false, why: `no lesson ${id}` };
    if (id === "pa" || id === "plugs") {
      if (!this.hands.joined) return { ok: false, why: "The sesh's gear is on its way" };
      if (j.me.seat) return { ok: false, why: "Stand up first: the PA goes on the floor in front of you" };
      if (!bringKit(this.hands.reach(j), PA_KIT)) return { ok: false, why: "Your hands are full: set it down first" };
    }
    this.on = id;
    this.flicks = [];
    this.seen = this.powered();
    return { ok: true };
  }
  /** Leave the lesson: nothing is undone. */
  leave() { this.on = null; }

  private powered(): Set<string> { const p = this.hands.room.studio.patch; return new Set(paPlaced(p).filter((x) => powerOf(p, x.id)).map((x) => x.id)); }
  /** Note each power switch thrown since the last look, in order (as Sound Guy Simulator's first gig does). */
  private sync() {
    const now = this.powered();
    for (const k of this.seen) if (!now.has(k)) this.flicks.push({ id: k, on: false });
    for (const k of now) if (!this.seen.has(k)) this.flicks.push({ id: k, on: true });
    this.seen = now;
  }

  /** The lesson as it stands now (null: none on): its steps, the next one to do, and whether it's all done. */
  state(): { id: LessonId; title: string; steps: Checked[]; next: number; done: boolean } | null {
    if (!this.on) return null;
    this.sync();
    const r: Room = this.hands.room, held = heldId(r) ?? null;
    const steps = checkLesson(this.on, { patch: r.studio.patch, held, bounds: r.bounds ?? GEAR_ROOM, flicks: this.flicks });
    const next = steps.findIndex((s) => !s.done), done = next < 0;
    if (done) this.finished.add(this.on);
    return { id: this.on, title: LESSONS.find((l) => l.id === this.on)!.title, steps, next, done };
  }
}
