// The campaign: the levels as one climb, from the kitchen floor out through the backyard and the
// garden, down to Yosemite's valley floor, and up the granite to the rim. Each chapter is a level and
// its mission (missions.ts), with a few lines of story, and opens when the one before it is won.
// Battles and "fight anywhere" still play any level; only the menu's list is the climb.

import { missionFor, type Mission } from "./missions.ts";

export interface Chapter {
  /** The level it's fought on (levels.ts). */
  level: string;
  title: string;
  /** Where on the climb it is, the line under the title. */
  height: string;
  /** What's going on: shown on the menu and when the chapter starts. */
  story: string;
}

export const CAMPAIGN: Chapter[] = [
  {
    level: "kitchen",
    title: "Boot camp",
    height: "The floor",
    story: "Every toy soldier starts on the kitchen floor. The repo's folders have dug in between the table legs; merge them and the back door's open.",
  },
  {
    level: "backyard",
    title: "Hold the yard",
    height: "Out the back door",
    story: "Main is yours, by the sandbox. The folders want it back and they'll come in waves. Hold it till they give up.",
  },
  {
    level: "garden",
    title: "Lost commit",
    height: "Across the lawn",
    story: "A commit got dropped in a yard past the pond. Fetch it and bring it home to HEAD before the rows close up.",
  },
  {
    level: "el-capitan",
    title: "The valley floor",
    height: "Yosemite, 1,200 m",
    story: "Out of the house and into real ground. The big wall stands over the meadow, and the commit is in its farthest yard. Carry it back.",
  },
  {
    level: "half-dome",
    title: "The shoulders",
    height: "Half Dome, 2,000 m",
    story: "Up on the granite now, with the valley a long way down. Hold main on the dome's shoulder while they climb up after you.",
  },
  {
    level: "glacier-point",
    title: "The heights",
    height: "Glacier Point, 2,200 m",
    story: "The rim, the top of the climb. Every folder up here is dug in with the drop at its back. Merge them all and the repo is yours.",
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
