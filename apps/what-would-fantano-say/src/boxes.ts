// The boxes: what kind of record this is, and how the critic tends to take that kind
// of record. The archetype (name, tags, the numbers a typical track has, the one-line
// take) is written by hand for the parody. The real side, where his scores land, the
// artists he's reviewed most and a few actual reviews, is built offline from his
// published scores by scripts/build-boxes.ts into boxes.data.json. A song is matched to
// the nearest few by its numbers and the listener's "sounds like" hint, and the model
// judges it against them.

import type { Features } from "./analyze.ts";
import DATA from "./boxes.data.json";
import type { BoxData } from "../scripts/build-boxes.ts";

export interface Box {
  id: string;
  name: string;
  /** The artists he's reviewed most in this box. */
  soundsLike: string[];
  /** The critic's usual take on records like this, one line, written for the parody. */
  take: string;
  /** Where the middle half of his real scores for this box land. */
  scores: [number, number];
  /** How many of his reviews went into this box. */
  reviews: number;
  /** Real reviews across the range, one per score he's given here. */
  examples: BoxData["examples"];
  /** Words in a hint that point here. */
  tags: string[];
  /** The numbers a typical track in this box has; missing ones don't count. */
  profile: Partial<Pick<Features, "bpm" | "pulse" | "bass" | "brightness" | "loudnessDb" | "dynamicsDb">>;
}

type Archetype = Omit<Box, keyof BoxData>;

const ARCHETYPES: Archetype[] = [
  {
    id: "abrasive-rap", name: "Abrasive experimental rap",
    take: "His comfort zone. Noise, chaos and a rapper who sounds mildly dangerous earn a strong score fast.",
    tags: ["death grips", "jpegmafia", "peggy", "clipping", "noise rap", "industrial", "experimental hip hop"],
    profile: { bpm: 140, pulse: 0.5, bass: 0.45, brightness: 0.55, loudnessDb: -7, dynamicsDb: 5 },
  },
  {
    id: "conscious-rap", name: "Dense, conscious rap",
    take: "Lyrics get read closely. Concept and bars win him over; a weak hook or filler gets called out.",
    tags: ["kendrick", "billy woods", "danny brown", "boom bap", "conscious", "underground rap", "mf doom"],
    profile: { bpm: 90, pulse: 0.55, bass: 0.4, brightness: 0.35, loudnessDb: -9, dynamicsDb: 7 },
  },
  {
    id: "streaming-rap", name: "Streaming-farm trap",
    take: "Bloated tracklists, auto-pilot flows and an 808 doing all the work. Expect the word 'forgettable'.",
    tags: ["trap", "drill", "mumble", "rage", "plugg", "808"],
    profile: { bpm: 145, pulse: 0.6, bass: 0.6, brightness: 0.3, loudnessDb: -7, dynamicsDb: 4 },
  },
  {
    id: "art-pop", name: "Left-field art pop",
    take: "Pop with ideas gets a lot of love. Pop that only chases a trend gets a shrug.",
    tags: ["art pop", "hyperpop", "charli", "sophie", "bjork", "polachek", "pc music"],
    profile: { bpm: 125, pulse: 0.55, bass: 0.35, brightness: 0.5, loudnessDb: -8, dynamicsDb: 6 },
  },
  {
    id: "radio-pop", name: "Committee radio pop",
    take: "Polished, safe, and engineered for a commercial. He'll find the one good chorus and roast the rest.",
    tags: ["pop", "radio", "top 40", "mainstream", "dance pop"],
    profile: { bpm: 115, pulse: 0.65, bass: 0.4, brightness: 0.4, loudnessDb: -7, dynamicsDb: 4 },
  },
  {
    id: "indie-folk", name: "Sad indie and folk",
    take: "Songwriting and atmosphere carry it. Moving gets a strong score, merely pretty gets 'a little boring'.",
    tags: ["indie", "folk", "singer songwriter", "acoustic", "sad", "bedroom", "sufjan", "phoebe"],
    profile: { bpm: 95, pulse: 0.3, bass: 0.25, brightness: 0.25, loudnessDb: -14, dynamicsDb: 10 },
  },
  {
    id: "heavy", name: "Heavy and extreme",
    take: "Heaviness is welcome, but it needs riffs and real intensity. Generic metalcore breakdowns lose points.",
    tags: ["metal", "metalcore", "hardcore", "deathcore", "black metal", "doom", "sludge", "screamo"],
    profile: { bpm: 160, pulse: 0.4, bass: 0.35, brightness: 0.7, loudnessDb: -7, dynamicsDb: 4 },
  },
  {
    id: "noise-rock", name: "Post-punk and noise rock",
    take: "Wiry, angular and loud is a good start. Being shouty without the songs behind it isn't.",
    tags: ["post punk", "noise rock", "punk", "garage", "black midi", "swans", "shoegaze"],
    profile: { bpm: 135, pulse: 0.45, bass: 0.3, brightness: 0.6, loudnessDb: -8, dynamicsDb: 6 },
  },
  {
    id: "dad-rock", name: "Stadium-safe rock",
    take: "Competent and very, very familiar. He'll ask what it adds to a genre that's been doing this since 1994.",
    tags: ["rock", "alt rock", "pop punk", "arena", "post grunge", "radio rock"],
    profile: { bpm: 120, pulse: 0.55, bass: 0.3, brightness: 0.5, loudnessDb: -7, dynamicsDb: 5 },
  },
  {
    id: "electronic", name: "Club and electronic",
    take: "Texture and sound design matter more than the drop. Structure and surprise score; EDM festival filler doesn't.",
    tags: ["electronic", "house", "techno", "idm", "edm", "dubstep", "garage", "dnb", "jungle", "breakcore"],
    profile: { bpm: 128, pulse: 0.75, bass: 0.5, brightness: 0.45, loudnessDb: -8, dynamicsDb: 5 },
  },
  {
    id: "ambient", name: "Ambient and drone",
    take: "Patience gets rewarded when it goes somewhere. Ten minutes of a pad that never changes gets called wallpaper.",
    tags: ["ambient", "drone", "lofi", "lo-fi", "chill", "soundscape", "experimental"],
    profile: { bpm: 70, pulse: 0.1, bass: 0.3, brightness: 0.2, loudnessDb: -18, dynamicsDb: 12 },
  },
  {
    id: "rnb", name: "Moody R&B and soul",
    take: "Vibe has to come with writing. Great vocals over a forgettable beat get a 'decent'.",
    tags: ["r&b", "rnb", "soul", "neo soul", "frank ocean", "sza", "funk"],
    profile: { bpm: 85, pulse: 0.5, bass: 0.45, brightness: 0.3, loudnessDb: -10, dynamicsDb: 7 },
  },
];

