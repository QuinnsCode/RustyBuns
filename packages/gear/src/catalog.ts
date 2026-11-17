// The gear Load In carries: our own generic boxes with plausible numbers. Ids, sizes and weights
// match the shared table in #4849 so the models (packages/models) and this math join on `id`.

/** Where a cable plugs in. `power-out` and the input/output kinds can come several to a box. */
export type JackKind =
  | "power-in"
  | "power-out"
  | "speaker-in"
  | "speaker-out"
  | "line-in"
  | "line-out"
  | "inst-in"
  | "xlr-in"
  | "xlr-out";

/** How a speaker sounds: the numbers on its spec sheet. */
export type SpeakerSpec = {
  /** dB SPL at 1 W, 1 m on axis. */
  sensitivity: number;
  /** The loudest it goes at 1 m, dB SPL. */
  maxSpl: number;
  /** Watts it takes (for a powered box, its own amp's output). */
  ratedWatts: number;
  /** Nominal ohms, or null for a powered box (its amp is inside). */
  ohms: number | null;
  /** Coverage angles in degrees, horizontal x vertical: the full width where it is 6 dB down. */
  coverage: { h: number; v: number };
  /** -10 dB point at the bottom, Hz. */
  lowCut: number;
  /** Top of its band, Hz: a sub stops around 120. */
  highCut: number;
  /** The most it falls off behind, dB: tops are quiet behind, subs barely. */
  rearLoss: number;
};

/** A power amp: watts per channel into each load it is rated for. */
export type AmpSpec = {
  channels: number;
  /** Watts per channel at 8, 4 and (if it can) 2 ohms. */
  watts: { 8: number; 4: number; 2?: number };
};

export type Gear = {
  id: string;
  what: string;
  /** Width x height x depth, metres. */
  size: { w: number; h: number; d: number };
  kg: number;
  jacks: Partial<Record<JackKind, number>>;
  speaker?: SpeakerSpec;
  amp?: AmpSpec;
  /** Mains draw in watts, idle and at show level. */
  draw?: { idle: number; loud: number };
  /** A generator's rating, and its fuel: the tank, what it burns ticking over, and litres more per kWh it makes. */
  generator?: { kva: number; powerFactor: number; tankL: number; idleLph: number; perKwh: number };
  /** A fuel can: the litres it holds full. */
  can?: { litres: number };
};

const box = (w: number, h: number, d: number) => ({ w, h, d });

