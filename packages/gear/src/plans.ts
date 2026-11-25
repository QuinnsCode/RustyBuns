// Three speaker build plans as data: a small vented two-way, a sealed 12" sub and a folded quarter-wave pipe for an
// 8" full-range. Drivers are named by what they are; their numbers and the box sizes are from the published sheets
// and plans in the README's "Where the speaker plans come from". `enclosure.ts` turns each into a response and a
// filter, and `cabinet` in @rustybuns/models/speaker into a model.
import type { Driver, Plan } from "./enclosure.ts";

const IN = 0.0254;

export const DRIVERS: readonly Driver[] = [
  {
    id: "alu-midbass-4", name: '4" aluminium-cone midbass', fs: 56, qts: 0.52, vas: 4.53e-3, sd: 53e-4, xmax: 0.003, re: 6.5, sens: 85,
    dia: 0.116, cutout: 0.094, from: "the maker's sheet as a driver database lists it (Fs 56, Qts 0.52, Vas 4.53 L, Sd 53 cm2)",
  },
  {
    id: "silk-dome-075", name: '3/4" silk-dome tweeter', fs: 750, qts: 0.6, vas: 1e-5, sd: 2.8e-4, xmax: 0.0002, re: 5.4, sens: 88,
    dia: 0.06, cutout: 0.046, from: "a 3/4\" neodymium dome; the low-end math leaves it out (the crossover hands it the top)",
  },
  {
    id: "ref-sub-12", name: '12" reference subwoofer', fs: 24.2, qts: 0.39, vas: 84.1e-3, sd: 514.7e-4, xmax: 0.0143, re: 3.1, sens: 90.3,
    dia: 0.311, cutout: 0.281, from: "the maker's spec table (Fs 24.2, Qts 0.39, Vas 2.97 ft3, Sd 514.7 cm2, Xmax 14.3 mm)",
  },
  {
    id: "whizzer-full-8", name: '8" full-range with a whizzer cone', fs: 42, qts: 0.27, vas: 94.45e-3, sd: 220e-4, xmax: 0.003, re: 6.8, sens: 95,
    dia: 0.224, cutout: 0.186, from: "the maker's datasheet (Fs 42, Qts 0.27, Vas 94.45 L, Xmax 3 mm; Sd 220 cm2 as a driver database has it)",
  },
];

export function driver(id: string): Driver {
  const d = DRIVERS.find((x) => x.id === id);
  if (!d) throw new Error(`no driver ${id}`);
  return d;
}

export const PLANS: readonly Plan[] = [
  {
    id: "bookshelf-vented",
    name: "Two-way bookshelf, vented",
    what: "A 4\" midbass under a 3/4\" dome in a 4.5 litre box, a 1 3/8\" port on the front tuned near 58 Hz.",
    size: [6 * IN, 9 * IN, 8.375 * IN],
    wall: 0.5 * IN,
    material: "mdf",
    drivers: [
      { driver: driver("alu-midbass-4"), at: [3 * IN, 3.4 * IN] },
      { driver: driver("silk-dome-075"), at: [3 * IN, 7.1 * IN], top: true },
    ],
    alignment: { kind: "vented", ports: { dia: 1.375 * IN, length: 6 * IN, count: 1 } },
    braces: 0,
    opening: [3 * IN, 1.15 * IN],
    from: "a free two-way kit plan (2010s): 9 x 6 x 8 3/8 in outside, 1/2 in MDF, a 1 3/8 in port cut to 6 in; builders report 4.5 L at 58 Hz",
  },
  {
    id: "sub-sealed-12",
    name: "Sealed 12\" subwoofer",
    what: "A long-throw 12\" in about 35 litres of sealed MDF with one window brace: Qtc near 0.7, deep and tight.",
    size: [15 * IN, 15 * IN, 14 * IN],
    wall: 0.75 * IN,
    material: "mdf",
    drivers: [{ driver: driver("ref-sub-12"), at: [7.5 * IN, 7.5 * IN] }],
    alignment: { kind: "sealed" },
    braces: 1,
    from: "ours, sized to the maker's 1.25 ft3 sealed suggestion: 3/4 in MDF, outside 15 x 15 x 14 in, one brace side to side",
  },
  {
    id: "pipe-fullrange-8",
    name: "Folded quarter-wave pipe, 8\" full-range",
    what: "One 8\" full-range high on a tall birch box. Its back wave runs down a folded pipe up the back and out a slot at its top, a quarter wave late.",
    size: [0.3, 1.22, 0.3],
    wall: 0.018,
    material: "birch-ply",
    drivers: [{ driver: driver("whizzer-full-8"), at: [0.15, 0.98] }],
    alignment: { kind: "pipe", length: 2.3, mouth: 0.264 * 0.06, lining: 0.35 },
    braces: 2,
    opening: [0.15, 1.1],
    from: "the big-pipe family of DIY plans: a quarter-wave pipe folded once, tuned a little under the driver's Fs; our sizes, 18 mm birch ply",
  },
];

export function plan(id: string): Plan {
  const p = PLANS.find((x) => x.id === id);
  if (!p) throw new Error(`no plan ${id}`);
  return p;
}

/** One piece to cut: its name, length and width (m), the sheet's thickness and how many. */
export interface Cut {
  part: string;
  l: number;
  w: number;
  t: number;
  n: number;
}

/**
 * The cut list, built the common way: sides full height and depth, top and bottom between the sides, front and back
 * between all four. Braces are strips 50 mm wide across the inside; a pipe adds its fold, a divider down the middle.
 */
export function cutList(p: Plan): Cut[] {
  const [w, h, d] = p.size, t = p.wall;
  const cuts: Cut[] = [
    { part: "side", l: h, w: d, t, n: 2 },
    { part: "top and bottom", l: w - 2 * t, w: d, t, n: 2 },
    { part: "front baffle", l: h - 2 * t, w: w - 2 * t, t, n: 1 },
    { part: "back", l: h - 2 * t, w: w - 2 * t, t, n: 1 },
  ];
  if (p.braces) cuts.push({ part: "brace", l: w - 2 * t, w: 0.05, t, n: p.braces });
  if (p.alignment.kind === "pipe") cuts.push({ part: "fold divider", l: h - 2 * t - 0.12, w: w - 2 * t, t, n: 1 });
  return cuts;
}
