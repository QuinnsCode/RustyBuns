// The dub arrangement, with no sound in it: a setup names a track's character (tempo, backbeat, hat groove, how
// long its growls stretch, where its delay lives) and a form lays 64 or 128 bars out in sections. `arrange` turns a
// bar number into everything that happens in that bar, in beats from the bar's one, so the music only has to place
// voices and a test can count what a track does without ears. Pure: audio.ts plays it, scripts/render.ts checks it.
//
// The feel, from the owner's listen (2026-11-01): 86 bpm and very half-time (kick on the one, a snap clap on the
// three), or the same at 1.3x. Everything spread and empty. Drums, bass and most stabs hit mono; a few stabs open
// out wide with reverb. The growls stretch over 8 or 16 bars; a quick rise over a triplet, then a cut, before a drop.
// Hats are grooved eighths, eighth-note effects tick into the delay, an LFO moves on nearly everything, and the dub
// delays are the delayed reactions: on the instrument, on the bus, or both.

export const TEMPO = 86;
/** 86 bpm, or 86 sped up 1.3x. */
export const TEMPOS = [TEMPO, Math.round(TEMPO * 1.3)] as const;
export const FORMS = [64, 128] as const;
export type Form = (typeof FORMS)[number];

export type Section = "intro" | "build" | "drop" | "break" | "rise" | "outro";

/** How a form's bars split into sections: intro, build, drop, break, rise, second drop, outro. */
const PLAN: Record<Form, [Section, number][]> = {
  64: [["intro", 8], ["build", 8], ["drop", 16], ["break", 8], ["rise", 8], ["drop", 12], ["outro", 4]],
  128: [["intro", 16], ["build", 16], ["drop", 32], ["break", 16], ["rise", 8], ["drop", 24], ["outro", 16]],
};

export type Setup = {
  name: string;
  bpm: (typeof TEMPOS)[number];
  bars: Form;
  delay: number;                          // beats between a call and its wall, and the bus delay's time
  root: number;                           // the bass note, Hz
  back: "clap" | "snare" | "rim";         // the backbeat voice on the three
  hats: "eighths" | "offbeat" | "sparse"; // the hat groove
  fx: boolean;                            // eighth-note effects ticking into the dub
  growl: 8 | 16;                          // bars one dub growl stretches over
  rise: boolean;                          // a quick triplet rise and cut before each drop
  stab: "mono" | "wide";                  // wide: panned out with reverb
  echo: "instrument" | "bus" | "both";    // where the dub delay lives
  lfo: number;                            // bars one sweep of the master filter takes
  space: 1 | 2 | 4;                       // bars between stabs in a drop: how empty it is
  tribal: boolean;                        // stompy toms under the drop
};

/** Twelve setups to try: every voice and routing choice appears at least twice, across both tempos and both forms. */
export const SETUPS: readonly Setup[] = [
  { name: "snap", bpm: 86, bars: 64, delay: 4, root: 36.71, back: "clap", hats: "eighths", fx: true, growl: 8, rise: true, stab: "mono", echo: "bus", lfo: 16, space: 2, tribal: false },
  { name: "warren", bpm: 86, bars: 128, delay: 8, root: 32.7, back: "clap", hats: "offbeat", fx: false, growl: 16, rise: true, stab: "wide", echo: "both", lfo: 32, space: 4, tribal: true },
  { name: "lowtide", bpm: 86, bars: 64, delay: 8, root: 55, back: "snare", hats: "sparse", fx: true, growl: 16, rise: false, stab: "mono", echo: "instrument", lfo: 8, space: 4, tribal: false },
  { name: "stomp", bpm: 86, bars: 64, delay: 4, root: 36.71, back: "clap", hats: "eighths", fx: false, growl: 8, rise: true, stab: "mono", echo: "bus", lfo: 16, space: 1, tribal: true },
  { name: "fog", bpm: 86, bars: 128, delay: 6, root: 43.65, back: "rim", hats: "sparse", fx: true, growl: 16, rise: false, stab: "wide", echo: "both", lfo: 64, space: 4, tribal: false },
  { name: "ember", bpm: 86, bars: 128, delay: 8, root: 49, back: "clap", hats: "offbeat", fx: true, growl: 8, rise: true, stab: "wide", echo: "instrument", lfo: 16, space: 2, tribal: true },
  { name: "rush", bpm: 112, bars: 64, delay: 4, root: 36.71, back: "clap", hats: "eighths", fx: true, growl: 8, rise: true, stab: "mono", echo: "bus", lfo: 8, space: 1, tribal: false },
  { name: "chase", bpm: 112, bars: 128, delay: 8, root: 55, back: "snare", hats: "eighths", fx: true, growl: 16, rise: true, stab: "wide", echo: "both", lfo: 16, space: 2, tribal: true },
  { name: "drift", bpm: 112, bars: 64, delay: 6, root: 32.7, back: "rim", hats: "offbeat", fx: false, growl: 16, rise: false, stab: "mono", echo: "instrument", lfo: 32, space: 4, tribal: false },
  { name: "tribe", bpm: 112, bars: 128, delay: 4, root: 43.65, back: "clap", hats: "sparse", fx: false, growl: 8, rise: true, stab: "mono", echo: "bus", lfo: 16, space: 2, tribal: true },
  { name: "hollow", bpm: 86, bars: 64, delay: 8, root: 49, back: "rim", hats: "offbeat", fx: true, growl: 8, rise: false, stab: "wide", echo: "instrument", lfo: 8, space: 2, tribal: false },
  { name: "longtail", bpm: 112, bars: 128, delay: 8, root: 36.71, back: "snare", hats: "sparse", fx: false, growl: 16, rise: true, stab: "mono", echo: "both", lfo: 64, space: 4, tribal: false },
];
export const SETUP_NAMES = SETUPS.map((s) => s.name) as [string, ...string[]];