const list: Gear[] = [
  {
    id: "top-12-powered",
    what: '12" two-way powered speaker',
    size: box(0.37, 0.6, 0.36),
    kg: 18,
    jacks: { "power-in": 1, "xlr-in": 1, "xlr-out": 1 },
    speaker: { sensitivity: 98, maxSpl: 128, ratedWatts: 500, ohms: null, coverage: { h: 90, v: 60 }, lowCut: 55, highCut: 20000, rearLoss: 20 },
    draw: { idle: 25, loud: 160 },
  },
  {
    id: "top-15-passive",
    what: '15" two-way passive speaker',
    size: box(0.45, 0.72, 0.42),
    kg: 27,
    jacks: { "speaker-in": 1, "speaker-out": 1 },
    speaker: { sensitivity: 99, maxSpl: 130, ratedWatts: 500, ohms: 8, coverage: { h: 90, v: 50 }, lowCut: 45, highCut: 20000, rearLoss: 18 },
  },
  {
    id: "sub-18",
    what: '18" subwoofer',
    size: box(0.55, 0.7, 0.75),
    kg: 45,
    jacks: { "speaker-in": 1, "speaker-out": 1 },
    speaker: { sensitivity: 99, maxSpl: 133, ratedWatts: 800, ohms: 8, coverage: { h: 360, v: 360 }, lowCut: 35, highCut: 120, rearLoss: 6 },
  },
  {
    id: "wedge-12",
    what: '12" floor monitor',
    size: box(0.6, 0.35, 0.42),
    kg: 16,
    jacks: { "power-in": 1, "xlr-in": 1, "xlr-out": 1 },
    speaker: { sensitivity: 96, maxSpl: 125, ratedWatts: 300, ohms: null, coverage: { h: 60, v: 40 }, lowCut: 65, highCut: 20000, rearLoss: 20 },
    draw: { idle: 20, loud: 110 },
  },
  {
    id: "amp-head",
    what: "guitar amp head",
    size: box(0.7, 0.27, 0.25),
    kg: 18,
    jacks: { "power-in": 1, "inst-in": 1, "speaker-out": 2 },
    amp: { channels: 1, watts: { 8: 100, 4: 100 } },
    draw: { idle: 60, loud: 250 },
  },
  {
    id: "cab-4x12",
    what: "guitar speaker cabinet",
    size: box(0.76, 0.76, 0.36),
    kg: 40,
    jacks: { "speaker-in": 1 },
    speaker: { sensitivity: 100, maxSpl: 124, ratedWatts: 240, ohms: 8, coverage: { h: 60, v: 40 }, lowCut: 80, highCut: 5000, rearLoss: 12 },
  },
  {
    id: "amp-rack-4u",
    what: "rolling rack, two power amps",
    size: box(0.6, 0.4, 0.65),
    kg: 35,
    jacks: { "power-in": 1, "xlr-in": 4, "speaker-out": 4 },
    amp: { channels: 4, watts: { 8: 650, 4: 1000, 2: 1400 } },
    draw: { idle: 120, loud: 1500 },
  },
  {
    id: "mixer-small",
    what: "12-channel mixer",
    size: box(0.4, 0.1, 0.35),
    kg: 4,
    jacks: { "power-in": 1, "xlr-in": 8, "line-in": 4, "xlr-out": 4, "line-out": 2 },
    draw: { idle: 30, loud: 30 },
  },
  {
    id: "generator-7kva",
    what: "wheeled generator",
    size: box(0.7, 0.6, 0.55),
    kg: 90,
    jacks: { "power-out": 4 },
    generator: { kva: 7, powerFactor: 0.9, tankL: 25, idleLph: 0.6, perKwh: 0.35 },
  },
  {
    id: "distro-box",
    what: "power distro",
    size: box(0.4, 0.3, 0.25),
    kg: 10,
    jacks: { "power-in": 1, "power-out": 6 },
  },
  { id: "cable-ramp-2ch", what: "two-channel cable ramp, links end to end", size: box(0.9, 0.08, 0.5), kg: 13, jacks: {} },
  { id: "road-case-m", what: "road case on wheels", size: box(0.6, 0.5, 0.5), kg: 14, jacks: {} },
  { id: "stand-tripod", what: "speaker stand, 1.2 to 2.0 m", size: box(0.9, 1.2, 0.9), kg: 4, jacks: {} },
  { id: "mic-stand", what: "boom mic stand", size: box(0.6, 1.6, 0.6), kg: 3, jacks: {} },
  // A DI box: an instrument in, a thru to the amp, a balanced XLR to the desk. Phantom-powered, so no mains.
  // Its ground lift (`lift` on the placed box) breaks pin 1 when the amp and the desk make a ground loop.
  { id: "di-box", what: "active DI box with a ground lift", size: box(0.1, 0.05, 0.13), kg: 0.6, jacks: { "inst-in": 1, "line-out": 1, "xlr-out": 1 } },
  {
    // Hung, not stood: one element of a flown line array, too heavy for one person (two carry it, or a crew).
    id: "line-array-box",
    what: "line array element, powered",
    size: box(1.0, 0.32, 0.55),
    kg: 75,
    jacks: { "power-in": 1, "xlr-in": 1, "xlr-out": 1 },
    speaker: { sensitivity: 100, maxSpl: 138, ratedWatts: 1000, ohms: null, coverage: { h: 100, v: 12 }, lowCut: 60, highCut: 18000, rearLoss: 25 },
    draw: { idle: 40, loud: 500 },
  },
  { id: "guitar", what: "electric guitar", size: box(0.33, 1.0, 0.05), kg: 3.5, jacks: { "line-out": 1 } },
  // Speakers that hang: a line array box (flown in a column from a rigging point, its splay to the next box set at the
  // rear pins), and a small box for the front rows the arrays shoot over.
  {
    id: "line-array-10",
    what: "line array box, two 10\" and a horn",
    size: box(0.74, 0.3, 0.5),
    kg: 36,
    jacks: { "power-in": 1, "xlr-in": 1, "xlr-out": 1 },
    speaker: { sensitivity: 101, maxSpl: 138, ratedWatts: 1200, ohms: null, coverage: { h: 110, v: 10 }, lowCut: 55, highCut: 20000, rearLoss: 22 },
    draw: { idle: 40, loud: 400 },
  },
  {
    id: "fill-8-powered",
    what: "8\" powered front fill",
    size: box(0.28, 0.42, 0.25),
    kg: 9,
    jacks: { "power-in": 1, "xlr-in": 1, "xlr-out": 1 },
    speaker: { sensitivity: 95, maxSpl: 122, ratedWatts: 300, ohms: null, coverage: { h: 100, v: 70 }, lowCut: 70, highCut: 20000, rearLoss: 18 },
    draw: { idle: 15, loud: 90 },
  },
  { id: "jerry-can-20l", what: "jerry can of fuel", size: box(0.35, 0.47, 0.17), kg: 18, jacks: {}, can: { litres: 20 } },
  // Not road gear: the venue's own back-bar cooler, a load on a wall circuit that is always on.
  { id: "bar-cooler", what: "back-bar drinks cooler", size: box(0.9, 0.9, 0.6), kg: 70, jacks: { "power-in": 1 }, draw: { idle: 450, loud: 450 } },
];

/** Every piece of gear by id. */
export const GEAR: Readonly<Record<string, Gear>> = Object.fromEntries(list.map((g) => [g.id, g]));

/** The ids in table order. */
export const GEAR_IDS: readonly string[] = list.map((g) => g.id);

/** One piece of gear by id; an unknown id throws, naming it. */
export function gear(id: string): Gear {
  const g = GEAR[id];
  if (!g) throw new Error(`no gear ${id}`);
  return g;
}

/** A box's jacks as names: one `power-out` becomes `power-out`, four become `power-out-1..4`. */
export function jackNames(g: Gear): string[] {
  const names: string[] = [];
  for (const [kind, n = 0] of Object.entries(g.jacks)) {
    if (n === 1) names.push(kind);
    else for (let i = 1; i <= n; i++) names.push(`${kind}-${i}`);
  }
  return names;
}
