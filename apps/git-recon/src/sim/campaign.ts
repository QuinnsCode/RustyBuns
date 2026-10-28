// The campaign: the levels as one climb, from the kitchen floor out through the backyard and the
// garden, down to Yosemite's valley floor, and up the granite to the rim. Each chapter is a level and
// its mission (missions.ts), with a few lines of story, and opens when the one before it is won.
// Battles and "fight anywhere" still play any level; only the menu's list is the climb.

import type { BeatId } from "./director.ts";
import { missionFor, type Mission } from "./missions.ts";
import STORIES from "../../content/stories.json";

export interface Chapter {
  /** The level it's fought on (levels.ts). */
  level: string;
  title: string;
  /** Where on the climb it is, the line under the title. */
  height: string;
  /** What's going on: shown on the menu and when the chapter starts. */
  story: string;
  /** Its set pieces (director.ts): how you're brought in, and what goes wrong on the way. */
  beats?: BeatId[];
}

export const CAMPAIGN: Chapter[] = [
  {
    level: "kitchen",
    title: "Boot camp",
    height: "The floor",
    story: STORIES.kitchen,
    beats: ["insertion", "incoming"],
  },
  {
    level: "backyard",
    title: "Hold the yard",
    height: "Out the back door",
    story: STORIES.backyard,
    beats: ["sweep", "jump", "gag"],
  },
  {
    level: "garden",
    title: "Lost commit",
    height: "Across the lawn",
    story: STORIES.garden,
    beats: ["sweep", "beach", "gag"],
  },
  {
    level: "el-capitan",
    title: "The valley floor",
    height: "Yosemite, 1,200 m",
    story: STORIES["el-capitan"],
    beats: ["dropzone", "gag"],
  },
  {
    level: "half-dome",
    title: "The shoulders",
    height: "Half Dome, 2,000 m",
    story: STORIES["half-dome"],
    beats: ["sweep", "stall", "gag"],
  },
  {
    level: "glacier-point",
    title: "The heights",
    height: "Glacier Point, 2,200 m",
    story: STORIES["glacier-point"],
    beats: ["sweep", "onslaught", "extraction", "gag"],
  },
];

/** A level's chapter, or null for one that isn't on the climb (a lat/long). */
export const chapterOf = (levelId: string): number => CAMPAIGN.findIndex((c) => c.level === levelId);

/** Whether a level has been won (on any repo), from the menu's wins ("level:repo" keys, heads.ts). */
const won = (wins: readonly string[], levelId: string) => wins.some((w) => w.startsWith(`${levelId}:`));

/** How many chapters are open: the first, and each one whose chapter before it has been won. */
export function opened(wins: readonly string[]): number {
  let n = 1;
  while (n < CAMPAIGN.length && won(wins, CAMPAIGN[n - 1]!.level)) n++;
  return n;
}

/** The chapter after this level's, if there is one. */
export const nextChapter = (levelId: string): Chapter | null => {
  const i = chapterOf(levelId);
  return i >= 0 ? CAMPAIGN[i + 1] ?? null : null;
};

/** A chapter's mission. */
export const missionOf = (c: Chapter): Mission => missionFor(c.level);
