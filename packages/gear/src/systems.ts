// The open-air rigs: four ways a sound system for a dance floor in the desert is built, each our own boxes in one
// well-known family (catalog.ts has each box's numbers and where they come from). A rig is what one stack is, bottom
// to top, and how it sounds: its pattern and its low end come from its boxes' sheets, and its voicing is that family's
// usual tilt, as a few gentle EQ bands, so the four don't just look different on the sand but sound it.
//
//   dance-stack  horn-loaded all the way down: folded 21" bins, a horn-loaded 15" mid-bass, a mid-high horn. Punchy
//                mid-bass, a forward midrange, a tight 50 x 25 pattern that throws a long way.
//   synergy      one box that sums all three ways in a single horn (a point source by construction) over tapped-horn
//                18s: flat and coherent, 50 x 50, very low, very little colour.
//   sculpted     moulded three-way shells on hybrid-horn triple 21s: deep, smooth sub, a sweet, open top, 60 x 50.
//   tri-amp      the old touring stack: high-Q horn tops (a 12" and a 6.5" on horns and a waveguide) over a horn-loaded 21":
//                mid-forward and narrow (25 x 25), the top end rolled off a little.
//   line-array   today's festival rig on the ground: three powered line array boxes stacked on two 18" subs: very wide
//                (110 degrees) and even across the floor, clean, a little lift up top.
import { gear, type SpeakerSpec } from "./catalog.ts";
import type { EqBand } from "./feedback.ts";

export const SYSTEM_IDS = ["dance-stack", "synergy", "sculpted", "tri-amp", "line-array"] as const;
export type SystemId = (typeof SYSTEM_IDS)[number];


export type System = {
  id: SystemId;
  /** What it's called on the sand: by what it is, never a maker's name. */
  name: string;
  about: string;
  /** How a crew stands it up in the field, from the family's own setup guides: where the boxes go, how they're aimed and fed. */
  setup: string;
  /** One stack, bottom to top (catalog ids; `sand-dolly` rolls it). */
  stack: readonly string[];
  /** The box that sets the pattern (the top) and the one that sets the low end (the sub). */
  top: string;
  sub: string;
  /** The family's usual tilt. */
  voicing: readonly EqBand[];
};

export const SYSTEMS: Record<SystemId, System> = {
  "dance-stack": {
    id: "dance-stack", name: "Horn stack",
    about: "Horn-loaded all the way down: folded 21-inch bins, a horn-loaded 15-inch mid-bass and a mid-high horn. Punchy, forward, and it throws.",
    setup: "A stack each side of the floor: bass bins on the ground, the mid-bass on them and the mid-high horn on top, each stack toed in so the horns cross in the middle. An active crossover splits four ways, an amp channel per band, the bands lined up in time.",
    stack: ["sand-dolly", "horn-sub-21", "stack-mid-bass", "stack-mid-high"], top: "stack-mid-high", sub: "horn-sub-21",
    voicing: [{ hz: 110, db: 2.5, q: 1 }, { hz: 2500, db: 1.5, q: 0.9 }],
  },
  synergy: {
    id: "synergy", name: "Synergy horns",
    about: "Three ways summed in one pyramid horn, so each box is a single point, over tapped-horn 18s. Flat, coherent and very low.",
    setup: "Each box is one point covering 60 degrees, so a side is one or two boxes splayed to just meet; they stand on the subs or hang over them. The tapped horns stand side by side on the ground, where each one doubled adds 3 dB. A processor per side, its presets from the sheet.",
    stack: ["sand-dolly", "tapped-horn-18", "synergy-horn"], top: "synergy-horn", sub: "tapped-horn-18",
    voicing: [{ hz: 45, db: 1, q: 0.8 }],
  },
  sculpted: {
    id: "sculpted", name: "Sculpted array",
    about: "Moulded three-way shells, round horns in one curved body, on hybrid-horn triple 21s. A deep, smooth floor and a sweet, open top.",
    setup: "Shells stacked two or three high with their own brackets, the lower ones angled down at the front of the floor; the triple 21s in a line on the sand in front of the booth. A system controller and matched amps for the whole rig: the family doesn't run on anything else.",
    stack: ["triple-21-sub", "sculpted-3way"], top: "sculpted-3way", sub: "triple-21-sub",
    voicing: [{ hz: 50, db: 2, q: 0.8 }, { hz: 400, db: -1, q: 1 }, { hz: 10000, db: 1.5, q: 0.7 }],
  },
  "tri-amp": {
    id: "tri-amp", name: "Tri-amp stack",
    about: "The old touring way: narrow horn tops, a horn-loaded 12 and 6.5 and a waveguide, over a horn-loaded 21 bass. Mid-forward and long-throwing.",
    setup: "Bass bins on the ground, tops on them, two or three stacks a side for a big floor, every box tri-amped: three amp channels a box from a crossover in the rack. Narrow tops, so the stacks are aimed box by box at their part of the floor.",
    stack: ["sand-dolly", "tri-amp-bass", "tri-amp-top"], top: "tri-amp-top", sub: "tri-amp-bass",
    voicing: [{ hz: 1600, db: 3, q: 1.2 }, { hz: 12000, db: -2, q: 0.8 }],
  },
  "line-array": {
    id: "line-array", name: "Line array",
    about: "Today's festival rig, ground-stacked: three powered line array boxes on two powered 18-inch subs. Very wide and even across the floor, clean, with a little lift up top.",
    setup: "Subs on the ground, the array stood on them on a stacking frame, the pins between boxes set so the top box aims at the back of the floor and the bottom one at the front. Every box is powered: a mains feed and a signal line to each, daisy-chained down the stack.",
    stack: ["sub-18", "sub-18", "line-array-10", "line-array-10", "line-array-10"], top: "line-array-10", sub: "sub-18",
    voicing: [{ hz: 70, db: 1.5, q: 0.9 }, { hz: 9000, db: 1, q: 0.7 }],
  },
};