/** The setup called `name`, or null. */
export const setupNamed = (name: string | undefined | null): Setup | null => SETUPS.find((s) => s.name === name) ?? null;

export type Place = { section: Section; at: number; len: number };

/** Which section bar `bar` of a form is in, how far into it and how long it is. Past the end: the outro's last bar. */
export function sectionAt(bar: number, bars: Form): Place {
  let start = 0;
  for (const [section, len] of PLAN[bars]) {
    if (bar < start + len) return { section, at: bar - start, len };
    start += len;
  }
  const [section, len] = PLAN[bars].at(-1)!;
  return { section, at: len - 1, len };
}

/** Where the offbeat sits inside the beat: behind straight (0.5), which is the swing. */
export const SWING = 0.56;

export type Hat = { at: number; vol: number };

/** One bar of a track, in beats from its one. */
export type Bar = Place & {
  kicks: number[];
  backs: number[];                   // the backbeat (clap, snare or rim)
  toms: number[];                    // the tribal stomp, when the setup has it
  hats: Hat[];
  fx: number[];                      // eighth-note effects into the dub
  bass: "sub" | "wobble" | null;     // the sub alone (a build), the whole wobble (a drop), or nothing
  growl: number;                     // bars a dub growl starting on this bar stretches over; 0 for none
  rise: boolean;                     // the triplet rise and cut in this bar's second half
  stabs: number[];
  note: boolean;                     // the one-note synth says its note on the one
  pad: boolean;
  root: number;                      // the bass note this bar, Hz
};

const HAT_GROOVE: Record<Setup["hats"], Hat[]> = {
  // Grooved eighths: loud on the beats, the offbeats swung and ghosted, the last one pushing into the next bar.
  eighths: [0, 1, 2, 3].flatMap((b) => [{ at: b, vol: b % 2 ? 0.22 : 0.3 }, { at: b + SWING, vol: b === 3 ? 0.18 : 0.11 }]),
  offbeat: [0, 1, 2, 3].map((b) => ({ at: b + SWING, vol: b % 2 ? 0.2 : 0.14 })),
  sparse: [{ at: 1 + SWING, vol: 0.16 }, { at: 3 + SWING, vol: 0.2 }],
};

/** The bass note this bar: the root, lifted a tone for the last eight bars of every 64. */
export const rootAt = (setup: Setup, bar: number) => (bar % 64 < 56 ? setup.root : setup.root * 9 / 8);

/** Everything that happens in bar `bar` of a setup's track. */
export function arrange(setup: Setup, bar: number): Bar {
  const place = sectionAt(bar, setup.bars), { section, at, len } = place;
  const last = at === len - 1, drums = section === "drop" || section === "build" || section === "rise";
  const out: Bar = { ...place, kicks: [], backs: [], toms: [], hats: [], fx: [], bass: null, growl: 0, rise: false, stabs: [], note: false, pad: false, root: rootAt(setup, bar) };
  // Half-time: the kick on the one and the backbeat on the three, with a pickup kick on the four every fourth bar in a drop.
  if (drums) {
    out.kicks.push(0);
    if (section === "drop" && at % 4 === 3) out.kicks.push(3.5);
    if (section !== "rise" || at % 2 === 0) out.backs.push(2);
  }
  if (section === "outro" && at % 2 === 0) out.kicks.push(0);
  if (setup.tribal && section === "drop") out.toms.push(1.5, 2.75, at % 2 ? 3.25 : 1.75);
  // Hats everywhere but the break (the tail has that to itself), fading through the outro.
  if (section !== "break") {
    const fade = section === "outro" ? 1 - at / len : section === "intro" ? 0.6 : 1;
    out.hats = HAT_GROOVE[setup.hats].map((h) => ({ at: h.at, vol: h.vol * fade }));
  }
  // Eighth-note effects: a tick on the offbeat of the one and three, on the four as well every other bar.
  if (setup.fx && (section === "intro" || section === "drop" || section === "outro")) out.fx.push(0.5, 2.5, ...(at % 2 ? [3.5] : []));
  if (section === "build" || section === "rise") out.bass = "sub";
  if (section === "drop" || section === "break") out.bass = section === "drop" ? "wobble" : "sub";
  // A growl starts a build and a rise, and comes round every `growl` bars of a drop; it is cut at the section's end.
  const growlStart = (section === "build" || section === "rise") ? at === 0 : section === "drop" && at % setup.growl === 0;
  if (growlStart) out.growl = Math.min(setup.growl, len - at);
  out.rise = setup.rise && last && (section === "build" || section === "rise");
  // Stabs: every `space` bars in a drop on the offbeats, once in four elsewhere on the last offbeat.
  if (section === "drop" && at % setup.space === 0) out.stabs.push(1 + SWING, 3 + SWING);
  else if (section !== "drop" && at % 4 === 2) out.stabs.push(3 + SWING);
  out.note = (section === "drop" && at % 2 === 1) || (section === "break" && at % 4 === 1);
  out.pad = (section === "intro" || section === "break") ? at % 8 === 0 : at === 0 && section !== "outro";
  return out;
}

/** How many kicks a whole track has: what a render should find on the grid. */
export const kickCount = (setup: Setup) => { let n = 0; for (let b = 0; b < setup.bars; b++) n += arrange(setup, b).kicks.length; return n; };