export const BOXES: Box[] = ARCHETYPES.map((a) => {
  const d = (DATA as unknown as Record<string, BoxData>)[a.id];
  if (!d) throw new Error(`no review data for box ${a.id}: run scripts/build-boxes.ts`);
  return { ...a, reviews: d.reviews, scores: d.scores, soundsLike: d.soundsLike, examples: d.examples };
});

const SPREAD: Record<keyof Box["profile"], number> = { bpm: 40, pulse: 0.3, bass: 0.25, brightness: 0.3, loudnessDb: 6, dynamicsDb: 5 };

/** How close a song is to a box, higher is closer. A matching hint outweighs the numbers. */
export function scoreBox(box: Box, f: Features | null, hint: string): number {
  let score = 0;
  if (f) {
    for (const [k, target] of Object.entries(box.profile) as [keyof Box["profile"], number][]) {
      const d = (f[k] - target) / SPREAD[k];
      score -= d * d;
    }
  }
  const h = hint.toLowerCase();
  for (const t of box.tags) if (h.includes(t)) score += 4;
  return score;
}

/** The nearest `n` boxes. With no features and no hint, nobody's close, so it's the first few. */
export function pickBoxes(f: Features | null, hint = "", n = 3): Box[] {
  return [...BOXES].map((b) => ({ b, s: scoreBox(b, f, hint) })).sort((x, y) => y.s - x.s).slice(0, n).map((x) => x.b);
}

export const boxById = (id: string) => BOXES.find((b) => b.id === id);