/** A ready-made stack to drop in whole (the stack builder's and Qollab Studio's first pick): its boxes bottom to top,
 *  a row at a time, `across` of them side by side. `rig` is the open-air rig it is one stack of, where there is one
 *  (Qollab Studio stands that rig's own column; the bar pair has none there). Names say what it is, never a maker's. */
export type Premade = {
  id: string; name: string; about: string; rig: SystemId | null;
  rows: readonly { box: string; across: number }[];
};
const rows = (...r: [string, number][]) => r.map(([box, across]) => ({ box, across }));
export const PREMADES: readonly Premade[] = [
  { id: "horn-side", name: "Purple horn stack, a side", rig: "dance-stack",
    about: "The classic dance stack: two folded 21-inch bins side by side, the horn-loaded 15 mid-bass on them, the mid-high horn on top.",
    rows: rows(["horn-sub-21", 2], ["stack-mid-bass", 1], ["stack-mid-high", 1]) },
  { id: "horn-small", name: "Purple horn stack, small", rig: "dance-stack",
    about: "One bin, one mid-bass, one mid-high horn: the same sound for a smaller floor.",
    rows: rows(["horn-sub-21", 1], ["stack-mid-bass", 1], ["stack-mid-high", 1]) },
  { id: "horn-wall", name: "Purple horn wall", rig: "dance-stack",
    about: "Four bins in two rows of two, two mid-basses and two horns on top: a big floor, a side.",
    rows: rows(["horn-sub-21", 2], ["horn-sub-21", 2], ["stack-mid-bass", 2], ["stack-mid-high", 2]) },
  { id: "sculpted", name: "Sculpted array", rig: "sculpted",
    about: "A hybrid-horn triple 21 with two moulded three-way shells on it: deep, smooth sub and a sweet, open top.",
    rows: rows(["triple-21-sub", 1], ["sculpted-3way", 1], ["sculpted-3way", 1]) },
  { id: "synergy", name: "Synergy pair", rig: "synergy",
    about: "Two tapped-horn 18s side by side under one three-way synergy horn: flat, coherent and very low.",
    rows: rows(["tapped-horn-18", 2], ["synergy-horn", 1]) },
  { id: "line-array", name: "Line array on subs", rig: "line-array",
    about: "Three powered line array boxes stood on two 18-inch subs: very wide and even across the floor.",
    rows: rows(["sub-18", 2], ["line-array-10", 1], ["line-array-10", 1], ["line-array-10", 1]) },
  { id: "bar-pair", name: "Bar pair", rig: null,
    about: "A 15-inch two-way on an 18-inch sub: the bar, the party, the backyard.",
    rows: rows(["sub-18", 1], ["top-15-passive", 1]) },
];
/** A premade by id, or the purple horn stack for anything else. */
export const premade = (id: string): Premade => PREMADES.find((p) => p.id === id) ?? PREMADES[0]!;

/** How many amp channels a passive box takes: one a way, as each family's sheet wires it (the three-way tops tri-amped,
 *  the horn stack's mid-high horn two ways); one for a box left out, the synergy horn too (its crossover is inside:
 *  the SH50 sheet's "single channel amplified"). A powered box brings its own amps: none. */
const WAYS: Record<string, number> = { "stack-mid-high": 2, "sculpted-3way": 3, "sculpted-3way-lh": 3, "tri-amp-top": 3, "line-array-box": 4 };
/** The amp channels one box takes: one a way of a passive box, none for a powered box or a dolly. */
export const boxChannels = (id: string): number => (id === "sand-dolly" || !(gear(id).jacks["speaker-in"] ?? 0) ? 0 : WAYS[id] ?? 1);
/** The amp channels `stacks` stacks of rig `s` take, from its passive boxes. */
export function ampChannels(s: System, stacks: number): number {
  return s.stack.reduce((n, b) => n + boxChannels(b), 0) * stacks;
}

/** A rig whose boxes all take a speaker cable from an amp (none needs its own mains and signal line). */
export const passive = (s: System): boolean => s.stack.every((b) => b === "sand-dolly" || (gear(b).jacks["speaker-in"] ?? 0) > 0);

/** A rig by id, or the dance stack for anything else (a stale link, a typo). */
export function system(id: string | null | undefined): System {
  return SYSTEMS[(SYSTEM_IDS as readonly string[]).includes(id ?? "") ? (id as SystemId) : "dance-stack"];
}

/** How a rig sounds, from its boxes' sheets: the top's pattern, the sub's -10 dB point, the top's high end, the
 *  loudest the top goes at 1 m and the voicing. */
export function systemSound(s: System): { coverage: SpeakerSpec["coverage"]; lowCut: number; highCut: number; maxSpl: number; voicing: readonly EqBand[] } {
  const top = gear(s.top).speaker!, sub = gear(s.sub).speaker!;
  return { coverage: top.coverage, lowCut: Math.min(top.lowCut, sub.lowCut), highCut: top.highCut, maxSpl: top.maxSpl, voicing: s.voicing };
}

/** One stack's footprint, metres across: its widest box. */
export function stackWidth(s: Pick<System, "stack">): number {
  return Math.max(...s.stack.map((id) => gear(id).size.w));
}
